"""Finish this finite local expansion after its two parser jobs complete."""
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]


def run(*args):
    print("running: "+" ".join(args),flush=True)
    subprocess.run([sys.executable,*args],cwd=ROOT,check=True)


if __name__=="__main__":
    deadline=time.monotonic()+7200
    caches=[ROOT / "data/wikitext_parsed_full/manifest.json",ROOT / "data/oanc_parsed/manifest.json"]
    logs=[ROOT / "data/parse_wikitext_full.log",ROOT / "data/parse_oanc.log"]
    print("Waiting for complete, validated parser manifests",flush=True)
    while not all(p.is_file() for p in caches):
        if time.monotonic()>deadline:raise TimeoutError("Parser manifests did not become ready")
        for cache,log in zip(caches,logs):
            if not cache.exists() and log.exists() and "Traceback (most recent call last)" in log.read_text(encoding="utf-8",errors="replace"):
                raise RuntimeError(f"Parser failed; inspect {log}")
        time.sleep(5)
    wiki,oanc=(json.loads(p.read_text(encoding="utf-8")) for p in caches)
    if wiki["selected_articles"]!=wiki["available_articles"]:
        raise ValueError("WikiText manifest does not cover the full eligible population")
    if sum(s["articles"] for s in oanc["shards"])!=oanc["selected_articles"]:
        raise ValueError("OANC manifest has incomplete coverage")
    run("scripts/build_expanded.py","--parsed","data/wikitext_parsed_full","--oanc","data/oanc_parsed","--db","data/collocations_full.duckdb")
    run("scripts/report_expansion.py","--db","data/collocations_full.duckdb","--previous-db","data/collocations.duckdb","--output","reports/full_expansion")
    run("scripts/activate_expanded.py","--candidate","data/collocations_full.duckdb")
    run("cli.py","export","data/parquet")
    run("scripts/smoke_check.py")
    print("Full expansion built, reported, activated and verified",flush=True)
