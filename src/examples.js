/*
 * examples.js — preloaded demonstration models for the three Fervo "Cape" well
 * pads (Bearskin, Gold, Frisco) from hydraulic analysis 010000-PRR-001 rev C.
 *
 * Each pad: production wells feed a header to the ORC; spent brine plus makeup
 * water is boosted by an injection pump into a discharge header serving the
 * injection wells. Brine flows are converted from the report's kg/s figures
 * (production ρ 53.6 lb/ft³ → 18.46 gpm per kg/s; injection ρ 60.5 → 16.36).
 * Representative for demonstration — not a substitute for the stamped analysis.
 */
(function (global) {
  'use strict';

  const GEOM = {
    '8': { id: 7.981, wall: 0.322 },
    '10': { id: 10.02, wall: 0.365 },
    '12': { id: 11.938, wall: 0.406 },
    '18': { id: 16.876, wall: 0.562 },
    '20': { id: 18.814, wall: 0.593 },
    '24': { id: 22.624, wall: 0.688 },
  };
  function pipe(from, to, length, nominal, name, fittings, type) {
    const g = GEOM[nominal] || GEOM['10'];
    return { type: type || 'pipe', from, to, name, length, nominal, sched: '40', diameter: g.id, wall: g.wall, material: 'carbon_steel', roughness: 0.00015, fittings: fittings || [] };
  }
  function valve(from, to, name) {
    return { type: 'valve', from, to, name, cv: 4000, openFraction: 1, closed: false };
  }
  function pump(from, to, name) {
    return {
      type: 'pump', from, to, name,
      curve: [{ q: 0, h: 5600 }, { q: 4000, h: 5300 }, { q: 8000, h: 4700 }, { q: 12000, h: 3700 }],
    };
  }

  const PROD = 18.46; // gpm per kg/s
  const INJ = 16.36;

  /**
   * Build a pad model from per-well kg/s data.
   * cfg: { name, prodKgs:[], injKgs:[], makeup, valveOn(index of inj well), headerNominal }
   */
  function buildPad(cfg) {
    const nodes = [];
    const links = [];
    const np = cfg.prodKgs.length;
    const ni = cfg.injKgs.length;

    // --- production / supply side ---
    const taps = [];
    cfg.prodKgs.forEach((kgs, i) => {
      const id = `PW${i + 1}`;
      const gpm = Math.round(kgs * PROD);
      nodes.push({ id, name: `Prod well ${i + 1}`, type: 'supply', bcMode: 'flow', flow: gpm, x: 40, y: 40 + i * 100 });
      const t = `T${i + 1}`;
      nodes.push({ id: t, name: `Hdr tap ${i + 1}`, type: 'junction', x: 240, y: 40 + i * 100 });
      links.push(pipe(id, t, 300, '10', `Prod ${i + 1} line`));
      taps.push(t);
    });
    // header chain down the taps
    for (let i = 0; i < taps.length - 1; i++) links.push(pipe(taps[i], taps[i + 1], 200, cfg.headerNominal || '18', 'Prod header'));
    const orcY = 40 + ((np - 1) * 100) / 2;
    nodes.push({ id: 'ORCin', name: 'ORC inlet', type: 'supply', bcMode: 'head', pressure: 375, x: 480, y: orcY });
    links.push(pipe(taps[taps.length - 1], 'ORCin', 1900, '24', 'Header to ORC', [{ type: 'elbow90_long', qty: 4 }, { type: 'tee_through', qty: 2 }]));

    // --- injection side ---
    const baseY = 60 + np * 100;
    nodes.push({ id: 'ORCout', name: 'ORC outlet', type: 'supply', bcMode: 'head', pressure: 200, x: 40, y: baseY });
    nodes.push({ id: 'MKUP', name: 'Makeup water', type: 'supply', bcMode: 'flow', flow: cfg.makeup || 430, x: 40, y: baseY + 100 });
    nodes.push({ id: 'SUC', name: 'Pump suction hdr', type: 'junction', x: 240, y: baseY + 40 });
    nodes.push({ id: 'DIS', name: 'Pump discharge hdr', type: 'junction', x: 520, y: baseY + 40 });
    links.push(pipe('ORCout', 'SUC', 1900, '24', 'Return to suction', [{ type: 'elbow90_long', qty: 4 }]));
    links.push(pipe('MKUP', 'SUC', 200, '8', 'Makeup line'));
    links.push(pump('SUC', 'DIS', 'Injection pump'));

    cfg.injKgs.forEach((kgs, i) => {
      const id = `IW${i + 1}`;
      const gpm = Math.round(kgs * INJ);
      const ii = Math.max(0.5, Math.round((gpm / 100) * 10) / 10);
      const y = baseY - (ni - 1) * 40 + i * 80;
      nodes.push({ id, name: `Inj well ${i + 1}`, type: 'injection', resPressure: 2000, ii, x: 900, y });
      if (cfg.valveOn === i) {
        const b = `B${i + 1}`;
        nodes.push({ id: b, name: `IW${i + 1} branch`, type: 'junction', x: 720, y: (y + baseY + 40) / 2 });
        links.push(pipe('DIS', b, 400, '10', `Disch to IW${i + 1} branch`));
        links.push(valve(b, id, `IW${i + 1} control valve`));
      } else {
        links.push(pipe('DIS', id, 500 + i * 60, '10', `Disch to IW${i + 1}`, [{ type: 'elbow90_long', qty: 2 }], 'check'));
      }
    });

    return { meta: { name: cfg.name }, fluid: { name: 'Brine — injection (200 F)', density: 60.5, viscosity: 0.33, bulkModulus: 300000 }, nodes, links };
  }

  const bearskin = buildPad({
    name: 'Bearskin pad (demo)',
    prodKgs: [94, 134, 97, 141],
    injKgs: [48, 41, 139, 122, 139],
    makeup: 430,
    valveOn: 2, // IW3 (largest) on a control valve for surge studies
    headerNominal: '18',
  });

  const gold = buildPad({
    name: 'Gold pad (demo)',
    prodKgs: [150, 136, 132, 150],
    injKgs: [128, 121, 110],
    makeup: 470,
    valveOn: 0,
    headerNominal: '20',
  });

  const frisco = buildPad({
    name: 'Frisco pad (demo)',
    prodKgs: [119, 59, 124],
    injKgs: [57, 82, 92, 114, 127],
    makeup: 360,
    valveOn: 4, // IW5 (largest) on a valve
    headerNominal: '18',
  });

  global.HE = global.HE || {};
  global.HE.EXAMPLES = { bearskin, gold, frisco };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.HE.EXAMPLES;
})(typeof window !== 'undefined' ? window : globalThis);
