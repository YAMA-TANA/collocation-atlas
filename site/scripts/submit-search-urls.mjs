// Published URLs only; IndexNow accepts at most 10,000 URLs per POST.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ORIGIN,
  sitemap,
  sitemapFiles,
  sitemapPaths,
} from "./search-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "public/data/search/manifest.json"), "utf8"),
);
const words = JSON.parse(
  await readFile(path.join(root, "public/data/index.json"), "utf8"),
)
  .map(([word]) => word)
  .sort((a, b) => a.localeCompare(b, "en") || (a < b ? -1 : a > b ? 1 : 0));
const data = { ...manifest, words };
const key = (await readFile(path.join(root, ".indexnow-key"), "utf8")).trim();
if (!/^[a-f0-9]{32}$/.test(key))
  throw Error("Invalid IndexNow verification key");
const keyLocation = `${ORIGIN}/${key}.txt`;
const verification = await fetch(keyLocation);
if (!verification.ok || (await verification.text()).trim() !== key)
  throw Error("Deploy ownership proof first");
for (const [name, expected] of [
  ["sitemap.xml", sitemap(data)],
  ...sitemapFiles(data),
]) {
  const r = await fetch(`${ORIGIN}/${name}`);
  if (!r.ok || (await r.text()) !== expected)
    throw Error(`Published sitemap differs: ${name}`);
}
const urls = sitemapPaths(data).map((p) => ORIGIN + p);
const report = {
  submittedAt: new Date().toISOString(),
  endpoint: "https://api.indexnow.org/indexnow",
  totalUrls: urls.length,
  receivedUrls: 0,
  batches: [],
  indexed: "not confirmed",
  google: { submitted: false, reason: "Search Console property not connected" },
};
const reportFile = path.join(
  root,
  "../reports/site/all_word_search_submission.json",
);
for (let i = 0; i < urls.length; i += 10000) {
  const urlList = urls.slice(i, i + 10000);
  const response = await fetch(report.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(ORIGIN).host,
      key,
      keyLocation,
      urlList,
    }),
  });
  const received = [200, 202].includes(response.status);
  report.batches.push({
    offset: i,
    urls: urlList.length,
    status: response.status,
    result:
      response.status === 200
        ? "received"
        : response.status === 202
          ? "received; ownership validation pending"
          : "refused",
  });
  if (received) report.receivedUrls += urlList.length;
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `IndexNow ${i + urlList.length}/${urls.length}: HTTP ${response.status}`,
  );
  if (!received)
    throw Error(
      `Submission stopped at offset ${i}: HTTP ${response.status}; receipt saved for accepted batches`,
    );
}
console.log(JSON.stringify(report));
