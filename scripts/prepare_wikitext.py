import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.wikitext import prepare
from collocations.engine import ROOT

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--words",type=int,default=10_000_000)
    p.add_argument("--workers",type=int,default=4)
    p.add_argument("--output",type=Path,default=ROOT / "data" / "wikitext_parsed_10m")
    p.add_argument("--reuse",type=Path)
    a=p.parse_args()
    prepare(ROOT / "data" / "wikitext103",a.output,a.words,a.workers,reuse=a.reuse)
