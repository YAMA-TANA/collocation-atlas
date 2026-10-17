# Search discovery

Production: https://collocation-atlas.pages.dev/

Every indexed word has a readable Japanese dictionary page: **186,643 word routes**, with no curated-word or frequency cutoff. The 129-word restriction from the initial implementation has been removed. Pages include original dependency counts, document counts, normalized frequency, source limitations, self-canonical URLs, JSON-LD WebPage/BreadcrumbList metadata, and links to the existing interactive search/comparison. Word HTML is returned directly by the server; JavaScript is not required to read it. Single-occurrence and single-document records remain visible with an explicit sparse-evidence note. Frequency alone does not assign naturalness.

## Reproducible complete coverage

Run `npm ci`, `npm run data:download`, then `npm run build`. CI also downloads and verifies the pinned data releases before building and running the exhaustive audit. Builds fail if the corpus files are absent or any indexed word lacks valid evidence. `site/scripts/search-data.json` is now only a small historical fixture for unit tests; it never controls publication coverage.

The export reads every word from `/data/index.json` and both lexicon directions. It keeps up to 12 observed partners per relation/direction, across all 10 supported dependency relations, without the former 3-occurrence / 2-document filter. The current complete export contains 3,165,796 displayed rows, including 32,294 reverse-only words and 87,705 words whose displayed pairs all have sparse observations. The underlying interactive corpus remains unchanged.

An advanced-mode Pages Worker returns `/words/{word}/` HTML from 4,096 small JSON shards under `/data/search/entries/` (first three SHA256 hex digits of the UTF-8 word). This avoids Cloudflare Pages' per-deployment asset count limit; it does not redirect word pages to the application shell. The largest aggregate shard is 76,414 bytes. Security headers are applied explicitly to Function responses. Rendered HTML uses a deployment/data-specific cache key; preview responses are `noindex`. Missing words return 404, source failures return 503, HEAD has no body, and case/query aliases redirect to the word's canonical path. All indexed Unicode spellings are retained.

The complete directory has 374 static pages of up to 500 words each at `/words/_list/{number}/`, reachable from `/words/`. The reserved `_list` segment cannot shadow a real indexed word such as `page`. Every word is linked from exactly one list page and has a backlink to that page. Long words wrap on narrow screens.

`/sitemap.xml` is a sitemap index referencing five files with at most 45,000 URLs each. All 186,643 word routes, 374 list pages, homepage, directory and guide are included: **187,020 URLs** total. Directory links and sitemaps include every indexed word exactly once. Raw corpus JSON is not included. The revision date is explicit; corpus aggregation date is not presented as language usage date.

No additional database, object store or paid plan is provisioned. Function requests use the existing Cloudflare account's Workers quota; static assets remain static. References: [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/), [Google sitemap limits](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## IndexNow

An optional local `site/.indexnow-key` contains 32 lowercase hexadecimal characters (generate once with Node `crypto.randomBytes(16).toString('hex')`). The file is ignored by Git. Builds with that file publish its ownership proof at `/{key}.txt`; preserve it for later deployments. The key is served publicly as required by the protocol; it is not a Cloudflare or Google credential.

After publishing, `npm run search:submit` verifies the live proof, sitemap index, and all five sitemap parts, then submits all URLs to IndexNow in batches of at most 10,000. Receipts are saved after each batch; a refusal stops the run and preserves accepted-batch counts. HTTP 200 acknowledges receipt; HTTP 202 means proof validation is pending. Neither confirms indexing. IndexNow does not submit to Google. Avoid unnecessary repeated submissions.

## Google

Rendering resources under `/data/` are crawlable; their HTTP `X-Robots-Tag: noindex` prevents JSON data from becoming search landing pages. Blocking that directory in robots.txt would also prevent Google's renderer from loading interactive evidence, so it is intentionally allowed.

`robots.txt` announces the public sitemap at https://collocation-atlas.pages.dev/sitemap.xml. All useful pages link to the directory. Google Search Console sitemap submission requires ownership of a connected property for `https://collocation-atlas.pages.dev/`; no property was available in the connected read-only Search Console account on 2026-10-17, and GSC Wizard refused access due to subscription status. No Google sitemap submission or Google indexing is claimed. An owner can verify the URL-prefix property and submit `/sitemap.xml` without further site code changes. Crawling, canonical selection, and search ranking remain search-engine decisions.

References: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [Google sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview), [IndexNow protocol](https://www.indexnow.org/documentation).

## Initial 129-word deployment — historical verification

- Cloudflare deployment: `https://163b57ab.collocation-atlas.pages.dev` (production alias above; final language-count copy clarification).
- `reports/site/search_discovery_verification.json`: all 132 sitemap pages returned HTTP 200 with readable HTML, self-canonical URLs, parseable structured data, and no indexing prohibition. Unknown word URL returned 404; corpus JSON returned 200 with `noindex`. Sitemap contents matched the built corpus extract exactly.
- Browser: `/words/high/` displayed actual corpus rows; its comparison link opened the existing interactive high/lofty/tall/elevated/exalted comparison. Browser screenshot/DOM automation was unavailable in this app session; native accessibility navigation was used to verify the flow.
- All 350 Vitest checks passed, including static output evidence, internal discovery, canonical/sitemap consistency, and escaping.
- IndexNow received 132 URLs at `2026-10-17T00:11:12.817Z`, returning HTTP 202 (verification pending). This is receipt, not confirmed indexing. No Google Search Console sitemap submission was possible through the connected accounts.
