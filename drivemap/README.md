# drivemap — 東京3D走行リプレイ

OBD2ログ(OBDLink MX+ 等で記録)とGPS軌跡から、実際の走行を
**PLATEAU の3D都市モデル上でグランツーリスモ風にリプレイ**するビューア。

- 国土交通省 [Project PLATEAU](https://www.mlit.go.jp/plateau/) の3D Tiles
  (CC BY 4.0)を CesiumJS で直接ストリーミング
- GPS軌跡は OSM 道路ネットワークに HMM マップマッチング + スプライン平滑化
- 速度・回転数・ブースト・スロットルを GT 風ゲージ HUD で同期表示
- チェイス / 車載 / 俯瞰カメラ、再生バーでスクラブ可

## クイックスタート

```bash
cd drivemap
pip install -r requirements.txt
python server.py          # http://localhost:8001
```

初回起動時、`runs/` が空なら渋谷周辺の合成走行デモを自動生成するので、
実データなしでもすぐ動きます(`DRIVEMAP_NO_DEMO=1` で無効化)。

## 実ログの取り込み

OBDLink MX+ は単体ではログを吐かず、アプリ経由で記録します。

| アプリ | 形式 | 使い方 |
|---|---|---|
| **Torque Pro** (Android) | GPS+OBDが1ファイルの結合CSV | `--input` に渡すだけ(推奨) |
| OBDLink 公式アプリ / Car Scanner | CSV(列名・単位はヘッダから自動判別) | GPSが含まれなければ `--gps` を併用 |
| GPSロガー / スマホアプリ | GPX | `--gps track.gpx --obd log.csv` |

Torque Pro でログを取る場合、記録するPIDに最低限
**Speed (OBD) / Engine RPM / Boost / Throttle Position** と
GPS(設定でCSVへのGPS書き出しを有効化)を含めてください。

```bash
# 結合CSV + 道路網をOverpassから自動取得(要ネット)
python -m pipeline.run --input trackday.csv --fetch-roads --name trackday

# GPSが別ファイル(GPX)の場合
python -m pipeline.run --gps track.gpx --obd obd.csv --fetch-roads --name run1

# マップマッチングを切って素のGPSで見る
python -m pipeline.run --input trackday.csv --no-match --name raw
```

生成された `runs/<name>.json` はサーバー再起動なしで
ビューアのプルダウンに現れます(ページ再読み込みで反映)。

## PLATEAU タイルセット

`config/plateau.json` に区ごとの 3D Tiles URL を列挙しています
(G空間情報センター配信、初期状態では渋谷区のみON)。URLが404になったら
[PLATEAUデータセット一覧](https://www.geospatial.jp/ckan/dataset/plateau)
から最新の配信URLに差し替えてください(年次更新されます)。

Cesium ion のトークンは不要です(ベース地図はOSMタイル、地形は楕円体)。
地形を入れていないぶん、建物の標高は `defaultHeightOffsetM`(東京の
ジオイド高 ≒ 37m)で補正しています。走行位置と建物がずれる場合は
この値を微調整してください。

## 仕組み

```
GPS(1Hz) + OBD(10Hz+) のログ
  → merge.py     列名・単位をヘッダから判別し、共通タイムラインに整合
  → mapmatch.py  OSM道路へViterbiマッチング(Newson-Krumm) + 平滑化スプライン
  → run.py       均一レートのフレームJSON(位置+方位+テレメトリ)を出力
  → server.py    FastAPIで配信
  → static/      CesiumJS + PLATEAU で再生、HUDはcanvas描画
```

技術的な難所はレンダリングではなくデータ側(マップマッチングと
タイムスタンプ整合)、という前提の構成です。3D表示の重い部分は
PLATEAU + Cesium が持ってくれます。
