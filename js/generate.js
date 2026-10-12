/* Shell code generators: turn lists of prompt elements into bash / zsh / fish / PowerShell code. */
(function (PG) {
  'use strict';

  var C = PG.color;

  var SHELLS = {
    bash: { label: 'Bash', file: '~/.bashrc', ext: 'bash' },
    zsh: { label: 'Zsh', file: '~/.zshrc', ext: 'zsh' },
    fish: { label: 'Fish', file: '~/.config/fish/functions/fish_prompt.fish', ext: 'fish' },
    pwsh: { label: 'PowerShell', file: '$PROFILE', ext: 'ps1' }
  };

  /* SGR parameters for an element's look. colors may be overridden (exit-code failure state). */
  function sgrParams(el, mode, fg, bg) {
    var p = [0];
    if (el.bold) p.push(1);
    if (el.dim) p.push(2);
    if (el.italic) p.push(3);
    if (el.underline) p.push(4);
    if (el.blink) p.push(5);
    if (el.reverse) p.push(7);
    if (el.strike) p.push(9);
    fg = fg === undefined ? el.fg : fg;
    bg = bg === undefined ? el.bg : bg;
    if (fg) p = p.concat(C.colorSgr(fg, 'fg', mode));
    if (bg) p = p.concat(C.colorSgr(bg, 'bg', mode));
    return p.join(';');
  }

  function failParams(el, mode) {
    return sgrParams(el, mode, el.props.failFg || el.fg, el.props.failBg || el.bg);
  }

  /* ---------- quoting helpers ---------- */
  function shSingle(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "'\\''") + "'"; }
  function fishSingle(s) { return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
  function psSingle(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; }
  function sanitizeFmt(f) { return String(f || '%H:%M:%S').replace(/[{}\n]/g, ''); }
  function envName(n) { return String(n || '').replace(/[^A-Za-z0-9_]/g, '') || 'HOME'; }
  function durMinMs(p) { return Math.max(0, Math.round((parseFloat(p.min) || 0) * 1000)); }
  function durStyle(p) { return p.style === 'seconds' ? 'seconds' : 'auto'; }

  function uses(lists, field) {
    return lists.some(function (l) { return l.some(function (e) { return e.field === field; }); });
  }

  /* ---------- helpers shared by bash & zsh (POSIX-ish syntax) ---------- */
  var SH_HELPERS = {
    git: '__pg_git() {\n  local b\n  b=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null) || return 0\n  printf \'%s%s%s\' "$1" "$b" "$2"\n}',
    gitDirty: '__pg_git_dirty() {\n  [ -n "$(git status --porcelain --ignore-submodules 2>/dev/null | head -c1)" ] && printf \'%s\' "$1"\n  return 0\n}',
    venv: '__pg_venv() {\n  local v=${VIRTUAL_ENV_PROMPT:-${VIRTUAL_ENV##*/}}\n  v=${v:-$CONDA_DEFAULT_ENV}\n  v=${v#\\(}; v=${v%\\) }; v=${v%\\)}\n  [ -n "$v" ] && printf \'%s%s%s\' "$1" "$v" "$2"\n  return 0\n}',
    exitText: '__pg_exit_text() {\n  [ "$2" = 1 ] && [ "${__pg_status:-0}" -eq 0 ] && return 0\n  local t=$1\n  printf \'%s\' "${t//\\{code\\}/${__pg_status:-0}}"\n}',
    exitSgr: '__pg_exit_sgr() {\n  if [ "${__pg_status:-0}" -eq 0 ]; then printf \'\\033[%sm\' "$1"; else printf \'\\033[%sm\' "$2"; fi\n}',
    duration: '__pg_fmt_dur() {\n  local ms=$1\n  if [ "$2" = seconds ]; then printf \'%ds\' $(( ms / 1000 ))\n  elif (( ms < 1000 )); then printf \'%dms\' "$ms"\n  elif (( ms < 60000 )); then printf \'%d.%ds\' $(( ms / 1000 )) $(( ms % 1000 / 100 ))\n  elif (( ms < 3600000 )); then printf \'%dm %ds\' $(( ms / 60000 )) $(( ms % 60000 / 1000 ))\n  else printf \'%dh %dm\' $(( ms / 3600000 )) $(( ms % 3600000 / 60000 )); fi\n}\n' +
      '__pg_duration() {\n  (( ${__pg_dur:-0} >= $1 )) || return 0\n  printf \'%s\' "$3"; __pg_fmt_dur "${__pg_dur:-0}" "$2"; printf \'%s\' "$4"\n}'
  };
  var SH_HELPER_ORDER = ['git', 'gitDirty', 'venv', 'duration', 'exitText', 'exitSgr'];

  /* ======================= BASH ======================= */
  function bashText(s) {
    // Inside PS1='...': prompt decoding turns \\\\ into \, \\$ into $ and \\` into `.
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '\\') out += '\\\\\\\\';
      else if (c === '$') out += '\\\\$';
      else if (c === '`') out += '\\\\`';
      else if (c === "'") out += "'\\''";
      else if (c === '\n') out += '\\n';
      else out += c;
    }
    return out;
  }

  var BASH_TOKENS = {
    user: '\\u', host: '\\h', fqdn: '\\H', promptChar: '\\$', cwd: '\\w', cwdBase: '\\W', cwdAbs: '$PWD',
    jobs: '\\j', history: '\\!', shell: '\\s', shellVer: '\\v', tty: '\\l'
  };

  /*
   * Render elements as PS1 text. Returns an array of lines (split on newline elements).
   * markers=false leaves out \[ \] (used for the right prompt, which is printed inside one big \[ \]).
   */
  function bashLines(elements, mode, ctx, markers) {
    var lines = [''], cur = null;
    var open = markers ? '\\[' : '', close = markers ? '\\]' : '';
    function add(s) { lines[lines.length - 1] += s; }
    function fn(body) { var name = '__pg_f' + (++ctx.n); ctx.fns.push(name + '() { ' + body + '; }'); return '$(' + name + ')'; }
    function setStyle(params) { if (params !== cur) { add(open + '\\e[' + params + 'm' + close); cur = params; } }

    elements.forEach(function (el) {
      if (el.kind === 'newline') { lines.push(''); return; }
      if (el.kind === 'text') { if (el.text) { setStyle(sgrParams(el, mode)); add(bashText(el.text)); } return; }
      var p = el.props || {};
      if (el.field === 'exit') {
        ctx.status = true; ctx.helpers.exitSgr = ctx.helpers.exitText = true;
        add(open + fn('__pg_exit_sgr ' + shSingle(sgrParams(el, mode)) + ' ' + shSingle(failParams(el, mode))) + close);
        cur = null;
        add(fn('__pg_exit_text ' + shSingle(p.tpl) + ' ' + (p.hideOk ? 1 : 0)));
        return;
      }
      setStyle(sgrParams(el, mode));
      if (BASH_TOKENS[el.field]) { add(BASH_TOKENS[el.field]); return; }
      switch (el.field) {
        case 'time': add('\\D{' + sanitizeFmt(p.fmt) + '}'); break;
        case 'cwdTrim': ctx.helpers.cwdTrim = true; add(fn('__pg_cwd_trim ' + Math.max(1, p.depth | 0))); break;
        case 'git': ctx.helpers.git = true; add(fn('__pg_git ' + shSingle(p.pre) + ' ' + shSingle(p.suf))); break;
        case 'gitDirty': ctx.helpers.gitDirty = true; add(fn('__pg_git_dirty ' + shSingle(p.text))); break;
        case 'venv': ctx.helpers.venv = true; add(fn('__pg_venv ' + shSingle(p.pre) + ' ' + shSingle(p.suf))); break;
        case 'duration':
          ctx.status = ctx.duration = ctx.helpers.duration = true;
          add(fn('__pg_duration ' + durMinMs(p) + ' ' + durStyle(p) + ' ' + shSingle(p.pre) + ' ' + shSingle(p.suf)));
          break;
        case 'ssh': add(fn('[ -n "$SSH_CONNECTION$SSH_TTY" ] && printf \'%s\' ' + shSingle(p.text) + '; return 0')); break;
        case 'env': {
          var v = envName(p.name);
          add(fn('[ -n "${' + v + '}" ] && printf \'%s%s%s\' ' + shSingle(p.pre) + ' "${' + v + '}" ' + shSingle(p.suf) + '; return 0'));
          break;
        }
        case 'cmd': add(fn('{ ' + (p.cmd || 'true') + '\n} 2>/dev/null | tr -d \'\\n\'')); break;
      }
    });
    if (cur !== '0') add(open + '\\e[0m' + close);
    return lines;
  }

  function generateBash(left, right, mode) {
    var ctx = { helpers: {}, fns: [], n: 0 };
    var lines = bashLines(left, mode, ctx, true);
    var rps = right.length ? bashLines(right, mode, ctx, false).join('') : '';

    var out = ['# >>> prompt-generator (bash) >>>'];
    if (ctx.status) {
      if (ctx.duration) {
        out.push('# Command timing uses a DEBUG trap and $EPOCHREALTIME (bash 5+; whole seconds on older bash).');
        out.push('__pg_timer_start() { [ -n "$__pg_t0" ] && return; __pg_t0=${EPOCHREALTIME/[.,]/}; __pg_t0=${__pg_t0:-${SECONDS}000000}; }');
        out.push('__pg_save_status() {\n  __pg_status=$?\n  if [ -n "$__pg_t0" ]; then\n    local t=${EPOCHREALTIME/[.,]/}; t=${t:-${SECONDS}000000}\n    __pg_dur=$(( (t - __pg_t0) / 1000 ))\n  else\n    __pg_dur=0\n  fi\n}');
        out.push('__pg_timer_reset() { __pg_t0=; }');
        out.push("[ -n \"$(trap -p DEBUG)\" ] || trap '__pg_timer_start' DEBUG");
      } else {
        out.push('__pg_save_status() { __pg_status=$?; }');
      }
      // Run first so $? is still the user's command; works with PROMPT_COMMAND as a string or (bash 5.1+) an array.
      var tail = ctx.duration ? ' __pg_timer_reset' : '';
      out.push('if [[ "${PROMPT_COMMAND[*]}" != *__pg_save_status* ]]; then\n' +
        '  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then\n' +
        '    PROMPT_COMMAND=(__pg_save_status "${PROMPT_COMMAND[@]}"' + tail + ')\n' +
        '  else\n' +
        '    PROMPT_COMMAND="__pg_save_status${PROMPT_COMMAND:+;$PROMPT_COMMAND}' + (ctx.duration ? ';__pg_timer_reset' : '') + '"\n' +
        '  fi\n' +
        'fi');
    }
    if (ctx.helpers.venv) out.push('export VIRTUAL_ENV_DISABLE_PROMPT=1');
    if (ctx.helpers.cwdTrim) {
      out.push('__pg_cwd_trim() {\n  local p=${PWD/#$HOME/\\~} IFS=/\n  local -a a\n  read -ra a <<<"$p"\n  if (( ${#a[@]} > $1 + 1 )); then printf \'…/%s\' "${a[*]: -$1}"; else printf \'%s\' "$p"; fi\n}');
    }
    SH_HELPER_ORDER.forEach(function (k) { if (ctx.helpers[k]) out.push(SH_HELPERS[k]); });
    out = out.concat(ctx.fns);
    if (rps) {
      // Bash has no right prompt: print it at the right edge of the input line, then put the cursor back.
      out.push("__pg_rps1='" + rps + "'");
      out.push('__pg_rprompt() {\n  local r=${__pg_rps1@P} p c\n  p=$r\n  while [[ $p =~ $\'\\e\'\\[[0-9\\;]*m ]]; do p=${p/"${BASH_REMATCH[0]}"/}; done\n  c=$(( ${COLUMNS:-80} - ${#p} + 1 )); (( c < 1 )) && c=1\n  printf \'\\e7\\e[%dG%s\\e8\' "$c" "$r"\n}');
      lines[lines.length - 1] = '\\[$(__pg_rprompt)\\]' + lines[lines.length - 1];
    }
    out.push("PS1='" + lines.join('\\n') + "'");
    // PS1 depends on the functions above, which child shells (e.g. `su`) don't inherit. If an
    // older `export PS1=...` marked it for export, un-export it so those shells keep their own prompt.
    out.push('export -n PS1');
    out.push('# <<< prompt-generator (bash) <<<');
    return out.join('\n') + '\n';
  }

  /* ======================= ZSH ======================= */
  function zshText(s) {
    // Inside PROMPT=$'...' with PROMPT_SUBST: escape for $'' first, then for prompt expansion.
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '\\') out += '\\\\\\\\';
      else if (c === '$') out += '\\\\$';
      else if (c === '`') out += '\\\\`';
      else if (c === '%') out += '%%';
      else if (c === "'") out += "\\'";
      else if (c === '\n') out += '\\n';
      else out += c;
    }
    return out;
  }

  var ZSH_TOKENS = {
    user: '%n', host: '%m', fqdn: '%M', promptChar: '%(!.#.\\\\$)', cwd: '%~', cwdBase: '%1~', cwdAbs: '%/',
    jobs: '%j', history: '%!', shell: 'zsh', shellVer: '${ZSH_VERSION}', tty: '%l'
  };

  function zshPrompt(elements, mode, ctx) {
    var ps = '', cur = null;
    // zsh runs prompt expansion on substituted output, so any % it prints must be doubled.
    function fn(body) {
      var name = '__pg_f' + (++ctx.n);
      ctx.fns.push(name + '() { local o; o=$( ' + body + '\n); print -rn -- "${o//\\%/%%}"; }');
      return '$(' + name + ')';
    }
    function setStyle(params) { if (params !== cur) { ps += '%{\\e[' + params + 'm%}'; cur = params; } }

    elements.forEach(function (el) {
      if (el.kind === 'newline') { ps += '\\n'; return; }
      if (el.kind === 'text') { if (el.text) { setStyle(sgrParams(el, mode)); ps += zshText(el.text); } return; }
      var p = el.props || {};
      if (el.field === 'exit') {
        ctx.status = true; ctx.helpers.exitSgr = ctx.helpers.exitText = true;
        ps += '%{' + fn('__pg_exit_sgr ' + shSingle(sgrParams(el, mode)) + ' ' + shSingle(failParams(el, mode))) + '%}';
        cur = null;
        ps += fn('__pg_exit_text ' + shSingle(p.tpl) + ' ' + (p.hideOk ? 1 : 0));
        return;
      }
      setStyle(sgrParams(el, mode));
      if (ZSH_TOKENS[el.field]) { ps += ZSH_TOKENS[el.field]; return; }
      switch (el.field) {
        case 'time': ps += '%D{' + sanitizeFmt(p.fmt) + '}'; break;
        case 'cwdTrim': ctx.helpers.cwdTrim = true; ps += fn('__pg_cwd_trim ' + Math.max(1, p.depth | 0)); break;
        case 'git': ctx.helpers.git = true; ps += fn('__pg_git ' + shSingle(p.pre) + ' ' + shSingle(p.suf)); break;
        case 'gitDirty': ctx.helpers.gitDirty = true; ps += fn('__pg_git_dirty ' + shSingle(p.text)); break;
        case 'venv': ctx.helpers.venv = true; ps += fn('__pg_venv ' + shSingle(p.pre) + ' ' + shSingle(p.suf)); break;
        case 'duration':
          ctx.status = ctx.duration = ctx.helpers.duration = true;
          ps += fn('__pg_duration ' + durMinMs(p) + ' ' + durStyle(p) + ' ' + shSingle(p.pre) + ' ' + shSingle(p.suf));
          break;
        case 'ssh': ps += fn('[[ -n "$SSH_CONNECTION$SSH_TTY" ]] && printf \'%s\' ' + shSingle(p.text) + '; return 0'); break;
        case 'env': {
          var v = envName(p.name);
          ps += fn('[[ -n "${' + v + '}" ]] && printf \'%s%s%s\' ' + shSingle(p.pre) + ' "${' + v + '}" ' + shSingle(p.suf) + '; return 0');
          break;
        }
        case 'cmd': ps += fn('{ ' + (p.cmd || 'true') + '\n} 2>/dev/null | tr -d \'\\n\''); break;
      }
    });
    if (cur !== '0') ps += '%{\\e[0m%}';
    return ps;
  }

  function generateZsh(left, right, mode) {
    var ctx = { helpers: {}, fns: [], n: 0 };
    var ps = zshPrompt(left, mode, ctx);
    var rps = right.length ? zshPrompt(right, mode, ctx) : null;

    var out = ['# >>> prompt-generator (zsh) >>>', 'setopt PROMPT_SUBST'];
    if (ctx.status) {
      if (ctx.duration) {
        out.push('zmodload zsh/datetime');
        out.push('__pg_preexec() { __pg_t0=$EPOCHREALTIME }');
        out.push('(( ${preexec_functions[(I)__pg_preexec]} )) || preexec_functions+=(__pg_preexec)');
        out.push('__pg_save_status() {\n  __pg_status=$?\n  if [[ -n $__pg_t0 ]]; then\n    local -F d=$(( (EPOCHREALTIME - __pg_t0) * 1000 ))\n    __pg_dur=${d%.*}\n    unset __pg_t0\n  else\n    __pg_dur=0\n  fi\n}');
      } else {
        out.push('__pg_save_status() { __pg_status=$? }');
      }
      out.push('(( ${precmd_functions[(I)__pg_save_status]} )) || precmd_functions=(__pg_save_status $precmd_functions)');
    }
    if (ctx.helpers.venv) out.push('export VIRTUAL_ENV_DISABLE_PROMPT=1');
    if (ctx.helpers.cwdTrim) {
      out.push('__pg_cwd_trim() {\n  local p=${PWD/#$HOME/\\~}\n  local -a a\n  a=("${(@s:/:)p}")\n  if (( ${#a} > $1 + 1 )); then printf \'…/%s\' "${(j:/:)a[-$1,-1]}"; else printf \'%s\' "$p"; fi\n}');
    }
    SH_HELPER_ORDER.forEach(function (k) { if (ctx.helpers[k]) out.push(SH_HELPERS[k]); });
    out = out.concat(ctx.fns);
    out.push("PROMPT=$'" + ps + "'");
    out.push(rps != null ? "RPROMPT=$'" + rps + "'" : "RPROMPT=''");
    out.push('# <<< prompt-generator (zsh) <<<');
    return out.join('\n') + '\n';
  }

  /* ======================= FISH ======================= */
  function fishBody(elements, mode, ctx) {
    var body = [], cur = null;
    var I = '    ';
    function setStyle(params) { if (params !== cur) { body.push(I + "printf '\\e[" + params + "m'"); cur = params; } }
    function out(expr) { body.push(I + "printf '%s' " + expr); }

    elements.forEach(function (el) {
      if (el.kind === 'newline') { body.push(I + "printf '\\n'"); return; }
      if (el.kind === 'text') { if (el.text) { setStyle(sgrParams(el, mode)); out(fishSingle(el.text)); } return; }
      var p = el.props || {};
      if (el.field === 'exit') {
        body.push(I + 'if test $__pg_status -eq 0');
        body.push(I + I + "printf '\\e[" + sgrParams(el, mode) + "m'");
        if (!p.hideOk) body.push(I + I + "printf '%s' " + fishSingle(p.tpl) + ' | string replace -a \'{code}\' $__pg_status');
        body.push(I + 'else');
        body.push(I + I + "printf '\\e[" + failParams(el, mode) + "m'");
        body.push(I + I + "printf '%s' " + fishSingle(p.tpl) + ' | string replace -a \'{code}\' $__pg_status');
        body.push(I + 'end');
        cur = null;
        return;
      }
      setStyle(sgrParams(el, mode));
      switch (el.field) {
        case 'user': out('$USER'); break;
        case 'host': out('(prompt_hostname)'); break;
        case 'fqdn': out('(hostname)'); break;
        case 'promptChar': out("(fish_is_root_user; and echo '#'; or echo '$')"); break;
        case 'cwd': out("(string replace -r -- '^'(string escape --style=regex -- $HOME) '~' $PWD)"); break;
        case 'cwdBase': out("(test \"$PWD\" = \"$HOME\"; and echo '~'; or basename -- $PWD)"); break;
        case 'cwdAbs': out('$PWD'); break;
        case 'cwdTrim': ctx.trim = true; out('(__pg_cwd_trim ' + Math.max(1, p.depth | 0) + ')'); break;
        case 'time': out('(date ' + fishSingle('+' + sanitizeFmt(p.fmt)) + ')'); break;
        case 'jobs': out('(count (jobs -p))'); break;
        case 'history': out('(math (count $history) + 1)'); break;
        case 'shell': out("'fish'"); break;
        case 'shellVer': out('$FISH_VERSION'); break;
        case 'tty': out("(tty | string replace '/dev/' '')"); break;
        case 'ssh': body.push(I + 'set -q SSH_CONNECTION; or set -q SSH_TTY; and printf \'%s\' ' + fishSingle(p.text)); break;
        case 'git':
          body.push(I + 'set -l __pg_b (git symbolic-ref --short HEAD 2>/dev/null; or git rev-parse --short HEAD 2>/dev/null)');
          body.push(I + 'test -n "$__pg_b"; and printf \'%s%s%s\' ' + fishSingle(p.pre) + ' $__pg_b ' + fishSingle(p.suf));
          break;
        case 'gitDirty':
          body.push(I + 'test -n "$(git status --porcelain --ignore-submodules 2>/dev/null | head -c1)"; and printf \'%s\' ' + fishSingle(p.text));
          break;
        case 'venv':
          ctx.venv = true;
          body.push(I + 'set -l __pg_v (string trim -c \'() \' -- "$VIRTUAL_ENV_PROMPT")');
          body.push(I + 'test -z "$__pg_v"; and set __pg_v (string replace -r \'.*/\' \'\' -- "$VIRTUAL_ENV")');
          body.push(I + 'test -z "$__pg_v"; and set __pg_v "$CONDA_DEFAULT_ENV"');
          body.push(I + 'test -n "$__pg_v"; and printf \'%s%s%s\' ' + fishSingle(p.pre) + ' $__pg_v ' + fishSingle(p.suf));
          break;
        case 'duration':
          ctx.duration = true;
          body.push(I + 'if test $__pg_dur -ge ' + durMinMs(p));
          body.push(I + I + "printf '%s%s%s' " + fishSingle(p.pre) + ' (__pg_fmt_dur $__pg_dur ' + durStyle(p) + ') ' + fishSingle(p.suf));
          body.push(I + 'end');
          break;
        case 'env': {
          var v = envName(p.name);
          body.push(I + 'set -q ' + v + '; and test -n "$' + v + '"; and printf \'%s%s%s\' ' + fishSingle(p.pre) + ' "$' + v + '" ' + fishSingle(p.suf));
          break;
        }
        case 'cmd': out('(begin; ' + (p.cmd || 'true') + '\nend 2>/dev/null | string join \'\')'); break;
      }
    });
    if (cur !== '0') body.push(I + "printf '\\e[0m'");
    return body;
  }

  function generateFish(left, right, mode) {
    var ctx = {};
    var lbody = fishBody(left, mode, ctx);
    var rbody = right.length ? fishBody(right, mode, ctx) : null;

    var out = ['# >>> prompt-generator (fish) >>>'];
    if (ctx.venv) out.push('set -gx VIRTUAL_ENV_DISABLE_PROMPT 1');
    if (ctx.trim) {
      out.push('function __pg_cwd_trim');
      out.push("    set -l p (string replace -r -- '^'(string escape --style=regex -- $HOME) '~' $PWD)");
      out.push('    set -l a (string split / -- $p)');
      out.push('    if test (count $a) -gt (math $argv[1] + 1)');
      out.push("        printf '…/%s' (string join / -- $a[(math -$argv[1])..-1])");
      out.push('    else');
      out.push("        printf '%s' $p");
      out.push('    end');
      out.push('end');
    }
    if (ctx.duration) {
      out.push('function __pg_fmt_dur');
      out.push('    set -l ms $argv[1]');
      out.push('    if test "$argv[2]" = seconds');
      out.push("        printf '%ds' (math -s0 \"floor($ms / 1000)\")");
      out.push('    else if test $ms -lt 1000');
      out.push("        printf '%dms' $ms");
      out.push('    else if test $ms -lt 60000');
      out.push("        printf '%d.%ds' (math -s0 \"floor($ms / 1000)\") (math -s0 \"floor($ms % 1000 / 100)\")");
      out.push('    else if test $ms -lt 3600000');
      out.push("        printf '%dm %ds' (math -s0 \"floor($ms / 60000)\") (math -s0 \"floor($ms % 60000 / 1000)\")");
      out.push('    else');
      out.push("        printf '%dh %dm' (math -s0 \"floor($ms / 3600000)\") (math -s0 \"floor($ms % 3600000 / 60000)\")");
      out.push('    end');
      out.push('end');
    }
    var head = ['    set -l __pg_status $status'];
    if (ctx.duration) head.push('    set -l __pg_dur (math -s0 "0$CMD_DURATION")');
    out.push('function fish_prompt');
    out = out.concat(head, lbody);
    out.push('end');
    out.push('function fish_right_prompt');
    if (rbody) out = out.concat(head, rbody);
    out.push('end');
    out.push('# <<< prompt-generator (fish) <<<');
    return out.join('\n') + '\n';
  }

  /* ======================= POWERSHELL ======================= */
  var PS_HOME = '(\'^\' + [regex]::Escape($HOME))';

  function pwshBody(elements, mode, ctx, v) {
    var body = [], cur = null;
    var I = '    ';
    function setStyle(params) { if (params !== cur) { body.push(I + v + ' += $e + ' + psSingle('[' + params + 'm')); cur = params; } }
    function out(expr) { body.push(I + v + ' += ' + expr); }

    elements.forEach(function (el) {
      if (el.kind === 'newline') { out('"`n"'); return; }
      if (el.kind === 'text') { if (el.text) { setStyle(sgrParams(el, mode)); out(psSingle(el.text)); } return; }
      var p = el.props || {};
      if (el.field === 'exit') {
        body.push(I + 'if ($code -eq 0) { ' + v + ' += $e + ' + psSingle('[' + sgrParams(el, mode) + 'm') + (p.hideOk ? '' : '; ' + v + ' += ' + psSingle(p.tpl) + ".Replace('{code}', \"$code\")") + ' }');
        body.push(I + 'else { ' + v + ' += $e + ' + psSingle('[' + failParams(el, mode) + 'm') + '; ' + v + ' += ' + psSingle(p.tpl) + ".Replace('{code}', \"$code\") }");
        cur = null;
        return;
      }
      setStyle(sgrParams(el, mode));
      switch (el.field) {
        case 'user': out('[Environment]::UserName'); break;
        case 'host': out('[Environment]::MachineName'); break;
        case 'fqdn': out('[System.Net.Dns]::GetHostEntry(\'\').HostName'); break;
        case 'promptChar': ctx.admin = true; out('$(if ($isAdmin) { \'#\' } else { \'$\' })'); break;
        case 'cwd': out('($PWD.Path -replace ' + PS_HOME + ', \'~\')'); break;
        case 'cwdBase': out('$(if ($PWD.Path -eq $HOME) { \'~\' } else { Split-Path -Leaf $PWD.Path })'); break;
        case 'cwdAbs': out('$PWD.Path'); break;
        case 'cwdTrim': ctx.trim = true; out('(__pg_cwd_trim ' + Math.max(1, p.depth | 0) + ')'); break;
        case 'time': out('(Get-Date -UFormat ' + psSingle(sanitizeFmt(p.fmt)) + ')'); break;
        case 'jobs': out('@(Get-Job).Count'); break;
        case 'history': out('$MyInvocation.HistoryId'); break;
        case 'shell': out("'pwsh'"); break;
        case 'shellVer': out('$PSVersionTable.PSVersion.ToString()'); break;
        case 'tty': break;
        case 'ssh': body.push(I + 'if ($env:SSH_CONNECTION -or $env:SSH_TTY) { ' + v + ' += ' + psSingle(p.text) + ' }'); break;
        case 'git':
          body.push(I + 'if (Get-Command git -ErrorAction SilentlyContinue) {');
          body.push(I + I + '$b = git symbolic-ref --short HEAD 2>$null');
          body.push(I + I + 'if (-not $b) { $b = git rev-parse --short HEAD 2>$null }');
          body.push(I + I + 'if ($b) { ' + v + ' += ' + psSingle(p.pre) + ' + $b + ' + psSingle(p.suf) + ' }');
          body.push(I + '}');
          break;
        case 'gitDirty':
          body.push(I + 'if ((Get-Command git -ErrorAction SilentlyContinue) -and (git status --porcelain --ignore-submodules 2>$null)) { ' + v + ' += ' + psSingle(p.text) + ' }');
          break;
        case 'venv':
          ctx.venv = true;
          body.push(I + '$v = if ($env:VIRTUAL_ENV_PROMPT) { $env:VIRTUAL_ENV_PROMPT.Trim(\'() \') } elseif ($env:VIRTUAL_ENV) { Split-Path -Leaf $env:VIRTUAL_ENV } else { $env:CONDA_DEFAULT_ENV }');
          body.push(I + 'if ($v) { ' + v + ' += ' + psSingle(p.pre) + ' + $v + ' + psSingle(p.suf) + ' }');
          break;
        case 'duration':
          ctx.duration = true;
          body.push(I + 'if ($dur -ge ' + durMinMs(p) + ') { ' + v + ' += ' + psSingle(p.pre) + ' + (__pg_fmt_dur $dur ' + psSingle(durStyle(p)) + ') + ' + psSingle(p.suf) + ' }');
          break;
        case 'env': {
          var name = envName(p.name);
          body.push(I + '$v = [Environment]::GetEnvironmentVariable(' + psSingle(name) + ')');
          body.push(I + 'if ($v) { ' + v + ' += ' + psSingle(p.pre) + ' + $v + ' + psSingle(p.suf) + ' }');
          break;
        }
        case 'cmd': out('((' + (p.cmd || '$null') + ') 2>$null | Out-String).Trim()'); break;
      }
    });
    if (cur !== '0') body.push(I + v + ' += $e + \'[0m\'');
    return body;
  }

  function generatePwsh(left, right, mode) {
    var ctx = {};
    var lbody = pwshBody(left, mode, ctx, '$o');
    var rbody = right.length ? pwshBody(right, mode, ctx, '$r') : null;

    var out = ['# >>> prompt-generator (PowerShell) >>>'];
    if (ctx.venv) out.push('$env:VIRTUAL_ENV_DISABLE_PROMPT = 1');
    if (ctx.trim) {
      out.push('function __pg_cwd_trim([int]$n) {');
      out.push('    $p = $PWD.Path -replace ' + PS_HOME + ', \'~\'');
      out.push('    $a = $p -split \'[\\\\/]\'');
      out.push('    if ($a.Count -gt $n + 1) { \'…/\' + ($a[-$n..-1] -join \'/\') } else { $p }');
      out.push('}');
    }
    if (ctx.duration) {
      out.push('function __pg_fmt_dur([long]$ms, [string]$style) {');
      out.push("    if ($style -eq 'seconds') { return '{0}s' -f [math]::Floor($ms / 1000) }");
      out.push("    if ($ms -lt 1000) { return '{0}ms' -f $ms }");
      out.push("    if ($ms -lt 60000) { return '{0}.{1}s' -f [math]::Floor($ms / 1000), [math]::Floor(($ms % 1000) / 100) }");
      out.push("    if ($ms -lt 3600000) { return '{0}m {1}s' -f [math]::Floor($ms / 60000), [math]::Floor(($ms % 60000) / 1000) }");
      out.push("    return '{0}h {1}m' -f [math]::Floor($ms / 3600000), [math]::Floor(($ms % 3600000) / 60000)");
      out.push('}');
    }
    out.push('function prompt {');
    out.push('    $ok = $?');
    out.push('    $code = if ($ok) { 0 } elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }');
    out.push('    $e = [char]27');
    if (ctx.duration) {
      // Duration of the last history entry, shown once (not again after an empty Enter).
      out.push('    $dur = 0');
      out.push('    $h = Get-History -Count 1');
      out.push('    if ($h -and $h.Id -ne $global:__pg_last_hist) { $global:__pg_last_hist = $h.Id; $dur = [long]($h.EndExecutionTime - $h.StartExecutionTime).TotalMilliseconds }');
    }
    if (ctx.admin) {
      out.push('    $isAdmin = if ($IsLinux -or $IsMacOS) { (id -u) -eq 0 } else { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }');
    }
    out.push("    $o = ''");
    out = out.concat(lbody);
    if (rbody) {
      // PowerShell has no right prompt: print it at the right edge of the input line, then put the cursor back.
      out.push("    $r = ''");
      out = out.concat(rbody);
      out.push('    if ($r) {');
      out.push("        $w = ([regex]::Replace($r, '\\x1b\\[[0-9;]*m', '')).Length");
      out.push('        $c = 0');
      out.push('        try { $c = $Host.UI.RawUI.WindowSize.Width } catch { }');
      out.push('        if ($c -le 0 -and $env:COLUMNS) { $c = [int]$env:COLUMNS }');
      out.push('        if ($c -le 0) { $c = 80 }');
      out.push('        $o = $o.Insert($o.LastIndexOf("`n") + 1, $e + \'7\' + $e + \'[\' + [math]::Max(1, $c - $w + 1) + \'G\' + $r + $e + \'8\')');
      out.push('    }');
    }
    out.push('    return $o');
    out.push('}');
    out.push('# <<< prompt-generator (PowerShell) <<<');
    return out.join('\n') + '\n';
  }

  /* Right prompts are single-line: newlines are dropped. */
  function generate(shell, left, mode, right) {
    mode = mode || 'truecolor';
    left = left || [];
    right = (right || []).filter(function (e) { return e.kind !== 'newline'; });
    switch (shell) {
      case 'zsh': return generateZsh(left, right, mode);
      case 'fish': return generateFish(left, right, mode);
      case 'pwsh': return generatePwsh(left, right, mode);
      default: return generateBash(left, right, mode);
    }
  }

  PG.gen = { SHELLS: SHELLS, generate: generate, sgrParams: sgrParams };
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
