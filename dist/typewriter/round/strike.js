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
  const doubleInitials = { 'ㄱㄱ':'ㄲ', 'ㄷㄷ':'ㄸ', 'ㅂㅂ':'ㅃ', 'ㅅㅅ':'ㅆ', 'ㅈㅈ':'ㅉ' };
  const doubleVowels = { 'ㅗㅏ':'ㅘ', 'ㅗㅐ':'ㅙ', 'ㅗㅣ':'ㅚ', 'ㅜㅓ':'ㅝ', 'ㅜㅔ':'ㅞ', 'ㅜㅣ':'ㅟ', 'ㅡㅣ':'ㅢ' };
  const doubleFinals = { 'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ', 'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ',
    'ㄹㅂ':'ㄼ', 'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ', 'ㅂㅅ':'ㅄ' };
  const threeSetFinals = { ...doubleFinals, 'ㄱㄱ':'ㄲ', 'ㅅㅅ':'ㅆ' };
  const isVowel = letter => letter !== undefined && vowels.includes(letter);
  const select = document.querySelector('[data-key-layout]');
  const sheet = document.querySelector('[data-paper-sheet]');
  const layoutPreference = 'gulgam.typewriter.layout.v1';
  let threeSet = true;
  try { threeSet = localStorage.getItem(layoutPreference) !== '2'; } catch {}
  if (select) select.value = threeSet ? '390' : '2';
  let english = false;
  // Follow the device IME until the writer explicitly chooses a typewriter layout.
  let mapPhysicalKeys = false;
  let shifted = false;
  let active = null;
  let nativeComposition = false;
  let editing = false;

  function setActive(syllable) {
    const changed = active?.start !== syllable?.start;
    active = syllable;
    if (!changed) return;
    if (syllable) editor.dataset.virtualSyllableStart = String(syllable.start);
    else delete editor.dataset.virtualSyllableStart;
    document.dispatchEvent(new Event('gulgam:compose-position'));
  }

  // Keyboard positions from the Hangul Cultural Institute's digital 3-90 layout.
  // Conjoining jamo distinguish the initial ㄱ (ᄀ) and the final ㄱ (ᆨ).
  // Reference: github.com/libhangul/libhangul/blob/main/data/keyboards/hangul-keyboard-39.xml.template
  const keyRows = [
    ['1234567890', '!@#$%^&*()', 'ᇂᆻᆸᅭᅲᅣᅨᅴᅮᄏ', 'ᆽ@#$%^&*()'],
    ['qwertyuiop', 'QWERTYUIOP', 'ᆺᆯᅧᅢᅥᄅᄃᄆᄎᄑ', 'ᇁᇀᆿᅤ;<789>'],
    ["asdfghjkl;'", 'ASDFGHJKL:"', 'ᆼᆫᅵᅡᅳᄂᄋᄀᄌᄇᄐ', "ᆮᆭᆰᆩ/'456:\""],
    ['zxcvbnm,./', 'ZXCVBNM<>?', 'ᆷᆨᅦᅩᅮᄉᄒ,.ᅩ', 'ᆾᆹᆱᆶ!0123?']
  ];
  const punctuation = { ';':'Semicolon', "'":'Quote', ',':'Comma', '.':'Period', '/':'Slash' };
  const keyMap = new Map();
  for (const [lower, upper, hangul, upperHangul] of keyRows) {
    for (let i = 0; i < lower.length; i++) {
      const ch = lower[i];
      const code = punctuation[ch] || (/\d/.test(ch) ? 'Digit' + ch : 'Key' + upper[i]);
      keyMap.set(code, { lower: ch, upper: upper[i], hangul: hangul[i], upperHangul: upperHangul[i] });
    }
  }

  function strokeFor(code, shift, useEnglish) {
    const key = keyMap.get(code);
    if (!key) return null;
    const latin = shift ? key.upper : key.lower;
    if (useEnglish) return { name: latin, role: 'symbol' };
    if (!threeSet) {
      const letter = key.upper;
      const jamo = korean[alphabet.indexOf(letter)];
      return jamo ? { name: (shift && shiftedKorean[letter]) || jamo, role: 'jamo' }
        : { name: latin, role: 'symbol' };
    }
    const jamo = shift ? key.upperHangul : key.hangul;
    const n = jamo.charCodeAt(0);
    if (n >= 0x1100 && n <= 0x1112) return { name: initials[n - 0x1100], role: 'initial' };
    if (n >= 0x1161 && n <= 0x1175) return { name: vowels[n - 0x1161], role: 'medial' };
    if (n >= 0x11a8 && n <= 0x11c2) return { name: finals[n - 0x11a7], role: 'final' };
    return { name: jamo, role: 'symbol' };
  }

  // Each stroke has its own job. A 받침 stays in its syllable even when the
  // next stroke is a vowel. Only an initial key can start a new initial.
  function composeThreeSet(parts) {
    const syllables = [];
    let i = 0;
    while (i < parts.length) {
      const start = i;
      function take(role, combinations) {
        if (parts[i]?.role !== role) return '';
        const first = parts[i++].name;
        const compound = parts[i]?.role === role && combinations[first + parts[i].name];
        if (compound) i++;
        return compound || first;
      }
      const initial = take('initial', doubleInitials);
      const medial = take('medial', doubleVowels);
      // A consonant without a vowel is printed separately from a final key.
      const final = initial && !medial ? '' : take('final', threeSetFinals);
      let text = initial || medial || final;
      if (initial && medial) {
        text = String.fromCharCode(0xac00 + (initials.indexOf(initial) * 21 + vowels.indexOf(medial)) * 28
          + finals.indexOf(final || ' '));
      } else if (medial && final) {
        text = '\u115f' + String.fromCharCode(0x1161 + vowels.indexOf(medial), 0x11a7 + finals.indexOf(final));
      }
      syllables.push({ text, parts: parts.slice(start, i) });
    }
    return syllables;
  }

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
    keyboard.dataset.koreanLayout = threeSet ? '390' : '2';
    keyboard.dataset.shift = shifted ? 'on' : 'off';
    const legend = document.querySelector('[data-role-legend]');
    if (legend) legend.hidden = english || !threeSet;
    const roleNames = { initial: '초성', medial: '중성', final: '종성' };
    for (const [code, button] of buttons) {
      if (code.startsWith('Shift')) button.setAttribute('aria-pressed', String(shifted));
      if (code === 'Lang1') {
        button.setAttribute('aria-pressed', String(english));
        button.setAttribute('aria-label', english ? '현재 영문 자판, 한글로 전환' : '현재 한글 자판, 영문으로 전환');
      }
      const stroke = strokeFor(code, shifted, english);
      if (!stroke) continue;
      button.dataset.keyRole = stroke.role;
      button.querySelector('[data-key-primary]').textContent = stroke.name;
      const secondary = button.querySelector('[data-key-secondary]');
      if (secondary) {
        const alternate = english ? strokeFor(code, shifted, false).name : keyMap.get(code).lower.toUpperCase();
        secondary.textContent = alternate === stroke.name ? '' : alternate;
      }
      const accessible = roleNames[stroke.role] ? roleNames[stroke.role] + ' ' + stroke.name : stroke.name;
      button.setAttribute('aria-label', accessible);
      button.title = accessible;
    }
  }

  function chooseLanguage(useEnglish) {
    // Blurring a native preedit commits it before we start mapping physical keys.
    if (nativeComposition) editor.blur();
    english = useEnglish;
    mapPhysicalKeys = true;
    shifted = false;
    setActive(null);
    updateLayout();
  }

  select?.addEventListener('change', () => {
    threeSet = select.value === '390';
    chooseLanguage(false);
    try { localStorage.setItem(layoutPreference, select.value); } catch {}
  });

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
  // A Korean keyboard can report HangulMode on AltRight, Lang1, or legacy VK_HANGUL.
  // A plain right Alt also serves as AltGr on other keyboard layouts.
  let languageKeyDown = false;
  function hardwareLanguage(event) {
    const legacyHangul = event.keyCode === 21 && (!event.key || ['Unidentified', 'Process', 'Alt'].includes(event.key));
    if (event.key !== 'HangulMode' && event.code !== 'Lang1' && !legacyHangul) return;
    // Japanese keyboards also use Lang1 for their kana key.
    if (/Kana|Hiragana|Katakana/.test(event.key)) return;
    if (document.body.dataset.view !== 'write' || (event.target !== editor &&
        event.target !== document.body && !keyboard.contains(event.target))) return;
    const toggle = event.type === 'keydown' ? !event.repeat : !languageKeyDown;
    languageKeyDown = event.type === 'keydown';
    if (toggle) pressKey(buttons.get('Lang1'), false, false, false);
  }
  document.addEventListener('keydown', hardwareLanguage, true);
  document.addEventListener('keyup', hardwareLanguage, true);
  window.addEventListener('blur', () => { languageKeyDown = false; });

  editor.addEventListener('keydown', event => {
    if (event.key === 'Shift') { flash(event.code); return; }
    if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.altKey ||
        event.getModifierState('AltGraph') || event.isComposing || nativeComposition || event.key === 'Dead') {
      setActive(null);
      return;
    }
    const button = buttons.get(event.code);
    if (mapPhysicalKeys && button && (keyMap.has(event.code) || (active && event.code === 'Backspace'))) {
      event.preventDefault();
      const caps = english && /^Key[A-Z]$/.test(event.code) && event.getModifierState('CapsLock');
      pressKey(button, false, false, caps ? !event.shiftKey : event.shiftKey);
      return;
    }
    setActive(null);
    if (event.key.startsWith('Arrow')) flash(event.code);
  }, true);

  function followNativeText(text) {
    // Physical input already consumed by an IME and soft keyboards may have no usable key code.
    let useEnglish;
    if (/[\u1100-\u11ff\u3131-\u318e\ua960-\ua97f\uac00-\ud7ff]/u.test(text)) useEnglish = false;
    else if (/^[A-Za-z]$/.test(text)) useEnglish = true;
    else return;
    mapPhysicalKeys = false;
    if (english === useEnglish) return;
    english = useEnglish;
    shifted = false;
    updateLayout();
  }
  editor.addEventListener('compositionstart', () => { nativeComposition = true; setActive(null); });
  editor.addEventListener('compositionupdate', event => followNativeText(event.data));
  editor.addEventListener('compositionend', event => {
    nativeComposition = false;
    followNativeText(event.data);
  });
  editor.addEventListener('input', event => {
    if (editing) return;
    setActive(null);
    if (event.inputType === 'insertCompositionText' || event.inputType === 'insertText' && event.data?.length === 1) {
      followNativeText(event.data);
    }
  });
  editor.addEventListener('pointerdown', () => { editor.removeAttribute('inputmode'); setActive(null); });
  window.addEventListener('storage', event => { if (event.key === 'gulgam.draft.v1') setActive(null); });

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
    editing = true;
    try {
      // Native editing commands keep virtual keystrokes in the textarea's undo history.
      if (document.execCommand?.(text ? 'insertText' : 'delete', false, text)) return;
      editor.setRangeText(text, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      editing = false;
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
    const syllables = threeSet ? composeThreeSet(parts) : compose(parts);
    const text = syllables.map(syllable => syllable.text).join('');
    edit(start, end, text);
    const last = syllables.at(-1);
    setActive(last ? { ...last, start: start + text.length - last.text.length } : null);
  }

  let strikeTimer = 0;
  function pressKey(button, touch, retainButtonFocus, shiftKey) {
    if (document.body.dataset.view !== 'write') return;
    const code = button.dataset.code;
    if (code.startsWith('Shift') || code === 'Lang1') {
      if (code === 'Lang1') chooseLanguage(!english);
      else { shifted = !shifted; updateLayout(); }
      flash(code);
      if (!retainButtonFocus || code === 'Lang1') {
        if (touch) editor.setAttribute('inputmode', 'none');
        editor.focus({ preventScroll: true });
      }
      return;
    }
    if (nativeComposition) editor.blur();
    if (touch) editor.setAttribute('inputmode', 'none');
    editor.focus({ preventScroll: true });
    if (!stillEditingSyllable()) setActive(null);
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const shift = shifted || shiftKey;
    if (shifted) { shifted = false; updateLayout(); }

    // Enter breaks the line. Again on the empty last line it ends the writing once
    // it can be pulled (app.js decides); before that it is a blank line and a nudge.
    if (code === 'Enter' && !shift && start === end && !editor.value.slice(end).trim()
        && /\n[^\S\n]*$/.test(editor.value.slice(0, start))) {
      if (!document.getElementById('pull').disabled) {
        setActive(null);
        document.dispatchEvent(new CustomEvent('gulgam:finish'));
        if (retainButtonFocus && document.body.dataset.view === 'write') button.focus({ preventScroll: true });
        return;
      }
      document.dispatchEvent(new CustomEvent('gulgam:nudge'));
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const left = code === 'ArrowLeft';
      const next = start !== end ? (left ? start : end) : boundary(start, left ? -1 : 1);
      setActive(null);
      editor.setSelectionRange(next, next);
      flash(code);
    } else {
      const stroke = strokeFor(code, shift, english);
      if (sheet && stroke && ['initial', 'medial', 'final'].includes(stroke.role)) {
        clearTimeout(strikeTimer);
        sheet.dataset.strikeRole = stroke.role;
        strikeTimer = setTimeout(() => { delete sheet.dataset.strikeRole; }, 120);
      }
      const kind = ({ Enter: 'return', Backspace: 'delete', Space: 'space' })[code] || 'key';
      document.dispatchEvent(new CustomEvent('gulgam:key-sound', { detail: { kind, code, role: stroke?.role } }));
      if (code === 'Backspace') {
        if (active) replaceSyllable(active.parts.slice(0, -1), active.start, end);
        else edit(start === end ? boundary(start, -1) : start, end, '');
      } else if (stroke && stroke.role !== 'symbol') {
        const part = threeSet ? stroke : stroke.name;
        replaceSyllable([...(active?.parts || []), part], active?.start ?? start, end);
      } else {
        setActive(null);
        const specials = { Space: ' ', Enter: '\n' };
        const text = specials[code] ?? stroke?.name;
        if (text) edit(start, end, text);
      }
    }
    if (retainButtonFocus) button.focus({ preventScroll: true });
  }

  // Mobile browsers may suppress the next compatibility click after a drag.
  // Commit a deliberate in-key tap at release and cancel its synthetic click.
  let tap = null;
  keyboard.addEventListener('touchstart', event => {
    const button = event.target.closest('button[data-code]');
    const point = event.changedTouches[0];
    tap = button && event.touches.length === 1
      ? { button, id: point.identifier, x: point.clientX, y: point.clientY } : null;
  }, { passive: true });
  keyboard.addEventListener('touchmove', event => {
    const point = event.touches[0];
    if (tap && Math.hypot(point.clientX - tap.x, point.clientY - tap.y) > 10) tap = null;
  }, { passive: true });
  keyboard.addEventListener('touchcancel', () => { tap = null; });
  keyboard.addEventListener('touchend', event => {
    const start = tap;
    tap = null;
    const point = event.changedTouches[0];
    if (!start || !event.cancelable || start.id !== point.identifier ||
        Math.hypot(point.clientX - start.x, point.clientY - start.y) > 10 ||
        !start.button.contains(document.elementFromPoint(point.clientX, point.clientY))) return;
    event.preventDefault();
    pressKey(start.button, true, false, event.shiftKey);
  }, { passive: false });
  keyboard.addEventListener('click', event => {
    const button = event.target.closest('button[data-code]');
    if (!button) return;
    pressKey(button, event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents,
      document.activeElement === button && event.detail === 0, event.shiftKey);
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
    setActive(null);
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
