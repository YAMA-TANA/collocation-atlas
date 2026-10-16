from scripts.export_synonym_groups import extract_record


def test_only_explicit_synonym_relations_are_imported():
    record = {'word': 'solve', 'lang_code': 'en', 'pos': 'verb', 'senses': [{
        'id': 'test-sense', 'glosses': ['find a solution'],
        'synonyms': [{'word': 'resolve'}], 'related': [{'word': 'cause'}],
        'hypernyms': [{'word': 'do'}], 'hyponyms': [{'word': 'guess'}],
        'antonyms': [{'word': 'complicate'}],
    }]}
    [(word, pos, sense)] = extract_record(record, {'solve', 'resolve'})
    assert word == 'solve' and pos == 'v'
    assert sense['synonyms'] == ['resolve']
    assert sense['similar'] == []
    assert sense['links']['resolve']['url'].endswith('/solve')


def test_polysemous_labels_are_not_flattened():
    record = {'word': 'smart', 'lang_code': 'en', 'pos': 'adj', 'senses': [
        {'id': 'intellect', 'glosses': ['intelligent'], 'synonyms': [{'word': 'clever'}]},
        {'id': 'clothes', 'glosses': ['well dressed'], 'synonyms': [{'word': 'stylish'}]},
    ], 'synonyms': [{'word': 'unscoped'}]}
    groups = extract_record(record, {'smart'})
    assert [g['synonyms'] for _, _, g in groups] == [['clever'], ['stylish']]
    assert not any('unscoped' in g['synonyms'] for _, _, g in groups)


def test_labelled_thesaurus_and_entry_groups_keep_their_source():
    record = {'word': 'beautiful', 'lang_code': 'en', 'pos': 'adj', 'senses': [],
              'synonyms': [{'word': 'pretty', 'sense': 'attractive'},
                           {'word': 'gorgeous', 'source': 'Thesaurus:beautiful'},
                           {'word': 'ancientword', 'sense': 'attractive', 'tags': ['obsolete']}]}
    groups = extract_record(record, {'beautiful'})
    assert len(groups) == 2
    assert groups[0][2]['synonyms'] == ['pretty']
    assert groups[1][2]['links']['gorgeous']['url'].endswith('Thesaurus%3Abeautiful')


def test_inflections_and_archaic_senses_do_not_become_modern_synonyms():
    record = {'word': 'lower', 'lang_code': 'en', 'pos': 'verb', 'senses': [
        {'glosses': ['obsolete sense'], 'tags': ['obsolete'], 'synonyms': [{'word': 'oldword'}]},
        {'glosses': ['inflection'], 'form_of': [{'word': 'low'}], 'synonyms': [{'word': 'low'}]},
    ]}
    assert extract_record(record, {'lower'}) == []
