"""Before/after and source-separated validation, without erasing pilot reports."""
import argparse
import csv
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collocations.engine import Engine,ROOT
from scripts.evaluate import TARGETS,SECONDARY


def save(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf-8")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--db",type=Path,default=ROOT / "data" / "collocations_expanded.duckdb")
    parser.add_argument("--previous-db",type=Path)
    parser.add_argument("--output",type=Path,default=ROOT / "reports" / "expansion")
    args=parser.parse_args()
    out=args.output
    out.mkdir(exist_ok=True)
    engines={"combined":Engine(args.db),"AMALGUM":Engine(args.db,source="AMALGUM"),
             "WikiText-103":Engine(args.db,source="WikiText-103")}
    if any(r["source"]=="OANC" for r in engines["combined"].summary()["sources"]):
        engines["OANC"]=Engine(args.db,source="OANC")
    try:
        summaries={k:e.summary() for k,e in engines.items()}
        save(out / "summaries.json",summaries)
        combined=engines["combined"]
        manifest=combined.manifest()
        save(out / "manifest.json",manifest)
        words=combined.config["synonyms"]
        comparisons={k:e.compare(words,TARGETS) for k,e in engines.items()}
        for k,result in comparisons.items():
            save(out / f"comparison_{k}.json",result)
        save(out / "phrase_lessen_price.json",combined.phrase("lessen the price"))
        save(out / "word_lessen.json",combined.word("lessen",limit=100))
        save(out / "gaps_lessen.json",combined.gaps("lessen",limit=50))
        save(out / "secondary_benchmarks.json",[combined.compare(ws,objects,rel) for rel,ws,objects in SECONDARY])
        # Keep up to five examples per target, one per original document.
        examples={obj:combined.kwic("lessen",obj,limit=5) for obj in TARGETS}
        save(out / "kwic_lessen.json",examples)
        rows=[]
        for source,result in comparisons.items():
            for row in result["rows"]:
                for word,c in row["cells"].items():
                    rows.append(dict(source=source,verb=word,object=row["collocate"],count=c["count"],
                        documents=c["documents"],per_million=c["per_million"],status=c["status"],
                        preference=c["synonym_preference"]["preference_score"],
                        expected=c["negative_evidence"]["expected_count"],
                        stratified_expected=c["negative_evidence"]["stratified_expected_count"]))
        with (out / "comparison.csv").open("w",encoding="utf-8-sig",newline="") as handle:
            writer=csv.DictWriter(handle,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        totals={name:e.scalar("SELECT coalesce(sum(count),0) FROM scoped_pairs WHERE lemma='lessen' AND relation='dobj'") for name,e in engines.items()}
        old,new=summaries["AMALGUM"],summaries["combined"]
        previous=None
        if args.previous_db:
            prev_engine=Engine(args.previous_db)
            try:
                previous=dict(summary=prev_engine.summary(),lessen_objects=prev_engine.scalar("SELECT coalesce(sum(count),0) FROM pairs WHERE lemma='lessen' AND relation='dobj'"))
            finally: prev_engine.close()
            save(out / "previous.json",previous)
        lines=["# コーパス拡張の実測結果","",
            f"総語数は {old['words']:,} → {new['words']:,}（{new['words']/old['words']:.2f}倍）、原典文書数は {old['documents']:,} → {new['documents']:,}。",
            f"lessenの能動態名詞目的語は {totals['AMALGUM']} → {totals['combined']}件。","",
            "## 資料別の構成","","| source | words | original documents | lessen objects |","|---|---:|---:|---:|"]
        for k in [k for k in engines if k!="combined"]:
            s=summaries[k];lines.append(f"| {k} | {s['words']:,} | {s['documents']:,} | {totals[k]} |")
        if previous:
            p=previous["summary"]
            lines[2:2]=[f"直前のDBとの比較：{p['words']:,} → {new['words']:,}語（{new['words']/p['words']:.2f}倍）、{p['documents']:,} → {new['documents']:,}原典文書。lessenの目的語は{previous['lessen_objects']} → {totals['combined']}件。",""]
        selections=[]
        for source in manifest.get("sources",[]):
            parsed=source.get("parse_manifest",{})
            selected=parsed.get("selected_articles")
            if selected is not None:
                full=source["source"]=="OANC" or selected==parsed.get("available_articles")
                selections.append(f"{source['source']}: {selected:,}解析ファイル（{'対象全量' if full else '部分標本'}）")
        if selections:
            lines.extend(["","解析対象："+"、".join(selections)+"。原典文書数とは分けて数える。"])
        lines.extend(["","## 拡張後の観測数","",
            "同じlemma・能動態の名詞目的語として集計。冠詞や修飾語を含む用例もまとめる。","",
            "| object | "+" | ".join(words)+" |","|---|"+"---:|"*len(words)])
        for row in comparisons["combined"]["rows"]:
            lines.append("| "+row["collocate"]+" | "+" | ".join(str(row["cells"][w]["count"]) for w in words)+" |")
        lines.extend(["","## lessenの判定と負の証拠","",
            "| object | count | documents | expected | source/register adjusted expected | status |","|---|---:|---:|---:|---:|---|"])
        for row in comparisons["combined"]["rows"]:
            c=row["cells"]["lessen"];e=c["negative_evidence"]
            lines.append(f"| {row['collocate']} | {c['count']} | {c['documents']} | {e['expected_count']:.3f} | {e['stratified_expected_count']:.3f} | {c['status']} |")
        lines.extend(["","## 取得・選択・解析","",
            "- Salesforce公式配布WikiText-103 raw trainのParquet 2ファイルを固定revision・SHA256で検証。",
            "- 全記事を固定seedのハッシュ順に並べ、指定した累積語数まで記事単位で選択。対象動詞・目的語を見て選ぶサンプリングは行わない。",
            "- データ内の同名記事を1つにし、既存AMALGUMと同じと分かるWikipedia原典URLを除外。完全一致テキストの重複除去もDB構築時に行う。",
            "- spaCy en_core_web_sm 3.8.0で全文を解析し、抽出対象のラベルだけ共通化。AMALGUMと同一の解析器ではないため、出典別の結果も保存。",
            "- 分母は解析した全文の語数。特定の動詞を含む文だけを解析して全体頻度に見せる処理は行わない。",
            "- sourceパラメーターで出典を絞れる。負の証拠の層別期待数もsource×registerで計算。","",
            "## 限界","",
            "- WikiText部分はWikipediaのGood/Featured記事で、百科事典への偏りが強い。",
            "- WikiText記事の正確な版ID・作成年・著者・方言は元データにない。year/country/authorはNULL。見出しから復元した原典URLであることをmetadataに記録。現代使用の保証には使わない。",
            "- 元データの分かち書きや表の断片、機械解析誤りは残る。句の意味・文法の正否は未評価。",
            "- 閾値は標本拡張のために緩めていない。rare/absentをwrongと判定しない。","",
            "出典・利用条件：https://huggingface.co/datasets/Salesforce/wikitext （CC BY-SA 3.0/GFDLの表示あり）。解析モデル：https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0 。","",
            "再現用manifestと出典別JSON/CSV、KWICは同じディレクトリに保存。初回報告はreports/REPORT_JA.mdに保存したまま。",""])
        (out / "REPORT_JA.md").write_text("\n".join(lines),encoding="utf-8")
        if "OANC" in engines:
            with (out / "REPORT_JA.md").open("a",encoding="utf-8") as handle:
                handle.write("\n文書頻度の原典単位：OANCの同じISBNに属する章は1冊としてまとめる。旅行ガイドも配布コレクション・書名・出版社が同じ節をまとめる。用例数・語数は保持し、1冊内の反復で文書分散を過大評価しない。根拠は各文書の原ヘッダーに保存。\n")
                handle.write("\n## OANCの追加\n\n公式OANC-GrAF配布アーカイブの原文と文書別.ancヘッダーを使用。配布済みparseの文書対応を推測せず、原文を同じspaCyモデルで再解析した。会話・雑誌・学術・技術・旅行等を配布ディレクトリから区別し、刊行年と著者はsourceDescから取得した。ヘッダー作成年を原文年に流用しない。元ヘッダーも保持する。原典URLが不明な場合、資料内の文書パスを一意の識別子として保持し、雑誌トップページを原文書URLとして文書数を過小評価しない。\n\nOANCの設計上は米語資料だが、個々の話者の方言までは検証していないためcountryを一括でUSにしない。OANCは新しいジャンルを加えるが、新しい年代を保証するものではない。\n\n利用条件・配布元：https://anc.org/data/oanc/ / https://anc.org/data/oanc/download/ 。OANCとして配布されたオープン部分のみを使用し、有料のANC Second Releaseは取得していない。\n")
        print(json.dumps(dict(words=new["words"],documents=new["documents"],lessen_objects=totals,
                              report=str(out / "REPORT_JA.md")),ensure_ascii=True))
    finally:
        for engine in engines.values(): engine.close()


if __name__=="__main__": main()
