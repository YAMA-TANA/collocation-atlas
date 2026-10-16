# コーパス拡張の実測結果

直前のDBとの比較：11,026,154 → 102,072,709語（9.26倍）、5,597 → 39,541原典文書。lessenの目的語は39 → 298件。

総語数は 2,164,907 → 102,072,709（47.15倍）、原典文書数は 2,648 → 39,541。
lessenの能動態名詞目的語は 8 → 298件。

## 資料別の構成

| source | words | original documents | lessen objects |
|---|---:|---:|---:|
| AMALGUM | 2,164,907 | 2,648 | 8 |
| WikiText-103 | 84,877,310 | 28,235 | 248 |
| OANC | 15,030,492 | 8,658 | 42 |

解析対象：WikiText-103: 28,235解析ファイル（対象全量）、OANC: 8,824解析ファイル（対象全量）。原典文書数とは分けて数える。

## 拡張後の観測数

同じlemma・能動態の名詞目的語として集計。冠詞や修飾語を含む用例もまとめる。

| object | lessen | reduce | decrease | lower | diminish | cut |
|---|---:|---:|---:|---:|---:|---:|
| risk | 11 | 387 | 76 | 18 | 5 | 3 |
| impact | 23 | 101 | 4 | 1 | 11 | 0 |
| burden | 11 | 50 | 8 | 6 | 3 | 0 |
| pain | 4 | 23 | 1 | 0 | 0 | 1 |
| price | 0 | 59 | 6 | 62 | 0 | 19 |
| emission | 0 | 203 | 5 | 3 | 0 | 24 |
| temperature | 0 | 23 | 23 | 37 | 0 | 0 |

## lessenの判定と負の証拠

| object | count | documents | expected | source/register adjusted expected | status |
|---|---:|---:|---:|---:|---|
| risk | 11 | 11 | 7.434 | 7.311 | normal |
| impact | 23 | 23 | 2.082 | 2.052 | normal |
| burden | 11 | 11 | 1.160 | 1.148 | normal |
| pain | 4 | 4 | 0.431 | 0.426 | marked |
| price | 0 | 0 | 2.171 | 2.271 | insufficient data |
| emission | 0 | 0 | 3.494 | 3.775 | insufficient data |
| temperature | 0 | 0 | 1.234 | 1.299 | insufficient data |

## 取得・選択・解析

- Salesforce公式配布WikiText-103 raw trainのParquet 2ファイルを固定revision・SHA256で検証。
- 全記事を固定seedのハッシュ順に並べ、指定した累積語数まで記事単位で選択。対象動詞・目的語を見て選ぶサンプリングは行わない。
- データ内の同名記事を1つにし、既存AMALGUMと同じと分かるWikipedia原典URLを除外。完全一致テキストの重複除去もDB構築時に行う。
- spaCy en_core_web_sm 3.8.0で全文を解析し、抽出対象のラベルだけ共通化。AMALGUMと同一の解析器ではないため、出典別の結果も保存。
- 分母は解析した全文の語数。特定の動詞を含む文だけを解析して全体頻度に見せる処理は行わない。
- sourceパラメーターで出典を絞れる。負の証拠の層別期待数もsource×registerで計算。

## 限界

- WikiText部分はWikipediaのGood/Featured記事で、百科事典への偏りが強い。
- WikiText記事の正確な版ID・作成年・著者・方言は元データにない。year/country/authorはNULL。見出しから復元した原典URLであることをmetadataに記録。現代使用の保証には使わない。
- 元データの分かち書きや表の断片、機械解析誤りは残る。句の意味・文法の正否は未評価。
- 閾値は標本拡張のために緩めていない。rare/absentをwrongと判定しない。

出典・利用条件：https://huggingface.co/datasets/Salesforce/wikitext （CC BY-SA 3.0/GFDLの表示あり）。解析モデル：https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0 。

再現用manifestと出典別JSON/CSV、KWICは同じディレクトリに保存。初回報告はreports/REPORT_JA.mdに保存したまま。

文書頻度の原典単位：OANCの同じISBNに属する章は1冊としてまとめる。旅行ガイドも配布コレクション・書名・出版社が同じ節をまとめる。用例数・語数は保持し、1冊内の反復で文書分散を過大評価しない。根拠は各文書の原ヘッダーに保存。

## OANCの追加

公式OANC-GrAF配布アーカイブの原文と文書別.ancヘッダーを使用。配布済みparseの文書対応を推測せず、原文を同じspaCyモデルで再解析した。会話・雑誌・学術・技術・旅行等を配布ディレクトリから区別し、刊行年と著者はsourceDescから取得した。ヘッダー作成年を原文年に流用しない。元ヘッダーも保持する。原典URLが不明な場合、資料内の文書パスを一意の識別子として保持し、雑誌トップページを原文書URLとして文書数を過小評価しない。

OANCの設計上は米語資料だが、個々の話者の方言までは検証していないためcountryを一括でUSにしない。OANCは新しいジャンルを加えるが、新しい年代を保証するものではない。

利用条件・配布元：https://anc.org/data/oanc/ / https://anc.org/data/oanc/download/ 。OANCとして配布されたオープン部分のみを使用し、有料のANC Second Releaseは取得していない。

## 今回の判断

risk・impact・burdenとの組み合わせはそれぞれ11・23・11の原典文書で観測された。painは4文書で、現在の固定ルールではmarked。これは誤りの判定ではない。

price・emission・temperatureとのlessenはこの標本の能動態名詞目的語として0件。ただし出典・ジャンル調整後の期待数は2.271・3.775・1.299で、最低期待数10に達していない。競合表現は観測されているが、0件だけでstrongly dispreferredとはしない。最初の成功条件である3語の強い非選好の統計的確認は未達であり、判定閾値は緩めていない。意味と文法も未評価のまま。

## 完了確認

- 既存の全資料が同一内容で含まれることを照合し、既定DBを新DBに切り替えた。直前の11,026,154語版はdata/collocations_before_11026154.duckdbに保持。
- 単体テスト24件成功。既存42比較セルの回帰確認に差分なし。
- 実DBのAPI 13件すべて200。Parquet 6表の行数一致。
- 依存関係34,688,327件とpairs・pair_strataの合計が一致。文書に結びつかない記録は0件。
- risk・impact・burden・painのKWICを各2件、合計8件確認。抽出関係と文脈が対応していた。全コーパスの解析精度を保証する検査ではない。

検証記録は[verification.json](verification.json)、[smoke_check.json](smoke_check.json)、[integrity.json](integrity.json)、[tests.log](tests.log)に保存。
