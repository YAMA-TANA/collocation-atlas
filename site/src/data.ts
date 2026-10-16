import { glosses } from "./i18n";
export type Row = [
  word: string,
  count: number,
  documents: number,
  otherMarginal: number,
];
export type Relationship = [total: number, rows: Row[]];
export type Lexeme = Record<string, Relationship>;
export type Entry = {
  word: string;
  forward: Lexeme;
  reverse: Lexeme;
  relation: string;
  direction: "forward" | "reverse";
  object?: string;
};
export type Selection = { lemma: string; collocate: string; relation: string };
export type Example = {
  document_id: string;
  source: string;
  source_url: string;
  year: number | null;
  register: string;
  text_license: string;
  left: string;
  match: string;
  right: string;
};
export type Evidence = {
  lemma: string;
  collocate: string;
  relation: string;
  count: number;
  documents: number;
  per_million: number;
  status: string;
  registers: Record<
    string,
    { count: number; share: number; words: number; per_million: number }
  >;
  kwic?: Example[];
  dispersion?: { document_hhi: number; dp: number };
  negative_evidence?: Record<string, unknown>;
};
export type Details = {
  lemma: string;
  relation: string;
  cluster: string[];
  pairs: Evidence[];
};
export type Summary = {
  words: number;
  documents: number;
  pair_count: number;
  segments: number;
  tokens: number;
  snapshot: string;
  country_known_documents: number;
  earliest_year: number;
  latest_year: number;
  sources: { source: string; words: number; documents: number }[];
  registers: { register: string; words: number; documents: number }[];
  clusters: string[][];
  adjective_clusters: string[][];
  relations: { relation: string; edges: number; pairs: number }[];
};
const promises = new Map<string, Promise<unknown>>();
async function json<T>(url: string): Promise<T> {
  if (!promises.has(url))
    promises.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .catch((e) => {
          promises.delete(url);
          throw e;
        }),
    );
  return promises.get(url) as Promise<T>;
}
export const getSummary = () => json<Summary>("/data/summary.json");
export const getIndex = () =>
  json<[string, number, string[]][]>("/data/index.json");
export async function hash(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
export async function getLexeme(word: string, reverse = false) {
  const key = (await hash(word)).slice(0, 2);
  const data = await json<Record<string, Lexeme>>(
    `/data/${reverse ? "reverse" : "lexicon"}/${key}.json`,
  );
  return data[word] ?? {};
}
export async function getDetails(
  lemma: string,
  relation: string,
): Promise<Details | null> {
  const key = (await hash(`${lemma}:${relation}`)).slice(0, 20);
  try {
    return await json<Details>(`/data/details/${key}.json`);
  } catch {
    return null;
  }
}
const irregular: Record<string, string> = {
  reduced: "reduce",
  reduces: "reduce",
  reducing: "reduce",
  lessened: "lessen",
  lessens: "lessen",
  lessening: "lessen",
  lowered: "lower",
  lowers: "lower",
  lowering: "lower",
  decreased: "decrease",
  decreases: "decrease",
  decreasing: "decrease",
  made: "make",
  makes: "make",
  making: "make",
  did: "do",
  done: "do",
  does: "do",
  doing: "do",
  raised: "raise",
  raises: "raise",
  raising: "raise",
  solved: "solve",
  solves: "solve",
  solving: "solve",
  got: "get",
  gets: "get",
  getting: "get",
  shown: "show",
  showed: "show",
  shows: "show",
  caused: "cause",
  causes: "cause",
  causing: "cause",
  emissions: "emission",
  prices: "price",
  risks: "risk",
  problems: "problem",
  decisions: "decision",
  mistakes: "mistake",
  opportunities: "opportunity",
  effects: "effect",
  benefits: "benefit",
};
export function normalize(s: string) {
  return s.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}
export function lemma(s: string) {
  return irregular[s] ?? s;
}
const verbs: Record<string, string[]> = {
  reduce: [
    "減らす",
    "減少",
    "削減",
    "减少",
    "降低",
    "줄이다",
    "감소",
    "reducir",
    "reduire",
    "réduire",
    "verringern",
    "reduzir",
  ],
  lower: ["下げる", "降价", "낮추다", "bajar", "abaisser", "senken", "baixar"],
  increase: [
    "増やす",
    "高める",
    "增加",
    "提高",
    "늘리다",
    "높이다",
    "aumentar",
    "augmenter",
    "erhöhen",
  ],
  solve: ["解決", "解决", "해결", "resolver", "résoudre", "lösen"],
  cause: [
    "引き起こす",
    "引起",
    "일으키다",
    "causar",
    "provoquer",
    "verursachen",
  ],
  make: [
    "作る",
    "生み出す",
    "创造",
    "만들다",
    "crear",
    "créer",
    "erschaffen",
    "criar",
  ],
  show: ["示す", "明らか", "显示", "보여주다", "mostrar", "montrer", "zeigen"],
  prevent: ["防ぐ", "预防", "예방", "prevenir", "prévenir", "verhindern"],
};
export const englishPairs = [
  "lessen the risk",
  "lessen the price",
  "reduce emissions",
  "lower the temperature",
  "heavy rain",
  "strong coffee",
  "make a decision",
  "solve a problem",
];
export function interpret(query: string): {
  word: string;
  object?: string;
  relation?: string;
  direction?: "forward" | "reverse";
} {
  const q = normalize(query);
  const translatedVerb = Object.entries(verbs).find(([, aliases]) =>
    aliases.some((a) => {
      const term = normalize(a);
      return /^[a-zéèêüöäß]+$/.test(term)
        ? q.split(/\s+/).includes(term)
        : q.includes(term);
    }),
  );
  if (translatedVerb) {
    const noun = Object.entries(glosses)
      .filter(
        ([w]) =>
          ![
            "lessen",
            "reduce",
            "lower",
            "decrease",
            "diminish",
            "cut",
          ].includes(w),
      )
      .find(([, aliases]) => aliases.some((a) => q.includes(normalize(a))));
    return {
      word: translatedVerb[0],
      object: q.includes("降价") ? "price" : noun?.[0],
      relation: "dobj",
      direction: "forward",
    };
  }
  const tokens = q
    .replace(/[.,!?]/g, "")
    .split(" ")
    .filter((s) => !["the", "a", "an", "to"].includes(s));
  if (/^[a-z][a-z '-]*$/.test(q) && tokens.length <= 4) {
    const first =
      Object.entries(verbs).find(([, aliases]) =>
        aliases.some((a) => normalize(a) === tokens[0]),
      )?.[0] ?? lemma(tokens[0]);
    const last = tokens[tokens.length - 1];
    const second =
      tokens.length > 1
        ? (Object.entries(glosses).find(
            ([w, translations]) =>
              w !== last &&
              translations.slice(2).some((v) => normalize(v) === last),
          )?.[0] ?? lemma(last))
        : undefined;
    if (second)
      return {
        word: first,
        object: second,
        relation: [
          "heavy",
          "strong",
          "big",
          "large",
          "serious",
          "high",
          "real",
          "powerful",
          "great",
        ].includes(first)
          ? "amod"
          : "dobj",
        direction: "forward",
      };
    // Translate individual editorial labels (French, Spanish, etc.) first.
    const exact = Object.entries(glosses).find(
      ([w, translations]) =>
        w !== q && translations.slice(2).some((v) => normalize(v) === q),
    );
    if (exact) return { word: exact[0] };
    const verb = Object.entries(verbs).find(([, aliases]) =>
      aliases.some((a) => normalize(a) === q),
    );
    return { word: verb?.[0] ?? first };
  }
  let word: string | undefined;
  for (const [head, aliases] of Object.entries(verbs))
    if (aliases.some((a) => q.includes(normalize(a)))) {
      word = head;
      break;
    }
  const nouns = Object.entries(glosses).filter(
    ([w]) =>
      !["lessen", "reduce", "lower", "decrease", "diminish", "cut"].includes(w),
  );
  let object = nouns.find(([, aliases]) =>
    aliases.some((a) => a.length > 0 && q.includes(normalize(a))),
  )?.[0];
  if (q.includes("降价")) {
    word = "lower";
    object = "price";
  }
  if (!word && object) return { word: object };
  if (word) return { word, object, relation: "dobj", direction: "forward" };
  return { word: lemma(q) };
}
export async function lookup(query: string): Promise<Entry> {
  const interpreted = interpret(query),
    word = interpreted.word;
  const [forward, reverse] = await Promise.all([
    getLexeme(word),
    getLexeme(word, true),
  ]);
  const candidates: [string, "forward" | "reverse", number][] = [];
  for (const r of [
    "dobj",
    "amod",
    "nsubj",
    "compound",
    "verb_adv",
    "adj_adv",
    "verb_prep",
    "adj_prep",
    "noun_prep",
  ]) {
    if (forward[r]) candidates.push([r, "forward", forward[r][0]]);
    if (reverse[r] && ["dobj", "amod", "compound"].includes(r))
      candidates.push([r, "reverse", reverse[r][0]]);
  }
  candidates.sort((a, b) => b[2] - a[2]);
  const main = candidates.filter(([r]) => r === "dobj" || r === "amod");
  const knownVerb =
    "lessen reduce decrease lower diminish cut increase raise boost enhance improve cause trigger induce generate produce affect influence impact solve resolve address tackle obtain acquire gain get make create prevent avoid avert allow permit enable show indicate demonstrate reveal suggest do ease relieve alleviate"
      .split(" ")
      .includes(word);
  const best =
    knownVerb && forward.dobj
      ? (["dobj", "forward", forward.dobj[0]] as const)
      : (main[0] ?? candidates[0]);
  return {
    word,
    forward,
    reverse,
    relation: interpreted.relation ?? best?.[0] ?? "dobj",
    direction: interpreted.direction ?? best?.[1] ?? "forward",
    object: interpreted.object,
  };
}
export function logDice(count: number, left: number, right: number) {
  return count && left + right
    ? 14 + Math.log2((2 * count) / (left + right))
    : null;
}
export function preference(
  count: number,
  objectTotal: number,
  left: number,
  leftTotal: number,
) {
  if (!objectTotal || !left || !leftTotal) return null;
  const observed = count / objectTotal,
    baseline = left / leftTotal;
  return observed / (observed + baseline);
}
export function selection(entry: Entry, row: Row): Selection {
  return entry.direction === "forward"
    ? { lemma: entry.word, collocate: row[0], relation: entry.relation }
    : { lemma: row[0], collocate: entry.word, relation: entry.relation };
}
export function clusterFor(
  word: string,
  object: string,
  rel: string,
  summary: Summary,
): string[] {
  if (rel === "amod") {
    if (object === "rain") return ["heavy", "strong"];
    if (object === "coffee") return ["strong", "powerful"];
    if (object === "mistake") return ["big", "large", "serious"];
    if (object === "possibility") return ["high", "strong", "real"];
    if (object === "influence") return ["large", "strong", "great"];
    return (
      summary.adjective_clusters.find((g) => g.includes(word)) ?? [
        word,
        "strong",
      ]
    );
  }
  if (object === "decision") return ["make", "do"];
  return (
    summary.clusters.find((g) => g.includes(word)) ??
    [word, "make", "get"].filter((v, i, a) => a.indexOf(v) === i)
  );
}
export const exampleObjects = [
  "risk",
  "impact",
  "burden",
  "pain",
  "price",
  "emission",
  "temperature",
];
export function comparisonObjectsFor(
  group: string[],
  object: string,
  relation: string,
  rows: Row[] = [],
) {
  let candidates: string[];
  if (relation === "dobj" && group.length === 6 && group.includes("lessen"))
    candidates = exampleObjects;
  else if (object === "decision" && group.includes("make"))
    candidates = [
      "decision",
      "work",
      "job",
      "mistake",
      "effort",
      "exercise",
      "homework",
    ];
  else if (relation === "amod" && object === "rain")
    candidates = [
      "rain",
      "wind",
      "snow",
      "storm",
      "coffee",
      "evidence",
      "influence",
    ];
  else if (relation === "amod" && object === "coffee")
    candidates = [
      "coffee",
      "influence",
      "effect",
      "evidence",
      "argument",
      "force",
      "personality",
    ];
  else candidates = rows.map((r) => r[0]);
  return [...new Set([object, ...candidates])].slice(0, 7);
}
export function phrase(s: Selection) {
  return ["nsubj", "passive_patient", "compound", "adj_adv"].includes(
    s.relation,
  )
    ? `${s.collocate} ${s.lemma}`
    : `${s.lemma} ${s.collocate}`;
}
