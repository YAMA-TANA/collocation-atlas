# COLLOCA — English collocations, backed by evidence

[Open the dictionary](https://collocation-atlas.pages.dev/) · [日本語の分析エンジン説明](README_JA.md) · [Website setup](site/README.md)

Search English word partners from **102,072,709 words**, **39,541 original
documents**, and **6,921,544 observed dependency pairs**. Compare synonyms with
interactive frequency bars and a preference heatmap. Inspect counts, document
dispersion, original examples, source licenses, and the limits of the evidence.

Available interfaces: **日本語 / English / 中文 / 한국어 / Español / Français /
Deutsch / Português**. Editorial concept mappings support searches such as
`価格を減らす`, `降价`, `가격을 낮추다`, and `Preis senken`. The corpus being analyzed
is English; arbitrary machine translation is not claimed.

## What is included

- Search every observed pair, from either the governor or the collocate.
- Verb–object, adjective–noun, subject–verb, compounds, adverbs, and prepositions.
- Lemma aggregation, original document frequency, logDice, and normalized
  preference within an explicitly displayed comparison set.
- WordNet senses for 47,029 words, with separate lexical and corpus-context
  suggestions. Choose a sense to rebuild the comparison without mixing senses.
- Automatically discovered distinctive/shared collocates, per-word rate
  normalization, editable comparison columns, and noun comparisons in reverse.
- Selected source-linked examples and detailed evidence for 53 learning entries.
- Source-specific comparisons for the six reduction verbs and seven benchmark nouns.
- Local saved words, shareable search URLs, keyboard search, and mobile layouts.

## What counts mean

**Rare ≠ wrong. Absent ≠ wrong. Grammatical ≠ idiomatic.**

Counts are extracted dependency relations, not exact strings. Frequency alone
does not establish naturalness. The preference score controls for verb base
rates but does not establish semantic interchangeability or grammaticality.
No LLM judgement is used as frequency evidence.

The current benchmark finds `lessen` with risk (11), impact (23), burden (11),
and pain (4). Price, emission and temperature have no active noun-object
observations for `lessen` in this sample, while competing verbs are attested.
The engine retains **insufficient data** for a strong negative judgement on
those three targets because their expected counts remain small.

## Development

```sh
cd site
npm ci
npm run data:download
npm run dev
npm test
npm run build
```

The downloadable corpus aggregates are published as a versioned GitHub release
with a SHA256 checksum. Full corpus documents and the multi-gigabyte local
database are excluded from this repository. See [site/README.md](site/README.md)
for export contracts and Cloudflare deployment.

The Python analysis engine and reproduction instructions are in [README_JA.md](README_JA.md).
Source selection and rights are documented in [docs/CORPUS_RESEARCH.md](docs/CORPUS_RESEARCH.md).
Use the original-source links and license labels when reusing excerpts.
