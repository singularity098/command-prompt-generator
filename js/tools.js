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

  /* Recolor from the snapshot: rotate hue by `deg`, then scale saturation and brightness by percents. */
  function applyAdjust(targets, snap, deg, sat, layers, light) {
    function adj(hex) { return C.adjustBrightness(C.adjustSaturation(C.shiftHue(hex, deg), sat), light || 0); }
    targets.forEach(function (el) {
      var s = snap[el.id];
      if (!s) return;
      // A layer that is switched off keeps (or goes back to) its snapshot color.
      if (s.fg) el.fg = layers.fg ? adj(s.fg) : s.fg;
      if (s.bg) el.bg = layers.bg ? adj(s.bg) : s.bg;
      if (el.field === 'exit') {
        if (s.failFg) el.props.failFg = layers.fg ? adj(s.failFg) : s.failFg;
        if (s.failBg) el.props.failBg = layers.bg ? adj(s.failBg) : s.failBg;
      }
    });
  }
  function applyHue(targets, snap, deg, layers) { applyAdjust(targets, snap, deg, 0, layers); }

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
    { name: 'Mono', stops: ['#f4f4f5', '#71717a'] },
    { name: 'Vaporwave', stops: ['#ff71ce', '#b967ff', '#01cdfe', '#05ffa1'] },
    { name: 'Galaxy', stops: ['#3a0ca3', '#7209b7', '#f72585', '#ffb3c6'] },
    { name: 'Neon', stops: ['#39ff14', '#00f0ff', '#ff00e6'] },
    { name: 'Cotton Candy', stops: ['#a1c4fd', '#c2b5f7', '#fbc2eb'] },
    { name: 'Peach', stops: ['#ffe5b4', '#ffb38a', '#ff7f6e'] },
    { name: 'Lagoon', stops: ['#43cea2', '#1fa2c4', '#185a9d'] },
    { name: 'Forest', stops: ['#d4fc79', '#56ab2f', '#1e6b52'] },
    { name: 'Arctic', stops: ['#f0f9ff', '#7dd3fc', '#3b82f6', '#1e3a8a'] }
  ];

  PG.tools = { snapshot: snapshot, applyHue: applyHue, applyAdjust: applyAdjust, applyGradient: applyGradient, colorable: colorable, GRADIENTS: GRADIENTS };
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
