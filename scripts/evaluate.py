"""Publish actual observed results, including failures to support the hypotheses."""
import argparse
import csv
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.engine import Engine, ROOT, DEFAULT_DB

TARGETS=["risk","impact","burden","pain","price","emission","temperature"]
SECONDARY=[
    ("amod",["strong","heavy"],["rain"]),
    ("amod",["big","large","serious"],["mistake"]),
    ("amod",["high","strong","real"],["possibility"]),
    ("dobj",["do","make"],["decision"]),
    ("amod",["powerful","strong"],["coffee"]),
    ("amod",["large","strong","great"],["influence"]),
    ("dobj",["raise","increase"],["temperature","unemployment"]),
    ("dobj",["solve","resolve","address"],["problem"]),
]


def save(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf-8")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--db",type=Path,default=DEFAULT_DB)
    parser.add_argument("--output",type=Path,default=ROOT / "reports")
    args=parser.parse_args()
    out=args.output
    out.mkdir(exist_ok=True)
    engine=Engine(args.db)
    try:
        summary=engine.summary()
        save(out / "corpus_summary.json",summary)
        manifest=engine.manifest()
        save(out / "manifest.json",manifest)
        words=engine.config["synonyms"]
        comparison=engine.compare(words,TARGETS)
        save(out / "comparison.json",comparison)
        phase1=[]
        for row in comparison["rows"]:
            for word,cell in row["cells"].items():
                pref=cell["synonym_preference"]
                phase1.append(dict(verb=word,object=row["collocate"],count=cell["count"],
                    documents=cell["documents"],per_million=cell["per_million"],
                    log_dice=cell["statistics"]["log_dice"],
                    preference=pref["preference_score"],share=pref["observed_share"],
                    baseline=pref["baseline_share"],status=cell["status"],
                    expected=cell["negative_evidence"]["expected_count"],
                    register_adjusted_expected=cell["negative_evidence"]["stratified_expected_count"],
                    adjusted_p=cell["negative_evidence"]["adjusted_p"]))
        with (out / "comparison.csv").open("w",newline="",encoding="utf-8-sig") as handle:
            writer=csv.DictWriter(handle,fieldnames=list(phase1[0]))
            writer.writeheader()
            writer.writerows(phase1)
        save(out / "phrase_lessen_price.json",engine.phrase("lessen the price"))
        save(out / "gaps_lessen.json",engine.gaps("lessen"))
        save(out / "word_lessen.json",engine.word("lessen",limit=50))
        secondary=[engine.compare(words,objects,relation) for relation,words,objects in SECONDARY]
        save(out / "secondary_benchmarks.json",secondary)
        # Audit source URL reuse. A document ID need not represent an independent original.
        reused=engine.rows("""SELECT source_url,count(*) documents,sum(words) words
                      FROM documents WHERE source_url IS NOT NULL GROUP BY source_url
                      HAVING count(*)>1 ORDER BY documents DESC""")
        save(out / "source_url_reuse.json",reused)
        kwic={}
        for row in comparison["rows"]:
            for word,cell in row["cells"].items():
                if cell["count"]:
                    kwic[f"{word}/{row['collocate']}"]=engine.kwic(word,row["collocate"],limit=3)
        save(out / "kwic_audit.json",kwic)
        source_label=" / ".join(row["source"] for row in summary["sources"])
        lines=["# 実コーパスによる検証", "", "この報告は scripts/evaluate.py がDBから生成する。仮説に合わせた例文や件数は含まない。", "",
           f"使用標本：{source_label}、{summary['documents']:,}原典文書（{summary['segments']:,}配布区間）、{summary['words']:,}語（句読点・記号を除く）、{summary['tokens']:,}構文token。",
           f"原典ドメインは{summary['domains']}、年が得られる文書は{summary['dated_documents']:,}、国情報を持つ文書は{summary['country_known_documents']:,}。", "",
           "## 動詞・目的語の観測数", "", "集計はlemmaに基づく能動態の名詞目的語。例えば emissions は emission に集約する。冠詞や修飾語を挟む用例も含むため、文字列そのものの件数ではない。", "",
           "| object | " + " | ".join(engine.config["synonyms"]) + " |",
           "|---|"+"---:|"*len(engine.config["synonyms"])]
        for row in comparison["rows"]:
            lines.append("| "+row["collocate"]+" | "+" | ".join(str(row["cells"][w]["count"]) for w in engine.config["synonyms"])+" |")
        lines.extend(["", "## lessen の標本量", ""])
        left=engine.scalar("SELECT coalesce(sum(count),0) FROM pairs WHERE lemma='lessen' AND relation='dobj'")
        lines.append(f"lessenの名詞目的語は全体で{left}件。目的語頻度が高くても、lessen自体の基準頻度が低ければ『出るはずなのに出ない』という証拠は強くならない。")
        lines.extend(["", "| object | count | documents | expected | register-adjusted expected | status |", "|---|---:|---:|---:|---:|---|"])
        for row in comparison["rows"]:
            c=row["cells"]["lessen"]
            e=c["negative_evidence"]
            lines.append(f"| {row['collocate']} | {c['count']} | {c['documents']} | {e['expected_count']:.3f} | {e['stratified_expected_count']:.3f} | {c['status']} |")
        proven=[r["collocate"] for r in comparison["rows"] if r["collocate"] in {"price","emission","temperature"} and r["cells"]["lessen"]["status"]=="strongly dispreferred"]
        lines.extend(["", "## 最初の成功条件の判定", ""])
        if len(proven)==3:
            lines.append("価格・排出・温度の3対象で、この標本と固定ルールにおける相対的な選好差の判定基準を満たした。ただし同一語義・母語話者・文法の検証は未完了。")
        else:
            lines.append(f"未達。価格・排出・温度の3対象のうち、固定した負の証拠の基準を満たしたのは{len(proven)}対象。ゼロ件を不自然と呼ぶために閾値を下げていない。『lessen the priceがなぜ変か』を十分な確信度で説明するには、lessenと競合目的語の標本を追加する必要がある。")
        budget=[]
        lines.extend(["", "## 拡張規模の診断", "",
           "同じ構成比・基準頻度が続くと仮定した、独立モデル期待数10に届くための粗い総語数。検出力の保証ではなく、ジャンルごとの支持・語義・独立出典・多重比較の条件は別に必要。", "",
           "| object | current expected | rough total words for E=10 |", "|---|---:|---:|"])
        for row in comparison["rows"]:
            if row["collocate"] not in {"price","emission","temperature"}:
                continue
            e=row["cells"]["lessen"]["negative_evidence"]["expected_count"]
            required=summary["words"]*engine.config["min_expected"]/e if e else None
            budget.append(dict(object=row["collocate"],current_expected=e,
                        rough_total_words_for_min_expected=required,
                        assumption="unchanged composition and lexical base rates; not a power guarantee"))
            lines.append(f"| {row['collocate']} | {e:.4f} | {required:,.0f} |" if required else f"| {row['collocate']} | 0 | 推定不可 |")
        save(out / "sample_budget.json",budget)
        lines.append("通常の語彙使用に関する学習者向けの結論へ進むには、語義をそろえた比較集合と独立コーパスを使った検証が必要。小標本の語彙集合を結果に合わせて狭めることはしない。")
        lines.extend(["", "## 第二の検証セット（観測のみ）", "",
                      "語義・文法・人手正解ラベルは未評価。小標本で優劣が逆転した場合もそのまま記録する。", "",
                      "| relation | object | observed counts |", "|---|---|---|"])
        for group in secondary:
            for row in group["rows"]:
                lines.append("| "+group["relation"]+" | "+row["collocate"]+" | "+", ".join(w+"="+str(c["count"]) for w,c in row["cells"].items())+" |")
        lines.extend(["", "## 制約と次の段階", "",
           "- AMALGUMは機械注釈。KWICを読んで解析誤り・語義違いを監査する必要がある。",
           "- 複数ジャンルでも原典は少数のサイト。文書数の多さを独立した話者数とみなさない。",
           f"- 同じ原典URLを持つ複数区間のグループは{len(reused)}。原典URLでまとめた文書数・分散に修正済み。source_url_reuse.jsonに記録。正規化全文の完全重複は取り込みで除去したが近似重複は未除去。",
           "- 国情報からAmE/BrEを比較できない。interviewを自然会話の代用にしない。",
           "- 年不明の資料があり、最近の使用を保証しない。収集年を作成年に置換しない。",
           "- 自然さスコアは未較正の実験値。希少・未観測・データ不足ではNULLを許す。",
           "- 意味カテゴリ・semantic prosody・日本語逆引きは後続フェーズ。LLM APIは呼んでいない。",
           "- 次は同じ分母・重複除去・権利記録を維持して、独立した出典を持つ追加資料で標本を拡張する。",
           "", "## 再現性", "",
           "コーパスのrevision・commitと各ファイルのSHA256はmanifest.json、統計はcomparison.json/CSV、実例と出典はkwic_audit.jsonに保存。",
           "", "引用：Gessler et al. (2020), AMALGUM – A Free, Balanced, Multilayer English Web Corpus. https://aclanthology.org/2020.lrec-1.648/",
           "原文・注釈の条件：https://github.com/gucorpling/amalgum#license", ""])
        (out / "REPORT_JA.md").write_text("\n".join(lines),encoding="utf-8")
        print(json.dumps(dict(summary=summary,report=str(out / "REPORT_JA.md")),ensure_ascii=False))
    finally:
        engine.close()


if __name__=="__main__":
    main()
