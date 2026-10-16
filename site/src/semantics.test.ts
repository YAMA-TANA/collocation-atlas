import { describe, it, expect, vi, afterEach } from "vitest";
import {
  candidatesFor,
  canonicalPair,
  comparisonGroup,
  discoverObjects,
  partOfSpeech,
  type SemanticEntry,
} from "./semantics";
import { lookup, type Lexeme } from "./data";
import { tr, supported } from "./i18n";
import fixture from "./fixtures/high-regression.json";

const entries = fixture.entries as unknown as Record<string, Lexeme>;
afterEach(() => vi.unstubAllGlobals());
describe("High: senses and learner contrasts with observed corpus counts", () => {
  it("keeps height, degree and pitch candidates separate", () => {
    const data = fixture.semantic as SemanticEntry;
    expect(data.a).toHaveLength(7);
    const height = candidatesFor(data, "amod", "forward", "high.a.02");
    const pitch = candidatesFor(data, "amod", "forward", "high.a.04");
    expect(height.some((c) => c.word === "lofty")).toBe(true);
    expect(height.some((c) => c.word === "shrill")).toBe(false);
    expect(pitch.some((c) => c.word === "shrill")).toBe(true);
    expect(pitch.some((c) => c.word === "lofty")).toBe(false);
  });
  it("does not call shared-context neighbours lexical synonyms or include direct antonyms", () => {
    const all = candidatesFor(
      fixture.semantic as SemanticEntry,
      "amod",
      "forward",
    );
    expect(all.find((c) => c.word === "average")?.kind).toBe("context");
    expect(all.some((c) => c.word === "low")).toBe(false);
  });
  it("reproduces the measured differences without declaring observed variants wrong", () => {
    const count = (w: string, obj: string) =>
      entries[w].amod[1].find((r) => r[0] === obj)?.[1] ?? 0;
    expect([count("high", "building"), count("tall", "building")]).toEqual([
      36, 370,
    ]);
    expect([
      count("high", "temperature"),
      count("tall", "temperature"),
    ]).toEqual([863, 0]);
    expect([
      count("high", "possibility"),
      count("strong", "possibility"),
    ]).toEqual([4, 24]);
  });
  it("discovers distinctive collocates for both columns and truly shared collocates", () => {
    const distinctive = discoverObjects(
      ["high", "tall"],
      entries,
      "amod",
      "distinctive",
      [],
      6,
    );
    expect(distinctive).toContain("building");
    expect(distinctive).toContain("school");
    const shared = discoverObjects(
      ["high", "tall"],
      entries,
      "amod",
      "shared",
      [],
    );
    expect(shared).toContain("building");
    expect(shared).not.toContain("temperature");
    expect(shared).not.toContain("price");
  });
});
describe("General comparisons and evidence safety", () => {
  it("selects corpus-supported noun alternatives in reverse adjective comparisons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ words: { price: fixture.nounSemantic } }),
      })),
    );
    const words = await comparisonGroup("price", "high", "amod", "reverse");
    expect(words.length).toBeGreaterThan(1);
    expect(words).toContain("cost");
    expect(words).not.toContain("damage");
    expect(words).not.toContain("make");
  });
  it("requires document dispersion for automatic discovery but retains explicitly requested rare/zero rows", () => {
    const data: Record<string, Lexeme> = {
      a: {
        amod: [
          1000,
          [
            ["spam", 100, 1, 100],
            ["steady", 30, 25, 100],
          ],
        ],
      },
      b: { amod: [100, [["steady", 10, 8, 100]]] },
    };
    expect(discoverObjects(["a", "b"], data, "amod", "frequent", [])).toEqual([
      "steady",
    ]);
    expect(
      discoverObjects(["a", "b"], data, "amod", "specified", [
        "unattested",
        "spam",
      ]),
    ).toEqual(["unattested", "spam"]);
  });
  it("preserves noun comparison direction when opening evidence", () => {
    expect(partOfSpeech("dobj", "reverse")).toBe("n");
    expect(canonicalPair("price", "lower", "dobj", "reverse")).toEqual({
      lemma: "lower",
      collocate: "price",
      relation: "dobj",
    });
  });
  it("recognizes adjective phrases outside the original hand-written adjective list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes("/lexicon/")
            ? {
                beautiful: { amod: [100, [["day", 10, 9, 100]]] },
                lovely: { amod: [50, []] },
              }
            : {},
      })),
    );
    expect(await lookup("beautiful day")).toMatchObject({
      word: "beautiful",
      object: "day",
      relation: "amod",
    });
    expect(await lookup("lovely coffee")).toMatchObject({
      word: "lovely",
      object: "coffee",
      relation: "amod",
    });
  });
  it("localizes new comparison controls in every supported interface", () => {
    for (const language of supported)
      for (const key of [
        "synonymTitle",
        "sense",
        "contextNote",
        "distinctive",
        "rateHelp",
        "meaningComparisons",
        "compareDirection",
      ])
        expect(tr(language, key)).not.toBe(key);
  });
});
