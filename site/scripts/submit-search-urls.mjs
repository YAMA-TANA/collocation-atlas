// Run after deployment. Receipt acknowledges delivery, not actual indexing.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ORIGIN, sitemap, validateData } from "./search-pages.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(
  await readFile(path.join(root, "scripts/search-data.json"), "utf8"),
);
validateData(data);
const key = (await readFile(path.join(root, ".indexnow-key"), "utf8")).trim();
if (!/^[a-f0-9]{32}$/.test(key))
  throw Error("Invalid IndexNow verification key");
const keyLocation = `${ORIGIN}/${key}.txt`;
const verification = await fetch(keyLocation);
if (!verification.ok || (await verification.text()).trim() !== key)
  throw Error("Deploy the IndexNow verification file before submitting URLs");
const expectedSitemap = sitemap(data);
const published = await fetch(`${ORIGIN}/sitemap.xml`);
if (!published.ok || (await published.text()) !== expectedSitemap)
  throw Error(
    "Published sitemap differs from this corpus extract; deploy first",
  );
const urlList = [...expectedSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (m) => m[1],
);
const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: new URL(ORIGIN).host,
    key,
    keyLocation,
    urlList,
  }),
});
if (![200, 202].includes(response.status))
  throw Error(`IndexNow refused submission: HTTP ${response.status}`);
console.log(
  JSON.stringify(
    {
      submittedAt: new Date().toISOString(),
      endpoint: "https://api.indexnow.org/indexnow",
      urls: urlList.length,
      status: response.status,
      result:
        response.status === 202
          ? "received; ownership validation pending"
          : "received",
      indexed: "not confirmed",
    },
    null,
    2,
  ),
);
