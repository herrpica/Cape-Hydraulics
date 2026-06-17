/*
 * charts.js — tiny dependency-free canvas plotting (line charts with axes).
 * Used for pump performance curves and the surge pressure-vs-time trace.
 */
(function (global) {
  'use strict';

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    step *= mag;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + 1e-9; v += step) ticks.push(v);
    return ticks;
  }

  /**
   * Draw a multi-series line chart.
   * canvas, cfg:{ series:[{name,color,points:[[x,y]],dashed}], xlabel, ylabel,
   *               title, markers:[{y,color,label}], legend }
   */
  function lineChart(canvas, cfg) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth,
      H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 64, r: 16, t: cfg.title ? 28 : 12, b: 44 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    let xmin = Infinity,
      xmax = -Infinity,
      ymin = Infinity,
      ymax = -Infinity;
    for (const s of cfg.series) {
      for (const [x, y] of s.points) {
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
      }
    }
    for (const m of cfg.markers || []) {
      if (m.y < ymin) ymin = m.y;
      if (m.y > ymax) ymax = m.y;
    }
    if (!isFinite(xmin)) {
      xmin = 0;
      xmax = 1;
      ymin = 0;
      ymax = 1;
    }
    if (xmin === xmax) xmax = xmin + 1;
    const yPad = (ymax - ymin) * 0.08 || 1;
    ymin -= yPad;
    ymax += yPad;

    const sx = (x) => pad.l + ((x - xmin) / (xmax - xmin)) * plotW;
    const sy = (y) => pad.t + plotH - ((y - ymin) / (ymax - ymin)) * plotH;

    // grid + axes
    ctx.strokeStyle = '#e3e8ef';
    ctx.fillStyle = '#5b6573';
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const ty of niceTicks(ymin, ymax, 6)) {
      const y = sy(ty);
      ctx.strokeStyle = '#eef2f7';
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      ctx.fillText(fmt(ty), pad.l - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tx of niceTicks(xmin, xmax, 7)) {
      const x = sx(tx);
      ctx.strokeStyle = '#f1f4f9';
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + plotH);
      ctx.stroke();
      ctx.fillText(fmt(tx), x, pad.t + plotH + 6);
    }

    // axis frame
    ctx.strokeStyle = '#c4ccd8';
    ctx.strokeRect(pad.l, pad.t, plotW, plotH);

    // markers (horizontal reference lines, e.g. MAWP)
    for (const m of cfg.markers || []) {
      const y = sy(m.y);
      ctx.save();
      ctx.strokeStyle = m.color || '#d12';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = m.color || '#d12';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(m.label || '', pad.l + 6, y - 2);
      ctx.restore();
    }

    // series
    for (const s of cfg.series) {
      ctx.strokeStyle = s.color || '#2b6cb0';
      ctx.lineWidth = s.width || 1.8;
      if (s.dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      s.points.forEach(([x, y], i) => {
        const X = sx(x),
          Y = sy(y);
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.dots) {
        ctx.fillStyle = s.color || '#2b6cb0';
        for (const [x, y] of s.points) {
          ctx.beginPath();
          ctx.arc(sx(x), sy(y), 3, 0, 7);
          ctx.fill();
        }
      }
    }

    // title + axis labels
    ctx.fillStyle = '#1f2733';
    if (cfg.title) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(cfg.title, W / 2, 6);
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#5b6573';
    if (cfg.xlabel) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(cfg.xlabel, pad.l + plotW / 2, H - 2);
    }
    if (cfg.ylabel) {
      ctx.save();
      ctx.translate(12, pad.t + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(cfg.ylabel, 0, 0);
      ctx.restore();
    }

    // legend
    if (cfg.legend && cfg.series.length > 1) {
      let lx = pad.l + 10,
        ly = pad.t + 6;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const s of cfg.series) {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, ly, 12, 4);
        ctx.fillStyle = '#1f2733';
        ctx.fillText(s.name, lx + 18, ly + 2);
        lx += ctx.measureText(s.name).width + 44;
      }
    }
  }

  function fmt(v) {
    const a = Math.abs(v);
    if (a >= 10000) return (v / 1000).toFixed(0) + 'k';
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    if (a === 0) return '0';
    return v.toFixed(2);
  }

  global.HE = global.HE || {};
  global.HE.Charts = { lineChart };
})(typeof window !== 'undefined' ? window : globalThis);
