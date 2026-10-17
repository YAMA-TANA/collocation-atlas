// Exhaustive local audit: every indexed word, source numeric row, HTML response,
// static directory link and sitemap URL. Does not spend 186k Function requests.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  renderWord,
  validateData,
  wordUrl,
  decodeWordSlug,
  sitemapPaths,
  sitemapFiles,
  PAGE_SIZE,
  RELATIONS,
  ORIGIN,
} from "./search-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (name) =>
  JSON.parse(await readFile(path.join(root, "public/data", name), "utf8"));
const [manifest, words] = await Promise.all([
  read("search/manifest.json"),
  read("search/words.json"),
]);
const rawWords = new Set();
for (const direction of ["lexicon", "reverse"])
  for (const name of await readdir(path.join(root, "public/data", direction)))
    for (const word of Object.keys(await read(`${direction}/${name}`)))
      rawWords.add(word);
assert.deepEqual(
  new Set(words),
  rawWords,
  "Must cover every raw corpus key, including hapaxes, compounds and parser spellings",
);
const expected = new Set(words),
  observed = new Set(),
  positions = new Map(words.map((w, i) => [w, i]));
const data = { ...manifest, words },
  metadata = { corpus: manifest.corpus };
let rows = 0,
  htmlBytes = 0,
  rendered = 0;
let prefix = "",
  forward,
  reverse;
for (const shardInfo of manifest.shards) {
  if (prefix !== shardInfo.key.slice(0, 2)) {
    prefix = shardInfo.key.slice(0, 2);
    [forward, reverse] = await Promise.all([
      read(`lexicon/${prefix}.json`),
      read(`reverse/${prefix}.json`),
    ]);
  }
  const bytes = await readFile(
    path.join(root, `public/data/search/entries/${shardInfo.key}.json`),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    shardInfo.sha256,
  );
  assert.equal(bytes.length, shardInfo.bytes);
  const entries = Object.values(JSON.parse(bytes));
  assert.equal(entries.length, shardInfo.entries);
  validateData({
    version: 1,
    updated: manifest.updated,
    corpus: manifest.corpus,
    entries,
  });
  for (const entry of entries) {
    assert.equal(decodeWordSlug(wordUrl(entry.word).split("/")[2]), entry.word);
    assert.equal(
      new URL(ORIGIN + wordUrl(entry.word)).pathname,
      wordUrl(entry.word),
    );
    assert.ok(
      expected.has(entry.word) && !observed.has(entry.word),
      entry.word,
    );
    assert.equal(
      entry.word,
      entry.word.toLowerCase(),
      "canonical lowercase word",
    );
    assert.equal(
      createHash("sha256").update(entry.word).digest("hex").slice(0, 3),
      shardInfo.key,
    );
    assert.equal(
      entry.directoryPage,
      Math.floor(positions.get(entry.word) / PAGE_SIZE) + 1,
    );
    const expectedTables = RELATIONS.flatMap((relation) =>
      [
        ["forward", forward],
        ["reverse", reverse],
      ]
        .filter(
          ([, lexicon]) =>
            Object.hasOwn(lexicon, entry.word) &&
            lexicon[entry.word][relation]?.[1]?.length,
        )
        .map(([direction]) => `${relation}:${direction}`),
    );
    assert.deepEqual(
      entry.tables.map((t) => `${t.relation}:${t.direction}`),
      expectedTables,
    );
    for (const table of entry.tables) {
      const source = (table.direction === "forward" ? forward : reverse)[
        entry.word
      ][table.relation];
      assert.equal(table.total, source[0]);
      assert.deepEqual(
        table.rows.map((r) => r.slice(0, 4)),
        source[1].slice(0, 12),
      );
      for (const row of table.rows) assert.equal(row[4], expected.has(row[0]));
      rows += table.rows.length;
    }
    const html = renderWord(entry, metadata);
    assert.ok(
      html.includes(`rel="canonical" href="${ORIGIN}${wordUrl(entry.word)}"`),
    );
    assert.ok(html.includes("<table>") && !html.includes("<h2>undefined</h2>"));
    for (const [, json] of html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ))
      JSON.parse(json);
    htmlBytes += Buffer.byteLength(html);
    rendered++;
    observed.add(entry.word);
  }
  if (rendered % 20000 < entries.length)
    console.log(`Audited ${rendered}/${words.length} word pages`);
}
assert.deepEqual(observed, expected);
assert.equal(rows, manifest.rows);
const directoryWords = new Set();
for (let page = 1; page <= manifest.directoryPages; page++) {
  const html = await readFile(
    path.join(root, `dist/words/_list/${page}/index.html`),
    "utf8",
  );
  const links = [
    ...html.matchAll(/<li><a href="\/words\/([^/]+)\/" lang="en">/g),
  ].map((m) => decodeWordSlug(m[1]));
  assert.deepEqual(
    links,
    words.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  );
  for (const word of links) {
    assert.ok(!directoryWords.has(word));
    directoryWords.add(word);
  }
}
assert.deepEqual(directoryWords, expected);
const urls = [];
for (const [name, xml] of sitemapFiles(data)) {
  assert.equal(await readFile(path.join(root, "dist", name), "utf8"), xml);
  const chunk = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(chunk.length <= 50000 && Buffer.byteLength(xml) < 50 * 1024 * 1024);
  urls.push(...chunk);
}
assert.equal(new Set(urls).size, sitemapPaths(data).length);
async function fileCount(folder) {
  let count = 0;
  for (const item of await readdir(folder, { withFileTypes: true }))
    count += item.isDirectory()
      ? await fileCount(path.join(folder, item.name))
      : 1;
  return count;
}
const assets = await fileCount(path.join(root, "dist"));
assert.ok(assets < 20000, "Pages free-plan asset limit");
const report = {
  checkedAt: new Date().toISOString(),
  corpusEntries: expected.size,
  autocompleteWords: manifest.autocompleteWords,
  renderedWords: rendered,
  comparedSourceRows: rows,
  logicalHtmlBytes: htmlBytes,
  missingWords: 0,
  duplicateWords: 0,
  unsupportedRelations: 0,
  directoryPages: manifest.directoryPages,
  sitemapUrls: urls.length,
  sitemapParts: sitemapFiles(data).size,
  assets,
  shards: manifest.shards.length,
  sparseWordsIncluded: manifest.sparseWords,
  reverseOnlyWordsIncluded: manifest.reverseOnly,
  publicHttp: "separate production verification required",
};
await writeFile(
  path.join(root, "../reports/site/all_word_page_audit.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
