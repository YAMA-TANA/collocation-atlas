import { useEffect, useState } from "react";
import { tr, type Lang } from "./i18n";
import {
  getSemantics,
  senseOptions,
  defaultSenseFor,
  senseComparison,
  senseContexts,
  type SemanticEntry,
  type Direction,
} from "./semantics";

/** The same sense controls for every word and supported part of speech. */
export function SenseChoices({
  word,
  relation,
  direction,
  lang,
  onChoose,
}: {
  word: string;
  relation: string;
  direction: Direction;
  lang: Lang;
  onChoose: (words: string[], objects: string[], senseId: string) => void;
}) {
  const key = `${word}:${relation}:${direction}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    data: SemanticEntry;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    getSemantics(word)
      .then((data) => {
        if (alive) setLoaded({ key, data });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, word]);
  const data = loaded?.key === key ? loaded.data : null;
  if (!data) return null;
  const suggested = defaultSenseFor(data, relation, direction);
  const senses = senseOptions(data, relation, direction).sort(
    (a, b) => Number(b.id === suggested) - Number(a.id === suggested),
  );
  if (!senses.length) return null;
  return (
    <section
      className="meaning-choices"
      aria-label={tr(lang, "meaningComparisons")}
    >
      <h3>{tr(lang, "meaningComparisons")}</h3>
      <p>{tr(lang, "strictSynonymsHelp")}</p>
      <p>{tr(lang, "senseCountsHelp")}</p>
      <div className="meaning-grid">
        {senses.slice(0, 4).map((s) => (
          <button
            className="meaning-choice"
            key={s.id}
            title={s.definition}
            onClick={() =>
              onChoose(
                senseComparison(word, data, relation, direction, s.id),
                senseContexts(word, data, relation, direction, s.id),
                s.id,
              )
            }
          >
            <strong>
              {s.candidates
                .slice(0, 3)
                .map((c) => c.word)
                .join(" / ")}
            </strong>
            <span>{s.definition}</span>
            <small>{s.source ?? "WordNet 3.0"}</small>
          </button>
        ))}
      </div>
      <small className="lexical-attribution">
        Wiktionary contributors / Kaikki.org · CC BY-SA 4.0 · WordNet 3.0 ·{" "}
        <a
          href="/data/synonyms/ATTRIBUTION.txt"
          target="_blank"
          rel="noreferrer"
        >
          {tr(lang, "license")}
        </a>
      </small>
    </section>
  );
}
