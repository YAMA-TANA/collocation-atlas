import { readFileSync, writeFileSync } from "node:fs";
import {
  candidatesFor,
  defaultSenseFor,
  senseComparison,
  automaticComparison,
  rankCandidates,
  senseOptions,
  type SemanticEntry,
  type Direction,
} from "../src/semantics";
import { type Relationship } from "../src/data";
const fixture = JSON.parse(
  readFileSync(
    new URL("../src/fixtures/general-regression.json", import.meta.url),
    "utf8",
  ),
) as {
  queries: { word: string; relation: string; direction: Direction }[];
  semantics: Record<string, SemanticEntry>;
  contexts: Record<string, Relationship>;
};
const queries = fixture.queries.map(({ word, relation, direction }) => {
  const data = fixture.semantics[word],
    sense = defaultSenseFor(data, relation, direction);
  return {
    word,
    relation,
    direction,
    selected_sense: sense,
    available_sense_groups: senseOptions(data, relation, direction).length,
    comparison: automaticComparison(word, data, relation, direction),
    lexical_candidates: candidatesFor(data, relation, direction).filter(
      (c) => c.kind !== "context" && c.total > 0,
    ).length,
  };
});
const phrases = [
  ["strong", "rain", "amod"],
  ["powerful", "coffee", "amod"],
  ["high", "building", "amod"],
  ["big", "mistake", "amod"],
  ["hard", "problem", "amod"],
  ["lessen", "price", "dobj"],
  ["lessen", "emission", "dobj"],
  ["do", "decision", "dobj"],
  ["solve", "problem", "dobj"],
  ["obtain", "permission", "dobj"],
  ["buy", "car", "dobj"],
  ["choose", "option", "dobj"],
  ["begin", "experiment", "dobj"],
].map(([word, collocate, relation]) => {
  const data = fixture.semantics[word],
    context = fixture.contexts[`${relation}:${collocate}`],
    sense = defaultSenseFor(data, relation, "forward", context);
  return {
    word,
    collocate,
    relation,
    selected_sense: sense,
    candidates: rankCandidates(word, data, relation, "forward", sense, context)
      .slice(0, 5)
      .map(({ word, kind, count, documents, shared, similarity }) => ({
        word,
        kind,
        count,
        documents,
        shared,
        similarity,
      })),
  };
});
const result = {
  schema: 2,
  corpus_words: 102072709,
  query_settings: queries.length,
  settings_with_comparisons: queries.filter((q) => q.comparison.length > 1)
    .length,
  query_results: queries,
  phrase_results: phrases,
  interpretation:
    "Comparison candidates are not naturalness judgments. Lexical relations and shared-context alternatives are distinguished. Corpus counts are pooled by lemma, not disambiguated word senses. No word-specific candidate rules are used.",
};
writeFileSync(
  new URL("../../reports/site/general_engine_audit.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      queries: queries.length,
      withComparisons: result.settings_with_comparisons,
      examples: queries.filter((q) =>
        [
          "beautiful",
          "fast",
          "big",
          "smart",
          "buy",
          "choose",
          "begin",
          "problem",
          "chance",
          "price",
        ].includes(q.word),
      ),
    },
    null,
    2,
  ),
);
