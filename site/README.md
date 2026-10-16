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

Multilingual concept mappings are editorial search aids, never corpus evidence.
Free-form machine translation is not provided. All analyzed text is English.

## Sources and rights

- [AMALGUM](https://gucorpling.org/gum/cite_amalgum.html): annotation CC BY 4.0;
  original texts retain the individual source licenses. See `docs/CORPUS_RESEARCH.md`.
- [WikiText-103](https://huggingface.co/datasets/Salesforce/wikitext): distribution
  identifies CC BY-SA 3.0/GFDL. Eligible raw train articles; fixed revision in manifest.
- [OANC](https://anc.org/data/oanc/): open distribution allowing use and redistribution.
- WikiText/OANC parsed with [spaCy en_core_web_sm 3.8.0](https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0).

Excerpts retain the original document URL and license label. Source rights are
not replaced by this application's code distribution. Article dates, native
speaker identity, and dialect are not inferred from the download date or domain.
