export const ORIGIN = "https://collocation-atlas.pages.dev";
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const n = (value) => value.toLocaleString("ja-JP");
export const displayWord = (word) =>
  word.trim()
    ? word
    : `[${[...word].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ")}]`;
export function wordUrl(word) {
  const slug = /^[-\p{L}\p{N}]+(?:['’][-\p{L}\p{N}]+)*$/u.test(word)
    ? encodeURIComponent(word)
    : "~" +
      btoa(String.fromCharCode(...new TextEncoder().encode(word)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
  return `/words/${slug}/`;
}
export function decodeWordSlug(slug) {
  if (!slug.startsWith("~")) return decodeURIComponent(slug);
  const encoded = slug.slice(1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw Error("Invalid word slug");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    ),
  );
}
export const PAGE_SIZE = 500;
export const SITEMAP_SIZE = 45000;
export const RELATIONS = [
  "dobj",
  "amod",
  "compound",
  "nsubj",
  "passive_patient",
  "verb_adv",
  "adj_adv",
  "verb_prep",
  "adj_prep",
  "noun_prep",
];
export const validWord = (word) =>
  typeof word === "string" &&
  word.length > 0 &&
  word.length <= 120 &&
  !/[\u0000-\u001f\u007f]/u.test(word);
const allWords = (data) => data.words ?? data.entries.map((e) => e.word);
const appUrl = (word, compare = false) =>
  `/?q=${encodeURIComponent(word)}&amp;lang=ja${compare ? "&amp;view=compare" : ""}`;
export function validateData(data) {
  if (
    data.version !== 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.updated) ||
    !Number.isSafeInteger(data.corpus?.words) ||
    data.corpus.words < 1 ||
    !data.entries?.length
  )
    throw Error("Invalid search corpus extract");
  const words = new Set();
  for (const entry of data.entries) {
    if (
      !validWord(entry.word) ||
      words.has(entry.word) ||
      !entry.tables?.length
    )
      throw Error(`Invalid or duplicate entry: ${entry.word}`);
    words.add(entry.word);
    for (const table of entry.tables) {
      if (
        !RELATIONS.includes(table.relation) ||
        !["forward", "reverse"].includes(table.direction) ||
        !Number.isSafeInteger(table.total) ||
        !table.rows?.length
      )
        throw Error(`Invalid relation: ${entry.word}`);
      for (const [word, count, docs, marginal] of table.rows) {
        if (
          typeof word !== "string" ||
          !word ||
          ![count, docs, marginal].every(Number.isSafeInteger) ||
          docs < 1 ||
          count < docs ||
          count > table.total ||
          count > marginal
        )
          throw Error(`Invalid evidence: ${entry.word}/${word}`);
      }
    }
  }
}
export function structuredData(value) {
  // JSON-LD is inert data. Escape HTML delimiters so it cannot close its tag.
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`;
}
function document(title, description, pathname, body, extra = []) {
  const url = ORIGIN + pathname;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${url}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/search-pages.css"><meta property="og:type" content="website"><meta property="og:site_name" content="COLLOCA"><meta property="og:url" content="${url}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta name="twitter:card" content="summary">${structuredData({ "@context": "https://schema.org", "@type": "WebPage", name: title, description, url, inLanguage: "ja", isPartOf: { "@type": "WebSite", name: "COLLOCA", url: ORIGIN + "/" } })}${extra.map(structuredData).join("")}</head><body><header class="reference-header"><a class="brand" href="/">colloca<span>.</span></a><nav aria-label="メインナビゲーション"><a href="/">検索する</a><a href="/words/">英単語一覧</a><a href="/guide/">使い方・データ</a></nav></header><main class="reference-main">${body}</main><footer class="reference-footer"><a href="/">COLLOCA — 英語コロケーション辞典</a><p>AMALGUM · WikiText-103 · OANC</p><a href="https://github.com/YAMA-TANA/collocation-atlas">ソースコード・出典</a></footer></body></html>`;
}
function searchForm() {
  return `<form class="reference-search" action="/" method="get"><label for="word-search">英単語・英語フレーズを検索</label><div><input id="word-search" name="q" placeholder="例: lessen the price" required maxlength="120"><input type="hidden" name="lang" value="ja"><button type="submit">調べる →</button></div></form>`;
}
function limitation(corpus) {
  return `<aside class="scope"><h2>数字の読み方</h2><p>基本形（lemma）と依存構文の関係で集計しています。間に単語がある用例や活用形も含むため、表の数字は完全一致フレーズの検索件数ではありません。100万語あたりの頻度は、出現数 ÷ ${n(corpus.words)}語 × 1,000,000 です。</p><p>Wikipedia 由来の書き言葉が多い標本です。構文解析の誤り、語義の混在、近似重複が残ります。頻度だけで自然さを断定せず、文書数・類語との比較・用例も確認してください。少ない・出現しないという理由だけで「誤り」とは判定できません。</p><a href="/guide/">コーパスの内訳と限界を読む →</a></aside>`;
}
const relationLabels = {
  "dobj:forward": "この動詞が取る目的語",
  "dobj:reverse": "この名詞を目的語に取る動詞",
  "nsubj:forward": "この動詞の主語",
  "nsubj:reverse": "この名詞を主語に取る動詞",
  "amod:forward": "この形容詞が修飾する名詞",
  "amod:reverse": "この名詞を修飾する形容詞",
  "verb_adv:forward": "この動詞を修飾する副詞",
  "adj_adv:forward": "この形容詞を修飾する副詞",
  "compound:forward": "この名詞と複合語を作る名詞",
  "compound:reverse": "この語を修飾要素として含む複合名詞",
  "verb_adv:reverse": "この副詞が修飾する動詞",
  "adj_adv:reverse": "この副詞が修飾する形容詞",
  "passive_patient:forward": "この動詞の受動文で対象になる語",
  "passive_patient:reverse": "この語が受動文の対象になる動詞",
  "verb_prep:forward": "この動詞に付く前置詞",
  "verb_prep:reverse": "この前置詞を伴う動詞",
  "adj_prep:forward": "この形容詞に付く前置詞",
  "adj_prep:reverse": "この前置詞を伴う形容詞",
  "noun_prep:forward": "この名詞に付く前置詞",
  "noun_prep:reverse": "この前置詞を伴う名詞",
};
function combination(word, partner, table) {
  const [head, dependent] =
    table.direction === "forward" ? [word, partner] : [partner, word];
  if (table.relation === "nsubj") return `${dependent} → ${head}`;
  return `${head} → ${dependent}`;
}
export function renderWord(entry, data) {
  const { word, tables } = entry;
  const title = `${displayWord(word)} のコロケーション・組み合わせ・類語比較 | COLLOCA`;
  const examples = tables[0].rows
    .slice(0, 4)
    .map(([partner]) => partner)
    .join("、");
  const description = `${word} と一緒に使われる英単語（${examples}など）を、約1億語の英語コーパスで確認。出現数・文書数・100万語あたりの頻度を掲載。類語比較と用例の検索へ進めます。`;
  const available =
    data.available ?? new Set((data.entries ?? []).map((e) => e.word));
  const body = `<nav class="breadcrumbs" aria-label="パンくず"><a href="/">ホーム</a> / <a href="/words/">英単語一覧</a> / ${escapeHtml(displayWord(word))}</nav><p class="eyebrow">ENGLISH COLLOCATIONS</p><h1><span lang="en">${escapeHtml(displayWord(word))}</span><small>のコロケーション</small></h1><p class="intro">どの単語と組み合わされるか。実際の英語データから、出現頻度と広がりを確かめよう。</p><div class="actions"><a class="primary" href="${appUrl(word)}">${escapeHtml(displayWord(word))} を詳しく調べる →</a><a href="${appUrl(word, true)}">類語を選んで比較する →</a></div><p class="meta">${n(data.corpus.words)}語 · ${n(data.corpus.documents)}文書 · 集計 ${data.corpus.snapshot}</p>${tables.map((table) => `<section><h2>${relationLabels[`${table.relation}:${table.direction}`]}</h2><p class="table-note">矢印は構文上の結び付きを表します。頻度上位${table.rows.length}件を表示。1回・1文書だけの記録も含みます。少数の記録では自然さを判断できません。</p><div class="table-wrap"><table><caption>${escapeHtml(displayWord(word))} — ${relationLabels[`${table.relation}:${table.direction}`]}</caption><thead><tr><th scope="col">組み合わせ（基本形）</th><th scope="col">出現数</th><th scope="col">文書数</th><th scope="col">100万語あたり</th></tr></thead><tbody>${table.rows.map(([partner, count, docs, , indexed]) => `<tr><th scope="row"><span lang="en">${escapeHtml(combination(word, partner, table))}</span>${(indexed ?? available.has(partner)) ? ` <a class="partner" href="${wordUrl(partner)}">${escapeHtml(displayWord(partner))} の項目</a>` : ""}</th><td>${n(count)}</td><td>${n(docs)}</td><td>${((count / data.corpus.words) * 1e6).toFixed(3)}</td></tr>`).join("")}</tbody></table></div></section>`).join("")}<section><h2>${escapeHtml(displayWord(word))} と類語の違いを調べる</h2><p>同じ日本語訳でも、一緒に使う単語が同じとは限りません。類語辞典に収録がある語は、検索画面で意味を選ぶと、WordNet・Wiktionary に記載された類語を、その意味ごとに比較できます。比較表では実際の頻度、文書数、選好スコアを確認できます。語義別のコーパス頻度を確定したものではありません。</p><a href="${appUrl(word, true)}">${escapeHtml(displayWord(word))} の比較画面へ →</a></section>${limitation(data.corpus)}${searchForm()}<p><a href="${entry.directoryPage ? `/words/_list/${entry.directoryPage}/` : `/words/`}">一覧でこの語の前後を見る →</a> · <a href="/words/">ほかの英単語を探す →</a></p>`;
  return document(title, description, wordUrl(word), body, [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "COLLOCA",
          item: ORIGIN + "/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "英単語一覧",
          item: ORIGIN + "/words/",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: word,
          item: ORIGIN + wordUrl(word),
        },
      ],
    },
  ]);
}
export function renderDirectory(data, page = 0) {
  const words = allWords(data);
  const pages = Math.ceil(words.length / PAGE_SIZE);
  if (!Number.isInteger(page) || page < 0 || page > pages)
    throw Error("Invalid directory page");
  const selected = page
    ? words.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : [];
  const suffix = page ? ` — ${page} / ${pages} ページ` : "";
  const ranges = Array.from({ length: pages }, (_, i) => ({
    number: i + 1,
    first: words[i * PAGE_SIZE],
    last: words[Math.min((i + 1) * PAGE_SIZE, words.length) - 1],
  }));
  const navigation = page
    ? `<nav class="letters" aria-label="一覧のページ送り">${page > 1 ? `<a rel="prev" href="/words/_list/${page - 1}/">← 前の500語</a>` : ""}<a href="/words/">一覧トップ</a>${page < pages ? `<a rel="next" href="/words/_list/${page + 1}/">次の500語 →</a>` : ""}</nav>`
    : "";
  return document(
    `英単語から探す${suffix}｜コロケーション辞典 COLLOCA`,
    page
      ? `${selected[0]} から ${selected.at(-1)} までのコロケーション。全${n(words.length)}語の辞典を500語ずつ掲載。各語の頻度・文書数を確認できます。`
      : `収録データ全${n(words.length)}項目の英語コロケーション辞典。どの語にも個別ページがあり、出現数・文書数から組み合わせを調べられます。`,
    page ? `/words/_list/${page}/` : "/words/",
    `<p class="eyebrow">BROWSE THE COMPLETE DICTIONARY</p><h1>英単語から探す。${page ? `<small>${escapeHtml(displayWord(selected[0]))} — ${escapeHtml(displayWord(selected.at(-1)))}</small>` : ""}</h1><p class="intro">収録データ全 ${n(words.length)} 項目の個別ページ。出現数と文書数を、どの語でも確認できます。</p><p class="table-note">収録語には固有名詞・表記揺れ・解析由来の語も含まれます。低頻度語・複合語・記号を含む表記も省略していません。原文の切り分けや解析由来の断片が含まれる場合があります。</p>${searchForm()}${navigation}${page ? `<p>${n((page - 1) * PAGE_SIZE + 1)}–${n(Math.min(page * PAGE_SIZE, words.length))} 語目 / ${n(words.length)}語 · ${page} / ${pages}ページ</p><ul class="word-grid">${selected.map((word) => `<li><a href="${wordUrl(word)}" lang="en">${escapeHtml(displayWord(word))}<span aria-hidden="true">↗</span></a></li>`).join("")}</ul>${navigation}` : `<section><h2>アルファベット順の一覧</h2><p>各ページ500語ずつ。範囲を選ぶと、その中のすべての語へ進めます。</p><ul class="word-grid">${ranges.map((r) => `<li><a href="/words/_list/${r.number}/"><span>${escapeHtml(displayWord(r.first))} — ${escapeHtml(displayWord(r.last))}</span><span>${r.number}</span></a></li>`).join("")}</ul></section>`}`,
  );
}
export function renderGuide(data) {
  return document(
    "コロケーション辞典の使い方・データと出典 | COLLOCA",
    "英語のコロケーションとは？出現頻度・文書数・類語比較の読み方と、COLLOCA が使う無料・公開コーパスの内訳、限界、出典を説明します。",
    "/guide/",
    `<p class="eyebrow">HOW TO READ THE EVIDENCE</p><h1>「一緒に使う」を、<br>データで確かめる。</h1><p class="intro">コロケーションは、単語と単語の慣用的な組み合わせ。日本語で同じ「減らす」でも、英語では目的語によって動詞の選ばれ方が変わります。</p><section><h2>検索と比較の使い方</h2><ol><li><a href="/">検索画面</a>で英単語かフレーズを入力します。例: <a href="${appUrl("lessen the price")}">lessen the price</a>。</li><li>組み合わせの頻度・文書数・用例を確認します。用例の詳細は、対応する学習語で閲覧できます。</li><li>「比較」で語義を選び、辞書に記載された類語と比べます。high のような多義語も、意味ごとに候補を確認できます。</li><li>画面の言語メニューから日本語・English・中文・한국어・Español・Français・Deutsch・Portuguêsを選べます。分析対象のコーパスは英語です。</li></ol></section><section><h2>まず調べたい組み合わせ</h2><ul><li><a href="/words/lessen/">lessen</a> / <a href="/words/reduce/">reduce</a> / <a href="/words/lower/">lower</a> — risk、price、temperature との組み合わせ</li><li><a href="/words/high/">high</a> / <a href="/words/strong/">strong</a> / <a href="/words/heavy/">heavy</a> — 修飾する名詞の違い</li><li><a href="/words/make/">make</a> / <a href="/words/do/">do</a> — decision との組み合わせ</li><li><a href="/words/solve/">solve</a> / <a href="/words/resolve/">resolve</a> / <a href="/words/address/">address</a> — problem との組み合わせ</li></ul></section><section><h2>データの内訳</h2><p>合計 ${n(data.corpus.words)}語、${n(data.corpus.documents)}文書、${n(data.corpus.pairs)}種類の依存関係ペア。集計スナップショットは ${data.corpus.snapshot} です。</p><div class="table-wrap"><table><caption>採用コーパスと語数・文書数</caption><thead><tr><th scope="col">コーパス</th><th scope="col">語数</th><th scope="col">文書数</th></tr></thead><tbody>${data.corpus.sources.map((s) => `<tr><th scope="row">${escapeHtml(s.source)}</th><td>${n(s.words)}</td><td>${n(s.documents)}</td></tr>`).join("")}</tbody></table></div><p>年代が分かる原文は ${data.corpus.earliestYear}–${data.corpus.latestYear} 年。集計年を表現の使用年として扱いません。国別の情報が不足しているため、このデータだけで米英差は判定できません。</p></section>${limitation(data.corpus)}<section><h2>出典・ライセンス</h2><ul><li><a href="https://gucorpling.org/gum/cite_amalgum.html">AMALGUM</a> — アノテーション CC BY 4.0。原文は各配布元の CC ライセンス。</li><li><a href="https://huggingface.co/datasets/Salesforce/wikitext">WikiText-103</a> — Wikipedia 由来、CC BY-SA 3.0 / GFDL。</li><li><a href="https://anc.org/data/oanc/">Open American National Corpus (OANC)</a> — 無償利用・再配布可能な公開データ。</li><li><a href="https://wordnet.princeton.edu/license-and-commercial-use">Princeton WordNet</a> — 類語・語義の辞書データ、WordNet ライセンス。</li><li><a href="https://kaikki.org/dictionary/English/">Wiktionary / Kaikki</a> — 類語・語義、CC BY-SA 4.0。検索画面の意味グループから元の辞書項目にリンクしています。</li></ul><p>有料コーパスの無断収集や、Web 検索のヒット件数による判定は行っていません。詳細な抽出仕様・データの再現方法は <a href="https://github.com/YAMA-TANA/collocation-atlas">GitHub</a> に公開しています。</p></section><a class="primary" href="/">辞典で調べる →</a>`,
  );
}
export function renderLanding(data) {
  return `<main class="reference-main"><p class="eyebrow">COLLOCA · ENGLISH COLLOCATION DICTIONARY</p><h1>英語コロケーション辞典</h1><p class="intro">単語は知っている。その組み合わせは？ 約1億語の実データで、英単語の組み合わせと類語の違いを調べよう。</p>${searchForm()}<p>${n(data.corpus.words)}語・${n(data.corpus.documents)}文書。頻度と文書数を確認し、日本語を含む8言語で英語を調べられます。</p><nav aria-label="辞典の案内"><a href="/words/">英単語から探す →</a> · <a href="/guide/">使い方・出典 →</a></nav><section><h2>よく比較する英単語</h2><ul class="word-grid">${["lessen", "reduce", "lower", "high", "strong", "heavy", "make", "do", "solve", "resolve", "increase", "raise"].map((word) => `<li><a href="${wordUrl(word)}">${word}</a></li>`).join("")}</ul></section><p>データを読み込むと、検索・比較画面が開きます。JavaScript を使用しない場合も、<a href="/words/">単語ページ</a>でコーパスの頻度を読めます。</p></main>`;
}
export function sitemapPaths(data) {
  const words = allWords(data);
  return [
    "/",
    "/words/",
    "/guide/",
    ...Array.from(
      { length: Math.ceil(words.length / PAGE_SIZE) },
      (_, i) => `/words/_list/${i + 1}/`,
    ),
    ...words.map(wordUrl),
  ];
}
export function urlset(paths, updated) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${ORIGIN}${p}</loc><lastmod>${updated}</lastmod></url>`).join("\n")}</urlset>\n`;
}
export function sitemapFiles(data) {
  const paths = sitemapPaths(data),
    files = new Map();
  for (let i = 0; i < paths.length; i += SITEMAP_SIZE)
    files.set(
      `sitemaps/words-${files.size + 1}.xml`,
      urlset(paths.slice(i, i + SITEMAP_SIZE), data.updated),
    );
  return files;
}
export function sitemap(data) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...sitemapFiles(data).keys()].map((name) => `<sitemap><loc>${ORIGIN}/${name}</loc><lastmod>${data.updated}</lastmod></sitemap>`).join("\n")}</sitemapindex>\n`;
}
