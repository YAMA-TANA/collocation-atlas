export type Sense = {
  id: string;
  definition: string;
  synonyms: string[];
  similar: string[];
  related?: string[];
  antonyms: string[];
  source?: string;
  url?: string;
  tags?: string[];
  links?: Record<string, { word: string; tags: string[]; url: string }>;
  reverse_assertion?: boolean;
  membership?: "sense-group";
  anchor?: string;
};
export type Neighbour = { word: string; similarity: number; shared: string[] };
export type ContextEvidence = {
  similarity: number;
  shared: string[];
  shared_count: number;
};
export type SemanticEntry = {
  synonym_senses?: Partial<Record<"a" | "v" | "n" | "r" | "none", Sense[]>>;
  a?: Sense[];
  v?: Sense[];
  n?: Sense[];
  r?: Sense[];
  none?: Sense[];
  neighbours?: Record<string, Neighbour[]>;
  availability?: Record<string, Record<string, number>>;
  evidence?: Record<string, Record<string, ContextEvidence>>;
  gloss_neighbours?: Record<
    string,
    {
      word: string;
      gloss_similarity: number;
      shared: string[];
      tokens: string[];
    }[]
  >;
  contexts?: Record<string, [string, number, number, number][]>;
  pos_counts?: Record<string, number>;
};
const cache = new Map<string, Promise<Record<string, SemanticEntry>>>();
export async function getSemantics(word: string): Promise<SemanticEntry> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(word),
  );
  const key = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 2);
  if (!cache.has(key))
    cache.set(
      key,
      Promise.all([
        fetch(`/data/semantics/${key}.json?v=3`),
        fetch(`/data/synonyms/${key}.json?v=1`),
      ])
        .then(async ([legacy, synonyms]) => {
          if (!legacy.ok || !synonyms.ok)
            throw Error(
              `Lexical data: HTTP ${legacy.status}/${synonyms.status}`,
            );
          const [oldData, newData] = await Promise.all([
            legacy.json(),
            synonyms.json(),
          ]);
          const words: Record<string, SemanticEntry> = oldData.words;
          for (const [word, value] of Object.entries(
            newData.words as Record<string, SemanticEntry>,
          )) {
            words[word] = {
              ...words[word],
              ...value,
              availability: {
                ...words[word]?.availability,
                ...value.availability,
              },
            };
          }
          return words;
        })
        .catch((e) => {
          cache.delete(key);
          throw e;
        }),
    );
  return (await cache.get(key)!)[word] ?? {};
}
