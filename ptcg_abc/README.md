# Pokémon TCG AI Battle Challenge 攻略プロジェクト

[Pokémon Trading Card Game AI Battle Challenge](https://ptcg-abc.pokemon.co.jp/) —
ポケモン社 × 松尾研究所 × HEROZ が Kaggle 上で開催する、ポケカを対戦する
AI エージェント開発コンテストの攻略用コードベース。

- Kaggle コンペ (Simulation): https://www.kaggle.com/competitions/pokemon-tcg-ai-battle
- Kaggle コンペ (Strategy): https://www.kaggle.com/competitions/pokemon-tcg-ai-battle-challenge-strategy
- エンジン (cabt Engine) ドキュメント: https://matsuoinstitute.github.io/cabt/
- 対戦環境は `pip install kaggle-environments` に同梱 (`kaggle_environments/envs/cabt/`)

## コンペ概要

- 主催者指定のカードプールから 60 枚デッキを構築し、AI エージェント同士が対戦
- エージェントは毎手番 observation(盤面・ログ・合法手リスト)を受け取り、
  選ぶ option の index リストを返す
- 持ち時間は 1 プレイヤーあたり最大 10 分 (`remainingOverageTime: 600`)
- Simulation 部門: エージェントを Kaggle に提出(1 チーム 1 日 5 回まで、最終提出 2026-08-16)
- Strategy 部門: エージェントの戦略ロジックのレポートを提出(〜2026-09-14)

## セットアップ

```bash
python -m venv .venv && source .venv/bin/activate
pip install kaggle-environments

# カード DB (1267 枚) と技 DB をエンジンから抽出
python extract_carddb.py          # → data/cards.json, data/attacks.json

# エージェントをベースライン (random / first) と対戦させる
python evaluate.py --opponent random --games 50
python evaluate.py --opponent first --games 50
```

## エンジンのインターフェース(解読メモ)

`kaggle_environments.envs.cabt.cg.game` の `battle_start(deck0, deck1)` /
`battle_select(indices)` / `battle_finish()` で 1 対戦を直接回せる
(kaggle_environments のランナーを介すより高速)。

### エージェント関数

```python
def agent(obs: dict) -> list[int]:
    if obs["select"] is None:   # 最初の呼び出しはデッキ(カード ID 60 枚)を返す
        return DECK
    ...                          # 以降は option の index リストを返す
```

### observation

```
obs["select"]  : 今回の選択。type/context/minCount/maxCount/option[]
obs["logs"]    : 前回の選択以降に起きたイベント
obs["current"] : 盤面。turn / yourIndex / players[2] (active/bench/hand/prize/...)
obs["search_begin_input"] : 局面のシリアライズ blob。libcg の SearchBegin/-Step/-End
                            に渡すと先読み探索(木探索)ができる
```

### area 番号

| area | 意味 |
|------|------|
| 1 | 山札 | 
| 2 | 手札 |
| 3 | トラッシュ |
| 4 | バトル場 |
| 5 | ベンチ |
| 6 | サイド |
| 7 | スタジアム |

### option type(合法手の種類)

| type | 意味 | 主なフィールド |
|------|------|----------------|
| 0 | 数値の選択 | `number` |
| 1/2 | コイン・二択(表/裏 など) | – |
| 3 | カードの選択(サブ選択で使用) | `area`,`index`,`playerIndex` |
| 6 | 場のポケモンについたエネルギーの選択 | `area`,`index`,`energyIndex`,`count` |
| 7 | 手札のカードをプレイ(たね出し・グッズ・サポート) | `index` |
| 8 | 手札のカードを場の対象に付ける(エネルギー・どうぐ) | `index`,`inPlayArea`,`inPlayIndex` |
| 9 | 進化(手札の進化カードを場の対象に重ねる) | `index`,`inPlayArea`,`inPlayIndex` |
| 10 | 特性・スタジアム効果の使用 | `area`,`index` |
| 12 | にげる | – |
| 13 | ワザ宣言(宣言するとターン終了) | `attackId` |
| 14 | ターン終了(パス) | – |
| 15 | 効果の発動確認(どうぐ等) | `cardId`,`serial` |

### select context(観測したもの)

| (type, ctx) | 場面 |
|-------------|------|
| (0, 0) | メインフェイズの行動選択 |
| (1, 1) | 手札からバトル場/ベンチに出すポケモンの選択(セットアップ) |
| (1, 4) | きぜつ後などの新しいバトルポケモン選択 |
| (1, 7) | 山札からのカードサーチ(minCount 0 = 選ばない事も可) |
| (1, 8) | 手札からの複数枚選択(コスト払いなど) |
| (4, 30) | 支払う/トラッシュするエネルギーの選択 |
| (8, 38) | 数値選択(対戦開始時) |
| (9, 41) | コイントス等の二択(対戦開始時) |

### カード DB

`libcg.so` がエクスポートする `AllCard()` / `AllAttack()` が全カード・全ワザの
JSON を返す(`extract_carddb.py` 参照)。`cardType`: 0=ポケモン, 1=グッズ,
2=どうぐ, 3=サポート, 4=スタジアム, 5=基本エネルギー, 6=特殊エネルギー。

## 構成

```
extract_carddb.py  エンジンからカード/ワザ DB を JSON 抽出
carddb.py          DB ローダ + 便利関数(コスト充足判定など)
agent.py           ヒューリスティックエージェント本体
evaluate.py        ローカル評価ハーネス(vs random / first / self)
```

## 現状の結果 (agent.py のヒューリスティック、400 戦ずつ)

| 対戦相手 | 勝率 |
|----------|------|
| random(組み込み) | **96.2%** |
| first(組み込み・常に先頭の選択肢) | **68.0%** |

デフォルトデッキの本質は「エネ 33 枚 + カイオーガ Riptide(トラッシュの水エネ×20)
+ メガユキノオー ex Hammer-lanche(山札上 6 枚トラッシュ、水エネ×100 ≒ 期待 330 点)」
のエネ密度コンボ。DB 上の damage は 0 なので、`estimate_damage()` で効果込みの
期待打点を推定している。負け筋の大半はベンチ切れ(たね 6 枚しかないため事故る)。
カイオーガ 4 枚に増やす案はエネ密度が下がり逆効果だった(53%)。

## 攻略ロードマップ

1. **ヒューリスティック** (実装済み): 進化 > たね展開 > エネ付け > 効果込み最大打点ワザ。
   組み込みベースライン (random / first) には安定して勝てる状態
2. **デッキ構築**: カードプール 1267 枚から相性の良いデッキを探索
   (デフォルトデッキは水エネ 33 枚のプレースホルダで明らかに弱い)
3. **先読み探索**: `search_begin_input` + `SearchBegin/Step/End` API で
   決定化 + 木探索(MCTS / expectimax)。10 分の持ち時間をここに使う
4. **強化学習**: ローカルでの自己対戦が高速に回るので、方策の学習も可能
