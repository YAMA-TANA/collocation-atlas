"""Article-level, selection-independent WikiText parsing with resumable shards."""
from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor,wait,FIRST_COMPLETED
from dataclasses import dataclass
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import quote

import pyarrow.parquet as pq

from .adapters import Document, Sentence, Token
from urllib.parse import unquote

SEED="truth-collocations-wikitext-v1"
MODEL="en_core_web_sm"
MODEL_VERSION="3.8.0"
REVISION="b08601e04326c79dfdd32d625aee71d232d685c3"


@dataclass(frozen=True)
class ArticleRef:
    offset: int
    size: int


def select_article_refs(root,word_budget,excluded_urls=()):
    """Same sample as select_articles, with paragraph bodies held on disk."""
    root=Path(root)
    data_path=root / "article_bodies.jsonl"
    index_path=root / "article_index.json"
    if not index_path.exists():
        entries=[]
        temp=data_path.with_suffix(".writing")
        with temp.open("wb") as handle:
            for title,paras in articles(sorted(root.glob("train-*.parquet"))):
                payload=(json.dumps(paras,ensure_ascii=False,separators=(",",":"))+"\n").encode()
                entries.append(dict(title=title,offset=handle.tell(),size=len(payload),
                                    words=sum(len(p.split()) for p in paras)))
                handle.write(payload)
        temp.replace(data_path)
        h=sha256()
        with data_path.open("rb") as handle:
            for part in iter(lambda:handle.read(1024*1024),b""):h.update(part)
        index=dict(revision=REVISION,data_sha256=h.hexdigest(),entries=entries)
        tmp_index=index_path.with_suffix(".writing")
        tmp_index.write_text(json.dumps(index,separators=(",",":")),encoding="utf-8")
        tmp_index.replace(index_path)
    index=json.loads(index_path.read_text(encoding="utf-8"))
    if index["revision"]!=REVISION: raise ValueError("Article index revision mismatch")
    h=sha256()
    with data_path.open("rb") as handle:
        for part in iter(lambda:handle.read(1024*1024),b""):h.update(part)
    if h.hexdigest()!=index["data_sha256"]: raise ValueError("Article body index hash mismatch")
    seen=set();duplicates=[];excluded=[];candidates=[]
    excluded_urls={unquote(u) for u in excluded_urls}
    for entry in index["entries"]:
        title=entry["title"]
        if title in seen: duplicates.append(title);continue
        seen.add(title)
        if unquote(article_url(title)) in excluded_urls: excluded.append(title);continue
        key=sha256((SEED+":"+title).encode()).hexdigest()
        candidates.append((key,title,ArticleRef(entry["offset"],entry["size"]),entry["words"]))
    candidates.sort(key=lambda row:row[0])
    selected=[];words=0
    for row in candidates:
        selected.append(row);words+=row[3]
        if words>=word_budget: break
    recipe=dict(available_articles=len(candidates),selected_articles=len(selected),
        requested_whitespace_words=word_budget,selected_whitespace_words=words,
        selection="whole articles ordered by SHA256(seed:title), stop at cumulative budget",
        seed=SEED,selection_uses_target_words=False,repeated_titles_removed=duplicates,
        overlapping_origin_articles_excluded=excluded)
    return selected,recipe,data_path


def articles(paths):
    """Keep article context across Parquet shard boundaries; ignore section titles."""
    title,paragraphs=None,[]
    previous_blank=True
    for path in paths:
        for batch in pq.ParquetFile(path).iter_batches(batch_size=8192,columns=["text"]):
            for text in batch.column(0).to_pylist():
                text=text.strip()
                if not text:
                    previous_blank=True
                    continue
                heading=re.fullmatch(r"= ([^=].*?) =",text)
                if heading and previous_blank:
                    if title is not None:
                        yield title,paragraphs
                    title,paragraphs=heading.group(1),[]
                elif re.fullmatch(r"(?:=\s*){2,}.*?(?:\s*=){2,}",text):
                    continue
                elif title is not None:
                    # Reverse the dataset's explicit intra-word punctuation markers.
                    paragraphs.append(text.replace(" @-@ ","-").replace(" @,@ ",",").replace(" @.@ ","."))
                previous_blank=False
    if title is not None:
        yield title,paragraphs


def article_url(title):
    # The published headings are tokenized; mark this URL as reconstructed metadata.
    title=title.replace(" @-@ ","-")
    title=re.sub(r"\(\s+","(",title)
    title=re.sub(r"\s+([),.!?:;])",r"\1",title)
    return "https://en.wikipedia.org/wiki/"+quote(title.replace(" ","_"),safe="()_,-")


def select_articles(root,word_budget,excluded_urls=()):
    seen=set()
    candidates=[]
    duplicate_titles=[]
    excluded=[]
    excluded_urls={unquote(url) for url in excluded_urls}
    for title,paras in articles(sorted(Path(root).glob("train-*.parquet"))):
        if title in seen:
            duplicate_titles.append(title)
            continue
        seen.add(title)
        if unquote(article_url(title)) in excluded_urls:
            excluded.append(title)
            continue
        key=sha256((SEED+":"+title).encode()).hexdigest()
        candidates.append((key,title,paras,sum(len(p.split()) for p in paras)))
    candidates.sort(key=lambda row:row[0])
    selected=[]
    words=0
    for row in candidates:
        selected.append(row)
        words+=row[3]
        if words>=word_budget:
            break
    return selected,dict(available_articles=len(candidates),selected_articles=len(selected),
                         requested_whitespace_words=word_budget,selected_whitespace_words=words,
                         selection="whole articles ordered by SHA256(seed:title), stop at cumulative budget",
                         seed=SEED,selection_uses_target_words=False,
                         repeated_titles_removed=duplicate_titles,overlapping_origin_articles_excluded=excluded)


def initialize_worker():
    os.environ["OMP_NUM_THREADS"]="1"
    os.environ["OPENBLAS_NUM_THREADS"]="1"
    import spacy
    global _NLP
    _NLP=spacy.load(MODEL,disable=["ner"])
    if _NLP.meta["version"] != MODEL_VERSION:
        raise ValueError("Parser version mismatch")


def spacy_sentence(sent,sent_id):
    """Map extraction-relevant spaCy English edges; NOT a complete UD conversion."""
    kept=[t for t in sent if not t.is_space]
    ids={t.i:i+1 for i,t in enumerate(kept)}
    tokens=[]
    mapping={"dobj":"obj","nsubjpass":"nsubj:pass","auxpass":"aux:pass","ROOT":"root"}
    for t in kept:
        head=ids.get(t.head.i,0) if t.head.i != t.i else 0
        relation=mapping.get(t.dep_,t.dep_)
        if t.dep_=="pobj" and t.head.pos_=="ADP" and t.head.dep_ in {"prep","agent"}:
            gov=t.head.head
            head=ids.get(gov.i,0)
            relation="obl" if gov.pos_ in {"VERB","AUX"} else "nmod"
        elif t.pos_=="ADP" and t.dep_ in {"prep","agent"}:
            nominal=next((c for c in t.children if c.dep_=="pobj"),None)
            if nominal is not None:
                head=ids.get(nominal.i,0)
                relation="case"
        tokens.append(Token(ids[t.i],t.text,t.lemma_.lower() or t.text.lower(),t.pos_,head,relation))
    return Sentence(sent_id,tokens)


def parse_article(row):
    key,title,paragraphs,approx_words=row
    sentences=[]
    for parsed in _NLP.pipe(paragraphs,batch_size=64):
        for sent in parsed.sents:
            if any(not t.is_space for t in sent):
                sentences.append(spacy_sentence(sent,f"WT103-{key[:20]}-{len(sentences)+1}"))
    forms=[t.form.lower() for s in sentences for t in s.tokens]
    raw="\n\n".join(paragraphs)
    url=article_url(title)
    meta=dict(source="WikiText-103",register="encyclopedia",section="encyclopedia",
              year=None,country=None,author=None,domain="en.wikipedia.org",source_url=url,
              title=title,text_license="CC-BY-SA-3.0",annotation_license="CC-BY-SA-3.0",
              raw_metadata=dict(dataset_revision=REVISION,split="train",article_title=title,
                  publication_year="unavailable",article_revision_id="unavailable",
                  source_url_reconstructed_from_heading=True,
                  parser=MODEL,parser_version=MODEL_VERSION,
                  conversion="extraction-relevant English spaCy labels; not full UD",
                  whitespace_words=approx_words))
    # Compact token arrays keep on-disk parse caches small.
    return dict(id="WT103-"+key[:20],metadata=meta,
                content_hash=sha256(" ".join(forms).encode()).hexdigest(),
                file_hash=sha256(raw.encode()).hexdigest(),
                sentences=[[s.id,[[t.id,t.form,t.lemma,t.pos,t.head,t.relation] for t in s.tokens]] for s in sentences])


def parse_missing_articles(selected,body_path,output,workers,shard_size):
    """Bound in-flight work, persist completed articles, avoid per-shard barriers."""
    pending_dir=output / "article_cache"
    pending_dir.mkdir(exist_ok=True)
    remaining=[]
    complete=0
    for start in range(0,len(selected),shard_size):
        shard=output / f"parsed-{start//shard_size:05d}.jsonl.gz"
        if shard.exists():
            complete+=min(shard_size,len(selected)-start)
            continue
        for row in selected[start:start+shard_size]:
            if (pending_dir / (row[0]+".json.gz")).exists(): complete+=1
            else: remaining.append(row)
    print(f"reusing {complete}/{len(selected)} parsed articles",flush=True)
    iterator=iter(remaining)
    with body_path.open("rb") as bodies,ProcessPoolExecutor(max_workers=workers,initializer=initialize_worker) as pool:
        futures={}
        def submit_one():
            try: key,title,ref,words=next(iterator)
            except StopIteration: return False
            bodies.seek(ref.offset)
            paras=json.loads(bodies.read(ref.size))
            futures[pool.submit(parse_article,(key,title,paras,words))]=key
            return True
        for _ in range(workers*2):
            if not submit_one():break
        while futures:
            done,_=wait(futures,return_when=FIRST_COMPLETED)
            for future in done:
                key=futures.pop(future)
                row=future.result()
                if row["id"]!="WT103-"+key[:20]:raise ValueError("Parsed article identity mismatch")
                path=pending_dir / (key+".json.gz")
                temp=path.with_suffix(".part")
                payload=(json.dumps(row,ensure_ascii=False,separators=(",",":"))+"\n").encode()
                temp.write_bytes(gzip.compress(payload,compresslevel=3))
                temp.replace(path)
                complete+=1
                if complete%100==0 or complete==len(selected):
                    print(f"parsed {complete}/{len(selected)} articles",flush=True)
                submit_one()
    # Concatenated gzip members are valid gzip streams, read transparently by
    # gzip.open. No repeated JSON parsing/recompression or unbounded buffering.
    for start in range(0,len(selected),shard_size):
        shard=output / f"parsed-{start//shard_size:05d}.jsonl.gz"
        if shard.exists():continue
        temp=shard.with_suffix(shard.suffix+".part")
        with temp.open("wb") as target:
            for key,title,ref,words in selected[start:start+shard_size]:
                source=pending_dir / (key+".json.gz")
                with gzip.open(source,"rt",encoding="utf-8") as handle:
                    cached=json.loads(handle.read())
                if cached["id"]!="WT103-"+key[:20]: raise ValueError("Cached article identity mismatch")
                with source.open("rb") as handle:shutil.copyfileobj(handle,target)
        temp.replace(shard)


class ParsedWikiTextAdapter:
    def __init__(self,path): self.path=Path(path)
    def documents(self):
        manifest=json.loads((self.path / "manifest.json").read_text(encoding="utf-8"))
        for shard in manifest["shards"]:
            path=self.path / shard["file"]
            if sha256(path.read_bytes()).hexdigest()!=shard["sha256"]:
                raise ValueError(f"Parse cache hash mismatch: {path}")
            with gzip.open(path,"rt",encoding="utf-8") as handle:
                for line in handle:
                    row=json.loads(line)
                    meta=row["metadata"]
                    if meta.get("source")=="OANC":
                        # Normalize original bibliographic headers consistently,
                        # including shards parsed before metadata corrections.
                        from .oanc import metadata as oanc_metadata
                        meta=oanc_metadata(meta["raw_metadata"]["original_header"],meta["file"])
                    yield Document(row["id"],meta,
                        [Sentence(i,[Token(*t) for t in tokens]) for i,tokens in row["sentences"]],
                        row["content_hash"],row["file_hash"])


def prepare(root,output,word_budget=10_000_000,workers=4,shard_size=100,reuse=None):
    if word_budget<=0 or workers<1:
        raise ValueError("Word budget and worker count must be positive")
    raw_manifest=json.loads((Path(root) / "download_manifest.json").read_text(encoding="utf-8"))
    if raw_manifest["revision"]!=REVISION:
        raise ValueError("Raw dataset revision mismatch")
    for file in raw_manifest["files"]:
        if sha256((Path(root) / file["file"]).read_bytes()).hexdigest()!=file["sha256"]:
            raise ValueError(f"Raw corpus hash mismatch: {file['file']}")
    output=Path(output)
    output.mkdir(parents=True,exist_ok=True)
    original_db=Path(root).parent / "collocations.duckdb"
    excluded_urls=[]
    if original_db.exists():
        from .store import connect
        conn=connect(original_db)
        try:
            excluded_urls=[r[0] for r in conn.execute("SELECT source_url FROM documents WHERE source='AMALGUM' AND domain='en.wikipedia.org'").fetchall()]
        finally: conn.close()
    selected,selection,body_path=select_article_refs(root,word_budget,excluded_urls)
    recipe=dict(**selection,dataset_revision=REVISION,model=MODEL,model_version=MODEL_VERSION,
                format_version=1,shard_size=shard_size)
    recipe_path=output / "recipe.json"
    if recipe_path.exists() and json.loads(recipe_path.read_text()) != recipe:
        raise ValueError("Existing parse output belongs to a different selection/recipe")
    recipe_path.write_text(json.dumps(recipe,indent=2)+"\n",encoding="utf-8")
    if reuse:
        reuse=Path(reuse)
        reuse_manifest=json.loads((reuse / "manifest.json").read_text(encoding="utf-8"))
        for field in ("dataset_revision","model","model_version","format_version","shard_size","seed",
                      "overlapping_origin_articles_excluded"):
            if reuse_manifest[field] != recipe[field]:
                raise ValueError(f"Cannot reuse incompatible parse cache: {field}")
        for i,shard in enumerate(reuse_manifest["shards"]):
            if shard["articles"]!=shard_size or (i+1)*shard_size>len(selected):
                continue
            source=reuse / shard["file"]
            if sha256(source.read_bytes()).hexdigest()!=shard["sha256"]:
                raise ValueError("Reused cache hash mismatch")
            with gzip.open(source,"rt",encoding="utf-8") as handle:
                actual_ids=[json.loads(line)["id"] for line in handle]
            expected_ids=["WT103-"+r[0][:20] for r in selected[i*shard_size:(i+1)*shard_size]]
            if actual_ids != expected_ids:
                raise ValueError("Reused cache article selection mismatch")
            dest=output / source.name
            if not dest.exists():
                shutil.copyfile(source,dest)
    parse_missing_articles(selected,body_path,output,workers,shard_size)
    shards=[]
    for start in range(0,len(selected),shard_size):
        path=output / f"parsed-{start//shard_size:05d}.jsonl.gz"
        shards.append(dict(file=path.name,sha256=sha256(path.read_bytes()).hexdigest(),
                           articles=min(shard_size,len(selected)-start)))
    manifest=dict(**recipe,shards=shards,raw_download_manifest=raw_manifest)
    (output / "manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    return manifest
