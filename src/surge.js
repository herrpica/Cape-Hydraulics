/*
 * surge.js — transient waterhammer by the Method of Characteristics (MOC).
 *
 * Classic reservoir–pipe–valve configuration (Wylie & Streeter): an upstream
 * constant-head boundary, a friction pipe discretized into N reaches, and a
 * downstream valve whose opening closes over `closeTime`. This is exactly the
 * scenario for "a valve shuts and I want to see the surge to size MAWP / relief."
 *
 * Discretization (Courant number = 1):
 *   dx = L/N,  dt = dx/a,  B = a/(gA),  Rf = f*dx/(2 g D A^2)
 * Interior:
 *   Cp = H[i-1] + B Q[i-1] - Rf Q[i-1]|Q[i-1]|
 *   Cm = H[i+1] - B Q[i+1] + Rf Q[i+1]|Q[i+1]|
 *   Hp = (Cp+Cm)/2 ,  Qp = (Cp-Cm)/2B
 * Valve (downstream): Qp = Cv(t)*sqrt(Hp), solved with the C+ characteristic.
 */
(function (global) {
  'use strict';
  const U = (global.HE && global.HE.Units) || require('./units.js');
  const Fluids = (global.HE && global.HE.Fluids) || require('./fluids.js');

  /** Valve closure law -> open fraction tau in [0,1] at time t. */
  function tau(t, closeTime, profile, exponent) {
    if (t >= closeTime) return 0;
    const x = 1 - t / closeTime; // linear remaining
    switch (profile) {
      case 'cosine':
        return 0.5 * (1 - Math.cos(Math.PI * x)); // slow start & end
      case 'concave': // fast initial close (worst-case-ish), exponent>1
        return Math.pow(x, exponent || 2);
      case 'convex':
        return 1 - Math.pow(1 - x, exponent || 2);
      default:
        return x; // linear
    }
  }

  /**
   * Run a transient simulation.
   * opts: {
   *   length(ft), diameter(in), roughness(ft),
   *   fluid:{density,viscosity,bulkModulus},
   *   E(psi), wall(in), restraint,            // for wave speed (optional if waveSpeed given)
   *   waveSpeed(ft/s) optional,
   *   Hres(ft), Q0(gpm), elevValve(ft),
   *   closeTime(s), profile, exponent,
   *   reaches, simTime(s),
   *   vaporPressure(psia, default ~0.5)        // for column-separation flag
   * }
   */
  function simulate(opts) {
    const fluid = opts.fluid;
    const dFt = U.inToFt(opts.diameter);
    const A = (Math.PI / 4) * dFt * dFt;
    const L = opts.length;
    const N = Math.max(2, Math.round(opts.reaches || 20));

    // Wave speed
    let a = opts.waveSpeed;
    if (!a || a <= 0) {
      a = Fluids.waveSpeed(
        fluid.bulkModulus || 300000,
        fluid.density,
        opts.E || 29.5e6,
        dFt,
        U.inToFt(opts.wall || 0.365),
        opts.restraint || 1
      );
    }

    const dx = L / N;
    const dt = dx / a;
    const B = a / (U.G * A);

    // Initial steady state
    const Q0cfs = U.gpmToCfs(opts.Q0 || 0);
    const V0 = Q0cfs / A;
    const Re = Fluids.reynolds(fluid.density, V0, dFt, fluid.viscosity);
    const f = Fluids.frictionFactor(Math.max(Re, 1), opts.roughness, dFt);
    const Rf = (f * dx) / (2 * U.G * dFt * A * A);

    // Arrays: indices 0..N (sections)
    const H = new Float64Array(N + 1);
    const Q = new Float64Array(N + 1);
    const Hres = opts.Hres;
    // friction slope head loss per reach at steady state
    const dhReach = Rf * Q0cfs * Math.abs(Q0cfs);
    for (let i = 0; i <= N; i++) {
      H[i] = Hres - dhReach * i;
      Q[i] = Q0cfs;
    }
    const H0valve = H[N];
    // Valve coefficient from initial condition: Q0 = Cv0*sqrt(H0valve)
    const Cv0 = H0valve > 1e-6 ? Q0cfs / Math.sqrt(H0valve) : 0;

    const simTime = opts.simTime || Math.max(opts.closeTime * 3, 12 * ((2 * L) / a));
    const steps = Math.min(40000, Math.ceil(simTime / dt));

    const Hp = new Float64Array(N + 1);
    const Qp = new Float64Array(N + 1);

    const time = [];
    const headValve = [];
    const headMid = [];
    const headUp = [];
    const pressValve = [];
    const flowValve = [];
    const mid = Math.round(N / 2);

    const rho = fluid.density;
    const elevValve = opts.elevValve || 0;
    const vaporHeadPsi = (opts.vaporPressure ?? 0.5) - 14.7; // psig (approx)
    const vaporHead = U.psiToFt(vaporHeadPsi, rho) + elevValve;
    let columnSeparation = false;

    let maxH = -Infinity,
      minH = Infinity;

    function record(t) {
      time.push(t);
      headValve.push(H[N]);
      headMid.push(H[mid]);
      headUp.push(H[0]);
      pressValve.push(U.ftToPsi(H[N] - elevValve, rho));
      flowValve.push(U.cfsToGpm(Q[N]));
      if (H[N] > maxH) maxH = H[N];
      if (H[N] < minH) minH = H[N];
    }

    record(0);

    for (let s = 1; s <= steps; s++) {
      const t = s * dt;
      // interior
      for (let i = 1; i < N; i++) {
        const Cp = H[i - 1] + B * Q[i - 1] - Rf * Q[i - 1] * Math.abs(Q[i - 1]);
        const Cm = H[i + 1] - B * Q[i + 1] + Rf * Q[i + 1] * Math.abs(Q[i + 1]);
        Hp[i] = 0.5 * (Cp + Cm);
        Qp[i] = (Cp - Cm) / (2 * B);
      }
      // upstream reservoir (constant head)
      {
        const Cm = H[1] - B * Q[1] + Rf * Q[1] * Math.abs(Q[1]);
        Hp[0] = Hres;
        Qp[0] = (Hp[0] - Cm) / B;
      }
      // downstream valve
      {
        const Cp = H[N - 1] + B * Q[N - 1] - Rf * Q[N - 1] * Math.abs(Q[N - 1]);
        const Cvt = Cv0 * tau(t, opts.closeTime, opts.profile, opts.exponent);
        if (Cvt <= 1e-12) {
          Qp[N] = 0;
          Hp[N] = Cp;
        } else {
          const Cvv = Cvt * Cvt;
          // Qp^2 + Cvv*B*Qp - Cvv*Cp = 0
          const disc = (Cvv * B) * (Cvv * B) + 4 * Cvv * Cp;
          if (disc < 0) {
            Qp[N] = 0;
            Hp[N] = Cp;
          } else {
            Qp[N] = (-Cvv * B + Math.sqrt(disc)) / 2;
            Hp[N] = Cp - B * Qp[N];
          }
        }
      }

      // column separation guard (clip head at vapor pressure, flag)
      for (let i = 0; i <= N; i++) {
        if (Hp[i] < vaporHead) {
          Hp[i] = vaporHead;
          columnSeparation = true;
        }
        H[i] = Hp[i];
        Q[i] = Qp[i];
      }

      record(t);
    }

    const maxPress = U.ftToPsi(maxH - elevValve, rho);
    const minPress = U.ftToPsi(minH - elevValve, rho);
    // Joukowsky reference (instantaneous full closure)
    const jouHead = (a * V0) / U.G;
    const jouDP = U.ftToPsi(jouHead, rho);

    return {
      ok: true,
      a,
      dt,
      dx,
      N,
      steps,
      time,
      headValve,
      headMid,
      headUp,
      pressValve,
      flowValve,
      maxHead: maxH,
      minHead: minH,
      maxPressure: maxPress,
      minPressure: minPress,
      steadyHeadValve: H0valve,
      steadyPressValve: U.ftToPsi(H0valve - elevValve, rho),
      V0,
      f,
      joukowskyHead: jouHead,
      joukowskyDP: jouDP,
      pipePeriod: (2 * L) / a,
      columnSeparation,
    };
  }

  const Surge = { simulate, tau };
  global.HE = global.HE || {};
  global.HE.Surge = Surge;
  if (typeof module !== 'undefined' && module.exports) module.exports = Surge;
})(typeof window !== 'undefined' ? window : globalThis);
