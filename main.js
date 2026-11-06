'use strict';

const { Plugin, MarkdownView, Notice, setIcon } = require('obsidian');

const EMBED_SEL = '.internal-embed.image-embed';
const HANDLE = 18;
const MIN_W = 40;

/* -- format: ![[image.png|free x=120 y=-40 w=300]] -- */
function parseAlt(alt) {
  if (!alt) return null;
  const m = alt.trim().match(/^free(?:\s+(.*))?$/i);
  if (!m) return null;
  const p = { x: 0, y: 0, w: null };
  (m[1] || '').split(/\s+/).forEach((tok) => {
    const t = tok.match(/^([xyw])=(-?\d+(?:\.\d+)?)$/i);
    if (t) p[t[1].toLowerCase()] = Math.round(parseFloat(t[2]));
  });
  return p;
}

function formatAlt(p) {
  let s = `free x=${Math.round(p.x)} y=${Math.round(p.y)}`;
  if (p.w) s += ` w=${Math.round(p.w)}`;
  return s;
}

function findEmbed(text, src, approx) {
  const re = /!\[\[([^\]]+?)\]\]/g;
  let m;
  let best = null;
  while ((m = re.exec(text))) {
    const target = m[1].split('|')[0];
    if (target.trim() !== src) continue;
    const dist = Math.abs(m.index - approx);
    if (!best || dist < best.dist) {
      best = { from: m.index, to: m.index + m[0].length, target, dist };
    }
  }
  return best;
}

function buildLink(target, params, keepWidth) {
  if (params) return `![[${target}|${formatAlt(params)}]]`;
  if (keepWidth) return `![[${target}|${Math.round(keepWidth)}]]`;
  return `![[${target}]]`;
}

function lineToOffset(text, line) {
  if (!line) return 0;
  let off = 0;
  for (let i = 0; i < line; i++) {
    const n = text.indexOf('\n', off);
    if (n === -1) return text.length;
    off = n + 1;
  }
  return off;
}

/* -- plugin -- */

class FreeImagesPlugin extends Plugin {
  async onload() {
    this.drag = null;
    this.suppressClick = false;
    this.rafPending = false;

    this.registerMarkdownPostProcessor((el, ctx) => {
      const info = ctx.getSectionInfo(el);
      if (!info) return;
      el.querySelectorAll('.internal-embed').forEach((e) => {
        e.dataset.fimLine = String(info.lineStart);
      });
    });

    this.observer = new MutationObserver(() => this.scheduleApply());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['alt', 'class', 'src'],
    });
    this.app.workspace.onLayoutReady(() => this.applyAll());

    const opts = { capture: true };
    this.registerDomEvent(document, 'pointerdown', (e) => this.blockDeleteBtn(e) || this.onPointerDown(e), opts);
    this.registerDomEvent(document, 'mousedown', (e) => this.blockDeleteBtn(e) || this.blockIfFree(e), opts);
    this.registerDomEvent(document, 'click', (e) => this.onDeleteClick(e) || this.onClick(e), opts);
    this.registerDomEvent(document, 'dblclick', (e) => this.onDblClick(e), opts);
    this.registerDomEvent(document, 'pointermove', (e) => this.onHover(e));
    this.registerDomEvent(window, 'pointermove', (e) => this.onPointerMove(e));
    this.registerDomEvent(window, 'pointerup', (e) => this.onPointerUp(e));
    this.registerDomEvent(window, 'pointercancel', (e) => this.onPointerUp(e));

    this.addCommand({
      id: 'make-free-in-line',
      name: 'Free-position image on current line',
      editorCallback: (editor) => this.toggleLine(editor, true),
    });
    this.addCommand({
      id: 'reset-in-line',
      name: 'Reset image on current line',
      editorCallback: (editor) => this.toggleLine(editor, false),
    });
    this.addCommand({
      id: 'reset-all',
      name: 'Reset all free images in current note',
      editorCallback: (editor) => {
        const text = editor.getValue();
        const out = text.replace(/!\[\[([^\]|]+)\|free[^\]]*\]\]/gi, (all, target) => {
          const p = parseAlt(all.slice(all.indexOf('|') + 1, -2));
          return buildLink(target, null, p && p.w);
        });
        if (out !== text) editor.setValue(out);
      },
    });
  }

  onunload() {
    if (this.observer) this.observer.disconnect();
    document.querySelectorAll('.fim-free').forEach((el) => this.clearStyle(el));
  }

  /* -- display -- */

  scheduleApply() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.applyAll();
    });
  }

  getAlt(embed) {
    const img = embed.querySelector('img');
    return embed.getAttribute('alt') || (img && img.getAttribute('alt')) || '';
  }

  applyAll() {
    document.querySelectorAll(EMBED_SEL).forEach((embed) => {
      if (this.drag && this.drag.embed === embed) return;
      const p = parseAlt(this.getAlt(embed));
      if (p) this.setStyle(embed, p);
      else if (embed.classList.contains('fim-free')) this.clearStyle(embed);
    });
  }

  setStyle(embed, p) {
    if (!embed.classList.contains('fim-free')) embed.classList.add('fim-free');
    this.ensureDeleteBtn(embed);
    const t = `translate(${p.x}px, ${p.y}px)`;
    if (embed.style.transform !== t) embed.style.transform = t;
    const w = p.w ? `${p.w}px` : '';
    if (embed.style.width !== w) embed.style.width = w;
  }

  clearStyle(embed) {
    embed.classList.remove('fim-free', 'fim-dragging', 'fim-resize-hover');
    embed.style.transform = '';
    embed.style.width = '';
    embed.querySelectorAll(':scope > .fim-delete').forEach((b) => b.remove());
  }

  ensureDeleteBtn(embed) {
    if (embed.querySelector(':scope > .fim-delete')) return;
    const btn = document.createElement('button');
    btn.className = 'fim-delete clickable-icon';
    btn.setAttribute('aria-label', 'Remove image from note');
    setIcon(btn, 'trash-2');
    embed.appendChild(btn);
  }

  /* -- mouse / touch -- */

  deleteBtnFromEvent(evt) {
    const t = evt.target;
    return t instanceof Element ? t.closest('.fim-free > .fim-delete') : null;
  }

  // Keep Obsidian from treating a press on the button as a click into the editor.
  blockDeleteBtn(evt) {
    if (!this.deleteBtnFromEvent(evt)) return false;
    evt.preventDefault();
    evt.stopPropagation();
    return true;
  }

  onDeleteClick(evt) {
    const btn = this.deleteBtnFromEvent(evt);
    if (!btn) return false;
    evt.preventDefault();
    evt.stopPropagation();
    this.save(btn.parentElement, null, null, true);
    return true;
  }

  embedFromEvent(evt) {
    const t = evt.target;
    if (!(t instanceof Element) || t.tagName !== 'IMG') return null;
    return t.closest(EMBED_SEL);
  }

  inHandle(img, evt) {
    const r = img.getBoundingClientRect();
    return r.right - evt.clientX < HANDLE && r.bottom - evt.clientY < HANDLE;
  }

  blockIfFree(evt) {
    const embed = this.embedFromEvent(evt);
    if (embed && (embed.classList.contains('fim-free') || evt.altKey)) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }

  onPointerDown(evt) {
    if (evt.button !== 0) return;
    const embed = this.embedFromEvent(evt);
    if (!embed) return;
    const img = embed.querySelector('img');
    const current = parseAlt(this.getAlt(embed));
    if (!current && !evt.altKey) return; // regular image: keep Obsidian's default behavior

    evt.preventDefault();
    evt.stopPropagation();

    const width = Math.round(img.getBoundingClientRect().width);
    const start = current
      ? { x: current.x, y: current.y, w: current.w || width }
      : { x: 0, y: 0, w: width };

    this.drag = {
      embed,
      mode: current && this.inHandle(img, evt) ? 'resize' : 'move',
      startX: evt.clientX,
      startY: evt.clientY,
      start,
      p: { ...start },
      wasFree: !!current,
      moved: false,
    };
    embed.classList.add('fim-dragging');
    this.setStyle(embed, start);
  }

  onPointerMove(evt) {
    const d = this.drag;
    if (!d) return;
    const dx = evt.clientX - d.startX;
    const dy = evt.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.mode === 'move') {
      d.p.x = d.start.x + dx;
      d.p.y = d.start.y + dy;
    } else {
      d.p.w = Math.max(MIN_W, d.start.w + dx);
    }
    this.setStyle(d.embed, d.p);
  }

  async onPointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.embed.classList.remove('fim-dragging');
    if (!d.moved) {
      if (!d.wasFree) this.clearStyle(d.embed);
      return;
    }
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 50);
    await this.save(d.embed, d.p, null);
  }

  onClick(evt) {
    const embed = this.embedFromEvent(evt);
    if (!embed) return;
    if (this.suppressClick || embed.classList.contains('fim-free') || evt.altKey) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }

  async onDblClick(evt) {
    const embed = this.embedFromEvent(evt);
    if (!embed || !evt.altKey || !embed.classList.contains('fim-free')) return;
    evt.preventDefault();
    evt.stopPropagation();
    const p = parseAlt(this.getAlt(embed));
    await this.save(embed, null, p && p.w);
  }

  onHover(evt) {
    if (this.drag) return;
    const embed = this.embedFromEvent(evt);
    if (!embed || !embed.classList.contains('fim-free')) return;
    const img = embed.querySelector('img');
    embed.classList.toggle('fim-resize-hover', this.inHandle(img, evt));
  }

  /* -- save to markdown -- */

  viewFor(el) {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.containerEl.contains(el)) return v;
    }
    return null;
  }

  // remove = true deletes the embed link from the note (the image file is kept).
  async save(embed, params, keepWidth, remove = false) {
    const view = this.viewFor(embed);
    const src = (embed.getAttribute('src') || '').trim();
    if (!view || !view.file || !src) {
      new Notice('Free Images: Could not find the note this image belongs to.');
      return;
    }

    const inEditor = !!embed.closest('.markdown-source-view') && view.editor;
    if (inEditor) {
      const editor = view.editor;
      const text = editor.getValue();
      let approx = 0;
      try {
        approx = editor.cm.posAtDOM(embed);
      } catch (e) {
        approx = 0;
      }
      const hit = findEmbed(text, src, approx);
      if (!hit) return this.notFound();
      editor.replaceRange(
        remove ? '' : buildLink(hit.target, params, keepWidth),
        editor.offsetToPos(hit.from),
        editor.offsetToPos(hit.to)
      );
    } else {
      const line = parseInt(embed.dataset.fimLine || '0', 10);
      let ok = false;
      await this.app.vault.process(view.file, (text) => {
        const hit = findEmbed(text, src, lineToOffset(text, line));
        if (!hit) return text;
        ok = true;
        return text.slice(0, hit.from) + (remove ? '' : buildLink(hit.target, params, keepWidth)) + text.slice(hit.to);
      });
      if (!ok) this.notFound();
    }
  }

  notFound() {
    new Notice('Free Images: Link not found. Only ![[...]] image embeds are supported.');
  }

  toggleLine(editor, makeFree) {
    const line = editor.getCursor().line;
    const text = editor.getLine(line);
    const re = /!\[\[([^\]]+?)\]\]/;
    const m = text.match(re);
    if (!m) {
      new Notice('Free Images: No image embed on this line.');
      return;
    }
    const parts = m[1].split('|');
    const target = parts[0];
    const p = parseAlt(parts.slice(1).join('|'));
    const num = parts.slice(1).find((s) => /^\d+$/.test(s.trim()));
    const repl = makeFree
      ? buildLink(target, p || { x: 0, y: 0, w: num ? parseInt(num, 10) : null })
      : buildLink(target, null, p && p.w);
    editor.replaceRange(
      repl,
      { line, ch: m.index },
      { line, ch: m.index + m[0].length }
    );
  }
}

module.exports = FreeImagesPlugin;
module.exports._test = { parseAlt, formatAlt, findEmbed, buildLink, lineToOffset };
