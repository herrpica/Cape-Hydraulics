/*
 * steady.js — steady-state incompressible network solver.
 *
 * Method: global nodal head formulation solved by successive linearization
 * (Newton on continuity residuals). Each link supplies a linear conductance
 * about its lagged flow:
 *     resistive link:  dH = R*Q*|Q|   ->   Q ≈ dH / (R*|Qlag|)
 *     pump link:       dH = -Hp(Q)    ->   linearized about Qlag
 * Continuity at every free node is driven to zero. Fixed-head boundary nodes
 * provide the reference. Robust for tree and looped networks (the report's
 * headers + branches are looped).
 *
 * Returns { ok, iterations, nodes:{id->{head,pressure}}, links:{id->{...}}, messages }
 */
(function (global) {
  'use strict';
  const U = (global.HE && global.HE.Units) || require('./units.js');
  const Fluids = (global.HE && global.HE.Fluids) || require('./fluids.js');
  const Fittings = (global.HE && global.HE.Fittings) || require('./fittings.js');
  const Model = (global.HE && global.HE.Model) || require('./model.js');

  const QFLOOR = 1e-4; // cfs floor for linearization (≈0.045 gpm)

  function pipeResistance(link, fluid, qLagCfs) {
    const dFt = U.inToFt(link.diameter);
    const A = (Math.PI / 4) * dFt * dFt;
    const v = qLagCfs / A;
    const Re = Fluids.reynolds(fluid.density, v, dFt, fluid.viscosity);
    const f = Fluids.frictionFactor(Math.max(Re, 1), link.roughness, dFt);
    const K = Fittings.sumK(link.fittings);
    // dH = (f L/D + K) * V^2 / 2g ; V=Q/A  => dH = Rcoef * Q^2
    const Rcoef = (f * (link.length / dFt) + K) / (2 * U.G * A * A);
    return { R: Math.max(Rcoef, 1e-9), f, Re, v, A, dFt };
  }

  /** Effective pump mode: explicit, else inferred from whether a curve exists. */
  function pumpMode(l) {
    if (l.pumpMode === 'curve' || l.pumpMode === 'dp') return l.pumpMode;
    return l.curve && l.curve.length ? 'curve' : 'dp';
  }

  /**
   * Pump head model as quadratic coefficients Hp(Qgpm) = c0 + c1 Q + c2 Q^2 (ft).
   * Fixed-dP pumps are a flat curve: c0 = head-equivalent of dp, c1=c2=0.
   */
  function pumpCoeffs(l, fluid) {
    if (pumpMode(l) === 'dp') {
      return { c0: U.psiToFt(Math.max(l.dp || 0, 0), fluid.density), c1: 0, c2: 0 };
    }
    return Model.fitPumpCurve(l.curve);
  }

  function valveResistance(link, fluid) {
    // dP[psi] = SG*(Qgpm/Cv)^2  ->  dH = psiToFt(dP)
    const SG = Fluids.specificGravity(fluid.density);
    const cv = Math.max(link.cv * (link.openFraction ?? 1), 1e-6);
    // dH = psiToFt(SG*(cfsToGpm(Q)/cv)^2) = psiToFt(SG)*(cfsToGpm^2/cv^2)*Q^2
    const g = U.cfsToGpm(1);
    const Rcoef = U.psiToFt(SG * (g * g) / (cv * cv), fluid.density);
    return { R: Math.max(Rcoef, 1e-9) };
  }

  function solve(net, opts = {}) {
    const fluid = net.fluid;
    const messages = [];
    const nodes = net.nodes;
    const links = net.links.filter((l) => !(l.type === 'valve' && l.closed));

    const idx = new Map(); // node id -> matrix index (free nodes only)
    const fixed = new Map(); // node id -> fixed head (ft)
    let free = [];

    for (const n of nodes) {
      const elev = n.elevation || 0;
      if (n.type === 'supply' && n.bcMode === 'head') {
        fixed.set(n.id, elev + U.psiToFt(n.pressure, fluid.density));
      } else {
        idx.set(n.id, free.length);
        free.push(n);
      }
    }

    if (fixed.size === 0) {
      return { ok: false, messages: ['No fixed-pressure boundary. Add at least one supply set to “fixed pressure”.'] };
    }
    if (free.length === 0) {
      // Everything is fixed-head; still report link flows.
      messages.push('All nodes are fixed-pressure boundaries.');
    }

    // Initial guess: average of fixed heads
    let Hfixed0 = [...fixed.values()].reduce((a, b) => a + b, 0) / fixed.size;
    let H = new Float64Array(free.length).fill(Hfixed0);
    const headOf = (n) => (fixed.has(n.id) ? fixed.get(n.id) : H[idx.get(n.id)]);

    // Lagged flows per link (cfs)
    const qLag = new Map(links.map((l) => [l.id, 0.05]));
    const linkState = new Map();

    const maxIter = opts.maxIter || 300;
    let it = 0;
    let converged = false;

    for (; it < maxIter; it++) {
      const N = free.length;
      const J = Array.from({ length: N }, () => new Float64Array(N));
      const F = new Float64Array(N);

      // External boundary flows (node-local), into the network = +
      for (let k = 0; k < N; k++) {
        const n = free[k];
        const elev = n.elevation || 0;
        const Pnode = U.ftToPsi(H[k] - elev, fluid.density);
        const dPdH = fluid.density / 144; // dP/dH
        if (n.type === 'supply') {
          if (n.bcMode === 'flow') {
            F[k] += U.gpmToCfs(n.flow || 0);
          } else if (n.bcMode === 'pi') {
            const qin = (n.pi || 0) * ((n.resPressure || 0) - Pnode); // gpm
            F[k] += U.gpmToCfs(qin);
            J[k][k] += -U.gpmToCfs(n.pi || 0) * dPdH;
          }
        } else if (n.type === 'injection') {
          const qout = (n.ii || 0) * (Pnode - (n.resPressure || 0)); // gpm, leaving
          F[k] += -U.gpmToCfs(qout);
          J[k][k] += -U.gpmToCfs(n.ii || 0) * dPdH;
        } else if (n.type === 'junction') {
          F[k] += U.gpmToCfs(n.demand || 0);
        }
      }

      // Links
      for (const l of links) {
        const a = Model.nodeById(net, l.from);
        const b = Model.nodeById(net, l.to);
        if (!a || !b) continue;
        const Ha = headOf(a);
        const Hb = headOf(b);
        const dH = Ha - Hb;
        const ql = qLag.get(l.id);

        let Q = 0; // cfs from->to
        let gprime = 0; // dQ/d(dH)
        let st = {};

        if (l.type === 'pump') {
          const fit = pumpCoeffs(l, fluid);
          // Hp(Qg) = c0 + c1 Qg + c2 Qg^2 (Qg in gpm). dH = -Hp.
          const Qg = U.cfsToGpm(ql);
          const Hp = fit.c0 + fit.c1 * Qg + fit.c2 * Qg * Qg;
          let slope = fit.c1 + 2 * fit.c2 * Qg; // dHp/dQg (ft per gpm), usually <0
          if (Math.abs(slope) < 1e-5) slope = -1e-5;
          // dH = -Hp(Qlag) - slope*(Qg - Qg_lag)  ->  Qg = Qg_lag + (-Hp - dH)/slope
          const QgNew = Qg + (-Hp - dH) / slope;
          Q = U.gpmToCfs(QgNew);
          // dQ/d(dH): dQg/d(dH) = -1/slope ; convert gpm->cfs both sides cancels rate
          gprime = U.gpmToCfs(-1 / slope) / 1; // (cfs per ft); -1/slope in gpm/ft -> cfs/ft
          gprime = -U.gpmToCfs(1) / slope;
          st = { kind: 'pump', head: Hp };
        } else {
          let R;
          if (l.type === 'valve') {
            R = valveResistance(l, fluid).R;
          } else {
            const pr = pipeResistance(l, fluid, Math.max(Math.abs(ql), QFLOOR));
            R = pr.R;
            st = pr;
          }
          const C = 1 / (R * Math.max(Math.abs(ql), QFLOOR)); // conductance
          Q = C * dH;
          gprime = C;
          if (l.type === 'check' && Q < 0) {
            Q = 0;
            gprime = 0;
          }
          st.R = R;
        }

        linkState.set(l.id, st);

        // Assemble into residual/Jacobian (continuity)
        const ai = idx.has(a.id) ? idx.get(a.id) : -1;
        const bi = idx.has(b.id) ? idx.get(b.id) : -1;
        if (ai >= 0) {
          F[ai] += -Q; // leaves 'from'
          J[ai][ai] += -gprime;
          if (bi >= 0) J[ai][bi] += gprime;
        }
        if (bi >= 0) {
          F[bi] += +Q; // enters 'to'
          J[bi][bi] += -gprime;
          if (ai >= 0) J[bi][ai] += gprime;
        }
      }

      if (N === 0) {
        converged = true;
        break;
      }

      // Solve J * dx = -F
      const dx = gaussSolve(J, F, -1);
      if (!dx) {
        messages.push('Singular system — check the model is fully connected to a boundary.');
        break;
      }

      // Damped update + relax lagged flows
      let maxStep = 0;
      const relax = it < 3 ? 0.6 : 1.0;
      for (let k = 0; k < N; k++) {
        const step = relax * dx[k];
        H[k] += step;
        maxStep = Math.max(maxStep, Math.abs(step));
      }
      // Recompute flows for lagging using new heads
      let maxRes = 0;
      for (let k = 0; k < N; k++) maxRes = Math.max(maxRes, Math.abs(F[k]));
      for (const l of links) {
        const a = Model.nodeById(net, l.from);
        const b = Model.nodeById(net, l.to);
        const dH = headOf(a) - headOf(b);
        const st = linkState.get(l.id) || {};
        let q;
        if (st.kind === 'pump') {
          q = qLag.get(l.id); // keep; pumps relax slowly
          const fit = pumpCoeffs(l, fluid);
          const Qg = U.cfsToGpm(q);
          let slope = fit.c1 + 2 * fit.c2 * Qg;
          if (Math.abs(slope) < 1e-5) slope = -1e-5;
          const Hp = fit.c0 + fit.c1 * Qg + fit.c2 * Qg * Qg;
          const QgNew = Qg + (-Hp - dH) / slope;
          q = U.gpmToCfs(0.5 * (U.cfsToGpm(q) + QgNew));
        } else {
          const C = 1 / (st.R * Math.max(Math.abs(qLag.get(l.id)), QFLOOR));
          q = C * dH;
          if (l.type === 'check' && q < 0) q = 0;
        }
        // under-relax the flow lag for stability
        qLag.set(l.id, 0.5 * qLag.get(l.id) + 0.5 * q);
      }

      if (maxStep < 1e-5 && maxRes < 1e-6) {
        converged = true;
        break;
      }
    }

    // Build results
    const nodeOut = {};
    for (const n of nodes) {
      const elev = n.elevation || 0;
      const head = fixed.has(n.id) ? fixed.get(n.id) : H[idx.get(n.id)];
      nodeOut[n.id] = {
        head,
        pressure: U.ftToPsi(head - elev, fluid.density),
      };
    }

    const linkOut = {};
    for (const l of net.links) {
      if (l.type === 'valve' && l.closed) {
        linkOut[l.id] = { flow: 0, velocity: 0, dP: 0, dP100: 0, headloss: 0, Re: 0, f: 0, closed: true };
        continue;
      }
      const a = nodeOut[l.from];
      const b = nodeOut[l.to];
      if (!a || !b) continue;
      const dH = a.head - b.head;
      const qcfs = qLag.get(l.id) || 0;
      const dFt = U.inToFt(l.diameter);
      const A = (Math.PI / 4) * dFt * dFt;
      const v = l.type === 'pump' ? qcfs / A : qcfs / A;
      const Re = Fluids.reynolds(fluid.density, v, dFt, fluid.viscosity);
      const f = Fluids.frictionFactor(Math.max(Re, 1), l.roughness, dFt);
      let headloss = dH;
      let pumpHead = 0;
      let hp = 0; // hydraulic (water) horsepower
      let bhp = 0; // brake horsepower (hydraulic / efficiency)
      let pumpDp = 0; // pressure rise across the pump, psi
      if (l.type === 'pump') {
        const fit = pumpCoeffs(l, fluid);
        const Qg = U.cfsToGpm(qcfs);
        pumpHead = fit.c0 + fit.c1 * Qg + fit.c2 * Qg * Qg;
        pumpDp = U.ftToPsi(pumpHead, fluid.density);
        // WHP = Q[gpm] * dP[psi] / 1714 ; BHP = WHP / efficiency
        hp = (Math.abs(U.cfsToGpm(qcfs)) * pumpDp) / 1714;
        const eff = Math.min(Math.max(l.eff || 0, 0.01), 1);
        bhp = hp / eff;
      }
      linkOut[l.id] = {
        flow: U.cfsToGpm(qcfs),
        velocity: v,
        Re,
        f,
        headloss,
        dP: U.ftToPsi(headloss, fluid.density),
        dP100: l.length > 0 ? (U.ftToPsi(headloss, fluid.density) / l.length) * 100 : 0,
        pumpHead,
        pumpDp,
        hp,
        bhp,
      };
    }

    return {
      ok: converged,
      iterations: it + 1,
      nodes: nodeOut,
      links: linkOut,
      messages: converged ? messages : ['Did not fully converge after ' + (it + 1) + ' iterations.', ...messages],
    };
  }

  /** Dense Gaussian elimination with partial pivoting. Solves A x = scale*b. */
  function gaussSolve(A, b, scale = 1) {
    const n = b.length;
    const M = A.map((r, i) => Float64Array.from([...r, scale * b[i]]));
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      if (Math.abs(M[p][i]) < 1e-14) {
        M[i][i] += 1e-9; // regularize a weakly-coupled node
        p = i;
      }
      [M[i], M[p]] = [M[p], M[i]];
      const piv = M[i][i];
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const fct = M[r][i] / piv;
        if (fct === 0) continue;
        for (let c = i; c <= n; c++) M[r][c] -= fct * M[i][c];
      }
    }
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
    return x;
  }

  const Steady = { solve };
  global.HE = global.HE || {};
  global.HE.Steady = Steady;
  if (typeof module !== 'undefined' && module.exports) module.exports = Steady;
})(typeof window !== 'undefined' ? window : globalThis);
