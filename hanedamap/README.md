# 羽田フライトレーダー

羽田空港(HND / RJTT)を中心とした半径100km圏内を飛行中の航空機を、
公開ADS-BデータからGoogleマップ上に**1秒ごと**に描画し続けるWebサイトです。

## データ源

無料・キー不要の公開ADS-Bアグリゲータを利用します(上から順に試行し、失敗時は自動フェイルオーバー):

1. [adsb.lol](https://api.adsb.lol/docs)
2. [adsb.fi](https://github.com/adsbfi/opendata)
3. [airplanes.live](https://airplanes.live/api-guide/)

ブラウザが何台開かれていても、サーバーが上流APIへ問い合わせるのは**毎秒1回だけ**です
(全クライアントで1秒キャッシュを共有)。

## 起動方法

```bash
cd hanedamap
pip install -r requirements.txt

# Google Maps APIキーを設定して起動(推奨)
export GOOGLE_MAPS_API_KEY=あなたのキー
python server.py            # → http://localhost:8010
```

### Google Maps APIキー

Googleマップの表示には [Maps JavaScript APIのキー](https://developers.google.com/maps/documentation/javascript/get-api-key?hl=ja) が必要です。設定方法は3通り:

1. 環境変数 `GOOGLE_MAPS_API_KEY` を設定してサーバーを起動
2. URLに `?key=あなたのキー` を付けてアクセス
3. キー未設定で開いたときに表示される入力欄に貼り付け(ブラウザのlocalStorageに保存)

### 模擬データモード

上流APIに接続できない環境での開発・デモ用に、羽田周辺を移動する模擬機を生成するモードがあります:

```bash
HANEDAMAP_MOCK=1 python server.py
```

## 画面

- 航空機マーカーは進行方位に回転し、**高度で色分け**(浅い青=低高度 → 濃い青=高高度、グレー=地上)
- マーカーまたは右側の一覧をクリックすると便名・機種・高度・速度・羽田からの距離を表示
- ヘッダーに機数・最終更新時刻・データ源・接続状態を常時表示
- ライト/ダークモード対応(OS設定に追従)

## API

| エンドポイント | 内容 |
|---|---|
| `GET /api/aircraft` | 100km圏内の航空機一覧(正規化済みJSON、1秒キャッシュ) |
| `GET /api/config` | 地図中心・半径・APIキーなどのフロントエンド設定 |
