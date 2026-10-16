"""Definition similarity is a candidate aid, never corpus frequency evidence.

Run after export_semantics.py. TF-IDF uses WordNet definitions compared per sense/POS, maximum qualifying sense-pair similarity;
the corpus gate requires >=3 shared contexts, each seen >=3 times in >=3 documents.
No word-specific rules or external model/API are used.
"""
from collections import Counter,defaultdict
import json
from pathlib import Path
import re
import duckdb
import numpy as np
from nltk.stem import PorterStemmer
from scipy.sparse import csr_matrix,diags

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'site/public/data/semantics'
STOP=set('a an the and or but of in on at to from by for with without as is are was were be been being it its this that these those which who whom whose what when where how not no any all some such one two other another more most less very too also especially usually often sometimes having have has had used use make makes made marked characterized relating consisting involving something someone somebody thing person people state act manner quality degree'.split())
stem=PorterStemmer().stem
def save(path,value):path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
def main():
 definitions={}
 for path in sorted(OUT.glob('??.json')):
  data=json.loads(path.read_text(encoding='utf-8'))
  for word,entry in data['words'].items():
   definitions[word]={p:[s['definition'] for s in entry.get(p,[])] for p in ['a','v','n','r'] if entry.get(p)}
 db=duckdb.connect(str(ROOT/'data/collocations.duckdb'),read_only=True);db.execute("SET memory_limit='2GB'");db.execute('SET threads=4')
 results=defaultdict(dict);counts={}
 for relation,direction,pos in [('amod','forward','a'),('dobj','forward','v'),('nsubj','forward','v'),('amod','reverse','n'),('dobj','reverse','n')]:
  left,right=('lemma','collocate') if direction=='forward' else ('collocate','lemma')
  rows=db.execute(f"""SELECT {left},{right} FROM pairs WHERE relation=? AND count>=3 AND documents>=3
    AND regexp_full_match({left},'[a-z][a-z-]{{1,29}}') AND regexp_full_match({right},'[a-z][a-z-]{{1,29}}')""",[relation]).fetchall()
  features=defaultdict(set)
  for word,context in rows:
   if definitions.get(word,{}).get(pos):features[word].add(context)
  features={w:c for w,c in features.items() if len(c)>=5};words=sorted(features)
  texts=[];owners=[]
  for i,w in enumerate(words):
   for definition in definitions[w][pos]:
    texts.append(Counter(stem(t) for t in re.findall('[a-z]+',definition.lower()) if len(t)>2 and t not in STOP));owners.append(i)
  vocabulary={t:i for i,t in enumerate(sorted({t for c in texts for t in c}))};df=Counter(t for c in texts for t in c)
  rr,cc,vv=[],[],[]
  for i,terms in enumerate(texts):
   for t,n in terms.items():rr.append(i);cc.append(vocabulary[t]);vv.append((1+np.log(n))*(1+np.log((len(texts)+1)/(df[t]+1))))
  gloss=csr_matrix((vv,(rr,cc)),shape=(len(texts),len(vocabulary)),dtype=np.float32)
  norm=np.sqrt(gloss.multiply(gloss).sum(axis=1)).A1;gloss=(diags(1/np.maximum(norm,1e-9))@gloss).tocsr()
  contexts={t:i for i,t in enumerate(sorted({t for values in features.values() for t in values}))};rr=[];cc=[]
  for i,w in enumerate(words):
   for t in features[w]:rr.append(i);cc.append(contexts[t])
  corpus=csr_matrix((np.ones(len(rr),dtype=np.float32),(rr,cc)),shape=(len(words),len(contexts)))
  common=(corpus@corpus.T).tocsr();key=relation+':'+direction;exported=0
  links=defaultdict(dict);common_cache={}
  for start in range(0,len(texts),128):
   gs=(gloss[start:start+128]@gloss.T).tocsr()
   for local in range(gs.shape[0]):
    sense_index=start+local;i=owners[sense_index]
    if i not in common_cache:
     row=common.getrow(i);common_cache[i]={j:n for j,n in zip(row.indices,row.data) if n>=3}
    eligible=common_cache[i];row=gs.getrow(local)
    for other,similarity in zip(row.indices,row.data):
     j=owners[other]
     if j==i or similarity<.12 or j not in eligible:continue
     previous=links[i].get(j)
     if previous and previous['gloss_similarity']>=similarity:continue
     tokens=sorted(set(texts[sense_index])&set(texts[other]),key=lambda t:(df[t],t))
     if len(tokens)<2:continue
     shared=sorted(features[words[i]]&features[words[j]])
     links[i][j]={'word':words[j],'gloss_similarity':round(float(similarity),5),'tokens':tokens[:6],'shared':shared[:8]}
  for i,candidates in links.items():
   selected=sorted(candidates.values(),key=lambda c:(-c['gloss_similarity'],c['word']))[:32]
   if selected:results[words[i]][key]=selected;exported+=1
  counts[key]=exported;print(f'{key}: {exported:,} definition-neighbour sets',flush=True)
 db.close()
 for path in sorted(OUT.glob('??.json')):
  data=json.loads(path.read_text(encoding='utf-8'))
  for word,entry in data['words'].items():
   entry.pop('gloss_neighbours',None)
   if word in results:entry['gloss_neighbours']=results[word]
  save(path,data)
 manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'));manifest['schema']=3;manifest['gloss_neighbours']=counts;manifest['definition_method']='WordNet definitions compared per sense/POS, maximum qualifying sense-pair similarity; Porter stems, sublinear TF-IDF, cosine>=0.12, >=2 shared definition tokens; >=3 shared corpus contexts each with >=3 occurrences in >=3 documents; top32. This is a similarity aid, not a synonym or native-naturalness claim.';save(OUT/'manifest.json',manifest)
 report={w:results.get(w,{}) for w in ['strong','solve','powerful']}
 (ROOT/'reports/site/gloss_links_audit.json').write_text(json.dumps({'coverage':counts,'examples':report},indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'strong_to_heavy':next((n for n in results.get('strong',{}).get('amod:forward',[]) if n['word']=='heavy'),None),'solve_to_cause':next((n for n in results.get('solve',{}).get('dobj:forward',[]) if n['word']=='cause'),None),'solve_to_have':next((n for n in results.get('solve',{}).get('dobj:forward',[]) if n['word']=='have'),None)}),flush=True)
if __name__=='__main__':main()
