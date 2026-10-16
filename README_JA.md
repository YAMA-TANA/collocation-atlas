# 真実のコロケーション辞典 — 分析エンジン MVP

実際の配布コーパスから依存関係を集計し、類義語の選択傾向と不確実性を返します。
初回結果は [reports/REPORT_JA.md](reports/REPORT_JA.md)、採用理由・条件は [docs/CORPUS_RESEARCH.md](docs/CORPUS_RESEARCH.md) にあります。
最初の拡張は [reports/expansion/REPORT_JA.md](reports/expansion/REPORT_JA.md)、WikiText全量とOANCの追加結果は [reports/full_expansion/REPORT_JA.md](reports/full_expansion/REPORT_JA.md) に保存します。
2026-10-16の統合DBは102,072,709語・39,541原典文書。AMALGUMにWikiText-103の対象全28,235記事とOANCの全文を追加しました。lessenの能動態名詞目的語は298件ですが、price/emission/temperatureの負の証拠は現在もデータ不足です。
LLM、検索ヒット件数、手作りの研究用例文は判定に使用しません。

## 再現

Windows PowerShell、Python 3.10以上、Git、uvで実行できます。

```powershell
cd C:\Users\lotof\Videos\research\live2d\truth_collocations
uv sync --extra test
uv run python scripts/fetch_amalgum.py
uv run python cli.py --db data/pilot_rebuild.duckdb ingest
uv run python scripts/evaluate.py --db data/pilot_rebuild.duckdb --output reports/pilot_rebuild
uv run pytest -q
```

既存DBの更新は別の `.building` ファイルで作成し、成功した時点で置換します。未完了ファイルがあれば上書きせずエラーになります。入力元の変更・権利条件を確認し、未完了ファイルを調べてから再実行してください。

## CLI

```powershell
uv run python cli.py summary
uv run python cli.py word lessen
uv run python cli.py objects lessen
uv run python cli.py compare lessen reduce lower --objects risk impact burden pain price emission temperature
uv run python cli.py phrase "lessen the price"
uv run python cli.py gaps lessen
uv run python cli.py kwic lessen risk --limit 5
uv run python cli.py --register academic compare lessen reduce lower --objects risk price
uv run python cli.py --source WikiText-103 compare lessen reduce lower --objects risk price
uv run python cli.py --country US compare lessen reduce lower
uv run python cli.py --year-from 2010 --year-to 2019 word lessen
uv run python cli.py compare heavy strong --relation amod --objects rain
uv run python cli.py compare make do --objects decision
uv run python cli.py --output reports/custom.json word lessen
uv run python cli.py export data/parquet
```

国情報がない標本に `--country US` を指定した場合、全件を米語と仮定せず空の標本を返します。
`emissions`等はlemmaの`emission`として比較します。限定されたphrase入力は、設定済みの動詞原形＋任意の冠詞＋単純名詞に対応します。目的語の表層形から、コーパス中のlemma候補も返します。
一般の英文解析器・文法チェッカー・語義判定器ではありません。`grammar`と`meaning`は `not assessed` です。

JSONLアダプターには、1行に1文書を入力します。実コーパスの出典と条件を保持してください。

```json
{"document_id":"source:unique-id","metadata":{"source":"licensed-corpus","source_url":"https://example.org/doc","year":2020,"country":null,"register":"academic","domain":"example.org","author":null,"text_license":"CC-BY-4.0","annotation_license":"CC-BY-4.0"},"conllu":"...10列のCoNLL-U本文..."}
```

```powershell
uv run python cli.py --db data/other.duckdb ingest --adapter jsonl --input licensed-documents.jsonl
```

## API

```powershell
uv run uvicorn collocations.api:app --host 127.0.0.1 --port 8000
```

| パス | 用途 |
|---|---|
| `GET /summary` | 標本サイズ・欠損・制約 |
| `GET /word/lessen` | 語のコロケーションと根拠 |
| `GET /collocations/lessen` | 同上 |
| `GET /compare?words=lessen,reduce,lower&objects=risk,price` | 比較 |
| `GET /phrase?text=lessen%20the%20price` | 限定的な句検索 |
| `GET /objects?verb=lessen` | 目的語一覧 |
| `GET /gaps?word=lessen` | 負の証拠と探索候補 |
| `GET /kwic?lemma=lessen&collocate=risk` | 出典・ライセンス付き実例 |

`word`, `collocations`, `compare`, `phrase`, `objects` は `register`, `country`, `year_from`, `year_to` に対応します。別のDBは環境変数 `COLLOCATION_DB` で指定できます。
出典の指定はCLIの `--source`、APIの `source=WikiText-103` 等で行います。
APIはローカル起動用です。インターネット公開の認証・負荷対策は別途必要です。

## 実装済みの範囲

- 公式配布AMALGUMの固定commit取得、原文条件と注釈条件の分離、SHA256 manifest。
- lemmaと表層形の保持、非隣接依存関係、正規化全文の完全重複除去。
- 能動目的語・主語・受動対象・形容詞名詞・名詞複合・副詞・前置詞関連の抽出。
- raw count、語あたり100万頻度、文書・ドメイン・著者ラベル・section数、DP/HHI、PMI/MI3/t-score/logDice/G²/Dice。
- 類義語内のshare・Wilson区間・基準頻度で補正したpreference score。
- 独立モデルとジャンル別モデルの期待数・absence score、標本量のゲート、探索の多重比較補正。
- ジャンル・年・国の欠損を保持した分布と範囲フィルター。KWICは前後40token、異なる文書から取得。
- DuckDB保存、Parquetエクスポート、CLI、FastAPI、固定検証セットと統計的な性質のテスト。

`amod`は形容詞→名詞、`dobj`等は動詞→名詞。`passive_patient`は能動態と混ぜません。
`compound`は主要名詞→修飾名詞。`*_prep`はUDのobl/nmodとcaseから観測した関係であり、必須の補文選択を意味しません。句動詞・複合前置詞・全補文パターンの解析は後続実装です。

意味群・prosodyの自動ラベル付け、日本語逆引き、複数の独立コーパスによる自然さの較正、数千語への拡張は未実装です。
全出典が母語話者によるものかも未確認です。希少性だけから `likely anomalous` を自動付与しません。

## 数値の読み方

[docs/METHODS.md](docs/METHODS.md) に分母・式・閾値・限界を記載しています。
`config.json` は調整可能ですが、期待した結論に合わせて変更するためのものではありません。変更時は検証セットを分離して再評価してください。
自然さの0〜100は未較正の研究用スコアで、データ不足では `null`。分類はこの標本内の記述であり、ネイティブ全体の規範的判定ではありません。

原文の再配布条件は各ソースに従います。`data/`には取得データ、DB、ローカル全文が含まれます。公開・商品化の際にこのディレクトリを無条件で再配布しないでください。

## WikiTextによる拡張

```powershell
uv sync --extra test --extra corpus
uv run python scripts/fetch_wikitext.py
uv run python scripts/prepare_wikitext.py --words 10000000 --workers 8
uv run python scripts/build_expanded.py
uv run python scripts/report_expansion.py
uv run python scripts/activate_expanded.py
```

記事単位で固定ハッシュ順の標本を作り、対象語に関係なく全文を解析します。`--words`は選択時の空白区切り語数で、最終DBでは句読点・記号を除いた解析語数を報告します。処理済みshardは再実行時に利用し、予算を増やす場合は別の `--output` と旧ディレクトリの `--reuse` を指定できます。

初回AMALGUMだけのDBと報告を保存し、拡張DBを別ファイルとして検証してから既定DBを切り替えます。WikiTextの正確な記事版・作成年・著者・話者方言は不明です。現在のWikipediaの内容や現代会話の代表標本とはみなしません。解析器も異なるため、負の証拠はsource×registerの層別期待数を確認します。

切り替え後も `data/collocations_pilot.duckdb` に初回DB、`data/collocations_expanded.duckdb` に拡張候補を残します。通常のCLI/APIは `data/collocations.duckdb` の拡張済みデータを使います。初回データだけを再構築する場合は `cli.py --db data/pilot_rebuild.duckdb ingest` のように明示的な出力先を指定してください。

## 全量拡張とOANC

```powershell
uv run python scripts/prepare_wikitext.py --words 1000000000 --workers 8 --output data/wikitext_parsed_full --reuse data/wikitext_parsed_10m
uv run python scripts/fetch_oanc.py
uv run python scripts/prepare_oanc.py --workers 4
uv run python scripts/build_expanded.py --parsed data/wikitext_parsed_full --oanc data/oanc_parsed --db data/collocations_full.duckdb
uv run python scripts/report_expansion.py --db data/collocations_full.duckdb --previous-db data/collocations.duckdb --output reports/full_expansion
uv run python scripts/activate_expanded.py --candidate data/collocations_full.duckdb
```

`--words 1000000000` は10億語を取得したという意味ではなく、取得済みWikiText trainの全候補記事を選び切るための上限です。実際の採用語数はDBのsummaryで確認します。前回の約1,103万語のDBも、切り替え前の語数を含む別名で保存します。

全量解析では記事本文をディスクに置き、同時処理数を制限して記事ごとの完了結果を保存します。大きな記事があっても他の記事の処理を止めません。DuckDBは2GBのメモリ上限で関係別に集計し、検索は保存済み集計と並べ替え済みデータを利用します。KWIC本文は選ばれた文書だけ読み込みます。`pair_strata.parquet`もエクスポート対象です。

OANCは会話・雑誌・学術・技術・旅行等の原文を文書別ヘッダーとともに使用します。刊行年と著者があれば保持し、ヘッダー作成年は代用しません。米語コーパスという設計上の説明を、個々の話者の方言・国籍が確認済みという情報に変換しません。
