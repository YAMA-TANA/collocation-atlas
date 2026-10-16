"""Synthetic fixtures verify statistical invariants; they never enter research data."""
import json
import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from collocations.adapters import Document, Sentence, Token, parse_conllu, JsonlConlluAdapter
from collocations.extract import extract
from collocations.store import build
from collocations.engine import Engine
from collocations.statistics import association, wilson, binomial_cdf
from collocations.api import app


def test_nonadjacent_inflection_and_separate_passive():
    text="""# sent_id = test
1\tMeasures\tmeasure\tNOUN\t_\t_\t2\tnsubj\t_\t_
2\tlessened\tlessen\tVERB\t_\t_\t0\troot\t_\t_
3\tconsiderably\tconsiderably\tADV\t_\t_\t2\tadvmod\t_\t_
4\tthe\tthe\tDET\t_\t_\t5\tdet\t_\t_
5\trisks\trisk\tNOUN\t_\t_\t2\tobj\t_\t_

# sent_id = passive
1\tPrices\tprice\tNOUN\t_\t_\t3\tnsubj:pass\t_\t_
2\twere\tbe\tAUX\t_\t_\t3\taux:pass\t_\t_
3\tlowered\tlower\tVERB\t_\t_\t0\troot\t_\t_
"""
    sents=parse_conllu(text)
    edges=[(r,h.lemma,c.lemma) for s in sents for r,h,c in extract(s)]
    assert ("dobj","lessen","risk") in edges
    assert ("passive_patient","lower","price") in edges
    assert ("dobj","lower","price") not in edges
    assert len(sents)==2


def test_multitoken_and_empty_nodes_not_counted():
    text="""1-2\tcan't\t_\t_\t_\t_\t_\t_\t_\t_
1\tca\tcan\tAUX\t_\t_\t3\taux\t_\t_
2\tn't\tnot\tPART\t_\t_\t3\tadvmod\t_\t_
2.1\tghost\tghost\tVERB\t_\t_\t_\t_\t_\t_
3\tcut\tcut\tVERB\t_\t_\t0\troot\t_\t_
"""
    assert len(parse_conllu(text)[0].tokens)==3


def test_metrics_share_relation_universe():
    stats=association(10,100,50,1000)
    assert stats["pmi"]==pytest.approx(1)
    assert stats["mi3"]==pytest.approx(math.log2(200))
    assert stats["log_dice"]==pytest.approx(14+math.log2(20/150))
    assert stats["t_score"]==pytest.approx(5/math.sqrt(10))
    cells=[10,90,40,860]
    expected=[5,95,45,855]
    assert stats["log_likelihood"]==pytest.approx(2*sum(o*math.log(o/e) for o,e in zip(cells,expected)))
    assert association(0,100,50,1000)["pmi"] is None
    with pytest.raises(ValueError):
        association(10,100,50,110)


def test_lower_tail_and_zero_interval():
    assert binomial_cdf(0,100,0.1)==pytest.approx(0.9**100)
    assert binomial_cdf(1,3,0.5)==pytest.approx(0.5)
    assert wilson(0,100)[1] > 0
    assert wilson(0,0)==[0,1]


def fixture_doc(doc_id,verb,obj,count,register="academic",year=2010):
    tokens=[]
    for i in range(count):
        j=i*2
        tokens.extend([Token(j+1,verb,verb,"VERB",0,"root"),
                       Token(j+2,obj,obj,"NOUN",j+1,"obj")])
    tokens.append(Token(len(tokens)+1,doc_id,doc_id,"X",0,"dep"))
    return Document(doc_id,dict(source="SYNTHETIC-TEST-ONLY",register=register,
           section=register,year=year,country=None,author=None,domain="test.invalid",
           text_license="CC0-1.0",annotation_license="CC0-1.0"),
           [Sentence(doc_id,tokens)],doc_id,doc_id)


class FixtureAdapter:
    def __init__(self,docs): self.docs=docs
    def documents(self): yield from self.docs


@pytest.fixture(scope="module")
def database(tmp_path_factory):
    path=tmp_path_factory.mktemp("db") / "test.duckdb"
    docs=[]
    for i in range(20): docs.append(fixture_doc(f"lr{i}","lessen","risk",5))
    for i in range(60): docs.append(fixture_doc(f"lp{i}","lower","price",10))
    for i in range(30): docs.append(fixture_doc(f"rr{i}","reduce","risk",10))
    docs.append(fixture_doc("concentrated","reduce","burden",100,"news",2025))
    docs.append(docs[0].__class__("duplicate",docs[0].metadata,docs[0].sentences,docs[0].content_hash,"different-file"))
    build(FixtureAdapter(docs),path,{"test_only":True})
    return path


def test_zero_is_not_wrong_and_negative_gate(database):
    engine=Engine(database)
    try:
        unseen=engine.pair("lessen","temperature")
        assert unseen["status"]=="insufficient data"
        assert unseen["naturalness"]["score"] is None
        gap=engine.pair("lessen","price")
        assert gap["status"]=="strongly dispreferred"
        assert gap["negative_evidence"]["supported_strata_expected_count"] > 10
        assert gap["synonym_preference"]["share_ci95"][1] > 0
        assert engine.pair("reduce","burden")["status"]=="rare but attested"
        assert engine.pair("lessen","risk")["status"]=="common"
        assert engine.summary()["documents"]==111
        assert engine.manifest()["duplicate_documents_removed"]==["duplicate"]
    finally: engine.close()


def test_scope_and_kwic_provenance(database):
    engine=Engine(database,register="news")
    try:
        assert engine.pair("lessen","price")["status"]=="insufficient data"
        assert engine.summary()["documents"]==1
        assert engine.pair("reduce","burden")["per_million"]==pytest.approx(100e6/201)
    finally: engine.close()
    engine=Engine(database,country="US")
    try:
        assert engine.summary()["words"]==0
        assert engine.pair("lessen","price")["status"]=="insufficient data"
    finally: engine.close()
    engine=Engine(database)
    try:
        example=engine.kwic("lessen","risk",limit=1)[0]
        assert example["head_form"]=="lessen"
        assert example["document_id"].startswith("lr")
        assert example["text_license"]=="CC0-1.0"
        assert engine.phrase("lessen the price")["grammar"]=="not assessed"
    finally: engine.close()


def test_compare_shares_and_multiple_testing(database):
    engine=Engine(database)
    try:
        result=engine.compare(["lessen","reduce","lower"],["risk","price"])
        for row in result["rows"]:
            assert sum(c["synonym_preference"]["observed_share"] for c in row["cells"].values())==pytest.approx(1)
            for cell in row["cells"].values():
                assert cell["negative_evidence"]["multiple_testing"]["family_size"]==6
        with pytest.raises(ValueError): engine.compare(["lessen"])
    finally: engine.close()


def test_register_confounding_prevents_false_gap(tmp_path):
    # Target verb appears only in academic; price only in news. Pooled absence
    # would look strong, but no supported register predicts target + price.
    docs=[fixture_doc(f"a{i}","lessen","risk",10,"academic") for i in range(20)]
    docs += [fixture_doc(f"n{i}","lower","price",10,"news") for i in range(60)]
    path=tmp_path / "confounded.duckdb"
    build(FixtureAdapter(docs),path,{"test_only":True})
    engine=Engine(path)
    try:
        result=engine.pair("lessen","price")
        assert result["negative_evidence"]["expected_count"] > 10
        assert result["negative_evidence"]["supported_strata_expected_count"]==0
        assert result["status"]=="insufficient data"
    finally: engine.close()


def test_api_endpoints_and_validation(database,monkeypatch):
    monkeypatch.setenv("COLLOCATION_DB",str(database))
    client=TestClient(app)
    for url in ["/summary","/word/lessen?limit=2","/collocations/lessen?limit=2",
                "/objects?verb=lessen","/compare?words=lessen,reduce,lower&objects=risk,price",
                "/phrase?text=lessen%20the%20price","/gaps?word=lessen",
                "/kwic?lemma=lessen&collocate=risk"]:
        response=client.get(url)
        assert response.status_code==200,response.text
    assert client.get("/compare?words=lessen").status_code==422
    assert client.get("/word/lessen?relation=bogus").status_code==422
    assert client.get("/phrase?text=some%20complex%20sentence").status_code==422


def test_jsonl_requires_license(tmp_path):
    path=tmp_path / "data.jsonl"
    path.write_text(json.dumps(dict(document_id="x",metadata={"source":"unknown"},conllu="")))
    with pytest.raises(ValueError,match="text_license"):
        list(JsonlConlluAdapter(path).documents())


def test_source_document_frequency_is_not_segment_frequency(tmp_path):
    docs=[fixture_doc("part1","lessen","risk",3),fixture_doc("part2","lessen","risk",2)]
    for doc in docs:
        doc.metadata["source_url"]="https://example.org/the-original"
    path=tmp_path / "segments.duckdb"
    build(FixtureAdapter(docs),path,{"test_only":True})
    engine=Engine(path)
    try:
        assert engine.summary()["segments"]==2
        assert engine.summary()["documents"]==1
        result=engine.pair("lessen","risk")
        assert result["count"]==5
        assert result["documents"]==1
        assert result["dispersion"]["document_hhi"]==1
        assert len(result["kwic"])==1
        assert result["naturalness"]["score"] is None
    finally: engine.close()


def test_source_filter_and_source_confounding(tmp_path):
    docs=[fixture_doc(f"sa{i}","lessen","risk",10,"academic") for i in range(20)]
    docs += [fixture_doc(f"sb{i}","lower","price",10,"academic") for i in range(60)]
    for d in docs:
        d.metadata["source"]="corpus-A" if d.id.startswith("sa") else "corpus-B"
    path=tmp_path / "sources.duckdb"
    build(FixtureAdapter(docs),path,{"test_only":True})
    engine=Engine(path)
    try:
        assert len(engine.summary()["sources"])==2
        result=engine.pair("lessen","price")
        assert result["negative_evidence"]["expected_count"]>10
        assert result["negative_evidence"]["stratified_expected_count"]==0
        assert result["status"]=="insufficient data"
    finally: engine.close()
    engine=Engine(path,source="corpus-A")
    try:
        assert engine.summary()["documents"]==20
        assert engine.pair("lower","price")["count"]==0
    finally: engine.close()


def test_activation_preserves_previous_documents_and_backup(tmp_path):
    from scripts.activate_expanded import activate,digest
    old=fixture_doc("kept","lessen","risk",5)
    extra=fixture_doc("new","reduce","price",20)
    extra.metadata["source"]="WikiText-103"
    current,candidate,backup=(tmp_path / n for n in ("active.duckdb","candidate.duckdb","backup.duckdb"))
    build(FixtureAdapter([old]),current,{"test_only":True})
    old_hash=digest(current)
    build(FixtureAdapter([old,extra]),candidate,{"test_only":True})
    result=activate(current,candidate,backup)
    assert result["words"]>result["previous_words"]
    assert digest(backup)==old_hash
    assert digest(current)==digest(candidate)


def test_activation_rejects_lost_document(tmp_path):
    from scripts.activate_expanded import activate
    old=fixture_doc("must-keep","lessen","risk",5)
    replacement=fixture_doc("different","reduce","price",100)
    replacement.metadata["source"]="WikiText-103"
    current,candidate=(tmp_path / n for n in ("active.duckdb","candidate.duckdb"))
    build(FixtureAdapter([old]),current,{"test_only":True})
    build(FixtureAdapter([replacement]),candidate,{"test_only":True})
    with pytest.raises(ValueError,match="missing or changed"):
        activate(current,candidate)


def test_bibliographic_original_overrides_separate_chapter_urls(tmp_path):
    docs=[fixture_doc("ch1","lessen","risk",4),fixture_doc("ch2","lessen","risk",6)]
    for i,d in enumerate(docs):
        d.metadata["source_document_key"]="isbn:0195126157"
        d.metadata["source_url"]=f"https://example.org/chapter-{i}"
    path=tmp_path / "book.duckdb"
    build(FixtureAdapter(docs),path,{"test_only":True})
    e=Engine(path)
    try:
        result=e.pair("lessen","risk")
        assert result["count"]==10
        assert result["documents"]==1
        assert result["dispersion"]["document_hhi"]==1
    finally:e.close()


def test_source_group_does_not_impute_chapter_dates(tmp_path):
    first=fixture_doc("dated-chapter","lessen","risk",2,year=2001)
    second=fixture_doc("undated-chapter","lessen","risk",8,year=None)
    for d in [first,second]:d.metadata["source_document_key"]="same-book"
    path=tmp_path / "dated-book.duckdb"
    build(FixtureAdapter([first,second]),path,{"test_only":True})
    e=Engine(path)
    try:
        result=e.pair("lessen","risk")
        assert result["documents"]==1
        assert result["years"]["2001"]["count"]==2
        assert result["years"]["unknown"]["count"]==8
        assert result["recency"]["dated_count"]==2
        assert result["recency"]["unknown_count"]==8
    finally:e.close()
