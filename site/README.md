# COLLOCA — English collocation atlas

An evidence-first dictionary with Japanese, English, Chinese, Korean, Spanish,
French, German, and Portuguese interfaces. It searches **6,921,544 observed
dependency pairs** from **102,072,709 English words** and **39,541 original
documents**. Every aggregate is available in both lookup directions.

## Run

```sh
npm ci
npm run data:download
npm run dev
```

The public data release is generated from the local DuckDB database, not from
invented teaching examples. To reproduce the export with the engine:

```sh
cd ..
uv run python scripts/export_site.py
uv run python scripts/export_site_reverse.py
uv run --extra semantics python -m nltk.downloader -d data/nltk_data wordnet
uv run --extra semantics python scripts/export_semantics.py
uv run python scripts/download_kaikki_synonyms.py
uv run --extra semantics python scripts/export_synonym_groups.py
uv run python scripts/export_semantic_regressions.py
uv run python scripts/verify_semantics.py
uv run python scripts/verify_synonym_groups.py
cd site
npm run build
npm test
```

## Deploy

```sh
npm run build
npm run deploy
```

Cloudflare Pages project: `collocation-atlas`. Production branch: `main`.
Wrangler uses the operator's authenticated account; no credentials are committed.
This is a static application. Searching does not send the query to an LLM or
to an analytics service. Saved words and language preferences stay in the browser.

## Data contracts

- `/data/summary.json`: exact corpus denominators, source and register coverage.
- `/data/lexicon/XX.json`: governor lookup, SHA256(UTF-8 lemma) first two hex digits.
- `/data/reverse/XX.json`: collocate lookup with the same hashing rule.
- Each lemma maps relations to `[marginal, [[partner, count, original_documents,
other_marginal], ...]]`. Counts sum to **34,688,327 extracted dependencies**.
- `/data/details/KEY.json`: engine evidence and selected KWIC for 53 educational
  entries; `KEY = SHA256(lemma + ':' + relation)[:20]`.
- `/data/benchmarks/`: reviewed comparisons for the six reduction verbs and seven
  benchmark nouns, including source-specific denominators and preferences.
- `/data/semantics/XX.json`: 47,029 WordNet entries with 100,151 sense records;
  same-synset synonyms, adjective `similar_to` candidates and broader lexical
  links remain sense-specific. The broader links (`also_see`, `verb_group`,
  two-hop `similar_to`, direct hypernym/hyponym links) are legacy audit metadata;
  they do not enter the active synonym candidate pipeline.
  Every shard includes the full WordNet 3.0 license. Corpus availability uses the
  existing relation marginals, not WordNet sense-tag counts.
- `/data/synonyms/XX.json`: a separately versioned open thesaurus. The pinned
  English Wiktionary/Kaikki 2026-10-03 extraction (2026-09-02 dump) provides
  authored sense/POS synonym lists and labelled Thesaurus sets. Only these
  fields and WordNet SAME-synset members can create candidates. The client no
  longer promotes `related`, `similar_to`, hypernyms, hyponyms, context neighbours
  or definition-overlap links to synonyms.
- Each Wiktionary source sense is a bounded synonym group. Its members may be
  compared within that EXACT original set; these projections retain
  `membership: sense-group`, the original `anchor`, sense ID, definition and URL.
  Groups are never merged by shared words or traversed across senses. This is
  not unrestricted graph transitive closure. Source assertions and group
  membership are independently verified against the original snapshot.
- The synonym subset and adaptations are distributed under CC BY-SA 4.0 with
  Wiktionary contributor and Kaikki/Wiktextract attribution, per-entry source
  links, changes described, and WordNet's original notice. No quoted usage
  examples or translations are imported. See `/data/synonyms/ATTRIBUTION.txt`.
- `synonym-groups-2026-10-16` versions this archive independently of unchanged
  corpus and legacy semantic releases. Each release download verifies SHA256.
  The immutable input SHA256 is pinned in `scripts/download_kaikki_synonyms.py`.

Detailed excerpts are deliberately a subset; every pair count is searchable.
No full document texts are shipped. Forms, determiners and modifiers are pooled
under lemmas: displayed counts are **dependency-pair counts, not exact-string counts**.
Semantic substitutability and grammar are not automatically established.

## Interpretation

Frequency is an observed count. logDice controls for both marginal frequencies.
Preference is `observed_share / (observed_share + baseline_share)` within the
displayed comparison set; 0.5 means agreement with base-frequency expectations.
Neither measure is a calibrated probability of naturalness. Zero means
unobserved in the current sample, not incorrect or impossible.

The rate view reports occurrences per 10,000 instances of the selected relation
for each column word (using source-specific marginals where available). Automatic
row discovery requires at least one cell with 3 occurrences in 3 documents and
8 total occurrences across the comparison. Shared mode requires this support in
every column. Distinctive mode ranks the normalized-rate contrast, weighted by
log support, and alternates representatives of the compared words. Explicit
examples retain all counts including rare and zero observations. This is an
exploration order, not a test of anomalous usage.

Every word uses the same source-constrained synonym pipeline. Meanings stay
separate; selecting a meaning restricts the comparison to its synonym set.
Bare queries select a supported group using relation availability and corpus
context overlap, with a small usage-frequency tie-break. If a verb has fewer
than five alternatives, other source-backed synonyms can supplement it only
with cosine >=0.12 and >=3 shared contexts. No other relation can qualify.
The primary WordNet sense provides alignment anchors only: even a matching
anchor cannot create a candidate without a source synonym/group assertion.
Phrase queries rank source senses by observed argument usage. Selecting a sense
automatically requires at least one alternative in two occurrences and two
documents; this is a retrieval-confidence rule, not a grammaticality test.
All columns in the selected group retain rare and zero cells. A missing source relation is a coverage gap, not permission
to infer a synonym from corpus co-occurrence. Explicit sense selection remains
available. Selection scores are heuristics, not calibrated word-sense or
native-naturalness probabilities. Counts remain pooled by lemma, not sense.

Regression inputs freeze 141 different adjective, verb and noun queries and 29
full argument distributions from the actual corpus. Tests cover these query
settings plus targeted phrase comparisons and explicit synonym families.
`site/scripts/audit-engine.ts` records representative groups and candidate evidence;
run it with a TypeScript runner (for example `npx tsx scripts/audit-engine.ts`).
The generated fixture and audit are not included in the browser bundle.
`reports/site/synonym_quality.json` preserves all 19 learner-retrieval targets:
17 currently recover an expected alternative. STRONG+RAIN → HEAVY and
HIGH+POSSIBILITY → STRONG/REAL remain explicit source-coverage failures; they
are not repaired with related-word guesses. This measure is not naturalness
accuracy. Manual corpus comparisons for these pairs remain available.

Multilingual concept mappings are editorial search aids, never corpus evidence.
Free-form machine translation is not provided. All analyzed text is English.

## Sources and rights

- [AMALGUM](https://gucorpling.org/gum/cite_amalgum.html): annotation CC BY 4.0;
  original texts retain the individual source licenses. See `docs/CORPUS_RESEARCH.md`.
- [WikiText-103](https://huggingface.co/datasets/Salesforce/wikitext): distribution
  identifies CC BY-SA 3.0/GFDL. Eligible raw train articles; fixed revision in manifest.
- [OANC](https://anc.org/data/oanc/): open distribution allowing use and redistribution.
- WikiText/OANC parsed with [spaCy en_core_web_sm 3.8.0](https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0).
- [WordNet 3.0](https://wordnet.princeton.edu/license-and-commercial-use):
  Copyright 2006 by Princeton University. All rights reserved. Full license in
  every semantic shard and `/data/semantics/WORDNET-LICENSE.txt`. Definitions
  remain in English; lexical senses are not tagged in the corpus occurrences.
- [English Wiktionary via Kaikki.org](https://kaikki.org/dictionary/English/index.html):
  contributors' sense-scoped synonym data, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  Extracted by Tatu Ylonen / Wiktextract, 2026-10-03, from the 2026-09-02 dump.
  Filtering and bounded sense-group projections are documented adaptations.

Excerpts retain the original document URL and license label. Source rights are
not replaced by this application's code distribution. Article dates, native
speaker identity, and dialect are not inferred from the download date or domain.
