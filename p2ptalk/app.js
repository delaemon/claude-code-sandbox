"use strict";

// ============================================================
// P2P Talk — サーバーレスなチャット&通話
//
// - シグナリング: PeerJS の無料公開クラウドサーバー(0.peerjs.com)。
//   接続の仲介にだけ使われ、メッセージや音声は通らない。
// - NAT越え: Google の無料 STUN + (設定時) Metered の無料 TURN リレー。
//   TURN 経由でも中身は DTLS/SRTP で暗号化されたまま(リレーは復号できない)。
// - チャット: WebRTC DataChannel / 通話: WebRTC MediaStream。
// ============================================================

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// config.js の設定に応じて iceServers を組み立てる。
// turnCredentialsUrl が設定されていれば Metered API から TURN
// クレデンシャルを取得(取得失敗時は STUN のみで続行)。
async function buildIceServers() {
  const cfg = window.P2PTALK_CONFIG || {};
  const servers = [...STUN_SERVERS, ...(cfg.extraIceServers || [])];
  let turnEnabled = (cfg.extraIceServers || []).some((s) =>
    String(s.urls).startsWith("turn")
  );

  if (cfg.turnCredentialsUrl) {
    try {
      const res = await fetch(cfg.turnCredentialsUrl);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const turnServers = await res.json();
      servers.push(...turnServers);
      turnEnabled = true;
    } catch (e) {
      console.warn("TURNクレデンシャル取得に失敗(STUNのみで続行):", e);
    }
  }
  return { servers, turnEnabled };
}

// --- DOM ---
const $ = (id) => document.getElementById(id);
const myIdEl = $("my-id");
const statusEl = $("status");
const connectPanel = $("connect-panel");
const chatPanel = $("chat-panel");
const callPanel = $("call-panel");
const messagesEl = $("messages");
const peerNameEl = $("peer-name");
const incomingDialog = $("incoming-dialog");
const incomingText = $("incoming-text");
const remoteVideo = $("remote-video");
const localVideo = $("local-video");
const remoteAudio = $("remote-audio");
const callStatusEl = $("call-status");
const muteBtn = $("mute-btn");

// --- 状態 ---
let peer = null;          // Peer 本体
let conn = null;          // チャット用 DataConnection
let currentCall = null;   // 通話用 MediaConnection
let localStream = null;   // 自分のマイク/カメラ
let muted = false;

// 読みやすい6桁の英数字IDを生成(紛らわしい文字は除外)
function generateId() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = "status " + cls;
}

// ============================================================
// 初期化(IDが衝突したら再生成してリトライ)
// ============================================================
let iceSetup = null; // { servers, turnEnabled } — 初回に一度だけ取得

function onlineStatusMsg() {
  return (
    "オンライン — 相手のIDを入力するか、着信を待ってください" +
    (iceSetup && iceSetup.turnEnabled ? "(TURN有効)" : "")
  );
}

async function init(retries = 3) {
  if (!iceSetup) iceSetup = await buildIceServers();

  const myId = generateId();
  // host を指定しないと PeerJS の無料クラウド(0.peerjs.com)に接続される
  peer = new Peer(myId, { config: { iceServers: iceSetup.servers } });

  peer.on("open", (id) => {
    myIdEl.textContent = id;
    setStatus(onlineStatusMsg(), "ok");
  });

  peer.on("connection", (incoming) => {
    // 既に誰かとチャット中なら新しい接続は断る
    if (conn && conn.open) {
      incoming.on("open", () => {
        incoming.send({ type: "busy" });
        setTimeout(() => incoming.close(), 500);
      });
      return;
    }
    setupConnection(incoming);
  });

  peer.on("call", onIncomingCall);

  peer.on("error", (err) => {
    if (err.type === "unavailable-id" && retries > 0) {
      peer.destroy();
      init(retries - 1);
      return;
    }
    if (err.type === "peer-unavailable") {
      setStatus("相手が見つかりません。IDと相手がオンラインか確認してください", "error");
      return;
    }
    setStatus("エラー: " + err.type, "error");
  });

  peer.on("disconnected", () => {
    setStatus("サーバーから切断されました。再接続中…", "error");
    peer.reconnect();
  });
}

// ============================================================
// チャット(DataChannel)
// ============================================================
function setupConnection(c) {
  conn = c;

  conn.on("open", () => {
    peerNameEl.textContent = "相手: " + conn.peer;
    connectPanel.classList.add("hidden");
    chatPanel.classList.remove("hidden");
    addSystemMessage("接続しました。メッセージは端末間で直接送受信されます。");
    setStatus("チャット接続中: " + conn.peer, "ok");
  });

  conn.on("data", (data) => {
    if (!data || typeof data !== "object") return;
    if (data.type === "chat") {
      addMessage(String(data.text), "peer", data.ts);
    } else if (data.type === "busy") {
      addSystemMessage("相手は別の相手と接続中です。");
    }
  });

  conn.on("close", () => {
    addSystemMessage("相手との接続が切れました。");
    endCall();
    resetConnection();
  });

  conn.on("error", () => {
    addSystemMessage("接続エラーが発生しました。");
    resetConnection();
  });
}

function resetConnection() {
  conn = null;
  setStatus(onlineStatusMsg(), "ok");
  connectPanel.classList.remove("hidden");
}

function sendChat(text) {
  if (!conn || !conn.open) {
    addSystemMessage("まだ相手と接続されていません。");
    return;
  }
  const msg = { type: "chat", text, ts: Date.now() };
  conn.send(msg);
  addMessage(text, "me", msg.ts);
}

function addMessage(text, who, ts) {
  const div = document.createElement("div");
  div.className = "msg " + who;
  div.textContent = text;
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date(ts || Date.now()).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  div.appendChild(time);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystemMessage(text) {
  const div = document.createElement("div");
  div.className = "msg system";
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ============================================================
// 通話(音声/ビデオ)
// ============================================================
async function startCall(withVideo) {
  if (!conn || !conn.open) {
    addSystemMessage("通話するには先にチャット接続してください。");
    return;
  }
  if (currentCall) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo,
    });
  } catch (e) {
    addSystemMessage("マイク/カメラを取得できませんでした: " + e.message);
    return;
  }

  const call = peer.call(conn.peer, localStream, {
    metadata: { video: withVideo },
  });
  attachCall(call, withVideo);
  callStatusEl.textContent = "呼び出し中…";
}

function onIncomingCall(call) {
  const withVideo = !!(call.metadata && call.metadata.video);
  incomingText.textContent =
    call.peer + " から" + (withVideo ? "ビデオ" : "音声") + "通話の着信";
  incomingDialog.classList.remove("hidden");

  $("answer-btn").onclick = async () => {
    incomingDialog.classList.add("hidden");
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: withVideo,
      });
    } catch (e) {
      addSystemMessage("マイク/カメラを取得できませんでした: " + e.message);
      call.close();
      return;
    }
    call.answer(localStream);
    attachCall(call, withVideo);
  };

  $("reject-btn").onclick = () => {
    incomingDialog.classList.add("hidden");
    call.close();
  };
}

function attachCall(call, withVideo) {
  currentCall = call;
  callPanel.classList.remove("hidden");
  document.querySelector(".videos").classList.toggle("audio-only", !withVideo);

  if (withVideo && localStream) {
    localVideo.srcObject = localStream;
  }

  call.on("stream", (remoteStream) => {
    callStatusEl.textContent = "通話中";
    if (withVideo) {
      remoteVideo.srcObject = remoteStream;
    } else {
      remoteAudio.srcObject = remoteStream;
    }
  });

  call.on("close", endCall);
  call.on("error", endCall);
}

function endCall() {
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  remoteAudio.srcObject = null;
  muted = false;
  muteBtn.textContent = "🎙️ ミュート";
  callPanel.classList.add("hidden");
}

function toggleMute() {
  if (!localStream) return;
  muted = !muted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  muteBtn.textContent = muted ? "🔇 ミュート解除" : "🎙️ ミュート";
}

// ============================================================
// UI イベント
// ============================================================
$("copy-id").addEventListener("click", async () => {
  const id = myIdEl.textContent;
  try {
    await navigator.clipboard.writeText(id);
    $("copy-id").textContent = "コピー済み";
    setTimeout(() => ($("copy-id").textContent = "コピー"), 1500);
  } catch {
    /* クリップボード非対応時は手動選択で対応 */
  }
});

$("connect-btn").addEventListener("click", () => {
  const remoteId = $("remote-id-input").value.trim().toLowerCase();
  if (!remoteId) return;
  if (remoteId === peer.id) {
    setStatus("自分自身には接続できません", "error");
    return;
  }
  setStatus("接続中…");
  setupConnection(peer.connect(remoteId, { reliable: true }));
});

$("remote-id-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("connect-btn").click();
});

$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  sendChat(text);
  input.value = "";
});

$("voice-call-btn").addEventListener("click", () => startCall(false));
$("video-call-btn").addEventListener("click", () => startCall(true));
$("hangup-btn").addEventListener("click", endCall);
muteBtn.addEventListener("click", toggleMute);

$("disconnect-btn").addEventListener("click", () => {
  endCall();
  if (conn) conn.close();
  resetConnection();
  chatPanel.classList.add("hidden");
  messagesEl.innerHTML = "";
});

// ページを離れるときに後始末
window.addEventListener("beforeunload", () => {
  endCall();
  if (peer) peer.destroy();
});

init();
