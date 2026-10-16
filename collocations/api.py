from contextlib import contextmanager
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query

from .engine import Engine, DEFAULT_DB
from .extract import RELATIONS

app=FastAPI(title="Truth Collocations",version="0.1.0",
            description="Corpus evidence with explicit uncertainty. Scores are experimental.")


@contextmanager
def scoped_engine(register=None,country=None,year_from=None,year_to=None,source=None):
    engine=None
    try:
        engine=Engine(Path(os.environ.get("COLLOCATION_DB",str(DEFAULT_DB))),
                      register=register,country=country,year_from=year_from,year_to=year_to,source=source)
        yield engine
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(503,str(exc)) from exc
    finally:
        if engine:
            engine.close()


def check_relation(relation):
    if relation not in RELATIONS:
        raise HTTPException(422,"Unsupported relation")


@app.get("/summary")
def summary(source:str|None=None):
    with scoped_engine(source=source) as engine:
        return engine.summary()


@app.get("/word/{lemma}")
@app.get("/collocations/{lemma}")
def word(lemma:str, relation:str="dobj",limit:int=Query(20,ge=1,le=100),
         register:str|None=None,country:str|None=None,year_from:int|None=None,year_to:int|None=None,source:str|None=None):
    check_relation(relation)
    with scoped_engine(register,country,year_from,year_to,source) as engine:
        return engine.word(lemma,relation,limit)


@app.get("/compare")
def compare(words:str, objects:str|None=None,relation:str="dobj",limit:int=Query(20,ge=1,le=100),
            register:str|None=None,country:str|None=None,year_from:int|None=None,year_to:int|None=None,source:str|None=None):
    check_relation(relation)
    lemmas=[w.strip().lower() for w in words.split(",") if w.strip()]
    objs=[w.strip().lower() for w in objects.split(",") if w.strip()] if objects else None
    if objs and len(objs)>100:
        raise HTTPException(422,"At most 100 object lemmas")
    with scoped_engine(register,country,year_from,year_to,source) as engine:
        return engine.compare(lemmas,objs,relation,limit)


@app.get("/phrase")
def phrase(text:str=Query(max_length=200),register:str|None=None,country:str|None=None,
           year_from:int|None=None,year_to:int|None=None,source:str|None=None):
    with scoped_engine(register,country,year_from,year_to,source) as engine:
        return engine.phrase(text)


@app.get("/objects")
def objects(verb:str,relation:str="dobj",limit:int=Query(30,ge=1,le=100),
            register:str|None=None,country:str|None=None,year_from:int|None=None,year_to:int|None=None,source:str|None=None):
    check_relation(relation)
    with scoped_engine(register,country,year_from,year_to,source) as engine:
        return engine.objects(verb,relation,limit)


@app.get("/gaps")
def gaps(word:str,relation:str="dobj",limit:int=Query(30,ge=1,le=100),source:str|None=None):
    check_relation(relation)
    with scoped_engine(source=source) as engine:
        return engine.gaps(word.lower(),relation,limit)


@app.get("/kwic")
def kwic(lemma:str,collocate:str,relation:str="dobj",limit:int=Query(5,ge=1,le=100),
         window:int=Query(40,ge=1,le=50),source:str|None=None):
    check_relation(relation)
    with scoped_engine(source=source) as engine:
        return engine.kwic(lemma.lower(),collocate.lower(),relation,limit,window)
