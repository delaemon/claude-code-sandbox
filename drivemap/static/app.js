/* drivemap viewer: CesiumJS + PLATEAU 3D Tiles replay of a processed run.
 *
 * No Cesium ion token needed: imagery comes from OSM tiles and the globe
 * uses the plain ellipsoid. PLATEAU buildings are absolute-height, so each
 * tileset is shifted down by config.defaultHeightOffsetM to compensate for
 * the geoid/ellipsoid gap over Tokyo.
 */

"use strict";

const viewer = new Cesium.Viewer("cesiumContainer", {
  baseLayer: new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({
    url: "https://tile.openstreetmap.org/",
  })),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  requestRenderMode: false,
});
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0e14");
viewer.scene.globe.enableLighting = false;
viewer.scene.fog.enabled = true;

const ui = {
  runSelect: document.getElementById("runSelect"),
  status: document.getElementById("status"),
  playPause: document.getElementById("playPause"),
  speedMult: document.getElementById("speedMult"),
  scrub: document.getElementById("scrub"),
  timeLabel: document.getElementById("timeLabel"),
  tilesetToggle: document.getElementById("tilesetToggle"),
  tilesetPanel: document.getElementById("tilesetPanel"),
  cameraButtons: document.getElementById("cameraButtons"),
};

const hud = new Hud(document.getElementById("hud"));

const state = {
  run: null,          // loaded run bundle
  playhead: 0,        // seconds into the run
  playing: false,
  speedMult: 1,
  cameraMode: "chase",
  carEntity: null,
  routeEntity: null,
  lastTick: null,
};

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}

/* ------------------------------------------------------------- PLATEAU */

async function initPlateau() {
  let cfg;
  try {
    cfg = await (await fetch("/api/plateau")).json();
  } catch {
    setStatus("PLATEAU設定の読み込みに失敗", true);
    return;
  }
  const offset = cfg.defaultHeightOffsetM ?? 0;
  for (const ts of cfg.tilesets) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!ts.enabledByDefault;
    label.append(box, ts.label);
    ui.tilesetPanel.append(label);

    let loaded = null;
    const setEnabled = async (on) => {
      if (on && !loaded) {
        try {
          setStatus(`${ts.label} 読み込み中…`);
          loaded = await Cesium.Cesium3DTileset.fromUrl(ts.url, {
            maximumScreenSpaceError: 24,
            skipLevelOfDetail: true,
          });
          const dz = ts.heightOffsetM ?? offset;
          loaded.modelMatrix = Cesium.Matrix4.fromTranslation(
            offsetUp(loaded.boundingSphere.center, -dz));
          viewer.scene.primitives.add(loaded);
          setStatus("");
        } catch (e) {
          box.checked = false;
          setStatus(`${ts.label}: tileset取得失敗 — config/plateau.jsonのURLを確認`, true);
          console.error(ts.url, e);
        }
      } else if (loaded) {
        loaded.show = on;
      }
    };
    box.addEventListener("change", () => setEnabled(box.checked));
    if (box.checked) setEnabled(true);
  }
}

/* Cartesian offset pointing "up" (away from ellipsoid center) at pos. */
function offsetUp(position, meters) {
  const up = Cesium.Cartesian3.normalize(position, new Cesium.Cartesian3());
  return Cesium.Cartesian3.multiplyByScalar(up, meters, up);
}

ui.tilesetToggle.addEventListener("click", () => {
  ui.tilesetPanel.hidden = !ui.tilesetPanel.hidden;
});

/* ---------------------------------------------------------------- runs */

async function initRuns() {
  const runs = await (await fetch("/api/runs")).json();
  if (!runs.length) {
    setStatus("走行データがありません — pipeline/run.py で生成してください", true);
    return;
  }
  for (const r of runs) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = `${r.name} (${Math.round(r.duration_s)}s)`;
    ui.runSelect.append(opt);
  }
  ui.runSelect.addEventListener("change", () => loadRun(ui.runSelect.value));
  await loadRun(runs[0].name);
}

async function loadRun(name) {
  setStatus(`${name} 読み込み中…`);
  const run = await (await fetch(`/api/runs/${name}`)).json();
  state.run = run;
  state.playhead = 0;
  state.playing = false;
  ui.playPause.textContent = "▶";

  if (state.carEntity) viewer.entities.remove(state.carEntity);
  if (state.routeEntity) viewer.entities.remove(state.routeEntity);

  const f = run.frames;
  // static route line (decimated to ~1 point/s)
  const step = Math.max(1, Math.round(run.hz));
  const routePositions = [];
  for (let i = 0; i < f.lat.length; i += step) {
    routePositions.push(Cesium.Cartesian3.fromDegrees(f.lon[i], f.lat[i], carAlt(run, i) + 0.3));
  }
  state.routeEntity = viewer.entities.add({
    polyline: {
      positions: routePositions,
      width: 3,
      material: Cesium.Color.fromCssColorString("#4fd8eb").withAlpha(0.55),
      clampToGround: false,
    },
  });

  state.carEntity = viewer.entities.add({
    box: {
      dimensions: new Cesium.Cartesian3(1.85, 4.5, 1.35),
      material: Cesium.Color.fromCssColorString("#ff4d4d"),
      outline: true,
      outlineColor: Cesium.Color.BLACK,
    },
  });

  applyFrame(0);
  flyToStart();
  setStatus(run.meta?.matched ? "" : "（マップマッチングなしの軌跡）");
}

function carAlt(run, i) {
  // GPS altitude is unreliable in urban canyons; ride slightly above the
  // recorded value so the box never sinks into the OSM imagery
  return (run.frames.alt[i] || 0) + 0.8;
}

function flyToStart() {
  const run = state.run;
  const p = frameAt(0);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat - 0.004, p.alt + 350),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-40), roll: 0 },
    duration: 1.5,
  });
}

/* --------------------------------------------------------- interpolation */

function lerpAngleDeg(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

function frameAt(seconds) {
  const run = state.run;
  const f = run.frames;
  const n = f.lat.length;
  const x = Math.min(Math.max(seconds, 0), run.duration_s) * run.hz;
  const i = Math.min(Math.floor(x), n - 1);
  const j = Math.min(i + 1, n - 1);
  const t = x - i;

  const pick = (arr) => arr ? arr[i] + (arr[j] - arr[i]) * t : undefined;
  return {
    lat: pick(f.lat),
    lon: pick(f.lon),
    alt: pick(f.alt) + 0.8,
    heading: lerpAngleDeg(f.heading[i], f.heading[j], t),
    speed_kmh: pick(f.speed_kmh),
    rpm: pick(f.rpm),
    boost_kpa: pick(f.boost_kpa),
    throttle_pct: pick(f.throttle_pct),
  };
}

/* ------------------------------------------------------------- playback */

function applyFrame(seconds) {
  const p = frameAt(seconds);
  const position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt);
  const hpr = new Cesium.HeadingPitchRoll(
    Cesium.Math.toRadians(p.heading), 0, 0);
  state.carEntity.position = new Cesium.ConstantPositionProperty(position);
  state.carEntity.orientation = new Cesium.ConstantProperty(
    Cesium.Transforms.headingPitchRollQuaternion(position, hpr));

  updateCamera(position, p.heading);
  hud.draw(p);

  ui.scrub.value = Math.round(1000 * seconds / state.run.duration_s);
  ui.timeLabel.textContent =
    `${fmtTime(seconds)} / ${fmtTime(state.run.duration_s)}`;
}

function fmtTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function updateCamera(carPos, headingDeg) {
  const cam = viewer.camera;
  const h = Cesium.Math.toRadians(headingDeg);
  switch (state.cameraMode) {
    case "chase":
      cam.lookAt(carPos,
        new Cesium.HeadingPitchRange(h, Cesium.Math.toRadians(-14), 28));
      break;
    case "onboard": {
      cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      // eye just above the roof, looking along the heading
      const eye = offsetUp(carPos, 1.6);
      const pos = Cesium.Cartesian3.add(carPos, eye, new Cesium.Cartesian3());
      cam.setView({
        destination: pos,
        orientation: { heading: h, pitch: Cesium.Math.toRadians(-4), roll: 0 },
      });
      break;
    }
    case "overhead":
      cam.lookAt(carPos,
        new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-89.5), 480));
      break;
    case "free":
      // leave the camera to the user
      break;
  }
}

function setCameraMode(mode) {
  state.cameraMode = mode;
  if (mode === "free") viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  for (const b of ui.cameraButtons.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.mode === mode);
  }
}

ui.cameraButtons.addEventListener("click", (e) => {
  const mode = e.target.dataset?.mode;
  if (mode) setCameraMode(mode);
});

ui.playPause.addEventListener("click", () => {
  if (!state.run) return;
  if (!state.playing && state.playhead >= state.run.duration_s) {
    state.playhead = 0;  // replay from the top
  }
  state.playing = !state.playing;
  ui.playPause.textContent = state.playing ? "⏸" : "▶";
});

ui.speedMult.addEventListener("change", () => {
  state.speedMult = parseFloat(ui.speedMult.value);
});

ui.scrub.addEventListener("input", () => {
  if (!state.run) return;
  state.playhead = ui.scrub.value / 1000 * state.run.duration_s;
  applyFrame(state.playhead);
});

function tick(now) {
  requestAnimationFrame(tick);
  if (!state.run) return;
  const dt = state.lastTick ? (now - state.lastTick) / 1000 : 0;
  state.lastTick = now;
  if (!state.playing) return;

  state.playhead += dt * state.speedMult;
  if (state.playhead >= state.run.duration_s) {
    state.playhead = state.run.duration_s;
    state.playing = false;
    ui.playPause.textContent = "▶";
  }
  applyFrame(state.playhead);
}

/* ----------------------------------------------------------------- boot */

initPlateau();
initRuns().catch((e) => setStatus(`走行データの読み込みに失敗: ${e}`, true));
requestAnimationFrame(tick);
