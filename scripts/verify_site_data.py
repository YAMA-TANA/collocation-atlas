"""Check published aggregate direction, counts, and real benchmark parity."""
import json
from pathlib import Path
from hashlib import sha256
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.engine import ROOT,Engine

def main():
    root=ROOT/'site/public/data'; totals={};sizes=[]
    for direction in ['lexicon','reverse']:
        pairs=edges=0
        for path in sorted((root/direction).glob('*.json')):
            sizes.append(path.stat().st_size)
            for word,rels in json.loads(path.read_text(encoding='utf-8')).items():
                assert sha256(word.encode()).hexdigest()[:2]==path.stem
                for marginal,rows in rels.values():
                    assert marginal==sum(r[1] for r in rows)
                    assert all(r[1]>=r[2]>=1 and r[1]<=r[3] for r in rows)
                    pairs+=len(rows);edges+=marginal
        totals[direction]={'pairs':pairs,'edges':edges}
    assert totals['lexicon']==totals['reverse']
    assert totals['lexicon']=={'pairs':6921544,'edges':34688327}
    assert max(sizes)<25*1024*1024
    engine=Engine()
    checked=0
    try:
        result=json.loads((root/'benchmarks/comparison_combined.json').read_text(encoding='utf-8'))
        for row in result['rows']:
            for word,cell in row['cells'].items():
                file=root/'lexicon'/(sha256(word.encode()).hexdigest()[:2]+'.json')
                data=json.loads(file.read_text(encoding='utf-8'))[word]['dobj'][1]
                item=next((r for r in data if r[0]==row['collocate']),None)
                assert (item[1] if item else 0)==cell['count']
                assert (item[2] if item else 0)==cell['documents']
                assert engine.scalar('SELECT coalesce(sum(count),0) FROM pairs WHERE lemma=? AND relation=\'dobj\' AND collocate=?',[word,row['collocate']])==cell['count']
                checked+=1
    finally:engine.close()
    result={'status':'passed','totals':totals,'real_benchmark_cells':checked,'maximum_shard_bytes':max(sizes),'full_document_texts_published':False}
    folder=ROOT/'reports/site';folder.mkdir(exist_ok=True)
    (folder/'data_verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result))

if __name__=='__main__':main()
