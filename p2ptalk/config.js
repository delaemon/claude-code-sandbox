"use strict";

// ============================================================
// P2P Talk 設定
//
// キャリア回線同士など STUN だけでは繋がらない NAT 環境を解消するには
// TURN リレーサーバーが必要です。Metered (Open Relay Project) の
// 無料プラン(月 20GB)で発行できます。設定手順:
//
//   1. https://dashboard.metered.ca/signup で無料アカウントを作成
//      (プラン選択画面が出たら「Free」を選ぶ)
//   2. ダッシュボードで TURN クレデンシャルを作成
//   3. 表示される「credential URL」を下の turnCredentialsUrl に貼り付ける
//      例: "https://myapp.metered.live/api/v1/turn/credentials?apiKey=xxxx"
//
// 未設定("")の場合は STUN のみで動作します(多くの環境では接続可能)。
// ============================================================
window.P2PTALK_CONFIG = {
  turnCredentialsUrl: "",

  // 自前の TURN/STUN サーバーを直接指定したい場合はここに追加
  // 例: { urls: "turn:turn.example.com:443", username: "u", credential: "p" }
  extraIceServers: [],
};
