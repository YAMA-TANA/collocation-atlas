"""Download pinned publisher-distributed WikiText raw Parquet, never wiki pages."""
import hashlib
import json
from pathlib import Path
import urllib.request

REVISION="b08601e04326c79dfdd32d625aee71d232d685c3"
FILES={
    "train-00000-of-00002.parquet":"74da360f23826045b3e6ac6375411fdb15f003030aa74f2596ed08b857cb9212",
    "train-00001-of-00002.parquet":"ba090ac30dbf5461e8dcbdd1a1b8e6f3cf9c2c756d64f0c1220450acd514f720",
}


def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f,"sha256").hexdigest() if hasattr(hashlib,"file_digest") else hashlib.sha256(f.read()).hexdigest()


def main():
    root=Path(__file__).resolve().parents[1] / "data" / "wikitext103"
    root.mkdir(parents=True,exist_ok=True)
    manifest=dict(dataset="Salesforce/wikitext",revision=REVISION,subset="wikitext-103-raw-v1",
                  split="train",text_license="CC-BY-SA-3.0",files=[])
    card=root / "DATASET_CARD.md"
    if not card.exists():
        urllib.request.urlretrieve(f"https://huggingface.co/datasets/Salesforce/wikitext/raw/{REVISION}/README.md",card)
    manifest["dataset_card"]=dict(file=card.name,sha256=digest(card),license_declaration="CC-BY-SA-3.0 / GFDL")
    for name,expected in FILES.items():
        target=root / name
        url=f"https://huggingface.co/datasets/Salesforce/wikitext/resolve/{REVISION}/wikitext-103-raw-v1/{name}"
        if not target.exists():
            print(f"downloading {name}",flush=True)
            temp=target.with_suffix(".download")
            urllib.request.urlretrieve(url,temp)
            if digest(temp) != expected:
                raise ValueError(f"SHA256 mismatch: {name}")
            temp.replace(target)
        actual=digest(target)
        if actual != expected:
            raise ValueError(f"SHA256 mismatch: {name}")
        manifest["files"].append(dict(file=name,sha256=actual,bytes=target.stat().st_size,url=url))
    (root / "download_manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    print(root,flush=True)


if __name__=="__main__": main()
