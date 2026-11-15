import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../js/domain.js', import.meta.url), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(code, context);
const Bingo = context.BingoDomain;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function harness(prefs) {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const spoken = [];
  let pending = null;
  const session = Bingo.createSession(
    Object.assign({ language: 'en', theme: 'cream', intervalSec: 8 }, prefs),
    {
      now: function () { return now; },
      random: prefs && prefs.random ? prefs.random : function () { return 0; },
      setTimer: function (fn, ms) {
        const id = nextId++;
        timers.set(id, { fn: fn, ms: ms, at: now });
        return id;
      },
      clearTimer: function (id) { timers.delete(id); },
      speak: function (text, lang, onend) {
        spoken.push({ text: text, lang: lang });
        pending = onend;
      },
    },
  );
  return {
    session: session,
    spoken: spoken,
    endSpeech: function () {
      const fn = pending;
      pending = null;
      if (fn) fn();
    },
    advance: function (ms) {
      now += ms;
      let guard = 0;
      while (guard++ < 200) {
        let dueId = null;
        for (const [id, timer] of timers) {
          if (now >= timer.at + timer.ms) {
            dueId = id;
            break;
          }
        }
        if (dueId == null) break;
        const timer = timers.get(dueId);
        timers.delete(dueId);
        timer.fn();
      }
    },
    pendingTimers: function () { return timers.size; },
  };
}

test('shuffled deck is a permutation of 1..75', function () {
  for (let seed = 1; seed <= 30; seed++) {
    const deck = Bingo.shuffledDeck(mulberry32(seed));
    const nums = Array.from(deck);
    assert.equal(nums.length, 75);
    assert.equal(new Set(nums).size, 75);
    assert.deepEqual(nums.slice().sort(function (a, b) { return a - b; }),
      Array.from({ length: 75 }, function (_, i) { return i + 1; }));
  }
});

test('column ranges cover B I N G O in blocks of 15', function () {
  const letters = ['B', 'I', 'N', 'G', 'O'];
  for (let n = 1; n <= 75; n++) {
    const column = Bingo.columnOf(n);
    const index = Math.floor((n - 1) / 15);
    assert.equal(column.letter, letters[index]);
    assert.equal(column.min, index * 15 + 1);
    assert.equal(column.max, index * 15 + 15);
    assert.ok(n >= column.min && n <= column.max);
  }
});

test('English and Cantonese utterances use full number words', function () {
  const cases = [
    [10, 'en', 'B, ten'],
    [11, 'en', 'B, eleven'],
    [12, 'en', 'B, twelve'],
    [13, 'en', 'B, thirteen'],
    [15, 'en', 'B, fifteen'],
    [19, 'en', 'I, nineteen'],
    [20, 'en', 'I, twenty'],
    [21, 'en', 'I, twenty-one'],
    [30, 'en', 'I, thirty'],
    [37, 'en', 'N, thirty-seven'],
    [70, 'en', 'O, seventy'],
    [75, 'en', 'O, seventy-five'],
    [10, 'yue', 'B，十'],
    [11, 'yue', 'B，十一'],
    [13, 'yue', 'B，十三'],
    [15, 'yue', 'B，十五'],
    [19, 'yue', 'I，十九'],
    [20, 'yue', 'I，二十'],
    [21, 'yue', 'I，二十一'],
    [37, 'yue', 'N，三十七'],
    [75, 'yue', 'O，七十五'],
  ];
  cases.forEach(function (row) {
    assert.equal(Bingo.utterance(row[0], row[1]), row[2]);
  });
  assert.equal(Bingo.utterance(37, 'en').includes('three seven'), false);
  assert.equal(Bingo.utterance(37, 'yue').includes('三七'), false);
  assert.equal(Bingo.utterance(13, 'en').includes('one three'), false);
});

test('language list is text badges EN and 粵, not flags', function () {
  assert.deepEqual(Array.from(Bingo.LANGUAGES, function (lang) { return lang.badge; }), ['EN', '粵']);
  assert.deepEqual(Array.from(Bingo.LANGUAGES, function (lang) { return lang.label; }), ['English', '粵語']);
  Bingo.LANGUAGES.forEach(function (lang) {
    assert.equal(/[\u{1F1E6}-\u{1F1FF}]/u.test(lang.badge + lang.label), false);
  });
  assert.deepEqual(Array.from(Bingo.THEMES, function (theme) { return theme.id; }), ['cream', 'ice', 'matcha', 'night']);
});

test('interval starts only after speech ends', function () {
  const h = harness();
  h.session.enterTable();
  assert.equal(h.spoken.length, 0);
  h.session.pressTransport();
  assert.equal(h.spoken.length, 1);
  assert.equal(h.pendingTimers(), 0);
  h.advance(30000);
  assert.equal(h.spoken.length, 1);
  h.endSpeech();
  assert.equal(h.pendingTimers(), 1);
  assert.equal(h.spoken.length, 1);
  h.advance(7999);
  assert.equal(h.spoken.length, 1);
  h.advance(1);
  assert.equal(h.spoken.length, 2);
});

test('a shorter gap during the wait calls the next ball once speech has ended', function () {
  const h = harness();
  h.session.enterTable();
  h.session.pressTransport();
  h.endSpeech();
  h.advance(5000);
  assert.equal(h.spoken.length, 1);
  h.session.setInterval(3);
  assert.equal(h.spoken.length, 2);
  assert.equal(h.session.getState().called.length, 2);
});

test('changing the gap during speech does not cut the utterance', function () {
  const h = harness();
  h.session.enterTable();
  h.session.pressTransport();
  const first = h.spoken[0].text;
  h.session.setInterval(1);
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].text, first);
  h.endSpeech();
  assert.equal(h.spoken.length, 1);
  h.advance(999);
  assert.equal(h.spoken.length, 1);
  h.advance(1);
  assert.equal(h.spoken.length, 2);
});

test('a language change re-reads the current ball and does not draw', function () {
  const h = harness();
  h.session.enterTable();
  h.session.pressTransport();
  const current = h.session.getState().current;
  h.session.setLanguage('yue');
  const state = h.session.getState();
  assert.equal(state.current, current);
  assert.equal(state.called.length, 1);
  assert.equal(state.language, 'yue');
  assert.equal(h.spoken.at(-1).text, Bingo.utterance(current, 'yue'));
  assert.equal(h.spoken.at(-1).lang, 'yue');
});

test('new game confirm clears the board and cancel keeps it', function () {
  const h = harness({ language: 'yue', theme: 'matcha', intervalSec: 12 });
  h.session.enterTable();
  h.session.pressTransport();
  h.endSpeech();
  const called = Array.from(h.session.getState().called);
  h.session.requestNewGame();
  assert.equal(h.session.getState().confirmNewGame, true);
  assert.deepEqual(Array.from(h.session.getState().called), called);
  h.session.cancelNewGame();
  assert.equal(h.session.getState().confirmNewGame, false);
  assert.deepEqual(Array.from(h.session.getState().called), called);
  assert.equal(h.session.getState().language, 'yue');
  h.session.requestNewGame();
  h.session.confirmNewGame();
  const next = h.session.getState();
  assert.equal(next.confirmNewGame, false);
  assert.deepEqual(Array.from(next.called), []);
  assert.equal(next.current, null);
  assert.equal(next.phase, 'idle');
  assert.equal(next.view, 'table');
  assert.equal(next.language, 'yue');
  assert.equal(next.theme, 'matcha');
  assert.equal(next.intervalSec, 12);
  assert.equal(next.replayEnabled, false);
});

test('idle has no current ball, the first call speaks, pause holds, and 75 ends the game', function () {
  const h = harness();
  h.session.enterTable();
  let state = h.session.getState();
  assert.equal(state.phase, 'idle');
  assert.equal(state.current, null);
  assert.equal(state.replayEnabled, false);
  h.session.replayCurrent();
  assert.equal(h.spoken.length, 0);

  h.session.pressTransport();
  state = h.session.getState();
  assert.equal(state.phase, 'calling');
  assert.equal(state.called.length, 1);
  assert.equal(state.replayEnabled, true);
  assert.equal(h.spoken[0].text, Bingo.utterance(state.current, 'en'));

  h.endSpeech();
  h.session.pressTransport();
  assert.equal(h.session.getState().phase, 'paused');
  h.advance(60000);
  assert.equal(h.session.getState().called.length, 1);

  h.session.pressTransport();
  assert.equal(h.session.getState().phase, 'calling');
  assert.equal(h.session.getState().called.length, 1);
  h.advance(8000);
  assert.equal(h.session.getState().called.length, 2);

  const previous = h.session.getState().previous;
  const current = h.session.getState().current;
  h.session.replayPrevious();
  assert.equal(h.spoken.at(-1).text, Bingo.utterance(previous, 'en'));
  assert.equal(h.session.getState().current, current);
  assert.equal(h.session.getState().called.length, 2);

  while (h.session.getState().phase !== 'done') {
    h.endSpeech();
    h.advance(8000);
  }
  state = h.session.getState();
  assert.equal(state.called.length, 75);
  assert.equal(new Set(state.called).size, 75);
  assert.equal(state.phase, 'done');
  const spokenAtEnd = h.spoken.length;
  h.endSpeech();
  h.advance(60000);
  assert.equal(h.spoken.length, spokenAtEnd);
  assert.equal(h.session.getState().called.length, 75);
});

test('trial listen does not start the game or select a ball', function () {
  const h = harness();
  h.session.trial('yue');
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].text, 'B，十二');
  assert.equal(h.session.getState().view, 'setup');
  assert.equal(h.session.getState().called.length, 0);
  assert.equal(h.session.getState().language, 'en');
});

test('interval clamps to 1..30', function () {
  assert.equal(Bingo.clampInterval(0), 1);
  assert.equal(Bingo.clampInterval(1), 1);
  assert.equal(Bingo.clampInterval(8), 8);
  assert.equal(Bingo.clampInterval(30), 30);
  assert.equal(Bingo.clampInterval(31), 30);
  assert.equal(Bingo.clampInterval(8.4), 8);
});

test('the remaining wait starts only after speech ends', function () {
  const h = harness();
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.session.enterTable();
  assert.equal(h.session.getState().phase, 'idle');
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.session.pressTransport();
  assert.equal(h.session.getState().phase, 'calling');
  assert.equal(h.spoken.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.advance(20000);
  assert.equal(h.spoken.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.endSpeech();
  assert.equal(h.session.getState().waitRemainingMs, 8000);
  h.advance(2500);
  assert.equal(h.spoken.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, 5500);
});

test('pause freezes the remaining wait and resume continues it', function () {
  const h = harness();
  h.session.enterTable();
  h.session.pressTransport();
  h.endSpeech();
  h.advance(3000);
  assert.equal(h.session.getState().waitRemainingMs, 5000);
  h.session.pressTransport();
  assert.equal(h.session.getState().phase, 'paused');
  assert.equal(h.session.getState().waitRemainingMs, 5000);
  h.advance(60000);
  assert.equal(h.session.getState().called.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, 5000);
  h.session.pressTransport();
  assert.equal(h.session.getState().phase, 'calling');
  assert.equal(h.session.getState().waitRemainingMs, 5000);
  h.advance(4999);
  assert.equal(h.session.getState().called.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, 1);
  h.advance(1);
  assert.equal(h.session.getState().called.length, 2);
  assert.equal(h.session.getState().waitRemainingMs, null);
});

test('a slider change during speech waits out the new gap and does not cut speech', function () {
  const h = harness();
  h.session.enterTable();
  h.session.pressTransport();
  const first = h.spoken[0].text;
  h.advance(5000);
  h.session.setInterval(4);
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].text, first);
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.endSpeech();
  assert.equal(h.spoken.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, 4000);
  h.advance(3999);
  assert.equal(h.spoken.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, 1);
  h.advance(1);
  assert.equal(h.spoken.length, 2);
});

test('a shorter gap chosen while a re-read is speaking calls the next ball when that speech ends', function () {
  const h = harness();
  h.session.enterTable();
  h.session.pressTransport();
  h.endSpeech();
  h.advance(5000);
  assert.equal(h.session.getState().waitRemainingMs, 3000);
  h.session.replayCurrent();
  assert.equal(h.spoken.length, 2);
  assert.equal(h.session.getState().called.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.advance(2000);
  h.session.setInterval(4);
  assert.equal(h.spoken.length, 2);
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.endSpeech();
  assert.equal(h.spoken.length, 3);
  assert.equal(h.session.getState().called.length, 2);
  assert.equal(h.session.getState().waitRemainingMs, null);
});

test('a slider change during the wait rewrites the countdown and fires if the new gap has elapsed', function () {
  const h = harness();
  h.session.enterTable();
  h.session.pressTransport();
  h.endSpeech();
  h.advance(2000);
  h.session.setInterval(12);
  assert.equal(h.spoken.length, 1);
  assert.equal(h.session.getState().waitRemainingMs, 10000);
  h.advance(3000);
  assert.equal(h.session.getState().waitRemainingMs, 7000);
  h.session.setInterval(4);
  assert.equal(h.spoken.length, 2);
  assert.equal(h.session.getState().called.length, 2);
  assert.equal(h.session.getState().waitRemainingMs, null);
});

test('there is no countdown on setup, while idle, or after the last ball', function () {
  const h = harness();
  h.session.trial('en');
  assert.equal(h.session.getState().view, 'setup');
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.endSpeech();
  h.advance(30000);
  assert.equal(h.session.getState().waitRemainingMs, null);
  assert.equal(h.spoken.length, 1);

  h.session.enterTable();
  assert.equal(h.session.getState().phase, 'idle');
  assert.equal(h.session.getState().waitRemainingMs, null);

  h.session.pressTransport();
  while (h.session.getState().phase !== 'done') {
    h.endSpeech();
    h.advance(8000);
  }
  assert.equal(h.session.getState().called.length, 75);
  assert.equal(h.session.getState().waitRemainingMs, null);
  h.endSpeech();
  h.advance(60000);
  assert.equal(h.session.getState().called.length, 75);
  assert.equal(h.session.getState().waitRemainingMs, null);
  assert.equal(h.pendingTimers(), 0);
});
