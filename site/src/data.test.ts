import { describe, it, expect } from "vitest";
import { interpret, preference, logDice, selection } from "./data";
import { supported, tr } from "./i18n";
describe("Search interpretation without invented evidence", () => {
  it("maps Japanese concept and argument", () =>
    expect(interpret("価格を減らす")).toMatchObject({
      word: "reduce",
      object: "price",
      direction: "forward",
    }));
  it("maps Chinese and Korean concepts", () => {
    expect(interpret("降价")).toMatchObject({ word: "lower", object: "price" });
    expect(interpret("가격을 낮추다")).toMatchObject({
      word: "lower",
      object: "price",
    });
  });
  it("maps inflected English and adjective phrases", () => {
    expect(interpret("reduced emissions")).toMatchObject({
      word: "reduce",
      object: "emission",
    });
    expect(interpret("heavy rain")).toMatchObject({
      word: "heavy",
      object: "rain",
      relation: "amod",
    });
  });
  it("maps Romance-language search examples", () => {
    for (const q of ["reducir precio", "réduire le prix", "reduzir preço"])
      expect(interpret(q)).toMatchObject({ word: "reduce", object: "price" });
  });
  it("supports German argument-before-verb word order", () =>
    expect(interpret("Preis senken")).toMatchObject({
      word: "lower",
      object: "price",
    }));
  it("does not manufacture a translation for unsupported input", () =>
    expect(interpret("未知のことばです").word).toBe("未知のことばです"));
  it("preserves argument direction for noun lookup", () =>
    expect(
      selection(
        {
          word: "price",
          direction: "reverse",
          relation: "dobj",
          forward: {},
          reverse: {},
        },
        ["lower", 62, 50, 1000],
      ),
    ).toEqual({ lemma: "lower", collocate: "price", relation: "dobj" }));
});
describe("Comparable metrics", () => {
  it("normalizes preference against unequal verb base rates", () => {
    expect(preference(10, 100, 100, 1000)).toBeCloseTo(0.5);
    expect(preference(10, 100, 500, 1000)).toBeCloseTo(1 / 6);
  });
  it("distinguishes no evidence from observed zero", () => {
    expect(preference(0, 0, 100, 1000)).toBeNull();
    expect(preference(0, 100, 100, 1000)).toBe(0);
    expect(logDice(0, 100, 100)).toBeNull();
  });
  it("uses the symmetric logDice formula", () =>
    expect(logDice(10, 100, 200)).toBeCloseTo(14 + Math.log2(20 / 300)));
});
describe("Interface localization", () => {
  it("supports eight complete primary interfaces", () => {
    expect(supported).toHaveLength(8);
    for (const l of supported)
      for (const key of [
        "search",
        "zeroHelp",
        "preferenceHelp",
        "mainTitle",
        "error",
        "dobj",
        "about",
        "source",
      ])
        expect(tr(l, key)).not.toBe(key);
  });
});
