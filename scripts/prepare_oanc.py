import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.oanc import prepare
from collocations.engine import ROOT

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--workers",type=int,default=2)
    a=p.parse_args()
    prepare(ROOT / "data" / "oanc" / "OANC_GrAF.zip",ROOT / "data" / "oanc_parsed",a.workers)
