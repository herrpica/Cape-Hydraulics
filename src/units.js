/*
 * units.js — unit conversions and physical constants (US customary primary).
 *
 * The model works internally in a consistent US set:
 *   length      ft
 *   diameter    ft   (UI uses inches)
 *   flow        ft^3/s (UI uses gpm)
 *   head        ft of fluid
 *   pressure    psi  (gauge, psig, atmospheric ignored)
 *   density     lb/ft^3
 *   viscosity   lb/(ft*s) (UI uses centipoise)
 *
 * Everything attaches to a global `HE` namespace so the same files load in the
 * browser via plain <script> tags (no bundler) and under Node via require().
 */
(function (global) {
  'use strict';

  const G = 32.174; // gravitational acceleration, ft/s^2

  const Units = {
    G,

    // Flow
    GPM_TO_CFS: 0.00222800926, // 1 US gpm = 0.002228 ft^3/s
    gpmToCfs: (q) => q * 0.00222800926,
    cfsToGpm: (q) => q / 0.00222800926,

    // Length
    inToFt: (d) => d / 12,
    ftToIn: (d) => d * 12,

    // Viscosity: 1 cP = 0.000671969 lb/(ft*s)
    cpToLbFtS: (mu) => mu * 0.000671969,

    /**
     * Pressure (psi) <-> head (ft) for a given fluid density (lb/ft^3).
     * head[ft] = psi * 144 / rho ;  psi = head * rho / 144
     */
    psiToFt: (psi, rho) => (psi * 144) / rho,
    ftToPsi: (ft, rho) => (ft * rho) / 144,

    // Mass flow helpers (kg/s <-> gpm) — handy because the source report is in kg/s.
    // q[gpm] = mdot[kg/s] / rho[kg/m3] * 15850.3
    kgsToGpm: (mdot, rhoKgM3) => (mdot / rhoKgM3) * 15850.3,
    lbft3ToKgm3: (rho) => rho * 16.0185,

    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  };

  global.HE = global.HE || {};
  global.HE.Units = Units;
  if (typeof module !== 'undefined' && module.exports) module.exports = Units;
})(typeof window !== 'undefined' ? window : globalThis);
