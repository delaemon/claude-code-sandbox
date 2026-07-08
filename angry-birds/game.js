/* Angry Blobs — スマホブラウザ向けスリングショット物理ゲーム
 * 物理エンジン: Matter.js (lib/matter.min.js に同梱)
 * 描画: Canvas 2D (画像アセットなし、全部コードで描画)
 */
'use strict';

const { Engine, Bodies, Body, Composite, Events } = Matter;

// ---------- 定数 ----------
const W = 1600, H = 900;            // ワールド(仮想画面)サイズ
const GROUND_Y = 840;               // 地面の上端
const SLING = { x: 240, y: 640 };   // パチンコの支点
const MAX_STRETCH = 120;            // 引っ張れる最大距離
const POWER = 0.19;                 // 引き距離 → 初速の係数
const GRAB_RADIUS = 220;            // この範囲のタッチで狙い開始
const DT = 1000 / 60;

const MATS = {
  wood:  { hp: 60,  density: 0.0010, color: '#c98a4b', stroke: '#8a5a2b', score: 500 },
  ice:   { hp: 30,  density: 0.0007, color: 'rgba(165,220,250,0.8)', stroke: '#79b4d8', score: 300 },
  stone: { hp: 160, density: 0.0022, color: '#a2a8b0', stroke: '#6b7178', score: 800 },
};
const BIRD_TYPES = {
  red:    { r: 24, density: 0.0042, color: '#e8503a', belly: '#f7d9c4' },
  yellow: { r: 22, density: 0.0038, color: '#f4b830', belly: '#fdf0cd' }, // 飛行中タップで加速
};
const PIG_HP = 26, PIG_SCORE = 5000, BIRD_BONUS = 10000;

// ---------- レベル定義 ----------
// block: [x, y, w, h, 素材] / pig: [x, y, 半径]
const LEVELS = [
  {
    birds: ['red', 'red', 'yellow'],
    blocks: [
      [1070, 760, 24, 160, 'wood'],
      [1230, 760, 24, 160, 'wood'],
      [1150, 668, 220, 24, 'wood'],
    ],
    pigs: [[1150, 812, 26], [1150, 628, 26]],
  },
  {
    birds: ['red', 'yellow', 'red'],
    blocks: [
      [940, 780, 24, 120, 'wood'],
      [1060, 780, 24, 120, 'wood'],
      [1000, 708, 180, 24, 'wood'],
      [950, 636, 24, 120, 'ice'],
      [1050, 636, 24, 120, 'ice'],
      [1000, 564, 150, 24, 'ice'],
      [1250, 800, 30, 80, 'stone'],
      [1360, 790, 44, 100, 'stone'],
    ],
    pigs: [[1000, 814, 24], [1000, 526, 24], [1360, 714, 24]],
  },
  {
    birds: ['red', 'yellow', 'yellow', 'red'],
    blocks: [
      [880, 800, 36, 80, 'stone'],
      [980, 770, 28, 140, 'stone'],
      [1130, 770, 28, 140, 'wood'],
      [1280, 770, 28, 140, 'wood'],
      [1430, 770, 28, 140, 'stone'],
      [1055, 688, 180, 24, 'wood'],
      [1355, 688, 180, 24, 'wood'],
      [1010, 616, 24, 120, 'ice'],
      [1100, 616, 24, 120, 'ice'],
      [1055, 544, 150, 24, 'wood'],
    ],
    pigs: [[1055, 812, 26], [1355, 812, 26], [1055, 502, 30]],
  },
];

// ---------- DOM / キャンバス ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elOverlay = document.getElementById('overlay');
const elOvTitle = document.getElementById('ov-title');
const elOvStars = document.getElementById('ov-stars');
const elOvText = document.getElementById('ov-text');
const elOvNext = document.getElementById('ov-next');
const elOvRetry = document.getElementById('ov-retry');

let dpr = 1, viewScale = 1, viewOX = 0, viewOY = 0;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  viewScale = Math.min(cw / W, ch / H);
  viewOX = (cw - W * viewScale) / 2;
  viewOY = (ch - H * viewScale) / 2;
}
window.addEventListener('resize', resize);
resize();

function toWorld(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - viewOX) / viewScale,
    y: (e.clientY - rect.top - viewOY) / viewScale,
  };
}

// ---------- サウンド (WebAudio、素の合成音) ----------
let actx = null, muted = false;
function audio() {
  if (muted) return null;
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, dur, type = 'square', vol = 0.12, slideTo = 0) {
  const ac = audio();
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ac.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + dur + 0.02);
}
const sfx = {
  launch: () => tone(220, 0.25, 'square', 0.1, 880),
  boost: () => tone(500, 0.2, 'sawtooth', 0.12, 1400),
  thud: () => tone(120, 0.1, 'triangle', 0.15),
  crack: () => tone(320, 0.08, 'square', 0.1, 180),
  pop: () => { tone(620, 0.1, 'square', 0.14); setTimeout(() => tone(920, 0.12, 'square', 0.12), 60); },
  clear: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.14), i * 130)),
  lose: () => [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.12), i * 160)),
};

// ---------- ゲーム状態 ----------
let engine, world;
let blocks = [], pigs = [], particles = [];
let birdQueue = [], activeBird = null;
let levelIndex = 0, score = 0, levelStartScore = 0;
let best = Number(localStorage.getItem('angryblobs_best') || 0);
let state = 'aim'; // aim | fly | settle | done
let dragging = false, dragPointerId = null, dragPos = null;
let launchTime = 0, calmFrames = 0, settleUntil = 0, graceUntil = 0;
let clouds = [];

function makeClouds() {
  clouds = [];
  for (let i = 0; i < 5; i++) {
    clouds.push({ x: Math.random() * W, y: 60 + Math.random() * 240, s: 0.6 + Math.random() * 0.9, v: 0.1 + Math.random() * 0.15 });
  }
}

function entityOf(body) { return body.plugin && body.plugin.entity; }

function loadLevel(idx) {
  levelIndex = idx;
  levelStartScore = score;
  if (engine) Events.off(engine);
  engine = Engine.create({ enableSleeping: true });
  world = engine.world;
  blocks = []; pigs = []; particles = [];
  activeBird = null;
  dragging = false;
  state = 'aim';
  graceUntil = performance.now() + 1200; // 開始直後の接触ではダメージなし

  const ground = Bodies.rectangle(W / 2, GROUND_Y + 40, W * 3, 80, {
    isStatic: true, label: 'ground', friction: 0.9,
  });
  Composite.add(world, ground);

  const def = LEVELS[idx];
  for (const [x, y, w, h, mat] of def.blocks) {
    const m = MATS[mat];
    const body = Bodies.rectangle(x, y, w, h, {
      density: m.density, friction: 0.7, restitution: 0.05,
    });
    const ent = { kind: 'block', body, w, h, mat, hp: m.hp, maxHp: m.hp };
    body.plugin.entity = ent;
    blocks.push(ent);
    Composite.add(world, body);
  }
  for (const [x, y, r] of def.pigs) {
    const body = Bodies.circle(x, y, r, { density: 0.0022, friction: 0.5, restitution: 0.15 });
    const ent = { kind: 'pig', body, r, hp: PIG_HP, maxHp: PIG_HP, blink: Math.random() * 4 };
    body.plugin.entity = ent;
    pigs.push(ent);
    Composite.add(world, body);
  }
  birdQueue = def.birds.slice();
  nextBird();
  Events.on(engine, 'collisionStart', onCollision);
  makeClouds();
  updateHud();
  hideOverlay();
}

function nextBird() {
  if (!birdQueue.length) { activeBird = null; return; }
  const type = birdQueue.shift();
  const t = BIRD_TYPES[type];
  // 注意: isStatic:true で生成すると動的時の質量が保存されず、後の setStatic(false) で
  // 質量が Infinity のままになる (Matter.js の仕様)。動的で作ってから static 化する。
  const body = Bodies.circle(SLING.x, SLING.y, t.r, {
    density: t.density, friction: 0.6, restitution: 0.35,
  });
  Body.setStatic(body, true);
  const ent = { kind: 'bird', body, type, r: t.r, abilityUsed: false, launched: false };
  body.plugin.entity = ent;
  activeBird = ent;
  Composite.add(world, body);
  state = 'aim';
}

// ---------- ダメージ処理 ----------
function onCollision(ev) {
  if (performance.now() < graceUntil) return;
  for (const pair of ev.pairs) {
    const a = pair.bodyA, b = pair.bodyB;
    const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
    if (rel < 4) continue;
    applyDamage(entityOf(a), b, rel);
    applyDamage(entityOf(b), a, rel);
  }
}
function applyDamage(ent, other, rel) {
  if (!ent || ent.dead) return;
  if (ent.kind === 'bird') return;
  const otherMass = other.isStatic ? 8 : Math.min(other.mass, 8);
  const otherEnt = entityOf(other);
  const factor = otherEnt && otherEnt.kind === 'bird' ? 0.6 : 0.4;
  const dmg = rel * otherMass * factor;
  if (dmg < 6) return;
  ent.hp -= dmg;
  ent.hitFlash = 6;
  if (ent.hp <= 0) {
    ent.dead = true;
  } else if (ent.kind === 'pig') {
    sfx.thud();
  } else {
    sfx.crack();
  }
}

function sweepDead() {
  for (const ent of [...blocks, ...pigs]) {
    const oob = ent.body.position.y > H + 300 || ent.body.position.x < -400 || ent.body.position.x > W + 400;
    if (!ent.dead && !oob) continue;
    if (ent.kind === 'pig') {
      addScore(PIG_SCORE);
      poof(ent.body.position.x, ent.body.position.y, '#7ec850', 18);
      sfx.pop();
      pigs = pigs.filter(p => p !== ent);
    } else {
      addScore(MATS[ent.mat].score);
      poof(ent.body.position.x, ent.body.position.y, MATS[ent.mat].color, 10);
      blocks = blocks.filter(b => b !== ent);
    }
    Composite.remove(world, ent.body);
  }
}

function poof(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 30 + Math.random() * 20, color });
  }
}

function addScore(n) {
  score += n;
  if (score > best) { best = score; localStorage.setItem('angryblobs_best', String(best)); }
  updateHud();
}

function updateHud() {
  elScore.textContent = `SCORE ${score}   BEST ${best}`;
  elLevel.textContent = `LEVEL ${levelIndex + 1}/${LEVELS.length}`;
}

// ---------- 入力 ----------
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio(); // モバイルはユーザー操作でオーディオ解禁
  const p = toWorld(e);
  if (state === 'aim' && activeBird && !dragging &&
      Math.hypot(p.x - SLING.x, p.y - SLING.y) < GRAB_RADIUS) {
    dragging = true;
    dragPointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    dragPos = p;
    aimBird(p);
  } else if (state === 'fly' && activeBird && activeBird.type === 'yellow' && !activeBird.abilityUsed) {
    // イエローの特殊能力: タップで加速
    activeBird.abilityUsed = true;
    const v = activeBird.body.velocity;
    Body.setVelocity(activeBird.body, { x: v.x * 1.7, y: v.y * 1.7 });
    poof(activeBird.body.position.x, activeBird.body.position.y, '#f4b830', 8);
    sfx.boost();
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || e.pointerId !== dragPointerId) return;
  e.preventDefault();
  dragPos = toWorld(e);
  aimBird(dragPos);
});
function endDrag(e) {
  if (!dragging || e.pointerId !== dragPointerId) return;
  dragging = false;
  dragPointerId = null;
  const b = activeBird.body;
  const dx = b.position.x - SLING.x, dy = b.position.y - SLING.y;
  const stretch = Math.hypot(dx, dy);
  if (stretch < 18) { // ほぼ引いてない → 発射せず戻す
    Body.setPosition(b, { x: SLING.x, y: SLING.y });
    return;
  }
  launch(-dx * POWER, -dy * POWER);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function aimBird(p) {
  let dx = p.x - SLING.x, dy = p.y - SLING.y;
  const d = Math.hypot(dx, dy);
  if (d > MAX_STRETCH) { dx *= MAX_STRETCH / d; dy *= MAX_STRETCH / d; }
  Body.setPosition(activeBird.body, { x: SLING.x + dx, y: SLING.y + dy });
}

function launch(vx, vy) {
  const b = activeBird.body;
  Body.setStatic(b, false);
  Body.setVelocity(b, { x: vx, y: vy });
  Body.setAngularVelocity(b, 0.15);
  activeBird.launched = true;
  state = 'fly';
  launchTime = performance.now();
  calmFrames = 0;
  sfx.launch();
}

// ---------- 進行管理 ----------
function updateFlow(now) {
  if (state === 'fly' && activeBird) {
    const b = activeBird.body;
    const speed = Math.hypot(b.velocity.x, b.velocity.y);
    const oob = b.position.x > W + 200 || b.position.x < -200 || b.position.y > H + 200;
    if (speed < 0.2 && Math.abs(b.angularVelocity) < 0.05) calmFrames++; else calmFrames = 0;
    if (oob || calmFrames > 50 || now - launchTime > 9000) {
      poof(b.position.x, b.position.y, '#aaa', 8);
      Composite.remove(world, b);
      activeBird = null;
      state = 'settle';
      settleUntil = now + 800;
    }
  } else if (state === 'settle' && now > settleUntil) {
    if (pigs.length === 0) {
      finishLevel(true);
    } else if (birdQueue.length === 0) {
      finishLevel(false);
    } else {
      nextBird();
    }
  } else if (state === 'aim' && pigs.length === 0) {
    // 発射前に落下などで全滅した場合
    finishLevel(true);
  }
}

function finishLevel(won) {
  if (state === 'done') return;
  state = 'done';
  if (won) {
    const birdsLeft = birdQueue.length + (activeBird && !activeBird.launched ? 1 : 0);
    addScore(birdsLeft * BIRD_BONUS);
    const stars = Math.min(3, 1 + birdsLeft);
    const last = levelIndex >= LEVELS.length - 1;
    sfx.clear();
    showOverlay({
      title: last ? 'ALL CLEAR! 🎉' : 'LEVEL CLEAR!',
      stars: '⭐'.repeat(stars) + '☆'.repeat(3 - stars),
      text: `スコア ${score}${birdsLeft ? ` (残り鳥ボーナス +${birdsLeft * BIRD_BONUS})` : ''}`,
      nextLabel: last ? 'はじめから' : 'つぎへ ▶',
      onNext: () => {
        if (last) { score = 0; loadLevel(0); } else { loadLevel(levelIndex + 1); }
      },
      onRetry: () => { score = levelStartScore; loadLevel(levelIndex); },
    });
  } else {
    sfx.lose();
    showOverlay({
      title: 'しっぱい… 🐷',
      stars: '',
      text: 'ブタがまだ残ってる!もう一度チャレンジ!',
      nextLabel: 'リトライ ↺',
      onNext: () => { score = levelStartScore; loadLevel(levelIndex); },
      onRetry: null,
    });
  }
}

let ovNext = null, ovRetry = null;
function showOverlay({ title, stars, text, nextLabel, onNext, onRetry }) {
  elOvTitle.textContent = title;
  elOvStars.textContent = stars;
  elOvStars.style.display = stars ? '' : 'none';
  elOvText.textContent = text;
  elOvNext.textContent = nextLabel;
  elOvRetry.style.display = onRetry ? '' : 'none';
  ovNext = onNext; ovRetry = onRetry;
  elOverlay.classList.remove('hidden');
}
function hideOverlay() { elOverlay.classList.add('hidden'); }
elOvNext.addEventListener('click', () => { if (ovNext) ovNext(); });
elOvRetry.addEventListener('click', () => { if (ovRetry) ovRetry(); });

document.getElementById('restart').addEventListener('click', () => {
  score = levelStartScore;
  loadLevel(levelIndex);
});
document.getElementById('mute').addEventListener('click', (e) => {
  muted = !muted;
  e.currentTarget.textContent = muted ? '🔇' : '🔊';
});

// ---------- 描画 ----------
function drawBackground(now) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#8ed4f7');
  sky.addColorStop(0.7, '#cdeffb');
  sky.addColorStop(1, '#e8fbe8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 雲
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const c of clouds) {
    c.x += c.v;
    if (c.x > W + 120) c.x = -120;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 28 * c.s, 0, Math.PI * 2);
    ctx.arc(c.x + 30 * c.s, c.y - 12 * c.s, 22 * c.s, 0, Math.PI * 2);
    ctx.arc(c.x + 58 * c.s, c.y, 25 * c.s, 0, Math.PI * 2);
    ctx.fill();
  }

  // 遠くの丘
  ctx.fillStyle = '#b8e6a0';
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.quadraticCurveTo(300, GROUND_Y - 140, 640, GROUND_Y);
  ctx.quadraticCurveTo(1000, GROUND_Y - 100, 1600, GROUND_Y);
  ctx.fill();

  // 地面
  ctx.fillStyle = '#8bc34a';
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = '#7cb342';
  ctx.fillRect(0, GROUND_Y, W, 12);
}

function drawSlingBack() {
  ctx.strokeStyle = '#6d4c2f';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(SLING.x + 14, SLING.y - 4);
  ctx.lineTo(SLING.x + 20, GROUND_Y);
  ctx.stroke();
  // ゴム(奥側)
  if (state === 'aim' && activeBird) {
    const b = activeBird.body.position;
    ctx.strokeStyle = '#4a2f1c';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(SLING.x + 16, SLING.y - 8);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}
function drawSlingFront() {
  if (state === 'aim' && activeBird) {
    const b = activeBird.body.position;
    ctx.strokeStyle = '#5b3a22';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(SLING.x - 16, SLING.y - 8);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(SLING.x - 14, SLING.y - 4);
  ctx.lineTo(SLING.x - 20, GROUND_Y);
  ctx.stroke();
}

function drawTrajectory() {
  if (!dragging || !activeBird) return;
  const b = activeBird.body;
  const dx = b.position.x - SLING.x, dy = b.position.y - SLING.y;
  if (Math.hypot(dx, dy) < 18) return;
  let vx = -dx * POWER, vy = -dy * POWER;
  let px = b.position.x, py = b.position.y;
  const g = engine.gravity.y * engine.gravity.scale * DT * DT;
  const fa = b.frictionAir;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 90; i++) {
    vx *= (1 - fa); vy *= (1 - fa);
    vy += g;
    px += vx; py += vy;
    if (py > GROUND_Y - 6) break;
    if (i % 4 === 0) {
      ctx.beginPath();
      ctx.arc(px, py, 5 - i * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBlock(ent) {
  const b = ent.body, m = MATS[ent.mat];
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  ctx.fillStyle = m.color;
  ctx.strokeStyle = m.stroke;
  ctx.lineWidth = 3;
  const w = ent.w, h = ent.h;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 4);
  ctx.fill();
  ctx.stroke();
  if (ent.mat === 'wood') { // 木目
    ctx.strokeStyle = 'rgba(120,75,35,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (h > w) { ctx.moveTo(0, -h / 2 + 8); ctx.lineTo(0, h / 2 - 8); }
    else { ctx.moveTo(-w / 2 + 8, 0); ctx.lineTo(w / 2 - 8, 0); }
    ctx.stroke();
  }
  // ダメージのひび
  const dmgRatio = 1 - ent.hp / ent.maxHp;
  if (dmgRatio > 0.35) {
    ctx.strokeStyle = 'rgba(40,30,20,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w / 4, -h / 4);
    ctx.lineTo(w / 8, 0);
    ctx.lineTo(-w / 8, h / 4);
    ctx.stroke();
  }
  if (ent.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${ent.hitFlash / 12})`;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ent.hitFlash--;
  }
  ctx.restore();
}

function drawPig(ent, now) {
  const b = ent.body, r = ent.r;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  // 体
  ctx.fillStyle = ent.hp < ent.maxHp * 0.5 ? '#a5c93e' : '#7ec850';
  ctx.strokeStyle = '#4e8a2e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 耳
  ctx.beginPath();
  ctx.arc(-r * 0.55, -r * 0.85, r * 0.22, 0, Math.PI * 2);
  ctx.arc(r * 0.55, -r * 0.85, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 鼻
  ctx.fillStyle = '#96d868';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.1, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#4e8a2e';
  ctx.beginPath();
  ctx.arc(-r * 0.15, r * 0.1, r * 0.07, 0, Math.PI * 2);
  ctx.arc(r * 0.15, r * 0.1, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // 目(たまに瞬き)
  const blink = ((now / 1000 + ent.blink) % 4) > 3.85;
  ctx.fillStyle = '#fff';
  if (!blink) {
    ctx.beginPath();
    ctx.arc(-r * 0.4, -r * 0.35, r * 0.2, 0, Math.PI * 2);
    ctx.arc(r * 0.4, -r * 0.35, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(-r * 0.36, -r * 0.33, r * 0.09, 0, Math.PI * 2);
    ctx.arc(r * 0.44, -r * 0.33, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#2c5518';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -r * 0.35); ctx.lineTo(-r * 0.25, -r * 0.35);
    ctx.moveTo(r * 0.25, -r * 0.35); ctx.lineTo(r * 0.55, -r * 0.35);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBird(ent, x, y, angle, scale = 1) {
  const t = BIRD_TYPES[ent.type];
  const r = t.r * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // 体
  ctx.fillStyle = t.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // おなか
  ctx.fillStyle = t.belly;
  ctx.beginPath();
  ctx.arc(0, r * 0.45, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  // しっぽ羽
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-r, -r * 0.1); ctx.lineTo(-r * 1.45, -r * 0.45);
  ctx.moveTo(-r, 0.1 * r); ctx.lineTo(-r * 1.5, 0);
  ctx.stroke();
  // くちばし
  ctx.fillStyle = '#f2a141';
  ctx.strokeStyle = '#c77e22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r * 0.75, -r * 0.1);
  ctx.lineTo(r * 1.4, r * 0.12);
  ctx.lineTo(r * 0.75, r * 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 目 + まゆげ(怒り顔)
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(r * 0.35, -r * 0.3, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(r * 0.45, -r * 0.28, r * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#222';
  ctx.lineWidth = r * 0.16;
  ctx.beginPath();
  ctx.moveTo(r * 0.05, -r * 0.62);
  ctx.lineTo(r * 0.7, -r * 0.42);
  ctx.stroke();
  ctx.restore();
}

function drawParticles() {
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life--;
    ctx.globalAlpha = Math.min(1, p.life / 20);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawQueue() {
  // 待機中の鳥をパチンコの左に並べる
  let x = SLING.x - 90;
  for (const type of birdQueue) {
    drawBird({ type }, x, GROUND_Y - BIRD_TYPES[type].r * 0.8, 0, 0.8);
    x -= 55;
  }
}

function drawHint() {
  if (state === 'aim' && activeBird && !dragging) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🐦 を引っぱって発射!', SLING.x + 60, SLING.y - 150);
    if (activeBird.type === 'yellow') {
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText('(飛行中にタップで加速!)', SLING.x + 60, SLING.y - 115);
    }
  }
}

// ---------- メインループ ----------
let lastTime = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min(now - lastTime, 100);
  lastTime = now;
  while (acc >= DT) {
    Engine.update(engine, DT);
    acc -= DT;
  }
  sweepDead();
  updateFlow(now);

  // 描画
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1a2433';
  ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  ctx.translate(viewOX, viewOY);
  ctx.scale(viewScale, viewScale);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();

  drawBackground(now);
  drawSlingBack();
  for (const ent of blocks) drawBlock(ent);
  for (const ent of pigs) drawPig(ent, now);
  drawQueue();
  if (activeBird) {
    const b = activeBird.body;
    drawBird(activeBird, b.position.x, b.position.y, activeBird.launched ? b.angle : 0);
  }
  drawSlingFront();
  drawTrajectory();
  drawParticles();
  drawHint();

  ctx.restore();
}

// ---------- テスト用フック(自動テストから操作する) ----------
window.__game = {
  get state() { return state; },
  get pigs() { return pigs.length; },
  get blocks() { return blocks.length; },
  get score() { return score; },
  get level() { return levelIndex; },
  get birdsLeft() { return birdQueue.length + (activeBird ? 1 : 0); },
  get birdPos() { return activeBird ? { ...activeBird.body.position } : null; },
  launch(vx, vy) { if (state === 'aim' && activeBird) launch(vx, vy); },
  loadLevel(i) { score = 0; loadLevel(i); },
};

// 開始
loadLevel(0);
requestAnimationFrame(frame);
