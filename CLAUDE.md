# CLAUDE.md

Guidance for Claude (and other contributors) working on **Command Prompt Generator**: a browser-based visual builder for shell prompts (bash, zsh, fish, PowerShell). Live at https://singularity098.github.io/command-prompt-generator/.

**Keep this file current.** When a change adds a convention, a compatibility promise, a gotcha or a workflow step, update this file in the same commit. Also keep `README.md` (user-facing features) and `docs/DESIGN.md` (requirement mapping and shell notes) in sync with behavior changes.

## Hard constraints

- **No dependencies, no build step.** Plain HTML/CSS/JS. No npm packages, CDNs, web fonts or network requests at runtime.
- **Must work from `file://`.** Scripts are classic `<script>` tags sharing a global `PG` namespace, not ES modules (modules don't load over `file://`). Load order in `index.html` matters: `color → fields → generate → importer → tools → presets → app`.
- **Desktop and mobile.** Drag and drop uses Pointer Events (tap to add, long-press to drag on touch). Check phone width for horizontal overflow after layout changes.
- **Dark theme by default**; light theme via `data-theme="light"`. Colors are CSS variables in `css/style.css`.
- `REQUIREMENTS.md` is the owner's original requirements file. Don't edit it.

## Layout

```
index.html        page shell (header, palette, editor, preview, inspector, output, modals)
css/style.css     all styles
js/color.js       color math: HSL/OKLab, hue/saturation/brightness, gradients, 256/16-color quantization
js/fields.js      element model (PG.model), field catalogue + preview samples, palette, symbols, strftime
js/generate.js    shell code generators (PG.gen.generate(shell, left, mode, right))
js/importer.js    PS1/PROMPT/snippet parser (PG.importer.importPrompt)
js/tools.js       hue/saturation/brightness adjust + gradient tools, gradient presets
js/presets.js     built-in presets (build() returns a list or { left, right })
js/app.js         UI: state, undo/redo, rendering, drag and drop, inspector, import/export
tests/load.js     loads the browser scripts into Node
tests/run.js      the test suite
docs/DESIGN.md    design doc and requirement mapping
.github/workflows test.yml (CI) and pages.yml (deploy)
```

Element model: `{ id, kind: 'text'|'field'|'newline', text?, field?, props?, fg, bg, bold, dim, italic, underline, blink, reverse, strike }`. Right prompts are single-line (no newlines).

## Commands

```
node tests/run.js                              # full suite; skips shells that aren't installed
PWSH=/path/to/pwsh node tests/run.js           # include PowerShell when it isn't on PATH
```

Tests need bash, zsh and fish (and ideally PowerShell) installed: the cross-shell tests source the generated code in each real shell and require **byte-identical** left and right output for every preset plus a stress prompt, in all three color modes. In a fresh container: `apt-get install -y zsh fish`. PowerShell can be fetched as the official Linux tarball from the PowerShell GitHub releases page and pointed to with `PWSH=`.

For UI changes, also drive the page with the preinstalled Playwright/Chromium (open `file:///.../index.html`), check for page errors, and take a screenshot. **Write scratch screenshots outside the repo**; `/*.png` at the repo root is git-ignored for this reason. README screenshots live in `docs/screenshots/`.

## Shell generator rules (hard-won; don't regress)

- **Every element starts with a full SGR reset** (`0;...`) whenever its look changes, so styles never leak between elements.
- **Bash text escaping inside `PS1='...'`:** `\` → `\\\\`, `$` → `\\$`, `` ` `` → ``\\` ``, `'` → `'\''`. Prompt decoding runs first, then expansion; verified with `${PS1@P}`.
- **Bash non-printing sequences** go in `\[ \]`. Dynamic fields are small generated functions `__pg_fN() { ...; }` called as `$(__pg_fN)`, so their arguments use normal shell quoting instead of PS1 decoding.
- **The bash snippet ends with `export -n PS1`.** Without it, an older `export PS1` leaks the prompt into `su` and child shells, which lack the `__pg_*` functions (`__pg_f1: command not found`).
- **Zsh:** `PROMPT=$'...'` with `PROMPT_SUBST`. Text is escaped for `$'...'` and for prompt expansion (`%` → `%%`). zsh re-expands `%` in `$(...)` output, so every generated zsh function doubles `%` in its output.
- **Exit status:** bash/zsh save `$?` in `__pg_save_status`, which runs first (prepended to `PROMPT_COMMAND`, string or array form; or `precmd_functions`). fish and PowerShell read `$status` / `$?` on the first line of the prompt function.
- **Duration:** bash uses a DEBUG trap + `$EPOCHREALTIME` (`__pg_timer_start` / `__pg_save_status` / `__pg_timer_reset` at the end of `PROMPT_COMMAND`); zsh uses `preexec`/`precmd`; fish uses `$CMD_DURATION`; PowerShell uses history timestamps. The JS `fmtDuration` must match the shells' `__pg_fmt_dur` exactly (tested).
- **Right prompt:** native in zsh (`RPROMPT`) and fish (`fish_right_prompt`). Bash and PowerShell emulate it: save cursor, move to column, print, restore (`ESC 7`, `ESC [nG`, `ESC 8`), placed at the start of the last line. PowerShell takes the console width, then `$env:COLUMNS`, then 80; on CI the console is 80 columns.

## Compatibility promises

- **Snippets round-trip.** Every generated snippet has a `# command-prompt-generator-design: {...}` JSON comment, and Import restores it exactly. Import also accepts the old tags `command-prompt-gen-design:` and `prompt-generator-design:`.
- **Older bash/zsh snippets without the design line** are rebuilt from their `__pg_fN` helper bodies. If you change a helper's shape in `generate.js`, update `handleGenerated` in `importer.js`. The round-trip tests regenerate byte-identical code from the imported elements.
- **Keep the `__pg_` prefix** and the helper names (`__pg_git`, `__pg_exit_sgr`, `__pg_exit_text`, `__pg_duration`, ...) stable, since installed snippets depend on them.
- **Saved browser work:** `localStorage` key `command-prompt-generator:v1`. The older keys `command-prompt-gen:v1` and `prompt-generator:v1` are still read. Share links encode the design in `#p=...`.
- **Snippet markers:** `# >>> command-prompt-generator (<shell>) >>>` … `# <<< ... <<<`.

## UI behaviors worth knowing

- Hue, saturation and brightness sliders share one snapshot taken on the first move. They're relative, combine in any order, and 0/0/0 or Reset restores the original colors. Any other edit or selection change drops the snapshot.
- Keyboard shortcuts skip text inputs. Undo/redo still work while a slider, checkbox or button has focus, but editor keys (arrows, Delete) do not.
- The terminal preview follows the shell's default colors until the user picks their own: near-black, or classic Windows PowerShell blue `#012456`/`#eeedf0` for PowerShell.
- Import accepts pasted text or `.txt`/`.env` files up to 1 MB (extension checked in code). Download saves `prompt-<shell>.env`.
- Inspector for the exit code lists success colors first, then failure colors. Labels follow the pattern "Text color (success)".

## Workflow

- The owner works directly on `main`: make the change, run `node tests/run.js` (plus a browser check for UI work), commit, push.
- CI (`test.yml`) runs the suite with bash, zsh, fish and PowerShell. `pages.yml` deploys `index.html`, `css/`, `js/` and `LICENSE` to GitHub Pages after `test` passes on `main`, or on manual dispatch.
- After pushing, confirm CI (and the Pages deploy) went green.
- License: MIT.
