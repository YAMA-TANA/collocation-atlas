"""Reproducible lexical senses and corpus context neighbours; never frequency guesses.

uv pip install --python .venv/Scripts/python.exe nltk==3.10.3 scipy==1.15.3
python -m nltk.downloader -d data/nltk_data wordnet
python scripts/export_semantics.py
"""
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import Path
import re
import zipfile

import duckdb
import nltk
import numpy as np
from scipy.sparse import csr_matrix, diags

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site/public/data/semantics"
nltk.data.path.insert(0, str(ROOT / "data/nltk_data"))
from nltk.corpus import wordnet as wn


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    assert sha256((ROOT / "data/nltk_data/corpora/wordnet.zip").read_bytes()).hexdigest() == "cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59", "Unexpected WordNet source archive; review before exporting."
    corpus_words = {r[0] for r in json.loads((OUT.parent / "index.json").read_text(encoding="utf-8"))}
    entries = defaultdict(dict)
    antonyms = defaultdict(set)
    usable = lambda name: bool(re.fullmatch(r"[a-z][a-z-]{1,29}", name))
    senses = 0
    for pos in ["a", "v", "n", "r"]:
        for word in sorted(set(wn.all_lemma_names(pos=pos)) & corpus_words):
            if not usable(word):
                continue
            result = []
            for syn in wn.synsets(word, pos=pos):
                direct = sorted({n for n in syn.lemma_names() if n != word and usable(n)})
                related = sorted({n for s in syn.similar_tos() for n in s.lemma_names() if n != word and usable(n)} - set(direct))
                # Broader lexical links stay separate from synonym/similar_to claims.
                linked = syn.also_sees() + syn.verb_groups()
                if pos in ['v','n']:
                    linked += syn.hypernyms() + syn.hyponyms()
                linked += [s2 for s1 in syn.similar_tos() for s2 in s1.similar_tos()]
                nearby = sorted({n for s2 in linked for n in s2.lemma_names() if n != word and usable(n)} - set(direct) - set(related))
                opposite = {a.name() for lem in syn.lemmas() if lem.name() == word for a in lem.antonyms()}
                antonyms[(word, pos)].update(opposite)
                result.append({"id": syn.name(), "definition": syn.definition(),
                               "synonyms": direct, "similar": related, "related":nearby, "antonyms": sorted(opposite)})
            entries[word][pos] = result
            senses += len(result)
    print(f"WordNet: {len(entries):,} words / {senses:,} senses", flush=True)
    db = duckdb.connect(str(ROOT / "data/collocations.duckdb"), read_only=True)
    db.execute("SET memory_limit='2GB'")
    db.execute("SET threads=4")
    neighbour_counts = {}
    # Relation-specific spaces prevent adjective/verb/noun candidates mixing.
    for relation, reverse, pos in [("amod", False, "a"), ("dobj", False, "v"), ("nsubj", False, "v"), ("amod", True, "n"), ("dobj", True, "n"), ("adj_adv", True, "r"), ("verb_adv", True, "r")]:
        left, right = ("collocate", "lemma") if reverse else ("lemma", "collocate")
        rows = db.execute(f"""WITH marginal AS (
            SELECT {left} word, sum(count) total FROM pairs WHERE relation=? GROUP BY 1
          ), context AS (
            SELECT {right} word, sum(count) total FROM pairs WHERE relation=? GROUP BY 1
          )
          SELECT p.{left},p.{right},p.count,m.total,c.total,p.documents
          FROM pairs p JOIN marginal m ON p.{left}=m.word JOIN context c ON p.{right}=c.word
          WHERE p.relation=? AND p.count>=3 AND p.documents>=3 AND m.total>=50
          AND regexp_full_match(p.{left},'[a-z][a-z-]{{1,29}}')
          AND regexp_full_match(p.{right},'[a-z][a-z-]{{1,29}}')
          ORDER BY 1,3 DESC,2""", [relation]*3).fetchall()
        total = db.execute("SELECT sum(count) FROM pairs WHERE relation=?", [relation]).fetchone()[0]
        vectors = defaultdict(list)
        samples=defaultdict(list)
        for word, context, count, marginal, other, documents in rows:
            samples[word].append([context,count,documents,other])
            # Discount low support; rare single-topic pairs cannot dominate cosine.
            weight = max(0, np.log2(count * total / (marginal * other))) * count / (count + 5)
            if weight > 0:
                vectors[word].append((context, float(weight)))
        vectors = {w: sorted(v, key=lambda x: (-x[1], x[0]))[:120] for w, v in vectors.items() if len(v)>=5}
        for word in vectors:
            if word not in entries:
                entries[word]={}
        words = sorted(vectors)
        contexts = {c: i for i, c in enumerate(sorted({c for v in vectors.values() for c, _ in v}))}
        ri, ci, weights = [], [], []
        for i, word in enumerate(words):
            for context, weight in vectors[word]:
                ri.append(i); ci.append(contexts[context]); weights.append(weight)
        matrix = csr_matrix((weights, (ri, ci)), shape=(len(words), len(contexts)), dtype=np.float32)
        norms = np.sqrt(matrix.multiply(matrix).sum(axis=1)).A1
        matrix = (diags(1 / np.maximum(norms, 1e-9)) @ matrix).tocsr()
        word_ids={w:i for i,w in enumerate(words)}
        vector_maps={w:dict(v) for w,v in vectors.items()}
        key = f"{relation}:{'reverse' if reverse else 'forward'}"
        for word, count in db.execute(f"SELECT {left},sum(count) FROM pairs WHERE relation=? GROUP BY 1", [relation]).fetchall():
            if word in entries:
                entries[word].setdefault("totals", {})[key] = count
        for word in vectors:
            entries[word].setdefault("contexts", {})[key] = sorted(samples[word],key=lambda r:(-r[1],r[0]))[:16]
        exported = 0
        for start in range(0, len(words), 128):
            sims = (matrix[start:start+128] @ matrix.T).tocsr()
            for local in range(sims.shape[0]):
                index = start + local
                scores = sims.getrow(local)
                candidates = sorted(zip(scores.indices, scores.data), key=lambda x: (-float(x[1]), words[x[0]]))
                top = []
                score_lookup = dict(zip(scores.indices,scores.data))
                lexical = {n for s in entries[words[index]].get(pos,[]) for n in s["synonyms"]+s["similar"]+s.get("related",[])}
                evidence = {}
                for candidate in sorted(lexical):
                    j=word_ids.get(candidate)
                    if j is None or j==index:continue
                    shared=set(vector_maps[words[index]]) & set(vector_maps[candidate])
                    if shared:
                        shared=sorted(shared,key=lambda c:(-min(vector_maps[words[index]][c],vector_maps[candidate][c]),c))
                        evidence[candidate]={"similarity":round(float(score_lookup.get(j,0)),5),"shared":shared[:6],"shared_count":len(shared)}
                if evidence:entries[words[index]].setdefault("evidence",{})[key]=evidence
                own = dict(vectors[words[index]])
                for j, score in candidates:
                    if j == index or score < .12 or words[j] in antonyms[(words[index], pos)] or words[index] in antonyms[(words[j], pos)]:
                        continue
                    shared = sorted(set(own) & {c for c, _ in vectors[words[j]]}, key=lambda c: (-own[c], c))
                    if len(shared) < 3:
                        continue
                    top.append({"word": words[j], "similarity": round(float(score), 4), "shared": shared[:5]})
                    if len(top) == 24:
                        break
                if top:
                    entries[words[index]].setdefault("neighbours", {})[key] = top
                    exported += 1
        neighbour_counts[key] = exported
        print(f"{key}: {len(words):,} vectors, {exported:,} neighbour sets", flush=True)
    # Availability must cover reverse adjective lookup and the other supported
    # relations too, even where no distributional-neighbour space is built.
    for direction, left in [("forward", "lemma"), ("reverse", "collocate")]:
        cursor=db.execute(f"SELECT relation,{left},sum(count) FROM pairs GROUP BY 1,2")
        while True:
            batch=cursor.fetchmany(10000)
            if not batch:break
            for relation,word,count in batch:
                if word in entries:
                    entries[word].setdefault("totals", {})[f"{relation}:{direction}"]=count
    for word,pos,count in db.execute("SELECT lemma,pos,sum(count) FROM lemma_frequency GROUP BY 1,2").fetchall():
        if word in entries:entries[word].setdefault("pos_counts",{})[pos]=count
    db.close()
    buckets = defaultdict(dict)
    for word, entry in sorted(entries.items()):
        alternatives = {n for pos in ["a", "v", "n", "r"] for sense in entry.get(pos, []) for n in sense["synonyms"] + sense["similar"] + sense.get("related",[])}
        alternatives.update(n["word"] for group in entry.get("neighbours", {}).values() for n in group)
        entry["availability"] = {n: entries[n].get("totals", {}) for n in sorted(alternatives) if n in entries}
        buckets[sha256(word.encode()).hexdigest()[:2]][word] = entry
    with zipfile.ZipFile(ROOT / "data/nltk_data/corpora/wordnet.zip") as source:
        license_text = source.read("wordnet/LICENSE").decode()
    (OUT / "WORDNET-LICENSE.txt").write_text(license_text, encoding="utf-8")
    for key in [f"{i:02x}" for i in range(256)]:
        save(OUT / (key + ".json"), {"license": license_text, "words": buckets[key]})
    archive_hash = sha256((ROOT / "data/nltk_data/corpora/wordnet.zip").read_bytes()).hexdigest()
    save(OUT / "manifest.json", {"schema": 2, "wordnet": wn.get_version(), "words": len(entries), "senses": senses, "lexical_words":sum(any(p in e for p in ["a","v","n","r"]) for e in entries.values()),
         "source": "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip",
         "source_sha256": archive_hash, "neighbours": neighbour_counts,
         "method": "Relation-specific discounted PPMI cosine; pair count>=3, original documents>=3, marginal>=50, >=5 features, top120 features, cosine>=0.12, >=3 shared contexts. Direct WordNet antonyms removed. Twenty-four context neighbours; lexical candidate cosine and shared-feature evidence exported separately. Broader WordNet also_see/verb_group/two-hop similar_to/direct hypernym/hyponym links are not synonym assertions. No per-word overrides. Counts remain unchanged.",
         "license": "WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved. See WORDNET-LICENSE.txt."})
    print(json.dumps({"words": len(entries), "senses": senses, "neighbours": neighbour_counts}), flush=True)


if __name__ == "__main__":
    main()
