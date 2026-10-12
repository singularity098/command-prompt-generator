/* Import an existing PS1 (bash) or PROMPT (zsh) value into editable elements. */
(function (PG) {
  'use strict';

  var C = PG.color, M = PG.model;
  var ESC = '\x1b';

  /* ---------- shell-word unquoting ---------- */

  /* Strip a leading `export PS1=` / `PROMPT=` and unquote the shell word that follows. */
  function extractValue(input) {
    var s = String(input).replace(/\r\n?/g, '\n').trim();
    var m = s.match(/^(?:export\s+|typeset\s+|declare\s+(?:-\w+\s+)?|local\s+)?(PS1|PROMPT|PS2|RPROMPT|RPS1)\s*=\s*([\s\S]*)$/);
    if (m) return unquoteWord(m[2]);
    if (/^(\$'|'|")/.test(s)) return unquoteWord(s);
    // A whole snippet or rc file: use its PS1= / PROMPT= line.
    var line = s.match(/^[ \t]*(?:export\s+)?(?:PS1|PROMPT)\s*=\s*(.*)$/m);
    if (line) return unquoteWord(line[1]);
    return s;
  }

  /* Value of a `NAME=...` assignment anywhere in the text, or null. */
  function assignment(s, name) {
    var m = String(s).match(new RegExp('^[ \\t]*(?:export\\s+)?' + name + '\\s*=\\s*(.*)$', 'm'));
    return m ? unquoteWord(m[1]) : null;
  }

  function ansiC(body) {
    return body.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{4}|[0-7]{1,3}|c.|.)/g, function (m, c) {
      switch (c[0]) {
        case 'x': return String.fromCharCode(parseInt(c.slice(1), 16));
        case 'u': return String.fromCharCode(parseInt(c.slice(1), 16));
        case 'e': case 'E': return ESC;
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'a': return '\x07';
        case '\\': return '\\';
        case "'": return "'";
        case '"': return '"';
        default:
          if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
          return m;
      }
    });
  }

  /* Parse one shell word made of '..', "..", $'..' and bare segments. Stops at unquoted whitespace/;/#. */
  function unquoteWord(s) { return readWord(s, 0)[0]; }

  /* Split a simple command line into unquoted words. */
  function shellWords(s) {
    var words = [], i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length || s[i] === ';') break;
      var r = readWord(s, i);
      words.push(r[0]);
      if (r[1] === i) break;
      i = r[1];
    }
    return words;
  }

  /* Read one shell word starting at i. Returns [value, endIndex]. */
  function readWord(s, i) {
    var out = '';
    while (i < s.length) {
      var c = s[i];
      if (c === "'") {
        var j = s.indexOf("'", i + 1);
        if (j < 0) j = s.length;
        out += s.slice(i + 1, j); i = j + 1;
      } else if (c === '$' && s[i + 1] === "'") {
        var k = i + 2, body = '';
        while (k < s.length && s[k] !== "'") { if (s[k] === '\\' && k + 1 < s.length) { body += s[k] + s[k + 1]; k += 2; } else body += s[k++]; }
        out += ansiC(body); i = k + 1;
      } else if (c === '"') {
        var q = i + 1;
        while (q < s.length && s[q] !== '"') {
          if (s[q] === '\\' && q + 1 < s.length && /[$`"\\\n]/.test(s[q + 1])) { if (s[q + 1] !== '\n') out += s[q + 1]; q += 2; }
          else out += s[q++];
        }
        i = q + 1;
      } else if (/[\s;]/.test(c)) {
        break;
      } else if (c === '\\' && i + 1 < s.length) {
        out += s[i + 1]; i += 2;
      } else { out += c; i++; }
    }
    return [out, i];
  }

  /* ---------- style state ---------- */
  function blankStyle() { return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, blink: false, reverse: false, strike: false }; }

  function applySgr(st, params) {
    var p = params === '' ? [0] : params.split(/[;:]/).map(function (x) { return x === '' ? 0 : parseInt(x, 10); });
    for (var i = 0; i < p.length; i++) {
      var n = p[i];
      if (n === 0) Object.assign(st, blankStyle());
      else if (n === 1) st.bold = true;
      else if (n === 2) st.dim = true;
      else if (n === 3) st.italic = true;
      else if (n === 4) st.underline = true;
      else if (n === 5 || n === 6) st.blink = true;
      else if (n === 7) st.reverse = true;
      else if (n === 9) st.strike = true;
      else if (n === 21 || n === 22) { st.bold = false; st.dim = false; }
      else if (n === 23) st.italic = false;
      else if (n === 24) st.underline = false;
      else if (n === 25) st.blink = false;
      else if (n === 27) st.reverse = false;
      else if (n === 29) st.strike = false;
      else if (n >= 30 && n <= 37) st.fg = C.ANSI16[n - 30];
      else if (n >= 90 && n <= 97) st.fg = C.ANSI16[n - 90 + 8];
      else if (n >= 40 && n <= 47) st.bg = C.ANSI16[n - 40];
      else if (n >= 100 && n <= 107) st.bg = C.ANSI16[n - 100 + 8];
      else if (n === 39) st.fg = null;
      else if (n === 49) st.bg = null;
      else if (n === 38 || n === 48) {
        var key = n === 38 ? 'fg' : 'bg';
        if (p[i + 1] === 5) { st[key] = C.XTERM256[p[i + 2] & 255]; i += 2; }
        else if (p[i + 1] === 2) { st[key] = C.rgbToHex([p[i + 2] || 0, p[i + 3] || 0, p[i + 4] || 0]); i += 4; }
      }
    }
  }

  var ZSH_NAMES = { black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, white: 7, default: -1 };
  function zshColor(spec) {
    spec = String(spec).trim().toLowerCase();
    if (spec.charAt(0) === '#') return C.normalizeHex(spec);
    if (/^\d+$/.test(spec)) return C.XTERM256[parseInt(spec, 10) & 255];
    var bright = /^(bright|light)?_?/.exec(spec);
    var name = spec.replace(/^(bright|light)_?/, '');
    if (ZSH_NAMES[name] === undefined) return null;
    if (ZSH_NAMES[name] < 0) return null;
    return C.ANSI16[ZSH_NAMES[name] + (bright && bright[1] ? 8 : 0)];
  }

  /* ---------- element builder ---------- */
  function Builder() {
    this.els = [];
    this.st = blankStyle();
    this.buf = '';
    this.warnings = [];
    this.pendingFail = undefined; // zsh %(?.a.b): fail color for the next text run
    this.fns = {};                // __pg_fN bodies from a Prompt Generator snippet
    this.exitFail = null;         // failure SGR from __pg_exit_sgr, used by the next __pg_exit_text
  }
  Builder.prototype.styled = function (el) {
    var st = this.st;
    Object.keys(st).forEach(function (k) { el[k] = st[k]; });
    return el;
  };
  Builder.prototype.flush = function () {
    if (!this.buf) return;
    if (this.pendingFail !== undefined) {
      this.els.push(this.styled(M.make('field', { field: 'exit', props: { tpl: this.buf, hideOk: false, failFg: this.pendingFail || '#ff5555' } })));
      this.pendingFail = undefined;
    } else {
      var last = this.els[this.els.length - 1];
      var probe = this.styled(M.make('text', { text: '' }));
      if (last && last.kind === 'text' && sameStyle(last, probe)) last.text += this.buf;
      else { probe.text = this.buf; this.els.push(probe); }
    }
    this.buf = '';
  };
  Builder.prototype.text = function (t) { this.buf += t; };
  Builder.prototype.style = function (fn) { this.flush(); fn(this.st); };
  Builder.prototype.field = function (field, props) { this.flush(); this.els.push(this.styled(M.make('field', { field: field, props: props }))); };
  Builder.prototype.newline = function () { this.flush(); this.els.push(M.make('newline')); };
  Builder.prototype.done = function () { this.flush(); return { elements: this.els, warnings: this.warnings }; };

  function sameStyle(a, b) {
    return a.fg === b.fg && a.bg === b.bg && M.STYLE_KEYS.every(function (k) { return a[k] === b[k]; });
  }

  /* Find the matching close paren for s[i] === '(' (honoring nesting and quotes). */
  function matchParen(s, i, open, close) {
    var depth = 0;
    for (var j = i; j < s.length; j++) {
      var c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === "'" ) { var q = s.indexOf("'", j + 1); if (q > 0) { j = q; continue; } }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return j; }
    }
    return -1;
  }

  /* Map a command substitution to a field, or treat it as a style change (tput). */
  function handleCommand(b, cmd) {
    var c = cmd.trim();
    var gen = c.match(/^__pg_(f\d+|rprompt)$/);
    if (gen) { if (gen[1] !== 'rprompt') handleGenerated(b, c); return; }
    var tput = c.match(/^tput\s+(\w+)(?:\s+(\d+))?$/);
    if (tput) {
      var cap = tput[1], n = tput[2] != null ? parseInt(tput[2], 10) : null;
      b.style(function (st) {
        switch (cap) {
          case 'setaf': st.fg = C.XTERM256[n & 255]; break;
          case 'setab': st.bg = C.XTERM256[n & 255]; break;
          case 'bold': st.bold = true; break;
          case 'dim': st.dim = true; break;
          case 'sitm': st.italic = true; break;
          case 'ritm': st.italic = false; break;
          case 'smul': st.underline = true; break;
          case 'rmul': st.underline = false; break;
          case 'rev': case 'smso': st.reverse = true; break;
          case 'blink': st.blink = true; break;
          case 'sgr0': case 'op': Object.assign(st, blankStyle()); break;
        }
      });
      return;
    }
    var gp = c.match(/__git_ps1\s*(?:"([^"]*)"|'([^']*)')?/);
    if (gp) {
      var fmt = gp[1] != null ? gp[1] : gp[2] != null ? gp[2] : ' (%s)';
      var parts = fmt.split('%s');
      b.field('git', { pre: parts[0] || '', suf: parts[1] || '' });
      return;
    }
    if (/git_prompt_info/.test(c)) { b.field('git', { pre: 'git:(', suf: ')' }); return; }
    if (/vcs_info|git\s+(branch|symbolic-ref|rev-parse)/.test(c)) { b.field('git', { pre: '', suf: '' }); return; }
    if (/git\s+(status|diff)/.test(c)) { b.field('gitDirty', { text: '*' }); return; }
    b.field('cmd', { cmd: c, sample: '…' });
  }

  /* Read the __pg_fN() { ... } helpers out of a Prompt Generator snippet (bash or zsh). */
  function generatedFunctions(text) {
    var fns = {}, re = /^(__pg_f\d+)\(\) \{ ([\s\S]*?); \}$/gm, m;
    while ((m = re.exec(String(text)))) {
      var body = m[2];
      // zsh wraps each helper to double any % in its output.
      var z = body.match(/^local o; o=\$\( ([\s\S]*)\n\); print -rn -- "\$\{o\/\/\\%\/%%\}"$/);
      fns[m[1]] = z ? z[1] : body;
    }
    return fns;
  }

  function sgrStyle(params) { var st = blankStyle(); applySgr(st, params || ''); return st; }

  /* Turn one generated helper call back into the field it came from. */
  function handleGenerated(b, name) {
    var body = b.fns[name];
    if (body == null) {
      if (!b.warnedGenerated) {
        b.warnedGenerated = true;
        b.warnings.push('This prompt was made by Prompt Generator. Paste the whole snippet (or the downloaded file), not just $PS1, to restore its exit code, git and other dynamic fields.');
      }
      b.field('cmd', { cmd: name, sample: '' });
      return;
    }
    body = body.trim();
    var w = shellWords(body), m;
    switch (w[0]) {
      case '__pg_exit_sgr':
        b.style(function (st) { applySgr(st, w[1] || ''); });
        b.exitFail = w[2] || '';
        return;
      case '__pg_exit_text': {
        var fail = sgrStyle(b.exitFail);
        b.exitFail = null;
        b.field('exit', { tpl: w[1] || '', hideOk: w[2] === '1', failFg: fail.fg, failBg: fail.bg });
        return;
      }
      case '__pg_git': b.field('git', { pre: w[1] || '', suf: w[2] || '' }); return;
      case '__pg_git_dirty': b.field('gitDirty', { text: w[1] || '' }); return;
      case '__pg_venv': b.field('venv', { pre: w[1] || '', suf: w[2] || '' }); return;
      case '__pg_cwd_trim': b.field('cwdTrim', { depth: parseInt(w[1], 10) || 2 }); return;
      case '__pg_duration':
        b.field('duration', { min: (parseInt(w[1], 10) || 0) / 1000, style: w[2] === 'seconds' ? 'seconds' : 'auto', pre: w[3] || '', suf: w[4] || '' });
        return;
    }
    if ((m = body.match(/^\[\[? -n "\$SSH_CONNECTION\$SSH_TTY" \]\]? && printf '%s' ([\s\S]*); return 0$/))) {
      b.field('ssh', { text: unquoteWord(m[1]) });
      return;
    }
    if ((m = body.match(/^\[\[? -n "\$\{(\w+)\}" \]\]? && printf '%s%s%s' ([\s\S]*) "\$\{\w+\}" ([\s\S]*); return 0$/))) {
      b.field('env', { name: m[1], pre: unquoteWord(m[2]), suf: unquoteWord(m[3]), sample: m[1].toLowerCase() });
      return;
    }
    if ((m = body.match(/^\{ ([\s\S]*)\n\} 2>\/dev\/null \| tr -d '\\n'$/))) {
      b.field('cmd', { cmd: m[1], sample: '…' });
      return;
    }
    b.field('cmd', { cmd: body, sample: '…' });
  }

  var VAR_FIELDS = { PWD: 'cwdAbs', USER: 'user', LOGNAME: 'user', HOSTNAME: 'host', HOST: 'host', VIRTUAL_ENV: 'venv', CONDA_DEFAULT_ENV: 'venv', BASH_VERSION: 'shellVer', ZSH_VERSION: 'shellVer' };

  function handleVar(b, name) {
    if (name === '?') { b.field('exit', { tpl: '{code}', hideOk: false, failFg: '#ff5555' }); return; }
    if (VAR_FIELDS[name]) {
      var f = VAR_FIELDS[name];
      b.field(f, f === 'venv' ? { pre: '', suf: '' } : undefined);
      return;
    }
    b.field('env', { name: name, pre: '', suf: '', sample: name.toLowerCase() });
  }

  var OH_MY_ZSH_COLOR = /^\$\{?(fg|fg_bold|fg_no_bold|bg|bg_bold)\[(\w+)\]\}?/;

  /* Handle `$`-forms common to bash and zsh. Returns the new index, or -1 if not handled. */
  function parseDollar(b, s, i) {
    var rest = s.slice(i);
    var omz = rest.match(OH_MY_ZSH_COLOR);
    if (omz) {
      b.style(function (st) {
        var col = zshColor(omz[2]);
        if (omz[1].indexOf('bg') === 0) st.bg = col; else st.fg = col;
        if (omz[1] === 'fg_bold' || omz[1] === 'bg_bold') st.bold = true;
        if (omz[1] === 'fg_no_bold') st.bold = false;
      });
      return i + omz[0].length;
    }
    var rc = rest.match(/^\$\{?reset_color\}?/);
    if (rc) { b.style(function (st) { Object.assign(st, blankStyle()); }); return i + rc[0].length; }
    if (rest[1] === '(' && rest[2] !== '(') {
      var end = matchParen(s, i + 1, '(', ')');
      if (end < 0) return -1;
      handleCommand(b, s.slice(i + 2, end));
      return end + 1;
    }
    if (rest[1] === '{') {
      var close = matchParen(s, i + 1, '{', '}');
      if (close < 0) return -1;
      var inner = s.slice(i + 2, close);
      var alt = inner.match(/^(\w+):?\+(.*)$/);
      if (alt) {
        // ${VAR:+(...$VAR...)}: show the variable wrapped in the surrounding text when it is set.
        var ref = alt[2].split(new RegExp('\\$\\{?' + alt[1] + '\\}?'));
        var f = VAR_FIELDS[alt[1]] === 'venv' ? 'venv' : 'env';
        b.field(f, f === 'venv' ? { pre: ref[0] || '', suf: ref[1] || '' } : { name: alt[1], pre: ref[0] || '', suf: ref.length > 1 ? ref[1] : '', sample: '' });
        return close + 1;
      }
      var name = inner.replace(/^[#!]/, '').match(/^(\w+|\?)/);
      if (name) handleVar(b, name[1]);
      return close + 1;
    }
    var simple = rest.match(/^\$(\w+|\?)/);
    if (simple) { handleVar(b, simple[1]); return i + simple[0].length; }
    return -1;
  }

  /* Raw escape sequences (after $'..' decoding or a literal ESC). */
  function parseEsc(b, s, i) {
    if (s[i + 1] === '[') {
      var m = s.slice(i + 2).match(/^([0-9;:]*)([A-Za-z])/);
      if (m) {
        if (m[2] === 'm') b.style(function (st) { applySgr(st, m[1]); });
        return i + 2 + m[0].length;
      }
    }
    if (s[i + 1] === ']') { // OSC (e.g. window title): skip to BEL or ST
      var bel = s.indexOf('\x07', i), st = s.indexOf(ESC + '\\', i + 1);
      var e = [bel, st].filter(function (x) { return x >= 0; }).sort(function (x, y) { return x - y; })[0];
      if (e === undefined) return s.length;
      return e === st ? st + 2 : bel + 1;
    }
    return i + 1;
  }

  /* ---------- bash ---------- */
  var BASH_SIMPLE = { u: 'user', h: 'host', H: 'fqdn', w: 'cwd', W: 'cwdBase', j: 'jobs', l: 'tty', s: 'shell', v: 'shellVer', V: 'shellVer', '!': 'history', '#': 'history', $: 'promptChar' };
  var BASH_TIME = { t: '%H:%M:%S', T: '%I:%M:%S', '@': '%I:%M %p', A: '%H:%M', d: '%a %b %d' };

  function parseBash(s, fns) {
    var b = new Builder(), i = 0;
    b.fns = fns || {};
    while (i < s.length) {
      var c = s[i];
      if (c === '\\' && i + 1 < s.length) {
        var n = s[i + 1];
        // Bash decodes the prompt (\\ -> \), then expansion unescapes \$ \` \\. So four backslashes
        // are one backslash, two backslashes + $ a dollar, two + ` a backtick (check: echo "${PS1@P}").
        if (s.startsWith('\\\\\\\\', i)) { b.text('\\'); i += 4; continue; }
        if (s.startsWith('\\\\$', i) || s.startsWith('\\\\`', i)) { b.text(s[i + 2]); i += 3; continue; }
        if (BASH_SIMPLE[n]) { b.field(BASH_SIMPLE[n]); i += 2; continue; }
        if (BASH_TIME[n]) { b.field('time', { fmt: BASH_TIME[n] }); i += 2; continue; }
        if (n === 'D' && s[i + 2] === '{') {
          var close = s.indexOf('}', i);
          var fmt = s.slice(i + 3, close < 0 ? s.length : close);
          b.field('time', { fmt: fmt || '%X' });
          i = close < 0 ? s.length : close + 1; continue;
        }
        if (n === 'n') { b.newline(); i += 2; continue; }
        if (n === '[' || n === ']' || n === 'a' || n === 'r') { i += 2; continue; }
        if (n === 'e' || n === 'E') { s = s.slice(0, i) + ESC + s.slice(i + 2); continue; }
        var oct = s.slice(i + 1).match(/^0?[0-7]{2,3}/);
        if (oct) { s = s.slice(0, i) + String.fromCharCode(parseInt(oct[0], 8)) + s.slice(i + 1 + oct[0].length); continue; }
        var hex = s.slice(i + 1).match(/^x([0-9a-fA-F]{1,2})/);
        if (hex) { s = s.slice(0, i) + String.fromCharCode(parseInt(hex[1], 16)) + s.slice(i + 1 + hex[0].length); continue; }
        b.text(n); i += 2; continue;
      }
      if (c === ESC) { i = parseEsc(b, s, i); continue; }
      if (c === '$') { var r = parseDollar(b, s, i); if (r >= 0) { i = r; continue; } }
      if (c === '`') {
        var e = s.indexOf('`', i + 1);
        if (e > 0) { handleCommand(b, s.slice(i + 1, e)); i = e + 1; continue; }
      }
      if (c === '\n') { b.newline(); i++; continue; }
      b.text(c); i++;
    }
    return b.done();
  }

  /* ---------- zsh ---------- */
  var ZSH_SIMPLE = { n: 'user', m: 'host', M: 'fqdn', '~': 'cwd', '/': 'cwdAbs', d: 'cwdAbs', c: 'cwdBase', '.': 'cwdBase', C: 'cwdBase', j: 'jobs', '!': 'history', h: 'history', l: 'tty', y: 'tty', '#': 'promptChar' };
  var ZSH_TIME = { '*': '%H:%M:%S', T: '%H:%M', t: '%I:%M %p', '@': '%I:%M %p', D: '%y-%m-%d', w: '%a %e', W: '%m/%d/%y' };

  /* Split the body of a %(x.a.b) ternary. Returns {cond, a, b, end}. */
  function splitTernary(s, i) {
    // s[i] === '(' just after '%'
    var j = i + 1, cond = '';
    while (j < s.length && /[0-9\-]/.test(s[j])) cond += s[j++];
    cond += s[j++];
    var sep = s[j++];
    var parts = [''], depth = 0;
    for (; j < s.length; j++) {
      var c = s[j];
      if (c === '%' && s[j + 1] === '(') { depth++; parts[parts.length - 1] += '%('; j++; continue; }
      if (c === '%' && j + 1 < s.length) { parts[parts.length - 1] += c + s[j + 1]; j++; continue; }
      if (c === ')' && depth > 0) { depth--; parts[parts.length - 1] += c; continue; }
      if (c === ')' && depth === 0) break;
      if (c === sep && depth === 0 && parts.length < 2) { parts.push(''); continue; }
      parts[parts.length - 1] += c;
    }
    return { cond: cond, a: parts[0], b: parts[1] || '', end: j + 1 };
  }

  /* Flatten a short zsh snippet to {style changes applied, text} using a scratch builder. */
  function probeZsh(src, baseStyle) {
    var b = new Builder();
    Object.assign(b.st, baseStyle);
    parseZshInto(b, src);
    b.flush();
    var text = b.els.map(function (e) { return e.kind === 'text' ? e.text : e.kind === 'field' && e.field === 'exit' ? '{code}' : e.kind === 'field' ? '\u0000' : '\n'; }).join('');
    return { style: b.st, text: text, els: b.els };
  }

  function parseZshInto(b, s) {
    var i = 0;
    while (i < s.length) {
      var c = s[i];
      if (c === '%' && i + 1 < s.length) {
        var rest = s.slice(i + 1);
        var num = rest.match(/^(-?\d+)([~\/dcC.])/);
        if (num) {
          var depth = Math.abs(parseInt(num[1], 10));
          if (depth <= 1) b.field('cwdBase'); else b.field('cwdTrim', { depth: depth });
          i += 1 + num[0].length; continue;
        }
        var n = s[i + 1];
        if (n === '(') {
          var t = splitTernary(s, i + 1);
          handleTernary(b, t);
          i = t.end; continue;
        }
        if (n === 'D' && s[i + 2] === '{') {
          var close = s.indexOf('}', i);
          b.field('time', { fmt: s.slice(i + 3, close < 0 ? s.length : close) || '%H:%M:%S' });
          i = close < 0 ? s.length : close + 1; continue;
        }
        if ((n === 'F' || n === 'K') ) {
          var spec = null, adv = 2;
          if (s[i + 2] === '{') { var cl = s.indexOf('}', i); spec = s.slice(i + 3, cl); adv = cl - i + 1; }
          else { var dg = rest.slice(1).match(/^\d+/); if (dg) { spec = dg[0]; adv = 2 + dg[0].length; } }
          b.style(function (st) { st[n === 'F' ? 'fg' : 'bg'] = spec != null ? zshColor(spec) : null; });
          i += adv; continue;
        }
        if (n === 'f') { b.style(function (st) { st.fg = null; }); i += 2; continue; }
        if (n === 'k') { b.style(function (st) { st.bg = null; }); i += 2; continue; }
        if (n === 'B') { b.style(function (st) { st.bold = true; }); i += 2; continue; }
        if (n === 'b') { b.style(function (st) { st.bold = false; }); i += 2; continue; }
        if (n === 'U') { b.style(function (st) { st.underline = true; }); i += 2; continue; }
        if (n === 'u') { b.style(function (st) { st.underline = false; }); i += 2; continue; }
        if (n === 'S') { b.style(function (st) { st.reverse = true; }); i += 2; continue; }
        if (n === 's') { b.style(function (st) { st.reverse = false; }); i += 2; continue; }
        if (n === '{' || n === '}') { i += 2; continue; }
        if (n === 'E') { i += 2; continue; }
        if (n === '?') { b.field('exit', { tpl: '{code}', hideOk: false, failFg: '#ff5555' }); i += 2; continue; }
        if (ZSH_SIMPLE[n]) { b.field(ZSH_SIMPLE[n]); i += 2; continue; }
        if (ZSH_TIME[n]) { b.field('time', { fmt: ZSH_TIME[n] }); i += 2; continue; }
        if (n === '%') { b.text('%'); i += 2; continue; }
        if (n === ')') { b.text(')'); i += 2; continue; }
        b.warnings.push('Unknown zsh escape %' + n);
        i += 2; continue;
      }
      if (c === ESC) { i = parseEsc(b, s, i); continue; }
      if (c === '$') { var r = parseDollar(b, s, i); if (r >= 0) { i = r; continue; } }
      if (c === '\\' && i + 1 < s.length && /[$`\\]/.test(s[i + 1])) { b.text(s[i + 1]); i += 2; continue; }
      if (c === '`') {
        var e = s.indexOf('`', i + 1);
        if (e > 0) { handleCommand(b, s.slice(i + 1, e)); i = e + 1; continue; }
      }
      if (c === '\n') { b.newline(); i++; continue; }
      b.text(c); i++;
    }
  }

  function handleTernary(b, t) {
    var cond = t.cond;
    if (cond === '!') {
      // root vs normal: %(!.#.$) is the prompt character; otherwise show the non-root branch.
      if (/^#$/.test(t.a) && /^(\$|%%|>|\\\$)$/.test(t.b)) { b.field('promptChar'); return; }
      parseZshInto(b, t.b);
      return;
    }
    if (cond === '?') {
      b.flush();
      var base = Object.assign({}, b.st);
      var pa = probeZsh(t.a, base), pb = probeZsh(t.b, base);
      if (pa.text === pb.text && pa.text.indexOf('\u0000') < 0) {
        // Same text, different look: success style now, failure color applies to the next text run.
        Object.assign(b.st, pa.style);
        b.pendingFail = pb.style.fg || null;
        if (pa.text) { b.text(pa.text); b.flush(); }
        return;
      }
      if (!pa.text && pb.text) {
        Object.assign(b.st, pb.style);
        b.els.push(b.styled(M.make('field', { field: 'exit', props: { tpl: pb.text.replace(/\u0000/g, ''), hideOk: true, failFg: pb.style.fg || '#ff5555' } })));
        Object.assign(b.st, base);
        return;
      }
      parseZshInto(b, t.a);
      return;
    }
    // Other conditions (path depth, jobs, ...): keep the "true" branch.
    parseZshInto(b, t.a);
  }

  function parseZsh(s, fns) {
    var b = new Builder();
    b.fns = fns || {};
    parseZshInto(b, s);
    return b.done();
  }

  function detect(s) {
    var bash = (s.match(/\\[uhHwWtTdAnj$@!sv\[\]]|\\D\{/g) || []).length;
    var zsh = (s.match(/%[nmM~#\/dcCjBbUuSs*Tt@?fk]|%[FK]\{|%D\{|%\d+[~\/dcC]|%\(|\$fg\[|\$fg_bold\[|\$reset_color/g) || []).length;
    return zsh > bash ? 'zsh' : 'bash';
  }

  /* Public entry point. syntax: 'auto' | 'bash' | 'zsh'. */
  /* Rebuild elements from a `# prompt-generator-design: {...}` comment. */
  function fromDesign(list) {
    return (Array.isArray(list) ? list : []).map(function (d) {
      if (!d || (d.kind !== 'text' && d.kind !== 'field' && d.kind !== 'newline')) return null;
      if (d.kind === 'field' && !M.FIELDS[d.field]) return null;
      var opts = { text: d.text, field: d.field, props: d.props || {}, fg: d.fg || null, bg: d.bg || null };
      M.STYLE_KEYS.forEach(function (k) { opts[k] = !!d[k]; });
      return M.make(d.kind, opts);
    }).filter(Boolean);
  }

  function importPrompt(input, syntax) {
    var text = String(input);
    var design = text.match(/^[ \t]*#\s*prompt-generator-design:\s*(\{.*\})\s*$/m);
    if (design) {
      try {
        var d = JSON.parse(design[1]);
        return { elements: fromDesign(d.left), right: fromDesign(d.right), warnings: [], syntax: 'design', exact: true };
      } catch (e) { /* fall through to parsing the code */ }
    }
    var fns = generatedFunctions(text);
    var value = extractValue(input);
    var kind = !syntax || syntax === 'auto' ? detect(value) : syntax;
    if (kind === 'auto' || (!syntax || syntax === 'auto')) {
      if (/^[ \t]*PROMPT=\$'/m.test(text) || /^setopt PROMPT_SUBST$/m.test(text)) kind = 'zsh';
    }
    var res = kind === 'zsh' ? parseZsh(value, fns) : parseBash(value, fns);
    res.syntax = kind;
    // A whole Prompt Generator snippet also carries the right prompt.
    var rvalue = kind === 'zsh' ? assignment(text, 'RPROMPT') : assignment(text, '__pg_rps1');
    if (rvalue != null && /^[ \t]*(?:PS1|PROMPT)\s*=/m.test(text)) {
      var r = kind === 'zsh' ? parseZsh(rvalue, fns) : parseBash(rvalue, fns);
      res.right = r.elements.filter(function (e) { return e.kind !== 'newline'; });
      res.warnings = res.warnings.concat(r.warnings);
    }
    if (/^\s*(?:export\s+|typeset\s+)?(RPROMPT|RPS1)\s*=/.test(String(input))) res.target = 'right';
    if (!res.elements.length) res.warnings.push('Nothing to import.');
    return res;
  }

  PG.importer = { importPrompt: importPrompt, extractValue: extractValue, detect: detect, applySgr: applySgr };
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
