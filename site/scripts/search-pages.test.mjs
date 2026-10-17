import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateData,
  renderWord,
  renderDirectory,
  renderGuide,
  renderLanding,
  sitemap,
  structuredData,
  ORIGIN,
} from "./search-pages.mjs";
const data = JSON.parse(
  readFileSync(new URL("./search-data.json", import.meta.url), "utf8"),
);
describe("crawlable dictionary pages", () => {
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
    const directory = renderDirectory(data);
    const xml = sitemap(data);
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(new Set(urls).size).toBe(data.entries.length + 3);
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
});
