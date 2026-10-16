export type Sense = {
  id: string;
  definition: string;
  synonyms: string[];
  similar: string[];
  related?: string[];
  antonyms: string[];
};
export type Neighbour = { word: string; similarity: number; shared: string[] };
export type ContextEvidence = {
  similarity: number;
  shared: string[];
  shared_count: number;
};
export type SemanticEntry = {
  a?: Sense[];
  v?: Sense[];
  n?: Sense[];
  r?: Sense[];
  none?: Sense[];
  neighbours?: Record<string, Neighbour[]>;
  availability?: Record<string, Record<string, number>>;
  evidence?: Record<string, Record<string, ContextEvidence>>;
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
      fetch(`/data/semantics/${key}.json?v=2`)
        .then(async (r) => {
          if (!r.ok) throw Error(`HTTP ${r.status}`);
          return (await r.json()).words;
        })
        .catch((e) => {
          cache.delete(key);
          throw e;
        }),
    );
  return (await cache.get(key)!)[word] ?? {};
}
