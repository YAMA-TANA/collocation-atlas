// Verify deployed HTML and crawlability over HTTP, without executing client JS.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ORIGIN, sitemap } from "./search-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(
  await readFile(path.join(root, "scripts/search-data.json"), "utf8"),
);
const origin = process.env.VERIFY_ORIGIN || ORIGIN;
const urls = [...sitemap(data).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (m) => new URL(m[1]).pathname,
);
const checks = [];
// Bounded concurrency avoids hammering the public site.
for (let i = 0; i < urls.length; i += 6) {
  await Promise.all(
    urls.slice(i, i + 6).map(async (pathname) => {
      const response = await fetch(origin + pathname);
      assert.equal(response.status, 200, pathname);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
      assert.doesNotMatch(
        response.headers.get("x-robots-tag") || "",
        /noindex/i,
        pathname,
      );
      const html = await response.text();
      assert.ok(
        html.includes(`rel="canonical" href="${ORIGIN}${pathname}"`),
        `canonical ${pathname}`,
      );
      assert.match(html, /<h1[ >]/);
      assert.doesNotMatch(html, /name="robots" content="noindex"/);
      const scripts = [
        ...html.matchAll(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
        ),
      ];
      assert.ok(scripts.length, `structured data ${pathname}`);
      scripts.forEach(([, json]) => JSON.parse(json));
      if (pathname.startsWith("/words/") && pathname !== "/words/") {
        assert.match(html, /<table>/);
        assert.ok(
          html.includes("文書数") &&
            html.includes("完全一致フレーズの検索件数ではありません"),
        );
        assert.ok(html.includes('href="/?q='));
      }
      checks.push({
        pathname,
        status: response.status,
        bytes: Buffer.byteLength(html),
        structuredData: scripts.length,
      });
    }),
  );
}
const robots = await (await fetch(origin + "/robots.txt")).text();
assert.ok(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
assert.doesNotMatch(robots, /Disallow:\s*\/(?:data\/)?\s*$/m);
const liveSitemap = await fetch(origin + "/sitemap.xml");
assert.equal(liveSitemap.status, 200);
assert.equal(await liveSitemap.text(), sitemap(data));
const missing = await fetch(origin + "/words/this-entry-does-not-exist/");
assert.equal(missing.status, 404, "real 404 required");
const aggregate = await fetch(origin + "/data/summary.json");
assert.equal(aggregate.status, 200);
assert.equal(
  aggregate.headers.get("x-robots-tag"),
  "noindex",
  "data may be fetched for rendering but must not be indexed",
);
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  pages: checks.length,
  checks: checks.sort((a, b) => a.pathname.localeCompare(b.pathname)),
  sitemap: "valid",
  robots: "allows rendering resources and announces sitemap",
  missingPage: 404,
  dataIndexing: "noindex",
  googleIndexing: "not verified",
};
if (process.env.SEARCH_REPORT)
  await writeFile(
    process.env.SEARCH_REPORT,
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(
  JSON.stringify({
    origin,
    pages: report.pages,
    sitemap: report.sitemap,
    missingPage: 404,
    dataIndexing: report.dataIndexing,
    googleIndexing: report.googleIndexing,
  }),
);
