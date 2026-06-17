/*
 * examples.js — preloaded demonstration models.
 *
 * "bearskin" is a representative model of the Bearskin well pad from the Fervo
 * "Cape" hydraulic analysis (010000-PRR-001 rev C): four production wells feed a
 * production header to the ORC; spent brine plus makeup water is boosted by an
 * injection pump into a discharge header that feeds five injection wells. Flows
 * are converted from the report's kg/s figures; pressures/sizes follow the
 * report (production wells 400 psig, injection 2000 psig reservoir, 10–24" lines).
 *
 * Numbers are representative for demonstration, not a substitute for the
 * stamped engineering analysis.
 */
(function (global) {
  'use strict';

  // production: 18.46 gpm per kg/s (rho 53.6 lb/ft3) ; injection: 16.36 gpm per kg/s (rho 60.5)
  const bearskin = {
    meta: { name: 'Bearskin pad (demo)' },
    fluid: { name: 'Brine — injection (200 F)', density: 60.5, viscosity: 0.33, bulkModulus: 300000 },
    nodes: [
      // --- supply / production side (reference = ORC inlet pressure) ---
      { id: 'PW1', name: 'Prod well 1', type: 'supply', bcMode: 'flow', flow: 1735, x: 40, y: 40 },
      { id: 'PW2', name: 'Prod well 2', type: 'supply', bcMode: 'flow', flow: 2474, x: 40, y: 140 },
      { id: 'PW3', name: 'Prod well 3', type: 'supply', bcMode: 'flow', flow: 1791, x: 40, y: 240 },
      { id: 'PW4', name: 'Prod well 4', type: 'supply', bcMode: 'flow', flow: 2603, x: 40, y: 340 },
      { id: 'T1', name: 'Hdr tap 1', type: 'junction', x: 240, y: 40 },
      { id: 'T2', name: 'Hdr tap 2', type: 'junction', x: 240, y: 140 },
      { id: 'T3', name: 'Hdr tap 3', type: 'junction', x: 240, y: 240 },
      { id: 'T4', name: 'Hdr tap 4', type: 'junction', x: 240, y: 340 },
      { id: 'ORCin', name: 'ORC inlet', type: 'supply', bcMode: 'head', pressure: 375, x: 460, y: 190 },

      // --- injection side (reference = ORC outlet pressure) ---
      { id: 'ORCout', name: 'ORC outlet', type: 'supply', bcMode: 'head', pressure: 200, x: 40, y: 480 },
      { id: 'MKUP', name: 'Makeup water', type: 'supply', bcMode: 'flow', flow: 430, x: 40, y: 580 },
      { id: 'SUC', name: 'Pump suction hdr', type: 'junction', x: 240, y: 520 },
      { id: 'DIS', name: 'Pump discharge hdr', type: 'junction', x: 520, y: 520 },
      { id: 'B3', name: 'IW3 branch', type: 'junction', x: 720, y: 460 },
      { id: 'IW1', name: 'Inj well 1', type: 'injection', resPressure: 2000, ii: 7.9, x: 900, y: 360 },
      { id: 'IW2', name: 'Inj well 2', type: 'injection', resPressure: 2000, ii: 6.8, x: 900, y: 440 },
      { id: 'IW3', name: 'Inj well 3', type: 'injection', resPressure: 2000, ii: 22.7, x: 900, y: 520 },
      { id: 'IW4', name: 'Inj well 4', type: 'injection', resPressure: 2000, ii: 20.0, x: 900, y: 600 },
      { id: 'IW5', name: 'Inj well 5', type: 'injection', resPressure: 2000, ii: 22.7, x: 900, y: 680 },
    ],
    links: [
      // production wells to header taps (10" sch40)
      pipe('PW1', 'T1', 300, '10', 'Prod 1 line'),
      pipe('PW2', 'T2', 300, '10', 'Prod 2 line'),
      pipe('PW3', 'T3', 300, '10', 'Prod 3 line'),
      pipe('PW4', 'T4', 300, '10', 'Prod 4 line'),
      // production header chain down to ORC (18" then 24")
      pipe('T1', 'T2', 200, '18', 'Prod header'),
      pipe('T2', 'T3', 200, '18', 'Prod header'),
      pipe('T3', 'T4', 200, '18', 'Prod header'),
      pipe('T4', 'ORCin', 1900, '24', 'Header to ORC', [{ type: 'elbow90_long', qty: 4 }, { type: 'tee_through', qty: 2 }]),

      // injection: ORC outlet + makeup -> suction header (24" / 8")
      pipe('ORCout', 'SUC', 1900, '24', 'Return to suction', [{ type: 'elbow90_long', qty: 4 }]),
      pipe('MKUP', 'SUC', 200, '8', 'Makeup line'),
      // injection pump
      pump('SUC', 'DIS', 'Injection pump'),
      // discharge header to injection wells (10")
      pipe('DIS', 'IW1', 600, '10', 'Disch to IW1', [{ type: 'elbow90_long', qty: 2 }], 'check'),
      pipe('DIS', 'IW2', 500, '10', 'Disch to IW2', [{ type: 'elbow90_long', qty: 2 }], 'check'),
      pipe('DIS', 'B3', 400, '10', 'Disch to IW3 branch'),
      valve('B3', 'IW3', 'IW3 control valve'),
      pipe('DIS', 'IW4', 500, '10', 'Disch to IW4', [{ type: 'elbow90_long', qty: 2 }], 'check'),
      pipe('DIS', 'IW5', 700, '10', 'Disch to IW5', [{ type: 'elbow90_long', qty: 2 }], 'check'),
    ],
  };

  function geom(nominal) {
    const tbl = {
      '8': { id: 7.981, wall: 0.322 },
      '10': { id: 10.02, wall: 0.365 },
      '18': { id: 16.876, wall: 0.562 },
      '24': { id: 22.624, wall: 0.688 },
    };
    return tbl[nominal] || tbl['10'];
  }
  function pipe(from, to, length, nominal, name, fittings, type) {
    const g = geom(nominal);
    return {
      type: type || 'pipe',
      from,
      to,
      name,
      length,
      nominal,
      sched: '40',
      diameter: g.id,
      wall: g.wall,
      material: 'carbon_steel',
      roughness: 0.00015,
      fittings: fittings || [],
    };
  }
  function valve(from, to, name) {
    return { type: 'valve', from, to, name, cv: 4000, openFraction: 1, closed: false };
  }
  function pump(from, to, name) {
    return {
      type: 'pump',
      from,
      to,
      name,
      curve: [
        { q: 0, h: 5600 },
        { q: 4000, h: 5300 },
        { q: 8000, h: 4700 },
        { q: 12000, h: 3700 },
      ],
    };
  }

  global.HE = global.HE || {};
  global.HE.EXAMPLES = { bearskin };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.HE.EXAMPLES;
})(typeof window !== 'undefined' ? window : globalThis);
