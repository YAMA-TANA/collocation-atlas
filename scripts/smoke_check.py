"""Run API requests against the REAL local research DB and check Parquet parity."""
from pathlib import Path
import json
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from collocations.api import app
from collocations.engine import Engine, ROOT

engine=Engine()
try:
    expected=engine.summary()
    cases=["/summary","/word/lessen","/collocations/lessen",
           "/objects?verb=lessen","/compare?words=lessen,reduce,lower&objects=risk,price",
           "/phrase?text=lessen%20the%20price","/gaps?word=lessen",
           "/kwic?lemma=lessen&collocate=risk",
           "/word/lessen?register=academic","/word/lessen?country=US"]
    from urllib.parse import quote,unquote
    sources={row["source"]:row["words"] for row in expected["sources"]}
    cases.extend("/summary?source="+quote(source,safe="") for source in sources)
    client=TestClient(app)
    results=[]
    for url in cases:
        response=client.get(url)
        response.raise_for_status()
        data=response.json()
        results.append(dict(url=url,status=response.status_code))
        if url=="/summary":
            assert data["words"]==expected["words"]
        elif url.startswith("/summary?source="):
            assert data["words"]==sources[unquote(url.split("=",1)[1])]
        elif url.startswith("/phrase"):
            assert data["grammar"]=="not assessed"
            assert data["evidence"]["count"]==engine.pair("lessen","price")["count"]
        elif url.endswith("country=US"):
            assert data["corpus"]["words"]==0  # This particular adapter does not infer countries.
    parquet=[]
    tables=["documents","occurrences","pairs","lemma_frequency","manifest"]
    if engine.scalar("SELECT count(*) FROM information_schema.tables WHERE table_name='pair_strata'"):
        tables.append("pair_strata")
    for table in tables:
        path=ROOT / "data" / "parquet" / (table+".parquet")
        if not path.exists():
            raise FileNotFoundError("Run cli.py export data/parquet first")
        before=engine.scalar(f"SELECT count(*) FROM {table}")
        after=engine.scalar("SELECT count(*) FROM read_parquet(?)",[str(path)])
        assert before==after
        parquet.append(dict(table=table,rows=before,parity=True))
    result=dict(api=results,parquet=parquet,corpus_words=expected["words"],
                source_documents=expected["documents"],synthetic_data=False)
    (ROOT / "reports" / "smoke_check.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result))
finally:
    engine.close()
