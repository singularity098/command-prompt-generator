/* Color utilities: conversions, hue shifting, gradients, terminal quantization. */
(function (PG) {
  'use strict';

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function hexToRgb(hex) {
    if (!hex) return null;
    var h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (c) {
      var s = clamp(Math.round(c), 0, 255).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }

  function normalizeHex(hex) {
    var rgb = hexToRgb(hex);
    return rgb ? rgbToHex(rgb) : null;
  }

  function rgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  function hslToRgb(hsl) {
    var h = ((hsl[0] % 360) + 360) % 360 / 360, s = hsl[1], l = hsl[2];
    if (s === 0) return [l * 255, l * 255, l * 255];
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
  }

  /* Rotate the hue of a color by `deg` degrees (negative moves blue->green, yellow->red). */
  function shiftHue(hex, deg) {
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    var hsl = rgbToHsl(rgb);
    hsl[0] += deg;
    return rgbToHex(hslToRgb(hsl));
  }

  /* --- OKLab, for perceptually smooth gradients --- */
  function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linearToSrgb(c) { var v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return clamp(v, 0, 1) * 255; }

  function rgbToOklab(rgb) {
    var r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }

  function oklabToRgb(lab) {
    var l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    var m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    var s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2], 3);
    return [
      linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    ];
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function mix(hexA, hexB, t, space) {
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    if (space === 'rgb') {
      return rgbToHex([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
    }
    if (space === 'hsl') {
      var ha = rgbToHsl(a), hb = rgbToHsl(b);
      var dh = ((hb[0] - ha[0] + 540) % 360) - 180; // shortest way round
      return rgbToHex(hslToRgb([ha[0] + dh * t, lerp(ha[1], hb[1], t), lerp(ha[2], hb[2], t)]));
    }
    var la = rgbToOklab(a), lb = rgbToOklab(b);
    return rgbToHex(oklabToRgb([lerp(la[0], lb[0], t), lerp(la[1], lb[1], t), lerp(la[2], lb[2], t)]));
  }

  /* Sample a multi-stop gradient at t in [0,1]. */
  function gradientAt(stops, t, space) {
    if (!stops.length) return null;
    if (stops.length === 1) return normalizeHex(stops[0]);
    t = clamp(t, 0, 1);
    var seg = t * (stops.length - 1);
    var i = Math.min(Math.floor(seg), stops.length - 2);
    return mix(stops[i], stops[i + 1], seg - i, space);
  }

  /* --- Terminal palettes --- */
  var ANSI16 = [
    '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
    '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'
  ];
  var ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

  var XTERM256 = (function () {
    var out = ANSI16.slice();
    var lv = [0, 95, 135, 175, 215, 255];
    for (var r = 0; r < 6; r++) for (var g = 0; g < 6; g++) for (var b = 0; b < 6; b++) out.push(rgbToHex([lv[r], lv[g], lv[b]]));
    for (var i = 0; i < 24; i++) { var v = 8 + i * 10; out.push(rgbToHex([v, v, v])); }
    return out;
  })();

  function dist(a, b) {
    var rm = (a[0] + b[0]) / 2;
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
  }

  var cache256 = {}, cache16 = {};
  function nearestIndex(hex, from, to, cache) {
    if (cache[hex] !== undefined) return cache[hex];
    var rgb = hexToRgb(hex), best = from, bd = Infinity;
    for (var i = from; i < to; i++) {
      var d = dist(rgb, hexToRgb(XTERM256[i]));
      if (d < bd) { bd = d; best = i; }
    }
    cache[hex] = best;
    return best;
  }
  /* Skip 0-15 for 256-color output: those depend on the user's terminal theme. */
  function nearest256(hex) { return nearestIndex(hex, 16, 256, cache256); }
  function nearest16(hex) { return nearestIndex(hex, 0, 16, cache16); }

  /* What the color will actually look like in the given color mode. */
  function quantize(hex, mode) {
    if (!hex) return hex;
    if (mode === '256') return XTERM256[nearest256(hex)];
    if (mode === '16') return ANSI16[nearest16(hex)];
    return normalizeHex(hex);
  }

  /* SGR parameter list for a color. layer: 'fg' | 'bg'. */
  function colorSgr(hex, layer, mode) {
    var rgb = hexToRgb(hex);
    if (!rgb) return [];
    var base = layer === 'fg' ? 38 : 48;
    if (mode === '256') return [base, 5, nearest256(hex)];
    if (mode === '16') {
      var i = nearest16(hex);
      if (layer === 'fg') return [i < 8 ? 30 + i : 90 + i - 8];
      return [i < 8 ? 40 + i : 100 + i - 8];
    }
    return [base, 2, rgb[0], rgb[1], rgb[2]];
  }

  /* Readable text color (black/white) on top of a background. */
  function contrastText(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return '#ffffff';
    var y = (0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]));
    return y > 0.35 ? '#111111' : '#ffffff';
  }

  PG.color = {
    clamp: clamp, hexToRgb: hexToRgb, rgbToHex: rgbToHex, normalizeHex: normalizeHex,
    rgbToHsl: rgbToHsl, hslToRgb: hslToRgb, shiftHue: shiftHue, mix: mix, gradientAt: gradientAt,
    ANSI16: ANSI16, ANSI_NAMES: ANSI_NAMES, XTERM256: XTERM256,
    nearest256: nearest256, nearest16: nearest16, quantize: quantize, colorSgr: colorSgr,
    contrastText: contrastText
  };
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
