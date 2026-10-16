# 実コーパスによる初回検証

この報告は scripts/evaluate.py がDBから生成する。仮説に合わせた例文や件数は含まない。

使用標本：AMALGUM、2,648原典文書（3,220配布区間）、2,164,907語（句読点・記号を除く）、2,499,981構文token。
原典ドメインは4、年が得られる文書は1,532、国情報を持つ文書は0。

## 動詞・目的語の観測数

集計はlemmaに基づく能動態の名詞目的語。例えば emissions は emission に集約する。冠詞や修飾語を挟む用例も含むため、文字列そのものの件数ではない。

| object | lessen | reduce | decrease | lower | diminish | cut |
|---|---:|---:|---:|---:|---:|---:|
| risk | 1 | 13 | 0 | 0 | 0 | 0 |
| impact | 2 | 15 | 0 | 0 | 0 | 0 |
| burden | 0 | 3 | 0 | 0 | 0 | 0 |
| pain | 0 | 0 | 0 | 0 | 0 | 0 |
| price | 0 | 1 | 1 | 0 | 0 | 0 |
| emission | 0 | 17 | 0 | 0 | 0 | 4 |
| temperature | 0 | 1 | 0 | 0 | 0 | 0 |

## lessen の標本量

lessenの名詞目的語は全体で8件。目的語頻度が高くても、lessen自体の基準頻度が低ければ『出るはずなのに出ない』という証拠は強くならない。

| object | count | documents | expected | register-adjusted expected | status |
|---|---:|---:|---:|---:|---|
| risk | 1 | 1 | 0.181 | 0.170 | rare but attested |
| impact | 2 | 2 | 0.219 | 0.151 | rare but attested |
| burden | 0 | 0 | 0.039 | 0.043 | insufficient data |
| pain | 0 | 0 | 0.000 | 0.000 | insufficient data |
| price | 0 | 0 | 0.026 | 0.011 | insufficient data |
| emission | 0 | 0 | 0.271 | 0.276 | insufficient data |
| temperature | 0 | 0 | 0.013 | 0.005 | insufficient data |

## 最初の成功条件の判定

未達。価格・排出・温度の3対象のうち、固定した負の証拠の基準を満たしたのは0対象。ゼロ件を不自然と呼ぶために閾値を下げていない。『lessen the priceがなぜ変か』を十分な確信度で説明するには、lessenと競合目的語の標本を追加する必要がある。

## 拡張規模の診断

同じ構成比・基準頻度が続くと仮定した、独立モデル期待数10に届くための粗い総語数。検出力の保証ではなく、ジャンルごとの支持・語義・独立出典・多重比較の条件は別に必要。

| object | current expected | rough total words for E=10 |
|---|---:|---:|
| price | 0.0258 | 838,901,462 |
| emission | 0.2710 | 79,895,377 |
| temperature | 0.0129 | 1,677,802,925 |
通常の語彙使用に関する学習者向けの結論へ進むには、語義をそろえた比較集合と独立コーパスを使った検証が必要。小標本の語彙集合を結果に合わせて狭めることはしない。

## 第二の検証セット（観測のみ）

語義・文法・人手正解ラベルは未評価。小標本で優劣が逆転した場合もそのまま記録する。

| relation | object | observed counts |
|---|---|---|
| amod | rain | strong=0, heavy=13 |
| amod | mistake | big=0, large=0, serious=0 |
| amod | possibility | high=1, strong=0, real=3 |
| dobj | decision | do=0, make=98 |
| amod | coffee | powerful=0, strong=0 |
| amod | influence | large=2, strong=7, great=5 |
| dobj | temperature | raise=1, increase=4 |
| dobj | unemployment | raise=0, increase=0 |
| dobj | problem | solve=74, resolve=8, address=16 |

## 制約と次の段階

- AMALGUMは機械注釈。KWICを読んで解析誤り・語義違いを監査する必要がある。
- 複数ジャンルでも原典は少数のサイト。文書数の多さを独立した話者数とみなさない。
- 同じ原典URLを持つ複数区間のグループは162。原典URLでまとめた文書数・分散に修正済み。source_url_reuse.jsonに記録。正規化全文の完全重複は取り込みで除去したが近似重複は未除去。
- 国情報からAmE/BrEを比較できない。interviewを自然会話の代用にしない。
- 年不明の資料があり、最近の使用を保証しない。収集年を作成年に置換しない。
- 自然さスコアは未較正の実験値。希少・未観測・データ不足ではNULLを許す。
- 意味カテゴリ・semantic prosody・日本語逆引きは後続フェーズ。LLM APIは呼んでいない。
- 次は同じ分母・重複除去・権利記録を維持して、独立した出典を持つ追加資料で標本を拡張する。

## 再現性

コーパスcommit: `a2dbd33e757f75a61d68d22d1a29e840bdffa711`。各ファイルのSHA256はmanifest.json、統計はcomparison.json/CSV、実例と出典はkwic_audit.jsonに保存。

引用：Gessler et al. (2020), AMALGUM – A Free, Balanced, Multilayer English Web Corpus. https://aclanthology.org/2020.lrec-1.648/
原文・注釈の条件：https://github.com/gucorpling/amalgum#license
