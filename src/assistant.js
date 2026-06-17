/*
 * assistant.js — "Describe your system" LLM layer.
 *
 * Turns a plain-English description of a hydraulic system into a HydroStick
 * network object by calling the Anthropic Messages API directly from the
 * browser. The model only has to emit the essential topology and key
 * parameters; Model.normalize() fills in every default, so the prompt stays
 * small and the output is forgiving.
 *
 * This is a prototype: the user supplies their own Anthropic API key, which is
 * kept in localStorage and sent straight to api.anthropic.com (enabled with the
 * direct-browser-access header). For a production deployment the call should be
 * proxied through a small backend so the key never touches the client.
 */
(function (global) {
  'use strict';

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2023-06-01';
  const KEY_STORE = 'hydrostick_anthropic_key';
  const MODEL_STORE = 'hydrostick_model';
  const DEFAULT_MODEL = 'claude-opus-4-8';

  // The network schema, written for the model. Mirrors src/model.js. Only the
  // fields listed here matter; anything omitted is defaulted by normalize().
  const SCHEMA_DOC = `A HydroStick network is a JSON object:

{
  "meta":  { "name": string },
  "fluid": Fluid,
  "nodes": [ Node, ... ],
  "links": [ Link, ... ]
}

Fluid — either explicit properties:
    { "name": string, "density": number (lb/ft^3), "viscosity": number (cP), "bulkModulus": number (psi) }
  or water defined by temperature (the app fills the properties):
    { "kind": "water", "tempF": number (deg F, 32-400) }

Node — every node needs a unique "id" (short string) and an (x, y) canvas
position in pixels. Lay the system out left-to-right: sources on the left,
sinks on the right, ~150-250 px between connected nodes, ~100 px vertical
spacing between parallel wells. Node "type" is one of:

  "supply"    — a source (production well, reservoir, pump/boundary). Pick a "bcMode":
                  "head" → fixed pressure, set "pressure" (psig)
                  "flow" → fixed inflow,  set "flow" (gpm, + into the network)
                  "pi"   → productivity-index driven, set "pi" (gpm/psi) and "resPressure" (psig)
  "injection" — a sink (injection well). Set "ii" (injectivity index, gpm/psi) and "resPressure" (psig, e.g. 2000).
  "junction"  — interior tee/manifold. Optional "demand" (gpm, + supply / - demand).

  Optional on any node: "name" (label), "elevation" (ft).

Link — connects two nodes by id: "from" and "to". "type" is one of:

  "pipe"  — set "length" (ft), "diameter" (inside dia, in), "nominal" (e.g. "10"),
            optional "fittings": [ { "type": FittingType, "qty": int } ].
  "valve" — control valve. Set "cv" (flow coeff, gpm @ 1 psi) and "openFraction" (0..1).
  "check" — check valve (one-way). Pipe-like geometry.
  "pump"  — prefer fixed pressure rise: "pumpMode": "dp", "dp": number (psi),
            optional "eff" (0..1 efficiency). Only use a performance curve when
            the user gives one: "pumpMode": "curve", "curve": [ { "q": gpm, "h": ft }, ... ].

  Optional on any link: "name" (label).

Common nominal pipe sizes (nominal → inside dia in inches): 8 → 7.981,
10 → 10.02, 12 → 11.938, 18 → 16.876, 20 → 18.814, 24 → 22.624.

FittingType is one of: elbow90_long, elbow90_short, elbow45, tee_through,
tee_branch, gate_valve, globe_valve, check_swing, entrance, exit, reducer.`;

  const SYSTEM_PROMPT = `You are a hydraulic modeling assistant embedded in HydroStick, a pipe-network
and surge (waterhammer) modeler for geothermal brine systems. The user
describes a system in plain English; you translate it into a HydroStick
network and return ONLY the JSON object — no prose, no markdown fences.

${SCHEMA_DOC}

Rules:
- Every link's "from" and "to" must reference a node "id" that exists.
- Connect the network: no orphan nodes, no dangling links.
- A solvable system needs at least one pressure reference — make sure at least
  one supply uses bcMode "head" (or an injection well with resPressure), so the
  solver is not under-determined.
- Choose realistic defaults when the user is vague (10" carbon-steel headers,
  brine density ~53.6 lb/ft^3 for production / ~60.5 for injection, valve
  cv ~2000-4000). Reasonable assumptions are better than asking.
- Lay nodes out cleanly so the schematic is readable.
Return the JSON object and nothing else.`;

  function getKey() {
    return (global.localStorage && localStorage.getItem(KEY_STORE)) || '';
  }
  function setKey(k) {
    if (global.localStorage) localStorage.setItem(KEY_STORE, k || '');
  }
  function getModel() {
    return (global.localStorage && localStorage.getItem(MODEL_STORE)) || DEFAULT_MODEL;
  }
  function setModel(m) {
    if (global.localStorage) localStorage.setItem(MODEL_STORE, m || DEFAULT_MODEL);
  }

  /** Pull the JSON object out of a model response, tolerating stray fences. */
  function extractJson(text) {
    let s = (text || '').trim();
    // Strip ```json ... ``` fences if the model added them anyway.
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // Otherwise, grab from the first { to the last } to drop any stray prose.
    if (s[0] !== '{') {
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
    }
    return JSON.parse(s);
  }

  /**
   * Generate a network from a description.
   * @param {string} description  user's plain-English system description
   * @param {object} [opts]       { key, model }
   * @returns {Promise<object>}   a HydroStick network (already normalized)
   */
  async function generate(description, opts) {
    opts = opts || {};
    const key = opts.key || getKey();
    const model = opts.model || getModel();
    if (!key) throw new Error('No Anthropic API key set.');
    if (!description || !description.trim()) throw new Error('Describe the system first.');

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        // Permits calling the API straight from a browser (no proxy).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        // Building a network from a vague description benefits from reasoning.
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: description.trim() }],
      }),
    });

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try {
        const err = await res.json();
        if (err && err.error && err.error.message) msg = err.error.message;
      } catch (_) {
        /* non-JSON error body */
      }
      throw new Error(msg);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('The model declined this request. Try rephrasing the description.');
    }
    // Concatenate the text blocks (skips any thinking blocks).
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text) throw new Error('Empty response from the model.');

    let net;
    try {
      net = extractJson(text);
    } catch (e) {
      throw new Error('Could not parse the model output as JSON: ' + e.message);
    }
    // normalize() fills in every default and migrates loose fields.
    return global.HE.Model.normalize(net);
  }

  global.HE = global.HE || {};
  global.HE.Assistant = { generate, getKey, setKey, getModel, setModel, DEFAULT_MODEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.HE.Assistant;
})(typeof window !== 'undefined' ? window : globalThis);
