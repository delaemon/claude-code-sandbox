"use strict";

/* 羽田フライトレーダー — /api/aircraft を1秒ごとにポーリングし、
 * Googleマップ上の航空機マーカーを更新し続ける。 */

const POLL_MS = 1000;

// 高度ビン(m)→ 色。シーケンシャル(青・浅→濃)、地上はニュートラル。
const ALT_COLORS = [
  { max: 1000, color: "#86b6ef" },
  { max: 3000, color: "#5598e7" },
  { max: 6000, color: "#2a78d6" },
  { max: 9000, color: "#1c5cab" },
  { max: Infinity, color: "#0d366b" },
];
const GROUND_COLOR = "#898781";

// 機首を北(0°)に向けた飛行機シルエット。track角をそのままrotationに使う。
const PLANE_PATH =
  "M0,-8 L1.5,-6 L1.5,-2 L8,2 L8,4 L1.5,2.5 L1.5,6 L4,8 L4,9.5 L0,8.5 " +
  "L-4,9.5 L-4,8 L-1.5,6 L-1.5,2.5 L-8,4 L-8,2 L-1.5,-2 L-1.5,-6 Z";

let map = null;
let infoWindow = null;
let selectedHex = null;
const markers = new Map(); // hex → google.maps.Marker
let config = null;
let lastAircraft = [];

// ── 起動 ─────────────────────────────────────────────────────────────────────

async function boot() {
  config = await (await fetch("/api/config")).json();
  const key = resolveApiKey();
  if (!key) {
    showKeyPanel();
    return;
  }
  const s = document.createElement("script");
  s.src =
    "https://maps.googleapis.com/maps/api/js?key=" +
    encodeURIComponent(key) +
    "&language=ja&region=JP&callback=__initMap";
  s.async = true;
  s.onerror = () => setPlaceholder("Google Maps を読み込めませんでした。ネットワークとAPIキーを確認してください。");
  document.head.appendChild(s);
  // キーが無効な場合 Google は gm_authFailure を呼ぶ
  window.gm_authFailure = () => {
    localStorage.removeItem("gmaps_api_key");
    setPlaceholder("APIキーが無効です。");
    showKeyPanel();
  };
}

function resolveApiKey() {
  const fromUrl = new URLSearchParams(location.search).get("key");
  if (fromUrl) {
    localStorage.setItem("gmaps_api_key", fromUrl);
    return fromUrl;
  }
  return localStorage.getItem("gmaps_api_key") || config.googleMapsApiKey || "";
}

function showKeyPanel() {
  const panel = document.getElementById("key-panel");
  panel.hidden = false;
  document.getElementById("key-save").addEventListener("click", () => {
    const v = document.getElementById("key-input").value.trim();
    if (!v) return;
    localStorage.setItem("gmaps_api_key", v);
    location.reload();
  });
}

function setPlaceholder(text) {
  const el = document.getElementById("map-placeholder");
  if (el) el.textContent = text;
}

// ── 地図初期化(Maps APIのcallbackから呼ばれる)──────────────────────────────

window.__initMap = function () {
  document.getElementById("map-placeholder")?.remove();
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  map = new google.maps.Map(document.getElementById("map"), {
    center: config.center,
    zoom: 9,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    styles: dark ? DARK_MAP_STYLE : null,
  });
  infoWindow = new google.maps.InfoWindow();
  infoWindow.addListener("closeclick", () => { selectedHex = null; renderTable(); });

  // 100km圏の円と羽田空港マーカー
  new google.maps.Circle({
    map,
    center: config.center,
    radius: config.radiusKm * 1000,
    strokeColor: "#2a78d6",
    strokeOpacity: 0.6,
    strokeWeight: 1.5,
    fillColor: "#2a78d6",
    fillOpacity: 0.03,
    clickable: false,
  });
  new google.maps.Marker({
    map,
    position: config.center,
    title: "羽田空港 (HND)",
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 5,
      fillColor: "#e34948",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
    },
  });

  tick();
};

// ── ポーリングループ ─────────────────────────────────────────────────────────

async function tick() {
  const started = Date.now();
  try {
    const res = await fetch("/api/aircraft", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    lastAircraft = data.aircraft;
    updateMarkers(data.aircraft);
    renderTable();
    updateStats(data);
  } catch (e) {
    setStatus("error", "取得エラー: " + e.message);
  }
  // 処理時間ぶんを差し引いて、およそ1秒間隔を保つ
  setTimeout(tick, Math.max(150, POLL_MS - (Date.now() - started)));
}

function altColor(ac) {
  if (ac.ground) return GROUND_COLOR;
  const m = ac.alt_m ?? 0;
  for (const bin of ALT_COLORS) if (m < bin.max) return bin.color;
  return ALT_COLORS[ALT_COLORS.length - 1].color;
}

function updateMarkers(aircraft) {
  const seen = new Set();
  for (const ac of aircraft) {
    seen.add(ac.hex);
    const icon = {
      path: PLANE_PATH,
      rotation: ac.track ?? 0,
      scale: 1.5,
      fillColor: altColor(ac),
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 1.2,
      anchor: new google.maps.Point(0, 0),
    };
    let m = markers.get(ac.hex);
    if (!m) {
      m = new google.maps.Marker({
        map,
        position: { lat: ac.lat, lng: ac.lon },
        icon,
        optimized: false,
      });
      m.addListener("click", () => selectAircraft(ac.hex, false));
      markers.set(ac.hex, m);
    } else {
      m.setPosition({ lat: ac.lat, lng: ac.lon });
      m.setIcon(icon);
    }
    m.setTitle(ac.callsign || ac.hex);
    if (ac.hex === selectedHex && infoWindow.getMap()) {
      infoWindow.setContent(infoHtml(ac));
      infoWindow.setPosition({ lat: ac.lat, lng: ac.lon });
    }
  }
  // 圏外に出た機体を削除
  for (const [hex, m] of markers) {
    if (!seen.has(hex)) {
      m.setMap(null);
      markers.delete(hex);
      if (hex === selectedHex) {
        infoWindow.close();
        selectedHex = null;
      }
    }
  }
}

function selectAircraft(hex, pan) {
  const ac = lastAircraft.find((a) => a.hex === hex);
  const m = markers.get(hex);
  if (!ac || !m) return;
  selectedHex = hex;
  infoWindow.setContent(infoHtml(ac));
  infoWindow.open({ map, anchor: m });
  if (pan) map.panTo({ lat: ac.lat, lng: ac.lon });
  renderTable();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function infoHtml(ac) {
  const rows = [
    ["機種", ac.type], ["登録記号", ac.reg],
    ["高度", ac.ground ? "地上" : ac.alt_m != null ? ac.alt_m.toLocaleString() + " m" : "―"],
    ["対地速度", ac.gs_kmh != null ? ac.gs_kmh.toLocaleString() + " km/h" : "―"],
    ["方位", ac.track != null ? Math.round(ac.track) + "°" : "―"],
    ["羽田から", ac.dist_km + " km"],
  ];
  return (
    '<div class="iw"><div class="iw-callsign">' + esc(ac.callsign || ac.hex) + "</div>" +
    rows
      .filter(([, v]) => v)
      .map(([k, v]) => '<div><span class="iw-muted">' + k + ":</span> " + esc(v) + "</div>")
      .join("") +
    "</div>"
  );
}

// ── サイドバー・ステータス ───────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById("ac-tbody");
  const sorted = [...lastAircraft].sort((a, b) => a.dist_km - b.dist_km);
  tbody.innerHTML = sorted
    .map(
      (ac) =>
        '<tr data-hex="' + esc(ac.hex) + '"' + (ac.hex === selectedHex ? ' class="selected"' : "") + ">" +
        '<td class="cs">' + esc(ac.callsign || ac.hex) + "</td>" +
        '<td class="num">' + (ac.ground ? "地上" : ac.alt_m != null ? ac.alt_m.toLocaleString() : "―") + "</td>" +
        '<td class="num">' + (ac.gs_kmh != null ? ac.gs_kmh.toLocaleString() : "―") + "</td>" +
        '<td class="num">' + ac.dist_km + "</td></tr>"
    )
    .join("");
  tbody.querySelectorAll("tr").forEach((tr) =>
    tr.addEventListener("click", () => selectAircraft(tr.dataset.hex, true))
  );
}

function updateStats(data) {
  document.getElementById("stat-count").textContent = data.aircraft.length;
  document.getElementById("stat-updated").textContent = data.fetched_at
    ? new Date(data.fetched_at).toLocaleTimeString("ja-JP")
    : "–";
  document.getElementById("stat-source").textContent = data.source || "–";
  if (data.error) setStatus("error", "データ取得失敗: 再試行中");
  else if (data.stale) setStatus("warn", "データが古い可能性");
  else setStatus("ok", data.source === "mock" ? "模擬データで動作中" : "ライブ");
}

function setStatus(cls, text) {
  const el = document.getElementById("stat-status");
  el.className = "tile status " + cls;
  document.getElementById("stat-status-text").textContent = text;
}

// ── ダークモード用マップスタイル ─────────────────────────────────────────────

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f2f2f" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] },
];

boot();
