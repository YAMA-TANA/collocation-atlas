# コーパス選定（2026-10-16確認）

| 候補 | 公式配布・条件 | MVP判断 |
|---|---|---|
| AMALGUM | https://github.com/gucorpling/amalgum / https://gucorpling.org/gum/cite_amalgum.html | 採用。約400万tokenを目標とした多ジャンル資料。配布CoNLL-UにlemmaとUD依存構文、XMLに原典URL・dateCreated等がある。注釈CC BY 4.0と原文ライセンスは別。 |
| WikiText-103 raw | https://huggingface.co/datasets/Salesforce/wikitext | 拡張に採用。Salesforce名義の公式配布。WikipediaのGood/Featured記事、CC BY-SA 3.0/GFDLの表示。trainのParquet2ファイルを固定revision・SHA256で取得。記事ごとにspaCyで全文解析する。元データにない年・国・著者・正確な版IDは補わない。 |
| Open American National Corpus (OANC) | https://anc.org/data/oanc/ / https://anc.org/data/oanc/download/ | 全量拡張に採用。商用を含む利用・再配布の制限がないオープン部分として配布。公式サイトが案内するGitHub releaseのOANC-GrAFアーカイブをSHA256検証。原文と.anc文書ヘッダーを使い、既存parseの文書境界を推測せず再解析。年代・著者はsourceDescから、ジャンルは配布ディレクトリから取得。ANC Second Release有料部分は取得しない。 |
| UD English GUM | https://universaldependencies.org/treebanks/en_gum/index.html | 人手注釈の検証用候補。CC BY-NC-SA 4.0。今回の100万語以上の主標本には小さい。 |
| Wikimedia dumps | https://dumps.wikimedia.org/legal.html | 拡張候補。公式ダンプがあり原文の帰属・継承条件に従う。XML展開・本文清掃・構文解析が必要。百科事典への偏りも大きい。 |
| Google Books Ngrams | https://books.google.com/ngrams/info | 年代別補助証拠の候補。n-gramは文書ID・KWIC・非隣接依存関係を復元できないため主エンジンには使わない。 |
| Common Crawl | https://commoncrawl.org/terms-of-use | 拡張候補。配布されていることは原文の権利一括付与を意味しない。重複除去・権利条件確認・機械生成文の扱いが必要。MVPから除外。 |
| BNC XML (BNC1994) | https://www.natcorp.ox.ac.uk/corpus/index.xml?ID=products / https://www.natcorp.ox.ac.uk/faq.xml?ID=corpus | 公式にOTAダウンロードの案内あり。約1億語、lemma/POS/XMLと文書メタデータ。初回の依存解析済みMVPには不採用。原典の権利・BNC利用条件に従う必要があり、1990年代資料から現代使用は保証できない。 |
| BNC2014 spoken | https://corpora.lancs.ac.uk/bnc2014/signup.php / https://corpora.lancs.ac.uk/bnc2014/licence.php | 非商用研究向け。登録と利用契約が必要。未登録での利用は禁じられているため、自動取得は行わない。 |
| COCA/iWeb/NOW/GloWbE等 | 各提供元の正式な契約/API/ダウンロード条件の確認後に個別アダプターを追加する | 契約や許可を推測しない。検索サイトのクロールは実装しない。 |

## 今回の選択

AMALGUMの `academic`, `bio`, `interview`, `news`, `voyage` の配布ファイルだけを使用。
Reddit原文の復元は行わない。wikiHowの非商用条件やGutenberg原典ごとの地域別権利確認をMVPの配布条件に持ち込まないため、`whow`, `fiction` はこの実験では除く。

このため「400万語の均衡コーパスそのもの」とは呼ばない。取得したファイル・実際の語数・構成比をmanifestとDBに記録する。interviewを自然会話、国別ドメインを話者方言とみなさない。国・著者が不明ならNULLのまま保持する。

| genre | 原文の配布元 | 配布元が記す原文条件 |
|---|---|---|
| academic | MDPI | CC BY 4.0 |
| bio | Wikipedia | CC BY-SA 3.0（AMALGUM配布元の記載） |
| interview, news | Wikinews | CC BY 2.5 |
| voyage | Wikivoyage | CC BY-SA 3.0（同上） |

原文とKWICの再配布時には、元資料ごとの帰属・継承条件を確認する。ローカル原典URL、取得commit、SHA256、ライセンス記録を維持する。コーパスの実例は教材用の創作文やLLM生成文で増やさない。

## 形式確認

確認例：`amalgum/news/dep/AMALGUM_news_khadr.conllu` と対応する `xml/AMALGUM_news_khadr.xml`。
CoNLL-Uの整数ID・FORM・LEMMA・UPOS・HEAD・DEPRELを読む。範囲IDと空ノードを語数から除く。基本依存構文のみを使い、enhanced辺との二重計上を避ける。
XMLのルート属性に `sourceURL`, `dateCreated`, `dateCollected`, `title`, `speakerList` 等がある。作成年を収集年や本文中の年で代用しない。
形式仕様：https://universaldependencies.org/format.html

AMALGUMを使用する研究では Gessler et al. (2020), *AMALGUM – A Free, Balanced, Multilayer English Web Corpus*, LREC, pp. 5267–5275 を引用する。
https://aclanthology.org/2020.lrec-1.648/
