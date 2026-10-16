"""Activate a validated corpus while retaining an exact pilot backup."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.engine import Engine,ROOT


def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as handle:
        for part in iter(lambda:handle.read(1024*1024),b""): h.update(part)
    return h.hexdigest()


def activate(current,expanded,backup=None):
    current,expanded=Path(current),Path(expanded)
    if digest(current)==digest(expanded):
        return dict(status="already active",active=str(current))
    old,new=Engine(current),Engine(expanded)
    try:
        before,after=old.summary(),new.summary()
        if not after["words"]>before["words"]:
            raise ValueError("Expanded corpus must have more words than the active corpus")
        original=old.rows("SELECT document_id,content_hash,file_hash,words,tokens FROM documents")
        candidate={r["document_id"]:r for r in new.rows("SELECT document_id,content_hash,file_hash,words,tokens FROM documents")}
        for row in original:
            if candidate.get(row["document_id"])!=row:
                raise ValueError(f"Previous document missing or changed: {row['document_id']}")
        if new.scalar("SELECT count(*) FROM documents WHERE source='WikiText-103'")<1:
            raise ValueError("No WikiText documents in candidate database")
    finally:
        old.close();new.close()
    backup=Path(backup) if backup else current.with_name(f"collocations_before_{before['words']}.duckdb")
    if backup.resolve() in {current.resolve(),expanded.resolve()}:
        raise ValueError("Backup must be a separate file")
    if backup.exists():
        if digest(backup)!=digest(current):
            raise FileExistsError("Existing backup differs from active DB")
    else:
        shutil.copy2(current,backup)
    staging=current.with_suffix(".activate")
    if staging.exists(): raise FileExistsError(staging)
    shutil.copy2(expanded,staging)
    if digest(staging)!=digest(expanded): raise ValueError("Activation copy hash mismatch")
    staging.replace(current)
    return dict(active=str(current),previous_backup=str(backup),words=after["words"],previous_words=before["words"])


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--candidate",type=Path,default=ROOT / "data" / "collocations_expanded.duckdb")
    parser.add_argument("--backup",type=Path)
    args=parser.parse_args()
    print(json.dumps(activate(ROOT / "data" / "collocations.duckdb",args.candidate,args.backup)))
