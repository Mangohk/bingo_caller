(function () {
  var PREFS_KEY = 'bingo-caller-prefs';
  var COPY = {
    en: {
      start: 'Start',
      play: 'Play',
      pause: 'Pause',
      resume: 'Resume',
      newGame: 'New game',
      readAgain: 'Read again',
      readPrevious: 'Read previous ball',
      settings: 'Settings',
      language: 'Language',
      close: 'Close',
      preview: 'Preview',
      interval: 'Seconds between calls',
      confirm: 'Confirm',
      cancel: 'Cancel',
      wake: 'Turn off Auto-Lock so the screen stays on.',
      theme: 'Theme',
      finished: 'All 75 balls called',
    },
    yue: {
      start: '開始',
      play: '開始叫號',
      pause: '暫停',
      resume: '繼續',
      newGame: '新一局',
      readAgain: '再讀一次',
      readPrevious: '再讀上一粒',
      settings: '設定',
      language: '語言',
      close: '關閉',
      preview: '試聽',
      interval: '叫號間距',
      confirm: '確定',
      cancel: '取消',
      wake: '請關掉自動鎖定，畫面先唔會熄。',
      theme: '外觀',
      finished: '75 粒叫完',
    },
  };

  var session = null;
  var wakeSentinel = null;
  var wakePending = false;
  var wakeNoted = false;
  var audioPrimed = false;
  var lastBall = null;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var langDialog = document.getElementById('lang-dialog');
  var settingsDialog = document.getElementById('settings-dialog');
  var confirmDialog = document.getElementById('confirm-dialog');

  function text(lang) {
    return lang === 'en' ? COPY.en : COPY.yue;
  }

  function loadPrefs() {
    var raw = {};
    try {
      raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
    } catch (e) {
      raw = {};
    }
    var theme = 'cream';
    BingoDomain.THEMES.forEach(function (item) {
      if (item.id === raw.theme) theme = item.id;
    });
    return {
      language: raw.language === 'en' ? 'en' : 'yue',
      theme: theme,
      intervalSec: BingoDomain.clampInterval(raw.intervalSec == null ? 8 : raw.intervalSec),
    };
  }

  function savePrefs(state) {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      language: state.language,
      theme: state.theme,
      intervalSec: state.intervalSec,
    }));
  }

  function svgCheck() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'check');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 12.5l5 5L19 7');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function svgSpeaker() {
    var wrap = document.createElement('span');
    wrap.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9.5a4 4 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/></svg>';
    return wrap.firstChild;
  }

  function buildLangList(root) {
    BingoDomain.LANGUAGES.forEach(function (lang) {
      var row = document.createElement('div');
      row.className = 'lang-row';
      row.dataset.lang = lang.id;
      row.setAttribute('role', 'listitem');
      var pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'lang-pick';
      var badge = document.createElement('span');
      badge.className = 'lang-badge';
      badge.textContent = lang.badge;
      var name = document.createElement('span');
      name.className = 'lang-name';
      name.textContent = lang.label;
      pick.appendChild(badge);
      pick.appendChild(name);
      var trial = document.createElement('button');
      trial.type = 'button';
      trial.className = 'try-icon';
      trial.setAttribute('aria-label', (lang.id === 'en' ? COPY.en.preview : COPY.yue.preview) + ' ' + lang.label);
      trial.appendChild(svgSpeaker());
      row.appendChild(pick);
      row.appendChild(svgCheck());
      row.appendChild(trial);
      root.appendChild(row);
    });
  }

  function buildThemes(root) {
    BingoDomain.THEMES.forEach(function (theme) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-option';
      button.dataset.themeId = theme.id;
      button.setAttribute('aria-pressed', 'false');
      var swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.dataset.swatch = theme.id;
      swatch.setAttribute('aria-hidden', 'true');
      button.appendChild(swatch);
      button.appendChild(document.createTextNode(theme.label));
      root.appendChild(button);
    });
  }

  function buildBoard() {
    var board = document.getElementById('board');
    BingoDomain.COLUMNS.forEach(function (column) {
      var col = document.createElement('div');
      col.className = 'col';
      var head = document.createElement('div');
      head.className = 'col-h';
      head.dataset.col = column.letter;
      head.textContent = column.letter;
      col.appendChild(head);
      var n;
      for (n = column.min; n <= column.max; n++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.n = String(n);
        cell.dataset.col = column.letter;
        cell.textContent = String(n);
        col.appendChild(cell);
      }
      board.appendChild(col);
    });
  }

  // Prefer a zh-HK voice for Cantonese. If the device has none, use a voice
  // whose name says Cantonese, then any Chinese voice. The utterance text
  // stays the Cantonese numeral in every case.
  function pickVoice(lang) {
    var synth = window.speechSynthesis;
    if (!synth || typeof synth.getVoices !== 'function') return null;
    var voices = synth.getVoices() || [];
    var i;
    if (lang === 'yue') {
      for (i = 0; i < voices.length; i++) if (/^zh-HK/i.test(voices[i].lang)) return voices[i];
      for (i = 0; i < voices.length; i++) {
        if (/yue|canton/i.test(voices[i].lang + ' ' + voices[i].name)) return voices[i];
      }
      for (i = 0; i < voices.length; i++) if (/^zh/i.test(voices[i].lang)) return voices[i];
      return null;
    }
    for (i = 0; i < voices.length; i++) if (/^en-US/i.test(voices[i].lang)) return voices[i];
    for (i = 0; i < voices.length; i++) if (/^en/i.test(voices[i].lang)) return voices[i];
    return null;
  }

  function unlockAudio() {
    var synth = window.speechSynthesis;
    if (!synth) return;
    try { synth.resume(); } catch (e) {}
    if (audioPrimed) return;
    audioPrimed = true;
    var blip = new SpeechSynthesisUtterance(' ');
    blip.volume = 0;
    blip.lang = 'en-US';
    try { synth.speak(blip); } catch (e) {}
  }

  function speak(utteranceText, lang, onend) {
    var synth = window.speechSynthesis;
    if (!synth) {
      onend();
      return;
    }
    var utterance = new SpeechSynthesisUtterance(utteranceText);
    utterance.lang = lang === 'yue' ? 'zh-HK' : 'en-US';
    utterance.volume = 1;
    utterance.rate = 0.95;
    var voice = pickVoice(lang);
    if (voice) {
      try { utterance.voice = voice; } catch (e) {}
    }
    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      onend();
    }
    utterance.onend = done;
    utterance.onerror = done;
    function start() {
      try {
        synth.resume();
        synth.speak(utterance);
      } catch (e) {
        done();
      }
    }
    if (synth.speaking || synth.pending) {
      // Chromium drops an utterance spoken in the same turn as cancel().
      synth.cancel();
      setTimeout(start, 50);
    } else {
      start();
    }
  }

  function showWake(id) {
    wakeNoted = true;
    var el = document.getElementById(id);
    el.hidden = false;
    el.textContent = text(session.getState().language).wake;
  }

  function syncWake(state) {
    var need = state.view === 'table' && (state.phase === 'calling' || state.phase === 'paused');
    if (!need) {
      if (wakeSentinel) {
        var held = wakeSentinel;
        wakeSentinel = null;
        Promise.resolve(held.release()).catch(function () {});
      }
      return;
    }
    if (wakeSentinel || wakePending) return;
    if (!('wakeLock' in navigator) || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      showWake('setup-wake');
      showWake('table-wake');
      return;
    }
    wakePending = true;
    navigator.wakeLock.request('screen').then(function (sentinel) {
      wakePending = false;
      if (session.getState().phase !== 'calling' && session.getState().phase !== 'paused') {
        Promise.resolve(sentinel.release()).catch(function () {});
        return;
      }
      wakeSentinel = sentinel;
      sentinel.addEventListener('release', function () {
        if (wakeSentinel === sentinel) wakeSentinel = null;
      });
    }).catch(function () {
      wakePending = false;
      wakeSentinel = null;
      showWake('table-wake');
    });
  }

  function paint(state) {
    var labels = text(state.language);
    document.documentElement.lang = state.language === 'en' ? 'en' : 'zh-HK';
    document.documentElement.dataset.theme = state.theme;
    document.getElementById('setup').hidden = state.view !== 'setup';
    document.getElementById('table').hidden = state.view !== 'table';

    document.querySelectorAll('.lang-row').forEach(function (row) {
      var on = row.dataset.lang === state.language;
      row.classList.toggle('on', on);
      row.querySelector('.lang-pick').setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var langMeta = BingoDomain.LANGUAGES.filter(function (item) { return item.id === state.language; })[0];
    document.querySelector('#lang-chip .lang-name').textContent = langMeta.label;
    document.getElementById('lang-chip').setAttribute('aria-label', labels.language + ', ' + langMeta.label);
    document.getElementById('settings-open').setAttribute('aria-label', labels.settings);
    document.getElementById('settings-title').textContent = labels.settings;
    document.getElementById('settings-close').setAttribute('aria-label', labels.close);
    document.getElementById('settings-new').textContent = labels.newGame;
    document.getElementById('confirm-cancel').textContent = labels.cancel;
    document.getElementById('confirm-ok').textContent = labels.confirm;
    document.getElementById('setup-play').setAttribute('aria-label', labels.start);
    document.querySelectorAll('.theme-row').forEach(function (group) {
      group.setAttribute('aria-label', labels.theme);
    });
    document.querySelectorAll('.theme-option').forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.themeId === state.theme ? 'true' : 'false');
    });
    if (wakeNoted) {
      document.querySelectorAll('.wake-hint').forEach(function (el) {
        if (!el.hidden) el.textContent = labels.wake;
      });
    }

    document.querySelectorAll('input[type="range"]').forEach(function (input) {
      if (document.activeElement !== input) input.value = String(state.intervalSec);
      input.style.setProperty('--pct', ((state.intervalSec - 1) / 29 * 100) + '%');
      input.setAttribute('aria-label', labels.interval);
      input.setAttribute('aria-valuetext', String(state.intervalSec));
    });
    document.querySelectorAll('[data-interval-val]').forEach(function (el) {
      el.textContent = String(state.intervalSec);
    });

    paintHero(state, labels);
    paintTransport(state, labels);
    paintBoard(state);
    if (state.confirmNewGame && !confirmDialog.open) confirmDialog.showModal();
    if (!state.confirmNewGame && confirmDialog.open) confirmDialog.close();
  }

  function paintHero(state, labels) {
    var hero = document.getElementById('hero');
    var band = hero.querySelector('.band');
    var num = hero.querySelector('.num');
    var status = document.getElementById('hero-status');
    if (!state.current) {
      hero.classList.add('placeholder');
      hero.classList.remove('is-current', 'is-done', 'pop');
      delete hero.dataset.col;
      band.textContent = '';
      num.textContent = '';
      hero.setAttribute('aria-hidden', 'true');
      hero.removeAttribute('aria-label');
      status.hidden = true;
      lastBall = null;
    } else {
      var column = BingoDomain.columnOf(state.current);
      var label = column.letter + ' ' + state.current;
      var fresh = lastBall !== state.current;
      hero.classList.remove('placeholder');
      hero.classList.add('is-current');
      hero.classList.toggle('is-done', state.phase === 'done');
      hero.dataset.col = column.letter;
      band.textContent = column.letter;
      num.textContent = String(state.current);
      hero.removeAttribute('aria-hidden');
      if (hero.getAttribute('aria-label') !== label) hero.setAttribute('aria-label', label);
      if (state.phase === 'done') {
        status.hidden = false;
        status.textContent = labels.finished;
      } else {
        status.hidden = true;
      }
      if (fresh && !reduceMotion) {
        hero.classList.remove('pop');
        void hero.offsetWidth;
        hero.classList.add('pop');
      }
      lastBall = state.current;
    }
    var prev = document.getElementById('prev-ball');
    if (!state.previous) {
      prev.hidden = true;
    } else {
      var previousColumn = BingoDomain.columnOf(state.previous);
      prev.hidden = false;
      prev.dataset.col = previousColumn.letter;
      prev.querySelector('.band').textContent = previousColumn.letter;
      prev.querySelector('.num').textContent = String(state.previous);
      prev.setAttribute('aria-label', labels.readPrevious);
    }
  }

  function showIcon(icon, on) {
    if (on) icon.removeAttribute('hidden');
    else icon.setAttribute('hidden', '');
  }

  function paintTransport(state, labels) {
    var button = document.getElementById('transport');
    var mode = 'play';
    var label = state.called.length ? labels.resume : labels.play;
    if (state.phase === 'calling') {
      mode = 'pause';
      label = labels.pause;
    } else if (state.phase === 'done') {
      mode = 'new';
      label = labels.newGame;
    }
    button.dataset.mode = mode;
    button.setAttribute('aria-label', label);
    button.querySelector('.transport-label').textContent = labels.newGame;
    showIcon(button.querySelector('.icon-play'), mode === 'play');
    showIcon(button.querySelector('.icon-pause'), mode === 'pause');
    showIcon(button.querySelector('.icon-new'), mode === 'new');
    var replay = document.getElementById('replay');
    replay.disabled = !state.replayEnabled;
    replay.setAttribute('aria-label', labels.readAgain);
    document.getElementById('progress').textContent = state.called.length + '／75';
  }

  function paintBoard(state) {
    var called = {};
    state.called.forEach(function (n) { called[n] = true; });
    document.querySelectorAll('#board .cell').forEach(function (cell) {
      var n = Number(cell.dataset.n);
      var isNow = n === state.current;
      cell.classList.toggle('called', !!called[n]);
      cell.classList.toggle('now', isNow);
      if (isNow) cell.setAttribute('aria-current', 'true');
      else cell.removeAttribute('aria-current');
      if (isNow && cell.dataset.popped !== String(n) && !reduceMotion) {
        cell.dataset.popped = String(n);
        cell.classList.remove('pop');
        void cell.offsetWidth;
        cell.classList.add('pop');
      }
      if (!state.current) delete cell.dataset.popped;
    });
  }

  function chooseLang(id) {
    session.setLanguage(id);
    savePrefs(session.getState());
    if (langDialog.open) langDialog.close();
  }

  function bind() {
    document.body.addEventListener('click', function (event) {
      var trial = event.target.closest('.try-icon');
      if (trial) {
        unlockAudio();
        session.trial(trial.closest('.lang-row').dataset.lang);
        return;
      }
      var pick = event.target.closest('.lang-pick');
      if (pick) {
        chooseLang(pick.closest('.lang-row').dataset.lang);
        return;
      }
      var theme = event.target.closest('.theme-option');
      if (theme) {
        session.setTheme(theme.dataset.themeId);
        savePrefs(session.getState());
      }
    });

    document.querySelectorAll('input[type="range"]').forEach(function (input) {
      input.addEventListener('input', function () {
        session.setInterval(Number(input.value));
        savePrefs(session.getState());
      });
    });

    document.getElementById('setup-play').addEventListener('click', function () {
      unlockAudio();
      session.enterTable();
    });
    document.getElementById('transport').addEventListener('click', function () {
      unlockAudio();
      session.pressTransport();
    });
    document.getElementById('replay').addEventListener('click', function () {
      session.replayCurrent();
    });
    document.getElementById('prev-ball').addEventListener('click', function () {
      session.replayPrevious();
    });
    document.getElementById('lang-chip').addEventListener('click', function () {
      langDialog.showModal();
    });
    document.getElementById('settings-open').addEventListener('click', function () {
      settingsDialog.showModal();
    });
    document.getElementById('settings-close').addEventListener('click', function () {
      settingsDialog.close();
    });
    document.getElementById('settings-new').addEventListener('click', function () {
      settingsDialog.close();
      session.requestNewGame();
    });
    document.getElementById('confirm-cancel').addEventListener('click', function () {
      session.cancelNewGame();
    });
    document.getElementById('confirm-ok').addEventListener('click', function () {
      session.confirmNewGame();
    });
    confirmDialog.addEventListener('close', function () {
      if (session.getState().confirmNewGame) session.cancelNewGame();
    });
    [langDialog, settingsDialog, confirmDialog].forEach(function (dialog) {
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) dialog.close();
      });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') syncWake(session.getState());
    });
    window.addEventListener('pagehide', function () {
      if (wakeSentinel) {
        Promise.resolve(wakeSentinel.release()).catch(function () {});
        wakeSentinel = null;
      }
    });
  }

  buildBoard();
  ['setup-langs', 'sheet-langs', 'settings-langs'].forEach(function (id) {
    buildLangList(document.getElementById(id));
  });
  ['setup-themes', 'settings-themes'].forEach(function (id) {
    buildThemes(document.getElementById(id));
  });
  var prefs = loadPrefs();
  session = BingoDomain.createSession(prefs, {
    now: function () { return Date.now(); },
    setTimer: function (fn, ms) { return window.setTimeout(fn, ms); },
    clearTimer: function (id) { window.clearTimeout(id); },
    speak: speak,
    onChange: function (state) {
      paint(state);
      syncWake(state);
    },
  });
  bind();
  paint(session.getState());
  if (!('wakeLock' in navigator) || !navigator.wakeLock) showWake('setup-wake');
})();
