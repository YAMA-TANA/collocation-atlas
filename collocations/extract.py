"""Canonical relation directions are governor -> collocate. No adjacency heuristic."""
from .adapters import Sentence

NOUNS = {"NOUN", "PROPN"}
RELATIONS = ("dobj", "nsubj", "passive_patient", "amod", "compound", "verb_adv",
             "adj_adv", "verb_prep", "adj_prep", "noun_prep")


def extract(sentence: Sentence):
    tokens = {t.id: t for t in sentence.tokens}
    for child in sentence.tokens:
        head = tokens.get(child.head)
        if head is None or head.lemma == "_" or child.lemma == "_":
            continue
        relation = None
        if head.pos == "VERB" and child.pos in NOUNS:
            if child.relation == "obj":
                relation = "dobj"
            elif child.relation == "nsubj":
                relation = "nsubj"
            elif child.relation == "nsubj:pass":
                relation = "passive_patient"
        elif head.pos in NOUNS and child.pos == "ADJ" and child.relation == "amod":
            # Adjective is the search lemma; noun is the collocate.
            yield "amod", child, head
        elif head.pos in NOUNS and child.pos in NOUNS and child.relation == "compound":
            relation = "compound"
        elif head.pos in {"VERB", "ADJ"} and child.pos == "ADV" and child.relation == "advmod":
            relation = "verb_adv" if head.pos == "VERB" else "adj_adv"
        if relation:
            yield relation, head, child
        # A case-marked nominal attached to its governor. This is an observed
        # prepositional relation, not proof the preposition is lexically selected.
        if child.relation.split(":")[0] in {"obl", "nmod"}:
            kind = {"VERB": "verb_prep", "ADJ": "adj_prep", "NOUN": "noun_prep",
                    "PROPN": "noun_prep"}.get(head.pos)
            if kind:
                for case in sentence.tokens:
                    if case.head == child.id and case.relation == "case" and case.pos == "ADP":
                        yield kind, head, case
