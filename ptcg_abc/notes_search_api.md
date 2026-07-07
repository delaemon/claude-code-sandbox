# 先読み探索の調査メモ (branch: claude/ptcg-search-agent)

## ゴール

obs の `search_begin_input` + エンジンの `SearchBegin/SearchStep/SearchEnd/
SearchRelease` で局面を複製し、木探索(MCTS / expectimax)を回すこと。

## わかったこと

- `search_begin_input` は select ごとに更新される **84 文字の独自 base64 風
  blob**(文字集合 `*+-/0-9A-Za-z=`)。フル状態のシリアライズとしては小さく、
  乱数シード+差分など圧縮表現とみられる
- `libcg.so` のエクスポート: `SearchBegin` / `SearchStep` / `SearchEnd` /
  `SearchRelease` / `AgentStart`(通常対戦系とは別系統)
- 逆アセンブル(x86-64 SysV)から:
  - **全 Search 関数の第 1 引数は呼び出し側が用意する検索コンテキスト構造体**
    (サイズ ≥ 0x6f78)。オフセット `0x6ef8` の状態フラグが `2` のとき
    「初期化済み」として本処理に入る(未初期化なら早期 return)
  - `SearchBegin` は**引数 9 個以上**(レジスタ 6 + スタック 3、スタック側は
    ポインタ 3 本)— ブラインドで呼ぶのは危険なので打ち切り
- 公式ドキュメント(シグネチャ記載あり)は
  https://matsuoinstitute.github.io/cabt/sim.html だが、この環境の
  ネットワークポリシーで取得不可。Kaggle 配布の SDK (`cabt` パッケージ) にも
  Python ラッパーがあるはずで、**Kaggle にアクセスできる環境なら即解決する**

## フォールバック実装: planner.py(モデルベース 1-ply)

エンジン複製の代わりに、カード DB を遷移モデルとして各合法手の結果を予測し
期待値評価で行動を選ぶプランナーを実装した。

効いたのは**エネルギー配分のルーティング**:
「今アンロックされる打点」と「未達ワザへの進捗(必要枚数で割引)」の
max でアタッチ先を選ぶ。バトル場より次のアタッカー(ベンチ)への
チャージが正当化されるケースを正しく拾う。

攻撃選択・新バトルポケモン選択の 1-ply 化は単体では誤差範囲だった
(アブレーション: attack only 51%、active only 48%)。

## 測定結果(席交代、デフォルトデッキ同士)

| 対戦カード | 勝率 | 試行 |
|-----------|------|------|
| planner vs heuristic (agent.py) | **55.2%** | 600 |
| planner vs first | 67.3% | 400 |
| planner vs random | 95.8% | 400 |

ヒューリスティック本家に対して +5pt(2σ 以上)の有意な改善。

## 次の一歩

1. Kaggle にアクセスできる環境で SDK の `sim` モジュールを入手し、
   `SearchBegin` 系の正式シグネチャで置き換える(本物の木探索へ)
2. planner の定数(進捗割引、KO ボーナス、ミルペナルティ)は
   claude/ptcg-selfplay-rl ブランチの自己対戦最適化の対象になる
