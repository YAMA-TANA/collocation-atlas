import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  candidatesFor,
  defaultSenseFor,
  rankCandidates,
  senseComparison,
  automaticComparison,
  senseOptions,
  partOfSpeech,
  type SemanticEntry,
  type Direction,
} from "./semantics";
import { type Relationship, type Lexeme } from "./data";

export type RegressionData = {
  queries: { word: string; relation: string; direction: Direction }[];
  semantics: Record<string, SemanticEntry>;
  contexts: Record<string, Relationship>;
  lexemes: Record<string, Record<Direction, Lexeme>>;
};
const fixture: RegressionData = JSON.parse(
  readFileSync(
    new URL("./fixtures/general-regression.json", import.meta.url),
    "utf8",
  ),
);
describe("One engine across 141 adjective, verb and noun query settings", () => {
  for (const { word, relation, direction } of fixture.queries)
    it(`${word} / ${relation} / ${direction}: offers attested comparison candidates without unrelated fallback`, () => {
      const data = fixture.semantics[word],
        sense = defaultSenseFor(data, relation, direction);
      const candidates = rankCandidates(
        word,
        data,
        relation,
        direction,
        sense,
      ).filter((c) => c.total > 0);
      expect(candidates.length, word).toBeGreaterThan(0);
      const group = automaticComparison(word, data, relation, direction);
      expect(group[0]).toBe(word);
      expect(group.length).toBeGreaterThan(1);
      expect(group.length).toBeLessThanOrEqual(6);
      const opposite = new Set(
        (data[partOfSpeech(relation, direction)] ?? []).flatMap(
          (s) => s.antonyms,
        ),
      );
      for (const candidate of group.slice(1)) {
        expect(opposite.has(candidate)).toBe(false);
        expect(
          candidatesFor(data, relation, direction).some(
            (c) => c.word === candidate && c.total > 0,
          ),
        ).toBe(true);
      }
    });
});
const cases: [string, string, string, string[]][] = [
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
  ["show", "result", "dobj", ["produce", "reveal", "demonstrate"]],
  ["need", "help", "dobj", ["require", "seek"]],
  ["answer", "question", "dobj", ["ask", "address", "resolve"]],
];
describe("Argument-aware lexical choice across different word families", () => {
  it("retains corpus-supported alternatives across nearby senses for verbs", () => {
    expect(
      automaticComparison(
        "lessen",
        fixture.semantics.lessen,
        "dobj",
        "forward",
      ),
    ).toContain("reduce");
    expect(
      automaticComparison("solve", fixture.semantics.solve, "dobj", "forward"),
    ).toContain("resolve");
  });
  it("does not let broad noun hyponyms crowd out a supported lexical sense", () => {
    const group = automaticComparison(
      "chance",
      fixture.semantics.chance,
      "amod",
      "reverse",
    );
    expect(group).toContain("opportunity");
    expect(group).not.toContain("day");
    expect(
      senseOptions(fixture.semantics.chance, "amod", "reverse").some((s) =>
        s.synonyms.includes("probability"),
      ),
    ).toBe(true);
  });
  for (const [word, expected, relation, direction] of [
    ["big", ["large"], "amod", "forward"],
    ["beautiful", ["lovely", "pretty"], "amod", "forward"],
    ["fast", ["quick", "rapid"], "amod", "forward"],
    ["smart", ["clever", "intelligent"], "amod", "forward"],
    ["rich", ["wealthy", "affluent"], "amod", "forward"],
    ["hard", ["difficult", "tough"], "amod", "forward"],
    ["buy", ["purchase"], "dobj", "forward"],
    ["choose", ["select"], "dobj", "forward"],
    ["help", ["assist"], "dobj", "forward"],
    ["begin", ["start", "commence"], "dobj", "forward"],
    ["finish", ["complete", "end"], "dobj", "forward"],
    ["chance", ["opportunity"], "amod", "reverse"],
    ["mistake", ["error"], "amod", "reverse"],
    ["price", ["cost"], "amod", "reverse"],
  ] as [string, string[], string, Direction][])
    it(`${word}: the initial lexical sense offers an ordinary related word`, () => {
      const data = fixture.semantics[word],
        sense = defaultSenseFor(data, relation, direction),
        group = senseComparison(word, data, relation, direction, sense);
      expect(
        group.some((w) => expected.includes(w)),
        group.join(", "),
      ).toBe(true);
    });
  for (const [word, context, relation, expected] of cases)
    it(`${word} + ${context}: finds ${expected.join(" / ")} from corpus data`, () => {
      const data = fixture.semantics[word],
        distribution = fixture.contexts[`${relation}:${context}`];
      const sense = defaultSenseFor(data, relation, "forward", distribution);
      const candidates = rankCandidates(
        word,
        data,
        relation,
        "forward",
        sense,
        distribution,
      )
        .filter((c) => c.total > 0)
        .slice(0, 5);
      expect(
        candidates.some((c) => expected.includes(c.word)),
        candidates.map((c) => `${c.word}:${c.count}`).join(", "),
      ).toBe(true);
      for (const c of candidates) {
        const row = distribution[1].find((r) => r[0] === c.word);
        expect(c.count).toBe(row?.[1] ?? 0);
        expect(c.documents).toBe(row?.[2] ?? 0);
      }
    });
  it("keeps lexical equivalence separate from shared contexts", () => {
    const lexical = candidatesFor(fixture.semantics.buy, "dobj", "forward");
    expect(lexical.find((c) => c.word === "purchase")?.kind).toBe("synonym");
    const contextual = rankCandidates(
      "answer",
      fixture.semantics.answer,
      "dobj",
      "forward",
      undefined,
      fixture.contexts["dobj:question"],
    );
    expect(contextual.find((c) => c.word === "ask")?.kind).toBe("context");
  });
  it("does not treat common prepositions as noun synonyms", () =>
    expect(partOfSpeech("verb_prep", "reverse")).toBe("none"));
});
