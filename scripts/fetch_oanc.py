"""Fetch only the official open OANC distribution; verify release digest."""
import json
from pathlib import Path
import sys
import urllib.request
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.oanc import ARCHIVE_URL,ARCHIVE_SHA,TERMS_URL,LICENSE,digest
from collocations.engine import ROOT

if __name__=="__main__":
    root=ROOT / "data" / "oanc"
    root.mkdir(exist_ok=True)
    target=root / "OANC_GrAF.zip"
    if not target.exists():
        temp=target.with_suffix(".download")
        urllib.request.urlretrieve(ARCHIVE_URL,temp)
        if digest(temp)!=ARCHIVE_SHA:raise ValueError("OANC release digest mismatch")
        temp.replace(target)
    if digest(target)!=ARCHIVE_SHA:raise ValueError("OANC release digest mismatch")
    manifest=dict(source="OANC",url=ARCHIVE_URL,sha256=ARCHIVE_SHA,text_license=LICENSE,
                  terms_url=TERMS_URL,release="datasets-2026-09-25",bytes=target.stat().st_size,
                  scope="Open OANC corpus, not the licensed ANC Second Release")
    (root / "download_manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    print(target)
