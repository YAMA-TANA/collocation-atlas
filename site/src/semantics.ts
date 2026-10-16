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
  provenance: {
    source: string;
    url: string;
    senseId: string;
    definition: string;
    membership?: "sense-group";
    anchor?: string;
  }[];
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
/** Only explicitly asserted synonyms can enter a synonym comparison. */
export function sensesFor(
  data: SemanticEntry,
  relation: string,
  direction: Direction,
) {
  const pos = partOfSpeech(relation, direction);
  return (
    data.synonym_senses?.[pos] ??
    (data[pos] ?? []).filter((s) => s.synonyms.length > 0)
  );
}
export function candidatesFor(
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  senseId?: string,
): Candidate[] {
  const key = `${relation}:${direction}`,
    all = sensesFor(data, relation, direction);
  const senses = senseId ? all.filter((s) => s.id === senseId) : all;
  const opposite = new Set(
    [...(data[partOfSpeech(relation, direction)] ?? [])].flatMap(
      (s) => s.antonyms,
    ),
  );
  const byWord = new Map<string, Candidate>();
  for (const sense of senses) {
    for (const word of sense.synonyms) {
      if (opposite.has(word) || sense.antonyms.includes(word)) continue;
      const evidence = data.evidence?.[key]?.[word],
        total = data.availability?.[word]?.[key] ?? 0;
      const existing = byWord.get(word);
      const provenance = {
        source: sense.source ?? "WordNet 3.0",
        url:
          sense.links?.[word]?.url ??
          sense.url ??
          "https://wordnet.princeton.edu/",
        senseId: sense.id,
        definition: sense.definition,
        membership: sense.membership,
        anchor: sense.anchor,
      };
      if (existing) {
        existing.provenance.push(provenance);
        continue;
      }
      byWord.set(word, {
        word,
        pos: partOfSpeech(relation, direction),
        kind: "synonym",
        provenance: [provenance],
        similarity: evidence?.similarity ?? 0,
        shared: evidence?.shared ?? [],
        total,
        score: Math.log1p(total) * 0.05 + (evidence?.similarity ?? 0) * 8,
      });
    }
  }
  return [...byWord.values()];
}
export function defaultSenseFor(
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  context?: Relationship,
) {
  const rows = new Map(context?.[1].map((r) => [r[0], r]) ?? []);
  // WordNet's primary sense supplies alignment anchors, never candidate edges.
  // A new word still needs an explicit source synonym/group assertion.
  const primary = data[partOfSpeech(relation, direction)]?.[0];
  const anchors = new Set([
    ...(primary?.synonyms ?? []),
    ...(primary?.similar ?? []),
  ]);
  return sensesFor(data, relation, direction)
    .map((sense, index) => {
      const candidates = candidatesFor(
        data,
        relation,
        direction,
        sense.id,
      ).filter((c) => c.total > 0);
      const common = candidates
        .map((c) => Math.log1p(c.total))
        .sort((a, b) => b - a)
        .slice(0, 2);
      const inContext = candidates
        .map(
          (c) => Math.log1p(rows.get(c.word)?.[1] ?? 0) * (0.25 + c.similarity),
        )
        .sort((a, b) => b - a)
        .slice(0, 2);
      const fit = Math.max(0, ...candidates.map((c) => c.similarity));
      const anchorFit =
        anchors.size && candidates.length
          ? candidates.filter((c) => anchors.has(c.word)).length /
            Math.sqrt(anchors.size * candidates.length)
          : 0;
      return {
        id: sense.id,
        index,
        supported:
          candidates.length > 0 &&
          (!context ||
            candidates.some(
              (c) =>
                (rows.get(c.word)?.[1] ?? 0) >= 2 &&
                (rows.get(c.word)?.[2] ?? 0) >= 2,
            )),
        score:
          (common[0] ?? 0) * 0.05 +
          fit * 20 +
          anchorFit *
            (context
              ? partOfSpeech(relation, direction) === "a"
                ? 6
                : 3
              : 20) +
          (context
            ? (inContext[0] ?? 0) * 3 +
              (relation === "dobj" && sense.tags?.includes("transitive")
                ? 1
                : 0)
            : 0),
      };
    })
    .filter((s) => s.supported)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.id;
}
export function rankCandidates(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  senseId?: string,
  context?: Relationship,
): Candidate[] {
  const rows = new Map(context?.[1].map((r) => [r[0], r]) ?? []);
  // Corpus context can order declared synonyms, but cannot create a synonym edge.
  return candidatesFor(data, relation, direction, senseId)
    .filter((c) => c.word !== word)
    .map((c) => {
      const row = rows.get(c.word),
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
          ((
            data[partOfSpeech(relation, direction)]?.[0]?.synonyms ?? []
          ).includes(c.word)
            ? 3
            : 0) +
          (context
            ? Math.log1p(count) * 1.3 * Math.min(1, documents / 3) +
              Math.max(0, association) / 3
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
  return {
    data,
    ...selectCandidates(
      word,
      data,
      relation,
      direction,
      partner?.[relation],
      senseId,
    ),
  };
}
export function selectCandidates(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  context?: Relationship,
  senseId?: string,
) {
  const chosen = senseId ?? defaultSenseFor(data, relation, direction, context);
  return {
    senseId: chosen,
    candidates:
      context && !chosen
        ? []
        : rankCandidates(word, data, relation, direction, chosen, context),
  };
}
export function comparisonCandidates(candidates: Candidate[]) {
  return candidates
    .filter((c) => c.total > 0 && c.kind === "synonym")
    .slice(0, 5);
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
    ...comparisonCandidates(
      rankCandidates(word, data, relation, direction, senseId),
    ).map((c) => c.word),
  ];
}
export function automaticComparison(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
) {
  const primary = comparisonCandidates(
    rankCandidates(
      word,
      data,
      relation,
      direction,
      defaultSenseFor(data, relation, direction),
    ),
  );
  const supplement =
    primary.length < 5 && partOfSpeech(relation, direction) === "v"
      ? rankCandidates(word, data, relation, direction).filter(
          (c) => c.similarity >= 0.12 && c.shared.length >= 3,
        )
      : [];
  const choices = [
    ...new Map([...primary, ...supplement].map((c) => [c.word, c])).values(),
  ];
  return [word, ...comparisonCandidates(choices).map((c) => c.word)];
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
export function senseContexts(
  word: string,
  data: SemanticEntry,
  relation: string,
  direction: Direction,
  senseId: string,
): string[] {
  const candidates = comparisonCandidates(
    rankCandidates(word, data, relation, direction, senseId),
  );
  return [...new Set(candidates.flatMap((c) => c.shared))].slice(0, 8);
}
export function senseOptions(
  data: SemanticEntry,
  relation: string,
  direction: Direction,
) {
  return sensesFor(data, relation, direction)
    .map((s) => ({
      ...s,
      candidates: rankCandidates("", data, relation, direction, s.id).filter(
        (c) => c.total > 0,
      ),
    }))
    .filter((s) => s.candidates.length > 0);
}
export function sourceGroupFor(
  words: string[],
  data: SemanticEntry,
  relation: string,
  direction: Direction,
) {
  if (words.length < 2) return undefined;
  return sensesFor(data, relation, direction)
    .filter((s) => words.slice(1).every((w) => s.synonyms.includes(w)))
    .sort((a, b) => a.synonyms.length - b.synonyms.length)[0];
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
