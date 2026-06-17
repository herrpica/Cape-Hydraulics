/*
 * editor.js — interactive schematic canvas.
 *
 * Responsibilities: render the network (nodes as wells/pumps/junctions, links as
 * pipe "sticks" with inline valve/check/pump glyphs), handle pan/zoom, node
 * placement, drawing pipes node-to-node, selection and dragging, and painting
 * steady-state results (flow arrows + velocity coloring) on top.
 */
(function (global) {
  'use strict';
  const Model = (global.HE && global.HE.Model);
  const UU = () => global.HE.UIUnits;

  const NODE_R = 16;
  const VEL_OK = 7,
    VEL_WARN = 12; // ft/s thresholds (report criterion = 12 ft/s max)

  class Editor {
    constructor(canvas, net) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.net = net;
      this.view = { ox: 80, oy: 80, scale: 1 };
      this.mode = 'select';
      this.pendingNodeType = 'junction';
      this.pendingLinkType = 'pipe';
      this.selection = null; // {kind,id}
      this.pipeStart = null;
      this.results = null;
      this.showResults = true;
      this.showSpecs = false; // overlay each component's input characteristics
      this.hover = null;
      this.mouse = { x: 0, y: 0, world: { x: 0, y: 0 } };
      this.onSelect = () => {};
      this.onChange = () => {};
      this.onHint = () => {};
      this._bind();
      this.resize();
    }

    setNetwork(net) {
      this.net = net;
      this.selection = null;
      this.pipeStart = null;
      this.results = null;
      this.draw();
    }
    setResults(r) {
      this.results = r;
      this.draw();
    }
    setMode(mode, sub) {
      this.mode = mode;
      if (mode === 'node') this.pendingNodeType = sub || 'junction';
      if (mode === 'pipe') this.pendingLinkType = sub || 'pipe';
      this.pipeStart = null;
      this.canvas.style.cursor = mode === 'select' ? 'default' : 'crosshair';
      this.draw();
    }

    // ---- coordinate transforms ----
    toScreen(x, y) {
      return { x: x * this.view.scale + this.view.ox, y: y * this.view.scale + this.view.oy };
    }
    toWorld(sx, sy) {
      return { x: (sx - this.view.ox) / this.view.scale, y: (sy - this.view.oy) / this.view.scale };
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth,
        h = this.canvas.clientHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    }

    // ---- hit testing ----
    nodeAt(sx, sy) {
      for (let i = this.net.nodes.length - 1; i >= 0; i--) {
        const n = this.net.nodes[i];
        const p = this.toScreen(n.x, n.y);
        if ((sx - p.x) ** 2 + (sy - p.y) ** 2 <= (NODE_R + 3) ** 2) return n;
      }
      return null;
    }
    linkAt(sx, sy) {
      for (let i = this.net.links.length - 1; i >= 0; i--) {
        const l = this.net.links[i];
        const a = Model.nodeById(this.net, l.from);
        const b = Model.nodeById(this.net, l.to);
        if (!a || !b) continue;
        const pa = this.toScreen(a.x, a.y);
        const pb = this.toScreen(b.x, b.y);
        if (distToSeg(sx, sy, pa.x, pa.y, pb.x, pb.y) < 10) return l;
      }
      return null;
    }

    select(kind, id) {
      this.selection = id ? { kind, id } : null;
      this.onSelect(this.selection);
      this.draw();
    }

    // ---- events ----
    _bind() {
      const c = this.canvas;
      let dragNode = null,
        panning = false,
        last = null,
        moved = false;

      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };

      c.addEventListener('mousedown', (e) => {
        const m = pos(e);
        last = m;
        moved = false;
        if (this.mode === 'node') {
          const w = this.toWorld(m.x, m.y);
          const n = Model.newNode(snap(w.x), snap(w.y), this.pendingNodeType);
          this.net.nodes.push(n);
          this.onChange();
          this.select('node', n.id);
          this.setMode('select');
          return;
        }
        if (this.mode === 'pipe') {
          const n = this.nodeAt(m.x, m.y);
          if (n) {
            if (!this.pipeStart) {
              this.pipeStart = n.id;
              this.onHint('Now click a second node to complete the ' + this.pendingLinkType + '.');
            } else if (this.pipeStart !== n.id) {
              const l = Model.newLink(this.pipeStart, n.id, this.pendingLinkType);
              this.net.links.push(l);
              this.onChange();
              this.pipeStart = null;
              this.select('link', l.id);
              this.setMode('select');
            }
          } else {
            // Clicked empty space — give a helpful nudge.
            if (this.net.nodes.length === 0) {
              this.onHint('Add nodes first (Source, Sink, or Node), then connect them with a ' + this.pendingLinkType + '.');
            } else {
              this.onHint(!this.pipeStart
                ? 'Click on an existing node to start the ' + this.pendingLinkType + '.'
                : 'Click on another node to complete the ' + this.pendingLinkType + '.');
            }
          }
          this.draw();
          return;
        }
        // select mode
        const n = this.nodeAt(m.x, m.y);
        if (n && (e.button === 0)) {
          dragNode = n;
          this.select('node', n.id);
          return;
        }
        if (e.button === 0) {
          const l = this.linkAt(m.x, m.y);
          if (l) {
            this.select('link', l.id);
            return;
          }
        }
        // empty space -> pan / deselect
        panning = true;
        if (e.button === 0) this.select(null);
      });

      window.addEventListener('mousemove', (e) => {
        const m = pos(e);
        this.mouse = { x: m.x, y: m.y, world: this.toWorld(m.x, m.y) };
        if (dragNode) {
          const w = this.toWorld(m.x, m.y);
          dragNode.x = snap(w.x);
          dragNode.y = snap(w.y);
          moved = true;
          this.draw();
          return;
        }
        if (panning && last) {
          this.view.ox += m.x - last.x;
          this.view.oy += m.y - last.y;
          last = m;
          moved = true;
          this.draw();
          return;
        }
        if (this.mode === 'pipe' && this.pipeStart) {
          this.draw();
        }
        // hover
        const h = this.nodeAt(m.x, m.y) || this.linkAt(m.x, m.y);
        const hid = h ? h.id : null;
        if (hid !== this.hover) {
          this.hover = hid;
          this.draw();
        }
      });

      window.addEventListener('mouseup', () => {
        if (dragNode && moved) this.onChange();
        dragNode = null;
        panning = false;
        last = null;
      });

      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const m = pos(e);
        const w = this.toWorld(m.x, m.y);
        const k = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.view.scale = Math.min(4, Math.max(0.15, this.view.scale * k));
        // keep cursor world point fixed
        const p = this.toScreen(w.x, w.y);
        this.view.ox += m.x - p.x;
        this.view.oy += m.y - p.y;
        this.draw();
      }, { passive: false });

      c.addEventListener('dblclick', (e) => {
        const m = pos(e);
        const l = this.linkAt(m.x, m.y);
        if (l && l.type === 'valve') {
          l.closed = !l.closed;
          this.onChange();
          this.draw();
        }
      });
    }

    deleteSelection() {
      if (!this.selection) return;
      const { kind, id } = this.selection;
      if (kind === 'node') {
        this.net.links = this.net.links.filter((l) => l.from !== id && l.to !== id);
        this.net.nodes = this.net.nodes.filter((n) => n.id !== id);
      } else {
        this.net.links = this.net.links.filter((l) => l.id !== id);
      }
      this.selection = null;
      this.onSelect(null);
      this.onChange();
      this.draw();
    }

    fit() {
      if (!this.net.nodes.length) return;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const n of this.net.nodes) {
        minx = Math.min(minx, n.x); miny = Math.min(miny, n.y);
        maxx = Math.max(maxx, n.x); maxy = Math.max(maxy, n.y);
      }
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      const pad = 80;
      const sx = (w - 2 * pad) / Math.max(1, maxx - minx);
      const sy = (h - 2 * pad) / Math.max(1, maxy - miny);
      this.view.scale = Math.min(2, Math.max(0.2, Math.min(sx, sy)));
      this.view.ox = pad - minx * this.view.scale + (w - 2 * pad - (maxx - minx) * this.view.scale) / 2;
      this.view.oy = pad - miny * this.view.scale + (h - 2 * pad - (maxy - miny) * this.view.scale) / 2;
      this.draw();
    }

    // ---- rendering ----
    draw() {
      const ctx = this.ctx;
      const w = this.canvas.clientWidth,
        h = this.canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      this._grid(ctx, w, h);

      // links
      for (const l of this.net.links) this._drawLink(ctx, l);

      // rubber band when drawing pipe
      if (this.mode === 'pipe' && this.pipeStart) {
        const a = Model.nodeById(this.net, this.pipeStart);
        if (a) {
          const pa = this.toScreen(a.x, a.y);
          ctx.strokeStyle = '#2b6cb0';
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(this.mouse.x, this.mouse.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // nodes
      for (const n of this.net.nodes) this._drawNode(ctx, n);
    }

    _grid(ctx, w, h) {
      ctx.fillStyle = '#fbfcfe';
      ctx.fillRect(0, 0, w, h);
      const step = 40 * this.view.scale;
      if (step < 8) return;
      ctx.strokeStyle = '#eef1f6';
      ctx.lineWidth = 1;
      const ox = this.view.ox % step,
        oy = this.view.oy % step;
      ctx.beginPath();
      for (let x = ox; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = oy; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }

    _linkColor(l) {
      if (l.type === 'pump') return '#7c4dff'; // pumps aren't velocity-rated pipe
      if (this.showResults && this.results && this.results.links[l.id]) {
        const v = Math.abs(this.results.links[l.id].velocity);
        if (this.results.links[l.id].closed) return '#9aa4b2';
        if (v > VEL_WARN) return '#e02424';
        if (v > VEL_OK) return '#e8a33d';
        return '#2f9e54';
      }
      return '#5b6573';
    }

    _drawLink(ctx, l) {
      const a = Model.nodeById(this.net, l.from);
      const b = Model.nodeById(this.net, l.to);
      if (!a || !b) return;
      const pa = this.toScreen(a.x, a.y);
      const pb = this.toScreen(b.x, b.y);
      const sel = this.selection && this.selection.kind === 'link' && this.selection.id === l.id;
      const hov = this.hover === l.id;

      ctx.lineCap = 'round';
      ctx.strokeStyle = sel ? '#1746a2' : this._linkColor(l);
      ctx.lineWidth = sel ? 5 : hov ? 4 : 3;
      if (l.type === 'valve' && l.closed) ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const mx = (pa.x + pb.x) / 2,
        my = (pa.y + pb.y) / 2;
      const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);

      // flow direction arrow from results
      if (this.showResults && this.results && this.results.links[l.id]) {
        const q = this.results.links[l.id].flow;
        if (Math.abs(q) > 0.5) {
          const dir = q >= 0 ? 1 : -1;
          this._arrow(ctx, mx, my, ang + (dir > 0 ? 0 : Math.PI), this._linkColor(l));
        }
      }

      // device glyph
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      if (l.type === 'valve') this._glyphValve(ctx, l, sel);
      else if (l.type === 'check') this._glyphCheck(ctx, sel);
      else if (l.type === 'pump') this._glyphPump(ctx, sel);
      else if (l.fittings && l.fittings.length) this._glyphFittings(ctx);
      ctx.restore();

      // result / name label (above the segment)
      if (this.showResults && this.results && this.results.links[l.id]) {
        const r = this.results.links[l.id];
        const u = UU();
        let label;
        if (r.closed) label = 'CLOSED';
        else if (l.type === 'pump' && r.indeterminate) label = 'ΔP set · flow ?';
        else if (l.type === 'pump') label = `${u.fmt('flow', Math.abs(r.flow), 0)} · +${u.fmt('pressure', r.pumpDp || 0, 0)} · ${(r.bhp || 0).toFixed(0)} hp`;
        else label = `${u.fmt('flow', Math.abs(r.flow), 0)} · ${u.fmt('velocity', Math.abs(r.velocity), 1)}`;
        this._tag(ctx, mx, my - 16, label, r.closed ? '#9aa4b2' : '#33414f');
      } else if (l.name) {
        this._tag(ctx, mx, my - 16, l.name, '#7a8696');
      }

      // input characteristics overlay (below the segment), independent of results
      if (this.showSpecs) {
        const lines = this._specLink(l);
        if (lines.length) this._tagLines(ctx, mx, my + 14, lines, '#4a5563');
      }
    }

    /** Concise input-spec lines for a link, in the active display units. */
    _specLink(l) {
      const u = UU();
      if (l.type === 'valve') {
        return [`Cv ${l.cv}`, l.closed ? 'CLOSED' : `${Math.round((l.openFraction ?? 1) * 100)}% open`];
      }
      if (l.type === 'pump') {
        if (l.pumpMode === 'curve') {
          const c = (l.curve || [])[0];
          return c ? ['pump', `shutoff ${u.fmt('head', c.h, 0)}`] : ['pump'];
        }
        return ['pump', `ΔP ${u.fmt('pressure', l.dp || 0, 0)}`];
      }
      // pipe / check
      const size = `${l.nominal}" Sch ${l.sched}`;
      const geom = `${u.fmt('length', l.length, 0)} · wall ${u.fmt('diameter', l.wall, 3)}`;
      const lines = [size, geom];
      if (l.fittings && l.fittings.length) {
        const qty = l.fittings.reduce((s, f) => s + (f.qty || 1), 0);
        lines.push(`${qty} fitting${qty === 1 ? '' : 's'}`);
      }
      return lines;
    }

    _arrow(ctx, x, y, ang, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-2, -5);
      ctx.lineTo(-2, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    _glyphValve(ctx, l, sel) {
      const s = 9;
      ctx.fillStyle = l.closed ? '#e02424' : '#fff';
      ctx.strokeStyle = sel ? '#1746a2' : '#33414f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-s, -s);
      ctx.lineTo(0, 0);
      ctx.lineTo(-s, s);
      ctx.closePath();
      ctx.moveTo(s, -s);
      ctx.lineTo(0, 0);
      ctx.lineTo(s, s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    _glyphCheck(ctx, sel) {
      const s = 9;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = sel ? '#1746a2' : '#33414f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, 7);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = '#33414f';
      ctx.moveTo(-3, -5);
      ctx.lineTo(5, 0);
      ctx.lineTo(-3, 5);
      ctx.closePath();
      ctx.fill();
    }
    _glyphPump(ctx, sel) {
      const s = 12;
      ctx.fillStyle = '#efe8ff';
      ctx.strokeStyle = sel ? '#1746a2' : '#7c4dff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, 7);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#7c4dff';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(s, -s);
      ctx.lineTo(s, s * 0.2);
      ctx.stroke();
    }
    _glyphFittings(ctx) {
      ctx.fillStyle = '#8a93a3';
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, 7);
      ctx.fill();
    }

    _drawNode(ctx, n) {
      const p = this.toScreen(n.x, n.y);
      const sel = this.selection && this.selection.kind === 'node' && this.selection.id === n.id;
      const hov = this.hover === n.id;
      const r = NODE_R;
      ctx.lineWidth = sel ? 3 : 2;

      const colors = {
        supply: { fill: '#e6f4ff', stroke: '#2b88d8' },
        injection: { fill: '#ffeef0', stroke: '#d4506a' },
        junction: { fill: '#f2f4f8', stroke: '#8a93a3' },
      };
      const c = colors[n.type] || colors.junction;
      ctx.fillStyle = c.fill;
      ctx.strokeStyle = sel ? '#1746a2' : c.stroke;

      if (n.type === 'junction') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.5, 0, 7);
        ctx.fill();
        ctx.stroke();
      } else {
        // well/source/sink symbol: rounded square with marker
        ctx.beginPath();
        roundRect(ctx, p.x - r, p.y - r, 2 * r, 2 * r, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = c.stroke;
        ctx.font = '600 11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let glyph = 'J';
        if (n.type === 'supply') glyph = n.bcMode === 'pi' ? 'PI' : n.bcMode === 'flow' ? 'Q' : 'P';
        if (n.type === 'injection') glyph = 'INJ';
        ctx.fillText(glyph, p.x, p.y - 4);
      }
      if (hov && !sel) {
        ctx.strokeStyle = '#1746a2';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, 7);
        ctx.stroke();
      }

      // labels
      const name = n.name || shortId(n.id);
      this._tag(ctx, p.x, p.y + r + 12, name, '#5b6573', true);

      let belowY = p.y + (n.type === 'junction' ? r * 0.5 + 22 : r + 26);
      if (this.showResults && this.results && this.results.nodes[n.id]) {
        const pr = this.results.nodes[n.id];
        this._tag(ctx, p.x, belowY, UU().fmt('pressure', pr.pressure, 0), '#1f6f43', true);
        belowY += 14;
      }
      // input characteristics overlay (boundary condition), independent of results
      if (this.showSpecs) {
        const lines = this._specNode(n);
        if (lines.length) this._tagLines(ctx, p.x, belowY + 2, lines, '#4a5563');
      }
    }

    /** Concise input-spec lines for a node's boundary condition. */
    _specNode(n) {
      const u = UU();
      if (n.type === 'supply') {
        if (n.bcMode === 'flow') return [`Q ${u.fmt('flow', n.flow, 0)}`];
        if (n.bcMode === 'pi') return [`PI ${n.pi} gpm/psi`, `res ${u.fmt('pressure', n.resPressure, 0)}`];
        return [`P ${u.fmt('pressure', n.pressure, 0)}`];
      }
      if (n.type === 'injection') {
        return [`II ${n.ii} gpm/psi`, `res ${u.fmt('pressure', n.resPressure, 0)}`];
      }
      // junction
      return n.demand ? [`${n.demand > 0 ? '+' : ''}${u.fmt('flow', n.demand, 0)}`] : [];
    }

    _tag(ctx, x, y, text, color, center) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = center ? 'center' : 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillRect(x - w / 2, y - 8, w, 15);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    }

    /** Stack of small centered spec lines (used by the characteristics overlay). */
    _tagLines(ctx, x, y, lines, color) {
      ctx.font = '10.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lh = 13;
      let w = 0;
      for (const t of lines) w = Math.max(w, ctx.measureText(t).width);
      w += 8;
      const h = lines.length * lh + 4;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x - w / 2, y - 8, w, h);
      ctx.fillStyle = color;
      lines.forEach((t, i) => ctx.fillText(t, x, y + i * lh));
    }
  }

  // helpers
  function snap(v) {
    return Math.round(v / 20) * 20;
  }
  function shortId(id) {
    return id.replace(/_.*/, '');
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1,
      dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx,
      cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  global.HE = global.HE || {};
  global.HE.Editor = Editor;
})(typeof window !== 'undefined' ? window : globalThis);
