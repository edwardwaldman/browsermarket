// Canvas candlestick chart: candles, volume, overlays, sub-panes, markers,
// position lines and a crosshair readout.

import { sma, ema, rsi, macd, bollinger, vwap, crossSignal } from '../engine/indicators.js';
import { computeCustom } from '../engine/custom.js';
import { price as fmtPrice, compact, clockTime } from '../util/format.js';
import { settings } from '../engine/settings.js';

/** Chart chrome follows the theme; read it from CSS so there is one source. */
function chrome() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    grid: v('--grid', '#0f1724'),
    axis: v('--axis', '#5a6b81'),
    text: v('--dim', '#8fa3bd'),
    panel: v('--panel', '#0a0f18'),
    entry: v('--text', '#c3d2e6'),
    cross: v('--line-2', '#3b4b63'),
  };
}

const COL = {
  grid: '#0f1724',
  axis: '#5a6b81',
  text: '#8fa3bd',
  sma: '#4c7fe0',
  ema: '#f5c451',
  bb: 'rgba(168,85,247,.45)',
  vwap: '#22d3ee',
  entry: '#c3d2e6',
  cross: '#3b4b63',
  alert: '#22d3ee',
};

/** Candle colours follow the colourblind setting. */
function palette() {
  const p = settings.palette;
  return { up: p.up, down: p.down, upFill: p.up, downFill: p.down };
}

const withAlpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const INDICATORS = [
  { id: 'sma20', label: 'SMA 20', pane: 'main', color: COL.sma },
  { id: 'sma50', label: 'SMA 50', pane: 'main', color: '#8b5cf6' },
  { id: 'ema9', label: 'EMA 9', pane: 'main', color: COL.ema },
  { id: 'bb', label: 'BOLLINGER', pane: 'main', color: COL.bb },
  { id: 'vwap', label: 'VWAP', pane: 'main', color: COL.vwap },
  { id: 'vol', label: 'VOLUME', pane: 'vol', color: '#33415a' },
  { id: 'rsi', label: 'RSI 14', pane: 'sub', color: '#f472b6' },
  { id: 'macd', label: 'MACD', pane: 'sub', color: '#22d3ee' },
];

export class Chart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.candles = [];
    this.markers = [];
    this.lines = [];
    this.active = new Set(['sma20', 'vol']);
    this.custom = [];        // user-built indicator definitions, drawn on top
    this.barCount = 90;
    this.hover = null;
    this.minuteOf = (t) => t % 1440;
    this.onHover = null;
    this.dpr = 1;
    this.offset = 0;          // bars scrolled back from the live edge
    this.alertMode = false;
    this.onArmAlert = null;
    this.alerts = [];

    canvas.addEventListener('mousemove', (e) => this.handleMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.render(); this.onHover?.(null); });
    canvas.addEventListener('touchstart', (e) => this.handleMove(e.touches[0]), { passive: true });
    canvas.addEventListener('touchmove', (e) => this.handleMove(e.touches[0]), { passive: true });
    canvas.addEventListener('click', (e) => this.handleClick(e));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.pan(e.deltaX || e.deltaY > 0 ? 2 : -2);
    }, { passive: false });
  }

  toggle(id) {
    if (this.active.has(id)) this.active.delete(id);
    else this.active.add(id);
    this.render();
  }

  customOverlay() { return this.custom.filter((d) => d.plot !== 'sub'); }

  customSub() { return this.custom.filter((d) => d.plot === 'sub'); }

  zoom(delta) {
    this.barCount = Math.max(24, Math.min(320, this.barCount + delta));
    this.render();
  }

  setData({ candles, markers = [], lines = [], minuteOf }) {
    this.candles = candles || [];
    this.markers = markers;
    this.lines = lines;
    if (minuteOf) this.minuteOf = minuteOf;
  }

  visible() {
    const end = Math.max(this.barCount, this.candles.length - this.offset);
    return this.candles.slice(Math.max(0, end - this.barCount), end);
  }

  /** True when the view is pinned to the newest bar. */
  get isLive() {
    return this.offset <= 0;
  }

  pan(bars) {
    const max = Math.max(0, this.candles.length - this.barCount);
    this.offset = Math.max(0, Math.min(max, this.offset + bars));
    this.render();
  }

  goLive() {
    this.offset = 0;
    this.render();
  }

  /** Convert a click's y position into a price, for arming alerts. */
  priceAt(y) {
    const geo = this.geometry();
    if (!geo) return null;
    const { padT, mainH } = geo;
    const { hi, lo } = this.scale || {};
    if (hi === undefined) return null;
    return lo + ((padT + mainH - y) / mainH) * (hi - lo);
  }

  handleClick(e) {
    if (!this.alertMode) return;
    const rect = this.canvas.getBoundingClientRect();
    const price = this.priceAt(e.clientY - rect.top);
    if (price === null || !(price > 0)) return;
    this.alertMode = false;
    this.onArmAlert?.(price);
  }

  handleMove(e) {
    if (!e) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const geo = this.geometry();
    if (!geo) return;
    const i = Math.round((x - geo.padL - geo.bw / 2) / geo.step);
    const bars = this.visible();
    this.hover = i >= 0 && i < bars.length ? i : null;
    this.render();
    this.onHover?.(this.hover !== null ? bars[this.hover] : null);
  }

  geometry() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return null;
    const bars = this.visible();
    if (!bars.length) return null;
    const padL = 8;
    const padR = 74;
    const padT = 36;
    const padB = 26;
    const hasSub = this.active.has('rsi') || this.active.has('macd') || this.customSub().length > 0;
    const volH = this.active.has('vol') ? height * 0.15 : 0;
    const subH = hasSub ? height * 0.22 : 0;
    const mainH = height - padT - padB - volH - subH;
    const plotW = width - padL - padR;
    const step = plotW / bars.length;
    const bw = Math.max(2, Math.min(18, step * 0.7));
    return { width, height, padL, padR, padT, padB, mainH, volH, subH, plotW, step, bw, bars };
  }

  resize() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render() {
    const geo = this.geometry();
    if (!geo) return;
    this.resize();
    const ctx = this.ctx;
    const { width, height, padL, padR, padT, mainH, volH, subH, step, bw, bars } = geo;

    ctx.clearRect(0, 0, width, height);

    const closes = bars.map((c) => c.c);
    let hi = -Infinity;
    let lo = Infinity;
    for (const c of bars) { hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); }
    for (const l of this.lines) {
      if (l.price > lo * 0.9 && l.price < hi * 1.1) { hi = Math.max(hi, l.price); lo = Math.min(lo, l.price); }
    }
    for (const a of this.alerts) {
      if (a.price > lo * 0.75 && a.price < hi * 1.25) { hi = Math.max(hi, a.price); lo = Math.min(lo, a.price); }
    }
    const pad = (hi - lo) * 0.08 || hi * 0.01 || 1;
    hi += pad; lo -= pad;
    this.scale = { hi, lo };
    const yOf = (p) => padT + mainH - ((p - lo) / (hi - lo)) * mainH;
    const xOf = (i) => padL + i * step + step / 2;

    this.drawGrid(ctx, geo, hi, lo, yOf);
    if (volH > 0) this.drawVolume(ctx, geo, bars);
    this.drawOverlays(ctx, geo, bars, closes, yOf, xOf);
    this.drawCandles(ctx, geo, bars, yOf, xOf, bw);
    this.drawLines(ctx, geo, yOf);
    this.drawAlerts(ctx, geo, yOf);
    this.drawMarkers(ctx, geo, bars, yOf, xOf);
    if (subH > 0) this.drawSubPane(ctx, geo, closes);
    this.drawAxes(ctx, geo, hi, lo, yOf, xOf, bars);
    this.drawLast(ctx, geo, bars, yOf);
    if (this.hover !== null) this.drawCrosshair(ctx, geo, bars, yOf, xOf);
  }

  drawGrid(ctx, geo, hi, lo, yOf) {
    const { width, padL, padR, padT, mainH } = geo;
    ctx.strokeStyle = chrome().grid;
    ctx.lineWidth = 1;
    const steps = settings.gridLines;
    for (let i = 0; i <= steps; i++) {
      const p = lo + ((hi - lo) * i) / steps;
      const y = Math.round(yOf(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
    }
  }

  drawVolume(ctx, geo, bars) {
    const { padL, padT, mainH, volH, step, bw } = geo;
    const top = padT + mainH;
    const max = Math.max(...bars.map((c) => c.v), 1);
    for (let i = 0; i < bars.length; i++) {
      const c = bars[i];
      const h = (c.v / max) * (volH - 4);
      const pal = palette();
      ctx.fillStyle = withAlpha(c.c >= c.o ? pal.up : pal.down, 0.3);
      ctx.fillRect(padL + i * step + (step - bw) / 2, top + volH - h - 2, bw, h);
    }
    ctx.fillStyle = chrome().axis;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`VOL  max ${compact(max)}`, padL + 2, top + 12);
  }

  drawOverlays(ctx, geo, bars, closes, yOf, xOf) {
    const line = (vals, color, w = 1.4, dash = null) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] === null || vals[i] === undefined) { started = false; continue; }
        const x = xOf(i);
        const y = yOf(vals[i]);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };
    if (this.active.has('bb')) {
      const b = bollinger(closes, 20, 2);
      line(b.upper, COL.bb, 1);
      line(b.lower, COL.bb, 1);
      line(b.mid, withAlpha('#a855f7', 0.28), 1, [3, 3]);
    }
    if (this.active.has('sma20')) line(sma(closes, 20), COL.sma, 1.5);
    if (this.active.has('sma50')) line(sma(closes, 50), '#8b5cf6', 1.3);
    if (this.active.has('ema9')) line(ema(closes, 9), COL.ema, 1.2);
    if (this.active.has('vwap')) line(vwap(bars), COL.vwap, 1.2, [4, 3]);

    for (const def of this.customOverlay()) {
      const res = computeCustom(def, bars);
      if (!res || res.error) continue;
      if (res.upper) line(res.upper, withAlpha(def.color, 0.4), 1);
      if (res.lower) line(res.lower, withAlpha(def.color, 0.4), 1);
      line(res.values, def.color, def.width, def.offset ? [5, 3] : null);
    }
  }

  /** A user-built indicator that asked for its own pane below the candles. */
  drawCustomSub(ctx, geo, bars, top) {
    const def = this.customSub()[0];
    const { padL, padR, width, subH } = geo;
    const res = computeCustom(def, bars);
    if (!res || res.error) {
      ctx.fillStyle = chrome().text;
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${def.name}: ${res?.error ?? 'no data'}`, padL + 2, top + 14);
      return;
    }
    const defined = res.values.filter((v) => Number.isFinite(v));
    if (!defined.length) {
      ctx.fillStyle = chrome().text;
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${def.name} needs ${res.warmup} bars`, padL + 2, top + 14);
      return;
    }
    let hi = Math.max(...defined, ...def.guides);
    let lo = Math.min(...defined, ...def.guides);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.12;
    hi += pad; lo -= pad;
    const y = (v) => top + subH - ((v - lo) / (hi - lo)) * (subH - 14) - 6;
    const xOf = (i) => padL + i * geo.step + geo.step / 2;

    ctx.save();
    ctx.strokeStyle = withAlpha(def.color, 0.28);
    ctx.setLineDash([3, 3]);
    for (const g of def.guides) {
      if (g < lo || g > hi) continue;
      ctx.beginPath(); ctx.moveTo(padL, y(g)); ctx.lineTo(width - padR, y(g)); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = def.width;
    ctx.beginPath();
    let started = false;
    res.values.forEach((v, i) => {
      if (!Number.isFinite(v)) { started = false; return; }
      if (!started) { ctx.moveTo(xOf(i), y(v)); started = true; } else ctx.lineTo(xOf(i), y(v));
    });
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = def.color;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${def.name} ${defined.at(-1).toFixed(2)}`, padL + 2, top + 10);
  }

  drawCandles(ctx, geo, bars, yOf, xOf, bw) {
    const pal = palette();
    for (let i = 0; i < bars.length; i++) {
      const c = bars[i];
      const up = c.c >= c.o;
      const x = xOf(i);
      ctx.strokeStyle = up ? pal.up : pal.down;
      ctx.fillStyle = up ? pal.upFill : pal.downFill;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yOf(c.h));
      ctx.lineTo(Math.round(x) + 0.5, yOf(c.l));
      ctx.stroke();
      const yO = yOf(c.o);
      const yC = yOf(c.c);
      const top = Math.min(yO, yC);
      const h = Math.max(1, Math.abs(yC - yO));
      ctx.fillRect(x - bw / 2, top, bw, h);
    }
  }

  drawLines(ctx, geo, yOf) {
    const { width, padL, padR } = geo;
    for (const l of this.lines) {
      const y = Math.round(yOf(l.price)) + 0.5;
      if (!Number.isFinite(y)) continue;
      ctx.save();
      ctx.strokeStyle = l.color || chrome().entry;
      ctx.setLineDash(l.dash || [5, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      ctx.restore();
      if (l.label) {
        ctx.font = '11.5px ui-monospace, monospace';
        const w = ctx.measureText(l.label).width + 14;
        const x = width - padR - w - 6;
        ctx.fillStyle = chrome().panel;
        ctx.fillRect(x, y - 10, w, 19);
        ctx.strokeStyle = l.color || chrome().entry;
        ctx.setLineDash([]);
        ctx.strokeRect(x, y - 10, w, 19);
        ctx.fillStyle = l.color || chrome().entry;
        ctx.textAlign = 'left';
        ctx.fillText(l.label, x + 7, y + 4);

        // The live P&L rides on the entry line itself, immediately left of the
        // label. What an open trade is doing right now is the number you want
        // without looking for it, and it used to live only in a panel further
        // down the ticket.
        if (l.badge) {
          const pal = palette();
          const bw = ctx.measureText(l.badge).width + 14;
          const bx = x - bw - 4;
          ctx.fillStyle = l.badgeUp ? pal.up : pal.down;
          ctx.fillRect(bx, y - 10, bw, 19);
          ctx.fillStyle = '#04120a';
          ctx.fillText(l.badge, bx + 7, y + 4);
        }
      }
    }
  }

  drawAlerts(ctx, geo, yOf) {
    const { width, padL, padR } = geo;
    for (const a of this.alerts) {
      const y = Math.round(yOf(a.price)) + 0.5;
      if (!Number.isFinite(y)) continue;
      ctx.save();
      ctx.strokeStyle = COL.alert;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      ctx.restore();
      const label = `ALERT ${fmtPrice(a.price)}`;
      ctx.font = '11.5px ui-monospace, monospace';
      const w = ctx.measureText(label).width + 16;
      ctx.fillStyle = chrome().panel;
      ctx.fillRect(width - padR - w - 6, y - 10, w, 19);
      ctx.strokeStyle = COL.alert;
      ctx.strokeRect(width - padR - w - 6, y - 10, w, 19);
      ctx.fillStyle = COL.alert;
      ctx.textAlign = 'left';
      ctx.fillText(label, width - padR - w + 2, y + 4);
    }
  }

  drawMarkers(ctx, geo, bars, yOf, xOf) {
    if (!bars.length) return;
    const first = bars[0].t;
    const last = bars[bars.length - 1].t;
    const span = bars.length > 1 ? bars[1].t - bars[0].t : 1;
    for (const m of this.markers) {
      if (m.t < first || m.t > last + span) continue;
      const i = Math.min(bars.length - 1, Math.max(0, Math.round((m.t - first) / span)));
      const c = bars[i];
      const buy = m.side === 'BUY';
      const y = buy ? yOf(c.l) + 8 : yOf(c.h) - 8;
      ctx.fillStyle = buy ? palette().up : palette().down;
      ctx.beginPath();
      const x = xOf(i);
      if (buy) { ctx.moveTo(x, y - 5); ctx.lineTo(x - 4, y + 2); ctx.lineTo(x + 4, y + 2); }
      else { ctx.moveTo(x, y + 5); ctx.lineTo(x - 4, y - 2); ctx.lineTo(x + 4, y - 2); }
      ctx.closePath();
      ctx.fill();
    }
  }

  drawSubPane(ctx, geo, closes) {
    const { width, padL, padR, padT, mainH, volH, subH } = geo;
    const top = padT + mainH + volH;
    ctx.strokeStyle = chrome().grid;
    ctx.beginPath();
    ctx.moveTo(padL, top + 0.5);
    ctx.lineTo(width - padR, top + 0.5);
    ctx.stroke();
    const xOf = (i) => padL + i * geo.step + geo.step / 2;

    if (this.active.has('rsi')) {
      const vals = rsi(closes, 14);
      const y = (v) => top + subH - (v / 100) * (subH - 8) - 4;
      ctx.strokeStyle = 'rgba(244,114,182,.25)';
      ctx.setLineDash([3, 3]);
      for (const lvl of [30, 70]) {
        ctx.beginPath(); ctx.moveTo(padL, y(lvl)); ctx.lineTo(width - padR, y(lvl)); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      let started = false;
      vals.forEach((v, i) => {
        if (v === null) { started = false; return; }
        if (!started) { ctx.moveTo(xOf(i), y(v)); started = true; } else ctx.lineTo(xOf(i), y(v));
      });
      ctx.stroke();
      ctx.fillStyle = '#f472b6';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`RSI ${vals.at(-1)?.toFixed(1) ?? '--'}`, padL + 2, top + 10);
    } else if (this.active.has('macd')) {
      const m = macd(closes);
      const all = m.hist.filter((v) => v !== null);
      const max = Math.max(...all.map(Math.abs), 1e-9);
      const mid = top + subH / 2;
      const y = (v) => mid - (v / max) * (subH / 2 - 6);
      m.hist.forEach((v, i) => {
        if (v === null) return;
        ctx.fillStyle = withAlpha(v >= 0 ? palette().up : palette().down, 0.55);
        ctx.fillRect(xOf(i) - geo.bw / 2, Math.min(mid, y(v)), geo.bw, Math.abs(y(v) - mid));
      });
      const drawLine = (vals, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
        let started = false;
        vals.forEach((v, i) => {
          if (v === null) { started = false; return; }
          if (!started) { ctx.moveTo(xOf(i), y(v)); started = true; } else ctx.lineTo(xOf(i), y(v));
        });
        ctx.stroke();
      };
      drawLine(m.line, '#22d3ee');
      drawLine(m.signal, '#f5c451');
      ctx.fillStyle = '#22d3ee';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('MACD 12 26 9', padL + 2, top + 10);
    } else if (this.customSub().length) {
      this.drawCustomSub(ctx, geo, geo.bars, top);
    }
  }

  drawAxes(ctx, geo, hi, lo, yOf, xOf, bars) {
    const { width, height, padR, padB } = geo;
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = chrome().axis;
    ctx.textAlign = 'left';
    for (let i = 0; i <= 5; i++) {
      const p = lo + ((hi - lo) * i) / 5;
      ctx.fillText(fmtPrice(p), width - padR + 8, yOf(p) + 4);
    }
    ctx.textAlign = 'center';

    /**
     * HOW MANY TIMESTAMPS FIT, NOT SEVEN.
     *
     * This drew a fixed seven labels whatever the width. A timestamp is about
     * fifty pixels, so on a phone seven of them ran into each other and came
     * out as one unreadable smear, with the leftmost half off the canvas.
     * Measure the label, divide the plot by it, and draw that many.
     */
    const sample = clockTime(this.minuteOf(bars[0].t));
    const textW = ctx.measureText(sample).width;
    const slot = textW + 20;                       // plus breathing room
    const plotW = width - geo.padL - padR;
    const fits = Math.max(2, Math.floor(plotW / slot));
    const labelEvery = Math.max(1, Math.ceil(bars.length / fits));

    for (let i = 0; i < bars.length; i += labelEvery) {
      const x = xOf(i);
      // Centred text runs half its width either side, so one too close to an
      // edge gets clipped. Skipping it beats printing half a time.
      if (x - textW / 2 < 0 || x + textW / 2 > width - padR) continue;
      ctx.fillText(clockTime(this.minuteOf(bars[i].t)), x, height - padB + 16);
    }
  }

  drawLast(ctx, geo, bars, yOf) {
    const { width, padR } = geo;
    const last = bars[bars.length - 1];
    if (!last) return;
    const pal = palette();
    const up = last.c >= last.o;
    const y = yOf(last.c);
    ctx.save();
    ctx.strokeStyle = withAlpha(up ? pal.up : pal.down, 0.35);
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(geo.padL, Math.round(y) + 0.5);
    ctx.lineTo(width - padR, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = up ? pal.up : pal.down;
    ctx.fillRect(width - padR + 2, y - 10, padR - 4, 20);
    ctx.fillStyle = chrome().panel;
    ctx.font = 'bold 12.5px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(fmtPrice(last.c), width - padR + (padR - 2) / 2, y + 4.5);
  }

  drawCrosshair(ctx, geo, bars, yOf, xOf) {
    const { width, height, padL, padR, padT, padB } = geo;
    const c = bars[this.hover];
    if (!c) return;
    const x = xOf(this.hover);
    ctx.save();
    ctx.strokeStyle = chrome().cross;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, padT - 8);
    ctx.lineTo(Math.round(x) + 0.5, height - padB);
    ctx.stroke();
    const y = yOf(c.c);
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(width - padR, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  /** Text for the legend row above the chart. */
  readout() {
    const bars = this.visible();
    const c = this.hover !== null ? bars[this.hover] : bars[bars.length - 1];
    if (!c) return null;
    const chg = c.c - c.o;
    return {
      o: c.o, h: c.h, l: c.l, c: c.c, v: c.v,
      chg, chgPct: (chg / c.o) * 100,
      time: clockTime(this.minuteOf(c.t)),
    };
  }

  signal() {
    return crossSignal(this.candles, 20);
  }
}
