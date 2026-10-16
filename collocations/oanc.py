"""Official open OANC primary texts + original document headers; reparse consistently."""
from concurrent.futures import ProcessPoolExecutor
import gzip
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import quote,urlparse
import xml.etree.ElementTree as ET
import zipfile

from .wikitext import initialize_worker,parse_article,MODEL,MODEL_VERSION

ARCHIVE_URL="https://github.com/nancyide/anc-website/releases/download/datasets-2026-09-25/OANC_GrAF.zip"
ARCHIVE_SHA="5a26559a1becba41a527cb674fff4fb9c4fb70b276f60422c4f07a0ef23fd867"
TERMS_URL="https://anc.org/data/oanc/"
LICENSE="OANC-unrestricted-use-and-redistribution"
NS={"g":"http://www.xces.org/ns/GrAF/1.0/"}


def digest(path):
    h=sha256()
    with Path(path).open("rb") as handle:
        for part in iter(lambda:handle.read(1024*1024),b""):h.update(part)
    return h.hexdigest()


def metadata(header,name):
    header_error=None
    try: root=ET.fromstring(header)
    except ET.ParseError as exc:
        # Retain the licensed text and raw broken header; do not guess its date/author.
        header_error=str(exc)
        root=ET.Element("cesHeader")
    def values(path):
        return [" ".join("".join(e.itertext()).split()) for e in root.findall(path,NS)]
    title=(values("g:fileDesc/g:sourceDesc/g:title") or values("g:fileDesc/g:titleStmt/g:title") or [Path(name).stem])[0]
    date=root.find("g:fileDesc/g:sourceDesc/g:pubDate",NS)
    raw_date=(date.attrib.get("value") or "".join(date.itertext())) if date is not None else ""
    year_match=re.match(r"\s*((?:19|20)\d{2})(?:\D|$)",raw_date)
    original_urls=values("g:fileDesc/g:sourceDesc/g:eAddress")
    places=values("g:fileDesc/g:sourceDesc/g:pubPlace")
    specific=next((u for u in original_urls if u.startswith(("http://","https://")) and urlparse(u).path.strip("/")),None)
    source_url=specific or "https://anc.org/data/oanc/?document="+quote(name,safe="")
    domain=next((urlparse(u).hostname for u in [*original_urls,*places] if u.startswith(("http://","https://"))),None)
    parts=name.split("/")
    if "/spoken/" in name: register="spoken"
    elif "/fiction/" in name: register="fiction"
    elif "/journal/" in name: register="magazine"
    elif "/travel_guides/" in name: register="travel"
    elif "/plos/" in name or "/biomed/" in name: register="academic"
    elif "/technical/" in name: register="technical"
    elif "/letters/" in name: register="letters"
    elif "/leisure/" in name: register="web"
    else: register="unknown"
    authors=values("g:fileDesc/g:sourceDesc/g:author")
    source_key=None
    isbn=next((re.sub(r"[^0-9Xx]","","".join(e.itertext())) for e in root.findall("g:fileDesc/g:sourceDesc/g:idno",NS)
               if e.attrib.get("type","").lower()=="isbn"),None)
    if isbn:
        source_key="isbn:"+isbn.upper()
    elif "/travel_guides/" in name and values("g:fileDesc/g:sourceDesc/g:title"):
        # The release partitions a travel guide into topic files; retain edition
        # collection to avoid merging books across distinct source releases.
        collection=name.split("/travel_guides/",1)[1].split("/",1)[0]
        publishers=values("g:fileDesc/g:sourceDesc/g:publisher")
        if publishers:
            source_key="travel-book:"+sha256(json.dumps([collection,title,publishers,raw_date],ensure_ascii=False).encode()).hexdigest()
    raw_metadata=dict(file=name,original_header=header,original_urls=original_urls,pub_date=raw_date,
        header_parse_error=header_error,
        corpus_variety="American English by OANC design; not independently verified per document",
        country_policy="unknown; corpus label alone is not a speaker dialect annotation",
        parser=MODEL,parser_version=MODEL_VERSION,terms_url=TERMS_URL,
        metadata_version=2,bibliographic_grouping="ISBN or collection/title/publisher for travel guides; otherwise source URL/document",
        conversion="extraction-relevant English spaCy labels; not full UD")
    return dict(source="OANC",register=register,section="/".join(parts[2:-1]),
        year=int(year_match[1]) if year_match else None,country=None,
        author="; ".join(authors) if authors else None,domain=domain,source_url=source_url,
        title=title,text_license=LICENSE,annotation_license=LICENSE,file=name,raw_metadata=raw_metadata,
        source_document_key=source_key)


def parse_oanc(row):
    key,title,paragraphs,words,meta,file_hash=row
    result=parse_article((key,title,paragraphs,words))
    result["id"]="OANC-"+key[:20]
    result["metadata"]=meta
    result["file_hash"]=file_hash
    for i,sent in enumerate(result["sentences"]):sent[0]=result["id"]+"-"+str(i+1)
    return result


def prepare(archive,output,workers=2,shard_size=100):
    archive,output=Path(archive),Path(output)
    if digest(archive)!=ARCHIVE_SHA: raise ValueError("OANC archive hash mismatch")
    output.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        names=sorted(n for n in z.namelist() if n.startswith("OANC-GrAF/data/") and n.endswith(".txt"))
        recipe=dict(source="OANC",archive_url=ARCHIVE_URL,archive_sha256=ARCHIVE_SHA,
             terms_url=TERMS_URL,text_license=LICENSE,format_version=1,
             selected_articles=len(names),selection="all official primary text documents; no target-word selection",
             model=MODEL,model_version=MODEL_VERSION,shard_size=shard_size)
        recipe_path=output / "recipe.json"
        if recipe_path.exists() and json.loads(recipe_path.read_text())!=recipe:
            raise ValueError("Incompatible existing OANC recipe")
        recipe_path.write_text(json.dumps(recipe,indent=2)+"\n",encoding="utf-8")
        shards=[]
        with ProcessPoolExecutor(max_workers=workers,initializer=initialize_worker) as pool:
            for start in range(0,len(names),shard_size):
                path=output / f"parsed-{start//shard_size:05d}.jsonl.gz"
                if not path.exists():
                    tasks=[]
                    for name in names[start:start+shard_size]:
                        raw=z.read(name)
                        text=raw.decode("utf-8-sig")
                        header=z.read(name[:-4]+".anc").decode("utf-8-sig")
                        meta=metadata(header,name)
                        paras=[p.strip() for p in re.split(r"\n\s*\n",text) if p.strip()]
                        key=sha256(name.encode()).hexdigest()
                        tasks.append((key,meta["title"],paras,len(text.split()),meta,sha256(raw).hexdigest()))
                    temp=path.with_suffix(path.suffix+".part")
                    with gzip.open(temp,"wt",encoding="utf-8",compresslevel=3) as handle:
                        for row in pool.map(parse_oanc,tasks,chunksize=1):
                            handle.write(json.dumps(row,ensure_ascii=False,separators=(",",":"))+"\n")
                    temp.replace(path)
                shards.append(dict(file=path.name,sha256=digest(path),articles=min(shard_size,len(names)-start)))
                print(f"parsed OANC {min(start+shard_size,len(names))}/{len(names)} documents",flush=True)
        manifest=dict(**recipe,shards=shards)
        (output / "manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
        return manifest
