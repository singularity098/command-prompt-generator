#!/usr/bin/env node
/*
 * Test suite. Run with: node tests/run.js
 *
 * - Unit tests for color math, gradients and the importer.
 * - Cross-shell tests: every preset (plus a stress prompt) is generated for bash, zsh and fish,
 *   executed in the real shells, and the rendered prompts must be byte-identical.
 *   Shells that are not installed are skipped.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const PG = require('./load.js');
const M = PG.model;

let passed = 0, failed = 0, skipped = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e.message).split('\n').join('\n    ')); }
}
function has(cmd) { return spawnSync('sh', ['-c', 'command -v ' + cmd], { encoding: 'utf8' }).status === 0; }

console.log('color');
test('hue shift: blue moves toward green, yellow toward red', () => {
  assert.strictEqual(PG.color.shiftHue('#0000ff', -60), '#00ffff');
  assert.strictEqual(PG.color.shiftHue('#ffff00', -30), '#ff8000');
});
test('saturation: -100 is gray, +100 is fully saturated, 0 is unchanged, grays stay gray', () => {
  const C = PG.color, hsl = (h) => C.rgbToHsl(C.hexToRgb(h));
  assert.strictEqual(hsl(C.adjustSaturation('#3b82f6', -100))[1], 0);
  assert.ok(hsl(C.adjustSaturation('#3b82f6', 100))[1] > 0.99);
  assert.strictEqual(C.adjustSaturation('#3b82f6', 0), '#3b82f6');
  assert.strictEqual(C.adjustSaturation('#808080', 100), '#808080');
  const half = hsl(C.adjustSaturation('#3b82f6', -50))[1], orig = hsl('#3b82f6')[1];
  assert.ok(Math.abs(half - orig / 2) < 0.01, 'half: ' + half);
  assert.ok(Math.abs(hsl(C.adjustSaturation('#3b82f6', -50))[0] - hsl('#3b82f6')[0]) < 1, 'hue kept');
});
test('hue and saturation combine from one snapshot and return to the original at 0/0', () => {
  const els = [M.make('text', { text: 'a', fg: '#3b82f6', bg: '#facc15' }), M.make('field', { field: 'exit', fg: '#22c55e', props: { failFg: '#ef4444' } })];
  const snap = PG.tools.snapshot(els);
  PG.tools.applyAdjust(els, snap, -60, -100, { fg: true, bg: false });
  assert.strictEqual(PG.color.rgbToHsl(PG.color.hexToRgb(els[0].fg))[1], 0);
  assert.strictEqual(els[0].bg, '#facc15', 'background layer was off');
  assert.strictEqual(PG.color.rgbToHsl(PG.color.hexToRgb(els[1].props.failFg))[1], 0, 'exit failure color too');
  PG.tools.applyAdjust(els, snap, 0, 0, { fg: true, bg: true });
  assert.deepStrictEqual([els[0].fg, els[0].bg, els[1].fg, els[1].props.failFg], ['#3b82f6', '#facc15', '#22c55e', '#ef4444']);
});
test('16 gradient presets with unique names and valid colors', () => {
  const g = PG.tools.GRADIENTS;
  assert.strictEqual(g.length, 16);
  assert.strictEqual(new Set(g.map((x) => x.name)).size, 16);
  g.forEach((x) => { assert.ok(x.stops.length >= 2, x.name); x.stops.forEach((c) => assert.ok(PG.color.hexToRgb(c), x.name + ' ' + c)); });
});
test('gradient hits its end stops', () => {
  const els = [M.make('text', { text: 'a' }), M.make('text', { text: 'bb' }), M.make('text', { text: 'c' })];
  PG.tools.applyGradient(els, ['#ff0000', '#0000ff'], { layer: 'fg' });
  assert.strictEqual(els[0].fg, '#ff0000');
  assert.strictEqual(els[2].fg, '#0000ff');
  assert.notStrictEqual(els[1].fg, els[0].fg);
});
test('gradient skips newlines and can target backgrounds', () => {
  const els = [M.make('text', { text: 'a' }), M.make('newline'), M.make('text', { text: 'b' })];
  PG.tools.applyGradient(els, ['#000000', '#ffffff'], { layer: 'bg', by: 'elements' });
  assert.strictEqual(els[0].bg, '#000000');
  assert.strictEqual(els[1].bg, null);
  assert.strictEqual(els[2].bg, '#ffffff');
});
test('256/16 color quantization', () => {
  assert.strictEqual(PG.color.nearest256('#ff0000'), 196);
  assert.strictEqual(PG.color.colorSgr('#f14c4c', 'fg', '16').join(';'), '91');
  assert.strictEqual(PG.color.colorSgr('#102030', 'bg', 'truecolor').join(';'), '48;2;16;32;48');
});

console.log('importer');
function kinds(res) { return res.elements.map((e) => e.kind === 'field' ? e.field : e.kind === 'text' ? JSON.stringify(e.text) : 'NL').join(' '); }
test('Debian default PS1', () => {
  const r = PG.importer.importPrompt("PS1='${debian_chroot:+($debian_chroot)}\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '");
  assert.strictEqual(r.syntax, 'bash');
  assert.strictEqual(kinds(r), 'env user "@" host ":" cwd promptChar " "');
  assert.ok(r.elements[1].bold && r.elements[1].fg);
});
test('tput colors and __git_ps1', () => {
  const r = PG.importer.importPrompt('PS1="\\[$(tput setaf 2)\\]\\u\\[$(tput sgr0)\\] $(__git_ps1 \' [%s]\')\\n> "');
  assert.strictEqual(kinds(r), 'user " " git NL "> "');
  assert.strictEqual(r.elements[0].fg, PG.color.XTERM256[2]);
  assert.deepStrictEqual([r.elements[2].props.pre, r.elements[2].props.suf], [' [', ']']);
});
test('oh-my-zsh robbyrussell becomes a status-colored arrow', () => {
  const r = PG.importer.importPrompt('PROMPT="%(?:%{$fg_bold[green]%}➜ :%{$fg_bold[red]%}➜ ) %{$fg[cyan]%}%c%{$reset_color%} $(git_prompt_info)"');
  assert.strictEqual(r.syntax, 'zsh');
  assert.strictEqual(r.elements[0].field, 'exit');
  assert.strictEqual(r.elements[0].props.tpl, '➜ ');
  assert.ok(r.elements.some((e) => e.field === 'cwdBase'));
  assert.ok(r.elements.some((e) => e.field === 'git'));
});
test('zsh %F/%B/%(!.#.$) and truecolor escapes', () => {
  const r = PG.importer.importPrompt("PROMPT=$'%F{#ff8800}%B%n%b%f %{\\e[38;2;1;2;3m%}%~%{\\e[0m%} %(!.#.$) '");
  assert.strictEqual(kinds(r), 'user " " cwd " " promptChar " "');
  assert.strictEqual(r.elements[0].fg, '#ff8800');
  assert.ok(r.elements[0].bold);
  assert.strictEqual(r.elements[2].fg, '#010203');
});

console.log('generators (real shells)');
const PWSH = process.env.PWSH || 'pwsh';
const shells = ['bash', 'zsh', 'fish', 'pwsh'].filter((s) => has(s === 'pwsh' ? PWSH : s));
['bash', 'zsh', 'fish', 'pwsh'].filter((s) => !shells.includes(s)).forEach((s) => { skipped++; console.log('  - skipped ' + s + ' (not installed)'); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-'));
const repo = path.join(tmp, 'work', 'my repo', 'project');
fs.mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'feature/x'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x');
const env = Object.assign({}, process.env, {
  HOME: tmp, USER: 'tester', LOGNAME: 'tester', PG_TEST_VAR: 'v$1`x`',
  VIRTUAL_ENV: path.join(tmp, 'proj', '.venv'), VIRTUAL_ENV_PROMPT: '(proj) ',
  SSH_CONNECTION: '', SSH_TTY: '', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'
});
delete env.SSH_CONNECTION; delete env.SSH_TTY;

const COLUMNS = 100;
/* PowerShell prefers the console's real width over $env:COLUMNS, so ask it what it will use. */
function pwshColumns() {
  const r = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command',
    '$c = 0; try { $c = $Host.UI.RawUI.WindowSize.Width } catch { }; if ($c -le 0 -and $env:COLUMNS) { $c = [int]$env:COLUMNS }; if ($c -le 0) { $c = 80 }; $c'],
    { env: Object.assign({ COLUMNS: String(COLUMNS) }, process.env), encoding: 'utf8' });
  return parseInt(r.stdout, 10) || COLUMNS;
}
const WIDTH = { bash: COLUMNS, pwsh: has(PWSH) ? pwshColumns() : COLUMNS };
const GLUE = /\x1b7\x1b\[(\d+)G([\s\S]*?)\x1b8/;

/*
 * Source the generated code in a real shell and render it for a given exit status and command
 * duration (ms). Returns { left, right, col } where col is the column bash/PowerShell move the
 * cursor to before printing the right prompt (they emulate it; zsh and fish have it built in).
 */
function render(shell, code, status, dur) {
  dur = dur || 0;
  const file = path.join(tmp, 'prompt.' + shell + (shell === 'pwsh' ? '.ps1' : ''));
  fs.writeFileSync(file, code);
  let args;
  if (shell === 'bash') {
    args = ['--norc', '--noprofile', '-c', 'source "$1"; __pg_status=' + status + '; __pg_dur=' + dur + '; printf "%s" "${PS1@P}"', 'x', file];
  } else if (shell === 'zsh') {
    args = ['-f', '-c', 'source "$1"; __pg_status=' + status + '; __pg_dur=' + dur + '; print -rnP -- "$PROMPT"; printf "\\0"; print -rnP -- "$RPROMPT"', 'x', file];
  } else if (shell === 'fish') {
    args = ['--no-config', '-c', 'source $argv[1]; set CMD_DURATION ' + dur + '; function __f; return ' + status + '; end; __f; fish_prompt; printf "\\0"; __f; fish_right_prompt', file];
  } else {
    const hist = dur ? '$t = [datetime]::Now; Add-History -InputObject ([pscustomobject]@{ CommandLine = "x"; ExecutionStatus = "Completed"; StartExecutionTime = $t.AddMilliseconds(-' + dur + '); EndExecutionTime = $t }); ' : '';
    args = ['-NoProfile', '-NonInteractive', '-Command', '. "' + file + '"; ' + hist + 'bash -c "exit ' + status + '"; [Console]::Out.Write((prompt))'];
  }
  const r = spawnSync(shell === 'pwsh' ? PWSH : shell, args, { cwd: repo, env: Object.assign({ COLUMNS: String(COLUMNS) }, env), encoding: 'utf8' });
  if (r.status !== 0 && r.stderr) throw new Error(shell + ' failed: ' + r.stderr);
  if (r.stderr) throw new Error(shell + ' stderr: ' + r.stderr);
  // bash leaves \001/\002 around non-printing sequences; zsh's %{ %} vanish. Normalize.
  let out = r.stdout.replace(/[\x01\x02]/g, '');
  if (shell === 'zsh' || shell === 'fish') {
    const i = out.indexOf('\0');
    return { left: out.slice(0, i), right: out.slice(i + 1), col: null };
  }
  const m = out.match(GLUE);
  return { left: out.replace(GLUE, ''), right: m ? m[2] : '', col: m ? +m[1] : null };
}

/* Presets may return a bare list (left only) or { left, right }. */
function parts(built) { return Array.isArray(built) ? { left: built, right: [] } : { left: built.left, right: built.right || [] }; }

/* Times change between shell runs, so pin every time field to the year. */
function stable(els) { return (els || []).map((e) => { const c = JSON.parse(JSON.stringify(e)); if (c.field === 'time') c.props.fmt = '%Y'; return c; }); }

const stress = [
  M.make('text', { text: "q'u\"o$HOME`id`\\n%{x}%% ", fg: '#ff0000', bold: true, italic: true }),
  M.make('field', { field: 'user', underline: true }), M.make('text', { text: '@' }), M.make('field', { field: 'host', reverse: true }),
  M.make('field', { field: 'cwd', bg: '#123456' }), M.make('text', { text: ' ' }), M.make('field', { field: 'cwdBase', dim: true }),
  M.make('text', { text: ' ' }), M.make('field', { field: 'cwdTrim', props: { depth: 2 } }), M.make('field', { field: 'cwdAbs', strike: true }),
  M.make('field', { field: 'git', props: { pre: " ('$x", suf: '`)' } }), M.make('field', { field: 'gitDirty', props: { text: ' *%' } }),
  M.make('field', { field: 'venv', props: { pre: '[', suf: ']' } }),
  M.make('field', { field: 'env', props: { name: 'PG_TEST_VAR', pre: '<', suf: '>' } }),
  M.make('field', { field: 'env', props: { name: 'PG_UNSET_VAR', pre: '<', suf: '>' } }),
  M.make('field', { field: 'ssh', props: { text: 'SSH ' } }),
  M.make('field', { field: 'cmd', props: { cmd: 'echo a%sb' } }),
  M.make('field', { field: 'time', props: { fmt: '%Y' } }),
  M.make('newline'),
  M.make('field', { field: 'exit', fg: '#00ff00', props: { tpl: 'rc={code}{code}', hideOk: false, failFg: '#ff5555', failBg: '#220000' } }),
  M.make('field', { field: 'exit', props: { tpl: " ✘'{code}", hideOk: true } }),
  M.make('field', { field: 'jobs' }), M.make('field', { field: 'promptChar', blink: true }), M.make('text', { text: ' ' })
];

const stressRight = [
  M.make('field', { field: 'exit', fg: '#00ff00', props: { tpl: '✘ {code} ', hideOk: true, failFg: '#ff0000' } }),
  M.make('field', { field: 'duration', fg: '#ffff00', props: { min: 2, pre: "took '%", suf: '$ ' } }),
  M.make('field', { field: 'git', props: { pre: '⎇ ', suf: ' ' } }),
  M.make('text', { text: '%$`\\', italic: true }), M.make('field', { field: 'time', props: { fmt: '%Y' } })
];
const cases = [{ name: 'stress prompt', left: stress, right: stressRight }].concat(PG.presets.map((p) => {
  const b = parts(p.build());
  return { name: 'preset: ' + p.name, left: stable(b.left), right: stable(b.right) };
}));
const plain = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');
if (shells.length) {
  for (const c of cases) {
    for (const mode of ['truecolor', '256', '16']) {
      if (mode !== 'truecolor' && c.name !== 'stress prompt') continue;
      test(c.name + ' [' + mode + '] renders identically in ' + shells.join(', '), () => {
        for (const [status, dur] of [[0, 0], [3, 4213]]) {
          const out = {};
          for (const sh of shells) out[sh] = render(sh, PG.gen.generate(sh, c.left, mode, c.right), status, dur);
          const ref = out[shells[0]];
          for (const sh of shells) {
            const what = 'status ' + status + ', ' + dur + 'ms: ' + sh + ' differs from ' + shells[0];
            assert.strictEqual(JSON.stringify(out[sh].left), JSON.stringify(ref.left), what + ' (left)');
            assert.strictEqual(JSON.stringify(out[sh].right), JSON.stringify(ref.right), what + ' (right)');
            if (out[sh].col != null && ref.right) {
              assert.strictEqual(out[sh].col, WIDTH[sh] - Array.from(plain(ref.right)).length + 1, sh + ' right prompt column');
            }
          }
          assert.ok(ref.left.length > 0, 'empty prompt');
          if (c.right.length) assert.ok(ref.right.length > 0, 'empty right prompt');
        }
      });
    }
  }
  test('command duration formatting matches the preview in every shell', () => {
    const els = [M.make('field', { field: 'duration', props: { min: 0, pre: '', suf: '' } }), M.make('text', { text: '|' }),
      M.make('field', { field: 'duration', props: { min: 0, style: 'seconds', pre: '', suf: '' } })];
    for (const ms of [5, 999, 4213, 59999, 65400, 3725000]) {
      const want = M.fmtDuration(ms, 'auto') + '|' + M.fmtDuration(ms, 'seconds');
      for (const sh of shells) assert.strictEqual(plain(render(sh, PG.gen.generate(sh, els), 0, ms).left), want, sh + ' @ ' + ms + 'ms');
    }
  });
  test('duration below the threshold is hidden', () => {
    const els = [M.make('text', { text: '[' }), M.make('field', { field: 'duration', props: { min: 5, pre: 'took ', suf: '' } }), M.make('text', { text: ']' })];
    for (const sh of shells) {
      assert.strictEqual(plain(render(sh, PG.gen.generate(sh, els), 0, 4999).left), '[]', sh);
      assert.strictEqual(plain(render(sh, PG.gen.generate(sh, els), 0, 5000).left), '[took 5.0s]', sh);
    }
  });
  test('stress prompt shows the expected text (bash)', () => {
    const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const ok = plain(render(shells[0], PG.gen.generate(shells[0], stress, 'truecolor'), 0).left);
    const bad = plain(render(shells[0], PG.gen.generate(shells[0], stress, 'truecolor'), 3).left);
    assert.ok(ok.startsWith("q'u\"o$HOME`id`\\n%{x}%% " + os.userInfo().username + '@'), ok);
    assert.ok(ok.includes("~/work/my repo/project"), ok);
    assert.ok(ok.includes(" ('$xfeature/x`) *%[proj]<v$1`x`>a%sb"), ok);
    assert.ok(ok.includes('\nrc=00'), ok);
    assert.ok(!ok.includes('✘'), 'hide-on-success exit code shown: ' + ok);
    assert.ok(bad.includes("\nrc=33 ✘'3"), bad);
  });
  if (shells.includes('bash')) {
    test('bash: child shells such as su do not inherit a PS1 they cannot run', () => {
      const file = path.join(tmp, 'su.bash');
      fs.writeFileSync(file, PG.gen.generate('bash', stress, 'truecolor', stressRight));
      // A pre-existing `export PS1=...` must not leak the generated PS1 into child shells.
      const r = spawnSync('bash', ['--norc', '--noprofile', '-c', 'export PS1=old; source "$1"; bash --norc --noprofile -c \'printf "%s" "${PS1-unset}"\'', 'x', file], { cwd: repo, env, encoding: 'utf8' });
      assert.strictEqual(r.stderr, '');
      assert.strictEqual(r.stdout, 'unset');
    });
  }
  test('exit code uses failure colors only on non-zero status', () => {
    const els = [M.make('field', { field: 'exit', fg: '#00ff00', props: { tpl: '{code}', failFg: '#ff0000' } })];
    for (const sh of shells) {
      assert.ok(render(sh, PG.gen.generate(sh, els), 0).left.includes('38;2;0;255;0m0'), sh + ' success');
      assert.ok(render(sh, PG.gen.generate(sh, els), 1).left.includes('38;2;255;0;0m1'), sh + ' failure');
    }
  });
}

console.log('round-trip import');
const noDesign = (code) => code.split('\n').filter((l) => !l.includes(PG.gen.DESIGN_TAG)).join('\n');
const bare = (list) => JSON.stringify((list || []).map((e) => { const c = Object.assign({}, e); delete c.id; return c; }));
test('a generated snippet imports back exactly (design line), every shell', () => {
  for (const c of cases) {
    for (const sh of ['bash', 'zsh', 'fish', 'pwsh']) {
      const r = PG.importer.importPrompt(PG.gen.generate(sh, c.left, 'truecolor', c.right));
      assert.ok(r.exact, c.name + ' ' + sh + ': design line not used');
      assert.strictEqual(bare(r.elements), bare(c.left), c.name + ' ' + sh + ' (left)');
      assert.strictEqual(bare(r.right), bare(c.right.filter((e) => e.kind !== 'newline')), c.name + ' ' + sh + ' (right)');
    }
  }
});
test('older snippets without the design line still import to the same prompt (bash, zsh)', () => {
  for (const c of cases) {
    for (const sh of ['bash', 'zsh']) {
      for (const mode of ['truecolor', '256']) {
        const code = noDesign(PG.gen.generate(sh, c.left, mode, c.right));
        const r = PG.importer.importPrompt(code);
        assert.ok(!r.exact);
        assert.deepStrictEqual(r.warnings, [], c.name + ' ' + sh);
        // Adjacent texts may merge and colors come back quantized, so compare the regenerated code.
        assert.strictEqual(noDesign(PG.gen.generate(sh, r.elements, mode, r.right || [])), code, c.name + ' ' + sh + ' ' + mode);
      }
    }
  }
});
test('exit code fields come back as exit code fields, with their failure colors', () => {
  const els = [M.make('field', { field: 'exit', fg: '#00ff00', bold: true, props: { tpl: '✘ {code}', hideOk: true, failFg: '#ff0000', failBg: '#330000' } })];
  for (const sh of ['bash', 'zsh']) {
    const e = PG.importer.importPrompt(noDesign(PG.gen.generate(sh, els))).elements[0];
    assert.strictEqual(e.field, 'exit', sh);
    assert.deepStrictEqual([e.fg, e.bold, e.props.tpl, e.props.hideOk, e.props.failFg, e.props.failBg], ['#00ff00', true, '✘ {code}', true, '#ff0000', '#330000'], sh);
  }
});
test('pasting only $PS1 of a generated prompt explains what is missing', () => {
  const code = noDesign(PG.gen.generate('bash', PG.presets.find((p) => p.name === 'Starship Style').build()));
  const ps1 = code.split('\n').find((l) => l.startsWith('PS1='));
  const r = PG.importer.importPrompt(ps1);
  assert.ok(r.warnings.some((w) => /whole snippet/.test(w)), JSON.stringify(r.warnings));
});
test('bash escapes: \\\\ \\$ \\` are a literal backslash, dollar and backtick', () => {
  const r = PG.importer.importPrompt("PS1='a\\\\\\\\b\\\\$c\\\\`d'");
  assert.strictEqual(r.elements.map((e) => e.text).join(''), 'a\\b$c`d');
});

test('PowerShell output is well-formed', () => {
  for (const c of cases) {
    const code = PG.gen.generate('pwsh', c.left, 'truecolor', c.right);
    assert.ok(/function prompt \{[\s\S]*return \$o\n\}/.test(code), c.name);
    const opens = (code.match(/\{/g) || []).length, closes = (code.match(/\}/g) || []).length;
    // Braces inside single-quoted strings are balanced in our templates, so the totals must match.
    assert.strictEqual(opens, closes, c.name + ' has unbalanced braces');
  }
});
if (has(PWSH)) {
  test('PowerShell parses the generated code', () => {
    for (const c of cases) {
      const file = path.join(tmp, 'p.ps1');
      fs.writeFileSync(file, PG.gen.generate('pwsh', c.left, 'truecolor', c.right));
      const r = spawnSync(PWSH, ['-NoProfile', '-Command', '$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile("' + file + '", [ref]$null, [ref]$e); if ($e.Count) { $e | % { $_.Message }; exit 1 }'], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, c.name + ': ' + r.stdout);
    }
  });
} else { skipped++; console.log('  - skipped PowerShell parse check (pwsh not installed)'); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(failed ? 1 : 0);
