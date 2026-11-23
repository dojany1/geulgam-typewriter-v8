// Checks the word lists in dist/words.js. Run from the repository root:
//   node tools/check-words.js
// It exits with 1 and lists every problem when a list would make a prompt
// impossible, or let an unrelated word satisfy an adjective.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'words.js'), 'utf8');
const words = vm.runInNewContext(source + '\n;gulgamWords');
const problems = [];
const fail = message => problems.push(message);

// Words a writer is likely to type. No adjective form may sit inside one of them.
const commonWords = ['긴장', '긴급', '아파트', '노래', '기차가', '자동차가', '먼지', '작별', '작가', '크림', '추억',
  '이상', '새로', '다른', '가끔', '오늘', '사람', '하늘', '시간', '우리', '처음', '마지막', '이야기', '생각',
  '어제', '내일', '수상자', '그리고', '그림', '가방', '바다', '기다리', '노력'];

// Same rule as formsOf in dist/app.js: a noun counts as is, an adjective in any listed form.
const formsOf = word => Object.hasOwn(words.adjectives, word) ? [...new Set([word, ...words.adjectives[word]])] : [word];
const overlaps = (a, b) => a.includes(b) || b.includes(a);
const adjectiveIds = Object.keys(words.adjectives);
const conditionValues = Object.values(words.conditions).flat();

for (const [name, items] of [['nouns', words.nouns], ['adjectives', adjectiveIds], ['banned', words.banned]]) {
  const seen = new Set();
  for (const item of items) {
    if (item !== item.normalize('NFC')) fail(`${name}: "${item}" is not NFC`);
    if (seen.has(item)) fail(`${name}: "${item}" appears twice`);
    seen.add(item);
  }
}

for (const id of adjectiveIds) {
  const forms = words.adjectives[id];
  if (!Array.isArray(forms) || forms.length === 0) {
    fail(`${id}: list at least one form`);
    continue;
  }
  if (words.nouns.includes(id)) fail(`${id}: is also a noun`);
  for (const form of formsOf(id)) {
    if (typeof form !== 'string' || !form || form !== form.normalize('NFC')) fail(`${id}: form "${form}" is empty or not NFC`);
    for (const noun of words.nouns) if (overlaps(form, noun)) fail(`${id}: form "${form}" overlaps the noun "${noun}"`);
    for (const ban of words.banned) if (overlaps(form, ban)) fail(`${id}: form "${form}" overlaps the banned word "${ban}"`);
    for (const value of conditionValues) if (overlaps(form, value)) fail(`${id}: form "${form}" reads like the condition "${value}"`);
    for (const common of commonWords) if (common.includes(form)) fail(`${id}: form "${form}" sits inside the common word "${common}"`);
  }
}

// Sentences that must, or must not, satisfy each word of a prompt.
const examples = [
  [['조용한', '골목'], '조용히 골목을 걸었다.', []],
  [['조용한', '골목'], '골목은 조용했다.', []],
  [['낡은', '구두'], '구두가 낡아서 버렸다.', []],
  [['빨간', '우산'], '빨개진 우산을 접었다.', []],
  [['빨간', '우산'], '우산을 샀다.', ['빨간']],
  [['추운', '새벽'], '추워서 새벽에 깼다.', []],
  [['기다란', '복도'], '복도가 기다랗게 뻗어 있었다.', []],
  [['낯선', '정류장'], '정류장이 낯설었다.', []],
  [['빠른', '기차역'], '기차역까지 빨랐다.', []],
  [['노란', '우산'], '우산 아래서 노래를 불렀다.', ['노란']],
  [['차가운', '우유'], '기차가 떠나고 우유를 마셨다.', ['차가운']],
  [['연필', '치킨'], '색연필로 치킨집 간판을 그렸다.', []]
];
for (const [prompt, text, expected] of examples) {
  const missing = prompt.filter(word => !formsOf(word).some(form => text.normalize('NFC').includes(form)));
  if (missing.join() !== expected.join()) {
    fail(`example ${prompt.join(' · ')} / "${text}": missing [${missing}] but expected [${expected}]`);
  }
}

if (problems.length) {
  console.error(problems.length + ' problem(s) in dist/words.js:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`dist/words.js ok: ${words.nouns.length} nouns, ${adjectiveIds.length} adjectives, ${examples.length} example sentences`);
