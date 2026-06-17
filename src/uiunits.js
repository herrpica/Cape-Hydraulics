/*
 * uiunits.js — display unit system (US ↔ SI) for the UI layer.
 *
 * The model and solver are always in internal US units (psi, gpm, ft, in,
 * lb/ft³). This singleton converts those internal values to the currently
 * selected display system and parses user input back to internal units, so the
 * physics never changes — only what's shown.
 *
 * SI choices follow common process practice: barg, m³/h, m/s, m, mm, kg/m³.
 */
(function (global) {
  'use strict';

  // factor: internal × factor = display value
  const DEF = {
    pressure: { US: { f: 1, u: 'psig' }, SI: { f: 0.0689476, u: 'barg' } },
    flow: { US: { f: 1, u: 'gpm' }, SI: { f: 0.227125, u: 'm³/h' } },
    velocity: { US: { f: 1, u: 'ft/s' }, SI: { f: 0.3048, u: 'm/s' } },
    length: { US: { f: 1, u: 'ft' }, SI: { f: 0.3048, u: 'm' } },
    diameter: { US: { f: 1, u: 'in' }, SI: { f: 25.4, u: 'mm' } },
    head: { US: { f: 1, u: 'ft' }, SI: { f: 0.3048, u: 'm' } },
    density: { US: { f: 1, u: 'lb/ft³' }, SI: { f: 16.0185, u: 'kg/m³' } },
    gradient: { US: { f: 1, u: 'psi/100ft' }, SI: { f: 0.0689476 / 0.3048, u: 'bar/100m' } },
  };

  const UIUnits = {
    system: 'US',

    set(sys) {
      this.system = sys === 'SI' ? 'SI' : 'US';
    },
    isSI() {
      return this.system === 'SI';
    },

    /** internal -> display number */
    disp(q, v) {
      const d = DEF[q];
      return d ? v * d[this.system].f : v;
    },
    /** display -> internal number */
    parse(q, v) {
      const d = DEF[q];
      return d ? v / d[this.system].f : v;
    },
    /** unit label for current system */
    unit(q) {
      const d = DEF[q];
      return d ? d[this.system].u : '';
    },
    /** formatted "value unit" string */
    fmt(q, v, dec = 1) {
      const x = this.disp(q, v);
      const s = Math.abs(x) >= 1000 ? x.toFixed(0) : x.toFixed(dec);
      return `${s} ${this.unit(q)}`;
    },
    /** just the converted, rounded value (no unit) */
    val(q, v, dec = 2) {
      const x = this.disp(q, v);
      return Math.abs(x) >= 1000 ? Math.round(x) : Number(x.toFixed(dec));
    },
  };

  global.HE = global.HE || {};
  global.HE.UIUnits = UIUnits;
  if (typeof module !== 'undefined' && module.exports) module.exports = UIUnits;
})(typeof window !== 'undefined' ? window : globalThis);
