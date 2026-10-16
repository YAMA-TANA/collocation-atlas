import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from collocations.wikitext import articles,select_articles,spacy_sentence,select_article_refs
from collocations.extract import extract


def test_article_boundaries_cross_shards_and_section_headings(tmp_path):
    a=tmp_path / "train-0.parquet"
    b=tmp_path / "train-1.parquet"
    pq.write_table(pa.table({"text":[" = First Article = \n","A paragraph ."," = = Section = = ","more @-@ words ."]}),a)
    pq.write_table(pa.table({"text":["continuation .",""," = Second Article = ","Second body ."]}),b)
    result=list(articles([a,b]))
    assert result==[("First Article",["A paragraph .","more-words .","continuation ."]),
                    ("Second Article",["Second body ."])]
    selection,recipe=select_articles(tmp_path,4)
    again,again_recipe=select_articles(tmp_path,4)
    assert [r[1] for r in selection]==[r[1] for r in again]
    assert recipe==again_recipe
    assert recipe["selection_uses_target_words"] is False


def test_spacy_extraction_mapping():
    spacy=pytest.importorskip("spacy")
    try: nlp=spacy.load("en_core_web_sm",disable=["ner"])
    except OSError: pytest.skip("Install corpus extra for parser test")
    parsed=nlp("Treatment lessened considerably the risk. Prices were lowered. Measures reduce emissions. They worked in cities.")
    relations=[(r,h.lemma,c.lemma) for i,s in enumerate(parsed.sents)
               for r,h,c in extract(spacy_sentence(s,str(i)))]
    assert ("dobj","lessen","risk") in relations
    assert ("passive_patient","lower","price") in relations
    assert ("dobj","reduce","emission") in relations
    assert ("verb_prep","work","in") in relations


def test_duplicate_and_existing_origin_exclusion(tmp_path):
    pq.write_table(pa.table({"text":["= Alpha =","Body one.","","= Alpha =","Repeated.",
                       "","= Beta =","Body two.","","= Gamma =","Body three."]}),tmp_path / "train-0.parquet")
    selected,recipe=select_articles(tmp_path,1000,["https://en.wikipedia.org/wiki/Beta"])
    assert {r[1] for r in selected}=={"Alpha","Gamma"}
    assert recipe["repeated_titles_removed"]==["Alpha"]
    assert recipe["overlapping_origin_articles_excluded"]==["Beta"]
    refs,ref_recipe,bodies=select_article_refs(tmp_path,1000,["https://en.wikipedia.org/wiki/Beta"])
    assert ref_recipe==recipe
    with bodies.open("rb") as handle:
        for (key,title,ref,words),(old_key,old_title,paras,old_words) in zip(refs,selected):
            handle.seek(ref.offset)
            assert json.loads(handle.read(ref.size))==paras
            assert (key,title,words)==(old_key,old_title,old_words)


def test_bounded_parser_cache_and_gzip_members(tmp_path):
    import gzip
    from hashlib import sha256
    pytest.importorskip("en_core_web_sm")
    from collocations.wikitext import parse_missing_articles
    pq.write_table(pa.table({"text":["= Alpha =","People reduce emissions.","",
                                   "= Beta =","Treatment lessens pain."]}),tmp_path / "train-0.parquet")
    selected,recipe,bodies=select_article_refs(tmp_path,1000)
    output=tmp_path / "parsed";output.mkdir()
    parse_missing_articles(selected,bodies,output,workers=1,shard_size=2)
    shard=output / "parsed-00000.jsonl.gz"
    with gzip.open(shard,"rt",encoding="utf-8") as handle:
        rows=[json.loads(line) for line in handle]
    assert [r["id"] for r in rows]==["WT103-"+r[0][:20] for r in selected]
    before=sha256(shard.read_bytes()).hexdigest()
    parse_missing_articles(selected,bodies,output,workers=1,shard_size=2)
    assert sha256(shard.read_bytes()).hexdigest()==before
