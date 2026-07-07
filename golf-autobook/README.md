# golf-autobook — hacomono キャンセル枠 自動予約

品川ゴルフセンター(hacomono)のスケジュールを監視し、キャンセルで空きが出たら自動で予約するスクリプト。

- **ポーリング**: `POLL_INTERVAL_SEC` ごとにスケジュールページを確認
- **Gmail 即時トリガー**: hacomono からのキャンセル通知メールを IMAP IDLE で待ち受け、着信した瞬間に予約を試行(ポーリングより速い)
- 予約に成功したら自分宛てに通知メールを送って終了

## 動かす場所

このスクリプトは**常駐型**なので、つけっぱなしにできるマシンで動かす(自宅PC、Raspberry Pi、安いVPSなど)。クラウド不要・サーバー構築不要で、`python watcher.py` を起動しておくだけ。

## セットアップ

```bash
cd golf-autobook
pip install -r requirements.txt
playwright install chromium

cp config.example.env .env
# .env を編集してログイン情報などを設定(下記参照)
```

### Gmail トリガーの準備(推奨)

1. Google アカウントで 2 段階認証を有効化
2. https://myaccount.google.com/apppasswords で「アプリパスワード」を発行
3. `.env` の `GMAIL_APP_PASSWORD` に設定(通常のパスワードでは動かない)
4. `GMAIL_MATCH` にキャンセル通知メールの差出人か件名に含まれる文字列を設定
   (実際に届いた通知メールを見て合わせる。デフォルトは `hacomono,キャンセル`)

未設定でも動く(その場合はポーリングのみ)。

## 使い方 — 必ず DRY_RUN から

hacomono は店舗ごとに画面が微妙に違うため、**最初は必ず DRY_RUN で画面遷移を確認**する。

```bash
# 1. まずお試し実行(確定ボタンの直前で止まり、shots/ にスクショが残る)
#    .env: DRY_RUN=1, HEADLESS=0 にするとブラウザの動きが見える
python watcher.py

# 2. shots/ の画像を確認して、ログイン〜確認画面まで正しく進めていればOK
#    進めない場合は booker.py 冒頭の正規表現(ボタン名など)を画面に合わせて調整

# 3. 本番: .env で DRY_RUN=0 にして常駐させる
python watcher.py
```

### 常駐させる(Linux/ラズパイ/VPS)

```bash
nohup python watcher.py >/dev/null 2>&1 &
# ログは golf-autobook/watcher.log に出る
tail -f watcher.log
```

## 設定(.env)

| 変数 | 説明 |
|---|---|
| `HACOMONO_EMAIL` / `HACOMONO_PASSWORD` | hacomono のログイン情報 |
| `HACOMONO_LOGIN_PATH` | ログインページのパス。`/login` で入れなければ `/mypage/login` を試す |
| `TARGET_SCHEDULE_PATH` | 例: `/reserve/schedule/1/2` |
| `TARGET_DATE` | 例: `2026-07-15`(URL の `date_from`) |
| `TARGET_TIMES` | 例: `10:00,11:00`。空なら当日の空き枠ならどれでも取る |
| `DRY_RUN` | `1`=確定直前で停止(初回は必ず1)/ `0`=実際に予約する |
| `HEADLESS` | `0`=ブラウザ表示(デバッグ用) |
| `POLL_INTERVAL_SEC` | ポーリング間隔。**60秒未満にはしないこと**(サイトへの負荷・アカウント凍結リスク) |

## ファイル構成

- `watcher.py` — エントリポイント。ポーリングループ + Gmail トリガーの統合
- `booker.py` — Playwright によるログイン・空き枠検出・予約フロー
- `gmail_trigger.py` — Gmail IMAP IDLE 監視(着信で即時発火)
- `storage_state.json` — ログインセッションのキャッシュ(自動生成・コミット禁止)
- `shots/` — 各ステップのスクリーンショット(デバッグ用)

## 注意

- ログイン情報・アプリパスワードは `.env` にのみ書く(`.gitignore` 済み)。**リポジトリにコミットしない。**
- 過度な高頻度アクセスは施設・hacomono の利用規約に抵触しうる。ポーリング間隔は常識的な値(60秒以上)を守ること。
- 予約ルール(キャンセル待ち制度がある場合はそちらが優先される等)は施設の規約に従うこと。
