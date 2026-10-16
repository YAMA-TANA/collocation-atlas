"""Export explicit, sense/POS scoped synonym links, never related-word closure.

Wiktionary via the pinned Kaikki snapshot + WordNet SAME synset only.
No hypernyms, hyponyms, similar_to, definition overlap or distributional
neighbours can create a synonym link. Corpus statistics only rank or compare
already licensed synonym candidates. No word-specific rules are used.
"""
from collections import Counter, defaultdict
from hashlib import sha256
import gzip
import json
from pathlib import Path
import re
from urllib.parse import quote

import duckdb

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/lexical'
OUT = ROOT / 'site/public/data/synonyms'
POS = {'adj': 'a', 'verb': 'v', 'noun': 'n', 'adv': 'r'}
RESTRICTED = {'obsolete', 'archaic', 'dated', 'historical', 'nonstandard', 'misspelling', 'proscribed', 'offensive', 'derogatory', 'slur'}
USABLE = re.compile(r'[a-z][a-z-]{1,29}').fullmatch


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def extract_record(record, corpus_words):
    """Keep authored synonym fields; do not infer edges from gloss text."""
    word, pos = record.get('word', ''), POS.get(record.get('pos'))
    if record.get('lang_code') != 'en' or pos is None or word not in corpus_words or not USABLE(word):
        return []
    groups = []
    for index, sense in enumerate(record.get('senses', [])):
        tags = sense.get('tags', [])
        if sense.get('form_of') or sense.get('alt_of') or RESTRICTED.intersection(tags):
            continue
        definition = ' / '.join(sense.get('glosses', []))
        if not definition or not sense.get('synonyms'):
            continue
        targets = {}
        for link in sense['synonyms']:
            target = link.get('word', '')
            if target == word or not USABLE(target) or RESTRICTED.intersection(link.get('tags', [])):
                continue
            targets[target] = {'word': target, 'tags': link.get('tags', []),
                               'url': 'https://en.wiktionary.org/wiki/' + quote(link.get('source', word))}
        if targets:
            identity = sense.get('id') or sha256((word + ':' + pos + ':' + definition).encode()).hexdigest()[:20]
            groups.append((word, pos, {'id': 'wikt:' + identity, 'definition': definition,
                'synonyms': sorted(targets), 'similar': [], 'antonyms': sorted({x.get('word') for x in sense.get('antonyms', []) if USABLE(x.get('word', ''))}),
                'source': 'Wiktionary', 'url': 'https://en.wiktionary.org/wiki/' + quote(word) + '#English',
                'tags': tags, 'links': targets}))
    # Preserve explicitly labelled entry-level synonym sets as their OWN senses.
    # Never attach them to every meaning of a polysemous word.
    top_groups = defaultdict(list)
    for link in record.get('synonyms', []):
        label = link.get('sense', '')
        source = link.get('source', '')
        if label or source.startswith('Thesaurus:'):
            top_groups[(label, source if not label else '')].append(link)
    for (label, source), links in top_groups.items():
        synthetic = {'word': word, 'lang_code': 'en', 'pos': record['pos'],
                     'senses': [{'glosses': [label or source], 'synonyms': links}]}
        groups.extend(extract_record(synthetic, corpus_words))
    # Unattached lists without a sense label or a thesaurus set are omitted.
    return groups


def main():
    source = json.loads((DATA / 'kaikki-en-2026-10-03.source.json').read_text())
    archive = DATA / 'kaikki-en-2026-10-03.jsonl.gz'
    actual = sha256(archive.read_bytes()).hexdigest()
    assert actual == source['sha256'] == '6d40e0067718aeb3321db30297761ca803838390627111a29a5426fee4557faf', 'Snapshot checksum mismatch'
    corpus_words = {row[0] for row in json.loads((ROOT / 'site/public/data/index.json').read_text(encoding='utf-8'))}
    groups = defaultdict(lambda: defaultdict(list))
    seen = set()
    records = 0
    for line in gzip.open(archive, 'rt', encoding='utf-8'):
        records += 1
        record = json.loads(line)
        for word, pos, group in extract_record(record, corpus_words):
            if (word, pos, group['id']) not in seen:
                groups[word][pos].append(group)
                seen.add((word, pos, group['id']))
        if records % 250000 == 0:
            print(f'{records:,} records; {len(groups):,} words with explicit Wiktionary synonym groups', flush=True)
    print('Wiktionary parsed', records, 'records,', len(groups), 'heads', flush=True)
    # A dictionary's one sense-scoped synonym set is a bounded lexical cluster.
    # Project that SAME set to its members; never traverse another sense/set or
    # use whole-word transitive closure (which would mix polysemous meanings).
    reverse = []
    for word, parts in list(groups.items()):
        for pos, senses in parts.items():
            for group in senses:
                for target in group['synonyms']:
                    if target in corpus_words:
                        reverse.append((target, pos, word, group))
    for target, pos, word, original in reverse:
        if any(g['id'] == original['id'] + ':reverse:' + word for g in groups[target][pos]):
            continue
        members = sorted(({word} | set(original['synonyms'])) - {target})
        group = {**original, 'id': original['id'] + ':reverse:' + word, 'synonyms': members,
                 'links': {},
                 'reverse_assertion': True, 'membership': 'sense-group', 'anchor': word}
        groups[target][pos].append(group)
    # Princeton WordNet is used conservatively: the members of one synset only.
    for path in sorted((ROOT / 'site/public/data/semantics').glob('??.json')):
        for word, entry in json.loads(path.read_text(encoding='utf-8'))['words'].items():
            for pos in ['a', 'v', 'n', 'r']:
                for sense in entry.get(pos, []):
                    if sense['synonyms']:
                        groups[word][pos].append({**sense, 'id': 'wn:' + sense['id'], 'similar': [], 'related': [],
                            'source': 'WordNet 3.0', 'url': 'https://wordnet.princeton.edu/', 'links': {}})
    roots = set(groups)
    names = roots | {w for parts in groups.values() for senses in parts.values() for s in senses for w in s['synonyms']}
    db = duckdb.connect(str(ROOT / 'data/collocations.duckdb'), read_only=True)
    db.execute("SET memory_limit='2GB'"); db.execute('SET threads=4')
    totals = defaultdict(dict)
    for direction, field in [('forward', 'lemma'), ('reverse', 'collocate')]:
        result = db.execute(f'SELECT {field},relation,sum(count) FROM pairs GROUP BY 1,2')
        while True:
            rows = result.fetchmany(10000)
            if not rows: break
            for word, relation, count in rows:
                if word in names: totals[word][relation + ':' + direction] = count
    pos_counts = defaultdict(dict)
    for word, pos, count in db.execute('SELECT lemma,pos,sum(count) FROM lemma_frequency GROUP BY 1,2').fetchall():
        if word in roots: pos_counts[word][pos] = count
    db.close()
    entries = {}
    for word, parts in sorted(groups.items()):
        alternatives = {w for senses in parts.values() for s in senses for w in s['synonyms']}
        entries[word] = {'synonym_senses': dict(parts), 'availability': {w: totals[w] for w in sorted(alternatives)},
                         'totals': totals[word], 'pos_counts': pos_counts[word]}
    attribution = ('Wiktionary contributors, extracted by Tatu Ylonen / Wiktextract via Kaikki.org. '
        'Derived sense/POS synonym subset, filtering and bounded same-sense group membership by COLLOCA. '
        'CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/ . '
        'Per-sense and per-link source URLs are retained. No quotations or usage examples are included. '
        'WordNet senses retain their Princeton University license in WORDNET-LICENSE.txt.')
    OUT.mkdir(parents=True, exist_ok=True)
    wordnet_license = (ROOT / 'site/public/data/semantics/WORDNET-LICENSE.txt').read_text(encoding='utf-8')
    (OUT / 'ATTRIBUTION.txt').write_text(attribution + '\n\n' + wordnet_license, encoding='utf-8')
    buckets = defaultdict(dict)
    for word, entry in entries.items(): buckets[sha256(word.encode()).hexdigest()[:2]][word] = entry
    for key in [f'{n:02x}' for n in range(256)]:
        save(OUT / (key + '.json'), {'license': attribution, 'words': buckets[key]})
    coverage = Counter(s['source'] for e in entries.values() for ss in e['synonym_senses'].values() for s in ss)
    manifest = {'schema': 1, 'source': source, 'words': len(entries), 'groups_by_source': dict(coverage),
        'synonym_edges': sum(len(s['synonyms']) for e in entries.values() for ss in e['synonym_senses'].values() for s in ss),
        'method': 'WordNet same-synset members and Wiktionary explicitly authored sense.synonyms or labelled thesaurus sets. A member can compare other members of that EXACT original sense set; these projections retain membership=sense-group and anchor/source. No traversal to other senses, whole-word transitive closure, hypernyms, hyponyms, similar_to, distributional or definition-similarity edges. Obsolete/archaic/nonstandard/offensive entries and unattached sense-less lists excluded.',
        'license': attribution, 'processed_records': records, 'max_shard_bytes': max(p.stat().st_size for p in OUT.glob('??.json'))}
    save(OUT / 'manifest.json', manifest)
    examples = {w: {p: [{'id': s['id'], 'definition': s['definition'], 'synonyms': s['synonyms'][:12], 'source': s['source'], 'membership': s.get('membership'), 'anchor': s.get('anchor')} for s in ss[:12]] for p, ss in entries.get(w, {}).get('synonym_senses', {}).items()} for w in ['high','strong','lessen','solve','beautiful','begin','chance']}
    save(ROOT / 'reports/site/synonym_groups_audit.json', {**manifest, 'examples': examples})
    print(json.dumps({k: v for k, v in manifest.items() if k not in ['license', 'method']}, indent=2), flush=True)


if __name__ == '__main__': main()
