(() => {
  'use strict';

  const editor = document.getElementById('editor');
  const keyboard = document.querySelector('[data-ui-keyboard]');
  if (!editor || !keyboard) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  const buttons = new Map(Array.from(keyboard.querySelectorAll('button[data-code]'),
    button => [button.dataset.code, button]));
  const flashTimers = new Map();

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const korean = 'ㅁㅠㅊㅇㄷㄹㅎㅗㅑㅓㅏㅣㅡㅜㅐㅔㅂㄱㄴㅅㅕㅍㅈㅌㅛㅋ';
  const shiftedKorean = { Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ' };
  const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const vowels = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const finals = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  const doubleVowels = { 'ㅗㅏ':'ㅘ', 'ㅗㅐ':'ㅙ', 'ㅗㅣ':'ㅚ', 'ㅜㅓ':'ㅝ', 'ㅜㅔ':'ㅞ', 'ㅜㅣ':'ㅟ', 'ㅡㅣ':'ㅢ' };
  const doubleFinals = { 'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ', 'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ',
    'ㄹㅂ':'ㄼ', 'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ', 'ㅂㅅ':'ㅄ' };
  const isVowel = letter => letter !== undefined && vowels.includes(letter);
  let english = false;
  let shifted = false;
  let active = null;
  let nativeComposition = false;

  // Only recompose the syllable under construction. A new vowel can move the
  // previous final consonant across the boundary, e.g. 값 + ㅏ becomes 갑사.
  function compose(parts) {
    const syllables = [];
    let index = 0;
    while (index < parts.length) {
      const start = index;
      const first = parts[index++];
      const lead = initials.indexOf(first);
      let text = first;
      if (lead >= 0 && isVowel(parts[index])) {
        let vowel = parts[index++];
        if (doubleVowels[vowel + parts[index]]) vowel = doubleVowels[vowel + parts[index++]];
        let final = ' ';
        if (finals.indexOf(parts[index]) > 0 && !isVowel(parts[index + 1])) {
          final = parts[index++];
          const compound = doubleFinals[final + parts[index]];
          if (compound && !isVowel(parts[index + 1])) { final = compound; index++; }
        }
        text = String.fromCharCode(0xAC00 + (lead * 21 + vowels.indexOf(vowel)) * 28 + finals.indexOf(final));
      } else if (isVowel(first) && doubleVowels[first + parts[index]]) {
        text = doubleVowels[first + parts[index++]];
      }
      syllables.push({ text, parts: parts.slice(start, index) });
    }
    return syllables;
  }

  function updateLayout() {
    keyboard.dataset.layout = english ? 'en' : 'ko';
    keyboard.dataset.shift = shifted ? 'on' : 'off';
    for (const [code, button] of buttons) {
      if (code.startsWith('Shift')) button.setAttribute('aria-pressed', String(shifted));
      if (code === 'Lang1') {
        button.setAttribute('aria-pressed', String(english));
        button.setAttribute('aria-label', english ? '현재 영문 자판, 한글로 전환' : '현재 한글 자판, 영문으로 전환');
      }
      if (!/^Key[A-Z]$/.test(code)) continue;
      const letter = code.at(-1);
      const hangul = (shifted && shiftedKorean[letter]) || korean[alphabet.indexOf(letter)];
      const latin = shifted ? letter : letter.toLowerCase();
      button.querySelector('[data-key-primary]').textContent = english ? latin : hangul;
      button.querySelector('[data-key-secondary]').textContent = english ? hangul : letter;
      button.setAttribute('aria-label', english ? latin : hangul);
    }
    for (const [code, normal, upper] of [['Comma', ',', '<'], ['Period', '.', '>']]) {
      const button = buttons.get(code);
      if (!button) continue;
      const label = button.querySelector('[data-key-primary]');
      if (label) label.textContent = shifted ? upper : normal;
      button.setAttribute('aria-label', shifted ? upper : normal);
    }
  }

  function flash(code) {
    const button = buttons.get(code);
    if (!button || document.body.dataset.view !== 'write') return;
    clearTimeout(flashTimers.get(code));
    button.classList.add('is-struck');
    flashTimers.set(code, setTimeout(() => {
      button.classList.remove('is-struck');
      flashTimers.delete(code);
    }, 120));
  }

  document.addEventListener('gulgam:strike', event => {
    const { code, kind } = event.detail;
    flash(code || ({ space: 'Space', return: 'Enter', delete: 'Backspace' })[kind]);
  });
  editor.addEventListener('keydown', event => {
    active = null;
    if (!event.ctrlKey && !event.metaKey && !event.altKey
        && (event.key === 'Shift' || event.key.startsWith('Arrow'))) flash(event.code);
  });
  editor.addEventListener('compositionstart', () => { nativeComposition = true; active = null; });
  editor.addEventListener('compositionend', () => { nativeComposition = false; });
  editor.addEventListener('input', () => { if (!editor.hasAttribute('data-virtual-edit')) active = null; });
  editor.addEventListener('pointerdown', () => { editor.removeAttribute('inputmode'); active = null; });
  window.addEventListener('storage', event => { if (event.key === 'gulgam.draft.v1') active = null; });

  // Preserve selection while clicking keys. When the virtual keyboard is
  // used on touch, a later tap on the textarea can reopen the device IME.
  keyboard.addEventListener('pointerdown', event => {
    if (event.button === 0 && event.target.closest('button[data-code]')) event.preventDefault();
  });

  function boundary(position, direction) {
    const value = editor.value;
    if (direction < 0 && position === 0 || direction > 0 && position === value.length) return position;
    if (segmenter) {
      const part = segmenter.segment(value).containing(direction < 0 ? position - 1 : position);
      return direction < 0 ? part.index : part.index + part.segment.length;
    }
    if (direction > 0) return position + (value.codePointAt(position) > 0xffff ? 2 : 1);
    return position - (position > 1 && value.codePointAt(position - 2) > 0xffff ? 2 : 1);
  }

  function edit(start, end, text) {
    editor.setSelectionRange(start, end);
    if (start === end && !text) return;
    editor.setAttribute('data-virtual-edit', '');
    try {
      // Native editing commands keep virtual keystrokes in the textarea's undo history.
      if (document.execCommand?.(text ? 'insertText' : 'delete', false, text)) return;
      editor.setRangeText(text, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      editor.removeAttribute('data-virtual-edit');
    }
  }

  function stillEditingSyllable() {
    if (!active) return false;
    const end = active.start + active.text.length;
    return editor.selectionStart === end && editor.selectionEnd === end
      && editor.value.slice(active.start, end) === active.text;
  }

  function replaceSyllable(parts, start, end) {
    const syllables = compose(parts);
    const text = syllables.map(syllable => syllable.text).join('');
    edit(start, end, text);
    const last = syllables.at(-1);
    active = last ? { ...last, start: start + text.length - last.text.length } : null;
  }

  keyboard.addEventListener('click', event => {
    const button = event.target.closest('button[data-code]');
    if (!button || document.body.dataset.view !== 'write') return;
    const code = button.dataset.code;
    const retainButtonFocus = document.activeElement === button && event.detail === 0;
    const touch = event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents;
    if (code.startsWith('Shift') || code === 'Lang1') {
      if (code === 'Lang1') { english = !english; shifted = false; active = null; }
      else shifted = !shifted;
      updateLayout();
      flash(code);
      if (!retainButtonFocus) {
        if (touch) editor.setAttribute('inputmode', 'none');
        editor.focus({ preventScroll: true });
      }
      return;
    }
    if (nativeComposition) editor.blur();
    if (touch) editor.setAttribute('inputmode', 'none');
    editor.focus({ preventScroll: true });
    if (!stillEditingSyllable()) active = null;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const shift = shifted || event.shiftKey;
    if (shifted) { shifted = false; updateLayout(); }

    // Enter breaks the line; again on the empty last line, app.js ends the writing.
    if (code === 'Enter' && !shift && start === end && !editor.value.slice(end).trim()
        && /\n[^\S\n]*$/.test(editor.value.slice(0, start))) {
      active = null;
      document.dispatchEvent(new CustomEvent('gulgam:finish'));
      if (retainButtonFocus && document.body.dataset.view === 'write') button.focus({ preventScroll: true });
      return;
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const left = code === 'ArrowLeft';
      const next = start !== end ? (left ? start : end) : boundary(start, left ? -1 : 1);
      active = null;
      editor.setSelectionRange(next, next);
      flash(code);
    } else {
      const kind = ({ Enter: 'return', Backspace: 'delete', Space: 'space' })[code] || 'key';
      document.dispatchEvent(new CustomEvent('gulgam:key-sound', { detail: { kind, code } }));
      if (code === 'Backspace') {
        if (active) replaceSyllable(active.parts.slice(0, -1), active.start, end);
        else edit(start === end ? boundary(start, -1) : start, end, '');
      } else if (/^Key[A-Z]$/.test(code) && !english) {
        const letter = code.at(-1);
        const jamo = (shift && shiftedKorean[letter]) || korean[alphabet.indexOf(letter)];
        replaceSyllable([...(active?.parts || []), jamo], active?.start ?? start, end);
      } else {
        active = null;
        const specials = { Space: ' ', Enter: '\n', Comma: shift ? '<' : ',', Period: shift ? '>' : '.' };
        const letter = code.at(-1);
        const text = specials[code] ?? (/^Key[A-Z]$/.test(code) ? shift ? letter : letter.toLowerCase() : '');
        if (text) edit(start, end, text);
      }
    }
    if (retainButtonFocus) button.focus({ preventScroll: true });
  });
  updateLayout();

  const playback = document.getElementById('receipt-playback');
  const skip = document.getElementById('skip-print');
  const glyphDelay = 120;
  const skipThreshold = Math.ceil(2500 / glyphDelay);
  let feed = null;

  function finishReceipt() {
    if (!feed) return;
    clearTimeout(feed.timer);
    if (feed.node.length !== feed.text.length) feed.node.data = feed.text;
    feed = null;
    const wasFocused = document.activeElement === skip;
    skip.hidden = true;
    if (wasFocused) document.getElementById('receipt-focus').focus({ preventScroll: true });
  }

  document.addEventListener('gulgam:receipt', event => {
    active = null;
    finishReceipt();
    const { text, animate, playSound } = event.detail;
    if (!animate || motion.matches || document.hidden || !segmenter || !text) {
      playback.textContent = text;
      return;
    }
    const segments = segmenter.segment(text);
    // Inspect only the opening characters when deciding to offer a shortcut.
    // The rest of a long draft can be segmented lazily as it prints.
    let count = 0;
    for (const _ of segments) {
      if (++count > skipThreshold) break;
    }
    skip.hidden = count <= skipThreshold;
    const node = document.createTextNode('');
    playback.replaceChildren(node);
    const cursor = segments[Symbol.iterator]();
    const run = { text, node, timer: 0 };
    feed = run;

    function printNext() {
      if (feed !== run) return;
      if (document.hidden || motion.matches || document.body.dataset.view !== 'receipt') {
        finishReceipt();
        return;
      }
      const glyph = cursor.next().value.segment;
      node.appendData(glyph);
      if (/[\r\n]/.test(glyph)) playSound('return');
      else if (/^\s+$/u.test(glyph)) playSound('space');
      else playSound('key');
      if (node.length === text.length) finishReceipt();
      else run.timer = setTimeout(printNext, glyphDelay);
    }
    printNext();
  });

  skip.addEventListener('click', finishReceipt);
  document.getElementById('back').addEventListener('click', finishReceipt);
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishReceipt(); });
  window.addEventListener('pagehide', finishReceipt);
  motion.addEventListener('change', () => { if (motion.matches) finishReceipt(); });
})();
