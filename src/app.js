/*
 * app.js — UI orchestration: toolbar, property editor, results, surge dialog,
 * fluid settings, and save/load. Pure DOM, no framework.
 */
(function (global) {
  'use strict';
  const HE = global.HE;
  const { Model, Editor, Steady, Surge, Fluids, Fittings, Charts, Units } = HE;

  let net = Model.newNetwork();
  let editor;
  let lastResults = null;
  let fluidCard = null; // persistent Fluid card, kept across property re-renders

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs)
      for (const k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
        else e.setAttribute(k, attrs[k]);
      }
    (children || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  };

  function init() {
    const canvas = $('canvas');
    fluidCard = $('fluid-card');
    editor = new Editor(canvas, net);
    editor.onSelect = onSelect;
    editor.onChange = () => {
      markDirty();
    };
    window.addEventListener('resize', () => editor.resize());
    HE.__editor = editor; // debug handle (console access to the live editor)
    bindToolbar();
    bindSurgeModal();
    loadExample('bearskin');
    renderFluid();
    setStatus('Loaded example: Bearskin pad. Click “Run” to solve.');
  }

  // ---------- toolbar ----------
  function bindToolbar() {
    $('tool-select').onclick = () => editor.setMode('select');
    $('add-supply').onclick = () => editor.setMode('node', 'supply');
    $('add-injection').onclick = () => editor.setMode('node', 'injection');
    $('add-junction').onclick = () => editor.setMode('node', 'junction');
    $('add-pipe').onclick = () => editor.setMode('pipe', 'pipe');
    $('add-valve').onclick = () => editor.setMode('pipe', 'valve');
    $('add-check').onclick = () => editor.setMode('pipe', 'check');
    $('add-pump').onclick = () => editor.setMode('pipe', 'pump');
    $('btn-delete').onclick = () => editor.deleteSelection();
    $('btn-fit').onclick = () => editor.fit();
    $('btn-run').onclick = run;
    $('btn-surge').onclick = openSurge;
    $('btn-save').onclick = save;
    $('btn-load').onclick = () => $('file-input').click();
    $('file-input').onchange = load;
    $('btn-new').onclick = () => {
      if (confirm('Start a new empty system?')) {
        net = Model.newNetwork();
        editor.setNetwork(net);
        lastResults = null;
        renderFluid();
        onSelect(null);
        renderResults();
      }
    };
    $('example-select').onchange = (e) => {
      if (e.target.value) loadExample(e.target.value);
    };
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') editor.deleteSelection();
      if (e.key === 'r' || e.key === 'R') run();
      if (e.key === 'Escape') editor.setMode('select');
      if (e.key === 'f' || e.key === 'F') editor.fit();
    });
    // tabs
    $('tab-props').onclick = () => switchTab('props');
    $('tab-results').onclick = () => switchTab('results');
  }

  function switchTab(t) {
    for (const x of ['props', 'results']) {
      $('tab-' + x).classList.toggle('active', x === t);
      $('panel-' + x).style.display = x === t ? 'block' : 'none';
    }
  }

  function markDirty() {
    if (lastResults) {
      lastResults = null;
      editor.setResults(null);
      setStatus('Model changed — re-run to update results.');
    }
  }

  function setStatus(msg, kind) {
    const s = $('status');
    s.textContent = msg;
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---------- fluid ----------
  function renderFluid() {
    const host = $('fluid-fields');
    host.innerHTML = '';
    const presetSel = el('select', {
      onchange: (e) => {
        const p = Fluids.PRESETS[e.target.value];
        if (p) {
          net.fluid = { name: p.name, density: p.density, viscosity: p.viscosity, bulkModulus: p.bulkModulus };
          renderFluid();
          markDirty();
        }
      },
    });
    presetSel.appendChild(el('option', { value: '' }, ['— preset —']));
    for (const k in Fluids.PRESETS) presetSel.appendChild(el('option', { value: k }, [Fluids.PRESETS[k].name]));
    host.appendChild(fieldRow('Fluid preset', presetSel));
    host.appendChild(numField('Density (lb/ft³)', net.fluid.density, (v) => (net.fluid.density = v)));
    host.appendChild(numField('Viscosity (cP)', net.fluid.viscosity, (v) => (net.fluid.viscosity = v)));
    host.appendChild(numField('Bulk modulus (psi)', net.fluid.bulkModulus, (v) => (net.fluid.bulkModulus = v)));
  }

  // ---------- selection / property editor ----------
  function onSelect(sel) {
    switchTab('props');
    const host = $('panel-props');
    // detach the persistent fluid card so innerHTML='' doesn't destroy it
    if (fluidCard && fluidCard.parentNode === host) host.removeChild(fluidCard);
    host.innerHTML = '';
    host.appendChild(fluidCard);
    if (!sel) {
      host.appendChild(el('div', { class: 'hint' }, ['Select a node or pipe to edit its properties, or use the toolbar to add elements.']));
      return;
    }
    if (sel.kind === 'node') buildNodeProps(host, Model.nodeById(net, sel.id));
    else buildLinkProps(host, net.links.find((l) => l.id === sel.id));
  }

  function buildNodeProps(host, n) {
    if (!n) return;
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, ['Node']));
    card.appendChild(textField('Name', n.name, (v) => (n.name = v)));

    const typeSel = el('select', {
      onchange: (e) => {
        n.type = e.target.value;
        onSelect({ kind: 'node', id: n.id });
        markDirty();
        editor.draw();
      },
    });
    [['junction', 'Junction'], ['supply', 'Source (well / pump boundary)'], ['injection', 'Sink (injection well)']].forEach(
      ([v, t]) => typeSel.appendChild(el('option', { value: v, ...(n.type === v ? { selected: 'selected' } : {}) }, [t]))
    );
    card.appendChild(fieldRow('Type', typeSel));
    card.appendChild(numField('Elevation (ft)', n.elevation, (v) => (n.elevation = v)));

    if (n.type === 'supply') {
      const modeSel = el('select', {
        onchange: (e) => {
          n.bcMode = e.target.value;
          onSelect({ kind: 'node', id: n.id });
          markDirty();
          editor.draw();
        },
      });
      [['head', 'Fixed pressure'], ['flow', 'Fixed flow'], ['pi', 'Productivity index (PI)']].forEach(([v, t]) =>
        modeSel.appendChild(el('option', { value: v, ...(n.bcMode === v ? { selected: 'selected' } : {}) }, [t]))
      );
      card.appendChild(fieldRow('Boundary', modeSel));
      if (n.bcMode === 'head') card.appendChild(numField('Pressure (psig)', n.pressure, (v) => (n.pressure = v)));
      if (n.bcMode === 'flow') card.appendChild(numField('Inflow (gpm, + into system)', n.flow, (v) => (n.flow = v)));
      if (n.bcMode === 'pi') {
        card.appendChild(numField('Reservoir pressure (psig)', n.resPressure, (v) => (n.resPressure = v)));
        card.appendChild(numField('Productivity index (gpm/psi)', n.pi, (v) => (n.pi = v)));
        card.appendChild(el('div', { class: 'hint' }, ['Inflow = PI × (reservoir − wellhead pressure)']));
      }
    } else if (n.type === 'injection') {
      card.appendChild(numField('Injection (reservoir) pressure (psig)', n.resPressure, (v) => (n.resPressure = v)));
      card.appendChild(numField('Injectivity index (gpm/psi)', n.ii, (v) => (n.ii = v)));
      card.appendChild(el('div', { class: 'hint' }, ['Injection rate = II × (wellhead − reservoir pressure)']));
    } else {
      card.appendChild(numField('Demand (gpm, − to draw off)', n.demand, (v) => (n.demand = v)));
    }
    host.appendChild(card);

    if (lastResults && lastResults.nodes[n.id]) {
      const r = lastResults.nodes[n.id];
      const rc = el('div', { class: 'card result' });
      rc.appendChild(el('h3', {}, ['Result']));
      rc.appendChild(kv('Pressure', `${r.pressure.toFixed(1)} psig`));
      rc.appendChild(kv('Head', `${r.head.toFixed(1)} ft`));
      host.appendChild(rc);
    }
  }

  function buildLinkProps(host, l) {
    if (!l) return;
    const a = Model.nodeById(net, l.from), b = Model.nodeById(net, l.to);
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, [glyphName(l.type) + ' segment']));
    card.appendChild(textField('Name', l.name, (v) => (l.name = v)));
    card.appendChild(el('div', { class: 'hint' }, [`${nodeLabel(a)} → ${nodeLabel(b)}`]));

    const typeSel = el('select', {
      onchange: (e) => {
        l.type = e.target.value;
        onSelect({ kind: 'link', id: l.id });
        markDirty();
        editor.draw();
      },
    });
    [['pipe', 'Pipe'], ['valve', 'Valve (Cv)'], ['check', 'Check valve'], ['pump', 'Pump']].forEach(([v, t]) =>
      typeSel.appendChild(el('option', { value: v, ...(l.type === v ? { selected: 'selected' } : {}) }, [t]))
    );
    card.appendChild(fieldRow('Type', typeSel));

    const swap = el('button', { class: 'mini', onclick: () => { [l.from, l.to] = [l.to, l.from]; markDirty(); editor.draw(); onSelect({ kind: 'link', id: l.id }); } }, ['⇄ Reverse direction']);
    card.appendChild(swap);

    if (l.type === 'pipe' || l.type === 'check') {
      // size/schedule pickers
      const nomSel = el('select', {
        onchange: (e) => {
          l.nominal = e.target.value;
          applyGeometry(l);
          onSelect({ kind: 'link', id: l.id });
          markDirty();
        },
      });
      Object.keys(Fittings.SCHEDULES).forEach((nn) => nomSel.appendChild(el('option', { value: nn, ...(l.nominal === nn ? { selected: 'selected' } : {}) }, [nn + '"'])));
      const schSel = el('select', {
        onchange: (e) => {
          l.sched = e.target.value;
          applyGeometry(l);
          onSelect({ kind: 'link', id: l.id });
          markDirty();
        },
      });
      const sObj = Fittings.SCHEDULES[String(l.nominal)] || { walls: {} };
      Object.keys(sObj.walls).forEach((sc) => schSel.appendChild(el('option', { value: sc, ...(String(l.sched) === sc ? { selected: 'selected' } : {}) }, ['Sch ' + sc])));
      const sizeRow = el('div', { class: 'row2' }, [labeled('Nominal', nomSel), labeled('Schedule', schSel)]);
      card.appendChild(sizeRow);

      card.appendChild(numField('Inside diameter (in)', round(l.diameter, 3), (v) => (l.diameter = v)));
      card.appendChild(numField('Length (ft)', l.length, (v) => (l.length = v)));

      const matSel = el('select', {
        onchange: (e) => {
          l.material = e.target.value;
          l.roughness = Fittings.MATERIALS[e.target.value].roughness;
          onSelect({ kind: 'link', id: l.id });
          markDirty();
        },
      });
      Object.keys(Fittings.MATERIALS).forEach((m) => matSel.appendChild(el('option', { value: m, ...(l.material === m ? { selected: 'selected' } : {}) }, [Fittings.MATERIALS[m].name])));
      card.appendChild(fieldRow('Material', matSel));
      card.appendChild(numField('Roughness (ft)', l.roughness, (v) => (l.roughness = v)));
      host.appendChild(card);
      host.appendChild(buildFittings(l));
    } else if (l.type === 'valve') {
      card.appendChild(numField('Cv (gpm @ 1 psi, SG 1)', l.cv, (v) => (l.cv = v)));
      card.appendChild(sliderField('Open fraction', l.openFraction, (v) => (l.openFraction = v)));
      const closeBtn = el('button', { class: 'mini', onclick: () => { l.closed = !l.closed; markDirty(); editor.draw(); onSelect({ kind: 'link', id: l.id }); } }, [l.closed ? '◯ Open valve' : '⬤ Close valve']);
      card.appendChild(closeBtn);
      card.appendChild(el('div', { class: 'hint' }, ['Double-click a valve on the canvas to toggle open/closed. Use “Surge” to study closing this valve.']));
      host.appendChild(card);
    } else if (l.type === 'pump') {
      card.appendChild(el('div', { class: 'hint' }, ['Performance curve — head (ft) vs flow (gpm). Add points; a quadratic is fit through them.']));
      host.appendChild(card);
      host.appendChild(buildPumpCurve(l));
    }

    if (lastResults && lastResults.links[l.id]) {
      const r = lastResults.links[l.id];
      const rc = el('div', { class: 'card result' });
      rc.appendChild(el('h3', {}, ['Result']));
      if (r.closed) rc.appendChild(kv('Status', 'CLOSED'));
      else {
        rc.appendChild(kv('Flow', `${r.flow.toFixed(1)} gpm`));
        if (l.type !== 'pump')
          rc.appendChild(kv('Velocity', `${Math.abs(r.velocity).toFixed(2)} ft/s`, Math.abs(r.velocity) > 12 ? 'bad' : Math.abs(r.velocity) > 7 ? 'warn' : 'good'));
        rc.appendChild(kv('ΔP', `${r.dP.toFixed(2)} psi`));
        if (l.type !== 'pump') rc.appendChild(kv('ΔP / 100ft', `${r.dP100.toFixed(2)} psi`));
        if (l.type === 'pump') rc.appendChild(kv('Pump head', `${r.pumpHead.toFixed(1)} ft`));
        rc.appendChild(kv('Reynolds', `${r.Re.toExponential(2)}`));
        rc.appendChild(kv('Friction f', `${r.f.toFixed(4)}`));
      }
      host.appendChild(rc);
    }
  }

  function applyGeometry(l) {
    const g = Fittings.geometry(l.nominal, l.sched);
    if (g) {
      l.diameter = g.id;
      l.wall = g.wall;
    }
    markDirty();
  }

  function buildFittings(l) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, ['Fittings / minor losses']));
    const list = el('div', {});
    (l.fittings || []).forEach((fit, i) => {
      const sel = el('select', { onchange: (e) => { fit.type = e.target.value; markDirty(); } });
      Object.keys(Fittings.FITTINGS).forEach((k) => sel.appendChild(el('option', { value: k, ...(fit.type === k ? { selected: 'selected' } : {}) }, [Fittings.FITTINGS[k].name + ` (K=${Fittings.FITTINGS[k].K})`])));
      const qty = el('input', { type: 'number', value: fit.qty, min: '1', step: '1', class: 'qty', onchange: (e) => { fit.qty = +e.target.value; markDirty(); } });
      const del = el('button', { class: 'mini danger', onclick: () => { l.fittings.splice(i, 1); onSelect({ kind: 'link', id: l.id }); markDirty(); } }, ['✕']);
      list.appendChild(el('div', { class: 'fit-row' }, [sel, qty, del]));
    });
    card.appendChild(list);
    const totalK = Fittings.sumK(l.fittings);
    card.appendChild(el('div', { class: 'hint' }, [`Total K = ${totalK.toFixed(2)}`]));
    card.appendChild(el('button', { class: 'mini', onclick: () => { (l.fittings = l.fittings || []).push({ type: 'elbow90_long', qty: 1 }); onSelect({ kind: 'link', id: l.id }); markDirty(); } }, ['+ Add fitting']));
    return card;
  }

  function buildPumpCurve(l) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, ['Performance curve']));
    const canvas = el('canvas', { class: 'mini-chart' });
    card.appendChild(canvas);
    const list = el('div', {});
    const redraw = () => {
      const fit = Model.fitPumpCurve(l.curve);
      const qs = l.curve.map((p) => p.q);
      const qmax = Math.max(...qs, 1) * 1.1;
      const fitPts = [];
      for (let i = 0; i <= 30; i++) {
        const q = (qmax * i) / 30;
        fitPts.push([q, fit.c0 + fit.c1 * q + fit.c2 * q * q]);
      }
      Charts.lineChart(canvas, {
        title: 'Pump head vs flow',
        xlabel: 'Flow (gpm)',
        ylabel: 'Head (ft)',
        series: [
          { name: 'fit', color: '#7c4dff', points: fitPts },
          { name: 'pts', color: '#1746a2', points: l.curve.map((p) => [p.q, p.h]), dots: true, width: 0 },
        ],
      });
    };
    const rebuild = () => {
      list.innerHTML = '';
      l.curve.forEach((p, i) => {
        const q = el('input', { type: 'number', value: p.q, step: '50', class: 'qty wide', onchange: (e) => { p.q = +e.target.value; redraw(); markDirty(); } });
        const h = el('input', { type: 'number', value: p.h, step: '5', class: 'qty wide', onchange: (e) => { p.h = +e.target.value; redraw(); markDirty(); } });
        const del = el('button', { class: 'mini danger', onclick: () => { l.curve.splice(i, 1); rebuild(); redraw(); markDirty(); } }, ['✕']);
        list.appendChild(el('div', { class: 'fit-row' }, [labeled('Q gpm', q), labeled('H ft', h), del]));
      });
    };
    rebuild();
    card.appendChild(list);
    card.appendChild(el('button', { class: 'mini', onclick: () => { const last = l.curve[l.curve.length - 1] || { q: 0, h: 500 }; l.curve.push({ q: last.q + 1000, h: Math.max(0, last.h - 100) }); rebuild(); redraw(); markDirty(); } }, ['+ Add point']));
    setTimeout(redraw, 0);
    return card;
  }

  // ---------- run steady ----------
  function run() {
    if (net.nodes.length === 0) {
      setStatus('Nothing to solve — add some nodes and pipes.', 'bad');
      return;
    }
    const t0 = performance.now();
    const r = Steady.solve(net);
    const dt = (performance.now() - t0).toFixed(0);
    lastResults = r.ok ? r : r; // keep partial too
    editor.setResults(r);
    renderResults();
    if (editor.selection) onSelect(editor.selection);
    if (r.ok) setStatus(`Solved in ${r.iterations} iterations (${dt} ms).`, 'good');
    else setStatus(r.messages.join('  '), 'bad');
  }

  function renderResults() {
    switchTab('results');
    const host = $('panel-results');
    host.innerHTML = '';
    if (!lastResults) {
      host.appendChild(el('div', { class: 'hint' }, ['No results yet. Click “Run”.']));
      return;
    }
    // warnings
    const warns = [];
    for (const l of net.links) {
      const r = lastResults.links[l.id];
      if (r && !r.closed && Math.abs(r.velocity) > 12) warns.push(`${nameOf(l)} velocity ${Math.abs(r.velocity).toFixed(1)} ft/s exceeds 12 ft/s`);
    }
    if (warns.length) {
      const wc = el('div', { class: 'card warnbox' });
      wc.appendChild(el('h3', {}, ['⚠ Velocity criterion (12 ft/s)']));
      warns.forEach((w) => wc.appendChild(el('div', { class: 'warn-item' }, [w])));
      host.appendChild(wc);
    }

    // link table
    const card = el('div', { class: 'card' });
    card.appendChild(el('h3', {}, ['Pipe / device results']));
    const tbl = el('table', { class: 'data' });
    tbl.appendChild(rowEl('th', ['Segment', 'Flow gpm', 'Vel ft/s', 'ΔP psi', 'ΔP/100ft']));
    for (const l of net.links) {
      const r = lastResults.links[l.id];
      if (!r) continue;
      const vcls = r.closed ? '' : Math.abs(r.velocity) > 12 ? 'bad' : Math.abs(r.velocity) > 7 ? 'warn' : 'good';
      const tr = rowEl('td', [
        nameOf(l),
        r.closed ? '—' : r.flow.toFixed(1),
        r.closed ? 'CLOSED' : l.type === 'pump' ? '—' : Math.abs(r.velocity).toFixed(2),
        r.closed ? '—' : r.dP.toFixed(2),
        r.closed || l.type === 'pump' ? '—' : r.dP100.toFixed(2),
      ]);
      if (vcls) tr.children[2].className = vcls;
      tr.onclick = () => editor.select('link', l.id);
      tr.style.cursor = 'pointer';
      tbl.appendChild(tr);
    }
    card.appendChild(tbl);
    host.appendChild(card);

    // node table
    const ncard = el('div', { class: 'card' });
    ncard.appendChild(el('h3', {}, ['Node pressures']));
    const nt = el('table', { class: 'data' });
    nt.appendChild(rowEl('th', ['Node', 'Pressure psig', 'Head ft']));
    for (const n of net.nodes) {
      const r = lastResults.nodes[n.id];
      if (!r) continue;
      const tr = rowEl('td', [nodeLabel(n), r.pressure.toFixed(1), r.head.toFixed(1)]);
      tr.onclick = () => editor.select('node', n.id);
      tr.style.cursor = 'pointer';
      nt.appendChild(tr);
    }
    ncard.appendChild(nt);
    host.appendChild(ncard);
  }

  // ---------- surge ----------
  function bindSurgeModal() {
    $('surge-close').onclick = () => ($('surge-modal').style.display = 'none');
    $('surge-run').onclick = runSurge;
    $('surge-modal').addEventListener('click', (e) => {
      if (e.target.id === 'surge-modal') $('surge-modal').style.display = 'none';
    });
  }

  function openSurge() {
    const sel = editor.selection;
    let valve = null;
    if (sel && sel.kind === 'link') {
      const l = net.links.find((x) => x.id === sel.id);
      if (l && (l.type === 'valve' || l.type === 'pipe')) valve = l;
    }
    if (!valve) {
      valve = net.links.find((l) => l.type === 'valve') || net.links.find((l) => l.type === 'pipe');
    }
    if (!valve) {
      setStatus('Add a valve (or pipe) and run the model first, then open Surge.', 'bad');
      return;
    }
    // seed parameters from steady solution
    const a = Model.nodeById(net, valve.from);
    const b = Model.nodeById(net, valve.to);
    let q0 = 1000, upstreamP = 300;
    if (lastResults && lastResults.links[valve.id]) q0 = Math.abs(lastResults.links[valve.id].flow) || 1000;
    if (lastResults && lastResults.nodes[valve.from]) upstreamP = lastResults.nodes[valve.from].pressure;
    const pipe = valve.type === 'pipe' ? valve : findUpstreamPipe(valve);

    const f = (id, v) => ($(id).value = v);
    f('sg-length', pipe ? pipe.length : 1000);
    f('sg-dia', round((pipe ? pipe.diameter : valve.diameter) || 10, 3));
    f('sg-wall', (pipe ? pipe.wall : valve.wall) || 0.365);
    f('sg-rough', (pipe ? pipe.roughness : valve.roughness) || 0.00015);
    f('sg-q0', round(q0, 0));
    f('sg-pup', round(upstreamP, 0));
    f('sg-elev', (b ? b.elevation : 0) || 0);
    f('sg-close', 2);
    f('sg-reaches', 24);
    f('sg-mawp', pickMawp(upstreamP)); // nearest ANSI flange class above operating
    $('sg-profile').value = 'linear';
    $('surge-target').textContent = nameOf(valve);
    $('surge-modal').dataset.linkId = valve.id;
    $('surge-modal').style.display = 'flex';
    runSurge();
  }

  // Smallest ANSI B16.5 flange-class working pressure (psig, CS ~ moderate temp)
  // that sits comfortably above the operating pressure — a sensible MAWP default.
  function pickMawp(operating) {
    const classes = [285, 740, 1480, 2220, 3705, 6170]; // 150,300,600,900,1500,2500
    const target = operating * 1.1;
    for (const c of classes) if (c >= target) return c;
    return classes[classes.length - 1];
  }

  function findUpstreamPipe(valve) {
    // nearest pipe feeding the valve's "from" node
    return net.links.find((l) => l.type === 'pipe' && (l.to === valve.from || l.from === valve.from));
  }

  function runSurge() {
    const num = (id) => parseFloat($(id).value);
    const opts = {
      length: num('sg-length'),
      diameter: num('sg-dia'),
      wall: num('sg-wall'),
      roughness: num('sg-rough'),
      fluid: net.fluid,
      E: Fittings.MATERIALS[(net.links[0] && net.links[0].material) || 'carbon_steel'].E,
      Hres: Units.psiToFt(num('sg-pup'), net.fluid.density) + (num('sg-elev') || 0),
      Q0: num('sg-q0'),
      elevValve: num('sg-elev'),
      closeTime: Math.max(0.001, num('sg-close')),
      profile: $('sg-profile').value,
      exponent: 2,
      reaches: num('sg-reaches'),
    };
    const res = Surge.simulate(opts);
    const mawp = num('sg-mawp');
    drawSurge(res, mawp);

    const peak = res.maxPressure;
    const rise = peak - res.steadyPressValve;
    const min = res.minPressure;
    const out = $('surge-summary');
    out.innerHTML = '';
    const add = (k, v, cls) => out.appendChild(kv(k, v, cls));
    add('Wave speed a', `${res.a.toFixed(0)} ft/s`);
    add('Pipe period 2L/a', `${res.pipePeriod.toFixed(2)} s`);
    add('Closure vs period', res.pipePeriod > 0 ? `${(opts.closeTime / res.pipePeriod).toFixed(1)} × (rapid if <1)` : '—');
    add('Steady pressure', `${res.steadyPressValve.toFixed(0)} psig`);
    add('Peak surge pressure', `${peak.toFixed(0)} psig`, peak > mawp ? 'bad' : 'good');
    add('Surge rise', `+${rise.toFixed(0)} psi`);
    add('Min pressure', `${min.toFixed(0)} psig`, min < 0 ? 'warn' : 'good');
    add('Joukowsky (instant) bound', `+${res.joukowskyDP.toFixed(0)} psi`);
    if (res.columnSeparation) add('⚠ Column separation', 'pressure hit vapor — risk of cavitation', 'bad');
    const margin = mawp - peak;
    const verdict =
      peak > mawp
        ? `Peak surge ${peak.toFixed(0)} psig EXCEEDS MAWP ${mawp} psig by ${(peak - mawp).toFixed(0)} psi — slow the closure, add a relief valve, or use a higher pressure class.`
        : `Peak surge ${peak.toFixed(0)} psig is within MAWP ${mawp} psig (margin ${margin.toFixed(0)} psi). A relief valve set ≈ ${(res.steadyPressValve + 0.1 * res.steadyPressValve).toFixed(0)}–${Math.min(mawp, peak).toFixed(0)} psig (≈10% over operating, ≤ MAWP) would relieve this transient.`;
    out.appendChild(el('div', { class: 'verdict ' + (peak > mawp ? 'bad' : 'good') }, [verdict]));
  }

  function drawSurge(res, mawp) {
    const canvas = $('surge-chart');
    const pts = res.time.map((t, i) => [t, res.pressValve[i]]);
    Charts.lineChart(canvas, {
      title: 'Pressure at valve vs time',
      xlabel: 'Time (s)',
      ylabel: 'Pressure (psig)',
      legend: false,
      series: [{ name: 'valve', color: '#d4506a', points: pts, width: 1.6 }],
      markers: [
        { y: mawp, color: '#d12', label: `MAWP ${mawp} psig` },
        { y: res.steadyPressValve, color: '#2b88d8', label: 'steady' },
      ],
    });
  }

  // ---------- save / load ----------
  function save() {
    const blob = new Blob([JSON.stringify(net, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (net.meta.name || 'system').replace(/\s+/g, '_') + '.hydrostick.json';
    a.click();
    setStatus('Saved ' + a.download);
  }
  function load(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        net = Model.normalize(JSON.parse(reader.result));
        editor.setNetwork(net);
        lastResults = null;
        renderFluid();
        onSelect(null);
        renderResults();
        editor.fit();
        setStatus('Loaded ' + file.name);
      } catch (err) {
        setStatus('Could not load file: ' + err.message, 'bad');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function loadExample(key) {
    const ex = HE.EXAMPLES && HE.EXAMPLES[key];
    if (!ex) return;
    net = Model.normalize(JSON.parse(JSON.stringify(ex)));
    editor.setNetwork(net);
    lastResults = null;
    renderFluid();
    onSelect(null);
    renderResults();
    setTimeout(() => editor.fit(), 0);
    setStatus(`Loaded example: ${net.meta.name}. Press “Run”.`);
  }

  // ---------- small DOM helpers ----------
  function fieldRow(label, control) {
    return el('label', { class: 'field' }, [el('span', {}, [label]), control]);
  }
  function labeled(label, control) {
    return el('label', { class: 'field tiny' }, [el('span', {}, [label]), control]);
  }
  function numField(label, value, set) {
    const inp = el('input', { type: 'number', value: value, step: 'any', onchange: (e) => { set(parseFloat(e.target.value)); markDirty(); editor.draw(); } });
    return fieldRow(label, inp);
  }
  function textField(label, value, set) {
    const inp = el('input', { type: 'text', value: value || '', onchange: (e) => { set(e.target.value); markDirty(); editor.draw(); } });
    return fieldRow(label, inp);
  }
  function sliderField(label, value, set) {
    const wrap = el('div', { class: 'field' });
    wrap.appendChild(el('span', {}, [label + ' ']));
    const out = el('b', {}, [(value * 100).toFixed(0) + '%']);
    const inp = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: value, oninput: (e) => { set(+e.target.value); out.textContent = (e.target.value * 100).toFixed(0) + '%'; markDirty(); editor.draw(); } });
    wrap.appendChild(out);
    wrap.appendChild(inp);
    return wrap;
  }
  function kv(k, v, cls) {
    return el('div', { class: 'kv' }, [el('span', {}, [k]), el('b', { class: cls || '' }, [v])]);
  }
  function rowEl(tag, cells) {
    const tr = el('tr');
    cells.forEach((c) => tr.appendChild(el(tag, {}, [String(c)])));
    return tr;
  }
  function nodeLabel(n) {
    return n ? n.name || shortId(n.id) : '?';
  }
  function nameOf(l) {
    return l.name || `${glyphName(l.type)} ${shortId(l.id)}`;
  }
  function glyphName(t) {
    return { pipe: 'Pipe', valve: 'Valve', check: 'Check', pump: 'Pump' }[t] || 'Pipe';
  }
  function shortId(id) {
    return id.replace(/_.*/, '');
  }
  function round(v, d) {
    const m = Math.pow(10, d);
    return Math.round(v * m) / m;
  }

  global.HE = global.HE || {};
  global.HE.App = { init };
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
