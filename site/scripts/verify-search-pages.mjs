// Exhaustive directory/shard checks plus deterministic HTTP samples of word
// routes. Exhaustive word HTML/numeric checks run in audit-all-word-pages.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ORIGIN,
  sitemap,
  sitemapFiles,
  wordUrl,
  decodeWordSlug,
} from "./search-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "public/data/search/manifest.json"), "utf8"),
);
const words = JSON.parse(
  await readFile(path.join(root, "public/data/search/words.json"), "utf8"),
);
const data = { ...manifest, words },
  origin = process.env.VERIFY_ORIGIN || ORIGIN;
const samples = new Set(
  [
    "lessen",
    "reduce",
    "lower",
    "high",
    "page",
    "also",
    "during",
    "for",
    "façade",
    "ﬁre",
    "zebra",
    "serendipity",
    "a",
    "all-seeing",
    "d'azur",
    ".",
    "\ufeff",
  ].filter((word) => words.includes(word)),
);
for (let i = 0; i < words.length; i += Math.ceil(words.length / 512))
  samples.add(words[i]);
const paths = [
  "/",
  "/words/",
  "/guide/",
  ...Array.from(
    { length: manifest.directoryPages },
    (_, i) => `/words/_list/${i + 1}/`,
  ),
  ...[...samples].map(wordUrl),
];
async function batches(items, fn, label, parallel = 8) {
  for (let i = 0; i < items.length; i += parallel) {
    await Promise.all(items.slice(i, i + parallel).map(fn));
    if (i % 256 === 0)
      console.log(
        `${label}: ${Math.min(i + parallel, items.length)}/${items.length}`,
      );
  }
}
const checks = [];
await batches(
  paths,
  async (pathname) => {
    const r = await fetch(origin + pathname);
    assert.equal(r.status, 200, pathname);
    assert.match(r.headers.get("content-type") || "", /text\/html/);
    if (origin === ORIGIN)
      assert.doesNotMatch(r.headers.get("x-robots-tag") || "", /noindex/i);
    const html = await r.text();
    assert.ok(
      html.includes(`rel="canonical" href="${ORIGIN}${pathname}"`),
      `canonical ${pathname}`,
    );
    assert.match(html, /<h1[ >]/);
    for (const [, json] of html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ))
      JSON.parse(json);
    if (samples.has(decodeWordSlug(pathname.split("/")[2] || "")))
      assert.ok(html.includes("<table>") && html.includes("文書数"), pathname);
    checks.push({ pathname, status: r.status, bytes: Buffer.byteLength(html) });
  },
  "HTML",
);
const indexResponse = await fetch(origin + "/sitemap.xml");
const catalogueResponse = await fetch(origin + "/data/search/words.json");
assert.equal(catalogueResponse.status, 200);
assert.deepEqual(
  await catalogueResponse.json(),
  words,
  "Complete published corpus vocabulary",
);
assert.equal(indexResponse.status, 200);
assert.equal(await indexResponse.text(), sitemap(data));
for (const [name, xml] of sitemapFiles(data)) {
  const r = await fetch(`${origin}/${name}`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), xml, name);
}
let checkedShards = 0;
const selectedShards =
  process.env.VERIFY_ALL_SHARDS === "1"
    ? manifest.shards
    : manifest.shards.filter((_, i) => i % 64 === 0);
await batches(
  selectedShards,
  async (shard) => {
    const r = await fetch(`${origin}/data/search/entries/${shard.key}.json`);
    assert.equal(r.status, 200);
    const bytes = new Uint8Array(await r.arrayBuffer());
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      shard.sha256,
      shard.key,
    );
    assert.equal(r.headers.get("x-robots-tag"), "noindex");
    checkedShards++;
  },
  "Corpus shards",
  16,
);
const robots = await (await fetch(origin + "/robots.txt")).text();
assert.ok(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
assert.doesNotMatch(robots, /Disallow:\s*\/(?:data\/)?\s*$/m);
for (const pathname of [
  "/words/thisentrydoesnotexistqwerty/",
  "/words/_list/999999/",
  "/words/%3Cscript%3E/",
])
  assert.equal((await fetch(origin + pathname)).status, 404, pathname);
const alias = await fetch(origin + "/words/HIGH?tracking=1", {
  redirect: "manual",
});
assert.equal(alias.status, 308);
assert.equal(alias.headers.get("location"), origin + "/words/high/");
const head = await fetch(origin + "/words/high/", { method: "HEAD" });
assert.equal(head.status, 200);
assert.equal(await head.text(), "");
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  corpusEntries: words.length,
  autocompleteWords: manifest.autocompleteWords,
  htmlHttpChecks: checks.length,
  wordHttpSamples: samples.size,
  directoryPages: manifest.directoryPages,
  verifiedShards: checkedShards,
  totalShards: manifest.shards.length,
  sitemapParts: sitemapFiles(data).size,
  sitemap: "exact match",
  unknownWord: 404,
  caseNormalization: 308,
  head: 200,
  googleIndexing: "not verified",
  checks: checks.sort((a, b) => a.pathname.localeCompare(b.pathname)),
};
if (process.env.SEARCH_REPORT)
  await writeFile(
    process.env.SEARCH_REPORT,
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(JSON.stringify({ ...report, checks: undefined }));
