var BingoDomain = (function () {
  var COLUMNS = [
    { letter: 'B', min: 1, max: 15 },
    { letter: 'I', min: 16, max: 30 },
    { letter: 'N', min: 31, max: 45 },
    { letter: 'G', min: 46, max: 60 },
    { letter: 'O', min: 61, max: 75 },
  ];

  var LANGUAGES = [
    { id: 'en', badge: 'EN', label: 'English', voiceLang: 'en-US' },
    { id: 'yue', badge: '粵', label: '粵語', voiceLang: 'zh-HK' },
  ];

  var THEMES = [
    { id: 'cream', label: '奶油叫號廳' },
    { id: 'ice', label: '冰室藍' },
    { id: 'matcha', label: '抹茶紙' },
    { id: 'night', label: '夜廳毡' },
  ];

  var EN_UNDER_TWENTY = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen',
  ];
  var EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy'];
  var YUE_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function columnOf(n) {
    var index = Math.floor((n - 1) / 15);
    if (index < 0 || index > 4) throw new Error('ball out of range');
    return COLUMNS[index];
  }

  function englishNumber(n) {
    if (n < 20) return EN_UNDER_TWENTY[n];
    var tens = Math.floor(n / 10);
    var ones = n % 10;
    if (ones === 0) return EN_TENS[tens];
    return EN_TENS[tens] + '-' + EN_UNDER_TWENTY[ones];
  }

  function cantoneseNumber(n) {
    if (n < 10) return YUE_DIGIT[n];
    if (n === 10) return '十';
    if (n < 20) return '十' + YUE_DIGIT[n - 10];
    var tens = Math.floor(n / 10);
    var ones = n % 10;
    return YUE_DIGIT[tens] + '十' + (ones ? YUE_DIGIT[ones] : '');
  }

  function utterance(n, lang) {
    var letter = columnOf(n).letter;
    if (lang === 'yue') return letter + '，' + cantoneseNumber(n);
    return letter + ', ' + englishNumber(n);
  }

  function shuffledDeck(random) {
    var roll = random || Math.random;
    var deck = [];
    var i;
    for (i = 1; i <= 75; i++) deck.push(i);
    for (i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(roll() * (i + 1));
      var tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  function clampInterval(sec) {
    var n = Math.round(Number(sec));
    if (!Number.isFinite(n)) return 8;
    if (n < 1) return 1;
    if (n > 30) return 30;
    return n;
  }

  function createSession(prefs, deps) {
    var random = (deps && deps.random) || Math.random;
    var state = {
      view: 'setup',
      phase: 'idle',
      language: prefs && prefs.language === 'en' ? 'en' : 'yue',
      theme: prefs && prefs.theme ? prefs.theme : 'cream',
      intervalSec: clampInterval(prefs && prefs.intervalSec != null ? prefs.intervalSec : 8),
      order: shuffledDeck(random),
      called: [],
      confirmNewGame: false,
    };
    var timer = null;
    var speaking = false;
    var speechGen = 0;
    // Gap clock for the ball on screen. It opens when that ball's utterance
    // ends. Pause and a later re-read freeze it; drawing a new ball resets it.
    var gapOpen = false;
    var elapsedMs = 0;
    var runningSince = null;

    function clearTimer() {
      if (timer != null) {
        deps.clearTimer(timer);
        timer = null;
      }
    }

    function elapsedNow() {
      if (runningSince == null) return elapsedMs;
      return elapsedMs + (deps.now() - runningSince);
    }

    function waitRemainingMs() {
      if (state.view !== 'table') return null;
      if (speaking) return null;
      if (state.confirmNewGame) return null;
      if (state.phase !== 'calling' && state.phase !== 'paused') return null;
      if (!gapOpen) return null;
      if (!state.order.length) return null;
      var remain = state.intervalSec * 1000 - elapsedNow();
      if (remain <= 0) return 0;
      return remain;
    }

    function resetWait() {
      gapOpen = false;
      elapsedMs = 0;
      runningSince = null;
    }

    function pauseWaitClock() {
      if (runningSince == null) return;
      elapsedMs += deps.now() - runningSince;
      runningSince = null;
    }

    function startWaitClock() {
      if (runningSince == null) runningSince = deps.now();
    }

    function openGap() {
      if (gapOpen) return;
      gapOpen = true;
      elapsedMs = 0;
      runningSince = null;
    }

    function snapshot() {
      var called = state.called;
      var current = called.length ? called[called.length - 1] : null;
      var previous = called.length > 1 ? called[called.length - 2] : null;
      return {
        view: state.view,
        phase: state.phase,
        language: state.language,
        theme: state.theme,
        intervalSec: state.intervalSec,
        called: called.slice(),
        current: current,
        previous: previous,
        confirmNewGame: state.confirmNewGame,
        replayEnabled: current != null,
        speaking: speaking,
        waitRemainingMs: waitRemainingMs(),
      };
    }

    function emit() {
      if (deps.onChange) deps.onChange(snapshot());
    }

    function armGap() {
      clearTimer();
      if (state.phase !== 'calling') return false;
      if (state.confirmNewGame) return false;
      if (speaking) return false;
      if (!gapOpen) return false;
      if (!state.order.length) return false;
      var remain = state.intervalSec * 1000 - elapsedNow();
      if (remain <= 0) {
        draw();
        return true;
      }
      timer = deps.setTimer(function () {
        timer = null;
        draw();
      }, remain);
      return false;
    }

    function speakText(text, lang) {
      speaking = true;
      pauseWaitClock();
      clearTimer();
      var gen = ++speechGen;
      emit();
      deps.speak(text, lang, function () {
        if (gen !== speechGen) return;
        speaking = false;
        var track = state.view === 'table'
          && !state.confirmNewGame
          && (state.phase === 'calling' || state.phase === 'paused')
          && state.order.length;
        if (track) openGap();
        var drew = false;
        if (track && state.phase === 'calling') {
          startWaitClock();
          drew = armGap();
        }
        if (!drew) emit();
      });
    }

    function draw() {
      if (state.phase !== 'calling') return;
      if (speaking) return;
      if (state.confirmNewGame) return;
      if (!state.order.length) {
        state.phase = 'done';
        resetWait();
        emit();
        return;
      }
      var n = state.order[0];
      state.order = state.order.slice(1);
      state.called = state.called.concat([n]);
      if (state.called.length === 75) state.phase = 'done';
      resetWait();
      speakText(utterance(n, state.language), state.language);
    }

    function confirmNewGame() {
      clearTimer();
      speechGen += 1;
      speaking = false;
      resetWait();
      state.view = 'table';
      state.phase = 'idle';
      state.order = shuffledDeck(random);
      state.called = [];
      state.confirmNewGame = false;
      emit();
      return snapshot();
    }

    function requestNewGame() {
      if (!state.called.length) return confirmNewGame();
      state.confirmNewGame = true;
      clearTimer();
      pauseWaitClock();
      resetWait();
      emit();
      return snapshot();
    }

    function cancelNewGame() {
      if (!state.confirmNewGame) return snapshot();
      state.confirmNewGame = false;
      if (!speaking && state.phase === 'calling') {
        openGap();
        elapsedMs = 0;
        runningSince = null;
        startWaitClock();
        var drew = armGap();
        if (!drew) emit();
      } else {
        emit();
      }
      return snapshot();
    }

    return {
      getState: snapshot,
      enterTable: function () {
        if (state.view !== 'setup') return snapshot();
        state.view = 'table';
        state.phase = 'idle';
        emit();
        return snapshot();
      },
      pressTransport: function () {
        if (state.view !== 'table') return snapshot();
        if (state.phase === 'idle') {
          state.phase = 'calling';
          emit();
          draw();
        } else if (state.phase === 'calling') {
          state.phase = 'paused';
          pauseWaitClock();
          clearTimer();
          emit();
        } else if (state.phase === 'paused') {
          state.phase = 'calling';
          if (!speaking) {
            if (!gapOpen) openGap();
            startWaitClock();
            var drew = armGap();
            if (!drew) emit();
          } else {
            emit();
          }
        } else if (state.phase === 'done') {
          return requestNewGame();
        }
        return snapshot();
      },
      setInterval: function (sec) {
        state.intervalSec = clampInterval(sec);
        if (!speaking && state.phase === 'calling' && !state.confirmNewGame && gapOpen) {
          var drew = armGap();
          if (!drew) emit();
        } else {
          emit();
        }
        return snapshot();
      },
      setLanguage: function (id) {
        if (id !== 'en' && id !== 'yue') return snapshot();
        if (id === state.language) return snapshot();
        state.language = id;
        if (state.view === 'table' && state.called.length) {
          var current = state.called[state.called.length - 1];
          speakText(utterance(current, id), id);
        } else {
          emit();
        }
        return snapshot();
      },
      setTheme: function (id) {
        state.theme = id;
        emit();
        return snapshot();
      },
      replayCurrent: function () {
        if (!state.called.length) return snapshot();
        var n = state.called[state.called.length - 1];
        speakText(utterance(n, state.language), state.language);
        return snapshot();
      },
      replayPrevious: function () {
        if (state.called.length < 2) return snapshot();
        var n = state.called[state.called.length - 2];
        speakText(utterance(n, state.language), state.language);
        return snapshot();
      },
      requestNewGame: requestNewGame,
      cancelNewGame: cancelNewGame,
      confirmNewGame: confirmNewGame,
      trial: function (lang) {
        var id = lang === 'en' ? 'en' : 'yue';
        speakText(utterance(12, id), id);
        return snapshot();
      },
    };
  }

  return {
    COLUMNS: COLUMNS,
    LANGUAGES: LANGUAGES,
    THEMES: THEMES,
    columnOf: columnOf,
    utterance: utterance,
    shuffledDeck: shuffledDeck,
    clampInterval: clampInterval,
    createSession: createSession,
  };
})();
