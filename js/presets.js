/* Built-in prompt presets, modeled on popular PS1 styles. */
(function (PG) {
  'use strict';

  var M = PG.model;

  function T(text, o) { return M.make('text', Object.assign({ text: text }, o || {})); }
  function F(field, o, props) { return M.make('field', Object.assign({ field: field, props: props }, o || {})); }
  function NL() { return M.make('newline'); }
  function X(tpl, o, fail, hideOk) { return F('exit', o, { tpl: tpl, failFg: fail || '#ff5555', hideOk: !!hideOk }); }

  var PL = ''; // powerline right arrow
  var PRESETS = [
    {
      name: 'Debian Classic',
      desc: 'The familiar green user@host and blue path from Debian/Ubuntu.',
      build: function () {
        var g = { fg: '#8ae234', bold: true }, b = { fg: '#729fcf', bold: true };
        return [F('user', g), T('@', g), F('host', g), T(':'), F('cwd', b), F('promptChar'), T(' ')];
      }
    },
    {
      name: 'Fedora / RHEL',
      desc: 'Bracketed user@host with the directory name.',
      build: function () {
        var d = { fg: '#a1a1aa' };
        return [T('[', d), F('user', { fg: '#e4e4e7' }), T('@', d), F('host', { fg: '#e4e4e7' }), T(' '), F('cwdBase', { fg: '#60a5fa' }), T(']', d), F('promptChar'), T(' ')];
      }
    },
    {
      name: 'Kali Two-Line',
      desc: 'The box-drawing two-line prompt from Kali Linux.',
      build: function () {
        var line = { fg: '#3b82f6' }, id = { fg: '#60a5fa', bold: true };
        return [
          T('┌──(', line), F('user', id), T('㉿', id), F('host', id), T(')-[', line), F('cwd', { fg: '#f4f4f5', bold: true }), T(']', line),
          F('exit', line, { tpl: '-[{code}]', hideOk: true, failFg: '#ef4444' }),
          NL(), T('└─', line), F('promptChar', id), T(' ')
        ];
      }
    },
    {
      name: 'Robby Russell',
      desc: 'Oh My Zsh\'s default theme: status arrow, directory and git.',
      build: function () {
        return [
          X('➜ ', { fg: '#23d18b', bold: true }, '#f14c4c'), T(' '), F('cwdBase', { fg: '#29b8db', bold: true }),
          F('git', { fg: '#f14c4c', bold: true }, { pre: ' git:(', suf: ')' }), F('gitDirty', { fg: '#f5f543' }, { text: ' ✗' }), T(' ')
        ];
      }
    },
    {
      name: 'Pure',
      desc: 'Minimal two-line prompt by sindresorhus: path, branch, then ❯.',
      build: function () {
        return [
          NL(), F('cwd', { fg: '#5fafff' }), F('git', { fg: '#6c6c6c' }, { pre: ' ', suf: '' }), F('gitDirty', { fg: '#d7afd7' }, { text: '*' }),
          NL(), X('❯', { fg: '#d75fd7' }, '#ff5f5f'), T(' ')
        ];
      }
    },
    {
      name: 'Agnoster Powerline',
      desc: 'Solid powerline segments. Needs a Powerline/Nerd Font.',
      build: function () {
        var ctx = { fg: '#e4e4e7', bg: '#27272a' }, dir = { fg: '#0b0b0e', bg: '#3b82f6' }, git = { fg: '#0b0b0e', bg: '#22c55e' };
        return [
          T(' ', ctx), F('user', ctx), T('@', ctx), F('host', ctx), T(' ', ctx),
          T(PL, { fg: '#27272a', bg: '#3b82f6' }), T(' ', dir), F('cwd', dir), T(' ', dir),
          T(PL, { fg: '#3b82f6', bg: '#22c55e' }), F('git', git, { pre: '  ', suf: ' ' }), F('gitDirty', git, { text: '± ' }),
          T(PL, { fg: '#22c55e' }), T(' ')
        ];
      }
    },
    {
      name: 'Minimal Lambda',
      desc: 'Just the folder and a λ.',
      build: function () {
        return [F('cwdBase', { fg: '#a78bfa' }), X(' λ ', { fg: '#f472b6', bold: true }, '#ef4444')];
      }
    },
    {
      name: 'Timestamped',
      desc: 'Clock first, handy for long-running sessions and logs.',
      build: function () {
        var d = { fg: '#71717a' };
        return [
          T('[', d), F('time', { fg: '#facc15' }, { fmt: '%H:%M:%S' }), T('] ', d),
          F('user', { fg: '#4ade80' }), T('@', d), F('host', { fg: '#22d3ee' }), T(':', d), F('cwd', { fg: '#60a5fa' }), F('promptChar', d), T(' ')
        ];
      }
    },
    {
      name: 'Starship Style',
      desc: 'Directory, branch and venv, then a status-colored arrow.',
      build: function () {
        return [
          F('venv', { fg: '#facc15' }, { pre: '🐍 ', suf: ' ' }),
          F('cwd', { fg: '#22d3ee', bold: true }),
          F('git', { fg: '#c084fc', bold: true }, { pre: ' on ⎇ ', suf: '' }), F('gitDirty', { fg: '#f87171', bold: true }, { text: ' [!]' }),
          F('exit', { fg: '#fbbf24' }, { tpl: ' ✘{code}', hideOk: true, failFg: '#f87171' }),
          NL(), X('❯', { fg: '#4ade80', bold: true }, '#f87171'), T(' ')
        ];
      }
    },
    {
      name: 'Dracula',
      desc: 'Colors from the Dracula palette.',
      build: function () {
        var dim = { fg: '#6272a4' };
        return [
          F('user', { fg: '#ff79c6', bold: true }), T(' at ', dim), F('host', { fg: '#8be9fd' }), T(' in ', dim), F('cwd', { fg: '#50fa7b', bold: true }),
          F('git', { fg: '#bd93f9' }, { pre: ' (', suf: ')' }), NL(), X('➜ ', { fg: '#f1fa8c' }, '#ff5555')
        ];
      }
    },
    {
      name: 'Nord Box',
      desc: 'Rounded two-line frame in Nord frost colors.',
      build: function () {
        var frame = { fg: '#4c566a' };
        return [
          T('╭─ ', frame), F('user', { fg: '#88c0d0', bold: true }), T(' ', frame), F('cwd', { fg: '#81a1c1' }), F('git', { fg: '#a3be8c' }, { pre: '  ', suf: '' }),
          T(' ', frame), F('time', { fg: '#4c566a' }, { fmt: '%H:%M' }),
          NL(), T('╰─', frame), X('❯ ', { fg: '#8fbcbb' }, '#bf616a')
        ];
      }
    },
    {
      name: 'Gruvbox Pills',
      desc: 'Rounded segments in Gruvbox tones. Needs a Nerd Font.',
      build: function () {
        var a = { fg: '#282828', bg: '#d79921', bold: true }, b = { fg: '#282828', bg: '#689d6a' }, c = { fg: '#282828', bg: '#b16286' };
        return [
          T('', { fg: '#d79921' }), F('user', a), T('', { fg: '#d79921' }), T(' '),
          T('', { fg: '#689d6a' }), F('cwdTrim', b, { depth: 2 }), T('', { fg: '#689d6a' }), T(' '),
          T('', { fg: '#b16286' }), F('time', c, { fmt: '%H:%M' }), T('', { fg: '#b16286' }),
          X(' ❯ ', { fg: '#ebdbb2' }, '#fb4934')
        ];
      }
    },
    {
      name: 'Matrix',
      desc: 'Phosphor green on black.',
      build: function () {
        var g = { fg: '#00ff41' }, d = { fg: '#008f11' };
        return [F('user', g), T('@', d), F('host', g), T(':', d), F('cwd', { fg: '#00ff41', bold: true }), F('promptChar', d), T(' ')];
      }
    },
    {
      name: 'Retro Amber',
      desc: 'Amber terminal with a timestamp.',
      build: function () {
        var a = { fg: '#ffb000' }, d = { fg: '#b37a00' };
        return [F('time', d, { fmt: '%H:%M' }), T(' ', d), F('user', a), T(':', d), F('cwdBase', { fg: '#ffcc00', bold: true }), T(' > ', a)];
      }
    },
    {
      name: 'Sunset Gradient',
      desc: 'user@host:path painted with a warm gradient.',
      build: function () {
        var els = [F('user', { bold: true }), T('@'), F('host', { bold: true }), T(':'), F('cwd'), F('git', {}, { pre: ' ', suf: '' }), T(' ❯ ', { bold: true })];
        PG.tools.applyGradient(els, ['#ff512f', '#f09819', '#dd2476'], { layer: 'fg' });
        return els;
      }
    },
    {
      name: 'Root Alert',
      desc: 'Bold red background so a root shell is impossible to miss.',
      build: function () {
        return [
          T(' ', { bg: '#b91c1c' }), F('user', { fg: '#ffffff', bg: '#b91c1c', bold: true }), T('@', { fg: '#fecaca', bg: '#b91c1c' }), F('host', { fg: '#ffffff', bg: '#b91c1c', bold: true }), T(' ', { bg: '#b91c1c' }),
          T(' '), F('cwd', { fg: '#fca5a5' }), T(' '), F('promptChar', { fg: '#ef4444', bold: true }), T(' ')
        ];
      }
    }
  ];

  PG.presets = PRESETS;
})(typeof window !== 'undefined' ? (window.PG = window.PG || {}) : (globalThis.PG = globalThis.PG || {}));
