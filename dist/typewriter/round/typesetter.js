(() => {
  'use strict';
  const station = document.querySelector('[data-typesetter]');
  if (!station) return;
  const editor = document.getElementById('editor');
  const sheet = station.querySelector('[data-paper-sheet]');
  const header = sheet.querySelector('.context-bar');
  const guide = sheet.querySelector('[data-write-guide]');
  const nib = sheet.querySelector('[data-paper-caret]');
  const handle = station.querySelector('[data-return-handle]');
  const scale = station.querySelector('[data-carriage-scale]');
  const index = scale.querySelector('[data-carriage-index]');
  const typebar = station.querySelector('[data-typebar]');
  const lineLabel = station.querySelector('[data-type-line]');
  const columnLabel = station.querySelector('[data-type-column]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;

  // Measure the native textarea's actual font and wrapping in a single text
  // node. The editable text, selection, IME and undo history stay native.
  const mirror = document.createElement('div');
  mirror.setAttribute('data-type-measure', '');
  mirror.setAttribute('aria-hidden', 'true');
  const text = document.createTextNode('');
  mirror.append(text);
  document.body.append(mirror);
  const range = document.createRange();
  let mirrored = null;
  let rowHeight = 0;
  let fontSize = 0;
  let padLeft = 0;
  let padTop = 0;
  let previous = null;
  let drag = null;
  let suppressClick = false;
  let composing = false;
  let lastStrike = '';
  let sideRoom = 0;
  let headRoom = 0;
  let paperX = 0;
  let indicator = 0;
  let frame = 0;
  let sweep = null;
  let feed = null;
  let nextImpact = null;

  function carriageAt(x, mark) {
    paperX = x;
    indicator = mark;
    sheet.style.setProperty('--paper-x', x.toFixed(2) + 'px');
    scale.style.setProperty('--carriage-x', mark.toFixed(2) + 'px');
    if (previous && (sweep || drag?.moved)) {
      const strikeX = previous.left + mark - previous.home - x;
      sheet.style.setProperty('--return-caret-x', strikeX.toFixed(2) + 'px');
    } else {
      sheet.style.removeProperty('--return-caret-x');
    }
  }

  function rollSurface() {
    const travel = editor.scrollTop;
    const rise = Math.min(travel, headRoom);
    const headerFeed = Math.min(Math.max(0, travel - rise), Math.max(0, header.offsetTop - 3));
    sheet.style.setProperty('--paper-rise', rise + 'px');
    sheet.style.setProperty('--header-feed', headerFeed + 'px');
    sheet.style.setProperty('--ink-clip', Math.max(0, header.offsetTop + header.offsetHeight + 2 - rise - headerFeed) + 'px');
  }

  function restPosition() {
    if (previous) carriageAt(previous.shift, previous.markX);
  }

  function stopMotion() {
    cancelAnimationFrame(frame);
    frame = 0;
    sweep = nextImpact = feed = null;
    restPosition();
  }

  function advance(now) {
    frame = 0;
    if (sweep && previous) {
      const t = Math.max(0, Math.min(1, (now - sweep.start) / Math.max(1, sweep.end - sweep.start)));
      carriageAt(sweep.x + (previous.shift - sweep.x) * t, sweep.mark + (previous.markX - sweep.mark) * t);
      if (t === 1) { sweep = null; restPosition(); }
    }
    if (feed) {
      let scroll = feed.start;
      let done = true;
      for (const step of feed.steps) {
        const t = Math.max(0, Math.min(1, (now - step.at) / 126));
        scroll += step.distance * (1 - (1 - t) ** 3);
        if (t < 1) done = false;
      }
      editor.scrollTop = scroll;
      feed.current = editor.scrollTop;
      if (done) feed = null;
      refresh();
    }
    if (sweep || feed) frame = requestAnimationFrame(advance);
  }

  function queueFrame() {
    if (!frame) frame = requestAnimationFrame(advance);
  }

  function beginReturn(detail) {
    if (!previous || detail.role === 'receipt') return;
    const start = performance.now();
    nextImpact = start + Math.max(0, Number(detail.impactInMs) || 0);
    if (!reduced.matches && detail.role !== 'lever-release') {
      sweep = { start, end: nextImpact, x: paperX, mark: indicator };
      queueFrame();
    }
  }

  function queueFeed(row) {
    const from = feed?.target ?? previous.scroll;
    const to = Math.min(row * rowHeight, from + rowHeight, editor.scrollHeight - editor.clientHeight);
    if (reduced.matches) {
      editor.scrollTop = to;
    } else {
      if (!feed) feed = { start: from, current: from, target: from, steps: [] };
      feed.steps.push({ at: nextImpact ?? performance.now(), distance: to - from });
      feed.target = to;
      editor.scrollTop = feed.current;
      queueFrame();
    }
    nextImpact = null;
  }

  function layout() {
    if (station.hidden || !editor.clientWidth) return;
    const style = getComputedStyle(editor);
    rowHeight = parseFloat(style.lineHeight);
    const firstLine = sheet.clientHeight * parseFloat(getComputedStyle(sheet).getPropertyValue('--first-line')) / 100;
    sheet.style.setProperty('--ink-start', firstLine + 'px');
    sheet.style.setProperty('--ink-tail', Math.max(0, editor.clientHeight - firstLine - rowHeight) + 'px');
    const machine = sheet.parentElement;
    sideRoom = Math.max(0, (machine.clientWidth - sheet.offsetWidth) / 2 - 5);
    headRoom = Math.max(0, Math.min(rowHeight, machine.getBoundingClientRect().top -
      document.querySelector('.topnav').getBoundingClientRect().bottom - 4));
    fontSize = parseFloat(style.fontSize);
    padLeft = parseFloat(style.paddingLeft);
    padTop = parseFloat(style.paddingTop);
    mirror.style.width = (editor.clientWidth - padLeft - parseFloat(style.paddingRight)) + 'px';
    for (const prop of ['font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
      'lineHeight', 'letterSpacing', 'wordSpacing', 'whiteSpace', 'wordBreak',
      'overflowWrap', 'tabSize', 'textAlign', 'direction', 'fontVariantLigatures']) {
      mirror.style[prop] = style[prop];
    }
    previous = null;
    refresh();
  }

  function animate(el, frames, duration) {
    el.getAnimations().forEach(anim => anim.cancel());
    if (!reduced.matches && !document.hidden) {
      el.animate(frames, { duration, easing: 'cubic-bezier(.22,.68,.31,1)' });
    }
  }

  function refresh(input = false) {
    if (!rowHeight || station.hidden || document.hidden) return;
    const value = editor.value;
    const changed = value !== mirrored;
    if (changed) {
      // Measure a blank last line with its own glyph. Appending a zero-width
      // character to a printed syllable can split its advance in DOM ranges.
      text.data = (!value || value.endsWith('\n')) ? value + '\u200b' : value;
      mirrored = value;
    }
    const offset = editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd;
    const virtualStart = editor.dataset.virtualSyllableStart;
    const focused = document.activeElement === editor;
    const collapsed = editor.selectionStart === editor.selectionEnd;
    if (feed && editor.scrollTop !== feed.current) editor.scrollTop = feed.current;
    const scroll = editor.scrollTop;
    if (!changed && !input && previous && previous.offset === offset && previous.scroll === scroll &&
        previous.scrollLeft === editor.scrollLeft && previous.focused === focused && previous.collapsed === collapsed &&
        previous.composing === composing && previous.virtualStart === virtualStart) return;
    const origin = mirror.getBoundingClientRect();
    function glyphBox(index) {
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      return range.getBoundingClientRect();
    }
    const lineOf = rect => Math.max(0, Math.floor((rect.top + rect.height * .5 - origin.top) / rowHeight));
    // A caret after a newline belongs to the row following it, even if empty.
    const newLine = !offset || value[offset - 1] === '\n';
    const reference = newLine ? offset : offset - 1;
    const glyph = glyphBox(reference);
    const row = lineOf(glyph);
    const wrapped = input && previous && row > previous.row && lastStrike === 'key' && !composing &&
      !value.slice(Math.min(offset, previous.offset), offset).includes('\n');
    if (wrapped) document.dispatchEvent(new CustomEvent('gulgam:key-sound', { detail: { kind: 'return', code: 'Enter' } }));
    if (input && previous && (wrapped || (lastStrike === 'return' && nextImpact !== null))) queueFeed(row);
    rollSurface();
    const bounds = editor.getBoundingClientRect();
    const box = sheet.getBoundingClientRect();
    const left = bounds.left - box.left - sheet.clientLeft + editor.clientLeft + padLeft - editor.scrollLeft;
    const top = bounds.top - box.top - sheet.clientTop + editor.clientTop + padTop - editor.scrollTop;
    range.setStart(text, offset);
    range.collapse(true);
    const insertion = range.getBoundingClientRect();
    const caretX = insertion.height && lineOf(insertion) === row
      ? insertion.left : newLine ? glyph.left : glyph.right;
    let low = 0, high = reference;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineOf(glyphBox(middle)) < row) low = middle + 1;
      else high = middle;
    }
    const lineText = value.slice(low, offset);
    const column = segmenter ? Array.from(segmenter.segment(lineText)).length : Array.from(lineText).length;
    const nibHeight = Math.min(rowHeight, fontSize * 1.03);
    const x = left + Math.min(editor.clientWidth - 3, Math.max(0, caretX - origin.left));
    // The text model already contains the newline, but the metal writing
    // point stays on the same baseline while the roller brings that row up.
    const pendingFeed = feed ? feed.target - editor.scrollTop : 0;
    const y = top + row * rowHeight + (rowHeight - nibHeight) / 2 - pendingFeed;
    const guideY = y + nibHeight + 1;
    const inView = y + nibHeight <= bounds.bottom - box.top + 1 && y >= bounds.top - box.top - 2;
    sheet.style.setProperty('--strike-x', x.toFixed(2) + 'px');
    sheet.style.setProperty('--strike-y', y.toFixed(2) + 'px');
    sheet.style.setProperty('--strike-height', nibHeight.toFixed(2) + 'px');
    sheet.style.setProperty('--guide-y', guideY.toFixed(2) + 'px');
    sheet.toggleAttribute('data-caret-visible', focused && collapsed && !composing && inView);
    sheet.toggleAttribute('data-guide-hidden', !inView);
    // A vowel and a final consonant strike the same cell as the initial.
    // Keep the native caret independent of the platen's position indicator.
    const virtualCell = virtualStart === undefined ? -1 : Number(virtualStart);
    let cellX = caretX;
    if (collapsed && virtualCell >= 0 && virtualCell < offset) {
      cellX = glyphBox(virtualCell).left;
    } else if (composing && !newLine) {
      cellX = glyph.left;
    }
    const scaleBox = scale.getBoundingClientRect();
    // The paper advances to the left as ink fills the row. The return brings
    // the left margin back to its home position without crossing the frame.
    const inkWidth = Math.max(0, cellX - origin.left);
    const shift = reduced.matches ? 0 : -sideRoom * inkWidth / (inkWidth + editor.clientWidth * .30);
    const home = box.left - paperX + sheet.clientLeft + left - scaleBox.left - scale.clientLeft;
    const markX = Math.max(0, Math.min(scale.clientWidth, home + shift + inkWidth));
    station.dataset.row = String(row + 1);
    station.dataset.column = String(column);
    if (lineLabel) lineLabel.textContent = String(row + 1).padStart(2, '0');
    if (columnLabel) columnLabel.textContent = String(column + 1).padStart(2, '0');
    previous = { offset, left, scroll: editor.scrollTop, scrollLeft: editor.scrollLeft,
      focused, collapsed, composing, virtualStart, row, shift, markX, home };
    if (!drag && !sweep) restPosition();
    if (input) lastStrike = '';
  }

  document.addEventListener('gulgam:strike', event => {
    if (station.hidden) return;
    lastStrike = event.detail.kind;
    if (lastStrike === 'return') beginReturn(event.detail);
    if (lastStrike === 'key') {
      const angle = { initial: 17, medial: 3, final: -18 }[event.detail.role] ?? -11;
      const rest = 'rotate(-68deg) scaleY(.63)';
      animate(typebar, [
        { transform: rest },
        { transform: 'rotate(' + angle + 'deg) scaleY(.91)', offset: .20 },
        { transform: 'rotate(0deg) scaleY(1.10)', offset: .36 },
        { transform: rest }
      ], 124);
      animate(nib, [{ translate: '0 2px' }, { translate: '0 0' }], 85);
      animate(index, [{ translate: '0 2px' }, { translate: '0 -2px', offset: .3 },
        { translate: '0 0' }], 100);
    }
  });
  editor.addEventListener('input', event => {
    if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') lastStrike = '';
    refresh(true);
  });
  editor.addEventListener('compositionstart', () => { composing = true; refresh(); });
  editor.addEventListener('compositionend', () => { composing = false; refresh(); });
  document.addEventListener('gulgam:compose-position', () => refresh());
  editor.addEventListener('focus', () => refresh());
  sheet.addEventListener('click', event => {
    if (event.target !== sheet) return;
    editor.removeAttribute('inputmode');
    editor.focus({ preventScroll: true });
  });
  editor.addEventListener('blur', () => {
    sheet.removeAttribute('data-caret-visible');
    refresh();
  });
  editor.addEventListener('wheel', stopMotion, { passive: true });
  editor.addEventListener('pointerdown', stopMotion);
  editor.addEventListener('scroll', () => refresh(), { passive: true });
  editor.addEventListener('keyup', () => { lastStrike = ''; refresh(); });
  document.addEventListener('selectionchange', () => refresh());
  window.addEventListener('storage', () => refresh());
  window.addEventListener('pageshow', layout);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) layout(); });
  document.getElementById('back').addEventListener('click', layout);
  const observer = new ResizeObserver(layout);
  observer.observe(editor);
  document.fonts.ready.then(layout);
  document.fonts.addEventListener('loadingdone', layout);
  layout();

  function returnCarriage(touch, role) {
    if (station.hidden) return;
    if (composing) editor.blur();
    if (touch) editor.setAttribute('inputmode', 'none');
    editor.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('gulgam:key-sound', { detail: { kind: 'return', code: 'Enter', role } }));
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

  function release(completed = false) {
    drag = null;
    handle.style.removeProperty('--pull');
    handle.removeAttribute('data-dragging');
    if (!completed) restPosition();
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick = false;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    if (sweep) { sweep = null; restPosition(); }
    drag = { id: event.pointerId, x: event.clientX, shift: paperX, mark: indicator,
      home: previous?.home ?? indicator, moved: false, progress: 0, detent: 0,
      distance: Math.max(12, Math.min(event.pointerType === 'touch' ? 32 : 48, event.clientX - 5)) };
    handle.toggleAttribute('data-dragging', true);
  });
  function updatePull(x) {
    const distance = drag.x - x;
    if (Math.abs(distance) > 5) drag.moved = true;
    drag.progress = Math.max(0, Math.min(1, distance / drag.distance));
    handle.style.setProperty('--pull', drag.progress.toFixed(3));
    if (!reduced.matches) carriageAt(drag.shift * (1 - drag.progress),
      drag.mark + (drag.home - drag.mark) * drag.progress);
    const step = Math.round(drag.progress * 3);
    if (step > drag.detent) {
      const steps = step - drag.detent;
      drag.detent = step;
      document.dispatchEvent(new CustomEvent('gulgam:ratchet', { detail: { steps } }));
    }
  }
  handle.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) updatePull(event.clientX);
  });
  handle.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    updatePull(event.clientX);
    const finish = drag.moved && drag.progress === 1;
    suppressClick = drag.moved;
    release(finish);
    if (finish) returnCarriage(event.pointerType === 'touch', 'lever-release');
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
    if (feed) editor.scrollTop = feed.target;
    stopMotion();
    release();
    for (const el of [guide, nib, editor, sheet, index, typebar]) for (const anim of el.getAnimations()) anim.cancel();
    lastStrike = '';
    layout();
  }
  document.addEventListener('gulgam:receipt', rest);
  window.addEventListener('pagehide', rest);
  reduced.addEventListener('change', rest);
})();
