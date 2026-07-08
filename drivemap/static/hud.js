/* GT-style telemetry HUD drawn on a 2D canvas over the Cesium scene.
 *
 * Layout (left to right): tachometer with redline arc, digital speed,
 * boost + throttle bar meters. Colors: neutral ink for all text, cyan for
 * live values, amber for boost pressure, red reserved for redline/over-
 * threshold states only.
 */

"use strict";

const HUD_COLORS = {
  ink: "#e8edf2",
  muted: "#8b96a5",
  dim: "rgba(255,255,255,0.14)",
  accent: "#4fd8eb",
  boost: "#ffb454",
  redline: "#ff4d4d",
  panel: "rgba(10,14,20,0.62)",
};

class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.maxRpm = 7000;
    this.redlineRpm = 5800;
    this.boostRange = [-60, 130]; // kPa relative
  }

  /* frame: {speed_kmh, rpm, boost_kpa, throttle_pct} — any field optional */
  draw(frame) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth, cssH = c.clientHeight;
    if (c.width !== cssW * dpr || c.height !== cssH * dpr) {
      c.width = cssW * dpr;
      c.height = cssH * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const h = cssH;
    const tachR = h * 0.42;
    const tachCx = h * 0.52, tachCy = h * 0.52;
    this._panel(ctx, 0, 0, cssW, h);
    this._tachometer(ctx, tachCx, tachCy, tachR, frame.rpm ?? 0);
    this._speed(ctx, h * 1.34, h * 0.5, frame.speed_kmh ?? 0);

    const barX = h * 2.0;
    const barW = Math.max(120, cssW - barX - 24);
    this._barMeter(ctx, barX, h * 0.24, barW, "BOOST",
                   frame.boost_kpa ?? 0, this.boostRange, "kPa",
                   HUD_COLORS.boost, true);
    this._barMeter(ctx, barX, h * 0.62, barW, "THROTTLE",
                   frame.throttle_pct ?? 0, [0, 100], "%",
                   HUD_COLORS.accent, false);
  }

  _panel(ctx, x, y, w, h) {
    ctx.fillStyle = HUD_COLORS.panel;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();
  }

  _tachometer(ctx, cx, cy, r, rpm) {
    const a0 = Math.PI * 0.75;              // 135° (lower left)
    const sweep = Math.PI * 1.5;            // 270° total
    const angleOf = (v) => a0 + sweep * Math.min(1, Math.max(0, v / this.maxRpm));

    // dial background arc
    ctx.lineWidth = r * 0.1;
    ctx.lineCap = "round";
    ctx.strokeStyle = HUD_COLORS.dim;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a0 + sweep);
    ctx.stroke();

    // redline zone
    ctx.strokeStyle = HUD_COLORS.redline;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angleOf(this.redlineRpm), a0 + sweep);
    ctx.stroke();

    // live rpm arc
    const over = rpm >= this.redlineRpm;
    ctx.strokeStyle = over ? HUD_COLORS.redline : HUD_COLORS.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, angleOf(rpm));
    ctx.stroke();

    // major ticks + labels every 1000 rpm
    ctx.fillStyle = HUD_COLORS.muted;
    ctx.font = `${Math.round(r * 0.16)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let v = 0; v <= this.maxRpm; v += 1000) {
      const a = angleOf(v);
      const x1 = cx + Math.cos(a) * r * 0.82, y1 = cy + Math.sin(a) * r * 0.82;
      const x2 = cx + Math.cos(a) * r * 0.9, y2 = cy + Math.sin(a) * r * 0.9;
      ctx.strokeStyle = HUD_COLORS.muted;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const lx = cx + Math.cos(a) * r * 0.68, ly = cy + Math.sin(a) * r * 0.68;
      ctx.fillText(String(v / 1000), lx, ly);
    }

    // digital rpm readout
    ctx.fillStyle = over ? HUD_COLORS.redline : HUD_COLORS.ink;
    ctx.font = `700 ${Math.round(r * 0.3)}px system-ui, sans-serif`;
    ctx.fillText(String(Math.round(rpm)), cx, cy + r * 0.35);
    ctx.fillStyle = HUD_COLORS.muted;
    ctx.font = `${Math.round(r * 0.14)}px system-ui, sans-serif`;
    ctx.fillText("rpm", cx, cy + r * 0.58);
  }

  _speed(ctx, x, cy, kmh) {
    ctx.textAlign = "center";
    ctx.fillStyle = HUD_COLORS.ink;
    ctx.font = `700 ${Math.round(cy * 0.86)}px system-ui, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(Math.round(kmh)), x, cy + cy * 0.28);
    ctx.fillStyle = HUD_COLORS.muted;
    ctx.font = `${Math.round(cy * 0.16)}px system-ui, sans-serif`;
    ctx.fillText("km/h", x, cy + cy * 0.55);
  }

  _barMeter(ctx, x, y, w, label, value, range, unit, color, zeroMark) {
    const hBar = 14;
    const [lo, hi] = range;
    const frac = (v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = HUD_COLORS.muted;
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(label, x, y - 5);

    // track
    ctx.fillStyle = HUD_COLORS.dim;
    ctx.beginPath();
    ctx.roundRect(x, y, w, hBar, 4);
    ctx.fill();

    // fill — for boost, anchor the bar at 0 so vacuum reads leftward
    const zero = zeroMark ? frac(0) : 0;
    const f = frac(value);
    const x0 = x + Math.min(zero, f) * w;
    const x1 = x + Math.max(zero, f) * w;
    ctx.fillStyle = (zeroMark && value < 0) ? "rgba(139,150,165,0.7)" : color;
    ctx.beginPath();
    ctx.roundRect(x0, y, Math.max(2, x1 - x0), hBar, 4);
    ctx.fill();

    if (zeroMark) {
      ctx.strokeStyle = HUD_COLORS.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + zero * w, y - 3);
      ctx.lineTo(x + zero * w, y + hBar + 3);
      ctx.stroke();
    }

    // value readout in ink (text never wears the mark color)
    ctx.fillStyle = HUD_COLORS.ink;
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${value.toFixed(unit === "%" ? 0 : 1)} ${unit}`,
                 x + w, y - 5);
  }
}

window.Hud = Hud;
