# Design

## Goals and constraints

- **No dependencies.** Plain HTML, CSS and JavaScript. No build step, no CDN, no web fonts. The app works when `index.html` is opened from disk, so scripts are classic `<script>` tags rather than ES modules (modules don't load over `file://`).
- **Desktop and mobile.** The layout adapts across three breakpoints, and drag-and-drop is built on Pointer Events so it works with mouse, touch and pen.
- **Correct output in every shell.** Each shell gets its own generator with its own escaping rules, verified by running the code in the real shells (see *Testing*).

## Architecture

```
          ┌──────────────┐   elements[]   ┌──────────────┐
palette ─▶│   editor     │──────────────▶ │  generators  │──▶ bash / zsh / fish / pwsh code
symbols   │  (app.js)    │                │ (generate.js)│
importer ─▶              │──▶ preview     └──────────────┘
          └──────────────┘    (sample values from fields.js)
```

Everything is driven by one ordered list of **elements**:

```js
{ id, kind: 'text' | 'field' | 'newline',
  text?,                 // for text
  field?, props?,        // for fields, e.g. { field: 'git', props: { pre: ' (', suf: ')' } }
  fg, bg,                // '#rrggbb' or null (terminal default)
  bold, dim, italic, underline, blink, reverse, strike }
```

- `fields.js` holds the field catalogue. Each field has a label, default props and a `sample()` function used by the preview and the editor chips.
- `generate.js` turns the list into shell code. Every element starts with a full SGR sequence (`0;…`) whenever its look differs from the previous element. That keeps the code simple and makes elements independent: no attribute can "leak" into the next one.
- `app.js` owns the state, undo/redo history (JSON snapshots, with rapid edits such as dragging a color picker merged into one step), rendering and persistence.

## Requirement mapping

| Requirement | How it is met |
| --- | --- |
| Beautiful interface, dark theme by default | Custom design system in `css/style.css` (CSS variables). `data-theme="dark"` by default, with a light theme toggle. |
| Works in a browser with no dependencies | Static files only. No network requests. |
| Desktop and mobile | Three-column grid on desktop, two columns on tablets, a single column on phones (preview first). Touch: tap to add, press and hold to drag. Page scrolling is blocked only while a drag is active. |
| bash, zsh, fish, etc. (user chooses) | Shell selector in the header. Generators for bash (`PS1`), zsh (`PROMPT` with `PROMPT_SUBST`), fish (`fish_prompt`) and PowerShell (`prompt`). |
| Per-element background and foreground colors | Inspector color pickers, quick swatches and a "Default" option per layer. Works on a multi-selection too. |
| Drag elements into a visual editor; preview in a dummy shell with adjustable, near-black default color | Pointer-based drag and drop with a drop marker. Drag out to delete. The terminal preview has adjustable BG/FG (default `#0a0a0c`) and shows success and failure prompts. |
| Import an existing PS1 | `importer.js`: unquotes `PS1='…'`, `"…"` and `$'…'`, auto-detects bash vs zsh, and maps escapes, SGR codes, `tput`, git helpers, env vars and zsh conditionals to elements. |
| Exit code with conditional highlight via a provided function; red by default | `exit` field with a template (`{code}`), "hide on success" option, and failure colors (default `#ff5555`). bash/zsh capture `$?` in a `PROMPT_COMMAND` / `precmd` hook (`__pg_save_status`); the generated `__pg_exit_sgr` / `__pg_exit_text` helpers choose the colors. fish and PowerShell capture `$status` / `$?` on the first line of the prompt function. |
| Hue slider across several selected fields | The hue slider rotates HSL hue for the selection (or everything) relative to a snapshot taken when the drag starts, so the shift is reversible and doesn't accumulate. −60° turns blue into teal/cyan and −30° turns yellow into orange. |
| Gradient across all fields with 2+ colors | 2–8 stops, eight preset gradients, text or background, OKLab/HSL/RGB interpolation. Position is by character width (default, so long fields cover more of the gradient) or by element. |
| Bold, italic, etc. | Bold, dim, italic, underline, blink, reverse and strikethrough, shown in the preview with CSS. |
| Time in many formats | 15 preset `strftime` formats plus custom. Emitted as `\D{…}` (bash), `%D{…}` (zsh), `date +…` (fish) and `Get-Date -UFormat` (PowerShell). |
| Thorough choice of common fields | User, host, FQDN, `$`/`#`, SSH indicator, 4 directory styles, time, exit code, jobs, history, git branch, git dirty, venv/conda, shell name/version, TTY, any env var, any command (with Node, kube context and AWS profile shortcuts). |
| Common special characters | Symbols tab: prompt arrows, punctuation, box drawing, Powerline/Nerd glyphs and emoji, plus custom text. |
| Copy button | Copies the complete snippet (`navigator.clipboard`, with an `execCommand` fallback for `file://`). |
| Export as text file | "Download .txt" saves `prompt-<shell>.txt`. |
| About a dozen presets | 16 presets in `js/presets.js`, shown in a gallery that renders each one. |

## Shell-specific notes

### Bash

- Non-printing sequences are wrapped in `\[ \]` so line editing measures the prompt correctly.
- Literal text is escaped for prompt decoding *and* the expansion that follows it: `\` → `\\\\`, `$` → `\\$`, `` ` `` → ``\\` ``. These were verified empirically with `${PS1@P}`.
- Dynamic fields (git, venv, env vars, commands, SSH) are tiny generated functions (`__pg_fN`) referenced as `$(__pg_fN)`. Their arguments are written with ordinary shell quoting instead of passing through PS1 decoding.
- `__pg_save_status` is prepended to `PROMPT_COMMAND` (idempotently) so the exit code survives other hooks.

### Zsh

- `PROMPT=$'…'` with `PROMPT_SUBST`. Text is escaped for `$'…'`, then for prompt expansion (`%` → `%%`, `$`/`` ` `` backslashed).
- zsh re-runs `%` expansion on the output of `$(…)`, so every generated function doubles any `%` in its output. The cross-shell tests caught this.
- `__pg_save_status` is prepended to `precmd_functions`.

### Fish

- `fish_prompt` prints each piece with `printf`. Colors are raw SGR, so all three color modes behave the same as in the other shells.

### PowerShell

- `function prompt` builds a string. `$?` and `$LASTEXITCODE` are read on the first line; a cmdlet failure without a native exit code is reported as `1`.
- `$` / `#` uses `id -u` on Linux/macOS and an Administrator check on Windows.

### Color modes

- **Truecolor**: `38;2;r;g;b`.
- **256**: nearest xterm-256 color, skipping 0–15 because those depend on the user's theme.
- **16**: nearest ANSI color (`30–37`, `90–97`). The preview shows the quantized colors so what you see matches the output.

## Testing

`node tests/run.js` runs:

1. Unit tests for hue shifting, gradients, quantization and the importer (Debian default, tput + `__git_ps1`, robbyrussell, zsh `%F`/truecolor).
2. Cross-shell rendering. Every preset and a deliberately hostile "stress" prompt are generated for each shell, sourced in the real shell (inside a temporary git repo, with env vars, venv and exit status 0 and 3) and rendered: `${PS1@P}` in bash, `print -P` in zsh, `fish_prompt`, and `prompt` in PowerShell. Every shell's output must be byte-identical. Missing shells are skipped locally; CI installs all of them.

## Possible future work

- Right-side prompts (`RPROMPT`, fish `fish_right_prompt`).
- Command duration and battery fields.
- Auto-generated Powerline separators that follow neighbouring background colors.
- Import from fish and PowerShell prompt functions.
