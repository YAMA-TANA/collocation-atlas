import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateData,
  renderDirectory,
  renderGuide,
  renderLanding,
  renderWord,
  sitemap,
  structuredData,
  ORIGIN,
} from "./search-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(
  await readFile(path.join(root, "scripts/search-data.json"), "utf8"),
);
validateData(data);
async function save(name, contents) {
  const dest = path.join(root, "dist", name);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, contents);
}
await save("words/index.html", renderDirectory(data));
await save("guide/index.html", renderGuide(data));
for (const entry of data.entries)
  await save(`words/${entry.word}/index.html`, renderWord(entry, data));
await save("sitemap.xml", sitemap(data));
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
  `Generated ${data.entries.length + 3} searchable pages, sitemap, and 404.`,
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
