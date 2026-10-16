from __future__ import annotations

from collections import Counter
import json
import math
from pathlib import Path
import re

from .statistics import association, absence, wilson, geometric_score
from .store import connect

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "collocations.duckdb"


class Engine:
    def __init__(self, database=DEFAULT_DB, config=None, *, register=None, country=None,
                 year_from=None, year_to=None, source=None):
        self.db = connect(database)
        self.config = config if config is not None else json.loads((ROOT / "config.json").read_text())
        self.scope = dict(register=register, country=country, year_from=year_from, year_to=year_to, source=source)
        clauses, args = [], []
        for field, value, op in (("register", register, "="), ("country", country, "="),
                                 ("year", year_from, ">="), ("year", year_to, "<="), ("source",source,"=")):
            if value is not None:
                clauses.append(f"{field} {op} ?")
                args.append(value)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        # Temporary views permit bound values and keep every statistic on the same scope.
        columns="document_id,source_document_id,source,register,section,year,country,author,domain,source_url,title,text_license,annotation_license,words,tokens"
        self.db.execute("CREATE TEMP TABLE scoped_documents AS SELECT " + columns + " FROM documents" + where, args)
        self.db.execute("""CREATE TEMP VIEW scoped_occurrences AS SELECT o.*,d.source_document_id FROM occurrences o
                        JOIN scoped_documents d USING(document_id)""")
        self.db.execute("""CREATE TEMP TABLE scoped_sources AS SELECT source_document_id AS document_id,
             any_value(domain) AS domain,any_value(author) AS author,any_value(register) AS register,
             any_value(section) AS section,any_value(year) AS year,any_value(country) AS country,
             sum(words) AS words,sum(tokens) AS tokens FROM scoped_documents GROUP BY source_document_id""")
        if not clauses:
            self.db.execute("CREATE TEMP VIEW scoped_pairs AS SELECT lemma,relation,collocate,count FROM pairs")
        elif self.scalar("SELECT count(*) FROM information_schema.tables WHERE table_name='pair_strata'"):
            self.db.execute("CREATE TEMP TABLE scoped_pairs AS SELECT lemma,relation,collocate,sum(count) AS count FROM pair_strata"+where+" GROUP BY lemma,relation,collocate",args)
        else:
            self.db.execute("""CREATE TEMP TABLE scoped_pairs AS SELECT lemma,relation,collocate,
                            count(*) AS count FROM scoped_occurrences GROUP BY ALL""")
        self._cluster_cache = {}
        self._marginals_cache = {}
        self._exposure_cache = {}
        self._object_docs_cache = {}
        self._document_exposure = None
        self._summary = None

    def close(self):
        self.db.close()

    def rows(self, sql, args=()):
        cursor = self.db.execute(sql, args)
        keys = [d[0] for d in cursor.description]
        return [dict(zip(keys,row)) for row in cursor.fetchall()]

    def scalar(self, sql, args=()):
        return self.db.execute(sql, args).fetchone()[0]

    def summary(self):
        if self._summary is not None:
            return self._summary
        counts = self.rows("""SELECT count(*) documents, coalesce(sum(words),0) words,
             coalesce(sum(tokens),0) tokens, count(DISTINCT domain) domains,
             count(DISTINCT author) author_labels, count(year) dated_documents,
             count(country) country_known_documents, min(year) earliest_year, max(year) latest_year
             FROM scoped_sources""")[0]
        counts["segments"] = self.scalar("SELECT count(*) FROM scoped_documents")
        # Source grouping controls independence, but must not impute the known
        # date/author/domain of one chapter to other undated/anonymous chapters.
        observed=self.rows("""SELECT count(DISTINCT domain) domains,count(DISTINCT author) author_labels,
             count(DISTINCT CASE WHEN year IS NOT NULL THEN source_document_id END) dated_documents,
             count(DISTINCT CASE WHEN country IS NOT NULL THEN source_document_id END) country_known_documents,
             min(year) earliest_year,max(year) latest_year FROM scoped_documents""")[0]
        counts.update(observed)
        by_register = self.rows("SELECT register, count(DISTINCT source_document_id) documents, count(*) segments, sum(words) words FROM scoped_documents GROUP BY register ORDER BY register")
        by_source = self.rows("SELECT source, count(DISTINCT source_document_id) documents, count(*) segments, sum(words) words FROM scoped_documents GROUP BY source ORDER BY source")
        self._summary = dict(**counts, registers=by_register, sources=by_source, scope=self.scope,
                            limitations=["sampled source language is not verified native-speaker language",
                                "source domains are not independent speakers",
                                "basic machine parses; parse/sense errors and near duplicates remain",
                                "document publication year is not the date of every quoted expression",
                                "author_labels may name coauthor groups, not individual authors"],
                            statuses=["common", "normal", "marked", "rare but attested",
                                      "strongly dispreferred", "likely anomalous", "insufficient data"])
        return self._summary

    def manifest(self):
        return json.loads(self.scalar("SELECT json FROM manifest"))

    def _marginals(self,relation):
        if relation not in self._marginals_cache:
            left=dict(self.db.execute("SELECT lemma,sum(count) FROM scoped_pairs WHERE relation=? GROUP BY lemma",[relation]).fetchall())
            right=dict(self.db.execute("SELECT collocate,sum(count) FROM scoped_pairs WHERE relation=? GROUP BY collocate",[relation]).fetchall())
            self._marginals_cache[relation]=(sum(left.values()),left,right)
        return self._marginals_cache[relation]

    def _cluster(self, words, relation):
        words = tuple(dict.fromkeys(w.lower() for w in words))
        if len(words) < 2 or len(words) > 30:
            raise ValueError("Use between 2 and 30 distinct comparison lemmas")
        key = (words, relation)
        if key not in self._cluster_cache:
            marks = ",".join("?" for _ in words)
            rows = self.rows(f"""SELECT o.lemma, o.collocate, d.source || ':' || coalesce(d.register,'unknown') AS stratum, count(*) count,
                        count(DISTINCT o.source_document_id) documents FROM scoped_occurrences o
                        JOIN scoped_documents d USING(document_id)
                        WHERE relation=? AND lemma IN ({marks}) GROUP BY ALL""", [relation,*words])
            base, by_object, strata, cells = Counter(), Counter(), Counter(), Counter()
            objects_by_stratum = Counter()
            for row in rows:
                w,o,s,c = row['lemma'],row['collocate'],row['stratum'],row['count']
                base[w] += c
                by_object[o] += c
                strata[(w,s)] += c
                objects_by_stratum[(o,s)] += c
                cells[(w,o)] += c
            self._cluster_cache[key] = (words, base, by_object, strata, objects_by_stratum, cells)
        return self._cluster_cache[key]

    def pair(self, lemma, collocate, relation="dobj", words=None, *, include_kwic=True,
             family_size=1):
        lemma,collocate = lemma.lower(),collocate.lower()
        words = words or self.config["synonyms"]
        if lemma not in words:
            # No invented synonym set for an unrelated word.
            cluster = None
        else:
            cluster = self._cluster(words, relation)
        c = self.scalar("SELECT coalesce(sum(count),0) FROM scoped_pairs WHERE lemma=? AND relation=? AND collocate=?", [lemma,relation,collocate])
        total,left_counts,right_counts=self._marginals(relation)
        left,right=left_counts.get(lemma,0),right_counts.get(collocate,0)
        stats = association(c,left,right,total)
        result = dict(lemma=lemma, relation=relation, collocate=collocate,
                      count=c, per_million=c*1e6/self.summary()["words"] if self.summary()["words"] else None,
                      statistics=stats, scope=self.scope)
        distribution = self.rows("""SELECT d.document_id,d.source_document_id, d.domain, d.author, d.register, d.section,
                      d.year, d.country, d.words, count(*) count FROM scoped_occurrences o
                      JOIN scoped_documents d ON o.document_id=d.document_id
                      WHERE lemma=? AND relation=? AND collocate=? GROUP BY ALL""", [lemma,relation,collocate])
        by_document=Counter()
        for d in distribution:by_document[d["source_document_id"]]+=d["count"]
        documents = len(by_document)
        for key,label in [("domain","domains"),("author","author_labels"),("section","sections")]:
            result[label] = len({d[key] for d in distribution if d[key] is not None})
        result["documents"] = documents
        result["author_known_documents"] = len({d["source_document_id"] for d in distribution if d["author"] is not None})
        result["dialect_known_documents"] = len({d["source_document_id"] for d in distribution if d["country"] is not None})
        hhi = sum((v/c)**2 for v in by_document.values()) if c else None
        domain_counts = Counter()
        for d in distribution:
            domain_counts[d["domain"] or "unknown"] += d["count"]
        domain_hhi = sum((v/c)**2 for v in domain_counts.values()) if c else None
        # DP uses document word shares, including documents with zero occurrences.
        denom = self.summary()["words"]
        if self._document_exposure is None:
            self._document_exposure=self.db.execute("SELECT document_id,words FROM scoped_sources").fetchall()
        dp = (0.5*sum(abs(by_document.get(i,0)/c-w/denom) for i,w in self._document_exposure) if c and denom else None)
        result["dispersion"] = dict(dp=dp, document_hhi=hhi,
             effective_documents=1/hhi if hhi else 0,
             domain_hhi=domain_hhi, effective_domains=1/domain_hhi if domain_hhi else 0,
             domain_counts=dict(domain_counts),
             max_document_share=max(by_document.values())/c if c else None)
        for field,label in [("register","registers"),("country","dialects"),("year","years")]:
            frequencies = Counter()
            for d in distribution:
                frequencies[str(d[field]) if d[field] is not None else "unknown"] += d["count"]
            if field not in self._exposure_cache:
                self._exposure_cache[field]={str(k) if k is not None else "unknown": w for k,w in
                        self.db.execute(f"SELECT {field},sum(words) FROM scoped_documents GROUP BY {field}").fetchall()}
            exposures=self._exposure_cache[field]
            # Always expose denominators: occurrence proportions are not usage rates.
            result[label] = {k:dict(count=v, share=v/c, words=exposures[k],
                                  per_million=v*1e6/exposures[k] if exposures[k] else None)
                             for k,v in sorted(frequencies.items())}
        forms = self.rows("""SELECT head_form,collocate_form,count(*) count FROM scoped_occurrences
                       WHERE lemma=? AND relation=? AND collocate=? GROUP BY ALL ORDER BY count DESC""", [lemma,relation,collocate])
        result["surface_forms"] = forms
        recent = self.config["reference_year"]-self.config["recent_years"]+1
        dated = sum(d["count"] for d in distribution if d["year"] is not None)
        recent_n = sum(d["count"] for d in distribution if d["year"] is not None and recent <= d["year"] <= self.config["reference_year"])
        result["recency"] = dict(dated_count=dated, unknown_count=c-dated, recent_count=recent_n,
                                 from_year=recent, to_year=self.config["reference_year"],
                                 recent_share_of_dated=recent_n/dated if dated else None)
        preference, evidence, negative = None, None, False
        if cluster:
            words,base,objects,strata,objects_s,cells = cluster
            a,t,A = base[lemma],objects[collocate],sum(base.values())
            baseline = a/A if A else 0
            share = c/t if t else None
            interval = wilson(c,t)
            # Exposure-adjusted selection within each available register.
            registers = {s for _,s in strata}
            strat_expected = sum(objects_s[(collocate,s)]*strata[(lemma,s)]/
                                 sum(strata[(w,s)] for w in words) for s in registers
                                 if sum(strata[(w,s)] for w in words))
            support_expected = sum(objects_s[(collocate,s)]*strata[(lemma,s)]/
                                   sum(strata[(w,s)] for w in words) for s in registers
                                   if strata[(lemma,s)] >= self.config["min_stratum_verb_edges"])
            evidence = absence(c,t,baseline,strat_expected)
            evidence["stratification"] = "source x register"
            evidence["supported_strata_expected_count"] = support_expected
            evidence["adjusted_p"] = min(1,evidence["raw_binomial_p"]*family_size)
            evidence["multiple_testing"] = dict(method="Bonferroni", family_size=family_size)
            doc_key=(tuple(words),relation,collocate)
            if doc_key not in self._object_docs_cache:
                self._object_docs_cache[doc_key]=self.scalar("""SELECT count(DISTINCT source_document_id) FROM scoped_occurrences
                         WHERE relation=? AND collocate=? AND lemma IN ("""+
                         ",".join("?" for _ in words)+")", [relation,collocate,*words])
            obj_docs=self._object_docs_cache[doc_key]
            preference = dict(words=list(words), observed_share=share, share_ci95=interval,
                 baseline_share=baseline, lift=share/baseline if share is not None and baseline else None,
                 preference_score=(share/(share+baseline) if share is not None and share+baseline else None),
                 object_cluster_count=t, object_cluster_documents=obj_docs, verb_cluster_count=a,
                 cluster_count=A, interpretation="0.5 = share expected from verb base rate; not a naturalness probability")
            negative = (a >= self.config["min_verb_edges"] and t >= self.config["min_object_cluster_edges"]
                        and obj_docs >= self.config["min_object_documents"]
                        and min(evidence["expected_count"],support_expected) >= self.config["min_expected"]
                        and interval[1] < baseline*self.config["max_relative_share_upper"]
                        and evidence["adjusted_p"] < self.config["absence_adjusted_p"])
            evidence["decision_gates"] = dict(
                verb_sample=a >= self.config["min_verb_edges"],
                object_sample=t >= self.config["min_object_cluster_edges"],
                object_documents=obj_docs >= self.config["min_object_documents"],
                expected_count=min(evidence["expected_count"],support_expected) >= self.config["min_expected"],
                relative_share_upper=interval[1] < baseline*self.config["max_relative_share_upper"],
                adjusted_tail=evidence["adjusted_p"] < self.config["absence_adjusted_p"])
        result["synonym_preference"] = preference
        result["negative_evidence"] = evidence
        cfg = self.config
        if negative:
            status,reason = "strongly dispreferred", "relative selection is unusually low in this scoped corpus; shared sense still needs review"
        elif c >= 50 and documents >= 20 and (hhi or 1) <= 0.1:
            status,reason = "common", "frequent and dispersed across sampled documents"
        elif c >= 10 and documents >= 8 and (hhi or 1) <= 0.25:
            status,reason = "normal", "repeated across sampled documents"
        elif c >= cfg["min_pair_count"] and documents >= cfg["min_pair_documents"]:
            status,reason = "marked", "attested across several documents; broad typicality unestablished"
        elif c > 0:
            status,reason = "rare but attested", "observed, but too little dispersed evidence to infer typicality"
        else:
            status,reason = "insufficient data", "unattested in this sample; absence gates do not establish dispreference"
        result["status"] = status
        result["status_reason"] = reason
        result["confidence"] = dict(level="insufficient" if status in {"insufficient data","rare but attested"} else "exploratory",
             native_population_inference="not established", sense_annotation="unavailable",
             likely_anomalous="reserved for independently validated evidence; never assigned from count zero")
        components = dict(frequency=min(1,math.log1p(c)/math.log(101)),
             association=max(0,min(1,(stats["log_dice"] or 0)/14)),
             dispersion=(min(1,documents/20)*(1-(hhi or 1))*min(1,(1/domain_hhi)/5)) if c and domain_hhi else 0,
             synonym_preference=preference["preference_score"] if preference else None,
             register_breadth=None, recency=None)
        result["naturalness"] = dict(score=(geometric_score(components,cfg["score_weights"])
                      if c >= cfg["min_pair_count"] and documents >= cfg["min_pair_documents"] else None),
                      calibrated=False, label="experimental evidence score; not validated native naturalness",
                      components=components, weights=cfg["score_weights"],
                      omitted="register breadth and recency excluded until comparable coverage is established")
        if include_kwic:
            result["kwic"] = self.kwic(lemma,collocate,relation)
        return result

    def kwic(self, lemma, collocate, relation="dobj", limit=5, window=40):
        if not 0 <= limit <= 100 or not 1 <= window <= 50:
            raise ValueError("KWIC limit must be 0..100 and window 1..50")
        rows = self.rows("""SELECT o.*,d.source,d.source_url,d.year,d.register,
                    d.country,d.text_license,d.title FROM scoped_occurrences o JOIN scoped_documents d USING(document_id)
                    WHERE lemma=? AND relation=? AND collocate=?
                    QUALIFY row_number() OVER(PARTITION BY o.source_document_id ORDER BY sentence_id,head_position)=1
                    ORDER BY document_id LIMIT ?""", [lemma,relation,collocate,limit])
        for row in rows:
            forms = json.loads(self.scalar("SELECT forms_json FROM documents WHERE document_id=?",[row["document_id"]]))
            lo,hi = sorted((row["head_position"],row["collocate_position"]))
            row.update(left=" ".join(forms[max(0,lo-window):lo]),
                       match=" ".join(forms[lo:hi+1]), right=" ".join(forms[hi+1:hi+1+window]),
                       window_tokens_per_side=window)
        return rows

    def objects(self, verb, relation="dobj", limit=30):
        return self.rows("""SELECT collocate,count FROM scoped_pairs WHERE lemma=? AND relation=?
                            ORDER BY count DESC,collocate LIMIT ?""", [verb.lower(),relation,limit])

    def word(self, lemma, relation="dobj", limit=20):
        lemma=lemma.lower()
        rows = self.objects(lemma,relation,limit)
        return dict(lemma=lemma, corpus=self.summary(),
                    collocations=[self.pair(lemma,r["collocate"],relation,include_kwic=False) for r in rows],
                    semantic_preference=dict(status="not yet estimated", evidence=[r["collocate"] for r in rows],
                         explanation="semantic labels and prosody require reviewed grouping; not inferred from LLM intuition"))

    def compare(self, words, objects=None, relation="dobj", limit=20):
        cluster = self._cluster(words,relation)
        words = list(cluster[0])
        objects = objects or [o for o,_ in cluster[2].most_common(limit)]
        family_size=max(1,len(objects)*len(words))
        return dict(words=words,relation=relation,corpus=self.summary(),
                    preference_score_definition="share / (share + baseline_share); 0.5 = independence, NULL = no evidence",
                    rows=[dict(collocate=o, cells={w:self.pair(w,o,relation,words,
                              include_kwic=False,family_size=family_size) for w in words}) for o in objects])

    def phrase(self, text):
        # A deliberately bounded MVP query grammar, not an English grammar checker.
        parts=re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?",text.lower())
        words=self.config["synonyms"]
        if len(parts) not in {2,3} or parts[0] not in words or (len(parts)==3 and parts[1] not in {"the","a","an"}):
            raise ValueError("MVP phrase input: configured base verb + optional the/a/an + noun lemma (e.g. lessen the price)")
        lemma,obj=parts[0],parts[-1]
        # Use only corpus-attested inflections, without guessing an emissions -> emission rule.
        candidates = self.rows("""SELECT collocate,count(*) count FROM scoped_occurrences
                 WHERE lower(collocate_form)=? AND relation='dobj' GROUP BY collocate ORDER BY count DESC""", [obj])
        object_lemma=candidates[0]["collocate"] if candidates else obj
        evidence=self.pair(lemma,object_lemma)
        comparisons=[self.pair(w,object_lemma,include_kwic=False) for w in words if w != lemma]
        alternatives=sorted((p for p in comparisons if p["count"] > 0),key=lambda p:p["count"],reverse=True)
        return dict(text=text, query=dict(lemma=lemma,collocate=object_lemma,relation="dobj",
                     aggregation="lemma dependency; determiners, modifiers and inflections are pooled; not exact phrase count",
                     object_lemma_candidates=candidates), meaning="not assessed", grammar="not assessed",
                    corpus_status="attested" if evidence["count"] else "unattested in this scoped corpus",
                    native_preference=evidence["status"], evidence=evidence,
                    alternatives=[dict(lemma=p["lemma"],collocate=object_lemma,count=p["count"],
                         documents=p["documents"],preference=p["synonym_preference"],
                         sense_equivalence="requires context review") for p in alternatives],
                    why="Selection is compared within the declared synonym set, with verb base rates, document dispersion and register-adjusted expected counts. This does not establish grammaticality or sense equivalence.")

    def gaps(self, word, relation="dobj", limit=30):
        words=self.config["synonyms"]
        if word not in words:
            raise ValueError("No configured synonym set for this lemma")
        cluster=self._cluster(words,relation)
        family_size=max(1,len(cluster[2])*len(words))
        candidates=[]
        for obj,total in cluster[2].items():
            if total < self.config["min_object_cluster_edges"]:
                continue
            pair=self.pair(word,obj,relation,words,include_kwic=False,family_size=family_size)
            candidates.append(pair)
        candidates.sort(key=lambda p:p["negative_evidence"]["stratified_log_absence"],reverse=True)
        return dict(word=word,relation=relation,corpus=self.summary(),
                    family_size=family_size,semantic_substitutability="unverified; candidates require review",
                    confirmed_relative_gaps=[p for p in candidates if p["status"]=="strongly dispreferred"][:limit],
                    exploratory_candidates=candidates[:limit])
