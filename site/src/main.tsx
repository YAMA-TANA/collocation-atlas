import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  BookOpen,
  ChartNoAxesCombined,
  Bookmark,
  Globe2,
  Info,
  ChevronDown,
  X,
  Link as LinkIcon,
  Check,
  Command,
  ArrowLeftRight,
  ExternalLink,
  SlidersHorizontal,
  Database,
  Layers,
  Quote,
  Menu,
  RefreshCw,
} from "lucide-react";
import { languages, tr, format, gloss, type Lang } from "./i18n";
import {
  getSummary,
  getIndex,
  lookup,
  getDetails,
  getLexeme,
  selection,
  phrase,
  logDice,
  preference,
  exampleObjects,
  englishPairs,
  normalize,
  interpret,
  type Summary,
  type Entry,
  type Selection,
  type Evidence,
  type Lexeme,
  type Row,
} from "./data";
import "./styles.css";
import { SynonymExplorer } from "./SynonymExplorer";
import { SenseChoices } from "./SenseChoices";
import {
  comparisonGroup,
  getSemantics,
  candidatesFor,
  type SemanticEntry,
  discoverObjects,
  canonicalPair,
  type Direction,
  type RowOrder,
} from "./semantics";

type View = "dictionary" | "compare" | "saved" | "about";
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Browsing remains available without storage. */
  }
}
function initialLang(): Lang {
  const lang = new URLSearchParams(location.search).get("lang");
  if (lang && Object.hasOwn(languages, lang)) return lang as Lang;
  const saved = stored<Lang>("colloca:lang", "ja");
  return Object.hasOwn(languages, saved) ? saved : "ja";
}
function Logo() {
  return (
    <>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path d="M17 10h-3a10 10 0 0 0 0 20h3m6-20h3a10 10 0 0 1 0 20h-3M13 20h14" />
      </svg>
      <span>
        colloca<span className="logo-dot">.</span>
      </span>
    </>
  );
}
function App() {
  const [lang, setLang] = useState<Lang>(initialLang),
    t = useCallback((key: string) => tr(lang, key), [lang]);
  const [view, setView] = useState<View>(() => {
    const v = new URLSearchParams(location.search).get("view");
    return ["dictionary", "compare", "saved", "about"].includes(v ?? "")
      ? (v as View)
      : "dictionary";
  });
  const [query, setQuery] = useState(
    () =>
      new URLSearchParams(location.search).get("q")?.slice(0, 120) || "lessen",
  );
  const [input, setInput] = useState(query),
    [summary, setSummary] = useState<Summary | null>(null),
    [index, setIndex] = useState<[string, number, string[]][]>([]);
  const [entry, setEntry] = useState<Entry | null>(null),
    [selected, setSelected] = useState<Selection | null>(null);
  const [pairData, setPairData] = useState<{
    key: string;
    row?: Row;
    evidence: Evidence | null;
    error: boolean;
  } | null>(null);
  const pairReady = !!selected && pairData?.key === JSON.stringify(selected);
  const [bootError, setBootError] = useState(false),
    [loading, setLoading] = useState(true),
    [searchError, setSearchError] = useState(false),
    [retry, setRetry] = useState(0);
  const [favorites, setFavorites] = useState<string[]>(() =>
    stored<string[]>("colloca:saved", [])
      .filter((v) => typeof v === "string")
      .slice(0, 500),
  );
  const [sort, setSort] = useState<"count" | "association">("count"),
    [filter, setFilter] = useState(""),
    [minCount, setMinCount] = useState(3),
    [limit, setLimit] = useState(12);
  const [copied, setCopied] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [showSuggestions, setShowSuggestions] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    dialogInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null);
  const [dialogQuery, setDialogQuery] = useState(""),
    [activeSuggestion, setActiveSuggestion] = useState(0);
  const [compareWords, setCompareWords] = useState<string[]>([
    "lessen",
    "reduce",
    "decrease",
    "lower",
    "diminish",
    "cut",
  ]);
  const [compareObjects, setCompareObjects] =
      useState<string[]>(exampleObjects),
    [compareRel, setCompareRel] = useState("dobj");
  const [compareDirection, setCompareDirection] =
    useState<Direction>("forward");
  const [compareOrder, setCompareOrder] = useState<RowOrder>("distinctive");
  const navigate = useCallback(
    (text: string, target: View = "dictionary") => {
      setInput(text);
      setQuery(text);
      setView(target);
      setMobileNav(false);
      setShowSuggestions(false);
      dialog.current?.close();
      if (text === query) setRetry((v) => v + 1);
    },
    [query],
  );
  useEffect(() => {
    let alive = true;
    setBootError(false);
    getSummary()
      .then((s) => {
        if (alive) setSummary(s);
      })
      .catch(() => {
        if (alive) setBootError(true);
      });
    getIndex()
      .then((i) => {
        if (alive) setIndex(i);
      })
      .catch(() => {
        /* Exact lookup does not depend on autocomplete. */
      });
    return () => {
      alive = false;
    };
  }, [retry]);
  useEffect(() => {
    document.documentElement.lang = lang;
    store("colloca:lang", lang);
    document.title = `COLLOCA — ${t("dictionary")}`;
  }, [lang, t]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("q", query);
    url.searchParams.set("lang", lang);
    if (view !== "dictionary") url.searchParams.set("view", view);
    else url.searchParams.delete("view");
    history.replaceState(null, "", url);
  }, [query, lang, view]);
  useEffect(() => {
    if (!summary) return;
    let alive = true;
    setLoading(true);
    setSearchError(false);
    setFilter("");
    setLimit(12);
    lookup(query)
      .then(async (e) => {
        if (!alive) return;
        setEntry(e);
        const rows =
          (e.direction === "forward" ? e.forward : e.reverse)[
            e.relation
          ]?.[1] ?? [];
        const desired = e.object
          ? rows.find((r) => r[0] === e.object)
          : rows[0];
        const pick = desired
          ? selection(e, desired)
          : e.object
            ? { lemma: e.word, collocate: e.object, relation: e.relation }
            : null;
        setSelected(pick);
        if (pick) {
          const group = await comparisonGroup(
            e.word,
            e.object ?? "",
            e.relation,
            e.direction,
          );
          if (!alive) return;
          setCompareDirection(e.direction);
          setCompareOrder(e.object ? "specified" : "distinctive");
          setCompareWords(group);
          setCompareRel(e.relation);
          setCompareObjects(e.object ? [e.object] : []);
        } else {
          setCompareWords([e.word]);
          setCompareObjects([]);
          setCompareDirection(e.direction);
          setCompareRel(e.relation);
          setCompareOrder("distinctive");
        }
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setSearchError(true);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [query, summary, retry]);
  useEffect(() => {
    let alive = true;
    setPairData(null);
    if (selected) {
      const key = JSON.stringify(selected);
      Promise.all([
        getDetails(selected.lemma, selected.relation),
        getLexeme(selected.lemma),
      ])
        .then(([details, lexeme]) => {
          if (alive)
            setPairData({
              key,
              evidence:
                details?.pairs.find(
                  (p) => p.collocate === selected.collocate,
                ) ?? null,
              row: lexeme[selected.relation]?.[1].find(
                (r) => r[0] === selected.collocate,
              ),
              error: false,
            });
        })
        .catch(() => {
          if (alive) setPairData({ key, evidence: null, error: true });
        });
    }
    return () => {
      alive = false;
    };
  }, [selected]);
  useEffect(() => {
    const fn = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNav(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dialog.current?.showModal();
        setTimeout(() => dialogInput.current?.focus(), 0);
      } else if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const suggestions = useMemo(() => {
    const s = normalize(input);
    if (!s) return englishPairs.slice(0, 6);
    return [
      ...englishPairs.filter((v) => v.includes(s)),
      ...index
        .filter((v) => v[0].startsWith(s))
        .slice(0, 6)
        .map((v) => v[0]),
    ]
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 6);
  }, [input, index]);
  const modalSuggestions = useMemo(() => {
    const s = normalize(dialogQuery);
    return s
      ? index
          .filter((r) => r[0].startsWith(s))
          .slice(0, 7)
          .map((r) => r[0])
      : englishPairs.slice(0, 7);
  }, [dialogQuery, index]);
  const relationship = entry
    ? (entry.direction === "forward" ? entry.forward : entry.reverse)[
        entry.relation
      ]
    : undefined;
  const rows = useMemo(() => {
    const all = (relationship?.[1] ?? []).filter(
      (r) =>
        r[1] >= minCount &&
        (!filter ||
          r[0].includes(normalize(filter)) ||
          gloss(lang, r[0]).includes(filter)),
    );
    return sort === "count"
      ? all
      : [...all].sort(
          (a, b) =>
            (logDice(b[1], relationship?.[0] ?? 0, b[3]) ?? -Infinity) -
            (logDice(a[1], relationship?.[0] ?? 0, a[3]) ?? -Infinity),
        );
  }, [relationship, minCount, filter, sort, lang]);
  const maxRowCount = rows.reduce((m, r) => Math.max(m, r[1]), 1);
  const currentRow = useMemo(() => {
    if (!entry || !selected) return undefined;
    const l =
      selected.lemma === entry.word
        ? entry.forward[selected.relation]
        : entry.reverse[selected.relation];
    return l?.[1].find(
      (r) =>
        r[0] ===
        (selected.lemma === entry.word ? selected.collocate : selected.lemma),
    );
  }, [entry, selected]);
  function toggleSaved() {
    if (!entry) return;
    setFavorites((prev) => {
      const next = prev.includes(entry.word)
        ? prev.filter((w) => w !== entry.word)
        : [entry.word, ...prev].slice(0, 500);
      store("colloca:saved", next);
      return next;
    });
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      dialog.current?.showModal();
      setDialogQuery(query);
    }
  }
  async function changeRelation(
    rel: string,
    direction = entry?.direction ?? "forward",
  ) {
    if (!entry) return;
    const available = direction === "forward" ? entry.forward : entry.reverse;
    const actual = available[rel] ? rel : (Object.keys(available)[0] ?? rel);
    const e = { ...entry, relation: actual, direction };
    setEntry(e);
    const row = (direction === "forward" ? e.forward : e.reverse)[
      actual
    ]?.[1]?.[0];
    const pick = row ? selection(e, row) : null;
    setSelected(pick);
    setLimit(12);
    setCompareRel(actual);
    if (pick && summary) {
      const group = await comparisonGroup(e.word, "", actual, direction);
      setCompareDirection(direction);
      setCompareWords(group);
      setCompareObjects([]);
      setCompareOrder("distinctive");
    }
  }
  async function compareSelected() {
    if (!selected || !summary) return;
    const direction = entry?.direction ?? "forward";
    const group = await comparisonGroup(
      direction === "forward" ? selected.lemma : selected.collocate,
      direction === "forward" ? selected.collocate : selected.lemma,
      selected.relation,
      direction,
    );
    setCompareDirection(direction);
    setCompareWords(group);
    setCompareObjects([
      direction === "forward" ? selected.collocate : selected.lemma,
    ]);
    setCompareOrder("specified");
    setCompareRel(selected.relation);
    setView("compare");
  }
  const themes: [string, string][] = [
    ["reduce", "lessen"],
    ["increase", "increase"],
    ["cause", "cause"],
    ["solve", "solve"],
    ["make", "make"],
    ["show", "show"],
    ["rain", "heavy rain"],
  ];
  const navItems: [View, string, typeof BookOpen][] = [
    ["dictionary", "dictionary", BookOpen],
    ["compare", "compare", ChartNoAxesCombined],
    ["saved", "saved", Bookmark],
    ["about", "about", Info],
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t("search")}
      </a>
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <button
          className="brand"
          onClick={() => navigate("lessen")}
          aria-label="COLLOCA"
        >
          <Logo />
        </button>
        <p className="brand-caption">{t("tagline")}</p>
        <nav aria-label={t("dictionary")}>
          {navItems.map(([id, label, Icon]) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => {
                setView(id);
                setMobileNav(false);
              }}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{t(label)}</span>
              {id === "saved" && favorites.length > 0 && (
                <span className="nav-count">{favorites.length}</span>
              )}
              {view === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="theme-nav">
          <p className="sidebar-label">{t("theme")}</p>
          {themes.map(([label, word]) => (
            <button
              key={label}
              className="theme-link"
              onClick={() => navigate(word)}
            >
              <span>{t(label)}</span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
        <div className="sidebar-foot">
          <span className="live-dot" />
          {t("corpus")}
          <strong>
            {summary ? format(lang, summary.words) : "…"}{" "}
            <small>{t("words")}</small>
          </strong>
          <p>{t("corpusOnly")}</p>
          <button className="text-link" onClick={() => setView("about")}>
            {t("about")} <ArrowRight size={14} />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-scrim"
          onClick={() => setMobileNav(false)}
          aria-label={t("close")}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label={t("browse")}
              aria-expanded={mobileNav}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              {t("dictionary")}
              <span>/</span>
              <strong>
                {view === "dictionary"
                  ? t("browse")
                  : t(
                      view === "about"
                        ? "about"
                        : view === "saved"
                          ? "saved"
                          : "compare",
                    )}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <button
              className="search-pill"
              onClick={() => {
                dialog.current?.showModal();
                setTimeout(() => dialogInput.current?.focus(), 0);
              }}
            >
              <Search size={15} />
              <span>{t("search")}</span>
              <kbd>⌘ K</kbd>
            </button>
            <label className="language-picker">
              <Globe2 size={16} />
              <span className="sr-only">Language</span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                aria-label="Language"
              >
                {Object.entries(languages).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
          </div>
        </header>
        <main id="main" className="main">
          {(view === "dictionary" || view === "compare") && (
            <section className="search-section" aria-labelledby="search-title">
              <div className="search-heading">
                <div>
                  <h1 id="search-title">
                    {lang === "ja" ? (
                      <>
                        その英語、
                        <span className="title-break">どう組み合わせる？</span>
                      </>
                    ) : (
                      t("mainTitle")
                    )}
                  </h1>
                  <p>{t("mainIntro")}</p>
                </div>
                <span className="edition">
                  <span className="live-dot" /> CORPUS EDITION
                  <br />
                  <small>ENGLISH · 2026.10</small>
                </span>
              </div>
              <form
                className="search-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (input.trim())
                    navigate(
                      input,
                      view === "compare" ? "compare" : "dictionary",
                    );
                }}
              >
                <label htmlFor="main-search" className="sr-only">
                  {t("searchLabel")}
                </label>
                <Search size={23} />
                <input
                  id="main-search"
                  ref={searchInput}
                  autoComplete="off"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() =>
                    setTimeout(() => setShowSuggestions(false), 150)
                  }
                  placeholder={t("placeholder")}
                  maxLength={120}
                  aria-describedby="search-hint"
                />
                <button type="submit" disabled={loading && !bootError}>
                  {t("search")}
                  <ArrowRight size={17} />
                </button>
                {showSuggestions && suggestions.length > 0 && (
                  <div className="suggestions" aria-label={t("matches")}>
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => navigate(s)}
                      >
                        <Search size={14} />
                        <span>{s}</span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
              </form>
              <div className="search-examples" id="search-hint">
                <span>{t("try")}</span>
                {[
                  "lessen",
                  "価格を減らす",
                  "heavy rain",
                  "make a decision",
                ].map((s) => (
                  <button key={s} onClick={() => navigate(s)}>
                    {s}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {bootError ? (
            <div className="error-box" role="alert">
              <Info />
              <p>{t("error")}</p>
              <button className="btn" onClick={() => setRetry((v) => v + 1)}>
                <RefreshCw size={16} />
                {t("retry")}
              </button>
            </div>
          ) : !summary ? (
            <div className="loading-state" role="status">
              {t("loading")}
            </div>
          ) : (
            <>
              {(view === "dictionary" || view === "compare") && (
                <div className="corpus-strip">
                  <span>
                    <Database size={14} />
                    {t("snapshot")}
                  </span>
                  <strong>
                    {format(lang, summary.words)} <small>{t("words")}</small>
                  </strong>
                  <i />
                  <span>
                    {format(lang, summary.documents)} {t("docs")}
                  </span>
                  <i />
                  <span>
                    {format(lang, summary.pair_count)} {t("combinations")}
                  </span>
                  <button
                    onClick={() => setView("about")}
                    aria-label={t("about")}
                  >
                    <Info size={15} />
                  </button>
                </div>
              )}
              {view === "dictionary" &&
                (loading ? (
                  <Loading t={t} />
                ) : searchError ? (
                  <div className="error-box" role="alert">
                    <p>{t("error")}</p>
                    <button
                      className="btn"
                      onClick={() => setRetry((v) => v + 1)}
                    >
                      {t("retry")}
                    </button>
                  </div>
                ) : (
                  entry && (
                    <>
                      <div className="entry-heading">
                        <div>
                          <div className="word-line">
                            <h2>{entry.word}</h2>
                            <span className="word-gloss">
                              {gloss(lang, entry.word)}
                            </span>
                            <span className="lemma-label">lemma</span>
                          </div>
                          <p className="entry-description">
                            {t(entry.relation)} <span>·</span>{" "}
                            {format(lang, relationship?.[0] ?? 0)}{" "}
                            {t("observed")}
                          </p>
                        </div>
                        <div className="entry-actions">
                          <button
                            className={`icon-label ${favorites.includes(entry.word) ? "is-saved" : ""}`}
                            onClick={toggleSaved}
                          >
                            <Bookmark
                              size={17}
                              fill={
                                favorites.includes(entry.word)
                                  ? "currentColor"
                                  : "none"
                              }
                            />
                            <span>
                              {t(
                                favorites.includes(entry.word)
                                  ? "unsave"
                                  : "save",
                              )}
                            </span>
                          </button>
                          <button className="icon-label" onClick={share}>
                            {copied ? (
                              <Check size={17} />
                            ) : (
                              <LinkIcon size={17} />
                            )}
                            <span>{t(copied ? "copied" : "share")}</span>
                          </button>
                        </div>
                      </div>
                      <SynonymExplorer
                        word={entry.word}
                        words={compareWords}
                        relation={entry.relation}
                        direction={entry.direction}
                        context={entry.object}
                        lang={lang}
                        onChange={(w) => {
                          setCompareWords(w);
                          setCompareRel(entry.relation);
                          setCompareDirection(entry.direction);
                        }}
                        onPreset={(w, o) => {
                          setCompareWords(w);
                          setCompareObjects(o);
                          setCompareRel(entry.relation);
                          setCompareDirection(entry.direction);
                          setCompareOrder(
                            o.length ? "specified" : "distinctive",
                          );
                          setView("compare");
                        }}
                      />
                      <button
                        className="text-link open-comparison"
                        onClick={() => setView("compare")}
                      >
                        {t("compare")}
                        <ArrowRight size={16} />
                      </button>
                      {!Object.keys(entry.forward).length &&
                      !Object.keys(entry.reverse).length ? (
                        <div className="empty-state">
                          <Search size={32} />
                          <p>{t("notFound")}</p>
                          {englishPairs.slice(0, 3).map((s) => (
                            <button
                              className="chip"
                              key={s}
                              onClick={() => navigate(s)}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <>
                          <div className="entry-controls">
                            <label className="select-control">
                              <SlidersHorizontal size={15} />
                              <span className="sr-only">{t("relation")}</span>
                              <select
                                value={entry.relation}
                                onChange={(e) => changeRelation(e.target.value)}
                              >
                                {Object.keys(
                                  entry.direction === "forward"
                                    ? entry.forward
                                    : entry.reverse,
                                ).map((rel) => (
                                  <option value={rel} key={rel}>
                                    {t(rel)}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={13} />
                            </label>
                            <button
                              className="direction-button"
                              onClick={() =>
                                changeRelation(
                                  entry.relation,
                                  entry.direction === "forward"
                                    ? "reverse"
                                    : "forward",
                                )
                              }
                              disabled={
                                !Object.keys(
                                  entry.direction === "forward"
                                    ? entry.reverse
                                    : entry.forward,
                                ).length
                              }
                            >
                              <ArrowLeftRight size={15} />
                              {entry.direction === "forward"
                                ? `${entry.word} → …`
                                : `… → ${entry.word}`}
                            </button>
                            <span className="control-hint">
                              {t("englishHint")}
                            </span>
                          </div>
                          <div className="results-layout">
                            <section
                              className="partners-panel"
                              aria-labelledby="partners-title"
                            >
                              <div className="panel-heading">
                                <h3 id="partners-title">{t("partners")}</h3>
                                <span>
                                  {format(lang, relationship?.[1].length ?? 0)}
                                </span>
                              </div>
                              <div className="list-toolbar">
                                <div className="segmented">
                                  <button
                                    className={sort === "count" ? "active" : ""}
                                    onClick={() => setSort("count")}
                                    aria-pressed={sort === "count"}
                                  >
                                    {t("countMode")}
                                  </button>
                                  <button
                                    className={
                                      sort === "association" ? "active" : ""
                                    }
                                    onClick={() => setSort("association")}
                                    aria-pressed={sort === "association"}
                                  >
                                    {t("affinityMode")}
                                  </button>
                                </div>
                                <details className="metric-help">
                                  <summary aria-label={t("explain")}>
                                    <Info size={15} />
                                  </summary>
                                  <p>{t("sortHelp")}</p>
                                </details>
                              </div>
                              <div className="partner-filters">
                                <div className="small-search">
                                  <Search size={14} />
                                  <input
                                    value={filter}
                                    onChange={(e) => {
                                      setFilter(e.target.value);
                                      setLimit(12);
                                    }}
                                    placeholder={t("filter")}
                                    aria-label={t("filter")}
                                  />
                                  {filter && (
                                    <button
                                      onClick={() => setFilter("")}
                                      aria-label={t("close")}
                                    >
                                      <X size={14} />
                                    </button>
                                  )}
                                </div>
                                <select
                                  aria-label={t("minCount")}
                                  value={minCount}
                                  onChange={(e) =>
                                    setMinCount(Number(e.target.value))
                                  }
                                >
                                  <option value={3}>{t("minCount")}</option>
                                  <option value={1}>{t("allCounts")}</option>
                                </select>
                              </div>
                              <div className="partner-table">
                                <div className="partner-table-head">
                                  <span>{t("partner")}</span>
                                  <span>{t("observed")}</span>
                                  <span>{t("documents")}</span>
                                  <span>logDice</span>
                                </div>
                                {rows.slice(0, limit).map((row) => {
                                  const pick = selection(entry, row),
                                    isSelected =
                                      selected?.lemma === pick.lemma &&
                                      selected?.collocate === pick.collocate &&
                                      selected?.relation === pick.relation;
                                  return (
                                    <button
                                      key={row[0]}
                                      className={`partner-row ${isSelected ? "selected" : ""}`}
                                      onClick={() => setSelected(pick)}
                                      aria-pressed={isSelected}
                                    >
                                      <span className="partner-word">
                                        <strong>{row[0]}</strong>
                                        {gloss(lang, row[0]) && (
                                          <small>{gloss(lang, row[0])}</small>
                                        )}
                                      </span>
                                      <span className="count-bar-cell">
                                        <span className="count-track">
                                          <span
                                            style={{
                                              width: `${(100 * row[1]) / maxRowCount}%`,
                                            }}
                                          />
                                        </span>
                                        <b>{format(lang, row[1])}</b>
                                      </span>
                                      <span className="doc-cell">
                                        {format(lang, row[2])}
                                      </span>
                                      <span className="affinity-cell">
                                        {format(
                                          lang,
                                          logDice(
                                            row[1],
                                            relationship?.[0] ?? 0,
                                            row[3],
                                          ) ?? 0,
                                          1,
                                        )}
                                        <ArrowUpRight size={13} />
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              {!rows.length && (
                                <p className="inline-empty">{t("noMatch")}</p>
                              )}
                              {rows.length > limit && (
                                <button
                                  className="show-more"
                                  onClick={() => setLimit((v) => v + 12)}
                                >
                                  {t("more")}
                                  <ChevronDown size={16} />
                                </button>
                              )}
                              <p className="list-footnote">
                                <Info size={13} />
                                {t("frequencyNote")}
                              </p>
                            </section>
                            <aside className="evidence-column">
                              {selected &&
                                (pairReady ? (
                                  pairData?.error ? (
                                    <div className="error-box" role="alert">
                                      {t("error")}
                                    </div>
                                  ) : (
                                    <EvidencePanel
                                      lang={lang}
                                      summary={summary}
                                      selected={selected}
                                      evidence={pairData?.evidence ?? null}
                                      fallback={pairData?.row ?? currentRow}
                                      onCompare={compareSelected}
                                    />
                                  )
                                ) : (
                                  <section
                                    className="evidence-panel"
                                    aria-busy="true"
                                  >
                                    <Loading t={t} />
                                  </section>
                                ))}
                              <div className="explore-callout">
                                <div className="small-mark">
                                  <ArrowLeftRight size={21} />
                                </div>
                                <h3>{t("compareTitle")}</h3>
                                <p>
                                  lessen the price
                                  <br />
                                  <strong>lower the price</strong>
                                </p>
                                <button
                                  className="text-link"
                                  onClick={compareSelected}
                                >
                                  {t("compare")}
                                  <ArrowRight size={16} />
                                </button>
                              </div>
                            </aside>
                          </div>
                          {selected && (
                            <Comparison
                              lang={lang}
                              summary={summary}
                              words={compareWords}
                              objects={compareObjects}
                              relation={compareRel}
                              direction={compareDirection}
                              initialOrder={compareOrder}
                              selected={selected}
                              onSelect={setSelected}
                              onApply={(w, o, r, d) => {
                                setCompareDirection(d);
                                setCompareWords(w);
                                setCompareObjects(o);
                                setCompareRel(r);
                              }}
                              compact
                            />
                          )}
                        </>
                      )}
                    </>
                  )
                ))}
              {view === "compare" &&
                (searchError ? (
                  <p className="error-box" role="alert">
                    {t("error")}
                  </p>
                ) : loading ? (
                  <Loading t={t} />
                ) : (
                  <Comparison
                    lang={lang}
                    summary={summary}
                    words={compareWords}
                    objects={compareObjects}
                    relation={compareRel}
                    direction={compareDirection}
                    initialOrder={compareOrder}
                    selected={selected}
                    onSelect={setSelected}
                    onApply={(w, o, r, d) => {
                      setCompareDirection(d);
                      setCompareWords(w);
                      setCompareObjects(o);
                      setCompareRel(r);
                    }}
                  />
                ))}
              {view === "saved" && (
                <section className="saved-page">
                  <h1>{t("saved")}</h1>
                  <p>{t("noSaved")}</p>
                  <div className="saved-list">
                    {favorites.map((word) => (
                      <button key={word} onClick={() => navigate(word)}>
                        <Bookmark size={19} />
                        <strong>{word}</strong>
                        <span>{gloss(lang, word)}</span>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {view === "about" && <About lang={lang} summary={summary} />}
            </>
          )}
          <footer className="footer">
            <div>
              <strong>colloca.</strong>
              <span>{t("tagline")}</span>
            </div>
            <p>
              AMALGUM · WikiText-103 · OANC <span>—</span> {t("corpusOnly")}
            </p>
            <div className="footer-links">
              <button onClick={() => setView("about")}>
                {t("license")}
                <ArrowUpRight size={12} />
              </button>
              <a
                href="https://github.com/YAMA-TANA/collocation-atlas"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
                <ArrowUpRight size={12} />
              </a>
            </div>
          </footer>
        </main>
      </div>
      <dialog
        className="command-dialog"
        ref={dialog}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="command-content">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate(
                dialogQuery || modalSuggestions[activeSuggestion] || "lessen",
              );
            }}
          >
            <Search size={20} />
            <label className="sr-only" htmlFor="command-search">
              {t("searchLabel")}
            </label>
            <input
              id="command-search"
              ref={dialogInput}
              value={dialogQuery}
              placeholder={t("placeholder")}
              maxLength={120}
              onChange={(e) => {
                setDialogQuery(e.target.value);
                setActiveSuggestion(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveSuggestion((v) =>
                    Math.min(v + 1, modalSuggestions.length - 1),
                  );
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveSuggestion((v) => Math.max(0, v - 1));
                }
                if (
                  e.key === "Enter" &&
                  modalSuggestions[activeSuggestion] &&
                  dialogQuery
                ) {
                  e.preventDefault();
                  navigate(modalSuggestions[activeSuggestion]);
                }
              }}
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => dialog.current?.close()}
              aria-label={t("close")}
            >
              <X size={19} />
            </button>
          </form>
          <p className="command-caption">{t("matches")}</p>
          <div className="command-results">
            {modalSuggestions.map((s, i) => (
              <button
                key={s}
                className={i === activeSuggestion ? "active" : ""}
                onClick={() => navigate(s)}
              >
                <BookOpen size={17} />
                <strong>{s}</strong>
                <span>{gloss(lang, s)}</span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
          <div className="command-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> {t("select")}
            </span>
            <span>
              <kbd>esc</kbd> {t("close")}
            </span>
            <Command size={13} />
          </div>
        </div>
      </dialog>
    </div>
  );
}

function Loading({ t }: { t: (s: string) => string }) {
  return (
    <div className="loading-state" role="status">
      <div className="skeleton-line" />
      <div className="skeleton-line" />
      <p>{t("loading")}</p>
    </div>
  );
}

function EvidencePanel({
  lang,
  summary,
  selected,
  evidence,
  fallback,
  onCompare,
}: {
  lang: Lang;
  summary: Summary;
  selected: Selection;
  evidence: Evidence | null;
  fallback?: Row;
  onCompare: () => void;
}) {
  const t = (s: string) => tr(lang, s),
    n = evidence?.count ?? fallback?.[1] ?? 0,
    docs = evidence?.documents ?? fallback?.[2] ?? 0;
  const registers = Object.entries(evidence?.registers ?? {}).sort(
    (a, b) => b[1].count - a[1].count,
  );
  return (
    <section className="evidence-panel" aria-label={t("explain")}>
      <div className="evidence-heading">
        <span className="section-icon">
          <Layers size={16} />
        </span>
        <span>{t("explain")}</span>
        <span className={`evidence-badge ${n ? "attested" : "unobserved"}`}>
          {t(n ? (docs >= 3 ? "stable" : "sparse") : "zero")}
        </span>
      </div>
      <h3 className="selected-phrase">{phrase(selected)}</h3>
      <p className="evidence-scope">{t("allSources")}</p>
      <div className="evidence-metrics">
        <div>
          <strong>{format(lang, n)}</strong>
          <span>{t("observed")}</span>
        </div>
        <div>
          <strong>{format(lang, docs)}</strong>
          <span>{t("documents")}</span>
        </div>
        <div>
          <strong>{format(lang, (n * 1e6) / summary.words, 2)}</strong>
          <span>{t("perMillion")}</span>
        </div>
      </div>
      <p className="evidence-note">{t(n ? "docExplain" : "zeroHelp")}</p>
      <button className="compare-link" onClick={onCompare}>
        <ArrowLeftRight size={16} />
        {t("compare")}
        <ArrowRight size={15} />
      </button>
      {registers.length > 0 && (
        <div className="register-block">
          <h4>{t("register")}</h4>
          <div className="register-meter" aria-hidden="true">
            {registers.map(([r, v], i) => (
              <span
                key={r}
                className={`register-color-${i % 4}`}
                style={{ width: `${v.share * 100}%` }}
              />
            ))}
          </div>
          {registers.map(([r, v], i) => (
            <div className="register-row" key={r}>
              <span>
                <i className={`register-color-${i % 4}`} />
                {t(r)}
              </span>
              <strong>
                {format(lang, v.count)}{" "}
                <small>({format(lang, v.share * 100, 0)}%)</small>
              </strong>
            </div>
          ))}
          <details className="register-explanation">
            <summary>{t("explain")}</summary>
            <p>{t("registerHelp")}</p>
            {registers.map(([r, v]) => (
              <p key={r}>
                {t(r)}: {format(lang, v.count)} / {format(lang, v.words)}{" "}
                {t("words")} · {format(lang, v.per_million, 2)}{" "}
                {t("perMillion")}
              </p>
            ))}
          </details>
        </div>
      )}
      <div className="kwic-block">
        <h4>
          <Quote size={16} />
          {t("examples")}
        </h4>
        {evidence?.kwic?.length ? (
          evidence.kwic.slice(0, 2).map((ex) => (
            <figure className="kwic" key={ex.document_id}>
              <blockquote lang="en">
                … {ex.left.split(" ").slice(-13).join(" ")}{" "}
                <mark>{ex.match}</mark>{" "}
                {ex.right.split(" ").slice(0, 17).join(" ")} …
              </blockquote>
              <figcaption>
                <a
                  href={
                    /^https?:\/\//i.test(ex.source_url)
                      ? ex.source_url
                      : undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {ex.source}
                  <ExternalLink size={11} />
                </a>
                <span>
                  {ex.year ?? t("unknown")} · {t(ex.register)}
                </span>
                <small>{ex.text_license}</small>
              </figcaption>
            </figure>
          ))
        ) : (
          <p className="kwic-unavailable">{t("noExamples")}</p>
        )}
      </div>
    </section>
  );
}

type Benchmark = {
  rows: {
    collocate: string;
    cells: Record<
      string,
      {
        count: number;
        documents: number;
        synonym_preference: {
          preference_score: number | null;
          verb_cluster_count: number;
        };
      }
    >;
  }[];
};
function Comparison({
  lang,
  summary,
  words,
  objects,
  relation,
  direction,
  initialOrder = "distinctive",
  selected,
  onSelect,
  onApply,
  compact = false,
}: {
  lang: Lang;
  summary: Summary;
  words: string[];
  objects: string[];
  relation: string;
  selected: Selection | null;
  onSelect: (s: Selection) => void;
  direction: Direction;
  initialOrder?: RowOrder;
  onApply: (w: string[], o: string[], r: string, d: Direction) => void;
  compact?: boolean;
}) {
  const t = (s: string) => tr(lang, s),
    [entries, setEntries] = useState<Record<string, Lexeme>>({}),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [mode, setMode] = useState<"count" | "preference" | "rate">("count");
  const [candidateMetadata, setCandidateMetadata] = useState<SemanticEntry>({});
  const [rowOrder, setRowOrder] = useState<RowOrder>(initialOrder);
  const [editorOpen, setEditorOpen] = useState(false);
  useEffect(() => setRowOrder(initialOrder), [initialOrder]);
  const [directionInput, setDirectionInput] = useState<Direction>(direction);
  const [entryKey, setEntryKey] = useState("");
  const loadKey = JSON.stringify([words, relation, direction]);
  const [wordInput, setWordInput] = useState(words.join(", ")),
    [objectInput, setObjectInput] = useState(""),
    [relationInput, setRelationInput] = useState(relation),
    [inputError, setInputError] = useState(false),
    [source, setSource] = useState("combined"),
    [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  useEffect(() => {
    setWordInput(words.join(", "));
    setRelationInput(relation);
    setDirectionInput(direction);
    setSource("combined");
  }, [words.join(","), relation, direction]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    Promise.all([
      Promise.all(
        words.map(
          async (w) =>
            [w, await getLexeme(w, direction === "reverse")] as const,
        ),
      ),
      getSemantics(words[0]).catch(() => ({}) as SemanticEntry),
    ])
      .then(([p, metadata]) => {
        if (alive) {
          setEntries(Object.fromEntries(p));
          setCandidateMetadata(metadata);
          setEntryKey(loadKey);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [loadKey]);
  const discovered = useMemo(
    () => discoverObjects(words, entries, relation, rowOrder, objects),
    [words, entries, relation, rowOrder, objects],
  );
  const displayedObjects = rowOrder === "specified" ? objects : discovered;
  const canSource =
    direction === "forward" &&
    rowOrder === "specified" &&
    relation === "dobj" &&
    words.length === 6 &&
    summary.clusters[0].every((w) => words.includes(w)) &&
    objects.every((o) => exampleObjects.includes(o));
  useEffect(() => {
    let alive = true;
    setBenchmark(null);
    if (source !== "combined" && canSource)
      fetch(`/data/benchmarks/comparison_${source}.json`)
        .then((r) => {
          if (!r.ok) throw Error();
          return r.json();
        })
        .then((d) => {
          if (alive) setBenchmark(d);
        })
        .catch(() => {
          if (alive) {
            setSource("combined");
            setError(true);
          }
        });
    return () => {
      alive = false;
    };
  }, [source, canSource]);
  const values = displayedObjects.map((obj) => {
    const cells = words.map((word) => {
      const row = entries[word]?.[relation]?.[1]?.find((r) => r[0] === obj);
      return {
        word,
        count: row?.[1] ?? 0,
        docs: row?.[2] ?? 0,
        base: entries[word]?.[relation]?.[0] ?? 0,
      };
    });
    const total = cells.reduce((s, c) => s + c.count, 0),
      bases = cells.reduce((s, c) => s + c.base, 0);
    return {
      object: obj,
      cells: cells.map((c) => {
        const b = benchmark?.rows.find((r) => r.collocate === obj)?.cells[
          c.word
        ];
        return {
          ...c,
          count: b?.count ?? c.count,
          docs: b?.documents ?? c.docs,
          rate: b
            ? b.synonym_preference.verb_cluster_count
              ? (b.count / b.synonym_preference.verb_cluster_count) * 10000
              : null
            : c.base
              ? (c.count / c.base) * 10000
              : null,
          score: b
            ? b.synonym_preference.preference_score
            : preference(c.count, total, c.base, bases),
        };
      }),
    };
  });
  const selectedCell = values
    .find(
      (r) =>
        r.object ===
        (direction === "forward" ? selected?.collocate : selected?.lemma),
    )
    ?.cells.find(
      (c) =>
        c.word ===
        (direction === "forward" ? selected?.lemma : selected?.collocate),
    );
  const maximum = Math.max(
    1,
    ...values.flatMap((r) => r.cells.map((c) => c.count)),
  );
  return (
    <section
      className={`comparison-section ${compact ? "compact" : ""}`}
      aria-labelledby={
        compact ? "comparison-title-compact" : "comparison-title"
      }
    >
      <div className="comparison-heading">
        <div>
          <div className="icon-title">
            <ArrowLeftRight size={20} />
            <h2 id={compact ? "comparison-title-compact" : "comparison-title"}>
              {t("compareTitle")}
            </h2>
          </div>
          <p>{t("compareHelp")}</p>
        </div>
        <div className="segmented">
          <button
            className={mode === "count" ? "active" : ""}
            aria-pressed={mode === "count"}
            onClick={() => setMode("count")}
          >
            {t("countMode")}
          </button>
          <button
            className={mode === "preference" ? "active" : ""}
            aria-pressed={mode === "preference"}
            onClick={() => setMode("preference")}
          >
            {t("preference")}
          </button>
          <button
            className={mode === "rate" ? "active" : ""}
            aria-pressed={mode === "rate"}
            onClick={() => setMode("rate")}
          >
            {t("rateMode")}
          </button>
        </div>
      </div>
      {!compact && (
        <SenseChoices
          word={words[0]}
          relation={relation}
          direction={direction}
          lang={lang}
          onChoose={(w, o) => {
            onApply(w, o, relation, direction);
            setRowOrder(o.length ? "specified" : "distinctive");
          }}
        />
      )}
      {!compact && (
        <details
          className="comparison-editor"
          onToggle={(e) => setEditorOpen(e.currentTarget.open)}
        >
          <summary>
            {t("editComparisons")}
            <span>{words.join(" · ")}</span>
          </summary>
          {editorOpen && (
            <SynonymExplorer
              word={words[0]}
              words={words}
              relation={relation}
              direction={direction}
              context={objects.length === 1 ? objects[0] : undefined}
              lang={lang}
              onChange={(w) => onApply(w, objects, relation, direction)}
              onPreset={(w, o) => {
                onApply(w, o, relation, direction);
                setRowOrder(o.length ? "specified" : "distinctive");
              }}
            />
          )}
          {!compact && (
            <form
              className="compare-form"
              onSubmit={(e) => {
                e.preventDefault();
                const w = wordInput
                  .toLowerCase()
                  .split(/[,、，]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (
                  w.length < 2 ||
                  w.length > 6 ||
                  new Set(w).size !== w.length ||
                  w.some((s) => !/^[a-z][a-z-]{0,29}$/.test(s))
                ) {
                  setInputError(true);
                  return;
                }
                setInputError(false);
                const requested = [
                  ...new Set(
                    objectInput
                      .split(/[,、，]/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((s) => {
                        const parsed = interpret(s);
                        return parsed.object ?? parsed.word;
                      }),
                  ),
                ];
                setRowOrder(requested.length ? "specified" : "distinctive");
                onApply(w, requested, relationInput, directionInput);
              }}
            >
              <label>
                {t("compareWords")}
                <input
                  value={wordInput}
                  onChange={(e) => setWordInput(e.target.value)}
                  aria-invalid={inputError}
                  aria-describedby={inputError ? "compare-error" : undefined}
                />
              </label>
              <label>
                {t("compareObject")}
                <input
                  value={objectInput}
                  onChange={(e) => setObjectInput(e.target.value)}
                  placeholder="risk / price / rain"
                  maxLength={40}
                />
              </label>
              <label>
                {t("relation")}
                <select
                  value={relationInput}
                  onChange={(e) => setRelationInput(e.target.value)}
                >
                  {summary.relations.map(({ relation: r }) => (
                    <option key={r} value={r}>
                      {t(r)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("compareDirection")}
                <select
                  value={directionInput}
                  onChange={(e) =>
                    setDirectionInput(e.target.value as Direction)
                  }
                >
                  <option value="forward">{t("forwardComparison")}</option>
                  <option value="reverse">{t("reverseComparison")}</option>
                </select>
              </label>
              <button className="btn" type="submit">
                {t("apply")}
                <ArrowRight size={15} />
              </button>
              {inputError && (
                <p className="form-error" id="compare-error" role="alert">
                  {t("comparisonError")}
                </p>
              )}
            </form>
          )}
        </details>
      )}
      <div className="matrix-toolbar">
        <label className="row-order">
          {t("rowOrder")}
          <select
            value={rowOrder}
            onChange={(e) => {
              setRowOrder(e.target.value as RowOrder);
              setSource("combined");
            }}
          >
            {(
              ["distinctive", "shared", "frequent", "specified"] as RowOrder[]
            ).map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </label>
        {canSource && (
          <label className="source-picker">
            <Database size={13} />
            <select
              aria-label={t("source")}
              value={source}
              onChange={(e) => {
                setBenchmark(null);
                setSource(e.target.value);
              }}
            >
              <option value="combined">{t("allSources")}</option>
              {summary.sources.map((s) => (
                <option value={s.source} key={s.source}>
                  {s.source}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
        )}
      </div>
      <p className="discovery-note">{t("discoveryHelp")}</p>
      {error && (
        <p className="form-error" role="alert">
          {t("error")}
        </p>
      )}
      {loading ||
      entryKey !== loadKey ||
      !words.every((w) => w in entries) ||
      (source !== "combined" && (!benchmark || !canSource)) ? (
        <Loading t={t} />
      ) : (
        <div className="matrix-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">{t("partner")}</th>
                {words.map((w) => (
                  <th scope="col" key={w}>
                    {w}
                    {w !== words[0] && (
                      <small
                        className="candidate-source"
                        title={t("candidateSource")}
                      >
                        {(() => {
                          const kind = candidatesFor(
                            candidateMetadata,
                            relation,
                            direction,
                          ).find((c) => c.word === w)?.kind;
                          return t(
                            kind === "synonym"
                              ? "synonymSource"
                              : kind === "similar" || kind === "related"
                                ? "relatedSource"
                                : candidateMetadata.gloss_neighbours?.[
                                      `${relation}:${direction}`
                                    ]?.some((c) => c.word === w)
                                  ? "definitionSource"
                                  : "contextSource",
                          );
                        })()}
                      </small>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {values.map((row) => (
                <tr key={row.object}>
                  <th scope="row">
                    <strong>{row.object}</strong>
                    <small>{gloss(lang, row.object)}</small>
                  </th>
                  {row.cells.map((c) => {
                    const active =
                      (direction === "forward"
                        ? selected?.lemma
                        : selected?.collocate) === c.word &&
                      (direction === "forward"
                        ? selected?.collocate
                        : selected?.lemma) === row.object &&
                      selected?.relation === relation;
                    const v =
                      mode === "count"
                        ? c.count
                        : mode === "rate"
                          ? c.rate
                          : c.score;
                    const intensity =
                      mode === "count"
                        ? Math.log1p(c.count) / Math.log1p(maximum)
                        : mode === "rate"
                          ? Math.min(
                              1,
                              (c.rate ?? 0) /
                                Math.max(
                                  1,
                                  ...values.flatMap((r) =>
                                    r.cells.map((c) => c.rate ?? 0),
                                  ),
                                ),
                            )
                          : (c.score ?? 0);
                    return (
                      <td key={c.word}>
                        <button
                          className={`heat-cell level-${c.count ? Math.min(4, Math.ceil(intensity * 4)) : 0} ${active ? "cell-selected" : ""}`}
                          onClick={() =>
                            onSelect(
                              canonicalPair(
                                c.word,
                                row.object,
                                relation,
                                direction,
                              ),
                            )
                          }
                          aria-pressed={active}
                          title={`${phrase(canonicalPair(c.word, row.object, relation, direction))}: ${format(lang, c.count)} ${t("observed")}, ${format(lang, c.docs)} ${t("documents")}`}
                        >
                          <span>
                            {v === null
                              ? "—"
                              : format(lang, v, mode === "count" ? 0 : 2)}
                          </span>
                          {active && <span className="cell-dot" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && entryKey === loadKey && !error && !values.length && (
        <p className="inline-empty">{t("noRows")}</p>
      )}
      <div className="matrix-foot">
        <p>
          <Info size={14} />
          {t(
            mode === "count"
              ? "zeroHelp"
              : mode === "rate"
                ? "rateHelp"
                : "preferenceHelp",
          )}
        </p>
        <div className="heat-legend">
          <span>0</span>
          {[0, 1, 2, 3, 4].map((v) => (
            <i key={v} className={`level-${v}`} />
          ))}
          <span>
            {mode === "preference"
              ? "1"
              : mode === "rate"
                ? format(
                    lang,
                    Math.max(
                      1,
                      ...values.flatMap((r) => r.cells.map((c) => c.rate ?? 0)),
                    ),
                    2,
                  )
                : format(lang, maximum)}
          </span>
        </div>
      </div>
      {selectedCell &&
        selected &&
        !loading &&
        entryKey === loadKey &&
        !error &&
        words.every((w) => w in entries) &&
        (source === "combined" || (!!benchmark && canSource)) && (
          <ComparisonDetail
            lang={lang}
            selected={selected}
            row={selectedCell}
            all={
              values.find(
                (r) =>
                  r.object ===
                  (direction === "forward"
                    ? selected.collocate
                    : selected.lemma),
              )?.cells ?? []
            }
            onSelect={onSelect}
            direction={direction}
          />
        )}
    </section>
  );
}

function ComparisonDetail({
  lang,
  selected,
  row,
  all,
  onSelect,
  direction,
}: {
  lang: Lang;
  selected: Selection;
  row: { count: number; docs: number; score: number | null };
  all: { word: string; count: number; docs: number; score: number | null }[];
  onSelect: (s: Selection) => void;
  direction: Direction;
}) {
  const t = (s: string) => tr(lang, s),
    max = Math.max(1, ...all.map((c) => c.count));
  return (
    <div className="comparison-insight">
      <div>
        <span
          className={`evidence-badge ${row.count ? "attested" : "unobserved"}`}
        >
          {t(row.count ? "observedBadge" : "zero")}
        </span>
        <h3>{phrase(selected)}</h3>
        <p>
          <strong>{format(lang, row.count)}</strong> {t("observed")}{" "}
          <span>·</span> <strong>{format(lang, row.docs)}</strong>{" "}
          {t("documents")}
        </p>
        <small>{t(row.count ? "frequencyNote" : "zeroHelp")}</small>
      </div>
      <div className="choice-bars" aria-label={t("compare")}>
        {[...all]
          .sort((a, b) => b.count - a.count)
          .map((c) => (
            <button
              className={
                c.word ===
                (direction === "forward" ? selected.lemma : selected.collocate)
                  ? "active"
                  : ""
              }
              key={c.word}
              onClick={() =>
                onSelect(
                  canonicalPair(
                    c.word,
                    direction === "forward"
                      ? selected.collocate
                      : selected.lemma,
                    selected.relation,
                    direction,
                  ),
                )
              }
            >
              <span>{c.word}</span>
              <i>
                <b style={{ width: `${(100 * c.count) / max}%` }} />
              </i>
              <strong>{format(lang, c.count)}</strong>
            </button>
          ))}
      </div>
    </div>
  );
}

function About({ lang, summary }: { lang: Lang; summary: Summary }) {
  const t = (s: string) => tr(lang, s);
  return (
    <article className="about-page">
      <div className="about-intro">
        <span className="outline-label">
          <Database size={15} />
          {t("corpus")}
        </span>
        <h1>{t("methodTitle")}</h1>
        <p>{t("methodBody")}</p>
      </div>
      <div className="about-stats">
        <div>
          <strong>{format(lang, summary.words)}</strong>
          <span>{t("words")}</span>
        </div>
        <div>
          <strong>{format(lang, summary.documents)}</strong>
          <span>{t("docs")}</span>
        </div>
        <div>
          <strong>{format(lang, summary.pair_count)}</strong>
          <span>{t("combinations")}</span>
        </div>
      </div>
      <section>
        <h2>{t("sampling")}</h2>
        <div className="source-breakdown">
          {summary.sources.map((s, i) => (
            <div key={s.source}>
              <div>
                <strong>{s.source}</strong>
                <span>
                  {format(lang, s.words)} {t("words")} ·{" "}
                  {format(lang, s.documents)} {t("docs")}
                </span>
              </div>
              <div className="source-bar">
                <span
                  className={`register-color-${i}`}
                  style={{ width: `${(100 * s.words) / summary.words}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p>{t("limitsBody")}</p>
      </section>
      <section className="method-grid">
        <div>
          <h2>{t("limits")}</h2>
          <p>{t("limitsBody")}</p>
          <p>{t("zeroHelp")}</p>
        </div>
        <div>
          <h2>{t("recency")}</h2>
          <p>{t("recencyBody")}</p>
          <p>
            {summary.earliest_year}–{summary.latest_year} · {t("source")} /{" "}
            {summary.snapshot} · snapshot
          </p>
        </div>
      </section>
      <section>
        <h2>{t("license")}</h2>
        <p>{t("licenseBody")}</p>
        <ul className="source-links">
          <li>
            <a
              href="https://gucorpling.org/gum/cite_amalgum.html"
              target="_blank"
              rel="noreferrer"
            >
              AMALGUM — Gessler et al. (2020)
              <ExternalLink size={14} />
            </a>
            <p>
              Annotations: CC BY 4.0. Text: Wikipedia / Wikivoyage CC BY-SA 3.0,
              Wikinews CC BY 2.5, MDPI CC BY 4.0.
            </p>
          </li>
          <li>
            <a
              href="https://huggingface.co/datasets/Salesforce/wikitext"
              target="_blank"
              rel="noreferrer"
            >
              WikiText-103 — Salesforce
              <ExternalLink size={14} />
            </a>
            <p>
              CC BY-SA 3.0 / GFDL · 28,235 eligible train articles · revision
              b08601e04326c79dfdd32d625aee71d232d685c3
            </p>
          </li>
          <li>
            <a
              href="https://anc.org/data/oanc/"
              target="_blank"
              rel="noreferrer"
            >
              Open American National Corpus
              <ExternalLink size={14} />
            </a>
            <p>
              Open OANC distribution: unrestricted use and redistribution.
              Source headers retained locally; book chapters grouped where
              bibliographic identity is known.
            </p>
          </li>
          <li>
            <a
              href="https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0"
              target="_blank"
              rel="noreferrer"
            >
              spaCy en_core_web_sm 3.8.0
              <ExternalLink size={14} />
            </a>
            <p>
              AMALGUM uses its distributed basic UD annotations. WikiText and
              OANC use extraction-specific mappings from spaCy dependencies.
            </p>
          </li>
        </ul>
      </section>
      <section>
        <h2>{t("register")}</h2>
        <div className="register-catalog">
          {summary.registers.map((r) => (
            <div key={r.register}>
              <strong>{t(r.register)}</strong>
              <span>
                {format(lang, r.words)} {t("words")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
