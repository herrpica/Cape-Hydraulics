/*
 * fluids.js — fluid property presets and the hydraulic primitives that depend
 * on fluid + geometry (velocity, Reynolds number, Darcy friction factor).
 *
 * Presets include the geothermal brine cases from the Fervo "Cape" hydraulic
 * analysis (production brine 53.6 lb/ft^3 @ 400 F, injection brine 60.5 lb/ft^3
 * @ 200 F, viscosity 0.15-0.33 cP).
 */
(function (global) {
  'use strict';
  const U = (global.HE && global.HE.Units) || require('./units.js');

  const PRESETS = {
    water_60F: { name: 'Water (60 F)', density: 62.37, viscosity: 1.1, bulkModulus: 311000 },
    brine_production: { name: 'Brine — production (400 F)', density: 53.6, viscosity: 0.25, bulkModulus: 250000 },
    brine_injection: { name: 'Brine — injection (200 F)', density: 60.5, viscosity: 0.33, bulkModulus: 300000 },
    makeup_water: { name: 'Makeup water (ambient)', density: 62.0, viscosity: 0.9, bulkModulus: 311000 },
  };

  // Bulk modulus values above are in psi (water ~311,000 psi).

  // Liquid-water properties vs temperature (1 atm / lightly compressed):
  //   [ tempF, density lb/ft^3, viscosity cP, bulk modulus psi ]
  // Interpolated linearly; clamped to the table ends. Representative engineering
  // values — good enough to pick properties from a temperature without a steam
  // table, not a substitute for IAPWS.
  const WATER = [
    [32, 62.42, 1.79, 293000],
    [50, 62.41, 1.31, 305000],
    [60, 62.37, 1.12, 311000],
    [70, 62.30, 0.98, 316000],
    [80, 62.22, 0.86, 319000],
    [100, 61.99, 0.68, 322000],
    [120, 61.71, 0.56, 323000],
    [140, 61.38, 0.47, 323000],
    [160, 61.00, 0.40, 321000],
    [180, 60.58, 0.35, 318000],
    [200, 60.11, 0.30, 313000],
    [220, 59.6, 0.27, 306000],
    [250, 58.81, 0.23, 295000],
    [300, 57.31, 0.184, 270000],
    [350, 55.59, 0.153, 240000],
    [400, 53.65, 0.134, 205000],
  ];

  const Fluids = {
    PRESETS,

    /** Water properties interpolated for a temperature (deg F). */
    water(tempF) {
      const t = Math.max(WATER[0][0], Math.min(WATER[WATER.length - 1][0], tempF));
      let i = 0;
      while (i < WATER.length - 1 && WATER[i + 1][0] < t) i++;
      const [t0, d0, v0, b0] = WATER[i];
      const [t1, d1, v1, b1] = WATER[Math.min(i + 1, WATER.length - 1)];
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      const lerp = (a, b) => a + (b - a) * f;
      return {
        name: `Water (${Math.round(tempF)} F)`,
        density: Math.round(lerp(d0, d1) * 100) / 100,
        viscosity: Math.round(lerp(v0, v1) * 1000) / 1000,
        bulkModulus: Math.round(lerp(b0, b1)),
      };
    },

    /** Specific gravity relative to 62.4 lb/ft^3. */
    specificGravity: (rho) => rho / 62.37,

    /** Bulk-velocity in ft/s from flow (cfs) and inside diameter (ft). */
    velocity(qCfs, dFt) {
      const a = (Math.PI / 4) * dFt * dFt;
      return a > 0 ? qCfs / a : 0;
    },

    /** Reynolds number. rho lb/ft^3, V ft/s, D ft, mu cP. */
    reynolds(rho, vFtS, dFt, muCp) {
      const mu = U.cpToLbFtS(muCp);
      if (mu <= 0) return 0;
      return (rho * Math.abs(vFtS) * dFt) / mu;
    },

    /**
     * Darcy friction factor.
     *  - laminar  (Re < 2100):  64/Re
     *  - turbulent: Swamee-Jain explicit approximation of Colebrook
     *  eps = absolute roughness (ft), D = inside diameter (ft).
     */
    frictionFactor(Re, epsFt, dFt) {
      if (Re < 1e-6) return 0;
      if (Re < 2100) return 64 / Re;
      const rr = epsFt / dFt;
      const denom = Math.log10(rr / 3.7 + 5.74 / Math.pow(Re, 0.9));
      return 0.25 / (denom * denom);
    },

    /**
     * Acoustic wave speed (ft/s) for waterhammer.
     *   a = sqrt( (K/rho) / (1 + (K/E)*(D/e)*c1) )
     * K bulk modulus (psi), E pipe elastic modulus (psi), D dia (ft), e wall (ft),
     * c1 restraint factor (~1 thin-wall anchored against axial). rho lb/ft^3.
     */
    waveSpeed(Kpsi, rho, Epsi, dFt, eFt, c1) {
      const K = Kpsi * 144; // psf
      const E = Epsi * 144; // psf
      const rhoSlug = rho / U.G; // slug/ft^3
      const restraint = (e_, d_) => (e_ > 0 ? (K / E) * (d_ / e_) * (c1 || 1) : 0);
      const a2 = (K / rhoSlug) / (1 + restraint(eFt, dFt));
      return Math.sqrt(a2);
    },
  };

  global.HE = global.HE || {};
  global.HE.Fluids = Fluids;
  if (typeof module !== 'undefined' && module.exports) module.exports = Fluids;
})(typeof window !== 'undefined' ? window : globalThis);
