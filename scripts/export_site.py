"""Export all observed pairs into bounded, independently fetchable static shards.

No full document texts or credentials leave the local corpus. Detailed evidence
uses the existing engine unchanged; basic lookup covers every aggregate pair.
"""
import argparse
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collocations.engine import Engine, ROOT

GROUPS = [
    ["lessen","reduce","decrease","lower","diminish","cut"],
    ["increase","raise","boost","enhance","improve"],
    ["cause","trigger","induce","generate","produce"],
    ["affect","influence","impact"],
    ["solve","resolve","address","tackle"],
    ["obtain","acquire","gain","get"],
    ["make","create","produce","generate"],
    ["prevent","avoid","avert"], ["allow","permit","enable"],
    ["show","indicate","demonstrate","reveal","suggest"],
    ["make","do"], ["ease","relieve","alleviate","lessen"],
]
ADJECTIVES = [["heavy","strong"],["big","large","serious"],
              ["high","strong","real"],["powerful","strong"],
              ["large","strong","great"]]
TARGETS=["risk","impact","burden","pain","price","emission","temperature",
         "population","workforce","problem","decision","rain","coffee",
         "mistake","possibility","influence","unemployment"]


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",",":"), allow_nan=False),encoding="utf-8")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--db",type=Path,default=ROOT/"data/collocations.duckdb")
    parser.add_argument("--output",type=Path,default=ROOT/"site/public/data")
    args=parser.parse_args(); out=args.output
    engine=Engine(args.db)
    try:
        summary=engine.summary()
        relations=engine.rows("SELECT relation,sum(count) edges,count(*) pairs FROM pairs GROUP BY relation ORDER BY relation")
        pair_count=sum(r['pairs'] for r in relations)
        save(out/"summary.json",dict(**summary,pair_count=pair_count,relations=relations,
             snapshot="2026-10-16",built_at=datetime.now(timezone.utc).isoformat(),
             schema=1,shard_function="first two hex characters of SHA256(UTF-8 lemma)",
             clusters=GROUPS,adjective_clusters=ADJECTIVES,
             detail_coverage="Detailed engine evidence and KWIC for selected learning vocabulary; aggregate lookup covers all pairs."))
        # One sorted stream: at most one hash bucket retained in Python memory.
        sql="""WITH right_totals AS (SELECT relation,collocate,sum(count) right_count FROM pairs GROUP BY relation,collocate)
          SELECT substr(sha256(p.lemma),1,2) bucket,p.lemma,p.relation,p.collocate,p.count,p.documents,r.right_count
          FROM pairs p JOIN right_totals r USING(relation,collocate)
          ORDER BY bucket,p.lemma,p.relation,p.count DESC,p.collocate"""
        cur=engine.db.execute(sql)
        current=None; bucket={}; exported=0; index=[]
        def finish(key, data):
            if key is None:return
            save(out/"lexicon"/(key+".json"),data)
            for word, rels in data.items():
                total=sum(x[0] for x in rels.values())
                if total>=3 and word.isalpha() and 1<len(word)<35:
                    index.append([word,total,list(rels)])
        while True:
            rows=cur.fetchmany(20000)
            if not rows:break
            for shard,word,rel,obj,count,docs,right_count in rows:
                if shard!=current:
                    finish(current,bucket);current=shard;bucket={}
                target=bucket.setdefault(word,{}).setdefault(rel,[0,[]])
                target[0]+=count
                target[1].append([obj,count,docs,right_count])
                exported+=1
        finish(current,bucket)
        assert exported==pair_count
        index.sort(key=lambda x:(-x[1],x[0]))
        save(out/"index.json",index)
        print(f"Exported {exported:,} aggregate pairs; {len(index):,} searchable index words",flush=True)
        # Precompute selected educational entries without replacing corpus statistics
        # with editorial judgements. Every record retains the exact scope.
        entries={}
        for rel,groups in [("dobj",GROUPS),("amod",ADJECTIVES)]:
            for group in groups:
                for word in group:
                    entries.setdefault((word,rel),group)
        for (word,rel),group in entries.items():
            top=[r['collocate'] for r in engine.objects(word,rel,16)]
            objects=list(dict.fromkeys([*top,*TARGETS]))
            cells=[engine.pair(word,obj,rel,group,include_kwic=False,family_size=len(group)*len(objects)) for obj in objects]
            # Original-source KWIC, up to two per pair and sixteen pairs per entry.
            for i,cell in enumerate(cells):
                if cell['count'] and (i<16 or cell['collocate'] in TARGETS):
                    cell['kwic']=engine.kwic(word,cell['collocate'],rel,limit=2,window=30)
            save(out/"details"/(sha256((word+":"+rel).encode()).hexdigest()[:20]+".json"),
                 dict(lemma=word,relation=rel,cluster=group,pairs=cells))
            print(f"Detailed evidence: {word}/{rel}",flush=True)
        # Re-use already reviewed benchmark snapshots for an exact regression point.
        report=ROOT/"reports/full_expansion"
        for name in ["comparison_combined.json","comparison_AMALGUM.json","comparison_WikiText-103.json","comparison_OANC.json"]:
            if (report/name).is_file():
                save(out/"benchmarks"/name,json.loads((report/name).read_text(encoding='utf-8')))
        save(out/"coverage.json",dict(pairs=exported,index_words=len(index),detail_entries=len(entries),
             scopes="Aggregate corpus; benchmark source filters available for lessen/reduce group.",
             full_text_published=False,unattested_means_wrong=False))
        print("Public corpus export complete",flush=True)
    finally:engine.close()


if __name__=="__main__":main()
