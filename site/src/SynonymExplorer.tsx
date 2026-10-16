import { useEffect, useMemo, useState } from "react";
import { tr, format, type Lang } from "./i18n";
import { getLexeme, type Relationship } from "./data";
import {
  candidatesFor,
  getSemantics,
  defaultSenseFor,
  senseComparison,
  rankCandidates,
  partOfSpeech,
  type Candidate,
  type Direction,
  type SemanticEntry,
} from "./semantics";
import { SenseChoices } from "./SenseChoices";

export function SynonymExplorer({
  word,
  words,
  relation,
  direction,
  context = "",
  lang,
  onChange,
  onPreset,
}: {
  word: string;
  words: string[];
  relation: string;
  direction: Direction;
  context?: string;
  lang: Lang;
  onChange: (words: string[]) => void;
  onPreset: (words: string[], objects: string[]) => void;
}) {
  const t = (key: string) => tr(lang, key),
    key = JSON.stringify([word, relation, direction, context]);
  const [loaded, setLoaded] = useState<{
      key: string;
      data: SemanticEntry;
      context?: Relationship;
    } | null>(null),
    [failed, setFailed] = useState(""),
    [chosen, setChosen] = useState<{ key: string; id: string } | null>(null),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed("");
    setExpanded(false);
    Promise.all([
      getSemantics(word),
      context
        ? getLexeme(context, direction === "forward")
        : Promise.resolve(null),
    ])
      .then(([data, other]) => {
        if (alive) setLoaded({ key, data, context: other?.[relation] });
      })
      .catch(() => {
        if (alive) setFailed(key);
      });
    return () => {
      alive = false;
    };
  }, [key, word, relation, direction, context]);
  const data = loaded?.key === key ? loaded.data : null;
  const sense = data
    ? chosen?.key === key
      ? chosen.id
      : (defaultSenseFor(data, relation, direction, loaded?.context) ?? "")
    : "";
  const senses = data?.[partOfSpeech(relation, direction)] ?? [];
  const candidates = useMemo(
    () =>
      data
        ? rankCandidates(
            word,
            data,
            relation,
            direction,
            sense || undefined,
            loaded?.context,
          )
        : [],
    [data, word, relation, direction, sense, loaded],
  );
  const lexical = candidates.filter((c) => c.kind === "synonym"),
    nearby = candidates.filter(
      (c) => c.kind === "similar" || c.kind === "related",
    );
  const contexts = data
    ? rankCandidates(
        word,
        data,
        relation,
        direction,
        undefined,
        loaded?.context,
      ).filter((c) => c.kind === "context")
    : [];
  const toggle = (candidate: string) => {
    if (words.includes(candidate)) {
      if (candidate !== word) onChange(words.filter((w) => w !== candidate));
    } else if (words.length < 6) onChange([...words, candidate]);
  };
  const chips = (items: Candidate[]) =>
    items.map((c) => (
      <button
        type="button"
        className={`chip ${words.includes(c.word) ? "is-chosen" : ""}`}
        key={c.word}
        aria-pressed={words.includes(c.word)}
        disabled={!words.includes(c.word) && words.length >= 6}
        title={`${c.kind} · ${c.shared.join(", ")}${c.count !== undefined ? ` · ${c.count} ${t("observed")} / ${c.documents} ${t("documents")}` : ""}`}
        onClick={() => toggle(c.word)}
      >
        {words.includes(c.word) ? "−" : "+"} {c.word}
        {c.count !== undefined && <small> · {format(lang, c.count)}</small>}
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
      <SenseChoices
        word={word}
        relation={relation}
        direction={direction}
        lang={lang}
        onChoose={(w, o, id) => {
          setChosen({ key, id });
          onPreset(
            w,
            context ? [context, ...o.filter((x) => x !== context)] : o,
          );
        }}
      />
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
                const id = e.target.value;
                setChosen({ key, id });
                setExpanded(false);
                onChange(
                  senseComparison(
                    word,
                    data,
                    relation,
                    direction,
                    id || undefined,
                  ),
                );
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
          {!!context && (
            <p className="context-scope">
              {t("contextFor")}: <strong>{context}</strong> ·{" "}
              {t("contextCountHelp")}
            </p>
          )}
          <div className="synonym-group">
            <strong>{t("dictionarySynonyms")}</strong>
            <div className="chip-list">{chips(lexical)}</div>
            {!lexical.length && <p>{t("noLexical")}</p>}
          </div>
          {!!nearby.length && (
            <div className="synonym-group">
              <strong>{t("nearbyCandidates")}</strong>
              <div className="chip-list">
                {chips(expanded ? nearby : nearby.slice(0, 10))}
              </div>
              {nearby.length > 10 && (
                <button
                  className="text-link"
                  onClick={() => setExpanded(!expanded)}
                >
                  {t(expanded ? "fewer" : "more")}
                </button>
              )}
            </div>
          )}
          {candidates.some((c) => c.kind === "gloss") && (
            <div className="synonym-group">
              <strong>{t("definitionCandidates")}</strong>
              <div className="chip-list">
                {chips(
                  candidates.filter((c) => c.kind === "gloss").slice(0, 10),
                )}
              </div>
              <p>{t("definitionHelp")}</p>
            </div>
          )}
          {!!contexts.length && (
            <div className="synonym-group context-group">
              <strong>
                {t(context ? "contextAlternatives" : "contextCandidates")}
              </strong>
              <div className="chip-list">{chips(contexts.slice(0, 12))}</div>
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
