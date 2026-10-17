// Export the union of every raw corpus key, not just filtered autocomplete words.
// 4,096 small shards let Pages serve all corpus HTML routes within asset limits.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PAGE_SIZE, RELATIONS, validateData } from "./search-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "public/data");
const read = async (name) =>
  JSON.parse(await readFile(path.join(base, name), "utf8"));
const [summary, index] = await Promise.all([
  read("summary.json"),
  read("index.json"),
]);
const vocabulary = new Set();
for (const direction of ["lexicon", "reverse"])
  for (const name of await readdir(path.join(base, direction))) {
    for (const word of Object.keys(await read(`${direction}/${name}`)))
      vocabulary.add(word);
  }
const words = [...vocabulary].sort(
  (a, b) => a.localeCompare(b, "en") || (a < b ? -1 : a > b ? 1 : 0),
);
if (new Set(words).size !== words.length)
  throw Error("Duplicate words in corpus index");
const indexed = new Set(words),
  positions = new Map(words.map((word, i) => [word, i]));
const groups = new Map();
for (const word of words) {
  const hash = createHash("sha256").update(word).digest("hex");
  const prefix = hash.slice(0, 2);
  if (!groups.has(prefix)) groups.set(prefix, []);
  groups.get(prefix).push([word, hash.slice(0, 3)]);
}
const corpus = {
  snapshot: summary.snapshot,
  words: summary.words,
  documents: summary.documents,
  pairs: summary.pair_count,
  sources: summary.sources,
  earliestYear: summary.earliest_year,
  latestYear: summary.latest_year,
};
const output = path.join(base, "search");
await mkdir(path.join(output, "entries"), { recursive: true });
await writeFile(path.join(output, "words.json"), JSON.stringify(words) + "\n");
const manifests = [],
  contentHash = createHash("sha256");
let entryCount = 0,
  rowCount = 0,
  sparseWords = 0,
  reverseOnly = 0;
for (const [prefix, group] of [...groups].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const [forward, reverse] = await Promise.all([
    read(`lexicon/${prefix}.json`),
    read(`reverse/${prefix}.json`),
  ]);
  const shards = new Map();
  const entries = [];
  for (const [word, key] of group) {
    const tables = [];
    for (const relation of RELATIONS)
      for (const [direction, lexicon] of [
        ["forward", forward],
        ["reverse", reverse],
      ]) {
        const item = Object.hasOwn(lexicon, word)
          ? lexicon[word][relation]
          : null;
        if (!item?.[1]?.length) continue;
        const rows = item[1]
          .slice(0, 12)
          .map(([partner, count, docs, marginal]) => [
            partner,
            count,
            docs,
            marginal,
            indexed.has(partner),
          ]);
        tables.push({ relation, direction, total: item[0], rows });
        rowCount += rows.length;
      }
    const entry = {
      word,
      directoryPage: Math.floor(positions.get(word) / PAGE_SIZE) + 1,
      tables,
    };
    entries.push(entry);
    if (!Object.hasOwn(forward, word)) reverseOnly++;
    if (tables.every((t) => t.rows.every((r) => r[1] < 3 || r[2] < 2)))
      sparseWords++;
    if (!shards.has(key)) shards.set(key, Object.create(null));
    shards.get(key)[word] = entry;
  }
  validateData({ version: 1, updated: "2026-10-17", corpus, entries });
  for (const [key, shard] of [...shards].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const bytes = JSON.stringify(shard) + "\n";
    contentHash.update(bytes);
    await writeFile(path.join(output, `entries/${key}.json`), bytes);
    manifests.push({
      key,
      entries: Object.keys(shard).length,
      bytes: Buffer.byteLength(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  entryCount += entries.length;
}
if (entryCount !== words.length)
  throw Error("Search export did not cover the entire index");
const manifest = {
  version: 3,
  updated: "2026-10-17",
  corpus,
  wordCount: entryCount,
  autocompleteWords: index.length,
  alphabeticWords: words.filter((w) => /^\p{L}+$/u.test(w)).length,
  pageSize: PAGE_SIZE,
  directoryPages: Math.ceil(entryCount / PAGE_SIZE),
  rows: rowCount,
  sparseWords,
  reverseOnly,
  contentHash: contentHash.digest("hex"),
  shards: manifests,
};
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest) + "\n",
);
console.log(
  JSON.stringify({
    exported: entryCount,
    shards: manifests.length,
    rows: rowCount,
    sparseWords,
    reverseOnly,
    largestShard: Math.max(...manifests.map((s) => s.bytes)),
  }),
);
