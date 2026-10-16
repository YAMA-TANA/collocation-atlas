"""Validate the public semantic export against the corpus and regression fixture."""
from hashlib import sha256
import json
from pathlib import Path
import zipfile
import duckdb

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"site/public/data/semantics"


def main():
    words={}
    for path in sorted(OUT.glob("??.json")):
        shard=json.loads(path.read_text(encoding="utf-8"))
        assert "Copyright 2006 by Princeton University" in shard["license"]
        assert "AS IS" in shard["license"]
        for word,entry in shard["words"].items():
            assert sha256(word.encode()).hexdigest()[:2]==path.stem
            assert word not in words
            words[word]=entry
    manifest=json.loads((OUT/"manifest.json").read_text(encoding="utf-8"))
    senses=sum(len(entry.get(pos,[])) for entry in words.values() for pos in ["a","v","n","r"])
    assert len(words)==manifest["words"] and senses==manifest["senses"]
    db=duckdb.connect(str(ROOT/"data/collocations.duckdb"),read_only=True)
    db.execute("SET memory_limit='2GB'");db.execute("SET threads=4")
    counts={}
    for relation,direction,pos in [("amod","forward","a"),("dobj","forward","v"),("dobj","reverse","n")]:
        key=f"{relation}:{direction}"
        left,right=("lemma","collocate") if direction=="forward" else ("collocate","lemma")
        marginals=dict(db.execute(f"SELECT {left},sum(count) FROM pairs WHERE relation=? GROUP BY 1",[relation]).fetchall())
        neighbours=0
        for word,entry in words.items():
            if key in entry.get("totals",{}):
                assert entry["totals"][key]==marginals[word]
            opposite={w for s in entry.get(pos,[]) for w in s["antonyms"]}
            for neighbour in entry.get("neighbours",{}).get(key,[]):
                assert neighbour["word"]!=word and neighbour["word"] not in opposite
                assert neighbour["similarity"]>=.12 and len(neighbour["shared"])>=3
            if entry.get("neighbours",{}).get(key):
                neighbours+=1
        assert neighbours==manifest["neighbours"][key]
        counts[key]=neighbours
    fixture=json.loads((ROOT/"site/src/fixtures/high-regression.json").read_text(encoding="utf-8"))
    verified=0
    for word,entry in fixture["entries"].items():
        total,rows=entry["amod"]
        assert total==db.execute("SELECT sum(count) FROM pairs WHERE lemma=? AND relation='amod'",[word]).fetchone()[0]
        for partner,count,documents,_ in rows:
            assert (count,documents)==db.execute("SELECT count,documents FROM pairs WHERE lemma=? AND relation='amod' AND collocate=?",[word,partner]).fetchone()
            verified+=1
    db.close()
    archive=ROOT/"data/semantic-site.zip"
    digest=sha256(archive.read_bytes()).hexdigest()
    assert digest==(ROOT/"data/semantic-site.sha256").read_text().split()[0]
    with zipfile.ZipFile(archive) as z:
        for path in OUT.iterdir():
            if path.is_file():assert z.read("data/semantics/"+path.name)==path.read_bytes()
    report={"lexical_words":len(words),"senses":senses,"neighbour_sets":counts,"verified_high_pair_cells":verified,"license_on_every_shard":True,"archive_sha256":digest,"max_shard_bytes":max(p.stat().st_size for p in OUT.glob('??.json')),"all_assertions_passed":True}
    path=ROOT/"reports/site/semantics_verification.json"
    path.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2))


if __name__=="__main__":main()
