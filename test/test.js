/* Node sanity tests for the physics core. Run: node test/test.js */
const U = require('../src/units.js');
const Fluids = require('../src/fluids.js');
require('../src/fittings.js');
const Model = require('../src/model.js');
const Steady = require('../src/steady.js');
const Surge = require('../src/surge.js');

let pass = 0,
  fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra ? '  -> ' + extra : ''));
  }
}
function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

console.log('\nUnit conversions');
ok('gpm->cfs', near(U.gpmToCfs(449.0), 1.0, 0.005), U.gpmToCfs(449));
ok('psi->ft (water)', near(U.psiToFt(1, 62.37), 2.3095, 0.01), U.psiToFt(1, 62.37));

console.log('\nFriction factor (Moody spot checks)');
// Smooth-ish pipe, Re=1e5 -> f ~ 0.018; rough check via Swamee-Jain
const f1 = Fluids.frictionFactor(1e5, 0.00015, U.inToFt(10));
ok('f in plausible turbulent range', f1 > 0.015 && f1 < 0.03, f1.toFixed(4));
const fl = Fluids.frictionFactor(1000, 0.00015, U.inToFt(10));
ok('laminar f = 64/Re', near(fl, 64 / 1000, 1e-9), fl);

console.log('\nSingle pipe pressure drop vs hand calc');
// Water, 10" sch40 (ID 10.02"), 1000 ft, 2000 gpm.
(function () {
  const net = Model.newNetwork();
  net.fluid = { name: 'water', density: 62.37, viscosity: 1.1, bulkModulus: 311000 };
  const A = Model.newNode(0, 0, 'supply');
  A.bcMode = 'head';
  A.pressure = 100;
  A.elevation = 0;
  const B = Model.newNode(100, 0, 'supply');
  B.bcMode = 'flow';
  B.flow = -2000; // demand 2000 gpm out
  net.nodes = [A, B];
  const p = Model.newLink(A.id, B.id, 'pipe');
  p.length = 1000;
  p.diameter = 10.02;
  p.roughness = 0.00015;
  net.links = [p];
  const r = Steady.solve(net);
  ok('converged', r.ok, r.messages.join('; '));
  const lr = r.links[p.id];
  // hand calc: V=Q/A; A=0.5476 ft2; Q=2000gpm=4.456 cfs; V=8.14 ft/s
  ok('velocity ~8.1 ft/s', near(lr.velocity, 8.14, 0.3), lr.velocity.toFixed(2));
  // hand calc: f~0.0165 -> ~2.0 ft/100ft -> ~0.88 psi/100ft (matches report table)
  ok('dP/100ft ~0.88 psi', lr.dP100 > 0.6 && lr.dP100 < 1.2, lr.dP100.toFixed(2));
  ok('flow conserved ~2000 gpm', near(Math.abs(lr.flow), 2000, 5), lr.flow.toFixed(1));
})();

console.log('\nLooped network continuity (two parallel pipes)');
(function () {
  const net = Model.newNetwork();
  net.fluid = { name: 'water', density: 62.37, viscosity: 1.1, bulkModulus: 311000 };
  const S = Model.newNode(0, 0, 'supply');
  S.bcMode = 'head';
  S.pressure = 200;
  const D = Model.newNode(200, 0, 'supply');
  D.bcMode = 'flow';
  D.flow = -3000;
  const M = Model.newNode(100, 0, 'junction');
  net.nodes = [S, M, D];
  const p1 = Model.newLink(S.id, M.id, 'pipe');
  p1.length = 500;
  p1.diameter = 12;
  const p2a = Model.newLink(M.id, D.id, 'pipe');
  p2a.length = 500;
  p2a.diameter = 10;
  const p2b = Model.newLink(M.id, D.id, 'pipe');
  p2b.length = 500;
  p2b.diameter = 8;
  net.links = [p1, p2a, p2b];
  const r = Steady.solve(net);
  ok('converged', r.ok, r.messages.join('; '));
  const q1 = r.links[p1.id].flow;
  const qa = r.links[p2a.id].flow;
  const qb = r.links[p2b.id].flow;
  ok('inflow ~ 3000 gpm', near(Math.abs(q1), 3000, 15), q1.toFixed(1));
  ok('split sums to total', near(Math.abs(qa) + Math.abs(qb), Math.abs(q1), 15), (qa + qb).toFixed(1));
  ok('bigger pipe carries more', Math.abs(qa) > Math.abs(qb), `${qa.toFixed(0)} vs ${qb.toFixed(0)}`);
})();

console.log('\nInjection well (II-driven sink)');
(function () {
  const net = Model.newNetwork();
  net.fluid = { name: 'brine', density: 60.5, viscosity: 0.33, bulkModulus: 300000 };
  const S = Model.newNode(0, 0, 'supply');
  S.bcMode = 'head';
  S.pressure = 2200; // psig at pump discharge
  const W = Model.newNode(100, 0, 'injection');
  W.ii = 2.0; // gpm/psi
  W.resPressure = 2000;
  net.nodes = [S, W];
  const p = Model.newLink(S.id, W.id, 'pipe');
  p.length = 300;
  p.diameter = 10.02;
  net.links = [p];
  const r = Steady.solve(net);
  ok('converged', r.ok, r.messages.join('; '));
  const q = r.links[p.id].flow;
  const pw = r.nodes[W.id].pressure;
  // Qout = ii*(Pnode - 2000); with small pipe loss Pnode slightly < 2200
  const expected = 2.0 * (pw - 2000);
  ok('injection flow = II*(P-Pres)', near(q, expected, 5), `${q.toFixed(1)} vs ${expected.toFixed(1)}`);
  ok('wellhead P between 2000 and 2200', pw > 2000 && pw < 2200, pw.toFixed(1));
})();

console.log('\nSurge: Joukowsky bound on instantaneous closure');
(function () {
  const res = Surge.simulate({
    length: 3000,
    diameter: 20,
    roughness: 0.00015,
    fluid: { density: 60.5, viscosity: 0.33, bulkModulus: 300000 },
    E: 29.5e6,
    wall: 0.594,
    restraint: 1,
    Hres: U.psiToFt(300, 60.5),
    Q0: 6000,
    elevValve: 0,
    closeTime: 0.05, // near-instant relative to pipe period
    profile: 'linear',
    reaches: 24,
  });
  ok('wave speed plausible (2000-5000 ft/s)', res.a > 2000 && res.a < 5200, res.a.toFixed(0));
  // Peak head rise should approach but not wildly exceed Joukowsky
  const rise = res.maxHead - res.steadyHeadValve;
  ok('surge rise <= ~1.15x Joukowsky', rise <= res.joukowskyHead * 1.15, `${rise.toFixed(0)} vs J=${res.joukowskyHead.toFixed(0)}`);
  ok('surge rise >= ~0.6x Joukowsky for fast close', rise >= res.joukowskyHead * 0.6, `${rise.toFixed(0)}`);
  console.log(`     a=${res.a.toFixed(0)} ft/s  Joukowsky dP=${res.joukowskyDP.toFixed(0)} psi  peak dP=${(res.maxPressure - res.steadyPressValve).toFixed(0)} psi`);
})();

console.log('\nSurge: slow closure reduces peak (relief sizing intuition)');
(function () {
  const base = {
    length: 3000,
    diameter: 20,
    roughness: 0.00015,
    fluid: { density: 60.5, viscosity: 0.33, bulkModulus: 300000 },
    E: 29.5e6,
    wall: 0.594,
    Hres: U.psiToFt(300, 60.5),
    Q0: 6000,
    reaches: 24,
    profile: 'linear',
  };
  const fast = Surge.simulate(Object.assign({}, base, { closeTime: 0.1 }));
  const slow = Surge.simulate(Object.assign({}, base, { closeTime: 10 }));
  ok('slow closure peak < fast closure peak', slow.maxPressure < fast.maxPressure, `${slow.maxPressure.toFixed(0)} < ${fast.maxPressure.toFixed(0)}`);
})();

console.log('\nWater properties by temperature');
(function () {
  const w60 = Fluids.water(60);
  ok('density at 60F ~62.37', near(w60.density, 62.37, 0.05), w60.density);
  ok('viscosity at 60F ~1.12 cP', near(w60.viscosity, 1.12, 0.05), w60.viscosity);
  const w200 = Fluids.water(200);
  ok('density at 200F ~60.1', near(w200.density, 60.11, 0.2), w200.density);
  ok('viscosity drops with temp', w200.viscosity < w60.viscosity, `${w200.viscosity} < ${w60.viscosity}`);
  // interpolation between table points
  const w130 = Fluids.water(130);
  ok('130F interpolates between 120 and 140', w130.density < Fluids.water(120).density && w130.density > Fluids.water(140).density, w130.density);
  // clamping outside the table
  ok('clamps below 32F', Fluids.water(-20).density === Fluids.water(32).density, Fluids.water(-20).density);
  ok('clamps above 400F', Fluids.water(900).density === Fluids.water(400).density, Fluids.water(900).density);
  // normalize() fills properties from kind:'water' + tempF
  const net = Model.normalize({ fluid: { kind: 'water', tempF: 200 }, nodes: [], links: [] });
  ok('normalize fills water props from tempF', near(net.fluid.density, 60.11, 0.2), net.fluid.density);
})();

console.log('\nFixed-ΔP pump horsepower');
(function () {
  const net = Model.newNetwork();
  net.fluid = { name: 'water', density: 62.37, viscosity: 1.1, bulkModulus: 311000 };
  const A = Model.newNode(0, 0, 'supply');
  A.bcMode = 'head';
  A.pressure = 100;
  const B = Model.newNode(100, 0, 'supply');
  B.bcMode = 'flow';
  B.flow = -1500; // 1500 gpm drawn through the pump
  net.nodes = [A, B];
  const p = Model.newLink(A.id, B.id, 'pump');
  p.pumpMode = 'dp';
  p.dp = 250; // psi rise
  p.eff = 0.75;
  net.links = [p];
  const r = Steady.solve(net);
  ok('converged', r.ok, r.messages.join('; '));
  const lr = r.links[p.id];
  ok('flow ~1500 gpm', near(Math.abs(lr.flow), 1500, 10), lr.flow.toFixed(1));
  ok('pump ΔP rise ~250 psi', near(lr.pumpDp, 250, 2), lr.pumpDp.toFixed(1));
  // WHP = Q*dP/1714 = 1500*250/1714 = 218.8 hp
  ok('hydraulic hp ~218.8', near(lr.hp, 218.8, 3), lr.hp.toFixed(1));
  // BHP = WHP / 0.75 = 291.7 hp
  ok('brake hp ~291.7', near(lr.bhp, 291.7, 4), lr.bhp.toFixed(1));
})();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
