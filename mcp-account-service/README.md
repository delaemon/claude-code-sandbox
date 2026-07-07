# mcp-account-service

OIDC/OAuth2 で保護されたアカウントサービスの **MCP サーバー** 実装です。
MCP Authorization 仕様(2025-06-18)に沿って、次の役割分担をとります。

```
MCPクライアント(Claude Code / IDE / エージェント)
   │  ① トークンなしでアクセス → 401 + WWW-Authenticate
   │  ② /.well-known/oauth-protected-resource で認可サーバーを発見(RFC 9728)
   │  ③ 認可サーバーで Authorization Code + PKCE によりトークン取得
   │  ④ Authorization: Bearer <JWT> を付けて MCP ツールを呼ぶ
   ▼
MCPサーバー = リソースサーバー(server.py, :9300/mcp)
   │  JWT を検証: 署名(JWKS)/ iss / aud / exp / scope
   ▼
OIDCプロバイダー = 認可サーバー(Keycloak / Auth0 / Entra ID / Okta ...)
   開発時は dev_idp.py(:9400)が代役
```

**MCP サーバー自体はトークンを発行しません。** 認証・認可は既存の IdP に委譲し、
サーバーは受け取ったアクセストークンの検証とスコープ制御だけを行います。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `server.py` | FastMCP サーバー本体。アカウント操作ツール5つ+ツール単位のスコープ制御 |
| `oidc_verifier.py` | `TokenVerifier` 実装。OIDC ディスカバリ → JWKS 取得(キャッシュつき)→ JWT 検証 |
| `account_store.py` | アカウントのドメイン層(デモ用インメモリ。`sub` クレームをキーに JIT プロビジョニング) |
| `dev_idp.py` | **開発専用**のミニ OIDC プロバイダー(RS256 署名・discovery・JWKS・/token) |
| `client_example.py` | 401 → メタデータ発見 → トークン取得 → MCP セッションの一連の流れを実演 |
| `config.py` | 環境変数による設定(issuer / audience / ポートなど) |

## ツールとスコープ

| ツール | 必要スコープ |
|---|---|
| `whoami` / `get_my_account` | `account:read`(全リクエスト共通の最低要件) |
| `update_my_profile` | `account:write` |
| `list_accounts` / `set_account_active` | `account:admin` |

## 動かし方(ローカル)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# ターミナル1: 開発用IdP (http://localhost:9400)
.venv/bin/python dev_idp.py

# ターミナル2: MCPサーバー (http://127.0.0.1:9300/mcp)
.venv/bin/python server.py

# ターミナル3: デモクライアント(401→発見→トークン取得→ツール呼び出し→スコープ拒否まで実演)
.venv/bin/python client_example.py
```

本物の IdP につなぐ場合は環境変数を設定して `server.py` を起動するだけです:

```bash
export OIDC_ISSUER=https://login.example.com/realms/myrealm   # IdP の issuer
export OIDC_AUDIENCE=https://api.example.com/mcp              # このサーバーの識別子
export MCP_SERVER_URL=https://api.example.com/mcp             # 外部公開URL
```

## 本番導入で「何をする必要があるか」チェックリスト

### 1. IdP(認可サーバー)側の設定
- [ ] IdP にこの MCP サーバーを **API / リソース(audience)** として登録し、
      アクセストークンの `aud` に `OIDC_AUDIENCE` が入るよう設定する
- [ ] カスタムスコープ `account:read` / `account:write` / `account:admin` を定義し、
      ユーザー・ロールに応じて付与する
- [ ] MCP クライアント用に **Authorization Code + PKCE** を許可した公開クライアントを用意する
      (MCP 仕様では PKCE 必須)。クライアント事前登録が難しい場合は
      **Dynamic Client Registration(RFC 7591)** を IdP 側で有効化する
- [ ] リダイレクト URI(例: Claude Code は `http://localhost:*/callback` 系)を許可する

### 2. MCP サーバー(このコード)側
- [ ] `account_store.py` を実 DB(PostgreSQL 等)に差し替える(公開メソッドの
      シグネチャを保てば `server.py` は無変更で済む)
- [ ] HTTPS 終端(リバースプロキシ)を用意し、`MCP_SERVER_URL` を公開 HTTPS URL にする。
      仕様上、localhost 以外は HTTPS 必須
- [ ] トークン検証の運用強化: JWKS キャッシュ TTL、IdP 到達不能時のフェイルクローズ、
      監査ログ(誰がどのツールを呼んだか)
- [ ] 参照トークン(非JWT)を発行する IdP の場合は、JWT ローカル検証の代わりに
      **Token Introspection(RFC 7662)** を `OIDCTokenVerifier` に実装する

### 3. セキュリティ上の必須事項(仕様由来)
- [ ] **audience 検証を絶対に外さない**(confused deputy / トークン横流し対策。
      本実装は `aud` 不一致を 401 で拒否済み)
- [ ] 受け取ったトークンを別のサービスへ **パススルーしない**(必要なら Token Exchange RFC 8693)
- [ ] スコープはツール単位で最小権限に(本実装の `_require()` パターン)
- [ ] レートリミット・リクエストサイズ制限・CORS 設定を前段で行う

### 4. クライアント側(参考)
- 実際の MCP クライアント(Claude Code 等)は 401 の `WWW-Authenticate` →
  `/.well-known/oauth-protected-resource` → IdP のメタデータ、と自動で辿り、
  ブラウザで PKCE フローを実行してトークンを取得します。
  `client_example.py` はこの流れをスクリプトで再現したものです(トークン取得だけ
  開発用 IdP の簡易エンドポイントで代用)。

> ⚠️ `dev_idp.py` は認証なしで誰にでもトークンを発行します。ローカル開発以外では絶対に使わないでください。
