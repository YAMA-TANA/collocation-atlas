"""Independently check each synonym edge against the original source fields."""
from collections import defaultdict, Counter
from hashlib import sha256
import gzip
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'site/public/data/synonyms'
POS = {'adj': 'a', 'verb': 'v', 'noun': 'n', 'adv': 'r'}


def main():
    entries = {}
    groups = {}
    for path in sorted(OUT.glob('??.json')):
        shard = json.loads(path.read_text(encoding='utf-8'))
        assert 'CC BY-SA 4.0' in shard['license']
        for word, entry in shard['words'].items():
            assert sha256(word.encode()).hexdigest()[:2] == path.stem
            entries[word] = entry
            for pos, senses in entry['synonym_senses'].items():
                for sense in senses:
                    assert not sense.get('related') and not sense.get('similar')
                    assert sense.get('source') in ['Wiktionary', 'WordNet 3.0']
                    if not sense.get('reverse_assertion'):
                        groups[(word, pos, sense['id'])] = sense
    allowed = defaultdict(set)
    definitions = defaultdict(set)
    for line in gzip.open(ROOT / 'data/lexical/kaikki-en-2026-10-03.jsonl.gz', 'rt', encoding='utf-8'):
        record = json.loads(line)
        word = record.get('word'); pos = POS.get(record.get('pos'))
        if word not in entries or not pos or record.get('lang_code') != 'en': continue
        for sense in record.get('senses', []):
            label = ' / '.join(sense.get('glosses', []))
            definitions[(word, pos)].add(label)
            allowed[(word, pos)].update(link['word'] for link in sense.get('synonyms', []))
        for link in record.get('synonyms', []):
            if link.get('sense') or link.get('source', '').startswith('Thesaurus:'):
                allowed[(word, pos)].add(link['word'])
                definitions[(word, pos)].add(link.get('sense') or link['source'])
    original_wn = {}
    for path in (ROOT / 'site/public/data/semantics').glob('??.json'):
        original_wn.update(json.loads(path.read_text(encoding='utf-8'))['words'])
    verified = Counter()
    originals = {s['id']: (word, pos, s) for (word, pos, _), s in groups.items() if s['source'] == 'Wiktionary'}
    for word, entry in entries.items():
        for pos, senses in entry['synonym_senses'].items():
            for sense in senses:
                targets = set(sense['synonyms'])
                assert word not in targets
                if sense['source'] == 'WordNet 3.0':
                    original = next(s for s in original_wn[word][pos] if 'wn:' + s['id'] == sense['id'])
                    assert targets == set(original['synonyms'])
                elif sense.get('reverse_assertion'):
                    original_id, origin = sense['id'].rsplit(':reverse:', 1)
                    original_word, original_pos, original = originals[original_id]
                    assert targets == ({origin} | set(original['synonyms'])) - {word}
                    assert origin == original_word and pos == original_pos and sense['membership'] == 'sense-group'
                    assert word in original['synonyms'] and sense['definition'] == original['definition']
                else:
                    assert targets <= allowed[(word, pos)], (word, targets - allowed[(word, pos)])
                    assert sense['definition'] in definitions[(word, pos)]
                verified[sense['source']] += len(targets)
    manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
    assert len(entries) == manifest['words']
    assert sum(verified.values()) == manifest['synonym_edges']
    report = {'all_edges_verified': True, 'words': len(entries), 'edges_by_source': dict(verified),
              'no_related_or_similar_relations': True, 'no_cross_sense_transitive_closure': True,
              'method': 'Every authored Wiktionary edge/gloss checked against original snapshot synonym fields; projected members checked against that EXACT validated original synonym set, without traversing other senses; WordNet edges checked against exact original synset membership.'}
    package = ROOT / 'data/synonym-site.zip'
    if package.exists():
        digest = sha256(package.read_bytes()).hexdigest()
        assert digest == (ROOT / 'data/synonym-site.sha256').read_text().split()[0]
        with zipfile.ZipFile(package) as z:
            for path in OUT.iterdir():
                if path.is_file(): assert z.read('data/synonyms/' + path.name) == path.read_bytes()
        report['archive_sha256'] = digest
    (ROOT / 'reports/site/synonym_groups_verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__': main()
