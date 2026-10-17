# Search discovery

Production: https://collocation-atlas.pages.dev/

`npm run build` creates static, readable Japanese dictionary pages for 129 selected English words, a directory, a data/method guide, a useful initial home document, JSON-LD WebSite/WebPage/BreadcrumbList metadata, canonical URLs, a sitemap, and a real 404 page. The existing interactive search is available from each page. Query/filter URLs are not in the sitemap; their canonical is the homepage. Static pages use ordinary links and HTML forms, work without JavaScript, and contain actual dependency counts, document counts, and normalized frequencies. They do not assign naturalness from frequency alone.

`site/scripts/search-data.json` is a committed, small aggregate extract from the versioned corpus release (snapshot recorded inside the file). This makes CI and static builds reproducible without downloading 600 MB of interactive assets. To refresh after installing the corpus release, run `npm run search:export`, review the diff, and rebuild. It reads the same lexicon/reverse shards as the interactive client. Build validation fails on missing/invalid evidence. The page revision date is explicit; aggregation date is not presented as language usage date. Source attribution and limitations appear on the public pages. Full interactive publication still requires `npm run data:download` before building/deploying if those assets are absent.

## IndexNow

An optional local `site/.indexnow-key` contains 32 lowercase hexadecimal characters (generate once with Node `crypto.randomBytes(16).toString('hex')`). The file is ignored by Git. Builds with that file publish its ownership proof at `/{key}.txt`; preserve it for later deployments. The key is served publicly as required by the protocol; it is not a Cloudflare or Google credential.

After publishing, `npm run search:submit` verifies the live proof and exact live sitemap, then submits its URLs to IndexNow. HTTP 200 acknowledges receipt; HTTP 202 means proof validation is pending. Neither confirms indexing. IndexNow is used by participating engines and does not submit to Google. Avoid unnecessary repeated submissions.

## Google

Rendering resources under `/data/` are crawlable; their HTTP `X-Robots-Tag: noindex` prevents JSON data from becoming search landing pages. Blocking that directory in robots.txt would also prevent Google's renderer from loading interactive evidence, so it is intentionally allowed.

`robots.txt` announces the public sitemap at https://collocation-atlas.pages.dev/sitemap.xml. All useful pages link to the directory. Google Search Console sitemap submission requires ownership of a connected property for `https://collocation-atlas.pages.dev/`; no property was available in the connected read-only Search Console account on 2026-10-17, and GSC Wizard refused access due to subscription status. No Google sitemap submission or Google indexing is claimed. An owner can verify the URL-prefix property and submit `/sitemap.xml` without further site code changes. Crawling, canonical selection, and search ranking remain search-engine decisions.

References: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [Google sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview), [IndexNow protocol](https://www.indexnow.org/documentation).

## Production verification — 2026-10-17

- Cloudflare deployment: `https://3cc6a79d.collocation-atlas.pages.dev` (production alias above).
- `reports/site/search_discovery_verification.json`: all 132 sitemap pages returned HTTP 200 with readable HTML, self-canonical URLs, parseable structured data, and no indexing prohibition. Unknown word URL returned 404; corpus JSON returned 200 with `noindex`. Sitemap contents matched the built corpus extract exactly.
- Browser: `/words/high/` displayed actual corpus rows; its comparison link opened the existing interactive high/lofty/tall/elevated/exalted comparison. Browser screenshot/DOM automation was unavailable in this app session; native accessibility navigation was used to verify the flow.
- All 350 Vitest checks passed, including static output evidence, internal discovery, canonical/sitemap consistency, and escaping.
- IndexNow received 132 URLs at `2026-10-17T00:11:12.817Z`, returning HTTP 202 (verification pending). This is receipt, not confirmed indexing. No Google Search Console sitemap submission was possible through the connected accounts.
