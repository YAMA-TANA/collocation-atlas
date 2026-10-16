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
uv run --extra semantics python scripts/export_gloss_links.py
uv run python scripts/export_semantic_regressions.py
uv run python scripts/verify_semantics.py
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
  two-hop `similar_to`, direct hypernym/hyponym links) are labelled as related words, not synonyms.
  Every shard includes the full WordNet 3.0 license. Corpus availability uses the
  existing relation marginals, not WordNet sense-tag counts.
- Definition-neighbour links compare WordNet definitions per sense and POS with
  sublinear TF-IDF and Porter stems; maximum qualifying sense-pair similarity
  >=0.12, >=2 shared definition tokens, >=3 shared corpus contexts (each >=3
  occurrences and >=3 original documents), top32 candidates. These links are
  separately labelled definition similarity, not dictionary synonymy.
- Automatic phrase comparisons exclude words supported only by a shared
  argument. Unfiltered observed partners remain inspectable in the suggestion
  panel. This prevents frequent but semantically different governors (such as
  HAVE/CAUSE with PROBLEM) from crowding out lexical comparisons.

- Context neighbours: discounted PPMI cosine in seven separate spaces: adjective–noun,
  verb–object, verb–subject, noun–adjective, noun–verb, adverb–adjective and
  adverb–verb. There are 18,271 neighbour sets. At least 3 occurrences in 3
  original documents per feature, marginal >=50, >=5 features, top120 weighted
  features, cosine >=0.12 and >=3 shared features. Up to 24 neighbours per space.
  Direct WordNet antonyms are excluded; topical or opposed meanings can remain.
- `/data/semantics/manifest.json` records the source archive, method and coverage.
  Schema 3 also stores lexical-candidate cosine/shared-context evidence, selected
  observed context rows and corpus POS counts. The client requests `?v=3` to
  separate this schema from older browser caches. The semantic release is
  `semantic-engine-2026-10-16-v2`; corpus aggregates remain unchanged.

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

Every word uses the same candidate pipeline. There are no word-specific synonym
or object lists in the engine. Bare queries start with the first supported lexical
sense; corpus context overlap ranks candidates within it. When a verb leaves few
well-supported alternatives, other lexical senses with cosine >=0.12 and >=3
shared contexts can supplement the initial comparison. Alternatives with adequate
corpus coverage but negligible shared context (cosine <0.05) are not prioritised
in automatic comparisons. Explicit sense selection keeps the chosen lexical sense.
Noun taxonomic links remain labelled suggestions and do not fill the initial
synonym comparison. All supported senses are selectable. A supplied collocate also uses actually observed alternatives
from the inverse relation and helps rank sense candidates. Lexical synonyms,
lexically related words and shared-context alternatives have separate labels.
Rare observed lexical candidates remain eligible; context-only suggestions need
3 occurrences in 3 documents. Neither the selection score nor the inferred sense
is a calibrated native-usage or word-sense probability.

Regression inputs freeze 141 different adjective, verb and noun queries and 29
full argument distributions from the actual corpus. Tests cover these query
settings plus targeted phrase comparisons and explicit synonym families.
`site/scripts/audit-engine.ts` records representative groups and candidate evidence;
run it with a TypeScript runner (for example `npx tsx scripts/audit-engine.ts`).
The generated fixture and audit are not included in the browser bundle.

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

Excerpts retain the original document URL and license label. Source rights are
not replaced by this application's code distribution. Article dates, native
speaker identity, and dialect are not inferred from the download date or domain.
