(() => {
  'use strict';

  const element = id => document.getElementById(id);
  const all = selector => Array.from(document.querySelectorAll(selector));
  const editor = element('editor');
  const consoleReceipt = element('receipt-playback') !== null;
  const roundKeys = document.body.dataset.keyShape === 'round';
  const soundButtons = all('#sound, [data-sound-toggle]');
  const soundLabels = all('[data-sound-label]');
  const draftActions = all('[data-action="copy"], [data-action="download"], [data-action="share-image"], [data-action="share-card"]');
  const printButtons = all('#pull, [data-action="pull"]');
  const promptLabels = all('#words [data-prompt-word]');
  const promptHeading = element('words');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const promptProgress = element('prompt-progress');
  const lineCounters = all('[data-line-count]');
  const draftStates = all('[data-draft-state]');
  const draftKey = 'gulgam.draft.v1';
  const typewriter = document.body.dataset.edition === 'typewriter' || /(^|\/)typewriter\//.test(location.pathname);
  const soundKey = typewriter ? 'gulgam.sound.v1' : 'gulgam.original.sound.v1';
  const themeKey = 'gulgam.theme.v1';
  const recentWords = { nouns: [], adjectives: [] };
  const carriage = document.querySelector('[data-carriage]');
  const promptLines = all('[data-prompt-line]');
  const ruleSentences = all('[data-rule-sentence]');
  const promptTitles = all('[data-prompt-title]');
  const promptDialog = element('prompt-dialog');
  const piecesDialog = element('pieces-dialog');
  const piecesKey = 'gulgam.pieces.v1';
  const pieceLimit = 200;
  let toastTimer;
  let revealing = null;
  let timerWasOver = false;
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

  const adjectiveIds = Object.keys(gulgamWords.adjectives);
  const isAdjective = word => typeof word === 'string' && Object.hasOwn(gulgamWords.adjectives, word);
  // A noun counts when written as is; an adjective counts in any of its listed forms.
  const formsOf = word => isAdjective(word) ? [word, ...gulgamWords.adjectives[word]] : [word];
  // Two words clash when writing one would satisfy, or break, the other.
  const clash = (a, b) => formsOf(a).some(x => formsOf(b).some(y => x.includes(y) || y.includes(x)));

  function rememberWord(word) {
    const recent = recentWords[isAdjective(word) ? 'adjectives' : 'nouns'];
    recent.push(word);
    if (recent.length > 10) recent.shift();
    return word;
  }

  function pickFrom(list, recent, partner) {
    const fits = word => !partner || (word !== partner && !clash(word, partner));
    const fresh = list.filter(word => !recent.includes(word) && fits(word));
    const pool = fresh.length ? fresh : list.filter(fits);
    return rememberWord(pool[Math.floor(Math.random() * pool.length)]);
  }

  const pickNoun = partner => pickFrom(gulgamWords.nouns, recentWords.nouns, partner);
  const pickAdjective = partner => pickFrom(adjectiveIds, recentWords.adjectives, partner);

  // The first word may be an adjective; the second is always a noun.
  function newPrompt(adjective) {
    const first = adjective ? pickAdjective() : pickNoun();
    return [first, pickNoun(first)];
  }

  const validPair = words => words.length === 2 && words[0] !== words[1]
    && (gulgamWords.nouns.includes(words[0]) || isAdjective(words[0]))
    && gulgamWords.nouns.includes(words[1]) && !clash(words[0], words[1]);

  // 오늘의 글감: the date in Korea gives everyone the same numbered prompt, day 1
  // being 2026-11-23. Each word is the one whose hash with the day scores lowest,
  // so adding a word to a list changes only the days that word wins.
  const dayLength = 86400000;
  const dailyEpoch = Date.UTC(2026, 10, 22, 15);
  const dayNumber = (time = Date.now()) => Math.floor((time - dailyEpoch) / dayLength) + 1;
  const validDaily = value => Number.isInteger(value) && value >= 1 && value <= dayNumber() ? value : null;

  function hashScore(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  // Every third day leads with an adjective.
  function dailyWords(day) {
    const lowest = (list, salt) => list.reduce((best, word) =>
      best === null || hashScore(day + salt + word) < hashScore(day + salt + best) ? word : best, null);
    const first = day % 3 === 0 ? lowest(adjectiveIds, ':a:') : lowest(gulgamWords.nouns, ':1:');
    return [first, lowest(gulgamWords.nouns.filter(word => word !== first && !clash(first, word)), ':2:')];
  }

  // A number belongs to a prompt only while its words are that day's words.
  function dailyOf(words, value) {
    const day = validDaily(value);
    return day && dailyWords(day).join() === words.join() ? day : null;
  }

  // A given sentence that already holds a prompt word would write it for the writer.
  const holdsWord = (sentence, word) => formsOf(word).some(form => sentence.includes(form));

  // A rule is judged here and can hold the receipt back. Conditions (viewpoint,
  // mood, form) are only printed on the slip; whoever reads it judges those.
  // Each kind keeps in one place its option name, values, label, when the text
  // breaks it, the hint while broken, and which prompt word it cannot sit beside.
  const ruleKinds = {
    length: {
      name: '글자 수 제한', values: gulgamWords.lengths, label: value => value + '자 이내',
      broken: value => characterCount() > value,
      hint: value => value + '자를 넘었어요. 지금 ' + characterCount() + '자'
    },
    timer: { name: '시간 제한', values: gulgamWords.minutes, label: value => value + '분 안에' },
    ban: {
      name: '금지 표현', values: gulgamWords.banned, label: value => '‘' + value + '’ 금지', text: true,
      broken: value => editor.value.normalize('NFC').includes(value),
      hint: value => '‘' + value + '’ 없이 써야 뽑을 수 있어요.',
      // A banned word inside a prompt word makes the prompt impossible.
      clashes: (value, word) => clash(word, value)
    },
    first: {
      name: '첫 문장 지정', values: gulgamWords.openings, label: value => '첫 문장 ‘' + value + '’', text: true, sentence: true,
      broken: value => !sentenceCore(editor.value).startsWith(sentenceCore(value)),
      hint: value => '‘' + value + '’로 시작해야 뽑을 수 있어요.',
      clashes: holdsWord
    },
    last: {
      name: '끝 문장 지정', values: gulgamWords.endings, label: value => '끝 문장 ‘' + value + '’', text: true, sentence: true,
      broken: value => !sentenceCore(editor.value).endsWith(sentenceCore(value)),
      hint: value => '‘' + value + '’로 끝내야 뽑을 수 있어요.',
      clashes: holdsWord
    }
  };
  const sentenceRule = type => Boolean(ruleKinds[type]?.sentence);
  const textRule = type => Boolean(ruleKinds[type]?.text);
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

  // A saved draft or piece carries a whole prompt: its words, rule, conditions and day.
  function adoptPrompt(record) {
    promptWords = readPrompt(record);
    rule = validRule(record.rule);
    conditions = validConditions(record.conditions);
    dailyNumber = dailyOf(promptWords, record.daily);
  }

  function ruleConflicts(candidate) {
    const clashes = candidate && ruleKinds[candidate.type].clashes;
    return Boolean(clashes) && promptWords.some(word => clashes(candidate.value, word));
  }

  // A rule that clashes with newly drawn words is drawn again, and a first
  // sentence the app wrote follows the new rule.
  function redrawClashingRule() {
    if (!ruleConflicts(rule)) return;
    const previous = rule;
    rule = drawRule(rule.type);
    syncOpening(previous);
  }

  function drawRule(type, avoid) {
    const kind = ruleKinds[type];
    if (!kind) return null;
    let values = kind.values;
    values = values.filter(value => !ruleConflicts({ type, value }));
    const pool = values.length > 1 ? values.filter(value => value !== avoid) : values;
    return pool.length ? { type, value: pool[Math.floor(Math.random() * pool.length)] } : null;
  }

  // A shared link carries the whole prompt: ?w=연필,치킨&r=length:150&c=pov:2인칭,mood:공포
  function readLink() {
    const params = new URLSearchParams(location.search);
    const words = (params.get('w') || '').split(',').map(word => word.trim().normalize('NFC')).filter(Boolean);
    if (!validPair(words)) return null;
    // A sentence value may itself hold a colon, so split at the first one only.
    const ruleParam = params.get('r') || '';
    const split = ruleParam.indexOf(':');
    const type = split < 0 ? ruleParam : ruleParam.slice(0, split);
    const value = split < 0 ? '' : ruleParam.slice(split + 1);
    const conditions = {};
    for (const pair of (params.get('c') || '').split(',')) {
      const [key, chosen] = pair.split(':');
      if (key && chosen) conditions[key] = chosen;
    }
    return {
      words,
      rule: validRule({ type, value: textRule(type) ? value.normalize('NFC') : Number(value) }),
      conditions: validConditions(conditions),
      daily: validDaily(Number(params.get('d')))
    };
  }

  function promptUrl() {
    const parts = ['w=' + promptWords.join(',')];
    // Encoded so a sentence's spaces do not cut the link short in a messenger.
    if (rule) parts.push('r=' + rule.type + ':' + encodeURIComponent(rule.value));
    const chosen = conditionKeys.filter(key => conditions[key]).map(key => key + ':' + encodeURIComponent(conditions[key]));
    if (chosen.length) parts.push('c=' + chosen.join(','));
    if (dailyNumber) parts.push('d=' + dailyNumber);
    return location.origin + location.pathname + '?' + parts.join('&');
  }

  function readPrompt(record) {
    const [savedFirst, savedSecond] = Array.isArray(record.nounIds) ? record.nounIds : [record.nounId];
    const first = gulgamWords.nouns.includes(savedFirst) || isAdjective(savedFirst) ? rememberWord(savedFirst) : pickNoun();
    if (savedSecond !== first && gulgamWords.nouns.includes(savedSecond) && !clash(first, savedSecond)) {
      return [first, rememberWord(savedSecond)];
    }
    // Give an existing draft credit for a second noun its author already used.
    const text = (record.text || '').normalize('NFC');
    const inDraft = gulgamWords.nouns.find(word => word !== first && !clash(first, word) && text.includes(word));
    return [first, inDraft ? rememberWord(inDraft) : pickNoun(first)];
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
  let promptWords = readPrompt(draft);
  let rule = validRule(draft.rule);
  let conditions = validConditions(draft.conditions);
  let dailyNumber = dailyOf(promptWords, draft.daily);
  const savedRule = rule;
  const linked = readLink();
  // A new day opens on today's prompt with a clean page, unless the page holds
  // writing that is not kept as a piece yet; that stays, and the new prompt waits.
  const today = dayNumber();
  const newDay = !linked && (!initial.record || dayNumber(modifiedTime(draft)) < today);
  const draftKept = Boolean(draft.text?.trim()) && readPieces().some(piece => piece.text === draft.text);
  const freshPage = newDay && (!draft.text?.trim() || draftKept);
  const dailyWaiting = newDay && !freshPage;
  if (linked) {
    // A received prompt replaces the saved one. Text being written stays, as with 다른 글감.
    promptWords = linked.words.map(rememberWord);
    rule = linked.rule;
    conditions = linked.conditions;
    dailyNumber = dailyOf(promptWords, linked.daily);
    history.replaceState(null, '', location.pathname);
  } else if (freshPage) {
    promptWords = dailyWords(today).map(rememberWord);
    rule = null;
    conditions = {};
    dailyNumber = today;
  }
  editor.value = freshPage ? '' : draft.text || '';
  let writing = freshPage ? { elapsedMs: 0, since: null, resumed: false } : readWritingTime(draft);

  // A time limit counts from the moment it is set. The writing time keeps
  // running underneath it, so the receipt still shows the whole time taken.
  function restartClock() {
    writing.timerFrom = elapsedMs();
  }
  if (linked?.rule?.type === 'timer') restartClock();

  function readWritingTime(record) {
    const saved = record.writingTime;
    if (saved && Number.isFinite(saved.elapsedMs) && saved.elapsedMs >= 0
        && (saved.since === null || Number.isFinite(saved.since) && saved.since > 0)) {
      const timerFrom = Number.isFinite(saved.timerFrom) && saved.timerFrom >= 0 ? saved.timerFrom : 0;
      return { elapsedMs: saved.elapsedMs, since: saved.since, resumed: saved.resumed === true, timerFrom };
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
    return promptWords.join(' · ');
  }

  // Today's numbered prompt reads 오늘의 글감; an earlier one keeps its number.
  function promptTitle() {
    if (!dailyNumber) return '글감';
    return dailyNumber === dayNumber() ? '오늘의 글감 ' + dailyNumber + '번' : dailyNumber + '번 글감';
  }

  function promptSignature(nouns, savedRule, savedConditions, daily) {
    return JSON.stringify([nouns, savedRule, conditionKeys.map(key => savedConditions[key] || ''), daily]);
  }

  function sameSavedPrompt(record) {
    return (record.version === 2 || record.version === 3) && Array.isArray(record.nounIds) && record.nounIds.length === 2
      && promptSignature(record.nounIds, validRule(record.rule), validConditions(record.conditions), dailyOf(record.nounIds, record.daily))
        === promptSignature(promptWords, rule, conditions, dailyNumber);
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
      version: 3, nounIds: promptWords, rule, conditions, daily: dailyNumber,
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
    return promptWords.filter(word => !formsOf(word).some(form => text.includes(form)));
  }

  const characterCount = () => Array.from(editor.value).length;

  function ruleBroken() {
    return Boolean(rule && ruleKinds[rule.type].broken?.(rule.value));
  }

  // Given sentences match regardless of spacing and the closing punctuation.
  function sentenceCore(text) {
    return text.normalize('NFC').replace(/\s+/g, '').replace(/[.!?…~'"’”」』)]+$/u, '');
  }

  // The app writes its own text into the editor as an ordinary input, so the
  // screens redraw and the draft saves. A page holding only the app's text has
  // no writing time yet.
  function setEditorText(text, onlyAppText) {
    editor.value = text;
    editor.setSelectionRange(text.length, text.length);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (!onlyAppText) return;
    writing = { elapsedMs: 0, since: null, resumed: false };
    saveDraft();
  }

  // A first-sentence rule writes its sentence onto an empty page. When the
  // sentence changes, the old one is swapped only where the text still starts
  // with it; when the rule goes, an untouched page is cleared. Writing that is
  // the writer's own is never removed.
  function syncOpening(previous) {
    const text = editor.value.trim();
    const old = previous?.type === 'first' ? previous.value : null;
    const untouched = old !== null && text === old;
    if (rule?.type === 'first') {
      if (text === rule.value) return;
      if (!text || untouched) {
        setEditorText(rule.value + ' ', true);
        showToast('첫 문장을 적어 뒀어요. 이어서 써 보세요.');
      } else if (old !== null && editor.value.trimStart().startsWith(old)) {
        setEditorText(rule.value + editor.value.trimStart().slice(old.length), false);
        showToast('첫 문장을 바꿔 적었어요.');
      }
    } else if (untouched) {
      setEditorText('', true);
    }
  }

  // The clock starts with the first keystroke and never locks the writer out:
  // an overrun is printed on the slip instead.
  function timerState() {
    if (!rule || rule.type !== 'timer') return null;
    const remaining = rule.value * 60000 - (elapsedMs() - (writing.timerFrom || 0));
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

  function renderPromptLine() {
    const title = promptTitle();
    for (const label of promptTitles) if (label.textContent !== title) label.textContent = title;
    const timer = timerState();
    const chips = [];
    if (rule) {
      const sentence = sentenceRule(rule.type);
      let used = String(!ruleBroken());
      if (timer) used = timer.over ? 'over' : 'ticking';
      // A given sentence not written yet is pending, not broken.
      else if (sentence && used === 'false') used = 'pending';
      chips.push({ text: timer ? ruleLabel() + ' · ' + timerDisplay(timer) : ruleLabel(), kind: 'rule', used, sentence });
    }
    for (const value of conditionLabels()) chips.push({ text: value, kind: 'condition' });
    // Screens without room in the prompt header show a given sentence on a line of its own.
    const sentenceChip = chips.find(chip => chip.sentence);
    for (const line of ruleSentences) {
      line.hidden = !sentenceChip;
      if (!sentenceChip) continue;
      if (line.textContent !== sentenceChip.text) line.textContent = sentenceChip.text;
      if (line.dataset.used !== sentenceChip.used) line.dataset.used = sentenceChip.used;
    }
    const signature = JSON.stringify(chips);
    for (const line of promptLines) {
      line.hidden = chips.length === 0;
      if (line.dataset.signature === signature) continue;
      line.dataset.signature = signature;
      line.replaceChildren(...chips.map(chip => {
        const span = document.createElement('span');
        span.textContent = chip.text;
        span.dataset.chip = chip.kind;
        if (chip.used) span.dataset.used = chip.used;
        if (chip.sentence) span.dataset.sentence = '';
        return span;
      }));
    }
  }

  function renderEditor() {
    const count = characterCount();
    element('word-count').textContent = count.toLocaleString('ko-KR') + '자';
    const hint = isAdjective(promptWords[0]) ? '두 단어를 넣어 써보세요. 형용사는 모양을 바꿔 써도 돼요.' : '두 단어를 넣어 자유롭게 써보세요.';
    if (editor.placeholder !== hint) editor.placeholder = hint;
    const empty = !editor.value.trim();
    for (const button of draftActions) button.disabled = empty;
    const missing = missingPromptWords();
    const broken = ruleBroken();
    for (const button of printButtons) button.disabled = missing.length > 0 || broken;
    promptLabels.forEach((label, index) => {
      const word = promptWords[index];
      if (!revealing && label.textContent !== word) label.textContent = word;
      const used = String(!missing.includes(word));
      if (label.dataset.used !== used) label.dataset.used = used;
    });
    let progress;
    if (missing.length) progress = '남은 글감 ' + missing.join(', ');
    else if (broken) progress = ruleKinds[rule.type].hint(rule.value);
    else progress = '두 단어를 모두 썼어요. 글을 뽑을 수 있어요.';
    if (timerState()?.over) progress = '시간이 다 됐어요. ' + progress;
    if (promptProgress.textContent !== progress) promptProgress.textContent = progress;
    for (const label of lineCounters) label.textContent = editor.value ? String(editor.value.split('\n').length) : '0';
    renderPromptLine();
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

  // Revealing a drawn prompt flips each word through candidates of the same
  // length, like a slot reel, and lands it with a key strike: one word after
  // another, within `duration`. The prompt is already decided and saved; only
  // the labels are borrowed. A tap or key press lands everything at once.
  function landReveal() {
    if (!revealing) return;
    clearTimeout(revealing.timer);
    revealing = null;
    delete promptHeading.dataset.revealing;
    promptHeading.removeAttribute('aria-busy');
    for (const label of promptLabels) {
      delete label.dataset.landed;
      label.style.minWidth = '';
    }
    renderEditor();
  }

  function revealPrompt(duration) {
    landReveal();
    if (!promptHeading || promptLabels.length !== promptWords.length || reducedMotion.matches || document.hidden) return;
    const pools = promptWords.map(word => {
      const list = isAdjective(word) ? adjectiveIds : gulgamWords.nouns;
      const length = Array.from(word).length;
      const same = list.filter(other => other !== word && Array.from(other).length === length);
      // With too few words of the same length, borrow shorter ones; the slot
      // keeps its final width below, so the line never jumps.
      return same.length >= 3 ? same : list.filter(other => other !== word && Array.from(other).length <= length);
    });
    for (const label of promptLabels) label.style.minWidth = label.getBoundingClientRect().width + 'px';
    const landAt = promptWords.map((_, index) => duration * (index + 1) / promptWords.length);
    const start = performance.now();
    const run = { timer: 0 };
    revealing = run;
    promptHeading.dataset.revealing = '';
    promptHeading.setAttribute('aria-busy', 'true');
    const step = () => {
      if (revealing !== run) return;
      const elapsed = performance.now() - start;
      promptLabels.forEach((label, index) => {
        if ('landed' in label.dataset) return;
        if (elapsed >= landAt[index]) {
          label.textContent = promptWords[index];
          label.dataset.landed = '';
          playSound('key');
          return;
        }
        const pool = pools[index];
        let next = label.textContent;
        while (next === label.textContent && pool.length > 1) next = pool[Math.floor(Math.random() * pool.length)];
        label.textContent = next;
      });
      if (promptLabels.every(label => 'landed' in label.dataset)) {
        landReveal();
        return;
      }
      // Flip fast at first and slow toward the last landing, without overshooting the next one.
      const nextLanding = Math.min(...landAt.filter((_, index) => !('landed' in promptLabels[index].dataset)));
      run.timer = setTimeout(step, Math.max(16, Math.min(40 + 80 * elapsed / duration, nextLanding - elapsed)));
    };
    step();
  }

  for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, landReveal, true);
  // Mobile keyboards may insert text without a usable keydown.
  editor.addEventListener('beforeinput', landReveal);
  document.addEventListener('visibilitychange', landReveal);

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
    if (!sameSavedPrompt(latest)) adoptPrompt(latest);
    // A limit that ran out elsewhere is not this tab's to pull.
    timerWasOver = Boolean(timerState()?.over);
    if (editor.value !== latest.text) editor.value = latest.text;
    renderEditor();
    if (sameSavedPrompt(latest)) showSaveStatus(storage);
    else saveDraft();
    if (document.body.dataset.view === 'receipt') {
      if (!element('pull').disabled) {
        renderReceipt();
        refreshKept();
      } else {
        setView('write');
      }
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
    promptWords = newPrompt(isAdjective(promptWords[0]));
    dailyNumber = null;
    redrawClashingRule();
    renderEditor();
    saveDraft();
    if (document.body.dataset.view === 'receipt') {
      setView('write');
      editor.focus({ preventScroll: true });
    }
    revealPrompt(600);
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
    element('receipt-focus').textContent = dailyNumber ? '글 영수증 · ' + dailyNumber + '번' : '글 영수증';
    const ruleLine = element('receipt-rule');
    const conditionLine = element('receipt-conditions');
    ruleLine.textContent = receiptRuleText();
    ruleLine.hidden = !rule;
    conditionLine.textContent = conditionLabels().join(' · ');
    conditionLine.hidden = conditionLabels().length === 0;
    if (consoleReceipt) {
      element('receipt-word-1').textContent = promptWords[0];
      element('receipt-word-2').textContent = promptWords[1];
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
    downloadBlob(new Blob([editor.value], { type: 'text/plain;charset=utf-8' }), 'GULGAM-' + promptWords.join('-') + '.txt');
  }

  // A phone gets the system share sheet; a desktop gets the link or the file.
  const touchSharing = () => matchMedia('(pointer: coarse)').matches;

  async function sharePrompt(trigger) {
    const url = promptUrl();
    const text = (dailyNumber ? promptTitle() + ' · ' : '') + wordPair() + (rule ? ' · ' + ruleLabel() : '') + ' — 이 글감으로 글 써볼래?';
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

  // The receipt is the share card: one slip on a 1080×1350 (4:5) image. A long
  // text gets a smaller face first, and is cut with a note only if it still overflows.
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
    const height = 1350;
    // A given sentence can outgrow one line of the slip.
    context.font = '500 28px ' + sans;
    const metaLines = [receiptRuleText(), conditionLabels().join(' · ')].filter(Boolean)
      .flatMap(line => wrapLines(context, line, right - left));
    const blocks = {
      header: 128, nouns: promptWords.length * 84 + 12, meta: metaLines.length * 44 + (metaLines.length ? 12 : 0), footer: 104
    };
    const fixedHeight = inset * 2 + blocks.header + blocks.nouns + blocks.meta + 24 + blocks.footer + 36 * 3;
    const room = height - margin * 2 - fixedHeight;
    const text = editor.value.replace(/\s+$/, '');
    let body;
    for (const size of [38, 34, 30, 27]) {
      context.font = '400 ' + size + 'px ' + sans;
      body = { size, lineHeight: Math.round(size * 1.63), lines: wrapLines(context, text, right - left), clipped: false };
      if (body.lines.length * body.lineHeight <= room) break;
    }
    if (body.lines.length * body.lineHeight > room) {
      body.clipped = true;
      body.lines = body.lines.slice(0, Math.max(1, Math.floor((room - 52) / body.lineHeight)));
    }
    const bodyFont = '400 ' + body.size + 'px ' + sans;
    const lines = body.lines;
    const clipped = body.clipped;
    const slipHeight = fixedHeight + lines.length * body.lineHeight + (clipped ? 52 : 0);
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
    context.fillText(dailyNumber ? '글 영수증 · ' + dailyNumber + '번' : '글 영수증', right, y - 4);
    context.font = '400 24px ' + sans;
    context.fillText(displayDate(), right, y + 40);
    context.textAlign = 'left';
    y = top + inset + blocks.header;
    dashedLine(context, left, right, y);

    y += 36;
    context.fillStyle = ink;
    context.font = '400 68px ' + sans;
    for (const noun of promptWords) {
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
    const ascent = Math.round(body.size * 1.21);
    for (const line of lines) {
      y += ascent;
      context.fillText(line, left, y);
      y += body.lineHeight - ascent;
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
    const name = 'GULGAM-' + promptWords.join('-') + '.png';
    const file = new File([blob], name, { type: 'image/png' });
    if (touchSharing() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'GULGAM 글 영수증', text: wordPair() + ' · 글감에서 쓴 글 ' + promptUrl() });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    downloadBlob(blob, name);
    showToast('영수증 이미지를 저장했어요. 사진첩이나 SNS에 올려 보세요.');
    if (trigger?.getClientRects().length) trigger.focus();
  }

  // 글 가리고 공유: a 1080×1920 story card with the prompt and how the writing
  // went. Every word of the text is blacked out where it would sit, so a friend
  // sees its shape and writes their own before reading anyone's.
  async function drawShareCard() {
    const sans = '"Noto Sans KR", sans-serif';
    const latin = 'Poppins, "Noto Sans KR", sans-serif';
    await Promise.all(['400 34px "Noto Sans KR"', '700 104px "Noto Sans KR"', '500 46px Poppins', '700 46px Poppins']
      .map(font => document.fonts.load(font).catch(() => null)));
    const width = 1080;
    const height = 1920;
    const margin = 96;
    const inset = 64;
    const left = margin + inset;
    const right = width - margin - inset;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    // The slip stays clear of a story's top and bottom bars, so a long text shows
    // only its first lines; the count below still tells its length.
    const lineHeight = 58;
    context.font = '400 34px ' + sans;
    const lines = wrapLines(context, editor.value.replace(/\s+$/, ''), right - left).slice(0, 8);
    const blocks = {
      header: 110, prompt: 56 + promptWords.length * 124 + 36, body: 44 + lines.length * lineHeight + 40, stats: 190, footer: 96
    };
    const slipHeight = inset * 2 + Object.values(blocks).reduce((sum, block) => sum + block, 0);
    const top = Math.round((height - slipHeight) / 2);
    context.fillStyle = '#e4e0d8';
    context.fillRect(0, 0, width, height);
    slipPath(context, margin, top, width - margin * 2, slipHeight, 14);
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
    context.textBaseline = 'alphabetic';
    context.fillStyle = ink;
    context.font = '500 46px ' + latin;
    context.fillText('gul', left, y);
    const gulWidth = context.measureText('gul').width;
    context.font = '700 46px ' + latin;
    context.fillText('gam', left + gulWidth, y);
    context.textAlign = 'right';
    context.fillStyle = muted;
    context.font = '400 26px ' + sans;
    context.fillText(displayDate(), right, y - 4);
    context.textAlign = 'left';
    y = top + inset + blocks.header;
    dashedLine(context, left, right, y);

    y += 56;
    context.fillStyle = muted;
    context.font = '500 30px ' + sans;
    context.fillText(promptTitle(), left, y);
    context.fillStyle = ink;
    context.font = '700 104px ' + sans;
    for (const word of promptWords) {
      y += 124;
      context.fillText(word, left, y);
    }
    y += 36;
    dashedLine(context, left, right, y);

    y += 44;
    context.font = '400 34px ' + sans;
    const space = context.measureText(' ').width;
    context.fillStyle = '#1d1d1d';
    for (const line of lines) {
      y += lineHeight;
      let x = left;
      for (const word of line.split(' ')) {
        const wordWidth = context.measureText(word).width;
        if (wordWidth) {
          context.beginPath();
          if (context.roundRect) context.roundRect(x, y - 31, wordWidth, 38, 5);
          else context.rect(x, y - 31, wordWidth, 38);
          context.fill();
        }
        x += wordWidth + space;
      }
    }
    y += 40;
    dashedLine(context, left, right, y);

    const middle = left + Math.round((right - left) / 2);
    y += 64;
    context.fillStyle = muted;
    context.font = '500 26px ' + sans;
    context.fillText(writing.resumed ? '이어서 쓴 시간' : '걸린 시간', left, y);
    context.fillText('글자 수', middle, y);
    y += 72;
    context.fillStyle = ink;
    context.font = '700 56px ' + sans;
    context.fillText(durationText(elapsedMs()), left, y);
    context.fillText(characterCount().toLocaleString('ko-KR') + '자', middle, y);
    y += 54;
    dashedLine(context, left, right, y);

    y += 60;
    context.fillStyle = muted;
    context.font = '500 26px ' + sans;
    context.fillText('같은 글감으로 써 보기', left, y);
    context.textAlign = 'right';
    context.fillStyle = ink;
    context.font = '500 26px ' + latin;
    context.fillText(location.host, right, y);
    context.textAlign = 'left';
    return canvas;
  }

  // The words that travel with the card: what was written, without the text, and the same prompt's link.
  function shareCardText() {
    return promptTitle() + ' · ' + wordPair() + ' — ' + durationText(elapsedMs()) + ' 동안 '
      + characterCount().toLocaleString('ko-KR') + '자를 썼어요. 같은 글감으로 써 볼래? ' + promptUrl();
  }

  async function shareCard(trigger) {
    if (!editor.value.trim()) return;
    let blob = null;
    try {
      const canvas = await drawShareCard();
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    } catch { /* Reported below. */ }
    if (!blob) {
      showToast('공유 카드를 만들지 못했어요.');
      return;
    }
    const name = 'GULGAM-' + promptWords.join('-') + '-카드.png';
    const file = new File([blob], name, { type: 'image/png' });
    const text = shareCardText();
    if (touchSharing() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'GULGAM ' + promptTitle(), text });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    downloadBlob(blob, name);
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch { /* The saved card is enough on its own. */ }
    showToast(copied ? '공유 카드를 저장하고 소개 글과 링크를 복사했어요.' : '공유 카드를 저장했어요.');
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
      nounIds: promptWords, rule, conditions, daily: dailyNumber, text: editor.value,
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

  // When another tab changes the receipt's text, it is kept only if that exact piece is in the list.
  function refreshKept() {
    const status = element('receipt-kept');
    if (!status) return;
    const kept = readPieces().some(saved => samePiece(saved, { nounIds: promptWords, text: editor.value }));
    status.textContent = kept ? '뽑은 글에 보관됨' : '';
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

  function pieceLabels(piece) {
    const daily = validDaily(piece.daily);
    return [daily ? daily + '번 글감' : '', labelFor(validRule(piece.rule)), ...conditionList(validConditions(piece.conditions))].filter(Boolean);
  }

  // Opening a piece makes it the draft again, so every receipt action works as is.
  function openPiece(piece) {
    const current = editor.value;
    const unsaved = current.trim() && current !== piece.text && !readPieces().some(saved => saved.text === current);
    if (unsaved && !window.confirm('쓰던 글을 이 글로 바꿀까요? 쓰던 글은 사라져요.')) return;
    adoptPrompt(piece);
    editor.value = piece.text;
    writing = { elapsedMs: Number.isFinite(piece.elapsedMs) ? piece.elapsedMs : 0, since: null, resumed: piece.resumed === true };
    timerWasOver = Boolean(timerState()?.over);
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
      const tags = pieceLabels(piece).join(' · ');
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
        const meta = [Array.from(piece.text).length.toLocaleString('ko-KR') + '자', ...pieceLabels(piece)].join(' · ');
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

  for (const name of ['settings', 'tools', 'prompt', 'pieces']) {
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
      else if (action === 'share-prompt') sharePrompt(button);
      else if (action === 'share-image') shareReceiptImage(button);
      else if (action === 'share-card') shareCard(button);
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
  timerWasOver = Boolean(timerState()?.over);
  if (promptDialog) {
    const kindSelect = promptDialog.querySelector('[data-prompt-kind]');
    const ruleSelect = promptDialog.querySelector('[data-prompt-rule]');
    const ruleValue = promptDialog.querySelector('[data-prompt-value]');
    const ruleText = promptDialog.querySelector('[data-rule-value]');
    const redraw = promptDialog.querySelector('[data-redraw-rule]');
    const conditionSelects = all('[data-prompt-condition]');
    // Both lists come from the code, so a new rule kind or condition value needs no HTML edit.
    for (const [type, kind] of Object.entries(ruleKinds)) ruleSelect.append(new Option(kind.name, type));
    for (const select of conditionSelects) {
      for (const value of gulgamWords.conditions[select.dataset.promptCondition] || []) {
        select.append(new Option(value, value));
      }
    }
    const renderPromptDialog = () => {
      if (kindSelect) kindSelect.value = dailyNumber === dayNumber() ? 'daily' : isAdjective(promptWords[0]) ? 'adjective' : 'noun';
      ruleSelect.value = rule ? rule.type : '';
      ruleValue.hidden = !rule;
      ruleText.textContent = ruleLabel();
      for (const select of conditionSelects) select.value = conditions[select.dataset.promptCondition] || '';
    };
    const commitPrompt = () => {
      renderEditor();
      saveDraft();
      renderPromptDialog();
    };
    promptDialog.addEventListener('gulgam:open', renderPromptDialog);
    // 오늘의 글감 brings back today's words. Another kind redraws only the first
    // word and leaves the day's prompt; the noun and the text stay.
    kindSelect?.addEventListener('change', () => {
      if (kindSelect.value === 'daily') {
        dailyNumber = dayNumber();
        promptWords = dailyWords(dailyNumber).map(rememberWord);
      } else {
        const adjective = kindSelect.value === 'adjective';
        if (adjective === isAdjective(promptWords[0]) && !dailyNumber) return;
        promptWords = [adjective ? pickAdjective(promptWords[1]) : pickNoun(promptWords[1]), promptWords[1]];
        dailyNumber = null;
      }
      redrawClashingRule();
      commitPrompt();
    });
    ruleSelect.addEventListener('change', () => {
      const previous = rule;
      rule = drawRule(ruleSelect.value);
      if (rule?.type === 'timer') restartClock();
      syncOpening(previous);
      commitPrompt();
    });
    redraw.addEventListener('click', () => {
      const previous = rule;
      if (rule) rule = drawRule(rule.type, rule.value);
      if (rule?.type === 'timer') restartClock();
      syncOpening(previous);
      commitPrompt();
    });
    for (const select of conditionSelects) {
      select.addEventListener('change', () => {
        const next = { ...conditions };
        if (select.value) next[select.dataset.promptCondition] = select.value;
        else delete next[select.dataset.promptCondition];
        conditions = validConditions(next);
        commitPrompt();
      });
    }
  }

  // At the moment the time runs out, a met prompt pulls its slip, once. Running
  // out with a word missing, or editing afterwards, never pulls it later.
  setInterval(() => {
    const timer = timerState();
    if (!timer || document.body.dataset.view !== 'write') return;
    renderEditor();
    if (!timer.over) {
      timerWasOver = false;
      return;
    }
    if (timerWasOver || composing) return;
    timerWasOver = true;
    if (!element('pull').disabled) element('pull').click();
  }, 1000);

  if (element('paper-date')) element('paper-date').textContent = displayDate();
  renderTheme();
  renderSoundState();
  renderEditor();
  // A received rule may replace a first sentence the app wrote; the writer's own
  // text stays. This writes through the editor, so it waits until everything is set up.
  if (linked) syncOpening(savedRule);
  // A link may have moved the clock or written a first sentence, even when its prompt matches the saved one.
  if (!linked && sameSavedPrompt(draft) && (draft.writingTime || !draft.text.trim())) showSaveStatus(initial.storage);
  else saveDraft();
  // A received prompt shows at once; a new day's prompt is revealed.
  if (linked) showToast('받은 글감으로 시작해요. ' + wordPair());
  else if (freshPage) revealPrompt(1000);
  else if (dailyWaiting) showToast('오늘의 글감 ' + today + '번이 나왔어요. 글감 설정에서 바꿀 수 있어요.');
  const desktopWriter = consoleReceipt
    ? navigator.maxTouchPoints === 0 || matchMedia('(hover: hover) and (pointer: fine)').matches
    : matchMedia('(min-width: 651px) and (pointer: fine)').matches;
  if (desktopWriter) {
    editor.focus({ preventScroll: true });
  }
})();
