"""Freeze corpus-derived regression inputs across many words, not hand-made scores."""
from hashlib import sha256
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'site/public/data'
WORDS={
 'amod:forward': 'high low strong weak big small large little beautiful ugly fast slow quick rapid old new young ancient rich poor smart clever intelligent hard easy difficult simple important significant serious severe heavy light powerful deep shallow wide broad bright dark cheap expensive happy angry hot cold warm cool clear obvious real possible likely',
 'dobj:forward': 'do lessen reduce decrease lower diminish cut increase raise boost enhance improve cause trigger induce affect influence impact solve resolve address tackle obtain acquire gain get make create produce generate prevent avoid avert allow permit enable show indicate demonstrate reveal suggest buy purchase choose select begin start finish complete answer reply use employ help assist change alter ask need require',
 'amod:reverse': 'price cost chance opportunity possibility probability problem issue job work mistake error result outcome risk danger ability capability goal aim idea thought house home car vehicle customer client',
}
CONTEXTS={
 'amod': 'rain coffee possibility influence mistake temperature building probability speed problem task design evidence voice risk',
 'dobj': 'risk price emission temperature decision problem permission car option experiment result information help question',
}
cache={}
def read(word,folder):
 key=sha256(word.encode()).hexdigest()[:2]
 if (folder,key) not in cache:cache[folder,key]=json.loads((DATA/folder/(key+'.json')).read_text(encoding='utf-8'))
 data=cache[folder,key]
 return data.get('words',data).get(word,{})
def main():
 roots=sorted({w for values in WORDS.values() for w in values.split()})
 data={'schema':1,'corpus_words':102072709,'license':(DATA/'semantics/WORDNET-LICENSE.txt').read_text(encoding='utf-8'),
       'queries':[{'word':w,'relation':key.split(':')[0],'direction':key.split(':')[1]} for key,values in WORDS.items() for w in values.split()],
       'semantics':{word:read(word,'semantics') for word in roots},'contexts':{},'lexemes':{}}
 for relation,values in CONTEXTS.items():
  for word in values.split():
   data['contexts'][relation+':'+word]=read(word,'reverse').get(relation,[0,[]])
 for word in roots:
  data['lexemes'][word]={direction:{rel:[total,rows[:100]] for rel,(total,rows) in read(word,folder).items() if rel in ['amod','dobj','nsubj','adj_adv','verb_adv']} for direction,folder in [('forward','lexicon'),('reverse','reverse')]}
 target=ROOT/'site/src/fixtures/general-regression.json'
 target.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 print(f'{len(data["queries"])} query settings, {len(roots)} distinct words, {len(data["contexts"])} full context distributions; {target.stat().st_size:,} bytes')
if __name__=='__main__':main()
