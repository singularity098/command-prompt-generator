/* Shell code generators: turn a list of prompt elements into bash / zsh / fish / PowerShell code. */
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
  function shSingle(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  function fishSingle(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
  function psSingle(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function sanitizeFmt(f) { return String(f || '%H:%M:%S').replace(/[{}\n]/g, ''); }
  function envName(n) { return String(n || '').replace(/[^A-Za-z0-9_]/g, '') || 'HOME'; }

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

  /* Common helper functions, emitted only when used. Shared by bash & zsh (POSIX-ish syntax). */
  var SH_HELPERS = {
    git: '__pg_git() {\n  local b\n  b=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null) || return 0\n  printf \'%s%s%s\' "$1" "$b" "$2"\n}',
    gitDirty: '__pg_git_dirty() {\n  [ -n "$(git status --porcelain --ignore-submodules 2>/dev/null | head -c1)" ] && printf \'%s\' "$1"\n  return 0\n}',
    venv: '__pg_venv() {\n  local v=${VIRTUAL_ENV_PROMPT:-${VIRTUAL_ENV##*/}}\n  v=${v:-$CONDA_DEFAULT_ENV}\n  v=${v#\\(}; v=${v%\\) }; v=${v%\\)}\n  [ -n "$v" ] && printf \'%s%s%s\' "$1" "$v" "$2"\n  return 0\n}',
    exitText: '__pg_exit_text() {\n  [ "$2" = 1 ] && [ "${__pg_status:-0}" -eq 0 ] && return 0\n  local t=$1\n  printf \'%s\' "${t//\\{code\\}/${__pg_status:-0}}"\n}',
    exitSgr: '__pg_exit_sgr() {\n  if [ "${__pg_status:-0}" -eq 0 ]; then printf \'\\033[%sm\' "$1"; else printf \'\\033[%sm\' "$2"; fi\n}'
  };

  var BASH_TOKENS = {
    user: '\\u', host: '\\h', fqdn: '\\H', promptChar: '\\$', cwd: '\\w', cwdBase: '\\W', cwdAbs: '$PWD',
    jobs: '\\j', history: '\\!', shell: '\\s', shellVer: '\\v', tty: '\\l'
  };

  function generateBash(elements, mode) {
    var helpers = {}, fns = [], ps = '', cur = null, n = 0, needStatus = false, notes = [];
    function useHelper(k) { helpers[k] = true; }
    function fn(body) { var name = '__pg_f' + (++n); fns.push(name + '() { ' + body + '; }'); return '$(' + name + ')'; }
    function setStyle(params) { if (params !== cur) { ps += '\\[\\e[' + params + 'm\\]'; cur = params; } }

    elements.forEach(function (el) {
      if (el.kind === 'newline') { ps += '\\n'; return; }
      if (el.kind === 'text') { if (el.text) { setStyle(sgrParams(el, mode)); ps += bashText(el.text); } return; }
      var p = el.props || {};
      if (el.field === 'exit') {
        needStatus = true; useHelper('exitSgr'); useHelper('exitText');
        ps += '\\[' + fn('__pg_exit_sgr ' + shSingle(sgrParams(el, mode)) + ' ' + shSingle(failParams(el, mode))) + '\\]';
        cur = null;
        ps += fn('__pg_exit_text ' + shSingle(p.tpl) + ' ' + (p.hideOk ? 1 : 0));
        return;
      }
      setStyle(sgrParams(el, mode));
      if (BASH_TOKENS[el.field]) { ps += BASH_TOKENS[el.field]; return; }
      switch (el.field) {
        case 'time': ps += '\\D{' + sanitizeFmt(p.fmt) + '}'; break;
        case 'cwdTrim':
          useHelper('cwdTrim');
          ps += fn('__pg_cwd_trim ' + (Math.max(1, p.depth | 0)));
          break;
        case 'git': useHelper('git'); ps += fn('__pg_git ' + shSingle(p.pre) + ' ' + shSingle(p.suf)); break;
        case 'gitDirty': useHelper('gitDirty'); ps += fn('__pg_git_dirty ' + shSingle(p.text)); break;
        case 'venv':
          useHelper('venv'); ps += fn('__pg_venv ' + shSingle(p.pre) + ' ' + shSingle(p.suf));
          notes.venv = true;
          break;
        case 'ssh': ps += fn('[ -n "$SSH_CONNECTION$SSH_TTY" ] && printf \'%s\' ' + shSingle(p.text) + '; return 0'); break;
        case 'env': {
          var v = envName(p.name);
          ps += fn('[ -n "${' + v + '}" ] && printf \'%s%s%s\' ' + shSingle(p.pre) + ' "${' + v + '}" ' + shSingle(p.suf) + '; return 0');
          break;
        }
        case 'cmd': ps += fn('{ ' + (p.cmd || 'true') + '\n} 2>/dev/null | tr -d \'\\n\''); break;
      }
    });
    if (cur !== '0') ps += '\\[\\e[0m\\]';

    var lines = ['# >>> prompt-generator (bash) >>>'];
    if (needStatus) {
      lines.push('__pg_save_status() { __pg_status=$?; }');
      lines.push('[[ ";${PROMPT_COMMAND[*]};" == *";__pg_save_status;"* ]] || PROMPT_COMMAND="__pg_save_status${PROMPT_COMMAND:+;$PROMPT_COMMAND}"');
    }
    if (notes.venv) lines.push('export VIRTUAL_ENV_DISABLE_PROMPT=1');
    if (helpers.cwdTrim) {
      lines.push('__pg_cwd_trim() {\n  local p=${PWD/#$HOME/\\~} IFS=/\n  local -a a\n  read -ra a <<<"$p"\n  if (( ${#a[@]} > $1 + 1 )); then printf \'…/%s\' "${a[*]: -$1}"; else printf \'%s\' "$p"; fi\n}');
    }
    ['git', 'gitDirty', 'venv', 'exitText', 'exitSgr'].forEach(function (k) { if (helpers[k]) lines.push(SH_HELPERS[k]); });
    lines = lines.concat(fns);
    lines.push("PS1='" + ps + "'");
    lines.push('# <<< prompt-generator (bash) <<<');
    return lines.join('\n') + '\n';
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

  function generateZsh(elements, mode) {
    var helpers = {}, fns = [], ps = '', cur = null, n = 0, needStatus = false, venvUsed = false;
    // zsh runs prompt expansion on substituted output, so any % it prints must be doubled.
    function fn(body) {
      var name = '__pg_f' + (++n);
      fns.push(name + '() { local o; o=$( ' + body + '\n); print -rn -- "${o//\\%/%%}"; }');
      return '$(' + name + ')';
    }
    function setStyle(params) { if (params !== cur) { ps += '%{\\e[' + params + 'm%}'; cur = params; } }

    elements.forEach(function (el) {
      if (el.kind === 'newline') { ps += '\\n'; return; }
      if (el.kind === 'text') { if (el.text) { setStyle(sgrParams(el, mode)); ps += zshText(el.text); } return; }
      var p = el.props || {};
      if (el.field === 'exit') {
        needStatus = true; helpers.exitSgr = helpers.exitText = true;
        ps += '%{' + fn('__pg_exit_sgr ' + shSingle(sgrParams(el, mode)) + ' ' + shSingle(failParams(el, mode))) + '%}';
        cur = null;
        ps += fn('__pg_exit_text ' + shSingle(p.tpl) + ' ' + (p.hideOk ? 1 : 0));
        return;
      }
      setStyle(sgrParams(el, mode));
      if (ZSH_TOKENS[el.field]) { ps += ZSH_TOKENS[el.field]; return; }
      switch (el.field) {
        case 'time': ps += '%D{' + sanitizeFmt(p.fmt) + '}'; break;
        case 'cwdTrim': helpers.cwdTrim = true; ps += fn('__pg_cwd_trim ' + Math.max(1, p.depth | 0)); break;
        case 'git': helpers.git = true; ps += fn('__pg_git ' + shSingle(p.pre) + ' ' + shSingle(p.suf)); break;
        case 'gitDirty': helpers.gitDirty = true; ps += fn('__pg_git_dirty ' + shSingle(p.text)); break;
        case 'venv': helpers.venv = true; venvUsed = true; ps += fn('__pg_venv ' + shSingle(p.pre) + ' ' + shSingle(p.suf)); break;
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

    var lines = ['# >>> prompt-generator (zsh) >>>', 'setopt PROMPT_SUBST'];
    if (needStatus) {
      lines.push('__pg_save_status() { __pg_status=$? }');
      lines.push('(( ${precmd_functions[(I)__pg_save_status]} )) || precmd_functions=(__pg_save_status $precmd_functions)');
    }
    if (venvUsed) lines.push('export VIRTUAL_ENV_DISABLE_PROMPT=1');
    if (helpers.cwdTrim) {
      lines.push('__pg_cwd_trim() {\n  local p=${PWD/#$HOME/\\~}\n  local -a a\n  a=("${(@s:/:)p}")\n  if (( ${#a} > $1 + 1 )); then printf \'…/%s\' "${(j:/:)a[-$1,-1]}"; else printf \'%s\' "$p"; fi\n}');
    }
    ['git', 'gitDirty', 'venv', 'exitText', 'exitSgr'].forEach(function (k) {
      if (helpers[k]) lines.push(SH_HELPERS[k]);
    });
    lines = lines.concat(fns);
    lines.push("PROMPT=$'" + ps + "'");
    lines.push('# <<< prompt-generator (zsh) <<<');
    return lines.join('\n') + '\n';
  }

  /* ======================= FISH ======================= */
  function generateFish(elements, mode) {
    var body = [], cur = null, needTrim = false;
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
        case 'cwdTrim': needTrim = true; out('(__pg_cwd_trim ' + Math.max(1, p.depth | 0) + ')'); break;
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
          body.push(I + 'set -l __pg_v (string trim -c \'() \' -- "$VIRTUAL_ENV_PROMPT")');
          body.push(I + 'test -z "$__pg_v"; and set __pg_v (string replace -r \'.*/\' \'\' -- "$VIRTUAL_ENV")');
          body.push(I + 'test -z "$__pg_v"; and set __pg_v "$CONDA_DEFAULT_ENV"');
          body.push(I + 'test -n "$__pg_v"; and printf \'%s%s%s\' ' + fishSingle(p.pre) + ' $__pg_v ' + fishSingle(p.suf));
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

    var lines = ['# >>> prompt-generator (fish) >>>'];
    if (elements.some(function (e) { return e.field === 'venv'; })) lines.push('set -gx VIRTUAL_ENV_DISABLE_PROMPT 1');
    if (needTrim) {
      lines.push('function __pg_cwd_trim');
      lines.push("    set -l p (string replace -r -- '^'(string escape --style=regex -- $HOME) '~' $PWD)");
      lines.push('    set -l a (string split / -- $p)');
      lines.push('    if test (count $a) -gt (math $argv[1] + 1)');
      lines.push("        printf '…/%s' (string join / -- $a[(math -$argv[1])..-1])");
      lines.push('    else');
      lines.push("        printf '%s' $p");
      lines.push('    end');
      lines.push('end');
    }
    lines.push('function fish_prompt');
    lines.push('    set -l __pg_status $status');
    lines = lines.concat(body);
    lines.push('end');
    lines.push('# <<< prompt-generator (fish) <<<');
    return lines.join('\n') + '\n';
  }

  /* ======================= POWERSHELL ======================= */
  function generatePwsh(elements, mode) {
    var body = [], cur = null, needTrim = false;
    var I = '    ';
    function setStyle(params) { if (params !== cur) { body.push(I + '$o += $e + ' + psSingle('[' + params + 'm')); cur = params; } }
    function out(expr) { body.push(I + '$o += ' + expr); }
    var home = '(\'^\' + [regex]::Escape($HOME))';

    elements.forEach(function (el) {
      if (el.kind === 'newline') { out('"`n"'); return; }
      if (el.kind === 'text') { if (el.text) { setStyle(sgrParams(el, mode)); out(psSingle(el.text)); } return; }
      var p = el.props || {};
      if (el.field === 'exit') {
        body.push(I + 'if ($code -eq 0) { $o += $e + ' + psSingle('[' + sgrParams(el, mode) + 'm') + (p.hideOk ? '' : '; $o += ' + psSingle(p.tpl) + ".Replace('{code}', \"$code\")") + ' }');
        body.push(I + 'else { $o += $e + ' + psSingle('[' + failParams(el, mode) + 'm') + '; $o += ' + psSingle(p.tpl) + ".Replace('{code}', \"$code\") }");
        cur = null;
        return;
      }
      setStyle(sgrParams(el, mode));
      switch (el.field) {
        case 'user': out('[Environment]::UserName'); break;
        case 'host': out('[Environment]::MachineName'); break;
        case 'fqdn': out('[System.Net.Dns]::GetHostEntry(\'\').HostName'); break;
        case 'promptChar': out('$(if ($isAdmin) { \'#\' } else { \'$\' })'); break;
        case 'cwd': out('($PWD.Path -replace ' + home + ', \'~\')'); break;
        case 'cwdBase': out('$(if ($PWD.Path -eq $HOME) { \'~\' } else { Split-Path -Leaf $PWD.Path })'); break;
        case 'cwdAbs': out('$PWD.Path'); break;
        case 'cwdTrim': needTrim = true; out('(__pg_cwd_trim ' + Math.max(1, p.depth | 0) + ')'); break;
        case 'time': out('(Get-Date -UFormat ' + psSingle(sanitizeFmt(p.fmt)) + ')'); break;
        case 'jobs': out('@(Get-Job).Count'); break;
        case 'history': out('$MyInvocation.HistoryId'); break;
        case 'shell': out("'pwsh'"); break;
        case 'shellVer': out('$PSVersionTable.PSVersion.ToString()'); break;
        case 'tty': break;
        case 'ssh': body.push(I + 'if ($env:SSH_CONNECTION -or $env:SSH_TTY) { $o += ' + psSingle(p.text) + ' }'); break;
        case 'git':
          body.push(I + 'if (Get-Command git -ErrorAction SilentlyContinue) {');
          body.push(I + I + '$b = git symbolic-ref --short HEAD 2>$null');
          body.push(I + I + 'if (-not $b) { $b = git rev-parse --short HEAD 2>$null }');
          body.push(I + I + 'if ($b) { $o += ' + psSingle(p.pre) + ' + $b + ' + psSingle(p.suf) + ' }');
          body.push(I + '}');
          break;
        case 'gitDirty':
          body.push(I + 'if ((Get-Command git -ErrorAction SilentlyContinue) -and (git status --porcelain --ignore-submodules 2>$null)) { $o += ' + psSingle(p.text) + ' }');
          break;
        case 'venv':
          body.push(I + '$v = if ($env:VIRTUAL_ENV_PROMPT) { $env:VIRTUAL_ENV_PROMPT.Trim(\'() \') } elseif ($env:VIRTUAL_ENV) { Split-Path -Leaf $env:VIRTUAL_ENV } else { $env:CONDA_DEFAULT_ENV }');
          body.push(I + 'if ($v) { $o += ' + psSingle(p.pre) + ' + $v + ' + psSingle(p.suf) + ' }');
          break;
        case 'env': {
          var v = envName(p.name);
          body.push(I + '$v = [Environment]::GetEnvironmentVariable(' + psSingle(v) + ')');
          body.push(I + 'if ($v) { $o += ' + psSingle(p.pre) + ' + $v + ' + psSingle(p.suf) + ' }');
          break;
        }
        case 'cmd': out('((' + (p.cmd || '$null') + ') 2>$null | Out-String).Trim()'); break;
      }
    });
    if (cur !== '0') body.push(I + '$o += $e + \'[0m\'');

    var lines = ['# >>> prompt-generator (PowerShell) >>>'];
    if (elements.some(function (e) { return e.field === 'venv'; })) lines.push('$env:VIRTUAL_ENV_DISABLE_PROMPT = 1');
    if (needTrim) {
      lines.push('function __pg_cwd_trim([int]$n) {');
      lines.push('    $p = $PWD.Path -replace ' + home + ', \'~\'');
      lines.push('    $a = $p -split \'[\\\\/]\'');
      lines.push('    if ($a.Count -gt $n + 1) { \'…/\' + ($a[-$n..-1] -join \'/\') } else { $p }');
      lines.push('}');
    }
    lines.push('function prompt {');
    lines.push('    $ok = $?');
    lines.push('    $code = if ($ok) { 0 } elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }');
    lines.push('    $e = [char]27');
    if (elements.some(function (e) { return e.field === 'promptChar'; })) {
      lines.push('    $isAdmin = if ($IsLinux -or $IsMacOS) { (id -u) -eq 0 } else { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }');
    }
    lines.push("    $o = ''");
    lines = lines.concat(body);
    lines.push('    return $o');
    lines.push('}');
    lines.push('# <<< prompt-generator (PowerShell) <<<');
    return lines.join('\n') + '\n';
  }

  function generate(shell, elements, mode) {
    mode = mode || 'truecolor';
    switch (shell) {
      case 'zsh': return generateZsh(elements, mode);
      case 'fish': return generateFish(elements, mode);
      case 'pwsh': return generatePwsh(elements, mode);
      default: return generateBash(elements, mode);
    }
  }

  PG.gen = { SHELLS: SHELLS, generate: generate, sgrParams: sgrParams };
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
