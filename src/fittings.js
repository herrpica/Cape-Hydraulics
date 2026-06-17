/*
 * fittings.js — minor-loss (K-factor) catalog and pipe-material properties.
 *
 * K values are representative resistance coefficients (Crane TP-410 style) for
 * the "fully turbulent" regime, applied as h = K * V^2 / 2g. Connectors the user
 * can drop onto a pipe (elbows, tees, check valves, reducers) live here.
 */
(function (global) {
  'use strict';

  // Minor-loss fittings — K per item.
  const FITTINGS = {
    elbow90_long: { name: '90° elbow (long radius)', K: 0.3 },
    elbow90_std: { name: '90° elbow (standard)', K: 0.6 },
    elbow45: { name: '45° elbow', K: 0.4 },
    tee_through: { name: 'Tee (run/through)', K: 0.2 },
    tee_branch: { name: 'Tee (branch)', K: 1.0 },
    entrance: { name: 'Pipe entrance (sharp)', K: 0.5 },
    exit: { name: 'Pipe exit', K: 1.0 },
    reducer: { name: 'Reducer / expander', K: 0.25 },
    gate_open: { name: 'Gate valve (full open)', K: 0.15 },
    ball_open: { name: 'Ball valve (full open)', K: 0.05 },
    globe_open: { name: 'Globe valve (full open)', K: 6.0 },
    check_swing: { name: 'Swing check valve', K: 2.0 },
    strainer: { name: 'Strainer (clean)', K: 2.5 },
  };

  // Pipe materials: absolute roughness (ft) and elastic modulus (psi, for surge).
  const MATERIALS = {
    carbon_steel: { name: 'Carbon steel (new)', roughness: 0.00015, E: 29.5e6 },
    stainless: { name: 'Stainless steel', roughness: 0.00007, E: 28e6 },
    cs_used: { name: 'Carbon steel (moderate corrosion)', roughness: 0.0005, E: 29.5e6 },
    hdpe: { name: 'HDPE', roughness: 0.000005, E: 0.13e6 },
    cement_lined: { name: 'Cement-lined', roughness: 0.0013, E: 29.5e6 },
  };

  // ASME B36.10 — a useful subset of nominal sizes / schedules → inside dia (in)
  // and wall thickness (in). Used to auto-fill geometry & surge wall thickness.
  const SCHEDULES = {
    // nominal: { OD, walls: { sched: wall_in } }
    '6': { OD: 6.625, walls: { '40': 0.28, '80': 0.432, '160': 0.719 } },
    '8': { OD: 8.625, walls: { '40': 0.322, '80': 0.5, '160': 0.906 } },
    '10': { OD: 10.75, walls: { '40': 0.365, '80': 0.594, '160': 1.125 } },
    '12': { OD: 12.75, walls: { '40': 0.406, '80': 0.688, '160': 1.312 } },
    '14': { OD: 14.0, walls: { '40': 0.438, '80': 0.75 } },
    '16': { OD: 16.0, walls: { '40': 0.5, '80': 0.844 } },
    '18': { OD: 18.0, walls: { '40': 0.562, '80': 0.938 } },
    '20': { OD: 20.0, walls: { '40': 0.594, '80': 1.031 } },
    '24': { OD: 24.0, walls: { '40': 0.688, '80': 1.219 } },
  };

  const Fittings = {
    FITTINGS,
    MATERIALS,
    SCHEDULES,

    /** Total K for a fittings list: [{ type, qty }]. */
    sumK(list) {
      if (!list) return 0;
      return list.reduce((s, f) => {
        const def = FITTINGS[f.type];
        return s + (def ? def.K * (f.qty || 1) : 0);
      }, 0);
    },

    /** Inside diameter (in) and wall (in) for a nominal size + schedule. */
    geometry(nominal, sched) {
      const s = SCHEDULES[String(nominal)];
      if (!s) return null;
      const wall = s.walls[String(sched)] ?? Object.values(s.walls)[0];
      return { id: s.OD - 2 * wall, wall, od: s.OD };
    },
  };

  global.HE = global.HE || {};
  global.HE.Fittings = Fittings;
  if (typeof module !== 'undefined' && module.exports) module.exports = Fittings;
})(typeof window !== 'undefined' ? window : globalThis);
