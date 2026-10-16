"""Streaming adapters. Register only datasets whose distribution terms were checked."""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import html
import json
from pathlib import Path
import re
from typing import Iterator, Protocol
from urllib.parse import urlparse

AMALGUM_COMMIT = "a2dbd33e757f75a61d68d22d1a29e840bdffa711"
GENRES = ("academic", "bio", "interview", "news", "voyage")
LICENSES = {"academic": "CC-BY-4.0", "bio": "CC-BY-SA-3.0",
            "interview": "CC-BY-2.5", "news": "CC-BY-2.5", "voyage": "CC-BY-SA-3.0"}


@dataclass(frozen=True)
class Token:
    id: int
    form: str
    lemma: str
    pos: str
    head: int
    relation: str


@dataclass
class Sentence:
    id: str
    tokens: list[Token]


@dataclass
class Document:
    id: str
    metadata: dict
    sentences: list[Sentence]
    content_hash: str
    file_hash: str


class CorpusAdapter(Protocol):
    def documents(self) -> Iterator[Document]: ...


def parse_conllu(text: str) -> list[Sentence]:
    sentences, tokens, sent_id = [], [], ""
    for line in [*text.splitlines(), ""]:
        if line.startswith("# sent_id = "):
            sent_id = line.split(" = ", 1)[1]
        elif line.startswith("#"):
            continue
        elif not line.strip():
            if tokens:
                sentences.append(Sentence(sent_id or str(len(sentences) + 1), tokens))
                tokens, sent_id = [], ""
        else:
            fields = line.split("\t")
            if not fields[0].isdigit():
                continue
            if len(fields) != 10 or not fields[6].isdigit():
                raise ValueError(f"Invalid CoNLL-U row: {line[:100]}")
            tokens.append(Token(int(fields[0]), fields[1], fields[2].lower(), fields[3],
                                int(fields[6]), fields[7]))
    return sentences


def xml_attributes(path: Path) -> dict:
    # Only the root opening tag is needed; body markup need not be well-formed XML.
    with path.open(encoding="utf-8") as handle:
        prefix = handle.read(16000)
    match = re.search(r"<text\b([^>]+)>", prefix)
    if not match:
        raise ValueError(f"No text metadata: {path}")
    return {k: html.unescape(v) for k, v in re.findall(r'([\w]+)="([^"]*)"', match[1])}


class AmalgumAdapter:
    def __init__(self, root: Path, genres=GENRES):
        self.root, self.genres = Path(root), tuple(genres)

    def documents(self):
        for genre in self.genres:
            if genre not in LICENSES:
                raise ValueError(f"Genre not reviewed for this adapter: {genre}")
            paths = sorted((self.root / "amalgum" / genre / "dep").glob("*.conllu"))
            if not paths:
                raise ValueError(f"Missing corpus files for {genre}")
            for path in paths:
                raw = path.read_bytes()
                attrs = xml_attributes(path.parent.parent / "xml" / (path.stem + ".xml"))
                sentences = parse_conllu(raw.decode("utf-8-sig"))
                forms = [t.form.lower() for s in sentences for t in s.tokens]
                created = attrs.get("dateCreated", "")
                year = int(created[:4]) if re.match(r"^\d{4}(?:-|$)", created) else None
                url = attrs.get("sourceURL") or None
                author = attrs.get("author")
                if author and "community" in author.lower():
                    author = None
                meta = dict(source="AMALGUM", register=genre, section=genre, year=year,
                            country=None, author=author, domain=urlparse(url).hostname if url else None,
                            source_url=url, title=attrs.get("title"),
                            text_license=LICENSES[genre], annotation_license="CC-BY-4.0",
                            raw_metadata=attrs, file=str(path.relative_to(self.root)))
                yield Document(path.stem, meta, sentences,
                               sha256(" ".join(forms).encode()).hexdigest(), sha256(raw).hexdigest())


class JsonlConlluAdapter:
    """Explicit licensed local input: one document + CoNLL-U string per JSON line."""
    def __init__(self, path: Path):
        self.path = Path(path)

    def documents(self):
        with self.path.open(encoding="utf-8") as handle:
            for line in handle:
                row = json.loads(line)
                meta = row["metadata"]
                for required in ("source", "text_license", "annotation_license"):
                    if not meta.get(required):
                        raise ValueError(f"Missing required metadata: {required}")
                sents = parse_conllu(row["conllu"])
                norm = " ".join(t.form.lower() for s in sents for t in s.tokens)
                yield Document(row["document_id"], meta, sents, sha256(norm.encode()).hexdigest(),
                               sha256(row["conllu"].encode()).hexdigest())
