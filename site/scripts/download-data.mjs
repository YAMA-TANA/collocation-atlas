import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base =
  "https://github.com/YAMA-TANA/collocation-atlas/releases/download/corpus-2026-10-16";
async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Download failed: ${response.status} ${url}`);
  return response;
}
console.log("Downloading the reviewed English corpus aggregates…");
const expected = (await (await get(`${base}/corpus-site.sha256`)).text())
  .trim()
  .split(/\s+/)[0];
const bytes = new Uint8Array(
  await (await get(`${base}/corpus-site.zip`)).arrayBuffer(),
);
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== expected) throw Error("Corpus archive checksum mismatch");
const files = unzipSync(bytes),
  target = path.join(root, "public");
for (const [name, contents] of Object.entries(files)) {
  if (name.endsWith("/")) continue;
  const dest = path.resolve(target, name);
  if (!dest.startsWith(target + path.sep) || !name.startsWith("data/"))
    throw Error("Unsafe archive path");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, contents);
}
// Lexical senses and corpus context neighbours are versioned independently.
const semanticBase =
  "https://github.com/YAMA-TANA/collocation-atlas/releases/download/semantic-engine-2026-10-16-v2";
const semanticExpected = (
  await (await get(`${semanticBase}/semantic-site.sha256`)).text()
)
  .trim()
  .split(/\s+/)[0];
const semanticBytes = new Uint8Array(
  await (await get(`${semanticBase}/semantic-site.zip`)).arrayBuffer(),
);
if (
  createHash("sha256").update(semanticBytes).digest("hex") !== semanticExpected
)
  throw Error("Semantic archive checksum mismatch");
for (const [name, contents] of Object.entries(unzipSync(semanticBytes))) {
  if (name.endsWith("/")) continue;
  const dest = path.resolve(target, name);
  if (
    !dest.startsWith(target + path.sep) ||
    !name.startsWith("data/semantics/")
  )
    throw Error("Unsafe semantic archive path");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, contents);
}
const coverage = JSON.parse(
  await readFile(path.join(target, "data", "coverage.json"), "utf8"),
);
console.log(
  `Ready: ${coverage.pairs.toLocaleString()} pairs, ${coverage.index_words.toLocaleString()} indexed words.`,
);
