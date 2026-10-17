import {
  renderWord,
  wordUrl,
  validWord,
  ORIGIN,
} from "../scripts/search-pages.mjs";
const security = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function errorPage(status) {
  const unavailable = status === 503;
  return new Response(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${unavailable ? "データを取得できません" : "ページが見つかりません"} | COLLOCA</title><link rel="stylesheet" href="/search-pages.css"><main class="reference-main"><h1>${unavailable ? "データを取得できません。" : "ページが見つかりません。"}</h1><p>${unavailable ? "時間をおいて再度お試しください。" : "収録されている英単語を一覧か検索で探してください。"}</p><a href="/words/">英単語一覧へ</a> · <a href="/">検索へ</a></main></html>`,
    {
      status,
      headers: {
        ...security,
        "X-Robots-Tag": "noindex",
        "Cache-Control": "no-store",
        ...(unavailable ? { "Retry-After": "60" } : {}),
      },
    },
  );
}
export function createWordHandler(metadata) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (
        url.pathname === "/words/" ||
        url.pathname.startsWith("/words/_list/")
      )
        return env.ASSETS.fetch(request);
      const match = /^\/words\/([^/]+)\/?$/.exec(url.pathname);
      if (!match) return env.ASSETS.fetch(request);
      if (!["GET", "HEAD"].includes(request.method))
        return new Response(null, {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      let word;
      try {
        word = decodeURIComponent(match[1]).toLowerCase();
      } catch {
        return errorPage(400);
      }
      if (!validWord(word)) return errorPage(404);
      const canonicalPath = wordUrl(word);
      const cache = globalThis.caches?.default;
      const cacheKey = new Request(
        `${url.origin}/__word-cache/${metadata.cacheVersion}${canonicalPath}`,
      );
      const cached = cache && (await cache.match(cacheKey));
      if (cached) {
        if (url.pathname !== canonicalPath || url.search)
          return Response.redirect(new URL(canonicalPath, url), 308);
        return request.method === "HEAD" ? new Response(null, cached) : cached;
      }
      let entry;
      try {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(word),
        );
        const key = Array.from(new Uint8Array(digest).slice(0, 2), (n) =>
          n.toString(16).padStart(2, "0"),
        )
          .join("")
          .slice(0, 3);
        const response = await env.ASSETS.fetch(
          new Request(new URL(`/data/search/entries/${key}.json`, url)),
        );
        if (!response.ok) return errorPage(503);
        const shard = await response.json();
        entry = Object.hasOwn(shard, word) ? shard[word] : null;
      } catch {
        return errorPage(503);
      }
      if (!entry) return errorPage(404);
      if (url.pathname !== canonicalPath || url.search)
        return Response.redirect(new URL(canonicalPath, url), 308);
      const response = new Response(renderWord(entry, metadata), {
        headers: {
          ...security,
          "Cache-Control": "public, max-age=300, s-maxage=3600",
          ...(url.hostname !== new URL(ORIGIN).hostname
            ? { "X-Robots-Tag": "noindex" }
            : {}),
        },
      });
      if (cache && ctx?.waitUntil)
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return request.method === "HEAD"
        ? new Response(null, response)
        : response;
    },
  };
}
