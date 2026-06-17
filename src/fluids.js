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

  const Fluids = {
    PRESETS,

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
