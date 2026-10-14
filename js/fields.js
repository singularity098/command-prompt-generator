/* Prompt element model, field catalogue, palette contents and preview sample values. */
(function (PG) {
  'use strict';

  var STYLE_KEYS = ['bold', 'dim', 'italic', 'underline', 'blink', 'reverse', 'strike'];
  var nextId = 1;

  function uid() { return 'e' + (nextId++) + Math.random().toString(36).slice(2, 6); }

  /* Create a prompt element. kind: 'text' | 'field' | 'newline'. */
  function make(kind, opts) {
    opts = opts || {};
    var el = { id: uid(), kind: kind, fg: null, bg: null };
    STYLE_KEYS.forEach(function (k) { el[k] = false; });
    if (kind === 'text') el.text = opts.text != null ? String(opts.text) : '';
    if (kind === 'field') {
      el.field = opts.field;
      var def = FIELDS[opts.field];
      el.props = Object.assign({}, def && def.defaults ? JSON.parse(JSON.stringify(def.defaults)) : {}, opts.props || {});
    }
    Object.keys(opts).forEach(function (k) {
      if (k === 'fg' || k === 'bg') el[k] = opts[k] ? PG.color.normalizeHex(opts[k]) : null;
      else if (STYLE_KEYS.indexOf(k) >= 0) el[k] = !!opts[k];
    });
    return el;
  }

  function clone(el) {
    var c = JSON.parse(JSON.stringify(el));
    c.id = uid();
    return c;
  }

  /* Re-issue ids (used when loading presets/saved state so ids are unique). */
  function reid(list) { return list.map(function (el) { var c = JSON.parse(JSON.stringify(el)); c.id = uid(); return c; }); }

  /* ---------- strftime (for preview) ---------- */
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function pad(n, w, c) { n = String(n); while (n.length < w) n = (c || '0') + n; return n; }

  function strftime(fmt, d) {
    d = d || new Date();
    return fmt.replace(/%([a-zA-Z%])/g, function (m, c) {
      var h = d.getHours(), h12 = h % 12 || 12;
      switch (c) {
        case 'a': return DAYS[d.getDay()].slice(0, 3);
        case 'A': return DAYS[d.getDay()];
        case 'b': case 'h': return MONTHS[d.getMonth()].slice(0, 3);
        case 'B': return MONTHS[d.getMonth()];
        case 'd': return pad(d.getDate(), 2);
        case 'e': return pad(d.getDate(), 2, ' ');
        case 'H': return pad(h, 2);
        case 'k': return pad(h, 2, ' ');
        case 'I': return pad(h12, 2);
        case 'l': return pad(h12, 2, ' ');
        case 'M': return pad(d.getMinutes(), 2);
        case 'S': return pad(d.getSeconds(), 2);
        case 'p': return h < 12 ? 'AM' : 'PM';
        case 'P': return h < 12 ? 'am' : 'pm';
        case 'Y': return String(d.getFullYear());
        case 'y': return pad(d.getFullYear() % 100, 2);
        case 'm': return pad(d.getMonth() + 1, 2);
        case 'j': {
          var start = new Date(d.getFullYear(), 0, 0);
          return pad(Math.floor((d - start) / 864e5), 3);
        }
        case 's': return String(Math.floor(d.getTime() / 1000));
        case 'u': return String(d.getDay() || 7);
        case 'w': return String(d.getDay());
        case 'Z': {
          var tz = '';
          try { tz = d.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop(); } catch (e) { /* ignore */ }
          return tz;
        }
        case 'z': {
          var o = -d.getTimezoneOffset(), sign = o >= 0 ? '+' : '-';
          o = Math.abs(o);
          return sign + pad(Math.floor(o / 60), 2) + pad(o % 60, 2);
        }
        case 'T': return strftime('%H:%M:%S', d);
        case 'R': return strftime('%H:%M', d);
        case 'D': return strftime('%m/%d/%y', d);
        case 'F': return strftime('%Y-%m-%d', d);
        case 'r': return strftime('%I:%M:%S %p', d);
        case 'n': return '\n';
        case 't': return '\t';
        case '%': return '%';
        default: return m;
      }
    });
  }

  var TIME_FORMATS = [
    { fmt: '%H:%M:%S', label: '24-hour with seconds' },
    { fmt: '%H:%M', label: '24-hour' },
    { fmt: '%I:%M:%S %p', label: '12-hour with seconds' },
    { fmt: '%I:%M %p', label: '12-hour' },
    { fmt: '%Y-%m-%d', label: 'ISO date' },
    { fmt: '%Y-%m-%d %H:%M:%S', label: 'ISO date & time' },
    { fmt: '%Y-%m-%dT%H:%M:%S', label: 'ISO 8601' },
    { fmt: '%a %b %d', label: 'Weekday month day (bash \\d)' },
    { fmt: '%a %H:%M', label: 'Weekday + time' },
    { fmt: '%b %d %H:%M', label: 'Month day + time' },
    { fmt: '%m/%d/%Y', label: 'US date' },
    { fmt: '%d/%m/%Y', label: 'European date' },
    { fmt: '%d.%m.%Y', label: 'Dotted date' },
    { fmt: '%A', label: 'Weekday name' },
    { fmt: '%s', label: 'Unix epoch' }
  ];

  /* ---------- Preview sample environment ---------- */
  var DEFAULT_SIM = {
    user: 'alice', host: 'devbox', domain: 'example.lan',
    home: '/home/alice', cwd: '/home/alice/code/command-prompt-gen',
    inGit: true, branch: 'main', dirty: true,
    venv: false, venvName: 'venv', ssh: false, root: false,
    jobs: 1, history: 1042, tty: 'pts/0', duration: 4213
  };
  var SHELL_INFO = {
    bash: { name: 'bash', version: '5.2' },
    zsh: { name: 'zsh', version: '5.9' },
    fish: { name: 'fish', version: '3.7.1' },
    pwsh: { name: 'pwsh', version: '7.4.5' }
  };

  function tildePath(sim) {
    if (sim.cwd === sim.home) return '~';
    if (sim.cwd.indexOf(sim.home + '/') === 0) return '~' + sim.cwd.slice(sim.home.length);
    return sim.cwd;
  }

  /* ---------- Field catalogue ---------- */
  var FIELDS = {
    user: { label: 'Username', sample: function (s) { return s.root ? 'root' : s.user; } },
    host: { label: 'Hostname (short)', sample: function (s) { return s.host; } },
    fqdn: { label: 'Hostname (full)', sample: function (s) { return s.host + '.' + s.domain; } },
    promptChar: { label: 'Prompt char ($ / #)', sample: function (s) { return s.root ? '#' : '$'; } },
    ssh: {
      label: 'SSH indicator', defaults: { text: 'ssh ' },
      desc: 'Shown only inside an SSH session.',
      conditional: true,
      sample: function (s, el) { return s.ssh ? el.props.text : ''; }
    },
    cwd: { label: 'Directory (~ path)', sample: tildePath },
    cwdBase: {
      label: 'Directory (name only)',
      sample: function (s) { var p = tildePath(s); return p === '~' || p === '/' ? p : p.split('/').pop(); }
    },
    cwdAbs: { label: 'Directory (absolute)', sample: function (s) { return s.cwd; } },
    cwdTrim: {
      label: 'Directory (last N)', defaults: { depth: 2 },
      desc: 'Shows only the last N directories, e.g. …/code/project.',
      sample: function (s, el) {
        var p = tildePath(s), parts = p.split('/'), n = Math.max(1, el.props.depth | 0);
        return parts.length > n + 1 ? '…/' + parts.slice(-n).join('/') : p;
      }
    },
    time: {
      label: 'Date / time', defaults: { fmt: '%H:%M:%S' },
      sample: function (s, el) { return strftime(el.props.fmt || '%H:%M:%S', s.now); }
    },
    exit: {
      label: 'Exit code', defaults: { tpl: '{code}', hideOk: false, failFg: '#ff5555', failBg: null },
      desc: 'Colored with the element colors on success and the failure colors on a non-zero exit.',
      conditional: true,
      sample: function (s, el) {
        if (el.props.hideOk && !s.status) return '';
        return String(el.props.tpl).split('{code}').join(String(s.status));
      }
    },
    duration: {
      label: 'Command duration', defaults: { min: 2, style: 'auto', pre: 'took ', suf: ' ' }, conditional: true,
      desc: 'How long the last command ran. Hidden when it was quicker than the threshold.',
      sample: function (s, el) {
        var ms = s.duration || 0, min = Math.round((parseFloat(el.props.min) || 0) * 1000);
        return ms >= min ? el.props.pre + fmtDuration(ms, el.props.style) + el.props.suf : '';
      }
    },
    jobs: { label: 'Background jobs', sample: function (s) { return String(s.jobs); } },
    history: { label: 'History number', sample: function (s) { return String(s.history); } },
    git: {
      label: 'Git branch', defaults: { pre: '', suf: '' }, conditional: true,
      sample: function (s, el) { return s.inGit ? el.props.pre + s.branch + el.props.suf : ''; }
    },
    gitDirty: {
      label: 'Git dirty marker', defaults: { text: '*' }, conditional: true,
      desc: 'Shown only when the work tree has uncommitted changes.',
      sample: function (s, el) { return s.inGit && s.dirty ? el.props.text : ''; }
    },
    venv: {
      label: 'Python venv / conda', defaults: { pre: '(', suf: ') ' }, conditional: true,
      sample: function (s, el) { return s.venv ? el.props.pre + s.venvName + el.props.suf : ''; }
    },
    shell: { label: 'Shell name', sample: function (s) { return SHELL_INFO[s.shell].name; } },
    shellVer: { label: 'Shell version', sample: function (s) { return SHELL_INFO[s.shell].version; } },
    tty: { label: 'Terminal device', sample: function (s) { return s.shell === 'pwsh' ? '' : s.tty; } },
    env: {
      label: 'Environment variable', defaults: { name: 'AWS_PROFILE', pre: '', suf: '', sample: 'prod' }, conditional: true,
      desc: 'Shown only when the variable is set.',
      sample: function (s, el) { return el.props.sample ? el.props.pre + el.props.sample + el.props.suf : ''; }
    },
    cmd: {
      label: 'Command output', defaults: { cmd: 'echo hi', sample: 'hi' },
      desc: 'Runs a command each time the prompt is drawn. Keep it fast.',
      sample: function (s, el) { return el.props.sample || ''; }
    }
  };

  /* Same formatting as the generated __pg_fmt_dur helpers. */
  function fmtDuration(ms, style) {
    ms = Math.max(0, Math.floor(ms));
    var f = Math.floor;
    if (style === 'seconds') return f(ms / 1000) + 's';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return f(ms / 1000) + '.' + f(ms % 1000 / 100) + 's';
    if (ms < 3600000) return f(ms / 60000) + 'm ' + f(ms % 60000 / 1000) + 's';
    return f(ms / 3600000) + 'h ' + f(ms % 3600000 / 60000) + 'm';
  }

  /* Text the element shows in the preview for a given simulated environment. */
  function sampleText(el, sim) {
    if (el.kind === 'text') return el.text;
    if (el.kind === 'newline') return '\n';
    var def = FIELDS[el.field];
    return def ? def.sample(sim, el) : '';
  }

  function sampleSim(shell, status, duration) {
    var s = Object.assign({}, DEFAULT_SIM);
    s.shell = shell || 'bash';
    s.status = status || 0;
    if (duration != null) s.duration = duration;
    s.now = new Date();
    return s;
  }

  /* ---------- Palette ---------- */
  function F(field, props) { return function () { return make('field', { field: field, props: props }); }; }
  function T(text) { return function () { return make('text', { text: text }); }; }

  var PALETTE = [
    {
      name: 'Basics', items: [
        { label: 'Text', make: T('text'), hint: 'Free text' },
        { label: 'Space', make: T(' '), hint: 'A single space' },
        { label: 'Newline', make: function () { return make('newline'); }, hint: 'Start a new line (multi-line prompts)' }
      ]
    },
    {
      name: 'Identity', items: [
        { label: 'Username', make: F('user') },
        { label: 'Host', make: F('host') },
        { label: 'Host (FQDN)', make: F('fqdn') },
        { label: '$ / #', make: F('promptChar'), hint: '# when root, $ otherwise' },
        { label: 'SSH indicator', make: F('ssh') }
      ]
    },
    {
      name: 'Location', items: [
        { label: '~/path', make: F('cwd') },
        { label: 'Dir name', make: F('cwdBase') },
        { label: '/abs/path', make: F('cwdAbs') },
        { label: '…/last/2', make: F('cwdTrim') }
      ]
    },
    {
      name: 'Time', items: TIME_FORMATS.slice(0, 12).map(function (t) {
        return { label: strftime(t.fmt, new Date(2026, 0, 5, 14, 5, 9)), make: F('time', { fmt: t.fmt }), hint: t.label + ' — ' + t.fmt };
      })
    },
    {
      name: 'Status', items: [
        { label: 'Exit code', make: F('exit') },
        { label: '✘ code (fail only)', make: F('exit', { tpl: '✘ {code} ', hideOk: true }) },
        { label: 'Duration', make: F('duration'), hint: 'How long the last command took' },
        { label: 'Jobs', make: F('jobs') },
        { label: 'History #', make: F('history') }
      ]
    },
    {
      name: 'Development', items: [
        { label: 'Git branch', make: F('git', { pre: ' (', suf: ')' }) },
        { label: 'Git dirty', make: F('gitDirty') },
        { label: 'Python venv', make: F('venv') },
        { label: 'Node version', make: F('cmd', { cmd: 'node -v', sample: 'v22.4.0' }) },
        { label: 'Kube context', make: F('cmd', { cmd: 'kubectl config current-context', sample: 'minikube' }) },
        { label: 'AWS profile', make: F('env', { name: 'AWS_PROFILE', pre: 'aws:', suf: ' ', sample: 'prod' }) }
      ]
    },
    {
      name: 'System', items: [
        { label: 'Shell', make: F('shell') },
        { label: 'Shell version', make: F('shellVer') },
        { label: 'TTY', make: F('tty') },
        { label: 'Env variable', make: F('env', { name: 'HOSTTYPE', sample: 'x86_64' }) },
        { label: 'Command', make: F('cmd') }
      ]
    }
  ];

  var SYMBOLS = [
    { name: 'Prompt', chars: '❯ ❮ › ‹ » « ➜ → ⇒ ▶ ▸ ⟩ λ ∴ ⚡ ✦ ★ ◆ ● • · ✔ ✘ ✓ ✗ ⎇ ± ∞ ♥ ☿ ㉿'.split(' ') },
    { name: 'Punctuation', chars: '[ ] ( ) { } < > | : ; @ # $ % ~ - _ / \\ = + , . ! ? *'.split(' ') },
    { name: 'Box drawing', chars: '┌ └ ├ ┐ ┘ ┤ ─ │ ╭ ╰ ╮ ╯ ═ ║ ╔ ╚ ┬ ┴ ━ ┃ ▌ ▐ █ ░'.split(' ') },
    {
      name: 'Powerline / Nerd Font', note: 'Needs a Powerline or Nerd Font in your terminal.',
      chars: ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
    },
    { name: 'Emoji', chars: '🐍 🚀 🔥 💻 📁 🕒 ✨ 🌿 🐧 ⏱ 🐳 ☁ ⭐ 💡'.split(' ') }
  ];

  PG.model = {
    STYLE_KEYS: STYLE_KEYS, make: make, clone: clone, reid: reid, uid: uid,
    FIELDS: FIELDS, PALETTE: PALETTE, SYMBOLS: SYMBOLS, TIME_FORMATS: TIME_FORMATS,
    DEFAULT_SIM: DEFAULT_SIM, SHELL_INFO: SHELL_INFO,
    strftime: strftime, fmtDuration: fmtDuration, sampleText: sampleText, sampleSim: sampleSim, tildePath: tildePath
  };
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
