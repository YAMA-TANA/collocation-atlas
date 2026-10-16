"""Reverse lookup for every aggregate; preserves governor->dependent semantics."""
from pathlib import Path
import json
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.store import connect
from collocations.engine import ROOT

def main():
    out=ROOT/'site/public/data'; conn=connect(ROOT/'data/collocations.duckdb')
    try:
        cur=conn.execute('''WITH left_totals AS (SELECT lemma,relation,sum(count) left_count FROM pairs GROUP BY lemma,relation)
          SELECT substr(sha256(p.collocate),1,2),p.collocate,p.relation,p.lemma,p.count,p.documents,l.left_count
          FROM pairs p JOIN left_totals l USING(lemma,relation)
          ORDER BY 1,2,3,p.count DESC,p.lemma''')
        key=None; data={}; count=0
        def save(k,d):
            if k is None:return
            folder=out/'reverse';folder.mkdir(parents=True,exist_ok=True)
            (folder/(k+'.json')).write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        while True:
            batch=cur.fetchmany(20000)
            if not batch:break
            for shard,word,rel,head,n,docs,left in batch:
                if shard!=key:save(key,data);key=shard;data={}
                r=data.setdefault(word,{}).setdefault(rel,[0,[]]);r[0]+=n;r[1].append([head,n,docs,left]);count+=1
        save(key,data)
        expected=conn.execute('SELECT count(*) FROM pairs').fetchone()[0]
        assert count==expected
        # Merge frequent collocates into the autocomplete index without losing heads.
        path=out/'index.json'; index=json.loads(path.read_text(encoding='utf-8')); known={r[0] for r in index}
        for word,n in conn.execute('SELECT collocate,sum(count) n FROM pairs GROUP BY collocate HAVING n>=3').fetchall():
            if word not in known and word.isalpha() and 1<len(word)<35:index.append([word,n,[]])
        index.sort(key=lambda x:(-x[1],x[0]));path.write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        coverage=json.loads((out/'coverage.json').read_text());coverage.update(reverse_pairs=count,index_words=len(index))
        (out/'coverage.json').write_text(json.dumps(coverage),encoding='utf-8')
        print(json.dumps(coverage),flush=True)
    finally:conn.close()

if __name__=='__main__':main()
