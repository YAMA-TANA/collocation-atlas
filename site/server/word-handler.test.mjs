import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createWordHandler } from "./word-handler.mjs";
import { ORIGIN, wordUrl } from "../scripts/search-pages.mjs";
const data = JSON.parse(
  readFileSync(new URL("../scripts/search-data.json", import.meta.url), "utf8"),
);
const metadata = {
  corpus: data.corpus,
  cacheVersion: "test-v1",
  wordCount: 186643,
};
const sample = {
  ...data.entries.find((e) => e.word === "lessen"),
  directoryPage: 5,
};
const rare = {
  word: "façade",
  directoryPage: 1,
  tables: [
    {
      relation: "dobj",
      direction: "reverse",
      total: 1,
      rows: [["paint", 1, 1, 1, true]],
    },
  ],
};
function mockAssets(entries = [sample, rare]) {
  const shards = {};
  for (const e of entries) {
    const key = createHash("sha256").update(e.word).digest("hex").slice(0, 3);
    (shards[key] ??= {})[e.word] = e;
  }
  const calls = [];
  return {
    calls,
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        calls.push(pathname);
        if (!pathname.startsWith("/data/search/entries/"))
          return new Response("static", { status: 200 });
        const key = pathname.split("/").at(-1).replace(".json", "");
        return Response.json(shards[key] ?? {});
      },
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("complete-vocabulary server HTML", () => {
  it("serves compound, single-letter, punctuation and slash-containing corpus keys", async () => {
    for (const word of [
      "a",
      "all-seeing",
      "d'azur",
      ".",
      "/",
      "x/y",
      "\ufeff",
    ]) {
      const env = mockAssets([{ ...sample, word }]);
      const response = await createWordHandler(metadata).fetch(
        new Request(ORIGIN + wordUrl(word)),
        env,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<table>");
    }
  });
  it("does not reserve an indexed word such as page for directory pagination", async () => {
    const env = mockAssets([{ ...sample, word: "page" }]);
    const response = await createWordHandler(metadata).fetch(
      new Request(ORIGIN + wordUrl("page")),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("page のコロケーション");
    expect(env.calls[0]).toMatch(/^\/data\/search\/entries\//);
  });
  it("returns evidence in HTML without running client JavaScript", async () => {
    const env = mockAssets();
    const r = await createWordHandler(metadata).fetch(
      new Request(ORIGIN + wordUrl("lessen")),
      env,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("x-robots-tag")).toBeNull();
    const html = await r.text();
    expect(html).toContain("lessen →");
    expect(html).toContain('href="/words/_list/5/"');
    expect(env.calls).toEqual([
      `/data/search/entries/${createHash("sha256").update("lessen").digest("hex").slice(0, 3)}.json`,
    ]);
  });
  it("preserves reverse-only rare words, Unicode URLs, and HEAD", async () => {
    const handler = createWordHandler(metadata),
      env = mockAssets();
    const r = await handler.fetch(new Request(ORIGIN + wordUrl("façade")), env);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("paint → façade");
    const head = await handler.fetch(
      new Request(ORIGIN + wordUrl("façade"), { method: "HEAD" }),
      env,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const alias = await handler.fetch(
      new Request(ORIGIN + "/words/FA%C3%87ADE?tracking=1"),
      env,
    );
    expect(alias.status).toBe(308);
    expect(alias.headers.get("location")).toBe(ORIGIN + wordUrl("façade"));
  });
  it("distinguishes unknown words from unavailable or corrupt corpus data", async () => {
    const handler = createWordHandler(metadata),
      env = mockAssets();
    for (const word of ["unknownword", "constructor"]) {
      const r = await handler.fetch(new Request(ORIGIN + wordUrl(word)), env);
      expect(r.status).toBe(404);
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
    }
    for (const response of [
      new Response("missing", { status: 404 }),
      new Response("not-json"),
    ]) {
      const r = await handler.fetch(new Request(ORIGIN + wordUrl("lessen")), {
        ASSETS: { fetch: async () => response },
      });
      expect(r.status).toBe(503);
      expect(r.headers.get("retry-after")).toBe("60");
    }
    const malformed = await handler.fetch(
      new Request(ORIGIN + "/words/%ZZ/"),
      env,
    );
    expect(malformed.status).toBe(400);
  });
  it("keeps static directory routes and preview indexing separate", async () => {
    const handler = createWordHandler(metadata),
      env = mockAssets();
    const staticPage = await handler.fetch(
      new Request(ORIGIN + "/words/_list/3/"),
      env,
    );
    expect(await staticPage.text()).toBe("static");
    const preview = await handler.fetch(
      new Request("https://preview.collocation-atlas.pages.dev/words/lessen/"),
      env,
    );
    expect(preview.headers.get("x-robots-tag")).toBe("noindex");
    const post = await handler.fetch(
      new Request(ORIGIN + wordUrl("lessen"), { method: "POST" }),
      env,
    );
    expect(post.status).toBe(405);
  });
  it("caches GET bodies, serves HEAD safely, and invalidates on a new deployment version", async () => {
    const store = new Map(),
      pending = [];
    vi.stubGlobal("caches", {
      default: {
        match: async (key) => store.get(key.url)?.clone(),
        put: async (key, r) => {
          store.set(key.url, r);
        },
      },
    });
    const env = mockAssets(),
      ctx = { waitUntil: (p) => pending.push(p) },
      handler = createWordHandler(metadata);
    const request = new Request(ORIGIN + wordUrl("lessen"));
    expect((await handler.fetch(request, env, ctx)).status).toBe(200);
    await Promise.all(pending);
    const cached = await handler.fetch(
      new Request(request.url, { method: "HEAD" }),
      env,
      ctx,
    );
    expect(await cached.text()).toBe("");
    expect(env.calls.length).toBe(1);
    await createWordHandler({ ...metadata, cacheVersion: "test-v2" }).fetch(
      request,
      env,
      ctx,
    );
    expect(env.calls.length).toBe(2);
  });
});
