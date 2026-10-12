# Prompt Generator

A visual builder for shell prompts that runs in the browser. Drag fields and symbols into an editor, style each one, watch it in a live terminal preview, then copy the code for **bash**, **zsh**, **fish** or **PowerShell**.

It has no dependencies, no build step and no server. Open `index.html` in any modern desktop or mobile browser.

![Prompt Generator on desktop](docs/screenshots/desktop.png)

<p><img src="docs/screenshots/presets.png" alt="Preset gallery" width="68%"> <img src="docs/screenshots/mobile.png" alt="Prompt Generator on a phone" width="28%"></p>

## Features

- **Drag-and-drop editor.** Drag elements in, drag to reorder, and drag out to remove. Works with mouse and touch: on touch screens, tap to add or press and hold to drag.
- **Per-element styling.** Text and background colors (or the terminal default), plus bold, italic, underline, strikethrough, dim, blink and reverse.
- **Live preview.** A dummy terminal shows a successful command and a failing one, so exit-code colors are visible. The terminal colors are adjustable and default to near-black. The preview environment (user, host, directory, git state, venv, SSH, root) can be edited.
- **Exit code.** Shown with the element colors on success and with its own failure colors (red by default) on a non-zero exit. Uses a template like `✘ {code}` and can be hidden on success. Each shell gets a small helper that captures `$?` before anything else runs.
- **Hue shift.** Select several elements and drag the slider to rotate all their hues together. Blue moves toward teal while yellow moves toward orange.
- **Gradients.** Paint text or backgrounds with a gradient of 2 to 8 stops from one end of the prompt to the other. Interpolation is OKLab, HSL or RGB, and positions can follow character width or element count.
- **Fields.**
  - Identity: user, host (short/FQDN), `$`/`#`, SSH indicator.
  - Location: directory as `~` path, name only, absolute, or last N.
  - Time: 15 preset formats or any `strftime` format.
  - Status: exit code, jobs, history number.
  - Development: git branch, git dirty marker, Python venv/conda, Node version, kube context, AWS profile.
  - System: shell name and version, TTY, any environment variable, any command's output.
- **Symbols.** Prompt arrows, punctuation, box drawing, Powerline/Nerd Font glyphs (drawn in the preview even without the font) and emoji, plus free text.
- **Import.** Paste an existing bash `PS1` or zsh `PROMPT` and it becomes editable. Understands `\[\e[…m\]`, `\033`, `tput`, `\D{…}`, `$(__git_ps1)`, zsh `%F{…}`/`%B`/`%(?..)`, and oh-my-zsh `$fg[…]`.
- **Export.** Copy to the clipboard or download as a `.txt` file. Output can be truecolor, 256-color or 16-color ANSI.
- **16 presets.** Debian, Fedora, Kali, Robby Russell, Pure, Agnoster, Starship-style, Dracula, Nord, Gruvbox, and more.
- **Extras.** Undo/redo, keyboard shortcuts, share links (the prompt is encoded in the URL), dark theme by default with a light theme, and autosave in the browser.

## Using the generated prompt

| Shell | Where it goes |
| --- | --- |
| Bash | Paste into `~/.bashrc`, then `source ~/.bashrc` |
| Zsh | Paste at the end of `~/.zshrc` (after oh-my-zsh or other theme setup) |
| Fish | Save as `~/.config/fish/functions/fish_prompt.fish` |
| PowerShell | Add to `$PROFILE` (use an ANSI-capable host such as Windows Terminal) |

The snippet is wrapped in `# >>> prompt-generator >>>` markers so it is easy to find and replace later. It only defines the helpers the prompt uses.

## Development

```
js/color.js     color math: HSL/OKLab, hue shift, gradients, 256/16-color quantization
js/fields.js    element model, field catalogue, palette, strftime, preview samples
js/generate.js  bash / zsh / fish / PowerShell code generators
js/importer.js  PS1 / PROMPT parser
js/tools.js     hue-shift and gradient tools
js/presets.js   built-in presets
js/app.js       the UI
```

The scripts are plain, non-module scripts, so the app also works from `file://`.

Tests use Node (no packages needed):

```
node tests/run.js
```

Besides unit tests for the color math and the importer, the suite generates every preset plus a stress prompt (quotes, `$`, backticks, `%`, `\`, git, venv, env vars, commands, exit codes, all style attributes). It then runs them in the real shells and checks that every installed shell renders byte-identical output. Shells that are not installed are skipped. CI installs bash, zsh, fish and PowerShell.

See [docs/DESIGN.md](docs/DESIGN.md) for the design and how each requirement is met.

## License

[MIT](LICENSE)
