import { useEffect, useState } from "react";
import { tr, type Lang } from "./i18n";
import {
  candidatesFor,
  getSemantics,
  defaultSenseFor,
  senseComparison,
  highSets,
  partOfSpeech,
  type Direction,
  type SemanticEntry,
} from "./semantics";

export function SynonymExplorer({
  word,
  words,
  relation,
  direction,
  lang,
  onChange,
  onPreset,
}: {
  word: string;
  words: string[];
  relation: string;
  direction: Direction;
  lang: Lang;
  onChange: (words: string[]) => void;
  onPreset: (words: string[], objects: string[]) => void;
}) {
  const t = (key: string) => tr(lang, key);
  const [loaded, setLoaded] = useState<{
    key: string;
    data: SemanticEntry;
  } | null>(null);
  const [failed, setFailed] = useState("");
  const [sense, setSense] = useState("");
  const [expanded, setExpanded] = useState(false);
  const key = `${word}:${relation}:${direction}`;
  useEffect(() => {
    let alive = true;
    setSense(
      word === "high" && relation === "amod" && direction === "forward"
        ? words.includes("strong")
          ? "high.a.01"
          : words.includes("shrill")
            ? "high.a.04"
            : words.includes("senior")
              ? "eminent.s.01"
              : "high.a.02"
        : "",
    );
    setExpanded(false);
    setFailed("");
    getSemantics(word)
      .then((data) => {
        if (alive) {
          setLoaded({ key, data });
          if (word !== "high")
            setSense(defaultSenseFor(data, relation, direction) ?? "");
        }
      })
      .catch(() => {
        if (alive) setFailed(key);
      });
    return () => {
      alive = false;
    };
  }, [key, word]);
  const data = loaded?.key === key ? loaded.data : null;
  const senses = data?.[partOfSpeech(relation, direction)] ?? [];
  const candidates = data
    ? candidatesFor(data, relation, direction, sense)
    : [];
  const lexical = candidates
    .filter((c) => c.kind !== "context")
    .sort(
      (a, b) =>
        (data?.availability?.[b.word]?.[`${relation}:${direction}`] ?? 0) -
          (data?.availability?.[a.word]?.[`${relation}:${direction}`] ?? 0) ||
        a.word.localeCompare(b.word),
    );
  const contexts = data
    ? candidatesFor(data, relation, direction).filter(
        (c) => c.kind === "context",
      )
    : [];
  const toggle = (candidate: string) => {
    if (words.includes(candidate)) {
      if (candidate !== word) onChange(words.filter((w) => w !== candidate));
    } else if (words.length < 6) onChange([...words, candidate]);
  };
  const chips = (items: typeof candidates) =>
    items.map((c) => (
      <button
        type="button"
        className={`chip ${words.includes(c.word) ? "is-chosen" : ""}`}
        key={c.word}
        aria-pressed={words.includes(c.word)}
        disabled={!words.includes(c.word) && words.length >= 6}
        title={
          c.neighbour
            ? `${t("sharedContexts")}: ${c.neighbour.shared.join(", ")}`
            : c.kind === "synonym"
              ? "WordNet synset"
              : "WordNet similar_to"
        }
        onClick={() => toggle(c.word)}
      >
        {words.includes(c.word) ? "−" : "+"} {c.word}
      </button>
    ));
  return (
    <section className="synonym-explorer" aria-label={t("synonymTitle")}>
      <div className="synonym-heading">
        <h3>
          {t("synonymTitle")} <em>{word}</em>
        </h3>
        <span>{t("chooseSix")}</span>
      </div>
      <p className="synonym-note">{t("synonymNote")}</p>
      {word === "high" && relation === "amod" && direction === "forward" && (
        <div className="high-presets">
          <span>{t("teachingSets")}</span>
          <div className="chip-list">
            {highSets.map((p, i) => (
              <button
                className="chip"
                type="button"
                key={p.id}
                onClick={() => {
                  setSense(
                    ["high.a.02", "high.a.01", "high.a.04", "eminent.s.01"][i],
                  );
                  onPreset(p.words, p.objects);
                }}
              >
                {tr(lang, `highSet${i}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {failed === key ? (
        <p role="alert">{t("error")}</p>
      ) : !data ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          <label className="sense-picker">
            {t("sense")}
            <select
              value={sense}
              onChange={(e) => {
                setSense(e.target.value);
                if (data)
                  onChange(
                    senseComparison(
                      word,
                      data,
                      relation,
                      direction,
                      e.target.value || undefined,
                    ),
                  );
                setExpanded(false);
              }}
            >
              <option value="">{t("allSenses")}</option>
              {senses.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.definition}
                </option>
              ))}
            </select>
          </label>
          {sense && (
            <p className="sense-definition">
              {senses.find((s) => s.id === sense)?.definition}
            </p>
          )}
          <div className="synonym-group">
            <strong>{t("lexicalCandidates")}</strong>
            <div className="chip-list">
              {chips(expanded ? lexical : lexical.slice(0, 12))}
            </div>
            {!lexical.length && <p>{t("noLexical")}</p>}
            {lexical.length > 12 && (
              <button
                className="text-link"
                onClick={() => setExpanded(!expanded)}
              >
                {t(expanded ? "fewer" : "more")}
              </button>
            )}
          </div>
          {!!contexts.length && (
            <div className="synonym-group context-group">
              <strong>{t("contextCandidates")}</strong>
              <div className="chip-list">{chips(contexts)}</div>
              <p>{t("contextNote")}</p>
            </div>
          )}
          {!candidates.length && <p>{t("manualCompare")}</p>}
          <small className="lexical-attribution">
            WordNet 3.0 ·{" "}
            <a
              href="/data/semantics/WORDNET-LICENSE.txt"
              target="_blank"
              rel="noreferrer"
            >
              {t("license")}
            </a>{" "}
            · {t("definitionLanguage")}
          </small>
        </>
      )}
      <div className="selected-comparisons">
        <strong>{t("selectedComparisons")}</strong>
        <div className="chip-list">
          {words.map((w) => (
            <button
              className="chip is-chosen"
              key={w}
              type="button"
              disabled={w === word}
              onClick={() => toggle(w)}
            >
              {w}
              {w === word ? "" : " ×"}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
