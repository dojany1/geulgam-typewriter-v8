(() => {
  'use strict';

  const element = id => document.getElementById(id);
  const all = selector => Array.from(document.querySelectorAll(selector));
  const editor = element('editor');
  const consoleReceipt = element('receipt-playback') !== null;
  const roundKeys = document.body.dataset.keyShape === 'round';
  const soundButtons = all('#sound, [data-sound-toggle]');
  const soundLabels = all('[data-sound-label]');
  const draftActions = all('[data-action="copy"], [data-action="download"], [data-action="pull"]');
  const lineCounters = all('[data-line-count]');
  const draftStates = all('[data-draft-state]');
  const draftKey = 'gulgam.draft.v1';
  const typewriter = document.body.dataset.edition === 'typewriter' || /(^|\/)typewriter\//.test(location.pathname);
  const soundKey = typewriter ? 'gulgam.sound.v1' : 'gulgam.original.sound.v1';
  const themeKey = 'gulgam.theme.v1';
  const recentNouns = [];
  const recentAdjectives = [];
  const carriage = document.querySelector('[data-carriage]');
  let toastTimer;
  let composing = false;

  function readStored(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function readDraftFrom(storageName) {
    try {
      const saved = JSON.parse(window[storageName].getItem(draftKey));
      if (saved && typeof saved.text === 'string') return saved;
    } catch {
      // An incomplete draft must not prevent opening the editor.
    }
    return null;
  }

  const modifiedTime = record => Date.parse(record?.updatedAt || '') || 0;

  function discardTabRecovery() {
    try { sessionStorage.removeItem(draftKey); } catch { /* Browser storage remains authoritative. */ }
  }

  function readDraft() {
    const browser = readDraftFrom('localStorage');
    const tab = readDraftFrom('sessionStorage');
    if (!tab) return { record: browser, storage: 'browser' };
    if (browser && modifiedTime(browser) >= modifiedTime(tab)) {
      discardTabRecovery();
      return { record: browser, storage: 'browser' };
    }
    // The tab copy may be the only record of edits made while the browser
    // quota was full. Promote it without changing its original edit time.
    try {
      localStorage.setItem(draftKey, JSON.stringify(tab));
      discardTabRecovery();
      return { record: tab, storage: 'browser' };
    } catch {
      return { record: tab, storage: 'session' };
    }
  }

  function remember(recent, word) {
    recent.push(word);
    if (recent.length > 5) recent.shift();
    return word;
  }

  function pick(list, recent) {
    const available = list.filter(word => !recent.includes(word));
    const word = available[Math.floor(Math.random() * available.length)];
    return remember(recent, word);
  }

  function displayDate(date = new Date()) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '. ' + month + '. ' + day + '.';
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    const toast = element('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
      toast.textContent = '';
    }, 3200);
  }

  const initial = readDraft();
  const draft = initial.record || {};
  let lastEditTime = modifiedTime(draft);
  let recoverableText = draft.text || '';
  let noun = gulgamWords.nouns.includes(draft.nounId)
    ? remember(recentNouns, draft.nounId) : pick(gulgamWords.nouns, recentNouns);
  let adjective = gulgamWords.adjectives.includes(draft.adjectiveId)
    ? remember(recentAdjectives, draft.adjectiveId) : pick(gulgamWords.adjectives, recentAdjectives);
  editor.value = draft.text || '';
  let writing = readWritingTime(draft);

  function readWritingTime(record) {
    const saved = record.writingTime;
    if (saved && Number.isFinite(saved.elapsedMs) && saved.elapsedMs >= 0
        && (saved.since === null || Number.isFinite(saved.since) && saved.since > 0)) {
      return { elapsedMs: saved.elapsedMs, since: saved.since, resumed: saved.resumed === true };
    }
    // Older drafts only recorded their last edit, not when writing began.
    const resuming = Boolean(record.text?.trim());
    return { elapsedMs: 0, since: resuming ? Date.now() : null, resumed: resuming };
  }

  function elapsedMs() {
    return writing.elapsedMs + (writing.since === null ? 0 : Math.max(0, Date.now() - writing.since));
  }

  function updateWritingTime() {
    if (!editor.value.trim()) writing = { elapsedMs: 0, since: null, resumed: false };
    else if (writing.since === null) writing.since = Date.now();
  }

  function displayWritingTime() {
    const seconds = Math.floor(elapsedMs() / 1000);
    const minutes = Math.floor(seconds / 60);
    const duration = minutes ? minutes + '분 ' + String(seconds % 60).padStart(2, '0') + '초' : seconds + '초';
    return writing.resumed ? duration + ' (이어서 쓴 시간)' : duration;
  }

  function wordPair() {
    return noun + ' · ' + adjective;
  }

  const saveMessages = {
    browser: ['이 브라우저에 임시 저장됨', '저장됨'],
    session: ['이 탭에만 임시 저장됨 · 탭을 닫기 전에 TXT로 저장해 주세요', '탭에 저장'],
    memory: ['임시 저장 실패 · 글을 복사하거나 TXT로 저장해 주세요', '저장 실패']
  };

  function showSaveStatus(storage) {
    document.body.dataset.draftStorage = storage;
    const [message, compactMessage] = saveMessages[storage];
    const status = element('save-status');
    if (status.textContent !== message) status.textContent = message;
    for (const compact of draftStates) compact.textContent = compactMessage;
  }

  function saveDraft() {
    lastEditTime = Math.max(Date.now(), lastEditTime + 1);
    const serialized = JSON.stringify({
      version: 1, nounId: noun, adjectiveId: adjective,
      text: editor.value, writingTime: writing, updatedAt: new Date(lastEditTime).toISOString()
    });
    try {
      localStorage.setItem(draftKey, serialized);
      discardTabRecovery();
      showSaveStatus('browser');
    } catch {
      try {
        sessionStorage.setItem(draftKey, serialized);
        showSaveStatus('session');
      } catch {
        showSaveStatus('memory');
        return;
      }
    }
    recoverableText = editor.value;
  }

  // Edition links navigate to a different document. When both stores reject
  // the new text, leave the writer a chance to export it before leaving.
  document.addEventListener('click', event => {
    if (document.body.dataset.draftStorage !== 'memory' || !editor.value.trim()
        || editor.value === recoverableText || event.defaultPrevented || event.button !== 0
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const destination = new URL(link.href);
    if (destination.origin !== location.origin || destination.hash) return;
    if (!window.confirm('브라우저에 저장하지 못한 글이 있습니다. 이 화면을 떠날까요? 취소하면 글을 복사하거나 TXT로 저장할 수 있어요.')) {
      event.preventDefault();
    }
  });

  function renderEditor() {
    element('word-count').textContent = Array.from(editor.value).length.toLocaleString('ko-KR') + '자';
    const empty = !editor.value.trim();
    element('pull').disabled = empty;
    for (const button of draftActions) button.disabled = empty;
    for (const label of lineCounters) label.textContent = editor.value ? String(editor.value.split('\n').length) : '0';
    const words = element('words');
    if (words.textContent !== wordPair()) words.textContent = wordPair();
    updateCarriage();
  }

  function updateCarriage() {
    if (!carriage) return;
    const end = editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd;
    const from = editor.value.lastIndexOf('\n', end - 1) + 1;
    const column = Array.from(editor.value.slice(from, end)).length;
    carriage.style.setProperty('--position', Math.min(100, column / 42 * 100) + '%');
  }
  if (carriage) {
    document.addEventListener('selectionchange', updateCarriage);
    editor.addEventListener('keyup', updateCarriage);
    editor.addEventListener('click', updateCarriage);
  }

  function restoreCurrentDraft() {
    // A cached page can miss storage events. Read the same record as a fresh
    // visit without saving over the latest edit or interrupting composition.
    if (composing || document.body.dataset.draftStorage === 'memory') return;
    const { record: latest, storage } = readDraft();
    if (!latest) return;
    if (modifiedTime(latest) === lastEditTime && editor.value === latest.text
        && noun === latest.nounId && adjective === latest.adjectiveId) {
      showSaveStatus(storage);
      return;
    }
    lastEditTime = Math.max(lastEditTime, modifiedTime(latest));
    writing = readWritingTime(latest);
    recoverableText = latest.text;
    if (gulgamWords.nouns.includes(latest.nounId) && noun !== latest.nounId) noun = remember(recentNouns, latest.nounId);
    if (gulgamWords.adjectives.includes(latest.adjectiveId) && adjective !== latest.adjectiveId) adjective = remember(recentAdjectives, latest.adjectiveId);
    if (editor.value !== latest.text) editor.value = latest.text;
    renderEditor();
    showSaveStatus(storage);
    if (document.body.dataset.view === 'receipt') {
      if (editor.value.trim()) renderReceipt();
      else setView('write');
    }
  }

  // Synthesize a short metal strike and a quieter mechanical return. No audio
  // asset fetch can delay the first keystroke, and nothing plays on page load.
  const preferredSound = () => {
    const value = readStored(soundKey);
    return value === null ? typewriter : value === 'on';
  };
  let soundOn = preferredSound();
  let audio;
  let master;
  let noise;

  function startAudio() {
    if (!soundOn) return false;
    try {
      if (!audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return false;
        audio = new Audio();
        master = audio.createGain();
        master.gain.value = 0.26;
        master.connect(audio.destination);
        noise = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.8), audio.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function burst(at, length, frequency, strength) {
    const source = audio.createBufferSource();
    source.buffer = noise;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.72;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(strength, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(master);
    source.start(at, Math.random() * 0.15, length);
  }

  function knock(at, frequency, length, strength) {
    const oscillator = audio.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.65, at + length);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(strength, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + length);
  }

  // Short, fixed-frequency resonances supply the ring of struck metal.
  function ring(at, frequency, decay, level) {
    const tone = audio.createOscillator();
    const envelope = audio.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(level, at + .0015);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + decay);
    tone.connect(envelope).connect(master);
    tone.start(at);
    tone.stop(at + decay);
  }

  function squareKeySound(kind, at) {
    if (kind === 'ratchet') {
      burst(at, .013, 1950, .58);
      knock(at + .004, 278, .024, .22);
      return;
    }
    if (kind === 'return') {
      // The bell rings before the ratchet runs back and hits its left stop.
      ring(at, 1625, .45, .36);
      ring(at, 2461, .24, .13);
      ring(at, 4328, .095, .08);
      const teeth = [.028, .056, .080, .100, .117, .132, .146, .159];
      for (const [index, offset] of teeth.entries()) {
        burst(at + offset, .015, 2350 - index * 95, .49);
      }
      knock(at + .184, 154, .072, .51);
      burst(at + .185, .032, 1260, .80);
      ring(at + .187, 718, .060, .12);
      return;
    }
    if (kind === 'space' || kind === 'delete') {
      const space = kind === 'space';
      knock(at, space ? 102 : 195, .048, space ? .42 : .29);
      burst(at + .004, .019, space ? 1130 : 2450, .63);
      burst(at + .034, .012, space ? 2060 : 1430, .38);
      return;
    }
    // Finger/key, slug/platen impact and escapement pawl are separate contacts.
    const pitch = .96 + Math.random() * .08;
    knock(at, 180 * pitch, .026, .33);
    burst(at + .005, .018, 2900 * pitch, 1.08);
    ring(at + .006, 934 * pitch, .043, .24);
    ring(at + .006, 2361 * pitch, .029, .12);
    burst(at + .039, .019, 1670 * pitch, .55);
    knock(at + .040, 235 * pitch, .030, .20);
  }

  // Each typebar has a slightly different impact and escapement.
  const typebars = [
    { body: 321, bite: 6450, ping: 1870, release: .058 },
    { body: 357, bite: 7310, ping: 2190, release: .077 },
    { body: 286, bite: 5680, ping: 1590, release: .065 }
  ];
  let lastBar = 0;
  let nextDetent = 0;
  const carriageTravel = .380;
  const receiptTravel = .032;

  function ratchetTooth(at, level) {
    burst(at, .015, 3400, .58 * level);
    knock(at + .002, 388, .027, .21 * level);
  }

  function carriageSlide(at, duration) {
    const source = audio.createBufferSource();
    source.buffer = noise;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(970, at);
    filter.frequency.exponentialRampToValueAtTime(2830, at + duration * .8);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(.14, at + duration * .18);
    gain.gain.exponentialRampToValueAtTime(.28, at + duration * .88);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(at, Math.random() * .19, duration);
  }

  function carriageStop(at) {
    knock(at, 155, .088, .85);
    burst(at + .002, .043, 3190, 1.30);
    ring(at + .004, 1570, .078, .20);
    knock(at + .022, 338, .046, .38);
    burst(at + .029, .024, 4630, .48);
  }

  function roundKeySound(kind, at, role) {
    if (kind === 'return') {
      let stopAt = at + carriageTravel;
      if (role === 'lever-release') {
        // Drag detents have already sounded with the user's hand.
        stopAt = Math.max(at, nextDetent);
      } else if (role === 'receipt') {
        ratchetTooth(at, .7);
        stopAt = at + receiptTravel;
      } else {
        knock(at, 405, .037, .28);
        burst(at + .003, .018, 5810, .62);
        carriageSlide(at + .023, .354);
        for (const offset of [.058, .116, .170, .220, .267, .312, .354]) {
          ratchetTooth(at + offset, .63);
        }
      }
      carriageStop(stopAt);
      return stopAt;
    }
    if (kind === 'space' || kind === 'delete') {
      const space = kind === 'space';
      knock(at, space ? 183 : 291, .054, space ? .53 : .32);
      burst(at + .004, .025, space ? 2650 : 4480, .88);
      burst(at + (space ? .062 : .036), .018, space ? 3980 : 2400, .37);
      return;
    }
    lastBar = (lastBar + 1 + Math.floor(Math.random() * (typebars.length - 1))) % typebars.length;
    const bar = typebars[lastBar];
    const register = role === 'final' ? .94 : role === 'medial' ? 1.04 : 1;
    const pitch = register * (.977 + .046 * Math.random());
    knock(at, bar.body * pitch, .031, .33);
    burst(at + .003, .023, bar.bite * pitch, 1.56);
    ring(at + .004, bar.ping * pitch, .038, .17);
    burst(at + .008, .020, 3050 * pitch, .49);
    const release = at + bar.release;
    burst(release, .021, 2740 * pitch, role === 'medial' || role === 'final' ? .25 : .43);
    knock(release + .001, 227 * pitch, .029, .16);
  }

  function playSound(kind, role) {
    if (!startAudio()) {
      if (!roundKeys || kind !== 'return') return;
      if (role === 'lever-release') return 0;
      return (role === 'receipt' ? receiptTravel : carriageTravel) * 1000;
    }
    const at = audio.currentTime + 0.004;
    if (consoleReceipt) {
      if (!roundKeys) return squareKeySound(kind, at);
      const stopAt = roundKeySound(kind, at, role);
      if (stopAt === undefined) return;
      // Map the audible stop to the frame clock, including the output device's latency.
      const output = audio.getOutputTimestamp?.();
      if (output?.performanceTime > 0 && output.contextTime > 0) {
        return Math.max(0, output.performanceTime + (stopAt - output.contextTime) * 1000 - performance.now());
      }
      return Math.max(0, (stopAt - audio.currentTime) * 1000);
    }
    if (!typewriter) {
      if (kind !== 'print') knock(at, kind === 'space' ? 160 : 260, 0.024, 0.2);
      return;
    }
    if (kind === 'print') {
      burst(at, 0.44, 920, 0.26);
      for (let i = 0; i < 9; i++) knock(at + i * 0.036, 150, 0.028, 0.075);
      burst(at + 0.4, 0.07, 2400, 0.22);
      return;
    }
    if (kind === 'return') {
      burst(at, 0.15, 1600, 0.44);
      knock(at + 0.068, 260, 0.045, 0.25);
      burst(at + 0.078, 0.042, 3000, 0.36);
      return;
    }
    const frequency = kind === 'space' ? 880 : kind === 'delete' ? 2100 : 3100 + Math.random() * 800;
    burst(at, 0.035, frequency, 0.84);
    knock(at, kind === 'space' ? 140 : 210, 0.037, 0.29);
    burst(at + 0.03, 0.026, 1800, 0.23);
  }

  function renderSoundState() {
    for (const button of soundButtons) {
      button.setAttribute('aria-pressed', String(soundOn));
    }
    for (const label of soundLabels) label.textContent = soundOn ? '소리 켜짐' : '소리 꺼짐';
    if (master) master.gain.value = soundOn ? 0.26 : 0;
  }

  for (const button of soundButtons) {
    button.addEventListener('click', () => {
      soundOn = !soundOn;
      renderSoundState();
      try { localStorage.setItem(soundKey, soundOn ? 'on' : 'off'); } catch { /* Keep the session choice. */ }
      if (soundOn) playSound('key');
    });
  }

  const keys = all('[data-reactive-keys] > *');
  const keyTimers = new WeakMap();
  const defaultKeyCodes = { space: 'Space', return: 'Enter', delete: 'Backspace' };
  let fallbackIndex = 0;
  function strike(kind, code, role) {
    if (keys.length) {
      const cap = keys.find(key => key.dataset.code === (code || defaultKeyCodes[kind])) || keys[fallbackIndex++ % keys.length];
      cap.classList.add('is-struck');
      clearTimeout(keyTimers.get(cap));
      keyTimers.set(cap, setTimeout(() => cap.classList.remove('is-struck'), 120));
    }
    const impactInMs = playSound(kind, role);
    if (consoleReceipt) {
      document.dispatchEvent(new CustomEvent('gulgam:strike', { detail: { kind, code, role, impactInMs } }));
    }
  }

  let lastPhysicalStrike = -Infinity;
  let previousComposition = '';
  let recentCommit = null;
  let shiftReturn = false;
  let commitReturn = false;
  if (consoleReceipt) {
    if (roundKeys) {
      const lever = document.querySelector('[data-return-handle]');
      lever?.addEventListener('pointerdown', startAudio, { capture: true });
      lever?.addEventListener('pointerup', startAudio, { capture: true });
      document.addEventListener('gulgam:ratchet', event => {
        if (!startAudio()) return;
        const steps = Math.min(3, Math.max(1, Math.trunc(event.detail?.steps) || 1));
        const at = Math.max(audio.currentTime + .004, nextDetent);
        carriageSlide(at, .034 + (steps - 1) * .015);
        for (let i = 0; i < steps; i++) ratchetTooth(at + i * .015, 1);
        nextDetent = at + steps * .015;
      });
    } else {
      document.addEventListener('gulgam:ratchet', () => playSound('ratchet'));
    }
    document.addEventListener('gulgam:key-sound', event => {
      const { kind, code, role } = event.detail;
      strike(kind, code, role);
    });
  }
  function recentIMECommit() {
    return recentCommit && performance.now() - recentCommit.at < 45;
  }
  editor.addEventListener('pointerdown', startAudio);
  editor.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    if (consoleReceipt && event.key === 'Enter') {
      // An IME may send compositionend just before the Enter that commits it.
      commitReturn = composing || event.isComposing || event.keyCode === 229 || recentIMECommit();
      shiftReturn = event.shiftKey;
      if (commitReturn) return;
      if (!shiftReturn) {
        event.preventDefault();
        if (!event.repeat && !element('pull').disabled) element('pull').click();
        return;
      }
    }
    const composingKey = (event.isComposing || event.key === 'Process')
      && /^(Key[A-Z]|Digit[0-9])$/.test(event.code);
    let kind;
    if (event.key === 'Enter') kind = 'return';
    else if (event.key === ' ') kind = 'space';
    else if (event.key === 'Backspace' || event.key === 'Delete') kind = 'delete';
    else if (event.key.length === 1 || composingKey) kind = 'key';
    if (!kind) return;
    lastPhysicalStrike = performance.now();
    strike(kind, event.code);
  });

  editor.addEventListener('compositionstart', () => {
    composing = true;
    previousComposition = '';
    recentCommit = null;
  });
  editor.addEventListener('compositionend', event => {
    composing = false;
    recentCommit = { text: event.data, at: performance.now() };
    previousComposition = '';
  });
  editor.addEventListener('beforeinput', event => {
    // The screen keyboard already sounded this stroke and handles its own return key.
    if (consoleReceipt && editor.hasAttribute('data-virtual-edit')) return;
    if (consoleReceipt && (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak')) {
      // Soft keyboards sometimes emit a line break without a keydown.
      if (composing || event.isComposing) return;
      if (commitReturn || recentIMECommit()) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (!shiftReturn && event.cancelable) {
        event.preventDefault();
        if (!element('pull').disabled) element('pull').click();
        return;
      }
    }
    // A mobile IME may only send beforeinput. Hardware already sounds at
    // keydown; ignoring its follow-up input also avoids double-sounding Hangul.
    if (performance.now() - lastPhysicalStrike < 130) return;
    switch (event.inputType) {
      case 'insertCompositionText':
        if (event.data && event.data !== previousComposition) strike('key');
        previousComposition = event.data || '';
        break;
      case 'insertText':
        // Some keyboards repeat the just-committed syllable as insertText.
        if (recentCommit && event.data === recentCommit.text && performance.now() - recentCommit.at < 60) {
          recentCommit = null;
          break;
        }
        if (event.data && Array.from(event.data).length === 1) strike(event.data === ' ' ? 'space' : 'key');
        break;
      case 'deleteContentBackward':
      case 'deleteContentForward': strike('delete'); break;
      case 'insertParagraph':
      case 'insertLineBreak': strike('return'); break;
    }
  });
  editor.addEventListener('keyup', event => {
    if (event.key === 'Enter') { shiftReturn = false; commitReturn = false; }
  });
  editor.addEventListener('blur', () => { shiftReturn = false; commitReturn = false; });
  editor.addEventListener('input', () => {
    updateWritingTime();
    renderEditor();
    saveDraft();
  });

  element('reroll').addEventListener('click', () => {
    noun = pick(gulgamWords.nouns, recentNouns);
    adjective = pick(gulgamWords.adjectives, recentAdjectives);
    renderEditor();
    saveDraft();
    if (document.body.dataset.view === 'receipt') {
      setView('write');
      editor.focus({ preventScroll: true });
    }
  });

  // After a pointer-operated adjustment desktop writers can keep typing.
  // Leave keyboard navigation and the mobile software keyboard under user control.
  if (consoleReceipt) {
    for (const control of [element('reroll'), ...soundButtons, ...all('[data-theme-toggle]')]) {
      control.addEventListener('click', event => {
        if (event.detail && document.body.dataset.view === 'write' && matchMedia('(pointer: fine)').matches) {
          editor.focus({ preventScroll: true });
        }
      });
    }
  }

  function setView(view) {
    const printing = view === 'receipt';
    clearTimeout(toastTimer);
    if (element('toast')) element('toast').hidden = true;
    document.body.dataset.view = view;
    element('write-view').hidden = printing;
    element('receipt-view').hidden = !printing;
    if (element('copy-fallback')) element('copy-fallback').hidden = true;
    for (const status of all('[data-view-state]')) status.textContent = printing ? '출력됨' : '작성 중';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderReceipt(animate = false) {
    element('receipt-text').textContent = editor.value;
    if (consoleReceipt) {
      element('receipt-noun').textContent = noun;
      element('receipt-adjective').textContent = adjective;
      element('receipt-elapsed').textContent = displayWritingTime();
      document.dispatchEvent(new CustomEvent('gulgam:receipt', {
        detail: { text: editor.value, animate, playSound: kind => playSound(kind, 'receipt') }
      }));
    } else {
      element('receipt-words').textContent = wordPair();
      element('receipt-date').textContent = displayDate();
      element('receipt-length').textContent = element('word-count').textContent;
    }
  }

  element('pull').addEventListener('click', () => {
    if (document.body.dataset.view !== 'write' || !editor.value.trim()) return;
    editor.blur();
    writing.elapsedMs = elapsedMs();
    writing.since = null;
    saveDraft();
    if (consoleReceipt) startAudio();
    else playSound('print');
    setView('receipt');
    renderReceipt(true);
    element('receipt-focus').focus({ preventScroll: true });
  });

  element('back').addEventListener('click', () => {
    setView('write');
    editor.focus({ preventScroll: true });
  });

  async function copyText(trigger) {
    const text = editor.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('글을 복사했어요.');
      return;
    } catch { /* Browsers without clipboard permission can copy a selection. */ }
    const onReceipt = document.body.dataset.view === 'receipt';
    const field = onReceipt ? element('copy-fallback') : editor;
    if (!field) {
      showToast('본문을 선택한 뒤 기기의 복사 기능을 사용해 주세요.');
      return;
    }
    if (onReceipt) {
      field.hidden = false;
      field.value = text;
    }
    field.focus();
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Keep the selection available. */ }
    if (copied) {
      if (onReceipt) field.hidden = true;
      if (trigger.getClientRects().length) trigger.focus();
      showToast('글을 복사했어요.');
    } else {
      showToast('선택된 글을 기기의 복사 기능으로 복사해 주세요.');
    }
  }

  function downloadText() {
    if (!editor.value) return;
    const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = 'GULGAM-' + noun + '-' + adjective + '.txt';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  element('copy').addEventListener('click', event => copyText(event.currentTarget));
  element('download').addEventListener('click', downloadText);

  const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const themeButtons = all('[data-theme-toggle]');
  const autoThemeButtons = all('[data-theme-auto]');
  let themeChoice = readStored(themeKey);

  function renderTheme() {
    const manual = themeChoice === 'dark' || themeChoice === 'light';
    const dark = manual ? themeChoice === 'dark' : themeQuery.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    for (const button of themeButtons) {
      button.setAttribute('aria-label', dark ? '밝은 화면으로 전환' : '어두운 화면으로 전환');
      button.setAttribute('aria-pressed', String(dark));
      const label = button.querySelector('[data-theme-label]');
      if (label) label.textContent = dark ? '밝게' : '어둡게';
    }
    for (const button of autoThemeButtons) button.setAttribute('aria-pressed', String(!manual));
  }

  for (const button of themeButtons) {
    button.addEventListener('click', () => {
      themeChoice = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(themeKey, themeChoice); } catch { /* The session can still switch. */ }
      renderTheme();
    });
  }
  for (const button of autoThemeButtons) {
    button.addEventListener('click', () => {
      themeChoice = null;
      try { localStorage.removeItem(themeKey); } catch { /* Apply the default here. */ }
      renderTheme();
    });
  }
  themeQuery.addEventListener('change', renderTheme);

  const banner = document.querySelector('[data-edition-banner]');
  if (banner) {
    const bannerKey = 'gulgam.edition-dismissed.v1';
    try { banner.hidden = sessionStorage.getItem(bannerKey) === 'yes'; } catch { /* Show the banner. */ }
    for (const button of all('[data-dismiss-banner]')) {
      button.addEventListener('click', () => {
        banner.hidden = true;
        try { sessionStorage.setItem(bannerKey, 'yes'); } catch { /* Dismiss on this page. */ }
      });
    }
  }

  for (const name of ['settings', 'tools']) {
    const dialog = element(name + '-dialog');
    if (!dialog) continue;
    for (const button of all('[data-open-' + name + ']')) {
      button.addEventListener('click', () => {
        if (!dialog.open) dialog.showModal();
      });
    }
    for (const close of dialog.querySelectorAll('[data-close-dialog]')) {
      close.addEventListener('click', () => dialog.close());
    }
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
  }

  for (const button of all('[data-action]').filter(button => button.id !== button.dataset.action)) {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      button.closest('dialog')?.close();
      if (action === 'copy') copyText(button);
      else if (action === 'download') downloadText();
      else if (['reroll', 'pull', 'back'].includes(action) && button !== element(action)) element(action).click();
    });
  }

  const clock = document.querySelector('[data-clock]');
  if (clock) {
    const tick = () => {
      const now = new Date();
      const two = value => String(value).padStart(2, '0');
      clock.textContent = now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate())
        + ' ' + [now.getHours(), now.getMinutes(), now.getSeconds()].map(two).join(':');
    };
    tick();
    setInterval(tick, 1000);
  }

  function restorePreferences() {
    themeChoice = readStored(themeKey);
    soundOn = preferredSound();
    renderTheme();
    renderSoundState();
  }
  window.addEventListener('storage', event => {
    if (event.key === draftKey) restoreCurrentDraft();
    if (event.key === themeKey || event.key === soundKey || event.key === null) restorePreferences();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      restoreCurrentDraft();
      restorePreferences();
    }
  });

  if (element('paper-date')) element('paper-date').textContent = displayDate();
  renderTheme();
  renderSoundState();
  renderEditor();
  if (draft.text !== undefined && noun === draft.nounId && adjective === draft.adjectiveId
      && (draft.writingTime || !draft.text.trim())) showSaveStatus(initial.storage);
  else saveDraft();
  const desktopWriter = consoleReceipt
    ? navigator.maxTouchPoints === 0 || matchMedia('(hover: hover) and (pointer: fine)').matches
    : matchMedia('(min-width: 651px) and (pointer: fine)').matches;
  if (desktopWriter) {
    editor.focus({ preventScroll: true });
  }
})();
