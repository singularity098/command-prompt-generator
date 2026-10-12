/* Prompt Generator UI. */
(function (PG) {
  'use strict';

  const M = PG.model, C = PG.color, G = PG.gen, Tl = PG.tools;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const STORE_KEY = 'prompt-generator:v1';
  const DEFAULT_TERM = { bg: '#0a0a0c', fg: '#d4d4d8' };
  const SWATCHES = ['#f4f4f5', '#a1a1aa', '#52525b', '#18181b', '#ef4444', '#f97316', '#facc15', '#a3e635',
    '#4ade80', '#2dd4bf', '#22d3ee', '#60a5fa', '#3b82f6', '#818cf8', '#a78bfa', '#c084fc', '#f472b6', '#fb7185'];
  const TAGS = {
    user: 'user', host: 'host', fqdn: 'fqdn', promptChar: '$ / #', ssh: 'ssh', cwd: 'path', cwdBase: 'dir', cwdAbs: 'abs path',
    cwdTrim: 'path …', time: 'time', exit: 'exit code', jobs: 'jobs', history: 'history', git: 'git', gitDirty: 'git dirty',
    venv: 'venv', shell: 'shell', shellVer: 'version', tty: 'tty', env: 'env', cmd: 'command'
  };
  const INSTALL = {
    bash: 'Paste into <code>~/.bashrc</code>, then run <code>source ~/.bashrc</code>.',
    zsh: 'Paste at the end of <code>~/.zshrc</code> (after any theme/framework setup), then run <code>source ~/.zshrc</code>.',
    fish: 'Save as <code>~/.config/fish/functions/fish_prompt.fish</code>. It takes effect in new prompts immediately.',
    pwsh: 'Add to your profile (<code>notepad $PROFILE</code> or <code>code $PROFILE</code>), then restart PowerShell. Use Windows Terminal or another ANSI-capable host.'
  };
  const EXAMPLES = {
    debian: "PS1='${debian_chroot:+($debian_chroot)}\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '",
    robby: 'PROMPT="%(?:%{$fg_bold[green]%}➜ :%{$fg_bold[red]%}➜ ) %{$fg[cyan]%}%c%{$reset_color%} $(git_prompt_info)"',
    tput: 'PS1="\\[$(tput setaf 3)\\]\\t \\[$(tput setaf 2)\\]\\u@\\h \\[$(tput setaf 4)\\]\\w\\[$(tput setaf 5)\\]$(__git_ps1 \' (%s)\')\\[$(tput sgr0)\\]\\n\\$ "'
  };

  /* ---------------- state ---------------- */
  const state = {
    elements: [], shell: 'bash', colorMode: 'truecolor',
    term: Object.assign({}, DEFAULT_TERM), sim: Object.assign({}, M.DEFAULT_SIM), theme: 'dark',
    grad: { stops: ['#ff512f', '#f09819', '#dd2476'], layer: 'fg', by: 'chars', space: 'oklab' }
  };
  const ui = { selected: new Set(), multi: false, anchor: null, hueSnap: null, hueBase: 0, hueVal: 0 };
  const hist = { undo: [], redo: [], lastKey: null, lastTime: 0 };

  function storage(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }

  function save() {
    const data = { elements: state.elements, shell: state.shell, colorMode: state.colorMode, term: state.term, sim: state.sim, theme: state.theme, grad: state.grad };
    storage((ls) => ls.setItem(STORE_KEY, JSON.stringify(data)));
  }

  function encodeShare() {
    const data = { e: state.elements.map(stripId), s: state.shell, m: state.colorMode, t: state.term };
    return btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeShare(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }
  function stripId(el) { const c = Object.assign({}, el); delete c.id; return c; }

  function validElements(list) {
    return Array.isArray(list) ? list.filter((el) => el && (el.kind === 'text' || el.kind === 'newline' || (el.kind === 'field' && M.FIELDS[el.field]))) : [];
  }

  function load() {
    const saved = storage((ls) => JSON.parse(ls.getItem(STORE_KEY) || 'null'));
    if (saved) {
      state.elements = M.reid(validElements(saved.elements));
      if (G.SHELLS[saved.shell]) state.shell = saved.shell;
      if (['truecolor', '256', '16'].includes(saved.colorMode)) state.colorMode = saved.colorMode;
      if (saved.term) Object.assign(state.term, saved.term);
      if (saved.sim) Object.assign(state.sim, saved.sim);
      if (saved.theme) state.theme = saved.theme;
      if (saved.grad && Array.isArray(saved.grad.stops)) Object.assign(state.grad, saved.grad);
    } else {
      const p = PG.presets.find((x) => x.name === 'Starship Style') || PG.presets[0];
      state.elements = M.reid(p.build());
    }
    const m = location.hash.match(/^#p=([\w-]+)/);
    if (m) {
      try {
        const d = decodeShare(m[1]);
        state.elements = M.reid(validElements(d.e));
        if (G.SHELLS[d.s]) state.shell = d.s;
        if (d.m) state.colorMode = d.m;
        if (d.t) Object.assign(state.term, d.t);
        history.replaceState(null, '', location.pathname + location.search);
        setTimeout(() => toast('Loaded shared prompt'), 300);
      } catch (e) { setTimeout(() => toast('That share link could not be read'), 300); }
    }
  }

  /* ---------------- history ---------------- */
  function checkpoint(key) {
    const now = Date.now();
    if (key && key === hist.lastKey && now - hist.lastTime < 1500) { hist.lastTime = now; return; }
    hist.undo.push(JSON.stringify(state.elements));
    if (hist.undo.length > 300) hist.undo.shift();
    hist.redo.length = 0;
    hist.lastKey = key || null;
    hist.lastTime = now;
  }
  function mutate(fn, opts) {
    opts = opts || {};
    checkpoint(opts.key);
    fn();
    changed(opts);
  }
  function changed(opts) {
    opts = opts || {};
    if (!opts.keepHue) resetHue();
    pruneSelection();
    renderEditor();
    if (opts.inspector !== false) renderInspector();
    renderPreview();
    renderCode();
    updateMeta();
    save();
  }
  function undo() {
    if (!hist.undo.length) return;
    hist.redo.push(JSON.stringify(state.elements));
    state.elements = JSON.parse(hist.undo.pop());
    hist.lastKey = null;
    changed();
  }
  function redo() {
    if (!hist.redo.length) return;
    hist.undo.push(JSON.stringify(state.elements));
    state.elements = JSON.parse(hist.redo.pop());
    hist.lastKey = null;
    changed();
  }

  /* ---------------- selection ---------------- */
  function pruneSelection() {
    const ids = new Set(state.elements.map((e) => e.id));
    ui.selected.forEach((id) => { if (!ids.has(id)) ui.selected.delete(id); });
  }
  function selectedEls() { return state.elements.filter((e) => ui.selected.has(e.id)); }
  /* Elements that bulk tools act on: the selection, or everything when nothing is selected. */
  function targets() { const s = selectedEls(); return s.length ? s : state.elements.slice(); }
  function indexOf(id) { return state.elements.findIndex((e) => e.id === id); }

  function selectionChanged() {
    resetHue();
    renderEditor();
    renderInspector();
    updateMeta();
  }
  function select(id, ev) {
    const additive = ui.multi || (ev && (ev.ctrlKey || ev.metaKey));
    if (ev && ev.shiftKey && ui.anchor && indexOf(ui.anchor) >= 0) {
      const a = indexOf(ui.anchor), b = indexOf(id);
      if (!additive) ui.selected.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) ui.selected.add(state.elements[i].id);
    } else if (additive) {
      if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
      ui.anchor = id;
    } else {
      ui.selected.clear();
      ui.selected.add(id);
      ui.anchor = id;
    }
    selectionChanged();
  }
  function selectAll() { state.elements.forEach((e) => ui.selected.add(e.id)); selectionChanged(); }
  function selectNone() { ui.selected.clear(); selectionChanged(); }

  /* ---------------- element operations ---------------- */
  function insertionIndex() {
    const sel = selectedEls();
    return sel.length ? indexOf(sel[sel.length - 1].id) + 1 : state.elements.length;
  }
  function addElements(list, index) {
    if (index == null) index = insertionIndex();
    mutate(() => {
      state.elements.splice(index, 0, ...list);
      ui.selected = new Set(list.map((e) => e.id));
      ui.anchor = list[list.length - 1].id;
    });
    flashChips(list.map((e) => e.id));
  }
  function removeElements(ids) {
    const set = new Set(ids);
    if (!set.size) return;
    mutate(() => { state.elements = state.elements.filter((e) => !set.has(e.id)); });
  }
  function moveElements(ids, index) {
    const set = new Set(ids);
    let anchorId = null;
    for (let i = index; i < state.elements.length; i++) if (!set.has(state.elements[i].id)) { anchorId = state.elements[i].id; break; }
    const moving = state.elements.filter((e) => set.has(e.id));
    const rest = state.elements.filter((e) => !set.has(e.id));
    const at = anchorId ? rest.findIndex((e) => e.id === anchorId) : rest.length;
    const next = rest.slice(0, at).concat(moving, rest.slice(at));
    if (next.every((e, i) => e === state.elements[i])) { renderEditor(); return; }
    mutate(() => { state.elements = next; });
  }
  function duplicateSelected() {
    const sel = selectedEls();
    if (!sel.length) return;
    addElements(sel.map(M.clone), indexOf(sel[sel.length - 1].id) + 1);
  }
  function nudgeSelected(dir) {
    const sel = selectedEls();
    if (!sel.length) return;
    const first = indexOf(sel[0].id), last = indexOf(sel[sel.length - 1].id);
    if (dir < 0 && first === 0) return;
    if (dir > 0 && last === state.elements.length - 1) return;
    moveElements(sel.map((e) => e.id), dir < 0 ? first - 1 : last + 2);
  }

  /* ---------------- rendering helpers ---------------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function simFor(status) {
    const s = Object.assign({}, state.sim);
    s.shell = state.shell;
    s.status = status || 0;
    s.now = new Date();
    return s;
  }

  /* CSS for an element as it will appear in the terminal (respecting the color mode). */
  function cssFor(el, status) {
    let fg = el.fg, bg = el.bg;
    if (el.kind === 'field' && el.field === 'exit' && status) { fg = el.props.failFg || fg; bg = el.props.failBg || bg; }
    fg = fg ? C.quantize(fg, state.colorMode) : null;
    bg = bg ? C.quantize(bg, state.colorMode) : null;
    if (el.reverse) { const f = fg || state.term.fg, b = bg || state.term.bg; fg = b; bg = f; }
    const css = [];
    if (fg) css.push('color:' + fg);
    if (bg) css.push('background:' + bg);
    if (el.bold) css.push('font-weight:700');
    if (el.italic) css.push('font-style:italic');
    const deco = [el.underline && 'underline', el.strike && 'line-through'].filter(Boolean);
    if (deco.length) css.push('text-decoration:' + deco.join(' '));
    if (el.dim) css.push('opacity:.6');
    return css.join(';');
  }

  /* Solid powerline separators are drawn with CSS so the preview looks right without a Nerd Font. */
  const PL_SHAPES = { '\ue0b0': 'r', '\ue0b2': 'l', '\ue0b4': 'rr', '\ue0b6': 'lr' };
  const PL_FALLBACK = { '\ue0a0': '⎇', '\ue0a2': '🔒' };
  function glyphHTML(text) {
    return Array.from(text).map((ch) => {
      if (PL_SHAPES[ch]) return '<i class="pl pl-' + PL_SHAPES[ch] + '" aria-hidden="true"></i>';
      return esc(PL_FALLBACK[ch] || ch);
    }).join('');
  }

  function promptHTML(elements, status, sim) {
    return elements.map((el) => {
      if (el.kind === 'newline') return '\n';
      const text = M.sampleText(el, sim);
      if (!text) return '';
      return '<span class="' + (el.blink ? 'blink' : '') + '" style="' + cssFor(el, status) + '">' + glyphHTML(text) + '</span>';
    }).join('');
  }

  /* ---------------- palette ---------------- */
  function renderPalette() {
    const fields = $('#palette-fields');
    fields.innerHTML = '';
    M.PALETTE.forEach((group) => {
      const g = document.createElement('div');
      g.className = 'pal-group';
      g.innerHTML = '<h4>' + esc(group.name) + '</h4><div class="pal-items"></div>';
      const box = $('.pal-items', g);
      group.items.forEach((item) => {
        const b = document.createElement('div');
        b.className = 'pal-item';
        b.textContent = item.label;
        b.title = item.hint || item.label;
        b.tabIndex = 0;
        b.setAttribute('role', 'button');
        b.dataset.search = (group.name + ' ' + item.label + ' ' + (item.hint || '')).toLowerCase();
        draggable(b, () => ({ type: 'new', make: item.make }), () => addElements([item.make()]));
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addElements([item.make()]); } });
        box.appendChild(b);
      });
      fields.appendChild(g);
    });

    const syms = $('#palette-symbols');
    M.SYMBOLS.forEach((group) => {
      const g = document.createElement('div');
      g.className = 'pal-group';
      g.innerHTML = '<h4>' + esc(group.name) + '</h4>' + (group.note ? '<p class="note">' + esc(group.note) + '</p>' : '') + '<div class="pal-items"></div>';
      const box = $('.pal-items', g);
      group.chars.forEach((ch) => {
        const b = document.createElement('div');
        b.className = 'pal-item sym';
        b.textContent = ch;
        b.title = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
        b.tabIndex = 0;
        b.setAttribute('role', 'button');
        b.dataset.search = (group.name + ' ' + ch + ' ' + b.title).toLowerCase();
        const make = () => M.make('text', { text: ch });
        draggable(b, () => ({ type: 'new', make }), () => addElements([make()]));
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addElements([make()]); } });
        box.appendChild(b);
      });
      syms.appendChild(g);
    });
  }

  function filterPalette() {
    const q = $('#palette-search').value.trim().toLowerCase();
    $$('.pal-group').forEach((g) => {
      let any = false;
      $$('.pal-item', g).forEach((it) => { const ok = !q || it.dataset.search.includes(q); it.hidden = !ok; any = any || ok; });
      g.hidden = !any;
    });
  }

  /* ---------------- editor ---------------- */
  function chipContent(el) {
    if (el.kind === 'newline') return '⏎';
    if (el.kind === 'text') {
      if (!el.text) return '<span class="placeholder">empty</span>';
      if (!el.text.trim()) return '<span class="ws">' + '␣'.repeat(el.text.length) + '</span>';
      return glyphHTML(el.text);
    }
    const t = M.sampleText(el, simFor(0));
    let html = t ? glyphHTML(t) : '<span class="placeholder">' + esc(el.field === 'exit' ? 'on error' : 'hidden') + '</span>';
    if (el.field === 'exit') html += '<i class="fail-dot" style="background:' + (el.props.failFg || '#ff5555') + '" title="Failure color"></i>';
    return html;
  }

  function renderEditor() {
    const ed = $('#editor');
    ed.innerHTML = '';
    if (!state.elements.length) {
      ed.innerHTML = '<div class="editor-empty">Drag fields and symbols here to build your prompt,<br>or pick a preset to start from.</div>';
    }
    state.elements.forEach((el) => {
      const chip = document.createElement('div');
      chip.className = 'chip' + (el.kind === 'newline' ? ' newline' : '') + (ui.selected.has(el.id) ? ' selected' : '');
      chip.dataset.id = el.id;
      const tag = el.kind === 'text' ? 'text' : el.kind === 'newline' ? 'newline' : TAGS[el.field] || el.field;
      chip.title = el.kind === 'field' ? M.FIELDS[el.field].label : tag;
      chip.innerHTML = '<span class="chip-tag">' + esc(tag) + '</span><span class="chip-body' + (el.blink ? ' blink' : '') + '" style="' + (el.kind === 'newline' ? '' : cssFor(el, 0)) + '">' + chipContent(el) + '</span>';
      draggable(chip, () => ({ type: 'move', id: el.id }), (ev) => { select(el.id, ev); ed.focus({ preventScroll: true }); });
      ed.appendChild(chip);
      if (el.kind === 'newline') {
        const br = document.createElement('div');
        br.className = 'line-break';
        ed.appendChild(br);
      }
    });
    const marker = document.createElement('div');
    marker.className = 'drop-marker';
    marker.hidden = true;
    ed.appendChild(marker);
  }

  function flashChips(ids) {
    ids.forEach((id) => {
      const c = $('.chip[data-id="' + id + '"]');
      if (c && c.animate) c.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 180, easing: 'ease-out' });
    });
  }

  /* ---------------- drag & drop (mouse + touch via pointer events) ---------------- */
  let ptr = null;

  function draggable(node, payloadFn, onTap) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || ptr) return;
      const touch = e.pointerType !== 'mouse';
      if (!touch) e.preventDefault();
      ptr = { node, payloadFn, onTap, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch, active: false, ev: e };
      if (touch) {
        node.classList.add('pressing');
        ptr.timer = setTimeout(() => { if (ptr && ptr.node === node && !ptr.active) startDrag(); }, 260);
      }
    });
    node.addEventListener('contextmenu', (e) => { if (ptr) e.preventDefault(); });
  }

  function endPointer() {
    if (!ptr) return;
    clearTimeout(ptr.timer);
    ptr.node.classList.remove('pressing');
    ptr = null;
  }

  window.addEventListener('pointermove', (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    ptr.x = e.clientX; ptr.y = e.clientY;
    const dist = Math.hypot(ptr.x - ptr.x0, ptr.y - ptr.y0);
    if (!ptr.active) {
      if (ptr.touch) { if (dist > 10) endPointer(); } // the user is scrolling
      else if (dist > 4) startDrag();
      return;
    }
    e.preventDefault();
    moveDrag();
  }, { passive: false });

  window.addEventListener('pointerup', (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr;
    if (p.active) finishDrag(true);
    else { endPointer(); p.onTap(p.ev); }
  });
  window.addEventListener('pointercancel', (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    if (ptr.active) finishDrag(false); else endPointer();
  });
  // Once a touch drag is active, stop the page from scrolling under the finger.
  document.addEventListener('touchmove', (e) => { if (ptr && ptr.active) e.preventDefault(); }, { passive: false });

  function startDrag() {
    const p = ptr;
    clearTimeout(p.timer);
    p.node.classList.remove('pressing');
    p.active = true;
    p.payload = p.payloadFn();
    if (p.payload.type === 'move') {
      p.ids = ui.selected.has(p.payload.id) ? selectedEls().map((e) => e.id) : [p.payload.id];
      p.ids.forEach((id) => { const c = $('.chip[data-id="' + id + '"]'); if (c) c.classList.add('dragging'); });
    }
    const g = p.node.cloneNode(true);
    g.classList.add('ghost');
    g.classList.remove('dragging', 'pressing');
    if (p.ids && p.ids.length > 1) g.setAttribute('data-count', p.ids.length);
    document.body.appendChild(g);
    p.ghost = g;
    document.body.classList.add('is-dragging');
    if (p.touch && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* ignore */ } }
    moveDrag();
  }

  function overEditor(x, y) {
    const r = $('#editor').getBoundingClientRect();
    const pad = 16;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function dropIndex(x, y) {
    const chips = $$('#editor .chip');
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect();
      if (y < r.top - 4) return i;
      if (y <= r.bottom + 4 && x < r.left + r.width / 2) return i;
    }
    return chips.length;
  }

  function moveDrag() {
    const p = ptr;
    p.ghost.style.left = p.x + 'px';
    p.ghost.style.top = p.y + 'px';
    const ed = $('#editor'), marker = $('.drop-marker', ed);
    const over = overEditor(p.x, p.y);
    ed.classList.toggle('drop-hover', over);
    p.ghost.classList.toggle('remove', p.payload.type === 'move' && !over);
    if (!over) { marker.hidden = true; return; }
    const chips = $$('#editor .chip'), idx = dropIndex(p.x, p.y), er = ed.getBoundingClientRect();
    let left, top, h;
    if (!chips.length) { left = 12; top = 12; h = 40; }
    else if (idx < chips.length) { const r = chips[idx].getBoundingClientRect(); left = r.left - er.left - 3; top = r.top - er.top; h = r.height; }
    else { const r = chips[chips.length - 1].getBoundingClientRect(); left = r.right - er.left + 1; top = r.top - er.top; h = r.height; }
    marker.hidden = false;
    marker.style.left = left + 'px';
    marker.style.top = top + 'px';
    marker.style.height = h + 'px';
  }

  function finishDrag(drop) {
    const p = ptr;
    const over = overEditor(p.x, p.y);
    const idx = over ? dropIndex(p.x, p.y) : -1;
    p.ghost.remove();
    document.body.classList.remove('is-dragging');
    $('#editor').classList.remove('drop-hover');
    endPointer();
    if (!drop) { renderEditor(); return; }
    if (p.payload.type === 'new') {
      if (over) addElements([p.payload.make()], idx);
    } else if (over) {
      moveElements(p.ids, idx);
    } else {
      removeElements(p.ids);
      toast(p.ids.length > 1 ? 'Removed ' + p.ids.length + ' elements' : 'Element removed', 'Undo', undo);
    }
  }

  /* ---------------- inspector ---------------- */
  function colorField(label, layer, value, allowNone) {
    return '<div class="field"><span class="lbl">' + label + '</span>' +
      '<div class="color-row"><input type="color" data-color="' + layer + '" value="' + (value || '#ffffff') + '" aria-label="' + label + '">' +
      (allowNone ? '<button class="btn small none-btn' + (value ? '' : ' on') + '" data-none="' + layer + '" title="Use the terminal default">Default</button>' : '') +
      '<code class="small">' + (value || 'default') + '</code></div>' +
      '<div class="swatches">' + SWATCHES.map((c) => '<button class="swatch" style="background:' + c + '" data-swatch="' + layer + '" data-c="' + c + '" title="' + c + '" aria-label="' + c + '"></button>').join('') + '</div></div>';
  }

  function propInput(label, key, value, attrs) {
    return '<label class="stack">' + label + '<input class="input" data-prop="' + key + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '></label>';
  }

  function contentFields(el) {
    if (el.kind === 'text') return '<div class="field"><span class="lbl">Text</span><input class="input mono" data-text value="' + esc(el.text) + '" spellcheck="false"></div>';
    if (el.kind !== 'field') return '';
    const p = el.props || {};
    switch (el.field) {
      case 'time': {
        const known = M.TIME_FORMATS.some((t) => t.fmt === p.fmt);
        const now = new Date();
        return '<div class="field"><span class="lbl">Format</span><select class="input" data-timefmt>' +
          M.TIME_FORMATS.map((t) => '<option value="' + esc(t.fmt) + '"' + (t.fmt === p.fmt ? ' selected' : '') + '>' + esc(M.strftime(t.fmt, now)) + ' — ' + esc(t.label) + '</option>').join('') +
          '<option value="__custom"' + (known ? '' : ' selected') + '>Custom…</option></select>' +
          '<div style="margin-top:8px">' + propInput('strftime format', 'fmt', p.fmt, 'spellcheck="false"') + '</div></div>';
      }
      case 'exit':
        return '<div class="field">' + propInput('Template ({code} = exit status)', 'tpl', p.tpl, 'spellcheck="false"') +
          '<label class="check" style="margin-top:8px"><input type="checkbox" data-propcheck="hideOk"' + (p.hideOk ? ' checked' : '') + '> Only show when the exit code is non-zero</label></div>' +
          colorField('Failure text color', 'failFg', p.failFg, true) + colorField('Failure background', 'failBg', p.failBg, true);
      case 'git': case 'venv':
        return '<div class="field two">' + propInput('Before', 'pre', p.pre) + propInput('After', 'suf', p.suf) + '</div>';
      case 'env':
        return '<div class="field">' + propInput('Variable name', 'name', p.name, 'spellcheck="false"') + '</div>' +
          '<div class="field two">' + propInput('Before', 'pre', p.pre) + propInput('After', 'suf', p.suf) + '</div>' +
          '<div class="field">' + propInput('Preview value (empty = unset)', 'sample', p.sample) + '</div>';
      case 'gitDirty': case 'ssh':
        return '<div class="field">' + propInput('Text', 'text', p.text) + '</div>';
      case 'cwdTrim':
        return '<div class="field">' + propInput('Directories to keep', 'depth', p.depth, 'type="number" min="1" max="9"') + '</div>';
      case 'cmd':
        return '<div class="field">' + propInput('Command (' + G.SHELLS[state.shell].label + ' syntax)', 'cmd', p.cmd, 'spellcheck="false" class="mono"') + '</div>' +
          '<div class="field">' + propInput('Preview value', 'sample', p.sample) + '</div>';
    }
    return '';
  }

  function renderInspector() {
    const box = $('#inspector');
    const sel = selectedEls();
    if (!sel.length) {
      box.innerHTML = '<div class="insp-title"><h3>Inspector</h3></div><div class="insp-empty">Select an element to edit it.<ul>' +
        '<li>Shift/Ctrl+click or <b>Multi-select</b> to pick several.</li><li>Hue shift and gradients apply to the selection, or to everything when nothing is selected.</li>' +
        '<li>Keys: <code>Del</code> remove, <code>Alt+←/→</code> move, <code>Ctrl+D</code> duplicate, <code>Ctrl+Z</code> undo.</li></ul></div>';
      return;
    }
    const first = sel[0], single = sel.length === 1, colorable = sel.filter((e) => e.kind !== 'newline');
    const title = single ? (first.kind === 'field' ? M.FIELDS[first.field].label : first.kind === 'text' ? 'Text' : 'Newline') : sel.length + ' elements';
    const desc = single && first.kind === 'field' ? M.FIELDS[first.field].desc : '';
    let html = '<div class="insp-title"><h3>' + esc(title) + '</h3></div>' + (desc ? '<p class="insp-desc">' + esc(desc) + '</p>' : '');
    if (single) html += contentFields(first);
    if (colorable.length) {
      const c0 = colorable[0];
      html += colorField(first.field === 'exit' && single ? 'Text color (success)' : 'Text color', 'fg', c0.fg, true);
      html += colorField(first.field === 'exit' && single ? 'Background (success)' : 'Background', 'bg', c0.bg, true);
      const styles = [['bold', '<b>B</b>', 'Bold'], ['italic', '<i>I</i>', 'Italic'], ['underline', '<u>U</u>', 'Underline'], ['strike', '<s>S</s>', 'Strikethrough'],
        ['dim', 'Dim', 'Dim / faint'], ['blink', 'Blink', 'Blink'], ['reverse', 'Rev', 'Reverse video']];
      html += '<div class="field"><span class="lbl">Style</span><div class="styles">' + styles.map((s) => {
        const on = colorable.every((e) => e[s[0]]);
        return '<button class="btn small' + (on ? ' on' : '') + '" data-style="' + s[0] + '" title="' + s[2] + '" aria-pressed="' + on + '">' + s[1] + '</button>';
      }).join('') + '</div></div>';
    }
    html += '<div class="arrange"><button class="btn small" data-act="left" title="Move left (Alt+←)">◀</button><button class="btn small" data-act="right" title="Move right (Alt+→)">▶</button>' +
      '<button class="btn small" data-act="dup" title="Duplicate (Ctrl+D)">⧉ Duplicate</button><button class="btn small danger" data-act="del" title="Delete (Del)">✕ Delete</button></div>';
    box.innerHTML = html;
    bindInspector(box);
  }

  function bindInspector(box) {
    const sel = () => selectedEls();
    const live = (fn, key) => mutate(fn, { key, inspector: false });
    const setColor = (layer, value) => {
      sel().forEach((el) => {
        if (layer === 'failFg' || layer === 'failBg') { if (el.field === 'exit') el.props[layer] = value; }
        else if (el.kind !== 'newline') el[layer] = value;
      });
    };

    $$('[data-color]', box).forEach((inp) => {
      const layer = inp.dataset.color;
      inp.addEventListener('input', () => {
        live(() => setColor(layer, inp.value), 'color-' + layer);
        const row = inp.closest('.color-row');
        $('code', row).textContent = inp.value;
        const nb = $('.none-btn', row); if (nb) nb.classList.remove('on');
      });
      inp.addEventListener('change', () => renderInspector());
    });
    $$('[data-none]', box).forEach((b) => b.addEventListener('click', () => mutate(() => setColor(b.dataset.none, null))));
    $$('[data-swatch]', box).forEach((b) => b.addEventListener('click', () => mutate(() => setColor(b.dataset.swatch, b.dataset.c))));
    $$('[data-style]', box).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.style, els = sel().filter((e) => e.kind !== 'newline');
      const on = !els.every((e) => e[k]);
      mutate(() => els.forEach((e) => { e[k] = on; }));
    }));
    const t = $('[data-text]', box);
    if (t) t.addEventListener('input', () => live(() => { sel()[0].text = t.value; }, 'text'));
    $$('[data-prop]', box).forEach((inp) => inp.addEventListener('input', () => {
      const k = inp.dataset.prop;
      live(() => {
        const el = sel()[0];
        el.props[k] = k === 'depth' ? Math.max(1, Math.min(9, parseInt(inp.value, 10) || 1)) : inp.value;
      }, 'prop-' + k);
      if (k === 'fmt') { const s = $('[data-timefmt]', box); if (s) s.value = M.TIME_FORMATS.some((f) => f.fmt === inp.value) ? inp.value : '__custom'; }
    }));
    $$('[data-propcheck]', box).forEach((inp) => inp.addEventListener('change', () => mutate(() => { sel()[0].props[inp.dataset.propcheck] = inp.checked; })));
    const tf = $('[data-timefmt]', box);
    if (tf) tf.addEventListener('change', () => {
      if (tf.value === '__custom') { const f = $('[data-prop="fmt"]', box); f.focus(); f.select(); return; }
      mutate(() => { sel()[0].props.fmt = tf.value; });
    });
    $$('[data-act]', box).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'left') nudgeSelected(-1);
      else if (a === 'right') nudgeSelected(1);
      else if (a === 'dup') duplicateSelected();
      else if (a === 'del') removeElements(sel().map((e) => e.id));
    }));
  }

  /* ---------------- hue & gradient tools ---------------- */
  function resetHue() {
    ui.hueSnap = null;
    ui.hueVal = 0;
    const h = $('#hue');
    if (h) { h.value = 0; $('#hue-value').textContent = '0°'; }
  }

  function onHue() {
    const v = parseInt($('#hue').value, 10) || 0;
    if (!ui.hueSnap) {
      ui.hueTargets = targets().map((e) => e.id);
      ui.hueSnap = Tl.snapshot(targets());
      ui.hueBase = ui.hueVal;
      checkpoint(null);
    }
    ui.hueVal = v;
    $('#hue-value').textContent = (v > 0 ? '+' : '') + v + '°';
    const ids = new Set(ui.hueTargets);
    Tl.applyHue(state.elements.filter((e) => ids.has(e.id)), ui.hueSnap, v - ui.hueBase, { fg: $('#hue-fg').checked, bg: $('#hue-bg').checked });
    changed({ keepHue: true });
  }

  function renderGradient() {
    const g = state.grad;
    $('#grad-bar').style.background = 'linear-gradient(90deg,' + g.stops.join(',') + ')';
    const box = $('#grad-stops');
    box.innerHTML = g.stops.map((c, i) => '<span class="grad-stop"><input type="color" value="' + c + '" data-i="' + i + '" aria-label="Stop ' + (i + 1) + '">' +
      (g.stops.length > 2 ? '<button data-rm="' + i + '" aria-label="Remove stop" title="Remove stop">✕</button>' : '') + '</span>').join('');
    $$('input', box).forEach((inp) => inp.addEventListener('input', () => {
      g.stops[+inp.dataset.i] = inp.value;
      $('#grad-bar').style.background = 'linear-gradient(90deg,' + g.stops.join(',') + ')';
      save();
    }));
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { g.stops.splice(+b.dataset.rm, 1); renderGradient(); save(); }));
    $$('#grad-layer button').forEach((b) => b.classList.toggle('active', b.dataset.v === g.layer));
    $$('#grad-by button').forEach((b) => b.classList.toggle('active', b.dataset.v === g.by));
    $('#grad-space').value = g.space;
  }

  function bindTools() {
    $('#hue').addEventListener('input', onHue);
    const pres = $('#grad-presets');
    pres.innerHTML = Tl.GRADIENTS.map((g, i) => '<button class="grad-preset" data-g="' + i + '" title="' + g.name + '" aria-label="' + g.name + ' gradient" style="background:linear-gradient(90deg,' + g.stops.join(',') + ')"></button>').join('');
    $$('[data-g]', pres).forEach((b) => b.addEventListener('click', () => { state.grad.stops = Tl.GRADIENTS[+b.dataset.g].stops.slice(); renderGradient(); save(); }));
    $('#grad-add').addEventListener('click', () => {
      const s = state.grad.stops;
      if (s.length >= 8) return;
      s.push(C.mix(s[s.length - 1], '#ffffff', 0.35, 'oklab'));
      renderGradient(); save();
    });
    $('#grad-reverse').addEventListener('click', () => { state.grad.stops.reverse(); renderGradient(); save(); });
    $$('#grad-layer button').forEach((b) => b.addEventListener('click', () => { state.grad.layer = b.dataset.v; renderGradient(); save(); }));
    $$('#grad-by button').forEach((b) => b.addEventListener('click', () => { state.grad.by = b.dataset.v; renderGradient(); save(); }));
    $('#grad-space').addEventListener('change', (e) => { state.grad.space = e.target.value; save(); });
    $('#grad-apply').addEventListener('click', () => {
      if (!state.elements.length) { toast('Add some elements first'); return; }
      mutate(() => Tl.applyGradient(targets(), state.grad.stops, { layer: state.grad.layer, by: state.grad.by, space: state.grad.space, sim: simFor(0) }));
    });
  }

  function updateMeta() {
    $('#btn-undo').disabled = !hist.undo.length;
    $('#btn-redo').disabled = !hist.redo.length;
    const n = ui.selected.size;
    const scope = n ? n + ' selected' : 'all elements';
    $('#hue-scope').textContent = '→ ' + scope;
    $('#grad-scope').textContent = '→ ' + scope;
    $('#btn-multi').setAttribute('aria-pressed', String(ui.multi));
  }

  /* ---------------- preview ---------------- */
  function renderPreview() {
    const root = document.documentElement;
    root.style.setProperty('--term-bg', state.term.bg);
    root.style.setProperty('--term-fg', state.term.fg);
    $('#term-bg').value = state.term.bg;
    $('#term-fg').value = state.term.fg;
    const s0 = simFor(0), s1 = simFor(1);
    $('#term-title').textContent = (s0.root ? 'root' : s0.user) + '@' + s0.host + ': ' + M.tildePath(s0) + ' — ' + G.SHELLS[state.shell].label;
    const cmd = (t) => '<span class="cmd">' + esc(t) + '</span>\n';
    $('#term-body').innerHTML =
      promptHTML(state.elements, 0, s0) + cmd('ls') +
      '<span class="out">README.md  css  docs  index.html  js  tests</span>\n' +
      promptHTML(state.elements, 0, s0) + cmd('false') +
      promptHTML(state.elements, 1, s1) + '<span class="cursor">&nbsp;</span>';
  }

  function renderSimForm() {
    const f = $('#sim-form');
    const s = state.sim;
    const text = (k, label) => '<label>' + label + '<input class="input small" data-sim="' + k + '" value="' + esc(s[k]) + '"></label>';
    const check = (k, label) => '<label class="check"><input type="checkbox" data-simcheck="' + k + '"' + (s[k] ? ' checked' : '') + '> ' + label + '</label>';
    f.innerHTML = text('user', 'User') + text('host', 'Host') + text('domain', 'Domain') + text('home', 'Home') + text('cwd', 'Working dir') +
      text('branch', 'Git branch') + text('venvName', 'Venv name') + text('jobs', 'Jobs') +
      check('inGit', 'In a git repo') + check('dirty', 'Uncommitted changes') + check('venv', 'Venv active') + check('ssh', 'SSH session') + check('root', 'Root user');
    const refresh = () => { renderEditor(); renderPreview(); save(); };
    $$('[data-sim]', f).forEach((inp) => inp.addEventListener('input', () => { s[inp.dataset.sim] = inp.value; refresh(); }));
    $$('[data-simcheck]', f).forEach((inp) => inp.addEventListener('change', () => { s[inp.dataset.simcheck] = inp.checked; refresh(); }));
  }

  /* ---------------- output ---------------- */
  function currentCode() { return G.generate(state.shell, state.elements, state.colorMode); }

  function renderCode() {
    const code = currentCode();
    $('#code').innerHTML = code.split('\n').map((l) => /^\s*#/.test(l) ? '<span class="c">' + esc(l) + '</span>' : esc(l)).join('\n');
    $('#install-hint').innerHTML = INSTALL[state.shell];
    $('#color-mode').value = state.colorMode;
  }

  function renderShellTabs() {
    const box = $('#shell-tabs');
    box.innerHTML = Object.keys(G.SHELLS).map((k) => '<button role="tab" data-shell="' + k + '" aria-selected="' + (k === state.shell) + '" class="' + (k === state.shell ? 'active' : '') + '">' + G.SHELLS[k].label + '</button>').join('');
    $$('button', box).forEach((b) => b.addEventListener('click', () => {
      state.shell = b.dataset.shell;
      renderShellTabs();
      renderEditor(); renderInspector(); renderPreview(); renderCode(); save();
    }));
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  function download() {
    const blob = new Blob([currentCode()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prompt-' + state.shell + '.txt';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------------- modals ---------------- */
  function openModal(id) {
    const m = $(id);
    m.hidden = false;
    m._prevFocus = document.activeElement;
    const f = $('textarea, .preset-card, button', m);
    if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal(m) {
    m.hidden = true;
    if (m._prevFocus && m._prevFocus.focus) m._prevFocus.focus();
  }

  function openPresets() {
    const grid = $('#preset-grid');
    const sim = simFor(0);
    grid.innerHTML = '';
    PG.presets.forEach((p) => {
      const els = p.build();
      const card = document.createElement('button');
      card.className = 'preset-card';
      card.innerHTML = '<pre class="mini">' + promptHTML(els, 0, sim).replace(/^\n/, '') + '<span class="cursor">&nbsp;</span></pre><div class="meta"><b>' + esc(p.name) + '</b><span>' + esc(p.desc) + '</span></div>';
      card.addEventListener('click', () => {
        mutate(() => { state.elements = M.reid(p.build()); ui.selected.clear(); });
        closeModal($('#modal-presets'));
        toast('Loaded “' + p.name + '”', 'Undo', undo);
      });
      grid.appendChild(card);
    });
    openModal('#modal-presets');
  }

  function doImport() {
    const text = $('#import-text').value;
    const msg = $('#import-msg');
    if (!text.trim()) { msg.className = 'import-msg err'; msg.textContent = 'Paste a prompt first.'; return; }
    let res;
    try { res = PG.importer.importPrompt(text, $('#import-syntax').value); } catch (e) { res = { elements: [], warnings: ['Could not parse: ' + e.message] }; }
    if (!res.elements.length) { msg.className = 'import-msg err'; msg.textContent = res.warnings.join(' ') || 'Nothing recognized.'; return; }
    mutate(() => { state.elements = res.elements; ui.selected.clear(); });
    closeModal($('#modal-import'));
    toast('Imported ' + res.elements.length + ' elements as ' + (res.syntax === 'zsh' ? 'zsh' : 'bash') + (res.warnings.length ? ' (' + res.warnings.length + ' warnings)' : ''), 'Undo', undo);
  }

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(text, actionLabel, action) {
    const t = $('#toast');
    t.innerHTML = esc(text) + (actionLabel ? ' <button class="btn small" style="margin-left:10px;pointer-events:auto">' + esc(actionLabel) + '</button>' : '');
    if (actionLabel) $('button', t).addEventListener('click', () => { action(); t.classList.remove('show'); });
    t.style.pointerEvents = actionLabel ? 'auto' : 'none';
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 4500 : 2200);
  }

  /* ---------------- wiring ---------------- */
  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    const b = $('#btn-theme');
    b.textContent = state.theme === 'dark' ? '☀' : '☾';
    b.title = state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }

  function isTyping(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

  function bind() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $('#palette-fields').hidden = t.dataset.tab !== 'fields';
      $('#palette-symbols').hidden = t.dataset.tab !== 'symbols';
    }));
    $('#palette-search').addEventListener('input', filterPalette);
    const addCustom = () => {
      const v = $('#custom-text').value;
      if (!v) return;
      addElements([M.make('text', { text: v })]);
      $('#custom-text').value = '';
    };
    $('#btn-add-text').addEventListener('click', addCustom);
    $('#custom-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustom(); });

    $('#editor').addEventListener('pointerdown', (e) => { if (e.target.id === 'editor' || e.target.classList.contains('editor-empty')) { if (ui.selected.size) selectNone(); } });
    $('#btn-multi').addEventListener('click', () => { ui.multi = !ui.multi; updateMeta(); });
    $('#btn-select-all').addEventListener('click', selectAll);
    $('#btn-select-none').addEventListener('click', selectNone);

    $('#btn-presets').addEventListener('click', openPresets);
    $('#btn-import').addEventListener('click', () => { $('#import-msg').textContent = ''; openModal('#modal-import'); });
    $('#btn-do-import').addEventListener('click', doImport);
    $('#import-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doImport(); });
    $$('[data-example]').forEach((b) => b.addEventListener('click', () => { $('#import-text').value = EXAMPLES[b.dataset.example]; $('#import-msg').textContent = ''; }));
    $$('.modal').forEach((m) => {
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(m); });
    });

    $('#btn-undo').addEventListener('click', undo);
    $('#btn-redo').addEventListener('click', redo);
    $('#btn-clear').addEventListener('click', () => {
      if (!state.elements.length) return;
      mutate(() => { state.elements = []; });
      toast('Prompt cleared', 'Undo', undo);
    });
    $('#btn-theme').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save(); });
    $('#btn-share').addEventListener('click', () => {
      const url = location.href.split('#')[0] + '#p=' + encodeShare();
      copyText(url).then(() => toast('Share link copied'), () => { window.prompt('Copy this link:', url); });
    });

    $('#term-bg').addEventListener('input', (e) => { state.term.bg = e.target.value; renderPreview(); renderEditor(); save(); });
    $('#term-fg').addEventListener('input', (e) => { state.term.fg = e.target.value; renderPreview(); renderEditor(); save(); });
    $('#btn-term-reset').addEventListener('click', () => { state.term = Object.assign({}, DEFAULT_TERM); renderPreview(); renderEditor(); save(); });

    $('#color-mode').addEventListener('change', (e) => { state.colorMode = e.target.value; renderEditor(); renderPreview(); renderCode(); save(); });
    $('#btn-copy').addEventListener('click', () => {
      copyText(currentCode()).then(() => toast('Copied ' + G.SHELLS[state.shell].label + ' prompt to clipboard'), () => toast('Copy failed — select the code and copy manually'));
    });
    $('#btn-download').addEventListener('click', download);

    document.addEventListener('keydown', (e) => {
      const openM = $$('.modal').find((m) => !m.hidden);
      if (e.key === 'Escape' && openM) { closeModal(openM); return; }
      if (openM || isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'd' && ui.selected.size) { e.preventDefault(); duplicateSelected(); return; }
      if (mod && k === 'a' && document.activeElement === $('#editor')) { e.preventDefault(); selectAll(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selected.size) { e.preventDefault(); removeElements(selectedEls().map((x) => x.id)); return; }
      if (e.key === 'Escape' && ui.selected.size) { selectNone(); return; }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.elements.length && (document.activeElement === $('#editor') || ui.selected.size)) {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.altKey) { nudgeSelected(dir); return; }
        const sel = selectedEls();
        let i = sel.length ? indexOf((dir < 0 ? sel[0] : sel[sel.length - 1]).id) + dir : (dir < 0 ? state.elements.length - 1 : 0);
        i = Math.max(0, Math.min(state.elements.length - 1, i));
        select(state.elements[i].id, { shiftKey: e.shiftKey });
      }
    });

    // Keep clocks in the preview ticking.
    setInterval(() => {
      if (ptr || document.hidden) return;
      if (state.elements.some((e) => e.field === 'time')) { renderPreview(); renderEditor(); }
    }, 1000);
  }

  function init() {
    load();
    applyTheme();
    renderPalette();
    renderShellTabs();
    renderSimForm();
    bind();
    bindTools();
    renderGradient();
    changed({ keepHue: false });
    hist.undo.length = 0;
    updateMeta();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  PG.app = { state, ui, undo, redo, addElements, select, currentCode };
})(window.PG);
