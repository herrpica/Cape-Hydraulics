/*
 * app.js — UI orchestration: toolbar, property editor, results, surge dialog,
 * fluid settings, and save/load. Pure DOM, no framework.
 */
(function (global) {
  'use strict';
  const HE = global.HE;
  const { Model, Editor, Steady, Surge, Fluids, Fittings, Charts, Units, UIUnits } = HE;

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
    editor.onHint = setStatus;
    editor.onChange = () => {
      markDirty();
    };
    window.addEventListener('resize', () => editor.resize());
    HE.__editor = editor; // debug handle (console access to the live editor)
    bindToolbar();
    bindSurgeModal();
    bindDescribeModal();
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
    $('add-pipe').onclick = () => { editor.setMode('pipe', 'pipe'); setStatus('Pipe: click a node to start, then click another node to connect.'); };
    $('add-valve').onclick = () => { editor.setMode('pipe', 'valve'); setStatus('Valve: click a node to start, then click another node to connect.'); };
    $('add-check').onclick = () => { editor.setMode('pipe', 'check'); setStatus('Check valve: click a node to start, then click another node to connect.'); };
    $('add-pump').onclick = () => { editor.setMode('pipe', 'pump'); setStatus('Pump: click a node to start, then click another node to connect.'); };
    $('btn-delete').onclick = () => editor.deleteSelection();
    $('btn-fit').onclick = () => editor.fit();
    $('btn-run').onclick = run;
    $('btn-surge').onclick = openSurge;
    $('btn-describe').onclick = openDescribe;
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
    $('btn-units').onclick = () => {
      UIUnits.set(UIUnits.isSI() ? 'US' : 'SI');
      $('btn-units').textContent = UIUnits.system;
      $('btn-units').classList.toggle('primary', UIUnits.isSI());
      renderFluid();
      if (editor.selection) onSelect(editor.selection);
      else onSelect(null);
      renderResults();
      editor.draw();
      setStatus('Display units: ' + (UIUnits.isSI() ? 'SI (barg, m³/h, m/s, m, mm)' : 'US (psig, gpm, ft/s, ft, in)'));
    };
    $('btn-specs').onclick = () => {
      editor.showSpecs = !editor.showSpecs;
      $('btn-specs').classList.toggle('primary', editor.showSpecs);
      editor.draw();
      setStatus(editor.showSpecs ? 'Showing component characteristics on the schematic.' : 'Hid component characteristics.');
    };
    $('btn-csv').onclick = exportCsv;
    $('btn-report').onclick = openReport;
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
    // Re-select the active preset if the current fluid still matches one.
    const activeKey = Object.keys(Fluids.PRESETS).find((k) => Fluids.PRESETS[k].name === net.fluid.name);
    if (activeKey) presetSel.value = activeKey;
    host.appendChild(fieldRow('Fluid preset', presetSel));
    host.appendChild(dimField('Density', 'density', net.fluid.density, (v) => (net.fluid.density = v)));
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
    card.appendChild(dimField('Elevation', 'length', n.elevation, (v) => (n.elevation = v)));

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
      if (n.bcMode === 'head') card.appendChild(dimField('Pressure', 'pressure', n.pressure, (v) => (n.pressure = v)));
      if (n.bcMode === 'flow') card.appendChild(dimField('Inflow (+ into system)', 'flow', n.flow, (v) => (n.flow = v)));
      if (n.bcMode === 'pi') {
        card.appendChild(dimField('Reservoir pressure', 'pressure', n.resPressure, (v) => (n.resPressure = v)));
        card.appendChild(numField('Productivity index (gpm/psi)', n.pi, (v) => (n.pi = v)));
        card.appendChild(el('div', { class: 'hint' }, ['Inflow = PI × (reservoir − wellhead pressure). PI stays in gpm/psi.']));
      }
    } else if (n.type === 'injection') {
      card.appendChild(dimField('Injection (reservoir) pressure', 'pressure', n.resPressure, (v) => (n.resPressure = v)));
      card.appendChild(numField('Injectivity index (gpm/psi)', n.ii, (v) => (n.ii = v)));
      card.appendChild(el('div', { class: 'hint' }, ['Injection rate = II × (wellhead − reservoir pressure). II stays in gpm/psi.']));
    } else {
      card.appendChild(dimField('Demand (− to draw off)', 'flow', n.demand, (v) => (n.demand = v)));
    }
    host.appendChild(card);

    if (lastResults && lastResults.nodes[n.id]) {
      const r = lastResults.nodes[n.id];
      const rc = el('div', { class: 'card result' });
      rc.appendChild(el('h3', {}, ['Result']));
      rc.appendChild(kv('Pressure', UIUnits.fmt('pressure', r.pressure, 1)));
      rc.appendChild(kv('Head', UIUnits.fmt('head', r.head, 1)));
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

      card.appendChild(dimField('Inside diameter', 'diameter', round(l.diameter, 3), (v) => (l.diameter = v)));
      card.appendChild(dimField('Wall thickness', 'diameter', round(l.wall, 3), (v) => (l.wall = v)));
      card.appendChild(dimField('Length', 'length', l.length, (v) => (l.length = v)));

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
      card.appendChild(el('div', { class: 'hint' }, [`Performance curve — head (${UIUnits.unit('head')}) vs flow (${UIUnits.unit('flow')}). Add points; a quadratic is fit through them.`]));
      host.appendChild(card);
      host.appendChild(buildPumpCurve(l));
    }

    if (lastResults && lastResults.links[l.id]) {
      const r = lastResults.links[l.id];
      const rc = el('div', { class: 'card result' });
      rc.appendChild(el('h3', {}, ['Result']));
      if (r.closed) rc.appendChild(kv('Status', 'CLOSED'));
      else {
        rc.appendChild(kv('Flow', UIUnits.fmt('flow', r.flow, 1)));
        if (l.type !== 'pump')
          rc.appendChild(kv('Velocity', UIUnits.fmt('velocity', Math.abs(r.velocity), 2), Math.abs(r.velocity) > 12 ? 'bad' : Math.abs(r.velocity) > 7 ? 'warn' : 'good'));
        rc.appendChild(kv('ΔP', UIUnits.fmt('pressure', r.dP, 2).replace('g ', ' ')));
        if (l.type !== 'pump') rc.appendChild(kv('ΔP gradient', UIUnits.fmt('gradient', r.dP100, 2)));
        if (l.type === 'pump') rc.appendChild(kv('Pump head', UIUnits.fmt('head', r.pumpHead, 1)));
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
        fitPts.push([UIUnits.disp('flow', q), UIUnits.disp('head', fit.c0 + fit.c1 * q + fit.c2 * q * q)]);
      }
      Charts.lineChart(canvas, {
        title: 'Pump head vs flow',
        xlabel: `Flow (${UIUnits.unit('flow')})`,
        ylabel: `Head (${UIUnits.unit('head')})`,
        series: [
          { name: 'fit', color: '#7c4dff', points: fitPts },
          { name: 'pts', color: '#1746a2', points: l.curve.map((p) => [UIUnits.disp('flow', p.q), UIUnits.disp('head', p.h)]), dots: true, width: 0 },
        ],
      });
    };
    const rebuild = () => {
      list.innerHTML = '';
      l.curve.forEach((p, i) => {
        const q = el('input', { type: 'number', value: round(UIUnits.disp('flow', p.q), 3), step: 'any', class: 'qty wide', onchange: (e) => { p.q = UIUnits.parse('flow', +e.target.value); redraw(); markDirty(); } });
        const h = el('input', { type: 'number', value: round(UIUnits.disp('head', p.h), 3), step: 'any', class: 'qty wide', onchange: (e) => { p.h = UIUnits.parse('head', +e.target.value); redraw(); markDirty(); } });
        const del = el('button', { class: 'mini danger', onclick: () => { l.curve.splice(i, 1); rebuild(); redraw(); markDirty(); } }, ['✕']);
        list.appendChild(el('div', { class: 'fit-row' }, [labeled(`Q ${UIUnits.unit('flow')}`, q), labeled(`H ${UIUnits.unit('head')}`, h), del]));
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
    const U = UIUnits;
    const tbl = el('table', { class: 'data' });
    tbl.appendChild(rowEl('th', ['Segment', `Flow ${U.unit('flow')}`, `Vel ${U.unit('velocity')}`, `ΔP ${U.unit('pressure').replace('g', '')}`, `ΔP ${U.unit('gradient')}`]));
    for (const l of net.links) {
      const r = lastResults.links[l.id];
      if (!r) continue;
      const vcls = r.closed ? '' : Math.abs(r.velocity) > 12 ? 'bad' : Math.abs(r.velocity) > 7 ? 'warn' : 'good';
      const tr = rowEl('td', [
        nameOf(l),
        r.closed ? '—' : U.val('flow', r.flow, 1),
        r.closed ? 'CLOSED' : l.type === 'pump' ? '—' : U.val('velocity', Math.abs(r.velocity), 2),
        r.closed ? '—' : U.val('pressure', r.dP, 2),
        r.closed || l.type === 'pump' ? '—' : U.val('gradient', r.dP100, 2),
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
    nt.appendChild(rowEl('th', ['Node', `Pressure ${U.unit('pressure')}`, `Head ${U.unit('head')}`]));
    for (const n of net.nodes) {
      const r = lastResults.nodes[n.id];
      if (!r) continue;
      const tr = rowEl('td', [nodeLabel(n), U.val('pressure', r.pressure, 1), U.val('head', r.head, 1)]);
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

  // ---------- describe (LLM assistant) ----------
  function bindDescribeModal() {
    const A = HE.Assistant;
    $('describe-close').onclick = () => ($('describe-modal').style.display = 'none');
    $('describe-modal').addEventListener('click', (e) => {
      if (e.target.id === 'describe-modal') $('describe-modal').style.display = 'none';
    });
    $('describe-build').onclick = buildFromDescription;
    // Persist key/model as the user edits them.
    $('describe-key').onchange = (e) => A.setKey(e.target.value.trim());
    $('describe-model').onchange = (e) => A.setModel(e.target.value);
    // Example chips fill the textarea.
    document.querySelectorAll('#describe-modal .chip').forEach((chip) => {
      chip.onclick = () => {
        $('describe-input').value = chip.dataset.fill;
        $('describe-input').focus();
      };
    });
    // Ctrl/Cmd+Enter to build.
    $('describe-input').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') buildFromDescription();
    });
  }

  function openDescribe() {
    const A = HE.Assistant;
    $('describe-key').value = A.getKey();
    $('describe-model').value = A.getModel();
    setDescribeStatus('');
    $('describe-modal').style.display = 'flex';
    $('describe-input').focus();
  }

  function setDescribeStatus(msg, kind) {
    const el = $('describe-status');
    el.textContent = msg || '';
    el.className = 'describe-status ' + (kind === 'bad' ? 'bad' : kind === 'ok' ? 'ok' : 'muted');
  }

  async function buildFromDescription() {
    const A = HE.Assistant;
    const desc = $('describe-input').value;
    const key = $('describe-key').value.trim();
    const model = $('describe-model').value;
    if (!key) return setDescribeStatus('Enter your Anthropic API key first.', 'bad');
    if (!desc.trim()) return setDescribeStatus('Describe the system first.', 'bad');
    A.setKey(key);
    A.setModel(model);

    const btn = $('describe-build');
    btn.disabled = true;
    setDescribeStatus('Building… this can take a few seconds.');
    try {
      const built = await A.generate(desc, { key, model });
      if (!built.nodes || !built.nodes.length) throw new Error('The model returned an empty network.');
      net = built;
      editor.setNetwork(net);
      lastResults = null;
      renderFluid();
      onSelect(null);
      renderResults();
      setTimeout(() => editor.fit(), 0);
      $('describe-modal').style.display = 'none';
      setStatus(`Built “${net.meta.name || 'system'}” from your description (${net.nodes.length} nodes, ${net.links.length} links). Review and press “Run”.`);
    } catch (err) {
      setDescribeStatus(err.message || String(err), 'bad');
    } finally {
      btn.disabled = false;
    }
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

    // comparisons stay in internal psi; display converts to the active system
    const peak = res.maxPressure;
    const rise = peak - res.steadyPressValve;
    const min = res.minPressure;
    const U = UIUnits;
    const pUnit = U.unit('pressure'); // gauge (psig / barg)
    const dUnit = pUnit.replace('g', ''); // delta (psi / bar)
    const P = (psi) => `${U.disp('pressure', psi).toFixed(U.isSI() ? 1 : 0)} ${pUnit}`;
    const dP = (psi) => `${U.disp('pressure', psi).toFixed(U.isSI() ? 2 : 0)} ${dUnit}`;
    const out = $('surge-summary');
    out.innerHTML = '';
    const add = (k, v, cls) => out.appendChild(kv(k, v, cls));
    add('Wave speed a', U.fmt('velocity', res.a, 0));
    add('Pipe period 2L/a', `${res.pipePeriod.toFixed(2)} s`);
    add('Closure vs period', res.pipePeriod > 0 ? `${(opts.closeTime / res.pipePeriod).toFixed(1)} × (rapid if <1)` : '—');
    add('Steady pressure', P(res.steadyPressValve));
    add('Peak surge pressure', P(peak), peak > mawp ? 'bad' : 'good');
    add('Surge rise', '+' + dP(rise));
    add('Min pressure', P(min), min < 0 ? 'warn' : 'good');
    add('Joukowsky (instant) bound', '+' + dP(res.joukowskyDP));
    if (res.columnSeparation) add('⚠ Column separation', 'pressure hit vapor — risk of cavitation', 'bad');
    const margin = mawp - peak;
    const reliefLo = res.steadyPressValve * 1.1;
    const verdict =
      peak > mawp
        ? `Peak surge ${P(peak)} EXCEEDS MAWP ${P(mawp)} by ${dP(peak - mawp)} — slow the closure, add a relief valve, or use a higher pressure class.`
        : `Peak surge ${P(peak)} is within MAWP ${P(mawp)} (margin ${dP(margin)}). A relief valve set ≈ ${P(reliefLo)}–${P(Math.min(mawp, peak))} (≈10% over operating, ≤ MAWP) would relieve this transient.`;
    out.appendChild(el('div', { class: 'verdict ' + (peak > mawp ? 'bad' : 'good') }, [verdict]));
  }

  function drawSurge(res, mawp) {
    const canvas = $('surge-chart');
    const U = UIUnits;
    const pts = res.time.map((t, i) => [t, U.disp('pressure', res.pressValve[i])]);
    Charts.lineChart(canvas, {
      title: 'Pressure at valve vs time',
      xlabel: 'Time (s)',
      ylabel: `Pressure (${U.unit('pressure')})`,
      legend: false,
      series: [{ name: 'valve', color: '#d4506a', points: pts, width: 1.6 }],
      markers: [
        { y: U.disp('pressure', mawp), color: '#d12', label: `MAWP ${U.fmt('pressure', mawp, 0)}` },
        { y: U.disp('pressure', res.steadyPressValve), color: '#2b88d8', label: 'steady' },
      ],
    });
  }

  // ---------- CSV export ----------
  function exportCsv() {
    if (!lastResults) {
      setStatus('Run the model first, then export CSV.', 'bad');
      return;
    }
    const U = UIUnits;
    const esc = (s) => {
      const t = String(s);
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const lines = [];
    lines.push(`# HydroStick results — ${net.meta.name || 'system'}`);
    lines.push(`# units: ${U.system}`);
    lines.push('');
    lines.push('SEGMENTS');
    lines.push(['Name', 'Type', 'From', 'To', `Flow ${U.unit('flow')}`, `Velocity ${U.unit('velocity')}`, `dP ${U.unit('pressure').replace('g', '')}`, `dP ${U.unit('gradient')}`, 'Reynolds', 'Friction f', 'Status'].map(esc).join(','));
    for (const l of net.links) {
      const r = lastResults.links[l.id];
      if (!r) continue;
      const closed = r.closed;
      lines.push(
        [
          nameOf(l),
          l.type,
          nodeLabel(Model.nodeById(net, l.from)),
          nodeLabel(Model.nodeById(net, l.to)),
          closed ? '' : U.val('flow', r.flow, 2),
          closed || l.type === 'pump' ? '' : U.val('velocity', Math.abs(r.velocity), 3),
          closed ? '' : U.val('pressure', r.dP, 3),
          closed || l.type === 'pump' ? '' : U.val('gradient', r.dP100, 3),
          closed ? '' : r.Re.toFixed(0),
          closed ? '' : r.f.toFixed(4),
          closed ? 'CLOSED' : 'open',
        ].map(esc).join(',')
      );
    }
    lines.push('');
    lines.push('NODES');
    lines.push(['Name', 'Type', `Pressure ${U.unit('pressure')}`, `Head ${U.unit('head')}`].map(esc).join(','));
    for (const n of net.nodes) {
      const r = lastResults.nodes[n.id];
      if (!r) continue;
      lines.push([nodeLabel(n), n.type, U.val('pressure', r.pressure, 2), U.val('head', r.head, 2)].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (net.meta.name || 'system').replace(/\s+/g, '_') + '_results.csv';
    a.click();
    setStatus('Exported ' + a.download);
  }

  // ---------- one-page report ----------
  function openReport() {
    if (net.nodes.length === 0) {
      setStatus('Add a model first.', 'bad');
      return;
    }
    if (!lastResults) run();
    if (!lastResults) return;

    // Capture a clean, fitted schematic image (no selection highlight).
    const prevView = Object.assign({}, editor.view);
    const prevSel = editor.selection;
    editor.selection = null;
    editor.fit();
    editor.draw();
    let img = '';
    try {
      img = editor.canvas.toDataURL('image/png');
    } catch (e) {
      img = '';
    }
    editor.selection = prevSel;
    editor.view = prevView;
    editor.draw();

    const html = buildReportHtml(img);
    const w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      setStatus('Report opened — use the Print button to save as PDF.');
    } else {
      // popup blocked → download an .html file instead
      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (net.meta.name || 'system').replace(/\s+/g, '_') + '_report.html';
      a.click();
      setStatus('Popup blocked — downloaded the report as HTML instead.');
    }
  }

  function buildReportHtml(img) {
    const U = UIUnits;
    const esc = (s) =>
      String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const pUnit = U.unit('pressure');
    const dUnit = pUnit.replace('g', '');

    // ----- summary metrics -----
    const prodWells = net.nodes.filter((n) => n.type === 'supply' && n.bcMode === 'flow');
    const injWells = net.nodes.filter((n) => n.type === 'injection');
    let maxVel = 0,
      maxVelName = '',
      pMin = Infinity,
      pMax = -Infinity,
      injTotal = 0,
      pumps = 0;
    for (const l of net.links) {
      const r = lastResults.links[l.id];
      if (!r || r.closed || l.type === 'pump') continue;
      if (Math.abs(r.velocity) > maxVel) {
        maxVel = Math.abs(r.velocity);
        maxVelName = nameOf(l);
      }
    }
    for (const l of net.links) if (l.type === 'pump') pumps++;
    for (const n of net.nodes) {
      const r = lastResults.nodes[n.id];
      if (!r) continue;
      pMin = Math.min(pMin, r.pressure);
      pMax = Math.max(pMax, r.pressure);
    }
    for (const n of injWells) {
      const link = net.links.find((l) => l.to === n.id || l.from === n.id);
      if (link && lastResults.links[link.id]) injTotal += Math.abs(lastResults.links[link.id].flow);
    }

    const warns = [];
    for (const l of net.links) {
      const r = lastResults.links[l.id];
      if (r && !r.closed && Math.abs(r.velocity) > 12)
        warns.push(`${nameOf(l)} — ${U.fmt('velocity', Math.abs(r.velocity), 1)} exceeds the 12 ft/s criterion`);
    }

    // ----- tables -----
    let segRows = '';
    for (const l of net.links) {
      const r = lastResults.links[l.id];
      if (!r) continue;
      const closed = r.closed;
      const vcls = closed || l.type === 'pump' ? '' : Math.abs(r.velocity) > 12 ? 'bad' : Math.abs(r.velocity) > 7 ? 'warn' : 'ok';
      segRows += `<tr>
        <td class="l">${esc(nameOf(l))}</td><td>${esc(l.type)}</td>
        <td>${closed ? '—' : U.val('flow', r.flow, 1)}</td>
        <td class="${vcls}">${closed ? 'CLOSED' : l.type === 'pump' ? '—' : U.val('velocity', Math.abs(r.velocity), 2)}</td>
        <td>${closed ? '—' : U.val('pressure', r.dP, 2)}</td>
        <td>${closed || l.type === 'pump' ? '—' : U.val('gradient', r.dP100, 2)}</td>
      </tr>`;
    }
    let nodeRows = '';
    for (const n of net.nodes) {
      const r = lastResults.nodes[n.id];
      if (!r) continue;
      nodeRows += `<tr><td class="l">${esc(nodeLabel(n))}</td><td>${esc(n.type)}</td>
        <td>${U.val('pressure', r.pressure, 1)}</td><td>${U.val('head', r.head, 1)}</td></tr>`;
    }

    const date = new Date().toLocaleString();
    const fl = net.fluid;

    return `<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(net.meta.name || 'Hydraulic summary')} — HydroStick</title>
<style>
  @page { size: letter; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, Segoe UI, Roboto, sans-serif; color:#1f2733; margin:0; font-size:11px; }
  .sheet { max-width: 1000px; margin: 0 auto; padding: 18px; }
  header { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #2b6cb0; padding-bottom:8px; }
  header h1 { margin:0; font-size:18px; }
  header .sub { color:#5b6573; }
  .brand { font-weight:700; color:#7c4dff; font-size:14px; }
  .meta { display:flex; gap:22px; flex-wrap:wrap; margin:10px 0; color:#33414f; }
  .meta b { color:#1f2733; }
  .cards { display:flex; gap:10px; flex-wrap:wrap; margin:10px 0; }
  .stat { border:1px solid #e2e7ef; border-radius:8px; padding:8px 12px; min-width:120px; }
  .stat .n { font-size:16px; font-weight:700; }
  .stat .k { color:#5b6573; font-size:10px; text-transform:uppercase; letter-spacing:.4px; }
  .schematic { text-align:center; margin:12px 0; }
  .schematic img { max-width:100%; border:1px solid #e2e7ef; border-radius:8px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:#5b6573; border-bottom:1px solid #e2e7ef; padding-bottom:4px; margin:16px 0 6px; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:right; padding:3px 6px; border-bottom:1px solid #eef1f6; }
  th.l, td.l, th:first-child, td:first-child { text-align:left; }
  th { color:#5b6573; border-bottom:1px solid #c4ccd8; }
  td.ok{color:#1f6f43;} td.warn{color:#b9791f;} td.bad{color:#c5341f;font-weight:700;}
  .warnbox { background:#fff8f0; border:1px solid #f0d8b8; border-radius:8px; padding:8px 12px; margin:10px 0; color:#b3301c; }
  .cols { display:flex; gap:24px; align-items:flex-start; }
  .cols > div { flex:1; }
  footer { margin-top:18px; padding-top:8px; border-top:1px solid #e2e7ef; color:#7a8696; font-size:10px; }
  .toolbar { position:sticky; top:0; background:#fff; padding:8px 0; text-align:right; }
  .toolbar button { font:inherit; padding:6px 14px; border:1px solid #2b6cb0; background:#2b6cb0; color:#fff; border-radius:6px; cursor:pointer; }
  @media print { .toolbar { display:none; } body { font-size:10px; } }
</style></head><body><div class="sheet">
  <div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>
  <header>
    <div><h1>${esc(net.meta.name || 'Hydraulic system')}</h1>
      <div class="sub">Hydraulic Summary — steady state &amp; surge screening</div></div>
    <div style="text-align:right"><div class="brand">⬡ HydroStick</div><div class="sub">${esc(date)}</div></div>
  </header>

  <div class="meta">
    <span>Fluid: <b>${esc(fl.name || 'fluid')}</b></span>
    <span>Density: <b>${U.fmt('density', fl.density, 1)}</b></span>
    <span>Viscosity: <b>${esc(fl.viscosity)} cP</b></span>
    <span>Display units: <b>${U.system}</b></span>
  </div>

  <div class="cards">
    <div class="stat"><div class="n">${prodWells.length}</div><div class="k">Source wells</div></div>
    <div class="stat"><div class="n">${injWells.length}</div><div class="k">Injection wells</div></div>
    <div class="stat"><div class="n">${pumps}</div><div class="k">Pumps</div></div>
    <div class="stat"><div class="n">${U.fmt('flow', injTotal, 0)}</div><div class="k">Total injection</div></div>
    <div class="stat"><div class="n ${maxVel > 12 ? 'bad' : ''}">${U.fmt('velocity', maxVel, 1)}</div><div class="k">Max velocity</div></div>
    <div class="stat"><div class="n">${isFinite(pMin) ? U.val('pressure', pMin, 0) : '—'}–${isFinite(pMax) ? U.val('pressure', pMax, 0) : '—'}</div><div class="k">Pressure range ${pUnit}</div></div>
  </div>

  ${warns.length ? `<div class="warnbox"><b>⚠ Velocity criterion (12 ft/s):</b><br/>${warns.map(esc).join('<br/>')}</div>` : ''}

  <div class="schematic">${img ? `<img src="${img}" alt="schematic"/>` : '<i>(schematic unavailable)</i>'}</div>

  <h2>Pipe / device results</h2>
  <table><thead><tr>
    <th class="l">Segment</th><th class="l">Type</th>
    <th>Flow ${U.unit('flow')}</th><th>Vel ${U.unit('velocity')}</th>
    <th>ΔP ${dUnit}</th><th>ΔP ${U.unit('gradient')}</th>
  </tr></thead><tbody>${segRows}</tbody></table>

  <h2>Node pressures</h2>
  <table><thead><tr><th class="l">Node</th><th class="l">Type</th>
    <th>Pressure ${pUnit}</th><th>Head ${U.unit('head')}</th></tr></thead>
    <tbody>${nodeRows}</tbody></table>

  <footer>
    Generated by HydroStick — Darcy-Weisbach steady-state &amp; Method-of-Characteristics surge.
    Velocity coloring uses the 12 ft/s main-line criterion. This is an engineering screening aid,
    not a substitute for a stamped analysis.
  </footer>
</div></body></html>`;
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
  // Dimensional field: stores in internal US units, displays/parses in active system.
  function dimField(label, quantity, rawValue, setRaw) {
    const disp = round(UIUnits.disp(quantity, rawValue), 4);
    const inp = el('input', {
      type: 'number', value: disp, step: 'any',
      onchange: (e) => { setRaw(UIUnits.parse(quantity, parseFloat(e.target.value))); markDirty(); editor.draw(); },
    });
    return fieldRow(`${label} (${UIUnits.unit(quantity)})`, inp);
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
