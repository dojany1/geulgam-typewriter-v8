(() => {
  'use strict';
  const station = document.querySelector('[data-typesetter]');
  if (!station) return;
  const editor = document.getElementById('editor');
  const housing = station.querySelector('[data-type-window]');
  const belt = station.querySelector('[data-type-belt]');
  const head = station.querySelector('[data-type-head]');
  const handle = station.querySelector('[data-return-handle]');
  const lineLabel = station.querySelector('[data-type-line]');
  const columnLabel = station.querySelector('[data-type-column]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  const imprint = document.createElement('span');
  imprint.className = 'type-imprint';
  head.append(imprint);

  // A textarea exposes selection offsets, but not its visual line breaks.
  // Measure only the active paragraph. The user's actual textarea keeps the IME,
  // undo stack, focus and pointer selection.
  const mirror = document.createElement('div');
  mirror.toggleAttribute('data-type-measure', true);
  mirror.setAttribute('aria-hidden', 'true');
  const run = document.createTextNode('');
  mirror.append(run);
  document.body.append(mirror);
  const range = document.createRange();
  let previous = null;
  let pitch = 0;
  let radius = 0;
  let revision = 0;
  let lastStrike = '';
  let drag = null;
  let suppressClick = false;
  let preparingReturn = false;
  let composing = false;
  const slots = [];
  let preceding = { text: '', rows: 0 };

  function layout() {
    const style = getComputedStyle(editor);
    mirror.style.width = (editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) + 'px';
    for (const prop of ['font', 'lineHeight', 'letterSpacing', 'wordSpacing', 'whiteSpace',
      'wordBreak', 'overflowWrap', 'tabSize', 'textAlign', 'direction']) mirror.style[prop] = style[prop];
    preceding = { text: '', rows: 0 };
    revision++;
    pitch = parseFloat(getComputedStyle(housing).getPropertyValue('--cell-pitch'));
    if (!pitch || !housing.clientWidth) return;
    radius = Math.ceil(housing.clientWidth / pitch / 2) + 3;
    const count = 2 * radius + 1;
    while (slots.length > count) slots.pop().cell.remove();
    while (slots.length < count) {
      const cell = document.createElement('span');
      const division = document.createElement('small');
      const glyph = document.createElement('span');
      cell.className = 'type-cell';
      division.className = 'type-division';
      glyph.className = 'type-glyph';
      cell.append(division, glyph);
      belt.append(cell);
      slots.push({ cell, division, glyph });
    }
    belt.style.transform = 'translateX(' + (-(radius + .5) * pitch) + 'px)';
    refresh();
  }

  function lineAtCaret() {
    const value = editor.value;
    const caret = editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd;
    const begin = caret ? value.lastIndexOf('\n', caret - 1) + 1 : 0;
    const next = value.indexOf('\n', caret);
    const end = next === -1 ? value.length : next;
    const leading = parseFloat(getComputedStyle(editor).lineHeight);
    // The preceding paragraphs stay identical on successive strokes. Measure
    // their rendered rows once, including empty paragraphs and soft wraps.
    const prefix = value.slice(0, begin);
    if (preceding.text !== prefix) {
      run.data = prefix + '\u200b';
      preceding = { text: prefix, rows: Math.max(0, Math.round(mirror.clientHeight / leading) - 1) };
    }
    let row = preceding.rows + 1;
    const content = value.slice(begin, end);
    let first = 0;
    let stop = content.length;
    const offset = caret - begin;
    if (content.length) {
      if (run.data !== content) run.data = content;
      const baseline = mirror.getBoundingClientRect().top;
      // Use the glyph immediately before an insertion point, matching the
      // side of a soft break where the last character actually struck.
      const topAt = i => {
        range.setStart(run, i);
        range.setEnd(run, i + 1);
        const rect = range.getBoundingClientRect();
        return Math.max(0, Math.floor((rect.top + rect.height / 2 - baseline) / leading));
      };
      const reference = Math.max(0, offset - 1);
      const top = topAt(reference);
      row += top;
      // Seek the row boundaries without measuring each character on every key.
      function boundary(lo, hi, past) {
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          const diff = topAt(mid) - top;
          if (past ? diff <= 0 : diff < 0) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      }
      first = boundary(0, reference, false);
      stop = boundary(reference + 1, content.length, true);
    }
    const visible = content.slice(first, stop);
    const columnOffset = offset - first;
    const glyphs = [];
    let column = 0;
    const parts = segmenter ? segmenter.segment(visible) : Array.from(visible);
    let i = 0;
    for (const part of parts) {
      const glyph = typeof part === 'string' ? part : part.segment;
      if (i < columnOffset) column++;
      i += glyph.length;
      glyphs.push(glyph);
    }
    return { row, begin, first, column, glyphs };
  }

  function animate(el, frames, duration) {
    for (const anim of el.getAnimations()) anim.cancel();
    if (!reduced.matches && !document.hidden) {
      el.animate(frames, { duration, easing: 'cubic-bezier(.2,.62,.32,1)' });
    }
  }

  function refresh(reason) {
    if (!slots.length || station.hidden || document.hidden) return;
    // Ignore redundant selectionchange events following an input, including
    // the browser's delayed event for a change made by the screen keyboard.
    const caret = editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd;
    if (!reason && previous?.revision === revision && previous.caret === caret && previous.radius === radius) return;
    const current = lineAtCaret();
    const typed = reason === 'input';
    const changedLine = previous && (current.begin !== previous.begin || current.first !== previous.first);
    const explicitReturn = typed && preparingReturn;
    const wrapped = typed && lastStrike === 'key' && previous && current.begin === previous.begin &&
      current.first > previous.first && !composing;
    const returning = explicitReturn || wrapped;
    const delta = previous ? current.column - previous.column : 0;
    const ink = typed && !returning && lastStrike === 'key' ? current.column - 1 : -1;
    station.dataset.row = current.row;
    station.dataset.column = current.column;
    lineLabel.textContent = String(current.row).padStart(2, '0');
    columnLabel.textContent = String(current.column + 1).padStart(2, '0');
    slots.forEach(({ cell, division, glyph }, i) => {
      const col = current.column + i - radius;
      const text = current.glyphs[col] || '';
      cell.dataset.column = col;
      cell.toggleAttribute('data-outside', col < 0);
      cell.toggleAttribute('data-caret', col === current.column);
      cell.toggleAttribute('data-inked', col === ink && ink >= 0);
      cell.toggleAttribute('data-major', col >= 0 && col % 5 === 0);
      const label = col >= 0 && col % 5 === 0 ? String(col).padStart(2, '0') : '';
      if (glyph.textContent !== text) glyph.textContent = text;
      if (division.textContent !== label) division.textContent = label;
    });
    const inkText = current.glyphs[ink];
    if (ink >= 0 && inkText?.trim()) {
      imprint.textContent = inkText;
      animate(imprint, [{ opacity: 1 }, { opacity: 1, offset: .55 }, { opacity: 0 }], 95);
    }
    if (returning) {
      const travel = Math.min(housing.clientWidth * .4, Math.max(2 * pitch, (previous?.column || 0) * pitch));
      animate(belt, [{ translate: -travel + 'px 6px' }, { translate: '3px 0', offset: .83 }, { translate: '0 0' }], 235);
      animate(editor, [{ translate: '0 5px' }, { translate: '0 0' }], 190);
    } else if (typed && !changedLine && delta && Math.abs(delta) <= 2) {
      animate(belt, [{ translate: delta * pitch + 'px 0' }, { translate: '0 0' }], 92);
    }
    previous = { begin: current.begin, first: current.first, row: current.row, column: current.column, caret, revision, radius };
    if (typed) { preparingReturn = false; lastStrike = ''; }
    if (wrapped) {
      document.dispatchEvent(new CustomEvent('gulgam:key-sound', { detail: { kind: 'return', code: 'Enter' } }));
      preparingReturn = false;
      lastStrike = '';
    }
  }

  document.addEventListener('gulgam:strike', event => {
    if (station.hidden) return;
    lastStrike = event.detail.kind;
    preparingReturn = lastStrike === 'return';
    if (lastStrike === 'key') animate(head, [
      { translate: '0 4px' }, { translate: '0 -2px', offset: .22 }, { translate: '0 0' }
    ], 93);
  });
  editor.addEventListener('input', event => {
    revision++;
    if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') lastStrike = '';
    refresh('input');
  });
  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => { composing = false; refresh(); });
  editor.addEventListener('focus', () => refresh());
  editor.addEventListener('keyup', () => { preparingReturn = false; lastStrike = ''; refresh(); });
  document.addEventListener('selectionchange', () => refresh());
  window.addEventListener('storage', () => { revision++; refresh(); });
  window.addEventListener('pageshow', () => { revision++; refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  document.getElementById('back').addEventListener('click', () => refresh());
  new ResizeObserver(layout).observe(editor);
  document.fonts.ready.then(layout);
  layout();

  function returnCarriage(touch) {
    if (station.hidden) return;
    if (composing) editor.blur();
    if (touch) editor.setAttribute('inputmode', 'none');
    editor.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('gulgam:key-sound', { detail: { kind: 'return', code: 'Enter' } }));
    editor.setAttribute('data-virtual-edit', '');
    try {
      if (!document.execCommand?.('insertText', false, '\n')) {
        editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } finally {
      editor.removeAttribute('data-virtual-edit');
    }
  }

  function release() {
    drag = null;
    handle.style.removeProperty('--pull');
    handle.removeAttribute('data-dragging');
    belt.style.removeProperty('translate');
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick = false;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, moved: false, progress: 0, detent: 0,
      distance: event.pointerType === 'touch' ? 32 : 48 };
    handle.toggleAttribute('data-dragging', true);
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const distance = drag.x - event.clientX;
    if (Math.abs(distance) > 5) drag.moved = true;
    drag.progress = Math.max(0, Math.min(1, distance / drag.distance));
    handle.style.setProperty('--pull', drag.progress.toFixed(3));
    if (!reduced.matches) belt.style.translate = (drag.progress * pitch * .9).toFixed(2) + 'px 0';
    const step = Math.floor(drag.progress * 3);
    while (drag.detent < step) {
      drag.detent++;
      document.dispatchEvent(new Event('gulgam:ratchet'));
    }
  });
  handle.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    const finish = drag.moved && drag.progress === 1;
    suppressClick = drag.moved;
    release();
    if (finish) returnCarriage(event.pointerType === 'touch');
  });
  handle.addEventListener('lostpointercapture', () => {
    if (drag) { suppressClick = true; release(); }
  });
  handle.addEventListener('pointercancel', () => { suppressClick = true; release(); });
  handle.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) returnCarriage(event.pointerType === 'touch');
    suppressClick = false;
  });
  function rest() {
    release();
    for (const el of [head, belt, imprint, editor]) for (const anim of el.getAnimations()) anim.cancel();
    preparingReturn = false;
    lastStrike = '';
  }
  document.addEventListener('gulgam:receipt', rest);
  window.addEventListener('pagehide', rest);
  reduced.addEventListener('change', rest);
})();
