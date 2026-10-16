from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
from hashlib import sha256
from pathlib import Path
from urllib.parse import unquote, urldefrag
import duckdb
import pyarrow as pa

from .extract import extract

SCHEMA = """
CREATE TABLE documents (
 document_id VARCHAR PRIMARY KEY, source_document_id VARCHAR, source VARCHAR, register VARCHAR, section VARCHAR,
 year INTEGER, country VARCHAR, author VARCHAR, domain VARCHAR, source_url VARCHAR,
 title VARCHAR, text_license VARCHAR, annotation_license VARCHAR, metadata_json VARCHAR,
 words BIGINT, tokens BIGINT, forms_json VARCHAR, content_hash VARCHAR, file_hash VARCHAR
);
CREATE TABLE occurrences (
 lemma VARCHAR, relation VARCHAR, collocate VARCHAR, document_id VARCHAR,
 sentence_id VARCHAR, head_position INTEGER, collocate_position INTEGER,
 head_form VARCHAR, collocate_form VARCHAR
);
CREATE TABLE lemma_frequency (lemma VARCHAR, pos VARCHAR, count BIGINT);
CREATE TABLE manifest (json VARCHAR);
"""


def bulk_insert(conn, table, rows):
    if not rows:
        return
    columns = [d[0] for d in conn.execute(f"SELECT * FROM {table} LIMIT 0").description]
    arrow = pa.table({k:list(values) for k,values in zip(columns,zip(*rows))})
    conn.register("ingest_batch",arrow)
    try:
        conn.execute(f"INSERT INTO {table} SELECT * FROM ingest_batch")
    finally:
        conn.unregister("ingest_batch")


def build(adapter, db_path: Path, provenance: dict):
    """Build atomically; an interrupted/failed run never replaces a good database."""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    temp = db_path.with_suffix(db_path.suffix + ".building")
    if temp.exists():
        raise FileExistsError(f"Unfinished build exists; inspect before retrying: {temp}")
    conn = duckdb.connect(str(temp))
    conn.execute("SET memory_limit='2GB'")
    conn.execute("SET threads=4")
    conn.execute("SET preserve_insertion_order=false")
    seen, ids, duplicate_docs, counts = set(), set(), [], Counter()
    rows, doc_rows, files, n_docs = [], [], [], 0
    conn.execute(SCHEMA)
    conn.execute("BEGIN TRANSACTION")
    try:
        for document in adapter.documents():
            if document.id in ids:
                raise ValueError(f"Duplicate document ID: {document.id}")
            ids.add(document.id)
            files.append({"document_id": document.id, "file": document.metadata.get("file"),
                          "sha256": document.file_hash, "content_hash": document.content_hash})
            if document.content_hash in seen:
                duplicate_docs.append(document.id)
                continue
            seen.add(document.content_hash)
            meta = document.metadata
            url = meta.get("source_url")
            identity = meta.get("source_document_key") or (unquote(urldefrag(url)[0]) if url else document.id)
            source_document_id = sha256((str(meta.get("source"))+":"+identity).encode()).hexdigest()
            flat = [t for s in document.sentences for t in s.tokens]
            word_count = sum(t.pos not in {"PUNCT", "SYM"} for t in flat)
            forms = [t.form for t in flat]
            doc_rows.append((document.id, source_document_id, *(meta.get(k) for k in (
                "source", "register", "section", "year", "country", "author", "domain",
                "source_url", "title", "text_license", "annotation_license")),
                json.dumps(meta, ensure_ascii=False), word_count, len(flat),
                json.dumps(forms, ensure_ascii=False), document.content_hash, document.file_hash))
            counts.update((t.lemma, t.pos) for t in flat if t.lemma != "_")
            offset = 0
            for sent in document.sentences:
                positions = {t.id: offset + i for i, t in enumerate(sent.tokens)}
                for relation, head, child in extract(sent):
                    rows.append((head.lemma, relation, child.lemma, document.id, sent.id,
                                 positions[head.id], positions[child.id], head.form, child.form))
                offset += len(sent.tokens)
            n_docs += 1
            if n_docs % 100 == 0:
                bulk_insert(conn,"documents",doc_rows)
                bulk_insert(conn,"occurrences",rows)
                rows, doc_rows = [], []
                conn.execute("COMMIT")
                conn.execute("BEGIN TRANSACTION")
                print(f"ingested {n_docs} documents", flush=True)
        if doc_rows:
            bulk_insert(conn,"documents",doc_rows)
        if rows:
            bulk_insert(conn,"occurrences",rows)
        if not n_docs:
            raise ValueError("Empty corpus")
        bulk_insert(conn,"lemma_frequency",[(a,b,c) for (a,b),c in counts.items()])
        conn.execute("COMMIT")
        conn.execute("BEGIN TRANSACTION")
        # External sorting supplies useful zone maps without a memory-heavy ART
        # index over tens of millions of occurrence rows.
        print("sorting occurrences for bounded scans",flush=True)
        conn.execute("CREATE TABLE sorted_occurrences AS SELECT * FROM occurrences ORDER BY relation,lemma,collocate,document_id")
        conn.execute("DROP TABLE occurrences")
        conn.execute("ALTER TABLE sorted_occurrences RENAME TO occurrences")
        conn.execute("COMMIT")
        conn.execute("BEGIN TRANSACTION")
        conn.execute("CREATE TABLE pairs (lemma VARCHAR,relation VARCHAR,collocate VARCHAR,count BIGINT,documents BIGINT)")
        conn.execute("CREATE TABLE pair_strata (lemma VARCHAR,relation VARCHAR,collocate VARCHAR,source VARCHAR,register VARCHAR,year INTEGER,country VARCHAR,count BIGINT)")
        relations=[r[0] for r in conn.execute("SELECT DISTINCT relation FROM occurrences ORDER BY relation").fetchall()]
        for relation in relations:
            print(f"aggregating {relation}",flush=True)
            conn.execute("""INSERT INTO pairs SELECT lemma,relation,collocate,count(*),count(DISTINCT source_document_id)
               FROM occurrences JOIN documents USING(document_id) WHERE relation=? GROUP BY lemma,relation,collocate""",[relation])
            conn.execute("""INSERT INTO pair_strata SELECT lemma,relation,collocate,source,register,year,country,count(*)
               FROM occurrences JOIN documents USING(document_id) WHERE relation=?
               GROUP BY lemma,relation,collocate,source,register,year,country""",[relation])
            conn.execute("COMMIT")
            conn.execute("BEGIN TRANSACTION")
        conn.execute("CREATE TABLE sorted_pairs AS SELECT * FROM pairs ORDER BY relation,lemma,collocate")
        conn.execute("DROP TABLE pairs")
        conn.execute("ALTER TABLE sorted_pairs RENAME TO pairs")
        manifest = dict(provenance, built_at=datetime.now(timezone.utc).isoformat(),
                        schema_version=3, deduplication="exact normalized segment text",
                        storage_policy="sorted occurrence zone maps; relation-wise aggregation; preaggregated scope strata",
                        duplicate_documents_removed=duplicate_docs, files=files,
                        denominator="integer CoNLL-U nodes excluding PUNCT and SYM",
                        dependency_policy="basic UD edges; active dobj separate from passive_patient",
                        document_frequency_policy="explicit bibliographic source key if known; otherwise source + decoded defragmented source_url; fallback segment ID",
                        near_duplicate_removal=False)
        conn.execute("INSERT INTO manifest VALUES (?)", [json.dumps(manifest, ensure_ascii=False)])
        conn.execute("COMMIT")
        conn.execute("CHECKPOINT")
    finally:
        conn.close()
    temp.replace(db_path)
    return manifest


def connect(path):
    if not Path(path).is_file():
        raise FileNotFoundError(f"Build the corpus database first: {path}")
    conn=duckdb.connect(str(path), read_only=True)
    conn.execute("SET memory_limit='2GB'")
    conn.execute("SET threads=4")
    return conn
