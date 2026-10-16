import { hash, type Lexeme, type Summary, clusterFor } from "./data";

export type Direction = "forward" | "reverse";
export type Sense = {
  id: string;
  definition: string;
  synonyms: string[];
  similar: string[];
  antonyms: string[];
};
export type Neighbour = { word: string; similarity: number; shared: string[] };
export type SemanticEntry = {
  a?: Sense[];
  v?: Sense[];
  n?: Sense[];
  r?: Sense[];
  neighbours?: Record<string, Neighbour[]>;
  availability?: Record<string, Record<string, number>>;
};
const cache = new Map<string, Promise<Record<string, SemanticEntry>>>();
export async function getSemantics(word: string): Promise<SemanticEntry> {
  const shard = (await hash(word)).slice(0, 2);
  if (!cache.has(shard))
    cache.set(
      shard,
      fetch(`/data/semantics/${shard}.json`)
        .then(async (r) => {
          if (!r.ok) throw Error(`HTTP ${r.status}`);
          return (await r.json()).words;
        })
        .catch((e) => {
          cache.delete(shard);
          throw e;
        }),
    );
  return (await cache.get(shard)!)[word] ?? {};
}
export function partOfSpeech(relation: string, direction: Direction) {
  if (direction === "reverse")
    return ["verb_adv", "adj_adv"].includes(relation) ? "r" : "n";
  return ["amod", "adj_adv", "adj_prep"].includes(relation)
    ? "a"
    : ["compound", "noun_prep"].includes(relation)
      ? "n"
      : "v";
}
export function candidatesFor(
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  senseId?: string,
) {
  const all = data[partOfSpeech(relation, direction)] ?? [];
  const senses = senseId ? all.filter((s) => s.id === senseId) : all;
  const opposite = new Set(all.flatMap((s) => s.antonyms));
  const direct = new Set(senses.flatMap((s) => s.synonyms));
  const similar = new Set(senses.flatMap((s) => s.similar));
  const neighbours = senseId
    ? []
    : (data.neighbours?.[`${relation}:${direction}`] ?? []);
  const words = [
    ...new Set([...direct, ...similar, ...neighbours.map((n) => n.word)]),
  ].filter((w) => !opposite.has(w));
  return words.map((word) => ({
    word,
    kind: direct.has(word)
      ? "synonym"
      : similar.has(word)
        ? "similar"
        : "context",
    neighbour: neighbours.find((n) => n.word === word),
  }));
}
export function defaultSenseFor(
  data: SemanticEntry,
  relation: string,
  direction: Direction,
) {
  return (data[partOfSpeech(relation, direction)] ?? []).find((s) =>
    candidatesFor(data, relation, direction, s.id).some(
      (c) =>
        (data.availability?.[c.word]?.[`${relation}:${direction}`] ?? 0) > 0,
    ),
  )?.id;
}
export function senseComparison(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  senseId?: string,
) {
  const candidates = candidatesFor(data, relation, direction, senseId);
  return [
    word,
    ...candidates
      .filter(
        (c) =>
          c.word !== word &&
          (data.availability?.[c.word]?.[`${relation}:${direction}`] ?? 0) > 0,
      )
      .sort(
        (a, b) =>
          (data.availability?.[b.word]?.[`${relation}:${direction}`] ?? 0) -
            (data.availability?.[a.word]?.[`${relation}:${direction}`] ?? 0) ||
          a.word.localeCompare(b.word),
      )
      .slice(0, 5)
      .map((c) => c.word),
  ];
}

// Teaching comparisons, explicitly labelled as comparisons rather than interchangeable synonyms.
export const highSets = [
  {
    id: "height",
    ja: "高さ・位置",
    en: "Height / position",
    words: ["high", "tall", "lofty", "elevated"],
    objects: ["building", "tree", "mountain", "wall", "tower", "ceiling"],
  },
  {
    id: "degree",
    ja: "程度・量・確率",
    en: "Degree / amount / probability",
    words: ["high", "strong", "great", "large", "big", "elevated"],
    objects: [
      "possibility",
      "probability",
      "chance",
      "risk",
      "price",
      "temperature",
      "pressure",
      "quality",
      "demand",
    ],
  },
  {
    id: "pitch",
    ja: "声・音の高さ",
    en: "Voice / pitch",
    words: ["high", "shrill", "squeaky", "piercing"],
    objects: ["voice", "note", "sound", "pitch", "cry"],
  },
  {
    id: "status",
    ja: "地位・重要度",
    en: "Status / importance",
    words: ["high", "senior", "top", "elevated"],
    objects: ["rank", "position", "official", "priority", "status"],
  },
];
export async function comparisonGroup(
  word: string,
  object: string,
  relation: string,
  summary: Summary,
  direction: Direction = "forward",
) {
  if (word === "high" && relation === "amod" && direction === "forward")
    return (highSets.find((set) => set.objects.includes(object)) ?? highSets[0])
      .words;
  const editorial =
    direction === "forward"
      ? clusterFor(word, object, relation, summary)
      : [word];
  if (
    editorial.length > 1 &&
    !(relation === "amod" && editorial.includes("high"))
  )
    return [word, ...editorial.filter((w) => w !== word)];
  const data = await getSemantics(word).catch(() => ({}) as SemanticEntry);
  const candidates = candidatesFor(
    data,
    relation,
    direction,
    defaultSenseFor(data, relation, direction),
  );
  const scored = candidates.map((c) => {
    const total =
      data.availability?.[c.word]?.[`${relation}:${direction}`] ?? 0;
    return {
      ...c,
      total,
      score:
        (c.kind === "synonym" ? 3 : c.kind === "similar" ? 2 : 1) *
          Math.log1p(total) +
        (c.neighbour?.similarity ?? 0) * 4,
    };
  });
  return [
    word,
    ...scored
      .filter((c) => c.total > 0 && c.word !== word)
      .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
      .slice(0, 4)
      .map((c) => c.word),
  ];
}

export type RowOrder = "distinctive" | "shared" | "frequent" | "specified";
export function discoverObjects(
  words: string[],
  entries: Record<string, Lexeme>,
  relation: string,
  order: RowOrder,
  specified: string[],
  limit = 18,
) {
  if (order === "specified") return [...new Set(specified)].filter(Boolean);
  const byWord = words.map(
    (w) => new Map(entries[w]?.[relation]?.[1].map((r) => [r[0], r]) ?? []),
  );
  const candidates = new Set(
    byWord.flatMap((m) =>
      [...m.values()]
        .filter((r) => r[1] >= 3 && r[2] >= 3 && /^[a-z][a-z-]+$/.test(r[0]))
        .map((r) => r[0]),
    ),
  );
  const ranked = [...candidates]
    .map((object) => {
      const cells = byWord.map((m) => m.get(object));
      const rates = cells.map(
        (r, i) =>
          (r?.[1] ?? 0) / Math.max(1, entries[words[i]]?.[relation]?.[0] ?? 0),
      );
      const total = cells.reduce((s, r) => s + (r?.[1] ?? 0), 0);
      const support = cells.filter((r) => r && r[1] >= 3 && r[2] >= 3).length;
      const max = Math.max(...rates),
        min = Math.min(...rates);
      const score = ((max - min) / (max + min + 1e-8)) * Math.log1p(total);
      return {
        object,
        total,
        support,
        score,
        rates,
        shared: Math.min(...cells.map((r) => r?.[1] ?? 0)),
      };
    })
    .filter(
      (r) => r.total >= 8 && (order !== "shared" || r.support === words.length),
    );
  ranked.sort(
    (a, b) =>
      (order === "frequent"
        ? b.total - a.total
        : order === "shared"
          ? b.shared - a.shared
          : b.score - a.score) || a.object.localeCompare(b.object),
  );
  if (order !== "distinctive")
    return ranked.slice(0, limit).map((r) => r.object);
  // Round-robin representatives prevent the most frequent column swallowing the table.
  const columns = words.map((_, i) =>
    ranked.filter((r) => r.rates[i] === Math.max(...r.rates)),
  );
  const result: string[] = [];
  for (let rank = 0; result.length < limit && rank < limit; rank++)
    for (const column of columns) {
      const r = column[rank];
      if (r && !result.includes(r.object) && result.length < limit)
        result.push(r.object);
    }
  return result;
}
export function canonicalPair(
  word: string,
  partner: string,
  relation: string,
  direction: Direction,
) {
  return direction === "forward"
    ? { lemma: word, collocate: partner, relation }
    : { lemma: partner, collocate: word, relation };
}
