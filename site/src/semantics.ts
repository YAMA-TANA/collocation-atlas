import { getLexeme, logDice, type Lexeme, type Relationship } from "./data";

export type Direction = "forward" | "reverse";
export type PartOfSpeech = "a" | "v" | "n" | "r" | "none";
export {
  getSemantics,
  type Sense,
  type Neighbour,
  type ContextEvidence,
  type SemanticEntry,
} from "./lexical";
import { getSemantics, type Neighbour, type SemanticEntry } from "./lexical";
export type Candidate = {
  word: string;
  pos: PartOfSpeech;
  kind: "synonym" | "similar" | "related" | "context" | "gloss";
  glossSimilarity?: number;
  neighbour?: Neighbour;
  similarity: number;
  shared: string[];
  total: number;
  count?: number;
  documents?: number;
  score: number;
};
export function partOfSpeech(
  relation: string,
  direction: Direction,
): PartOfSpeech {
  if (direction === "reverse")
    return ["verb_adv", "adj_adv"].includes(relation)
      ? "r"
      : relation.endsWith("_prep")
        ? "none"
        : "n";
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
): Candidate[] {
  const key = `${relation}:${direction}`,
    all = data[partOfSpeech(relation, direction)] ?? [];
  const senses = senseId ? all.filter((s) => s.id === senseId) : all;
  const opposite = new Set(all.flatMap((s) => s.antonyms)),
    direct = new Set(senses.flatMap((s) => s.synonyms)),
    similar = new Set(senses.flatMap((s) => s.similar)),
    related = new Set(senses.flatMap((s) => s.related ?? []));
  const neighbours = senseId ? [] : (data.neighbours?.[key] ?? []);
  const names = [
    ...new Set([
      ...direct,
      ...similar,
      ...related,
      ...neighbours.map((n) => n.word),
    ]),
  ].filter((w) => !opposite.has(w));
  return names.map((word) => {
    const neighbour = neighbours.find((n) => n.word === word),
      evidence = data.evidence?.[key]?.[word];
    const kind = direct.has(word)
      ? "synonym"
      : similar.has(word)
        ? "similar"
        : related.has(word)
          ? "related"
          : "context";
    const similarity = evidence?.similarity ?? neighbour?.similarity ?? 0,
      shared = evidence?.shared ?? neighbour?.shared ?? [],
      total = data.availability?.[word]?.[key] ?? 0;
    return {
      word,
      pos: partOfSpeech(relation, direction),
      kind,
      neighbour,
      similarity,
      shared,
      total,
      score:
        (kind === "synonym"
          ? 3.5
          : kind === "similar"
            ? 1.5
            : kind === "related"
              ? 0.5
              : 0) +
        similarity * 8 +
        Math.min(1, shared.length / 6) +
        Math.min(1, Math.log1p(total) / 10),
    };
  });
}
export function defaultSenseFor(
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  context?: Relationship,
) {
  const contextRows = new Map(context?.[1].map((r) => [r[0], r]) ?? []);
  const scored = (data[partOfSpeech(relation, direction)] ?? [])
    .map((sense, index) => {
      const candidates = candidatesFor(data, relation, direction, sense.id)
        .filter((c) => c.total > 0)
        .sort((a, b) => b.similarity - a.similarity || b.score - a.score);
      const top = candidates.slice(0, 3);
      return {
        sense,
        index,
        score:
          candidates
            .map((c) => Math.log1p(contextRows.get(c.word)?.[1] ?? 0))
            .sort((a, b) => b - a)
            .slice(0, 3)
            .reduce((a, b) => a + b, 0) +
          (top[0]?.similarity ?? 0) +
          (top[1]?.similarity ?? 0) * 0.2,
        supported: candidates.length > 0,
      };
    })
    .filter((s) => s.supported)
    .sort((a, b) =>
      context ? b.score - a.score || a.index - b.index : a.index - b.index,
    );
  return scored[0]?.sense.id;
}
export function rankCandidates(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  senseId?: string,
  context?: Relationship,
): Candidate[] {
  const key = `${relation}:${direction}`;
  const candidates = candidatesFor(data, relation, direction, senseId);
  const byName = new Map(candidates.map((c) => [c.word, c]));
  const blocked = new Set(
    (data[partOfSpeech(relation, direction)] ?? []).flatMap((s) => s.antonyms),
  );
  if (context)
    for (const [name, count, documents, total] of context[1]) {
      if (
        name === word ||
        blocked.has(name) ||
        count < 3 ||
        documents < 3 ||
        !/^[a-z][a-z-]+$/.test(name)
      )
        continue;
      if (!byName.has(name)) {
        const neighbour = data.neighbours?.[key]?.find((n) => n.word === name),
          ev = data.evidence?.[key]?.[name],
          gloss = data.gloss_neighbours?.[key]?.find((n) => n.word === name);
        byName.set(name, {
          word: name,
          pos: partOfSpeech(relation, direction),
          kind: gloss ? "gloss" : "context",
          glossSimilarity: gloss?.gloss_similarity,
          similarity: ev?.similarity ?? neighbour?.similarity ?? 0,
          shared: ev?.shared ?? neighbour?.shared ?? gloss?.shared ?? [],
          total,
          score:
            (ev?.similarity ?? neighbour?.similarity ?? 0) * 8 +
            (gloss?.gloss_similarity ?? 0) * 8,
        });
      }
    }
  const contextRows = new Map(context?.[1].map((r) => [r[0], r]) ?? []);
  return [...byName.values()]
    .filter((c) => c.word !== word)
    .map((c) => {
      const row = contextRows.get(c.word),
        count = row?.[1] ?? 0,
        documents = row?.[2] ?? 0;
      const association =
        context && row ? (logDice(count, row[3], context[0]) ?? 0) : 0;
      return {
        ...c,
        total: row?.[3] ?? c.total,
        count: context ? count : undefined,
        documents: context ? documents : undefined,
        score:
          c.score +
          (context
            ? count > 0
              ? Math.log1p(count) * 1.3 * Math.min(1, documents / 3) +
                Math.max(0, association) / 3
              : -3
            : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
}
export async function getCandidates(
  word: string,
  relation: string,
  direction: Direction,
  object = "",
  senseId?: string,
) {
  const [data, partner] = await Promise.all([
    getSemantics(word),
    object ? getLexeme(object, direction === "forward") : Promise.resolve(null),
  ]);
  const chosen =
    senseId ?? defaultSenseFor(data, relation, direction, partner?.[relation]);
  return {
    data,
    senseId: chosen,
    candidates: rankCandidates(
      word,
      data,
      relation,
      direction,
      chosen,
      partner?.[relation],
    ),
  };
}
export function senseComparison(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  senseId?: string,
) {
  return [
    word,
    ...rankCandidates(word, data, relation, direction, senseId)
      .filter((c) => c.total > 0)
      .slice(0, 5)
      .map((c) => c.word),
  ];
}
export function automaticComparison(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
) {
  const key = `${relation}:${direction}`,
    selected = defaultSenseFor(data, relation, direction);
  const primary = rankCandidates(
    word,
    data,
    relation,
    direction,
    selected,
  ).filter((c) => c.total > 0);
  const hasEvidence = Object.keys(data.evidence?.[key] ?? {}).length > 0;
  const supported = primary.filter(
    (c) => !hasEvidence || c.total < 50 || c.similarity >= 0.05,
  );
  const base = supported.length ? supported : primary;
  const direct = base.filter(
    (c) => c.kind === "synonym" || c.kind === "similar",
  );
  const supplementary = rankCandidates(word, data, relation, direction).filter(
    (c) =>
      c.kind !== "context" &&
      c.total > 0 &&
      c.similarity >= 0.12 &&
      c.shared.length >= 3,
  );
  const pos = partOfSpeech(relation, direction);
  const candidates =
    pos === "n" && direct.length
      ? direct
      : pos === "v" && base.length < 5
        ? [
            ...new Map(
              [...base, ...supplementary].map((c) => [c.word, c]),
            ).values(),
          ].sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
        : base;
  return [word, ...candidates.slice(0, 5).map((c) => c.word)];
}
export async function comparisonGroup(
  word: string,
  object: string,
  relation: string,
  direction: Direction = "forward",
  senseId?: string,
) {
  const { data, candidates } = await getCandidates(
    word,
    relation,
    direction,
    object,
    senseId,
  );
  if (!object && senseId === undefined)
    return automaticComparison(word, data, relation, direction);
  return [word, ...comparisonCandidates(candidates).map((c) => c.word)];
}
export function comparisonCandidates(candidates: Candidate[]) {
  // A shared argument alone is not evidence of semantic compatibility.
  // Definition overlap confuses different actions (begin/perform/complete).
  // Keep these suggestions inspectable, but use lexical links for verb/noun columns.
  return candidates
    .filter(
      (c) =>
        c.total > 0 &&
        c.kind !== "context" &&
        (c.kind !== "gloss" || c.pos === "a"),
    )
    .slice(0, 5);
}
export function senseContexts(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  senseId: string,
): string[] {
  const candidates = candidatesFor(data, relation, direction, senseId)
    .filter((c) => c.total > 0)
    .sort((a, b) => b.similarity - a.similarity || b.score - a.score)
    .slice(0, 4);
  const shared = [...new Set(candidates.flatMap((c) => c.shared))];
  return shared.slice(0, 8);
}
export function senseOptions(
  data: SemanticEntry,
  relation: string,
  direction: Direction,
) {
  return (data[partOfSpeech(relation, direction)] ?? [])
    .map((s) => ({
      ...s,
      candidates: candidatesFor(data, relation, direction, s.id)
        .filter((c) => c.total > 0)
        .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word)),
    }))
    .filter((s) => s.candidates.length > 0);
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
