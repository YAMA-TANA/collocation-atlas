# コーパス拡張の実測結果

総語数は 2,164,907 → 11,026,154（5.09倍）、原典文書数は 2,648 → 5,597。
lessenの能動態名詞目的語は 8 → 39件。

## 資料別の構成

| source | words | original documents | lessen objects |
|---|---:|---:|---:|
| AMALGUM | 2,164,907 | 2,648 | 8 |
| WikiText-103 | 8,861,247 | 2,949 | 31 |

## 拡張後の観測数

同じlemma・能動態の名詞目的語として集計。冠詞や修飾語を含む用例もまとめる。

| object | lessen | reduce | decrease | lower | diminish | cut |
|---|---:|---:|---:|---:|---:|---:|
| risk | 1 | 47 | 15 | 1 | 0 | 0 |
| impact | 6 | 22 | 0 | 0 | 0 | 0 |
| burden | 1 | 5 | 0 | 0 | 0 | 0 |
| pain | 2 | 1 | 0 | 0 | 0 | 0 |
| price | 0 | 3 | 2 | 7 | 0 | 2 |
| emission | 0 | 32 | 0 | 1 | 0 | 8 |
| temperature | 0 | 8 | 3 | 3 | 0 | 0 |

## lessenの判定と負の証拠

| object | count | documents | expected | source/register adjusted expected | status |
|---|---:|---:|---:|---:|---|
| risk | 1 | 1 | 1.135 | 1.151 | rare but attested |
| impact | 6 | 6 | 0.496 | 0.366 | marked |
| burden | 1 | 1 | 0.106 | 0.102 | rare but attested |
| pain | 2 | 2 | 0.053 | 0.059 | rare but attested |
| price | 0 | 0 | 0.248 | 0.246 | insufficient data |
| emission | 0 | 0 | 0.727 | 0.668 | insufficient data |
| temperature | 0 | 0 | 0.248 | 0.260 | insufficient data |

## 取得・選択・解析

- Salesforce公式配布WikiText-103 raw trainのParquet 2ファイルを固定revision・SHA256で検証。
- 全記事を固定seedのハッシュ順に並べ、指定した累積語数まで記事単位で選択。対象動詞・目的語を見て選ぶサンプリングは行わない。
- データ内の同名記事を1つにし、既存AMALGUMと同じと分かるWikipedia原典URLを除外。完全一致テキストの重複除去もDB構築時に行う。
- spaCy en_core_web_sm 3.8.0で全文を解析し、抽出対象のラベルだけ共通化。AMALGUMと同一の解析器ではないため、出典別の結果も保存。
- 分母は解析した全文の語数。特定の動詞を含む文だけを解析して全体頻度に見せる処理は行わない。
- sourceパラメーターで出典を絞れる。負の証拠の層別期待数もsource×registerで計算。

## 限界

- 追加資料はWikipediaのGood/Featured記事で、百科事典への偏りが強い。独立した新しいドメインや自然会話を増やしたわけではない。
- 記事の正確な版ID・作成年・著者・方言は元データにない。year/country/authorはNULL。見出しから復元した原典URLであることをmetadataに記録。現代使用の保証には使わない。
- 元データの分かち書きや表の断片、機械解析誤りは残る。句の意味・文法の正否は未評価。
- 閾値は標本拡張のために緩めていない。rare/absentをwrongと判定しない。

出典・利用条件：https://huggingface.co/datasets/Salesforce/wikitext （CC BY-SA 3.0/GFDLの表示あり）。解析モデル：https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0 。

再現用manifestと出典別JSON/CSV、KWICは同じディレクトリに保存。初回報告はreports/REPORT_JA.mdに保存したまま。
