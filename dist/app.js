(() => {
  'use strict';

  const element = id => document.getElementById(id);
  const all = selector => Array.from(document.querySelectorAll(selector));
  const editor = element('editor');
  const consoleReceipt = element('receipt-playback') !== null;
  const roundKeys = document.body.dataset.keyShape === 'round';
  const soundButtons = all('#sound, [data-sound-toggle]');
  const soundLabels = all('[data-sound-label]');
  const draftActions = all('[data-action="copy"], [data-action="download"], [data-action="share-image"]');
  const printButtons = all('#pull, [data-action="pull"]');
  const promptLabels = all('#words [data-prompt-word]');
  const promptProgress = element('prompt-progress');
  const lineCounters = all('[data-line-count]');
  const draftStates = all('[data-draft-state]');
  const draftKey = 'gulgam.draft.v1';
  const typewriter = document.body.dataset.edition === 'typewriter' || /(^|\/)typewriter\//.test(location.pathname);
  const soundKey = typewriter ? 'gulgam.sound.v1' : 'gulgam.original.sound.v1';
  const themeKey = 'gulgam.theme.v1';
  const recentNouns = [];
  const carriage = document.querySelector('[data-carriage]');
  const missionLines = all('[data-mission-line]');
  const missionDialog = element('mission-dialog');
  const piecesDialog = element('pieces-dialog');
  const piecesKey = 'gulgam.pieces.v1';
  const pieceLimit = 200;
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

  function rememberNoun(word) {
    recentNouns.push(word);
    if (recentNouns.length > 10) recentNouns.shift();
    return word;
  }

  function pickNoun() {
    const available = gulgamWords.nouns.filter(word => !recentNouns.includes(word));
    return rememberNoun(available[Math.floor(Math.random() * available.length)]);
  }

  // A rule is judged here and can hold the receipt back. Conditions (viewpoint,
  // mood, form) are only printed on the slip; whoever reads it judges those.
  const ruleKinds = {
    length: { values: gulgamWords.lengths, label: value => value + '자 이내' },
    timer: { values: gulgamWords.minutes, label: value => value + '분 안에' },
    ban: { values: gulgamWords.banned, label: value => '‘' + value + '’ 금지' }
  };
  const conditionKeys = Object.keys(gulgamWords.conditions);

  function validRule(source) {
    const kind = source && ruleKinds[source.type];
    return kind && kind.values.includes(source.value) ? { type: source.type, value: source.value } : null;
  }

  function validConditions(source) {
    const conditions = {};
    for (const key of conditionKeys) {
      const value = typeof source?.[key] === 'string' ? source[key].normalize('NFC') : '';
      if (gulgamWords.conditions[key].includes(value)) conditions[key] = value;
    }
    return conditions;
  }

  function drawRule(type, avoid) {
    const kind = ruleKinds[type];
    if (!kind) return null;
    let values = kind.values;
    // A banned word inside a prompt noun would make the prompt impossible.
    if (type === 'ban') values = values.filter(word => !promptNouns.some(noun => noun.includes(word) || word.includes(noun)));
    const pool = values.length > 1 ? values.filter(value => value !== avoid) : values;
    return pool.length ? { type, value: pool[Math.floor(Math.random() * pool.length)] } : null;
  }

  // A shared link carries the whole prompt: ?w=연필,치킨&r=length:150&c=pov:2인칭,mood:공포
  function readLink() {
    const params = new URLSearchParams(location.search);
    const nouns = (params.get('w') || '').split(',').map(word => word.trim().normalize('NFC')).filter(Boolean);
    if (nouns.length !== 2 || nouns[0] === nouns[1] || !nouns.every(word => gulgamWords.nouns.includes(word))) return null;
    const [type, value] = (params.get('r') || '').split(':');
    const conditions = {};
    for (const pair of (params.get('c') || '').split(',')) {
      const [key, chosen] = pair.split(':');
      if (key && chosen) conditions[key] = chosen;
    }
    return {
      nouns,
      rule: validRule({ type, value: type === 'ban' ? (value || '').normalize('NFC') : Number(value) }),
      conditions: validConditions(conditions)
    };
  }

  function missionUrl() {
    const parts = ['w=' + promptNouns.join(',')];
    if (rule) parts.push('r=' + rule.type + ':' + rule.value);
    const chosen = conditionKeys.filter(key => conditions[key]).map(key => key + ':' + conditions[key]);
    if (chosen.length) parts.push('c=' + chosen.join(','));
    return location.origin + location.pathname + '?' + parts.join('&');
  }

  function readPrompt(record) {
    const [savedFirst, savedSecond] = Array.isArray(record.nounIds) ? record.nounIds : [record.nounId];
    const first = gulgamWords.nouns.includes(savedFirst) ? rememberNoun(savedFirst) : pickNoun();
    if (savedSecond !== first && gulgamWords.nouns.includes(savedSecond)) {
      return [first, rememberNoun(savedSecond)];
    }
    // Give an existing draft credit for a second noun its author already used.
    const text = (record.text || '').normalize('NFC');
    const inDraft = gulgamWords.nouns.find(word => word !== first && text.includes(word));
    return [first, inDraft ? rememberNoun(inDraft) : pickNoun()];
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
  let promptNouns = readPrompt(draft);
  let rule = validRule(draft.rule);
  let conditions = validConditions(draft.conditions);
  const linked = readLink();
  if (linked) {
    // A received prompt replaces the saved one. Text being written stays, as with 다른 글감.
    promptNouns = linked.nouns.map(rememberNoun);
    rule = linked.rule;
    conditions = linked.conditions;
    history.replaceState(null, '', location.pathname);
  }
  editor.value = draft.text || '';
  let writing = readWritingTime(draft);

  // A time limit measures from the moment it is set, not from an older draft.
  function restartClock() {
    writing = { elapsedMs: 0, since: editor.value.trim() ? Date.now() : null, resumed: false };
  }
  if (linked?.rule?.type === 'timer') restartClock();

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

  function durationText(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes ? minutes + '분 ' + String(seconds % 60).padStart(2, '0') + '초' : seconds + '초';
  }

  function displayWritingTime() {
    const duration = durationText(elapsedMs());
    return writing.resumed ? duration + ' (이어서 쓴 시간)' : duration;
  }

  function wordPair() {
    return promptNouns.join(' · ');
  }

  function missionSignature(nouns, savedRule, savedConditions) {
    return JSON.stringify([nouns, savedRule, conditionKeys.map(key => savedConditions[key] || '')]);
  }

  function sameSavedPrompt(record) {
    return (record.version === 2 || record.version === 3) && Array.isArray(record.nounIds) && record.nounIds.length === 2
      && missionSignature(record.nounIds, validRule(record.rule), validConditions(record.conditions))
        === missionSignature(promptNouns, rule, conditions);
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
      version: 3, nounIds: promptNouns, rule, conditions,
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

  function missingPromptWords() {
    const text = editor.value.normalize('NFC');
    return promptNouns.filter(word => !text.includes(word));
  }

  const characterCount = () => Array.from(editor.value).length;

  function ruleBroken() {
    if (!rule) return false;
    if (rule.type === 'length') return characterCount() > rule.value;
    if (rule.type === 'ban') return editor.value.normalize('NFC').includes(rule.value);
    return false;
  }

  // The clock starts with the first keystroke and never locks the writer out:
  // an overrun is printed on the slip instead.
  function timerState() {
    if (!rule || rule.type !== 'timer') return null;
    const remaining = rule.value * 60000 - elapsedMs();
    return { remaining, over: remaining <= 0 };
  }

  function timerDisplay(timer) {
    if (timer.over) return '시간 종료';
    const seconds = Math.ceil(timer.remaining / 1000);
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  const labelFor = saved => saved ? ruleKinds[saved.type].label(saved.value) : '';
  const ruleLabel = () => labelFor(rule);
  const conditionList = source => conditionKeys.map(key => source[key]).filter(Boolean);
  const conditionLabels = () => conditionList(conditions);

  function renderMission() {
    const timer = timerState();
    const chips = [];
    if (rule) {
      chips.push({
        text: timer ? ruleLabel() + ' · ' + timerDisplay(timer) : ruleLabel(),
        kind: 'rule', used: timer ? (timer.over ? 'over' : 'ticking') : String(!ruleBroken())
      });
    }
    for (const value of conditionLabels()) chips.push({ text: value, kind: 'condition' });
    const signature = JSON.stringify(chips);
    for (const line of missionLines) {
      line.hidden = chips.length === 0;
      if (line.dataset.signature === signature) continue;
      line.dataset.signature = signature;
      line.replaceChildren(...chips.map(chip => {
        const span = document.createElement('span');
        span.textContent = chip.text;
        span.dataset.chip = chip.kind;
        if (chip.used) span.dataset.used = chip.used;
        return span;
      }));
    }
  }

  function renderEditor() {
    const count = characterCount();
    element('word-count').textContent = count.toLocaleString('ko-KR') + '자';
    const empty = !editor.value.trim();
    for (const button of draftActions) button.disabled = empty;
    const missing = missingPromptWords();
    const broken = ruleBroken();
    for (const button of printButtons) button.disabled = missing.length > 0 || broken;
    promptLabels.forEach((label, index) => {
      const word = promptNouns[index];
      if (label.textContent !== word) label.textContent = word;
      const used = String(!missing.includes(word));
      if (label.dataset.used !== used) label.dataset.used = used;
    });
    let progress;
    if (missing.length) progress = '남은 글감 ' + missing.join(', ');
    else if (broken && rule.type === 'length') progress = rule.value + '자를 넘었어요. 지금 ' + count + '자';
    else if (broken) progress = '‘' + rule.value + '’ 없이 써야 뽑을 수 있어요.';
    else progress = '두 단어를 모두 썼어요. 글을 뽑을 수 있어요.';
    if (timerState()?.over) progress = '시간이 다 됐어요. ' + progress;
    if (promptProgress.textContent !== progress) promptProgress.textContent = progress;
    for (const label of lineCounters) label.textContent = editor.value ? String(editor.value.split('\n').length) : '0';
    renderMission();
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
    if (modifiedTime(latest) === lastEditTime && editor.value === latest.text && sameSavedPrompt(latest)) {
      showSaveStatus(storage);
      return;
    }
    lastEditTime = Math.max(lastEditTime, modifiedTime(latest));
    writing = readWritingTime(latest);
    recoverableText = latest.text;
    if (!sameSavedPrompt(latest)) {
      promptNouns = readPrompt(latest);
      rule = validRule(latest.rule);
      conditions = validConditions(latest.conditions);
    }
    if (editor.value !== latest.text) editor.value = latest.text;
    renderEditor();
    if (sameSavedPrompt(latest)) showSaveStatus(storage);
    else saveDraft();
    if (document.body.dataset.view === 'receipt') {
      if (!element('pull').disabled) renderReceipt();
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
    promptNouns = [pickNoun(), pickNoun()];
    if (rule?.type === 'ban' && promptNouns.some(noun => noun.includes(rule.value) || rule.value.includes(noun))) rule = drawRule('ban');
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

  function receiptRuleText() {
    if (!rule) return '';
    return ruleLabel() + (timerState()?.over ? ' · 시간 초과' : ' ✓');
  }

  function renderReceipt(animate = false) {
    element('receipt-text').textContent = editor.value;
    const ruleLine = element('receipt-rule');
    const conditionLine = element('receipt-conditions');
    ruleLine.textContent = receiptRuleText();
    ruleLine.hidden = !rule;
    conditionLine.textContent = conditionLabels().join(' · ');
    conditionLine.hidden = conditionLabels().length === 0;
    if (consoleReceipt) {
      element('receipt-word-1').textContent = promptNouns[0];
      element('receipt-word-2').textContent = promptNouns[1];
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
    if (document.body.dataset.view !== 'write' || composing || missingPromptWords().length || ruleBroken()) return;
    editor.blur();
    writing.elapsedMs = elapsedMs();
    writing.since = null;
    saveDraft();
    const kept = keepPiece();
    if (consoleReceipt) startAudio();
    else playSound('print');
    setView('receipt');
    renderReceipt(true);
    showKept(kept);
    element('receipt-focus').focus({ preventScroll: true });
  });

  element('back').addEventListener('click', () => {
    setView('write');
    editor.focus({ preventScroll: true });
  });

  // Without clipboard permission a visible selection lets the device copy it.
  function copyBySelection(field, text, trigger) {
    if (!field) {
      showToast('본문을 선택한 뒤 기기의 복사 기능을 사용해 주세요.');
      return false;
    }
    const fallback = field === element('copy-fallback');
    if (fallback) {
      field.hidden = false;
      field.value = text;
    }
    field.focus();
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* Keep the selection available. */ }
    if (copied) {
      if (fallback) field.hidden = true;
      if (trigger?.getClientRects().length) trigger.focus();
    } else {
      showToast('선택된 글을 기기의 복사 기능으로 복사해 주세요.');
    }
    return copied;
  }

  async function copyText(trigger) {
    const text = editor.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('글을 복사했어요.');
      return;
    } catch { /* Browsers without clipboard permission can copy a selection. */ }
    const onReceipt = document.body.dataset.view === 'receipt';
    if (copyBySelection(onReceipt ? element('copy-fallback') : editor, text, trigger)) showToast('글을 복사했어요.');
  }

  function downloadBlob(blob, name) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function downloadText() {
    if (!editor.value) return;
    downloadBlob(new Blob([editor.value], { type: 'text/plain;charset=utf-8' }), 'GULGAM-' + promptNouns.join('-') + '.txt');
  }

  // A phone gets the system share sheet; a desktop gets the link or the file.
  const touchSharing = () => matchMedia('(pointer: coarse)').matches;

  async function shareMission(trigger) {
    const url = missionUrl();
    const text = wordPair() + (rule ? ' · ' + ruleLabel() : '') + ' — 이 글감으로 글 써볼래?';
    if (navigator.share && touchSharing()) {
      try {
        await navigator.share({ title: 'GULGAM 글감', text, url });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('글감 링크를 복사했어요. 친구에게 보내 보세요.');
      return;
    } catch { /* Fall back to a visible selection. */ }
    if (copyBySelection(element('copy-fallback'), url, trigger)) showToast('글감 링크를 복사했어요.');
  }

  function wrapLines(context, text, maxWidth) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const candidate = line ? line + ' ' + word : word;
        if (context.measureText(candidate).width <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        let piece = '';
        for (const glyph of word) {
          if (piece && context.measureText(piece + glyph).width > maxWidth) {
            lines.push(piece);
            piece = '';
          }
          piece += glyph;
        }
        line = piece;
      }
      lines.push(line);
    }
    return lines;
  }

  function slipPath(context, x, y, width, height, tooth) {
    context.beginPath();
    context.moveTo(x, y);
    for (let edge = x; edge < x + width; edge += tooth * 2) {
      context.lineTo(Math.min(edge + tooth, x + width), y + tooth);
      context.lineTo(Math.min(edge + tooth * 2, x + width), y);
    }
    context.lineTo(x + width, y + height);
    for (let edge = x + width; edge > x; edge -= tooth * 2) {
      context.lineTo(Math.max(edge - tooth, x), y + height - tooth);
      context.lineTo(Math.max(edge - tooth * 2, x), y + height);
    }
    context.closePath();
  }

  function dashedLine(context, from, to, y) {
    context.save();
    context.strokeStyle = '#c6c1b7';
    context.lineWidth = 2;
    context.setLineDash([3, 9]);
    context.beginPath();
    context.moveTo(from, y);
    context.lineTo(to, y);
    context.stroke();
    context.restore();
  }

  // The receipt is the share card: one slip, 1080 wide, at least 4:5 tall.
  async function drawReceiptImage() {
    const sans = '"Noto Sans KR", sans-serif';
    const latin = 'Poppins, "Noto Sans KR", sans-serif';
    await Promise.all(['400 38px "Noto Sans KR"', '500 46px Poppins', '700 46px Poppins']
      .map(font => document.fonts.load(font).catch(() => null)));
    const width = 1080;
    const margin = 72;
    const inset = 64;
    const slipWidth = width - margin * 2;
    const left = margin + inset;
    const right = width - margin - inset;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const bodyFont = '400 38px ' + sans;
    const bodyLine = 62;
    context.font = bodyFont;
    let lines = wrapLines(context, editor.value.replace(/\s+$/, ''), right - left);
    const maxLines = 34;
    const clipped = lines.length > maxLines;
    if (clipped) lines = lines.slice(0, maxLines);
    const metaLines = [receiptRuleText(), conditionLabels().join(' · ')].filter(Boolean);
    const blocks = {
      header: 128, nouns: promptNouns.length * 84 + 12, meta: metaLines.length * 44 + (metaLines.length ? 12 : 0),
      body: lines.length * bodyLine + (clipped ? 52 : 0) + 24, footer: 104
    };
    const slipHeight = inset * 2 + blocks.header + blocks.nouns + blocks.meta + blocks.body + blocks.footer + 36 * 3;
    const height = Math.max(1350, slipHeight + margin * 2);
    canvas.width = width;
    canvas.height = height;
    const top = Math.round((height - slipHeight) / 2);
    context.fillStyle = '#e4e0d8';
    context.fillRect(0, 0, width, height);
    slipPath(context, margin, top, slipWidth, slipHeight, 14);
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, .14)';
    context.shadowBlur = 28;
    context.shadowOffsetY = 10;
    context.fillStyle = '#fff';
    context.fill();
    context.restore();

    const ink = '#111';
    const muted = '#6f6b64';
    let y = top + inset + 50;
    context.fillStyle = ink;
    context.textBaseline = 'alphabetic';
    context.font = '500 46px ' + latin;
    context.fillText('gul', left, y);
    const gulWidth = context.measureText('gul').width;
    context.font = '700 46px ' + latin;
    context.fillText('gam', left + gulWidth, y);
    context.textAlign = 'right';
    context.fillStyle = muted;
    context.font = '500 26px ' + sans;
    context.fillText('글 영수증', right, y - 4);
    context.font = '400 24px ' + sans;
    context.fillText(displayDate(), right, y + 40);
    context.textAlign = 'left';
    y = top + inset + blocks.header;
    dashedLine(context, left, right, y);

    y += 36;
    context.fillStyle = ink;
    context.font = '400 68px ' + sans;
    for (const noun of promptNouns) {
      y += 72;
      context.fillText(noun, left, y);
      y += 12;
    }
    context.fillStyle = muted;
    context.font = '500 28px ' + sans;
    for (const line of metaLines) {
      y += 40;
      context.fillText(line, left, y);
      y += 4;
    }
    y += metaLines.length ? 24 : 12;
    dashedLine(context, left, right, y);

    y += 36;
    context.fillStyle = ink;
    context.font = bodyFont;
    for (const line of lines) {
      y += 46;
      context.fillText(line, left, y);
      y += bodyLine - 46;
    }
    if (clipped) {
      y += 40;
      context.fillStyle = muted;
      context.font = '400 26px ' + sans;
      context.fillText('(이어지는 글은 글감에서)', left, y);
      y += 12;
    }
    y += 24;
    dashedLine(context, left, right, y);

    y += 70;
    context.fillStyle = muted;
    context.font = '500 26px ' + sans;
    context.fillText(displayWritingTime() + ' · ' + characterCount().toLocaleString('ko-KR') + '자', left, y);
    context.textAlign = 'right';
    context.fillStyle = ink;
    context.font = '500 26px ' + latin;
    context.fillText(location.host, right, y);
    context.textAlign = 'left';
    y += 40;
    context.fillStyle = muted;
    context.font = '400 22px ' + sans;
    context.fillText('무작위 두 단어로 쓴 짧은 글', left, y);
    return canvas;
  }

  async function shareReceiptImage(trigger) {
    if (!editor.value.trim()) return;
    let blob = null;
    try {
      const canvas = await drawReceiptImage();
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    } catch { /* Reported below. */ }
    if (!blob) {
      showToast('영수증 이미지를 만들지 못했어요.');
      return;
    }
    const name = 'GULGAM-' + promptNouns.join('-') + '.png';
    const file = new File([blob], name, { type: 'image/png' });
    if (touchSharing() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'GULGAM 글 영수증', text: wordPair() + ' · 글감에서 쓴 글 ' + missionUrl() });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    downloadBlob(blob, name);
    showToast('영수증 이미지를 저장했어요. 사진첩이나 SNS에 올려 보세요.');
    if (trigger?.getClientRects().length) trigger.focus();
  }

  // Every pulled receipt is kept as a piece in this browser, newest first.
  function readPieces() {
    try {
      const list = JSON.parse(localStorage.getItem(piecesKey));
      return Array.isArray(list)
        ? list.filter(piece => piece && typeof piece.id === 'string' && typeof piece.text === 'string' && Array.isArray(piece.nounIds))
        : [];
    } catch {
      return [];
    }
  }

  function writePieces(list) {
    try {
      localStorage.setItem(piecesKey, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  const samePiece = (a, b) => a.text === b.text && a.nounIds.join(',') === b.nounIds.join(',');

  function keepPiece() {
    const piece = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      nounIds: promptNouns, rule, conditions, text: editor.value,
      elapsedMs: writing.elapsedMs, resumed: writing.resumed, printedAt: new Date().toISOString()
    };
    // The same text pulled again stays one piece and moves to the top.
    return writePieces([piece, ...readPieces().filter(saved => !samePiece(saved, piece))].slice(0, pieceLimit));
  }

  function showKept(kept) {
    const status = element('receipt-kept');
    if (status) status.textContent = kept ? '뽑은 글에 보관됨' : '뽑은 글에 보관하지 못했어요';
    if (!kept) showToast('뽑은 글에 보관하지 못했어요. 글을 복사하거나 TXT로 저장해 주세요.');
  }

  function pieceDate(piece) {
    const printed = new Date(piece.printedAt);
    return displayDate(Number.isNaN(printed.getTime()) ? new Date() : printed);
  }

  function pieceExcerpt(text) {
    const line = text.split('\n').map(part => part.trim()).find(Boolean) || '';
    const glyphs = Array.from(line);
    return glyphs.length > 48 ? glyphs.slice(0, 48).join('') + '…' : line;
  }

  function pieceTags(piece) {
    return [labelFor(validRule(piece.rule)), ...conditionList(validConditions(piece.conditions))].filter(Boolean);
  }

  // Opening a piece makes it the draft again, so every receipt action works as is.
  function openPiece(piece) {
    const current = editor.value;
    const unsaved = current.trim() && current !== piece.text && !readPieces().some(saved => saved.text === current);
    if (unsaved && !window.confirm('쓰던 글을 이 글로 바꿀까요? 쓰던 글은 사라져요.')) return;
    promptNouns = readPrompt(piece);
    rule = validRule(piece.rule);
    conditions = validConditions(piece.conditions);
    editor.value = piece.text;
    writing = { elapsedMs: Number.isFinite(piece.elapsedMs) ? piece.elapsedMs : 0, since: null, resumed: piece.resumed === true };
    timerDone = true;
    renderEditor();
    saveDraft();
    piecesDialog.close();
    setView('receipt');
    renderReceipt();
    showKept(true);
    element('receipt-focus').focus({ preventScroll: true });
  }

  function exportPieces() {
    const list = readPieces();
    if (!list.length) return;
    const divider = '─'.repeat(28);
    const entries = list.map(piece => {
      const head = pieceDate(piece) + ' · ' + piece.nounIds.join(' · ');
      const tags = pieceTags(piece).join(' · ');
      const timing = '걸린 시간 ' + durationText(piece.elapsedMs || 0) + ' · ' + Array.from(piece.text).length + '자';
      return [head, ...(tags ? [tags] : []), timing, '', piece.text].join('\n');
    });
    const text = 'GULGAM 뽑은 글 ' + list.length + '건 · ' + displayDate() + '\n\n' + divider + '\n\n'
      + entries.join('\n\n' + divider + '\n\n') + '\n';
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'GULGAM-뽑은글.txt');
  }

  if (piecesDialog) {
    const list = element('pieces-list');
    const exportButton = piecesDialog.querySelector('[data-export-pieces]');
    const node = (tag, className, text) => {
      const made = document.createElement(tag);
      if (className) made.className = className;
      if (text !== undefined) made.textContent = text;
      return made;
    };
    const renderPieces = () => {
      const pieces = readPieces();
      list.replaceChildren(...pieces.map(piece => {
        const row = node('li', 'piece-row');
        const open = node('button', 'piece-open');
        open.type = 'button';
        open.dataset.openPiece = piece.id;
        const head = node('span', 'piece-head');
        head.append(node('strong', '', piece.nounIds.join(' · ')), node('span', 'piece-date', pieceDate(piece)));
        const meta = [Array.from(piece.text).length.toLocaleString('ko-KR') + '자', ...pieceTags(piece)].join(' · ');
        open.append(head, node('span', 'piece-excerpt', pieceExcerpt(piece.text)), node('span', 'piece-meta', meta));
        const remove = node('button', 'piece-delete', '지우기');
        remove.type = 'button';
        remove.dataset.deletePiece = piece.id;
        remove.setAttribute('aria-label', piece.nounIds.join(' · ') + ' 글 지우기');
        row.append(open, remove);
        return row;
      }));
      element('pieces-empty').hidden = pieces.length > 0;
      element('pieces-count').textContent = pieces.length ? pieces.length + '건' : '';
      exportButton.disabled = pieces.length === 0;
    };
    piecesDialog.addEventListener('gulgam:open', renderPieces);
    list.addEventListener('click', event => {
      const open = event.target.closest('[data-open-piece]');
      const remove = event.target.closest('[data-delete-piece]');
      if (open) {
        const piece = readPieces().find(saved => saved.id === open.dataset.openPiece);
        if (piece) openPiece(piece);
      } else if (remove) {
        if (!window.confirm('이 글을 지울까요? 되돌릴 수 없어요.')) return;
        writePieces(readPieces().filter(saved => saved.id !== remove.dataset.deletePiece));
        renderPieces();
      }
    });
    exportButton.addEventListener('click', exportPieces);
    window.addEventListener('storage', event => {
      if (event.key === piecesKey && piecesDialog.open) renderPieces();
    });
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

  for (const name of ['settings', 'tools', 'mission', 'pieces']) {
    const dialog = element(name + '-dialog');
    if (!dialog) continue;
    for (const button of all('[data-open-' + name + ']')) {
      button.addEventListener('click', () => {
        if (dialog.open) return;
        for (const other of all('dialog[open]')) other.close();
        dialog.dispatchEvent(new Event('gulgam:open'));
        dialog.showModal();
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
      else if (action === 'share-mission') shareMission(button);
      else if (action === 'share-image') shareReceiptImage(button);
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

  // A limit that already ran out before this visit waits for a manual pull.
  let timerDone = Boolean(timerState()?.over);
  if (missionDialog) {
    const ruleSelect = missionDialog.querySelector('[data-mission-rule]');
    const ruleValue = missionDialog.querySelector('[data-mission-value]');
    const ruleText = missionDialog.querySelector('[data-rule-value]');
    const redraw = missionDialog.querySelector('[data-redraw-rule]');
    const conditionSelects = all('[data-mission-condition]');
    for (const select of conditionSelects) {
      for (const value of gulgamWords.conditions[select.dataset.missionCondition] || []) {
        select.append(new Option(value, value));
      }
    }
    const renderMissionDialog = () => {
      ruleSelect.value = rule ? rule.type : '';
      ruleValue.hidden = !rule;
      ruleText.textContent = ruleLabel();
      for (const select of conditionSelects) select.value = conditions[select.dataset.missionCondition] || '';
    };
    const commitMission = () => {
      timerDone = false;
      renderEditor();
      saveDraft();
      renderMissionDialog();
    };
    missionDialog.addEventListener('gulgam:open', renderMissionDialog);
    ruleSelect.addEventListener('change', () => {
      rule = drawRule(ruleSelect.value);
      if (rule?.type === 'timer') restartClock();
      commitMission();
    });
    redraw.addEventListener('click', () => {
      if (rule) rule = drawRule(rule.type, rule.value);
      if (rule?.type === 'timer') restartClock();
      commitMission();
    });
    for (const select of conditionSelects) {
      select.addEventListener('change', () => {
        const next = { ...conditions };
        if (select.value) next[select.dataset.missionCondition] = select.value;
        else delete next[select.dataset.missionCondition];
        conditions = validConditions(next);
        commitMission();
      });
    }
  }

  // When the time is up and the prompt is met, the slip pulls itself.
  setInterval(() => {
    const timer = timerState();
    if (!timer || document.body.dataset.view !== 'write') return;
    renderEditor();
    if (timer.over && !timerDone && !composing && !element('pull').disabled) {
      timerDone = true;
      element('pull').click();
    }
  }, 1000);

  if (element('paper-date')) element('paper-date').textContent = displayDate();
  renderTheme();
  renderSoundState();
  renderEditor();
  if (sameSavedPrompt(draft) && (draft.writingTime || !draft.text.trim())) showSaveStatus(initial.storage);
  else saveDraft();
  if (linked) showToast('받은 글감으로 시작해요. ' + wordPair());
  const desktopWriter = consoleReceipt
    ? navigator.maxTouchPoints === 0 || matchMedia('(hover: hover) and (pointer: fine)').matches
    : matchMedia('(min-width: 651px) and (pointer: fine)').matches;
  if (desktopWriter) {
    editor.focus({ preventScroll: true });
  }
})();
