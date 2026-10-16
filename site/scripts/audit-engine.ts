import { readFileSync, writeFileSync } from "node:fs";
import {
  candidatesFor,
  defaultSenseFor,
  senseComparison,
  automaticComparison,
  comparisonCandidates,
  selectCandidates,
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
const targets: [string, string, string, string[]][] = [
  ["strong", "rain", "amod", ["heavy"]],
  ["powerful", "coffee", "amod", ["strong"]],
  ["high", "building", "amod", ["tall"]],
  ["high", "possibility", "amod", ["strong", "real"]],
  ["big", "mistake", "amod", ["serious", "major", "large"]],
  ["fast", "speed", "amod", ["high", "rapid"]],
  ["hard", "problem", "amod", ["difficult", "complex"]],
  ["lessen", "price", "dobj", ["lower", "reduce"]],
  ["lessen", "emission", "dobj", ["reduce", "cut"]],
  ["lessen", "temperature", "dobj", ["lower", "reduce"]],
  ["do", "decision", "dobj", ["make"]],
  ["solve", "problem", "dobj", ["resolve", "address"]],
  ["obtain", "permission", "dobj", ["get", "gain", "receive"]],
  ["buy", "car", "dobj", ["purchase"]],
  ["choose", "option", "dobj", ["select", "pick"]],
  ["begin", "experiment", "dobj", ["start"]],
  ["show", "result", "dobj", ["indicate", "reveal", "demonstrate"]],
  ["need", "help", "dobj", ["require", "seek"]],
  ["answer", "question", "dobj", ["reply", "respond", "address", "resolve"]],
];
const phrases = targets.map(([word, collocate, relation, expected]) => {
  const data = fixture.semantics[word],
    context = fixture.contexts[`${relation}:${collocate}`];
  const { senseId, candidates: ranked } = selectCandidates(
    word,
    data,
    relation,
    "forward",
    context,
  );
  const candidates = comparisonCandidates(ranked);
  return {
    word,
    collocate,
    relation,
    selected_sense: senseId ?? null,
    expected,
    candidate_target_found: candidates.some((c) => expected.includes(c.word)),
    source_target_exists: candidatesFor(data, relation, "forward").some((c) =>
      expected.includes(c.word),
    ),
    candidates: candidates.map(
      ({ word, kind, count, documents, shared, similarity, provenance }) => ({
        word,
        kind,
        count,
        documents,
        shared,
        similarity,
        provenance,
      }),
    ),
  };
});
const quality = {
  target_cases: targets.length,
  recovered: phrases.filter((p) => p.candidate_target_found).length,
  known_source_gaps: phrases
    .filter((p) => !p.source_target_exists)
    .map(({ word, collocate, expected }) => ({ word, collocate, expected })),
  inference_failures_with_source_support: phrases
    .filter((p) => p.source_target_exists && !p.candidate_target_found)
    .map(({ word, collocate, expected }) => ({ word, collocate, expected })),
  interpretation:
    "Learner-target retrieval coverage, not native-naturalness accuracy. Missing source edges are retained as failures; no related-word links are invented to satisfy these targets.",
};
writeFileSync(
  new URL("../../reports/site/synonym_quality.json", import.meta.url),
  JSON.stringify(quality, null, 2) + "\n",
);
const result = {
  schema: 3,
  engine: "source-constrained-synonym-groups",
  quality,
  corpus_words: 102072709,
  query_settings: queries.length,
  settings_with_comparisons: queries.filter((q) => q.comparison.length > 1)
    .length,
  query_results: queries,
  phrase_results: phrases,
  interpretation:
    "Only source synonym/same-sense group membership can create a candidate. Primary WordNet sense anchors align groups but never create edges. Corpus counts and candidate ranking are not naturalness or word-sense judgments. Counts are pooled by lemma; no word-specific candidate rules are used.",
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
