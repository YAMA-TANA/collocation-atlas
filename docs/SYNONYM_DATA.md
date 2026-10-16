# Source-constrained synonym groups

The previous engine could fill comparison columns with WordNet related words,
taxonomic neighbours or words sharing corpus contexts. Labelling those words
as related did not solve synonym retrieval. The active engine now requires
an open-dictionary synonym assertion or membership in the exact same source
sense's synonym set. Corpus similarity never creates a candidate edge.

## Reviewed source

[Kaikki's English dictionary](https://kaikki.org/dictionary/English/index.html)
offers the English-only JSONL snapshot extracted by Tatu Ylonen / Wiktextract on
2026-10-03 from the English Wiktionary 2026-09-02 dump. Its downloadable gzip is
523,331,798 bytes. SHA256:
`6d40e0067718aeb3321db30297761ca803838390627111a29a5426fee4557faf`.
The upstream URL is mutable; the downloader fails when its checksum changes.
This postprocessed English-only distribution is marked deprecated upstream;
the reviewed snapshot is pinned and the released derivative is versioned.

[Wiktionary's original text license](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)
allows redistribution under CC BY-SA 4.0. The derived synonym data retains
per-sense/per-link source URLs and attribution to Wiktionary contributors and
Kaikki/Wiktextract, identifies filtering and group projection as adaptations,
and is distributed under CC BY-SA 4.0. Quotations, translations and usage
examples are omitted. Princeton WordNet 3.0 keeps its original license.

Open English WordNet was also reviewed: its maintained releases and CC BY 4.0
are useful for a future migration, but changing versions alone would not fix
mixing related relations with synonymy. The existing pinned WordNet is retained
only for same-synset members and sense-alignment metadata. PPDB 2.0 was considered
as a future paraphrase source; it is not imported in this release.

## Group contract

1. Read authored `sense.synonyms`, sense-labelled entry lists and labelled
   `Thesaurus:*` lists. Keep POS, sense ID, definition, tags and source.
2. Exclude inflections, unattached unlabelled lists and explicitly obsolete,
   archaic, nonstandard or offensive entries. Preserve rare modern words.
3. Treat each original sense set as one bounded group. A member can inspect
   other members of that **same** original set. These projections carry
   `membership: sense-group` plus the original `anchor` and URL. They are not
   individually asserted headword pairs, and the UI identifies the group.
4. Do not traverse from a member into a different sense or merge groups through
   ambiguous word strings. No whole-word transitive closure is performed.
5. Add WordNet members from the **same synset** only. Never admit hypernyms,
   hyponyms, `similar_to`, general related links or definition-overlap links.
6. WordNet's primary-sense anchors and corpus evidence can order these existing
   groups, but cannot admit new words. The inferred sense is a heuristic.
7. Observed pair counts, document counts, normalized rates and comparison scores
   remain the unchanged corpus aggregates. Lexical sources do not supply or
   invent any frequency judgments. Corpus counts are not sense-tagged.

## Validation and limits

`scripts/verify_synonym_groups.py` independently checks each source assertion
against the complete input snapshot and every projected member against the
exact original set. WordNet edges must match original synset membership.
The release archive is checked byte-for-byte and by SHA256.

141 adjective/verb/noun queries are regression inputs. Every candidate must
have a source sense and provenance. Adversarial tests ensure that enormous
counts cannot turn a related, hierarchical or definition-overlap neighbour
into a synonym. Numeric comparisons remain checked against the actual corpus.

The learner-target retrieval audit keeps all 19 previous targets, including
failures: 17 retrieve an expected alternative. STRONG+RAIN→HEAVY and
HIGH+POSSIBILITY→STRONG/REAL lack source support in this release. They remain
coverage failures, not successful retrievals. Manual comparison still shows
their corpus evidence. This audit is not a calibrated naturalness evaluation.
