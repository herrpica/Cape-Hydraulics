# HydroStick

A lightweight, **Pipe-Flo–style** pipe-network and **surge (waterhammer)** modeler that
runs entirely in the browser — no install, no build step, no server required.

Lay down "sticks" (pipe segments), drop connectors (valves, check valves, elbows/tees,
pumps), define sources (wells / pumps with performance curves) and sinks (injection wells
with an injectivity index), solve the **steady-state** hydraulics, then close a valve and
watch the **pressure-wave transient** to size MAWP and relief valves.

It was built around the Fervo *Cape* geothermal brine hydraulic analysis
(`010000-PRR-001`, modeled in PIPE-FLO), and ships with a demonstration model of the
**Bearskin well pad**.

---

## Quick start

**Just open it** — double-click `index.html`. The engine is plain `<script>` files that
load from `file://`, so nothing else is needed.

Prefer a local server (recommended for some browsers' file policies):

```bash
npm run serve      # http://localhost:8000
# or
python3 -m http.server 8000
```

Run the physics test suite:

```bash
npm test
```

---

## What you can model

### Nodes
| Type | Meaning | Key data |
|------|---------|----------|
| **Source** (well / boundary) | Fixed pressure, fixed flow, **or** productivity-index (PI) driven | psig, gpm, or `PI [gpm/psi]` + reservoir pressure |
| **Sink** (injection well) | Pressure-dependent injection | `II [gpm/psi]` (injectivity index) + reservoir pressure |
| **Junction** | Header tap / tee, optional fixed demand | gpm |

Injection rate = `II × (wellhead − reservoir pressure)`.
PI inflow = `PI × (reservoir − wellhead pressure)`.

### Links (sticks & connectors)
- **Pipe** — length, nominal size + schedule (auto inside-dia & wall from ASME B36.10),
  material roughness, and a **fittings list** (elbows, tees, entrances, strainers, …) added
  as minor losses (`h = ΣK · V²/2g`).
- **Valve** — flow coefficient `Cv`, open fraction, open/closed (double-click on canvas to
  toggle).
- **Check valve** — forward-flow only.
- **Pump** — a **performance curve** (head vs flow); a quadratic is fit through your points.

### Steady-state solver
- Incompressible nodal formulation solved by successive linearization (Newton on continuity).
- **Darcy-Weisbach** friction with the **Swamee-Jain** factor (laminar `64/Re` below
  Re 2100). Handles **looped** networks (headers + branches), not just trees.
- Reports per-segment flow, velocity, Reynolds number, friction factor, ΔP and ΔP/100 ft,
  and per-node pressure. Velocities are color-coded against the **12 ft/s** criterion used in
  the report.

### Surge / waterhammer
- **Method of Characteristics** (Wylie & Streeter), reservoir–pipe–valve, Courant number 1.
- Acoustic wave speed from fluid bulk modulus and pipe elasticity
  `a = √[(K/ρ) / (1 + (K/E)(D/e))]`.
- Choose closure time and law (linear / cosine / fast- or slow-initial).
- Output: **pressure-vs-time** trace at the valve with your **MAWP** line overlaid, peak &
  minimum pressure, surge rise, the **Joukowsky** instantaneous bound, a column-separation
  (cavitation) flag, and a plain-language MAWP / relief-valve verdict. The MAWP default is the
  nearest ANSI B16.5 flange class above the operating pressure.

---

## Keyboard / canvas

| Action | How |
|--------|-----|
| Add element | Toolbar → then click the canvas (nodes) or two nodes (pipes) |
| Move node | Drag it |
| Pan / zoom | Drag empty space / scroll wheel |
| Toggle valve | Double-click the valve |
| Solve | `R` or **Run** |
| Fit view | `F` |
| Delete | `Del` |
| Cancel a tool | `Esc` |

Models save/load as `*.hydrostick.json`.

---

## Project layout

```
index.html            app shell (loads the engine as plain scripts)
assets/styles.css      UI styling
src/
  units.js             unit conversions & constants
  fluids.js            fluid presets + velocity/Reynolds/friction/wave-speed
  fittings.js          K-factor catalog, materials, ASME schedule table
  model.js             network data model + pump-curve fitting
  steady.js            steady-state nodal solver  (node-testable)
  surge.js             Method-of-Characteristics transient  (node-testable)
  charts.js            tiny canvas line-chart helper
  editor.js            schematic canvas (draw/select/drag, result overlay)
  examples.js          preloaded Bearskin-pad demo model
  app.js               UI: toolbar, property editor, results, surge dialog
test/test.js           physics sanity tests (hand-calc & Joukowsky checks)
```

The files in `src/` that contain physics (`units`, `fluids`, `fittings`, `model`, `steady`,
`surge`) double as CommonJS modules, so they're unit-tested directly under Node.

---

## Accuracy & scope

The steady-state results reproduce textbook pressure-drop hand calculations and match the
magnitudes in the Cape report (e.g. ~0.6–1.2 psi/100 ft on the headers, ~7–11 ft/s
velocities, ORC inlet ≈ 375 psig, injection wellheads ≈ 2000 psig). The surge solver respects
the Joukowsky bound for rapid closure and correctly shows reduced peaks for slow closure.

This is an **engineering aid for screening and education**, not a substitute for a stamped
analysis. The transient model is single-pipeline reservoir–valve (the classic surge case);
multi-path transient propagation, air vessels/surge tanks, and full two-phase column
separation are not modeled.
