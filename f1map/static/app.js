'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

const S = {
  // session selection
  year: null, round: null, stype: null,

  // loaded data
  info: null,     // {year, event, circuit, session, drivers}
  posData: null,  // {sample_hz, t_start, t_end, n_frames, positions, circuit}
  lapsData: null, // {laps: [...]}
  telCache: {},   // driver -> telemetry object

  // playback
  isLoaded: false,
  isPlaying: false,
  currentTime: 0,   // seconds from posData.t_start
  totalTime: 0,
  speed: 10,
  rafId: null,
  lastTs: null,

  // UI
  selectedDriver: null,
  hiddenDrivers: new Set(),

  // canvas
  canvas: null, ctx: null,
  trackCanvas: null, trackCtx: null,
  bounds: null,
  W: 0, H: 0,
};

// ── DOM shortcuts ──────────────────────────────────────────────────────────────

const el = id => document.getElementById(id);
const selYear    = el('sel-year');
const selRound   = el('sel-round');
const selType    = el('sel-type');
const btnLoad    = el('btn-load');
const btnPlay    = el('btn-play');
const btnRestart = el('btn-restart');
const scrubber   = el('scrubber');
const tCur       = el('t-current');
const tTot       = el('t-total');
const selSpeed   = el('sel-speed');
const driverList = el('driver-list');
const overlay    = el('overlay-msg');
const lapsTbody  = el('laps-tbody');

// ── API ────────────────────────────────────────────────────────────────────────

async function api(path) {
  const r = await fetch('/api' + path);
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    throw new Error(`${r.status} ${txt}`);
  }
  return r.json();
}

// ── Init ───────────────────────────────────────────────────────────────────────

function init() {
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 2018; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    selYear.appendChild(o);
  }
  S.year = parseInt(selYear.value);

  // Canvas setup
  S.canvas = el('track-canvas');
  S.ctx = S.canvas.getContext('2d');
  S.trackCanvas = document.createElement('canvas');
  S.trackCtx = S.trackCanvas.getContext('2d');

  // Events
  selYear.addEventListener('change', onYearChange);
  selRound.addEventListener('change', () => S.round = parseInt(selRound.value));
  btnLoad.addEventListener('click', onLoad);
  btnPlay.addEventListener('click', togglePlay);
  btnRestart.addEventListener('click', restart);
  scrubber.addEventListener('input', onScrub);
  selSpeed.addEventListener('change', () => S.speed = parseFloat(selSpeed.value));
  window.addEventListener('resize', resizeCanvas);

  resizeCanvas();
  onYearChange();
}

async function onYearChange() {
  S.year = parseInt(selYear.value);
  selRound.disabled = true;
  btnLoad.disabled = true;
  selRound.innerHTML = '<option>Loading...</option>';

  try {
    const schedule = await api(`/schedule/${S.year}`);
    selRound.innerHTML = '';
    // Show most recent first
    for (const ev of [...schedule].reverse()) {
      const o = document.createElement('option');
      o.value = ev.round;
      o.textContent = `R${String(ev.round).padStart(2,'0')} · ${ev.name}`;
      selRound.appendChild(o);
    }
    selRound.disabled = false;
    btnLoad.disabled = false;
    S.round = parseInt(selRound.value);
    selType.disabled = false;
  } catch (e) {
    selRound.innerHTML = `<option>Error: ${e.message}</option>`;
  }
}

// ── Load session ───────────────────────────────────────────────────────────────

async function onLoad() {
  S.round = parseInt(selRound.value);
  S.stype = selType.value;

  stopPlay();
  resetPlayback();
  btnLoad.disabled = true;
  setOverlay(true, '<span class="spinner"></span> セッション情報を取得中...');

  try {
    // 1. Session info (fast, usually cached)
    S.info = await api(`/session/${S.year}/${S.round}/${S.stype}`);
    buildDriverList();
    el('laps-filter-badge').textContent = '';

    // 2. Position data + lap data in parallel (slow on first load)
    setOverlay(true,
      '<span class="spinner"></span> 位置データを読み込み中...' +
      '<div style="font-size:0.78rem;color:#555;margin-top:8px">初回は1〜3分かかる場合があります</div>'
    );

    const [posData, lapsData] = await Promise.all([
      api(`/positions/${S.year}/${S.round}/${S.stype}`),
      api(`/laps/${S.year}/${S.round}/${S.stype}`).catch(() => ({ laps: [] })),
    ]);

    S.posData = posData;
    S.lapsData = lapsData;
    S.telCache = {};
    S.totalTime = posData.t_end - posData.t_start;
    S.currentTime = 0;
    S.isLoaded = true;

    computeBounds();
    drawTrackLayer();
    buildLapsTable(null);

    // Timeline controls
    scrubber.max = S.totalTime;
    scrubber.value = 0;
    scrubber.disabled = false;
    tTot.textContent = fmtTime(S.totalTime);
    tCur.textContent = fmtTime(0);
    btnPlay.disabled = false;
    btnRestart.disabled = false;
    selSpeed.disabled = false;

    setOverlay(false);
    btnLoad.disabled = false;

    // Start render loop
    if (!S.rafId) S.rafId = requestAnimationFrame(frame);

  } catch (e) {
    setOverlay(true, `<span style="color:#e10600">⚠ エラー:</span> ${e.message}`);
    btnLoad.disabled = false;
  }
}

// ── Canvas ─────────────────────────────────────────────────────────────────────

function resizeCanvas() {
  const wrap = el('canvas-wrap');
  S.W = wrap.clientWidth;
  S.H = wrap.clientHeight;
  S.canvas.width  = S.W;
  S.canvas.height = S.H;
  S.trackCanvas.width  = S.W;
  S.trackCanvas.height = S.H;

  if (S.isLoaded) {
    drawTrackLayer();
    renderFrame(S.currentTime);
  }
}

function computeBounds() {
  const { x, y } = S.posData.circuit;
  const xs = x.filter(v => v !== null);
  const ys = y.filter(v => v !== null);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const px = (maxX - minX) * 0.07;
  const py = (maxY - minY) * 0.07;
  S.bounds = { minX: minX - px, maxX: maxX + px, minY: minY - py, maxY: maxY + py };
}

function project(wx, wy) {
  const { minX, maxX, minY, maxY } = S.bounds;
  const rangeX = maxX - minX, rangeY = maxY - minY;
  const scale = Math.min(S.W / rangeX, S.H / rangeY);
  const offX = (S.W - rangeX * scale) / 2;
  const offY = (S.H - rangeY * scale) / 2;
  return [
    (wx - minX) * scale + offX,
    S.H - ((wy - minY) * scale + offY), // flip Y
  ];
}

function drawTrackLayer() {
  const tc = S.trackCanvas;
  tc.width = S.W; tc.height = S.H;
  const ctx = S.trackCtx;
  ctx.clearRect(0, 0, S.W, S.H);

  // Draw circuit as a thick point cloud
  const { x, y } = S.posData.circuit;
  ctx.fillStyle = 'rgba(90, 90, 95, 0.55)';
  for (let i = 0; i < x.length; i++) {
    if (x[i] === null || y[i] === null) continue;
    const [px, py] = project(x[i], y[i]);
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Circuit label
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = 'bold 11px Segoe UI, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  if (S.info) {
    ctx.fillText(`${S.info.event} — ${S.info.year} ${S.info.session}`, S.W - 10, S.H - 8);
  }
}

// ── Animation loop ─────────────────────────────────────────────────────────────

function frame(ts) {
  S.rafId = requestAnimationFrame(frame);

  if (!S.isLoaded) return;

  if (S.isPlaying && S.lastTs !== null) {
    const dt = (ts - S.lastTs) / 1000;
    S.currentTime = Math.min(S.currentTime + dt * S.speed, S.totalTime);
    if (S.currentTime >= S.totalTime) {
      S.currentTime = S.totalTime;
      stopPlay();
    }
  }
  S.lastTs = S.isPlaying ? ts : null;

  renderFrame(S.currentTime);
}

function renderFrame(t) {
  const { ctx, canvas, posData, info } = S;
  if (!posData) return;

  // Clear
  ctx.clearRect(0, 0, S.W, S.H);
  // Track background
  ctx.drawImage(S.trackCanvas, 0, 0);

  // Car positions
  const hz = posData.sample_hz;
  const ff = t * hz;
  const fi = Math.floor(ff);
  const alpha = ff - fi;
  const drivers = info?.drivers ?? {};

  for (const [num, pos] of Object.entries(posData.positions)) {
    if (S.hiddenDrivers.has(num)) continue;

    const x0 = pos.x[fi], y0 = pos.y[fi];
    const x1 = pos.x[fi + 1], y1 = pos.y[fi + 1];
    if (x0 === null || x0 === undefined) continue;

    const ix = (x1 != null) ? x0 + (x1 - x0) * alpha : x0;
    const iy = (y1 != null) ? y0 + (y1 - y0) * alpha : y0;
    const [px, py] = project(ix, iy);

    const drv = drivers[num] ?? {};
    const color = drv.color ?? '#888';
    const abbr  = drv.abbreviation ?? num;
    drawCar(ctx, px, py, color, abbr, num === S.selectedDriver);
  }

  // Update telemetry display for selected driver
  if (S.selectedDriver) renderTelemetry(t);

  // Sync timeline
  scrubber.value = t;
  tCur.textContent = fmtTime(t);

  // Highlight active lap
  const absT = t + posData.t_start;
  highlightLap(absT);
}

function drawCar(ctx, x, y, color, abbr, selected) {
  const R = selected ? 13 : 9;

  // Glow for selected driver
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, R + 5, 0, Math.PI * 2);
    ctx.fillStyle = `${color}33`;
    ctx.fill();
  }

  // Shadow
  ctx.beginPath();
  ctx.arc(x + 1.5, y + 1.5, R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  if (selected) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Abbreviation text
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${selected ? 8 : 7}px Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(abbr, x, y);
}

// ── Playback controls ──────────────────────────────────────────────────────────

function togglePlay() {
  if (!S.isLoaded) return;
  if (S.isPlaying) { stopPlay(); } else { startPlay(); }
}

function startPlay() {
  if (S.currentTime >= S.totalTime) S.currentTime = 0;
  S.isPlaying = true;
  S.lastTs = null;
  btnPlay.textContent = '⏸';
}

function stopPlay() {
  S.isPlaying = false;
  S.lastTs = null;
  btnPlay.textContent = '▶';
}

function restart() {
  stopPlay();
  S.currentTime = 0;
  if (S.isLoaded) renderFrame(0);
}

function resetPlayback() {
  stopPlay();
  S.currentTime = 0;
  S.totalTime = 0;
  scrubber.value = 0;
  scrubber.disabled = true;
  btnPlay.disabled = true;
  btnRestart.disabled = true;
  selSpeed.disabled = true;
  tCur.textContent = '0:00:00';
  tTot.textContent = '0:00:00';
}

function onScrub() {
  S.currentTime = parseFloat(scrubber.value);
  if (S.isLoaded) renderFrame(S.currentTime);
}

// ── Driver list ────────────────────────────────────────────────────────────────

function buildDriverList() {
  driverList.innerHTML = '';
  const drivers = S.info?.drivers ?? {};
  for (const [num, d] of Object.entries(drivers)) {
    const item = document.createElement('div');
    item.className = 'driver-item';
    item.dataset.num = num;
    item.innerHTML = `
      <div class="drv-dot" style="background:${d.color}"></div>
      <span class="drv-abr">${d.abbreviation}</span>
      <span class="drv-name">${d.name}</span>
    `;
    item.addEventListener('click',    () => onDriverClick(num));
    item.addEventListener('dblclick', () => onDriverDblClick(num));
    driverList.appendChild(item);
  }
}

function onDriverClick(num) {
  if (S.selectedDriver === num) {
    // Deselect
    S.selectedDriver = null;
    clearTelemetry();
    buildLapsTable(null);
    el('laps-filter-badge').textContent = '';
  } else {
    S.selectedDriver = num;
    const drv = S.info?.drivers?.[num];
    const badge = el('tel-driver-badge');
    badge.textContent = drv ? drv.abbreviation : num;
    badge.style.color = drv?.color ?? '#fff';
    buildLapsTable(num);
    el('laps-filter-badge').textContent = `· ${drv?.abbreviation ?? num}`;
    loadTelemetry(num);
  }
  document.querySelectorAll('.driver-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.num === S.selectedDriver);
  });
}

function onDriverDblClick(num) {
  if (S.hiddenDrivers.has(num)) {
    S.hiddenDrivers.delete(num);
  } else {
    S.hiddenDrivers.add(num);
  }
  document.querySelector(`.driver-item[data-num="${num}"]`)
    ?.classList.toggle('hidden', S.hiddenDrivers.has(num));
}

// ── Telemetry ──────────────────────────────────────────────────────────────────

async function loadTelemetry(num) {
  if (S.telCache[num]) return;
  try {
    S.telCache[num] = await api(`/telemetry/${S.year}/${S.round}/${S.stype}/${num}`);
  } catch (e) {
    console.warn('Telemetry error', e);
    S.telCache[num] = {};
  }
}

function renderTelemetry(sessionTime) {
  const num = S.selectedDriver;
  const tel = S.telCache[num];
  if (!tel || !tel.speed?.length) return;

  const absT = sessionTime + S.posData.t_start;
  const fi = Math.max(0, Math.floor((absT - tel.t_start) * S.posData.sample_hz));

  const get = arr => (arr && fi < arr.length && arr[fi] !== null) ? arr[fi] : null;

  const speed    = get(tel.speed);
  const gear     = get(tel.gear);
  const throttle = get(tel.throttle);
  const brake    = get(tel.brake);
  const drs      = get(tel.drs);
  const rpm      = get(tel.rpm);

  el('tel-speed').textContent = speed    != null ? Math.round(speed)           : '—';
  el('tel-gear').textContent  = gear     != null ? Math.round(gear)            : '—';
  el('tel-rpm').textContent   = rpm      != null ? Math.round(rpm).toLocaleString() : '—';
  el('tel-drs').textContent   = drs      != null ? (drs > 0 ? '✓ OPEN' : 'CLOSED') : '—';
  el('tel-drs').style.color   = drs > 0 ? '#39b54a' : '';

  const thPct = throttle != null ? Math.min(100, Math.round(throttle)) : 0;
  const brPct = brake    != null ? (brake > 0 ? Math.min(100, Math.round(brake * 100)) : 0) : 0;
  el('bar-throttle').style.width = thPct + '%';
  el('bar-brake').style.width    = brPct + '%';
  el('val-throttle').textContent = throttle != null ? Math.round(throttle) + '%' : '—';
  el('val-brake').textContent    = brake    != null ? (brake > 0 ? 'ON' : 'OFF') : '—';
}

function clearTelemetry() {
  el('tel-driver-badge').textContent = '';
  for (const id of ['tel-speed','tel-gear','tel-rpm','tel-drs','val-throttle','val-brake']) {
    el(id).textContent = '—';
  }
  el('tel-drs').style.color = '';
  el('bar-throttle').style.width = '0%';
  el('bar-brake').style.width    = '0%';
}

// ── Laps table ─────────────────────────────────────────────────────────────────

const COMPOUND_CLASS = { SOFT:'cmp-s', MEDIUM:'cmp-m', HARD:'cmp-h', INTERMEDIATE:'cmp-i', WET:'cmp-w' };

function buildLapsTable(filterDriver) {
  const laps = S.lapsData?.laps ?? [];
  const rows = filterDriver ? laps.filter(l => l.driver === filterDriver) : laps;
  const drivers = S.info?.drivers ?? {};

  lapsTbody.innerHTML = '';
  for (const lap of rows) {
    const drv = drivers[lap.driver] ?? {};
    const tr = document.createElement('tr');
    tr.dataset.tStart = lap.t_start ?? '';
    tr.dataset.tEnd   = (lap.t_start ?? 0) + (lap.time ?? 0);

    const cmpClass = COMPOUND_CLASS[lap.compound] ?? '';
    const cmpChar  = (lap.compound || '?')[0];

    tr.innerHTML = `
      <td>${lap.lap}</td>
      <td style="color:${drv.color ?? '#fff'};font-weight:700">${drv.abbreviation ?? lap.driver}</td>
      <td>${lap.time ? fmtLapTime(lap.time) : '—'}</td>
      <td>${lap.position ?? '—'}</td>
      <td class="${cmpClass}">${cmpChar}</td>
    `;

    // Click lap → jump to that time
    tr.addEventListener('click', () => {
      if (lap.t_start != null) {
        const relT = lap.t_start - S.posData.t_start;
        S.currentTime = Math.max(0, relT);
        renderFrame(S.currentTime);
      }
    });

    lapsTbody.appendChild(tr);
  }
}

function highlightLap(absT) {
  for (const tr of lapsTbody.rows) {
    const ts = parseFloat(tr.dataset.tStart);
    const te = parseFloat(tr.dataset.tEnd);
    tr.classList.toggle('highlight', !isNaN(ts) && absT >= ts && absT <= te);
  }
}

// ── Overlay ────────────────────────────────────────────────────────────────────

function setOverlay(visible, html = '') {
  overlay.classList.toggle('hidden', !visible);
  if (html) el('overlay-inner').innerHTML = html;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function fmtTime(secs) {
  if (secs == null || isNaN(secs)) return '0:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtLapTime(secs) {
  if (secs == null || isNaN(secs)) return '—';
  const m  = Math.floor(secs / 60);
  const s  = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${m}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

init();
