// A small, reviewable corpus extract keeps static builds independent of the
// large optional interactive data download. Re-export after a corpus release.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (name) =>
  JSON.parse(await readFile(path.join(root, "public/data", name), "utf8"));
const summary = await read("summary.json");
const verbs =
  `lessen reduce decrease lower diminish cut increase raise boost enhance improve cause trigger induce affect influence impact solve resolve address tackle obtain acquire gain get make create produce generate prevent avoid avert allow permit enable show indicate demonstrate reveal suggest ease relieve alleviate begin start change develop provide take give have do achieve reach meet keep hold offer bring build establish maintain support explain describe consider expect believe learn understand`.split(
    " ",
  );
const adjectives =
  `high low strong heavy big large serious real powerful great small good bad important significant major minor possible likely beautiful tall fast quick rapid slow deep wide broad close clear common normal available different difficult easy happy`.split(
    " ",
  );
const nouns =
  `risk impact burden pain price emission temperature problem decision rain mistake possibility coffee influence effect time opportunity evidence information knowledge experience success research development`.split(
    " ",
  );
const groups = [
  [
    verbs,
    [
      ["dobj", false],
      ["nsubj", false],
      ["verb_adv", false],
    ],
  ],
  [
    adjectives,
    [
      ["amod", false],
      ["adj_adv", false],
    ],
  ],
  [
    nouns,
    [
      ["amod", true],
      ["dobj", true],
      ["compound", false],
    ],
  ],
];
const cache = new Map();
async function lexeme(word, reverse) {
  const shard = createHash("sha256").update(word).digest("hex").slice(0, 2);
  const file = `${reverse ? "reverse" : "lexicon"}/${shard}.json`;
  if (!cache.has(file)) cache.set(file, await read(file));
  return cache.get(file)[word] ?? {};
}
const entries = [];
const seen = new Set();
for (const [words, relations] of groups) {
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    const tables = [];
    for (const [relation, reverse] of relations) {
      const data = (await lexeme(word, reverse))[relation];
      if (!data) continue;
      const rows = data[1]
        .filter(([, count, docs]) => count >= 3 && docs >= 2)
        .slice(0, 12);
      if (rows.length)
        tables.push({
          relation,
          direction: reverse ? "reverse" : "forward",
          total: data[0],
          rows,
        });
    }
    if (!tables.length) throw Error(`No publishable corpus data: ${word}`);
    entries.push({ word, tables });
  }
}
entries.sort((a, b) => a.word.localeCompare(b.word, "en"));
const result = {
  version: 1,
  // Page revision date; snapshot below is the corpus aggregation date, not usage year.
  updated: "2026-10-17",
  corpus: {
    snapshot: summary.snapshot,
    words: summary.words,
    documents: summary.documents,
    pairs: summary.pair_count,
    sources: summary.sources,
    earliestYear: summary.earliest_year,
    latestYear: summary.latest_year,
  },
  entries,
};
await writeFile(
  path.join(root, "scripts/search-data.json"),
  JSON.stringify(result) + "\n",
);
console.log(
  `Exported ${entries.length} dictionary entries from ${summary.snapshot}.`,
);
