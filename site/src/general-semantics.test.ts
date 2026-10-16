import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  candidatesFor,
  defaultSenseFor,
  rankCandidates,
  senseComparison,
  automaticComparison,
  comparisonCandidates,
  selectCandidates,
  sourceGroupFor,
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
  ["powerful", "coffee", "amod", ["strong"]],
  ["high", "building", "amod", ["tall"]],

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
  // PRODUCE a result changes the event; INDICATE belongs to the requested SHOW family.
  ["show", "result", "dobj", ["indicate", "reveal", "demonstrate"]],
  ["need", "help", "dobj", ["require", "seek"]],
  ["answer", "question", "dobj", ["reply", "respond", "address", "resolve"]],
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
      const candidates = comparisonCandidates(
        selectCandidates(word, data, relation, "forward", distribution)
          .candidates,
      );
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
  it("does not promote HAVE or CAUSE just because they frequently take PROBLEM", () => {
    const data = fixture.semantics.solve,
      context = fixture.contexts["dobj:problem"];
    const candidates = comparisonCandidates(
      rankCandidates(
        "solve",
        data,
        "dobj",
        "forward",
        defaultSenseFor(data, "dobj", "forward", context),
        context,
      ),
    );
    expect(candidates.map((c) => c.word)).not.toContain("have");
    expect(candidates.map((c) => c.word)).not.toContain("cause");
    expect(candidates.map((c) => c.word)).not.toContain("develop");
  });
  it("does not substitute a different action using definition overlap alone", () => {
    const data = fixture.semantics.begin,
      context = fixture.contexts["dobj:experiment"];
    const candidates = comparisonCandidates(
      rankCandidates(
        "begin",
        data,
        "dobj",
        "forward",
        defaultSenseFor(data, "dobj", "forward", context),
        context,
      ),
    );
    expect(candidates.map((c) => c.word)).toContain("start");
    expect(candidates.map((c) => c.word)).not.toContain("perform");
    expect(candidates.map((c) => c.word)).not.toContain("complete");
    expect(candidates.map((c) => c.word)).not.toContain("do");
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
    expect(contextual.some((c) => c.word === "ask")).toBe(false);
  });
  it("does not treat common prepositions as noun synonyms", () =>
    expect(partOfSpeech("verb_prep", "reverse")).toBe("none"));
});

describe("Source precision and honest coverage limits", () => {
  it("shows a source group that supports the whole comparison, not a different meaning of one pair", () => {
    const source = sourceGroupFor(
      ["do", "make"],
      fixture.semantics.do,
      "dobj",
      "forward",
    );
    expect(source?.source).toBe("WordNet 3.0");
    expect(source?.definition).not.toMatch(/sex|kill|destroy/i);
    expect(
      sourceGroupFor(
        ["solve", "have", "cause"],
        fixture.semantics.solve,
        "dobj",
        "forward",
      ),
    ).toBeUndefined();
  });
  for (const [word, partner, expected] of [
    ["strong", "rain", "heavy"],
    ["high", "possibility", "strong"],
  ])
    it(`${word} + ${partner}: records an unsupported learner contrast without inventing a synonym edge`, () => {
      expect(
        candidatesFor(fixture.semantics[word], "amod", "forward").some(
          (c) => c.word === expected,
        ),
      ).toBe(false);
      expect(
        fixture.contexts[`amod:${partner}`][1].some(
          (r) => r[0] === expected && r[1] > 0,
        ),
      ).toBe(true);
    });
  for (const { word, relation, direction } of fixture.queries)
    it(`${word}: every automatic candidate has a source sense and only synonym membership`, () => {
      for (const c of candidatesFor(
        fixture.semantics[word],
        relation,
        direction,
      )) {
        expect(c.kind).toBe("synonym");
        expect(c.provenance.length).toBeGreaterThan(0);
        expect(
          c.provenance.every((p) => p.senseId && p.url.startsWith("https://")),
        ).toBe(true);
      }
    });
  it("refuses context-only, hierarchical and definition-overlap alternatives even with huge corpus counts", () => {
    const data: SemanticEntry = {
      v: [
        {
          id: "sense",
          definition: "find an answer",
          synonyms: ["resolve"],
          similar: ["indicate"],
          related: ["cause"],
          antonyms: [],
        },
      ],
      availability: {
        resolve: { "dobj:forward": 100 },
        cause: { "dobj:forward": 999999 },
        indicate: { "dobj:forward": 999999 },
      },
      neighbours: {
        "dobj:forward": [
          { word: "have", similarity: 1, shared: ["problem", "issue", "task"] },
        ],
      },
      gloss_neighbours: {
        "dobj:forward": [
          {
            word: "develop",
            gloss_similarity: 1,
            tokens: ["find", "solution"],
            shared: ["problem", "issue", "task"],
          },
        ],
      },
    };
    expect(
      rankCandidates("solve", data, "dobj", "forward", undefined, [
        1000,
        [
          ["have", 900, 800, 10000],
          ["cause", 800, 700, 999999],
          ["develop", 700, 600, 10000],
          ["resolve", 10, 9, 100],
        ],
      ]).map((c) => c.word),
    ).toEqual(["resolve"]);
  });
  it("abstains when no sourced sense has enough contextual evidence", () => {
    const result = selectCandidates(
      "high",
      fixture.semantics.high,
      "amod",
      "forward",
      fixture.contexts["amod:possibility"],
    );
    expect(result.senseId).toBeUndefined();
    expect(result.candidates).toEqual([]);
  });
  it("does not select a destructive or sexual meaning for DO + DECISION", () => {
    const result = selectCandidates(
      "do",
      fixture.semantics.do,
      "dobj",
      "forward",
      fixture.contexts["dobj:decision"],
    );
    expect(result.candidates.some((c) => c.word === "make")).toBe(true);
    expect(result.candidates.some((c) => c.word === "overturn")).toBe(false);
    expect(
      result.candidates
        .flatMap((c) => c.provenance)
        .some((p) => /sex|kill|destroy/i.test(p.definition)),
    ).toBe(false);
  });
});
