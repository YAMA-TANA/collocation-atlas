import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import {
  renderDirectory,
  renderGuide,
  renderLanding,
  sitemap,
  sitemapFiles,
  PAGE_SIZE,
  structuredData,
  ORIGIN,
} from "./search-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "public/data/search/manifest.json"), "utf8"),
);
const words = JSON.parse(
  await readFile(path.join(root, "public/data/search/words.json"), "utf8"),
);
if (words.length !== manifest.wordCount || manifest.pageSize !== PAGE_SIZE)
  throw Error("Incomplete all-word search export");
const data = { ...manifest, words };
async function save(name, contents) {
  const dest = path.join(root, "dist", name);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, contents);
}
await save("words/index.html", renderDirectory(data));
await save("guide/index.html", renderGuide(data));
for (let page = 1; page <= manifest.directoryPages; page++)
  await save(`words/_list/${page}/index.html`, renderDirectory(data, page));
for (const [name, xml] of sitemapFiles(data)) await save(name, xml);
await save("sitemap.xml", sitemap(data));
const metadata = {
  version: 2,
  updated: manifest.updated,
  corpus: manifest.corpus,
  wordCount: manifest.wordCount,
};
const hash = createHash("sha256")
  .update(manifest.contentHash)
  .update(JSON.stringify(metadata));
for (const source of [
  "scripts/search-pages.mjs",
  "server/word-handler.mjs",
  "server/worker.mjs",
])
  hash.update(await readFile(path.join(root, source)));
metadata.cacheVersion = hash.digest("hex").slice(0, 20);
await build({
  entryPoints: [path.join(root, "server/worker.mjs")],
  outfile: path.join(root, "dist/_worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: { __SEARCH_META__: JSON.stringify(metadata) },
});
await save(
  "_routes.json",
  JSON.stringify({
    version: 1,
    include: ["/words/*"],
    exclude: ["/words/", "/words/_list/*"],
  }) + "\n",
);
const original = await readFile(path.join(root, "dist/index.html"), "utf8");
if (!original.includes('<div id="root"></div>'))
  throw Error("Missing application mount point");
await save(
  "index.html",
  original
    .replace(
      '<div id="root"></div>',
      `<div id="root">${renderLanding(data)}</div>`,
    )
    .replace(
      "</head>",
      `<link rel="stylesheet" href="/search-pages.css">${structuredData({ "@context": "https://schema.org", "@type": "WebSite", name: "COLLOCA", alternateName: "コロケーション辞典", url: ORIGIN + "/", inLanguage: ["ja", "en", "zh", "ko", "es", "fr", "de", "pt"], description: "英語コロケーション辞典。コーパスの頻度・文書数を調べ、意味ごとに類語を比較できます。" })}</head>`,
    ),
);
// A real 404 prevents arbitrary paths from being indexed as duplicate homepages.
await save(
  "404.html",
  '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>ページが見つかりません | COLLOCA</title><link rel="stylesheet" href="/search-pages.css"><main class="reference-main"><h1>ページが見つかりません。</h1><p>URLを確認するか、辞典で英単語を検索してください。</p><a href="/">検索画面へ</a> · <a href="/words/">英単語一覧へ</a></main></html>',
);
console.log(
  `Published routes for all ${manifest.wordCount} words, ${manifest.directoryPages} directory pages, ${sitemapFiles(data).size} sitemap parts, and a real 404.`,
);
try {
  const key = (await readFile(path.join(root, ".indexnow-key"), "utf8")).trim();
  if (!/^[a-f0-9]{32}$/.test(key))
    throw Error("Invalid IndexNow verification key");
  await save(`${key}.txt`, key);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  // CI builds do not need the optional, locally managed submission key.
}
