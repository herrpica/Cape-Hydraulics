/*
 * model.js — network data model + helpers.
 *
 * A Network is a plain serializable object:
 *   { meta, fluid, nodes:[Node], links:[Link] }
 *
 * Node.type:  'junction' | 'supply' | 'injection'
 *   supply  — a source (production well, reservoir, or boundary). bcMode:
 *               'head'  fixed pressure (psig)
 *               'flow'  fixed inflow (gpm, + into the network)
 *               'pi'    productivity-index driven: Qin = pi*(resPressure - Pnode)
 *   injection — a sink (injection well): Qout = ii*(Pnode - resPressure)
 *   junction — interior node, optional fixed demand (gpm, + supply / - demand)
 *
 * Link.type:  'pipe' | 'valve' | 'check' | 'pump'
 */
(function (global) {
  'use strict';

  let _seq = 1;
  const uid = (p) => `${p}${(_seq++).toString(36)}_${Date.now().toString(36).slice(-3)}`;

  function newNetwork() {
    return {
      meta: { name: 'Untitled system', created: new Date().toISOString() },
      fluid: { name: 'Brine — production (400 F)', density: 53.6, viscosity: 0.25, bulkModulus: 250000 },
      nodes: [],
      links: [],
    };
  }

  function newNode(x, y, type = 'junction') {
    const base = {
      id: uid('n'),
      name: '',
      type,
      x,
      y,
      elevation: 0, // ft
      demand: 0, // gpm (junction)
      pressure: 400, // psig (supply head bc)
      bcMode: 'head', // supply: head | flow | pi
      flow: 0, // gpm (supply flow bc)
      pi: 0, // gpm/psi (supply pi)
      ii: 1.0, // gpm/psi (injection)
      resPressure: type === 'injection' ? 2000 : 400, // psig reservoir
    };
    return base;
  }

  function newLink(from, to, type = 'pipe') {
    return {
      id: uid('l'),
      name: '',
      type,
      from,
      to,
      // pipe geometry
      length: 100, // ft
      diameter: 10.02, // inside dia, in (10" sch40 default)
      nominal: '10',
      sched: '40',
      wall: 0.365, // in
      material: 'carbon_steel',
      roughness: 0.00015, // ft
      fittings: [], // [{ type, qty }]
      // valve
      cv: 2000, // valve flow coefficient (gpm @ 1 psi, SG=1)
      openFraction: 1, // 0..1
      closed: false,
      // pump
      pumpMode: 'dp', // 'dp' (fixed pressure rise) | 'curve' (performance curve)
      dp: 200, // psi — fixed head-rise for pumpMode 'dp'
      eff: 0.7, // pump efficiency (0..1), for brake-horsepower estimate
      curve: [
        { q: 0, h: 600 },
        { q: 2000, h: 520 },
        { q: 4000, h: 300 },
      ],
    };
  }

  function nodeById(net, id) {
    return net.nodes.find((n) => n.id === id);
  }
  function linksAt(net, nodeId) {
    return net.links.filter((l) => l.from === nodeId || l.to === nodeId);
  }

  /** Best-effort migration / defaulting so older saved files still load. */
  function normalize(net) {
    const fresh = newNetwork();
    net.meta = Object.assign(fresh.meta, net.meta || {});
    net.fluid = Object.assign(fresh.fluid, net.fluid || {});
    // Water-by-temperature: keep properties consistent with the stored temp.
    const Fluids = global.HE && global.HE.Fluids;
    if (net.fluid.kind === 'water' && Fluids) {
      Object.assign(net.fluid, Fluids.water(net.fluid.tempF ?? 60));
      net.fluid.kind = 'water';
    }
    net.nodes = (net.nodes || []).map((n) => Object.assign(newNode(n.x || 0, n.y || 0, n.type), n));
    net.links = (net.links || []).map((l) => {
      const merged = Object.assign(newLink(l.from, l.to, l.type), l);
      // Pumps loaded with a curve but no explicit mode keep curve behavior;
      // otherwise default to the simpler fixed-dP mode.
      if (merged.type === 'pump' && l.pumpMode == null) {
        merged.pumpMode = l.curve && l.curve.length ? 'curve' : 'dp';
      }
      return merged;
    });
    return net;
  }

  /** Quadratic least-squares fit of a pump curve [{q,h}] -> {c0,c1,c2}. H(q)=c0+c1 q+c2 q^2 */
  function fitPumpCurve(points) {
    const pts = (points || []).filter((p) => isFinite(p.q) && isFinite(p.h));
    if (pts.length === 0) return { c0: 0, c1: 0, c2: 0 };
    if (pts.length === 1) return { c0: pts[0].h, c1: 0, c2: 0 };
    if (pts.length === 2) {
      const [a, b] = pts;
      const c1 = (b.h - a.h) / (b.q - a.q || 1);
      return { c0: a.h - c1 * a.q, c1, c2: 0 };
    }
    // Normal equations for [1, q, q^2]
    let S = Array.from({ length: 3 }, () => [0, 0, 0]);
    let T = [0, 0, 0];
    for (const p of pts) {
      const b = [1, p.q, p.q * p.q];
      for (let i = 0; i < 3; i++) {
        T[i] += b[i] * p.h;
        for (let j = 0; j < 3; j++) S[i][j] += b[i] * b[j];
      }
    }
    const c = solve3(S, T);
    return { c0: c[0], c1: c[1], c2: c[2] };
  }

  function solve3(A, b) {
    // tiny 3x3 solve with pivoting
    const M = A.map((r, i) => [...r, b[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      [M[i], M[p]] = [M[p], M[i]];
      if (Math.abs(M[i][i]) < 1e-12) M[i][i] = 1e-12;
      for (let r = 0; r < 3; r++) {
        if (r === i) continue;
        const f = M[r][i] / M[i][i];
        for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  const Model = {
    uid,
    newNetwork,
    newNode,
    newLink,
    nodeById,
    linksAt,
    normalize,
    fitPumpCurve,
  };

  global.HE = global.HE || {};
  global.HE.Model = Model;
  if (typeof module !== 'undefined' && module.exports) module.exports = Model;
})(typeof window !== 'undefined' ? window : globalThis);
