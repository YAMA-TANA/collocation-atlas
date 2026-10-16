import argparse
import json
from pathlib import Path
import sys

from .adapters import AmalgumAdapter, JsonlConlluAdapter, AMALGUM_COMMIT, GENRES
from .engine import Engine, DEFAULT_DB, ROOT
from .extract import RELATIONS
from .store import build


def main(argv=None):
    parser=argparse.ArgumentParser(description="Dependency corpus evidence for lexical choice")
    parser.add_argument("--db",type=Path,default=DEFAULT_DB)
    parser.add_argument("--register")
    parser.add_argument("--source")
    parser.add_argument("--country")
    parser.add_argument("--year-from",type=int)
    parser.add_argument("--year-to",type=int)
    parser.add_argument("--output",type=Path)
    subs=parser.add_subparsers(dest="command",required=True)
    ingest=subs.add_parser("ingest")
    ingest.add_argument("--adapter",choices=["amalgum","jsonl"],default="amalgum")
    ingest.add_argument("--root",type=Path,default=ROOT / "data" / "amalgum")
    ingest.add_argument("--input",type=Path)
    subs.add_parser("summary")
    subs.add_parser("manifest")
    for name in ["word","objects","gaps","kwic"]:
        sub=subs.add_parser(name)
        sub.add_argument("lemma")
        if name=="kwic":
            sub.add_argument("collocate")
        sub.add_argument("--relation",choices=RELATIONS,default="dobj")
        sub.add_argument("--limit",type=int,default=20 if name != "kwic" else 5)
    phrase=subs.add_parser("phrase")
    phrase.add_argument("text")
    compare=subs.add_parser("compare")
    compare.add_argument("words",nargs="+")
    compare.add_argument("--objects",nargs="+")
    compare.add_argument("--relation",choices=RELATIONS,default="dobj")
    compare.add_argument("--limit",type=int,default=20)
    export=subs.add_parser("export")
    export.add_argument("directory",type=Path)
    args=parser.parse_args(argv)
    if args.command=="ingest":
        if args.adapter=="amalgum":
            import subprocess
            actual=subprocess.check_output(["git","-C",str(args.root),"rev-parse","HEAD"],text=True).strip()
            if actual != AMALGUM_COMMIT:
                parser.error(f"Expected reviewed commit {AMALGUM_COMMIT}, found {actual}")
            # Reject edited input; hashes alone cannot certify corpus provenance.
            dirty=subprocess.check_output(["git","-C",str(args.root),"status","--porcelain","--untracked-files=no"],text=True)
            if dirty.strip():
                parser.error("Corpus checkout has modified tracked files")
            adapter=AmalgumAdapter(args.root)
            provenance=dict(source="AMALGUM",commit=actual,genres=list(GENRES),
                            repository="https://github.com/gucorpling/amalgum")
        else:
            if args.input is None:
                parser.error("--input is required for JSONL")
            adapter=JsonlConlluAdapter(args.input)
            provenance=dict(source="local licensed JSONL",path=str(args.input.resolve()))
        manifest=build(adapter,args.db,provenance)
        result={k:v for k,v in manifest.items() if k != "files"}
        result["files"]=len(manifest["files"])
    else:
        engine=Engine(args.db,register=args.register,country=args.country,
                      year_from=args.year_from,year_to=args.year_to,source=args.source)
        try:
            if args.command=="summary":
                result=engine.summary()
            elif args.command=="manifest":
                result=engine.manifest()
            elif args.command=="word":
                result=engine.word(args.lemma,args.relation,args.limit)
            elif args.command=="objects":
                result=engine.objects(args.lemma,args.relation,args.limit)
            elif args.command=="gaps":
                result=engine.gaps(args.lemma,args.relation,args.limit)
            elif args.command=="kwic":
                result=engine.kwic(args.lemma,args.collocate,args.relation,args.limit)
            elif args.command=="phrase":
                result=engine.phrase(args.text)
            elif args.command=="compare":
                result=engine.compare(args.words,args.objects,args.relation,args.limit)
            elif args.command=="export":
                args.directory.mkdir(parents=True,exist_ok=True)
                for table in ["documents","occurrences","pairs","lemma_frequency","manifest"]:
                    # SQL string escaping is separate from shell escaping.
                    target=str((args.directory / (table+".parquet")).resolve()).replace("'","''")
                    group_size=", ROW_GROUP_SIZE 2048" if table=="documents" else ""
                    engine.db.execute(f"COPY {table} TO '{target}' (FORMAT PARQUET, COMPRESSION ZSTD{group_size})")
                if engine.scalar("SELECT count(*) FROM information_schema.tables WHERE table_name='pair_strata'"):
                    target=str((args.directory / "pair_strata.parquet").resolve()).replace("'","''")
                    engine.db.execute(f"COPY pair_strata TO '{target}' (FORMAT PARQUET, COMPRESSION ZSTD)")
                result=dict(exported=str(args.directory.resolve()),scope="entire database")
        finally:
            engine.close()
    text=json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(text+"\n",encoding="utf-8")
        print(str(args.output.resolve()))
    else:
        # Windows terminals may use CP932; do not alter artifact encoding.
        if hasattr(sys.stdout,"reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        print(text)


if __name__=="__main__":
    main()
