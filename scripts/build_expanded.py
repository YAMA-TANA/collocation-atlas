"""Build a new combined corpus atomically; preserve the original pilot database."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.adapters import AmalgumAdapter, AMALGUM_COMMIT, GENRES
from collocations.wikitext import ParsedWikiTextAdapter
from collocations.engine import ROOT
from collocations.store import build


class CombinedAdapter:
    def __init__(self,adapters): self.adapters=adapters
    def documents(self):
        for adapter in self.adapters:
            yield from adapter.documents()


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--parsed",type=Path,default=ROOT / "data" / "wikitext_parsed_10m")
    parser.add_argument("--db",type=Path,default=ROOT / "data" / "collocations_expanded.duckdb")
    parser.add_argument("--oanc",type=Path)
    args=parser.parse_args()
    root=ROOT / "data" / "amalgum"
    actual=subprocess.check_output(["git","-C",str(root),"rev-parse","HEAD"],text=True).strip()
    dirty=subprocess.check_output(["git","-C",str(root),"status","--porcelain","--untracked-files=no"],text=True)
    if actual != AMALGUM_COMMIT or dirty.strip():
        raise SystemExit("AMALGUM input must be the reviewed, unmodified checkout")
    wiki_manifest=json.loads((args.parsed / "manifest.json").read_text(encoding="utf-8"))
    provenance=dict(sources=[dict(source="AMALGUM",commit=actual,genres=list(GENRES)),
                            dict(source="WikiText-103",parse_manifest=wiki_manifest)],
            sampling="WikiText article sample selected without inspecting target verbs/objects",
            annotation_policy="AMALGUM basic UD + extraction-relevant spaCy mappings, identified per source",
            overlap_policy="WikiText excludes reconstructed article URLs already present in pilot DB")
    adapters=[AmalgumAdapter(root),ParsedWikiTextAdapter(args.parsed)]
    if args.oanc:
        oanc_manifest=json.loads((args.oanc / "manifest.json").read_text(encoding="utf-8"))
        adapters.append(ParsedWikiTextAdapter(args.oanc))
        provenance["sources"].append(dict(source="OANC",parse_manifest=oanc_manifest))
    result=build(CombinedAdapter(adapters),args.db,provenance)
    print(json.dumps(dict(database=str(args.db),files=len(result["files"])),ensure_ascii=True),flush=True)
