/* Bulk color tools: hue shifting and gradients across prompt elements. */
(function (PG) {
  'use strict';

  var C = PG.color, M = PG.model;

  /* Elements a color tool can act on (newlines have no color). */
  function colorable(list) { return list.filter(function (el) { return el.kind !== 'newline'; }); }

  /* Shift hue of the given layers on `targets`, starting from a snapshot {id: {fg, bg, failFg, failBg}}. */
  function snapshot(targets) {
    var snap = {};
    targets.forEach(function (el) {
      snap[el.id] = { fg: el.fg, bg: el.bg, failFg: el.props && el.props.failFg, failBg: el.props && el.props.failBg };
    });
    return snap;
  }

  function applyHue(targets, snap, deg, layers) {
    targets.forEach(function (el) {
      var s = snap[el.id];
      if (!s) return;
      if (layers.fg && s.fg) el.fg = C.shiftHue(s.fg, deg);
      if (layers.bg && s.bg) el.bg = C.shiftHue(s.bg, deg);
      if (el.field === 'exit') {
        if (layers.fg && s.failFg) el.props.failFg = C.shiftHue(s.failFg, deg);
        if (layers.bg && s.failBg) el.props.failBg = C.shiftHue(s.failBg, deg);
      }
    });
  }

  /*
   * Color `targets` with a gradient running left to right across the prompt.
   * opts: { layer: 'fg'|'bg', space: 'oklab'|'rgb'|'hsl', by: 'chars'|'elements', sim }
   * With by='chars', each element is colored at the midpoint of the characters it occupies,
   * so long fields take a larger slice of the gradient than single symbols.
   */
  function applyGradient(targets, stops, opts) {
    opts = opts || {};
    var layer = opts.layer || 'fg', space = opts.space || 'oklab';
    var list = colorable(targets);
    if (!list.length || !stops.length) return;
    var sim = opts.sim || M.sampleSim('bash', 0);
    var pos = [];
    if (opts.by === 'elements') {
      list.forEach(function (el, i) { pos.push(list.length === 1 ? 0 : i / (list.length - 1)); });
    } else {
      var widths = list.map(function (el) { return Math.max(1, Array.from(M.sampleText(el, sim)).length); });
      var total = widths.reduce(function (a, b) { return a + b; }, 0), acc = 0;
      widths.forEach(function (w) { pos.push(total <= 1 ? 0 : (acc + w / 2) / total); acc += w; });
      // Stretch so the first and last elements land exactly on the end stops.
      var lo = pos[0], hi = pos[pos.length - 1];
      pos = pos.map(function (p) { return hi > lo ? (p - lo) / (hi - lo) : 0; });
    }
    list.forEach(function (el, i) { el[layer] = C.gradientAt(stops, pos[i], space); });
  }

  var GRADIENTS = [
    { name: 'Sunset', stops: ['#ff512f', '#f09819', '#dd2476'] },
    { name: 'Ocean', stops: ['#00c6ff', '#0072ff', '#7f5af0'] },
    { name: 'Aurora', stops: ['#43e97b', '#38f9d7', '#a18cd1'] },
    { name: 'Candy', stops: ['#f472b6', '#c084fc', '#60a5fa'] },
    { name: 'Fire', stops: ['#fde047', '#f97316', '#dc2626'] },
    { name: 'Mint', stops: ['#a7f3d0', '#34d399', '#059669'] },
    { name: 'Rainbow', stops: ['#ff5f5f', '#ffaf5f', '#ffff5f', '#5fff87', '#5fafff', '#af87ff'] },
    { name: 'Mono', stops: ['#f4f4f5', '#71717a'] }
  ];

  PG.tools = { snapshot: snapshot, applyHue: applyHue, applyGradient: applyGradient, colorable: colorable, GRADIENTS: GRADIENTS };
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
