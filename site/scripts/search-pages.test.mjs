import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateData,
  renderWord,
  renderDirectory,
  renderGuide,
  renderLanding,
  sitemap,
  sitemapFiles,
  sitemapPaths,
  PAGE_SIZE,
  SITEMAP_SIZE,
  RELATIONS,
  wordUrl,
  decodeWordSlug,
  structuredData,
  ORIGIN,
} from "./search-pages.mjs";
const data = JSON.parse(
  readFileSync(new URL("./search-data.json", import.meta.url), "utf8"),
);
describe("crawlable dictionary pages", () => {
  it("round-trips every corpus spelling without path traversal or URL collisions", () => {
    const words = [
      "a",
      "all-seeing",
      "d'azur",
      ".",
      "..",
      "/",
      "a/b",
      "a?b#c",
      "a%2F",
      "\ufeff",
      "façade",
      "~Lg",
    ];
    const paths = words.map(wordUrl);
    expect(new Set(paths).size).toBe(words.length);
    words.forEach((word, i) => {
      expect(new URL(ORIGIN + paths[i]).pathname).toBe(paths[i]);
      expect(decodeWordSlug(paths[i].split("/")[2])).toBe(word);
    });
  });
  it("publishes supported corpus data with internally consistent counts", () => {
    expect(() => validateData(data)).not.toThrow();
    expect(data.corpus.sources.reduce((sum, s) => sum + s.words, 0)).toBe(
      data.corpus.words,
    );
    const corrupted = structuredClone(data);
    corrupted.entries[0].tables[0].rows[0][2] =
      corrupted.entries[0].tables[0].rows[0][1] + 1;
    expect(() => validateData(corrupted)).toThrow("Invalid evidence");
  });
  it("includes real evidence and functional interactive links in raw HTML", () => {
    const entry = data.entries.find((e) => e.word === "lessen");
    const html = renderWord(entry, data);
    const row = entry.tables[0].rows[0];
    expect(html).toContain(`lessen → ${row[0]}`);
    expect(html).toContain(`<td>${row[1].toLocaleString("ja-JP")}</td>`);
    expect(html).toContain(`<td>${row[2].toLocaleString("ja-JP")}</td>`);
    expect(html).toContain(`href="${ORIGIN}/words/lessen/"`);
    expect(html).toContain('href="/?q=lessen&amp;lang=ja&amp;view=compare"');
    expect(html).toContain("完全一致フレーズの検索件数ではありません");
    expect(html).not.toContain("noindex");
  });
  it("makes every generated entry discoverable without running JavaScript", () => {
    const directory = renderDirectory(data, 1);
    const urls = [...sitemapFiles(data).values()].flatMap((xml) =>
      [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    );
    expect(new Set(urls).size).toBe(data.entries.length + 4);
    for (const { word } of data.entries) {
      expect(directory).toContain(`href="/words/${word}/"`);
      expect(urls).toContain(`${ORIGIN}/words/${word}/`);
    }
    expect(renderLanding(data)).toContain('href="/words/"');
    expect(renderGuide(data)).toContain(
      data.corpus.words.toLocaleString("ja-JP"),
    );
    expect(
      urls.every((url) => !url.includes("?") && !url.includes("/data/")),
    ).toBe(true);
    expect(sitemap(data)).toContain("<sitemapindex");
    expect(renderDirectory(data)).toContain('href="/words/_list/1/"');
  });
  it("escapes corpus tokens and keeps JSON-LD inert", () => {
    const entry = structuredClone(data.entries[0]);
    entry.tables[0].rows[0][0] = '<img src=x onerror="alert(1)">';
    const html = renderWord(entry, data);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    const script = structuredData({
      text: "</script><script>alert(1)</script>",
    });
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    expect(
      JSON.parse(
        script.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""),
      ).text,
    ).toContain("</script>");
  });
  it("paginates the complete vocabulary and splits sitemap files under protocol limits", () => {
    const large = {
      ...data,
      words: Array.from({ length: 100001 }, (_, i) => `word${i}`),
    };
    const paths = sitemapPaths(large),
      files = sitemapFiles(large);
    expect(files.size).toBe(3);
    const found = [];
    for (const xml of files.values()) {
      const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      expect(urls.length).toBeLessThanOrEqual(SITEMAP_SIZE);
      expect(Buffer.byteLength(xml)).toBeLessThan(50 * 1024 * 1024);
      found.push(...urls);
    }
    expect(new Set(found).size).toBe(paths.length);
    const second = renderDirectory(large, 2);
    expect(second).toContain(wordUrl(large.words[PAGE_SIZE]));
    expect(second).not.toContain(wordUrl(large.words[0]));
    expect(second).toContain('rel="prev"');
    expect(second).toContain('rel="next"');
    const last = renderDirectory(
      large,
      Math.ceil(large.words.length / PAGE_SIZE),
    );
    expect(last).toContain(wordUrl(large.words.at(-1)));
    expect(last).not.toContain('rel="next"');
  });
  it("keeps rare observations and supports all relation directions and Unicode words", () => {
    const entry = {
      word: "façade",
      tables: RELATIONS.flatMap((relation) =>
        ["forward", "reverse"].map((direction) => ({
          relation,
          direction,
          total: 1,
          rows: [["café", 1, 1, 1, true]],
        })),
      ),
    };
    expect(() => validateData({ ...data, entries: [entry] })).not.toThrow();
    const html = renderWord(entry, { corpus: data.corpus });
    expect(html).not.toContain("undefined");
    expect(html).toContain('href="/words/caf%C3%A9/"');
    expect(html).toContain("1回・1文書だけの記録も含みます");
    expect(html.match(/<table>/g)).toHaveLength(RELATIONS.length * 2);
  });
});
