import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ARTIFACTS = '/opt/cursor/artifacts/bingo';

function installMocks() {
  window.__spoken = [];
  window.__locks = { acquires: 0, releases: 0 };
  let last = null;
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices() {
      return [
        { lang: 'en-US', name: 'Samantha' },
        { lang: 'zh-HK', name: 'Sinji' },
      ];
    },
    speak(utterance) {
      window.__spoken.push({
        text: utterance.text,
        lang: utterance.lang,
        volume: utterance.volume,
      });
      if (utterance.volume === 0) {
        if (typeof utterance.onend === 'function') utterance.onend();
        return;
      }
      last = utterance;
      this.speaking = true;
    },
    cancel() {
      this.speaking = false;
      this.pending = false;
      last = null;
    },
    resume() {},
    addEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: synth,
  });
  window.__endSpeech = function () {
    const utterance = last;
    last = null;
    synth.speaking = false;
    if (utterance && typeof utterance.onend === 'function') utterance.onend();
  };
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      async request() {
        window.__locks.acquires += 1;
        let released = false;
        return {
          addEventListener() {},
          async release() {
            if (released) return;
            released = true;
            window.__locks.releases += 1;
          },
        };
      },
    },
  });
}

async function audible(page) {
  return page.evaluate(() => window.__spoken.filter((item) => item.volume !== 0).map((item) => item.text));
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((el, next) => {
    el.value = String(next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function hero(page) {
  return page.evaluate(() => ({
    letter: document.querySelector('#hero .band').textContent,
    number: document.querySelector('#hero .num').textContent,
  }));
}

async function ringRemain(page) {
  return page.locator('#wait-ring').evaluate((el) => Number(el.style.getPropertyValue('--remain')));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installMocks);
});

test('language list uses text badges and does not speak before a gesture', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');
  expect(await page.evaluate(() => window.__spoken.length)).toBe(0);
  await expect(page.locator('#setup-langs .lang-badge')).toHaveText(['EN', '粵']);
  await expect(page.locator('#setup-langs .lang-name')).toHaveText(['English', '粵語']);
  await expect(page.locator('.lang-list img')).toHaveCount(0);
  const listText = (await page.locator('.lang-list').allInnerTexts()).join('\n');
  expect(listText).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);

  await page.locator('#setup-langs .try-icon').first().click();
  expect(await audible(page)).toEqual(['B, twelve']);
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#table')).toBeHidden();
  await expect(page.locator('#setup-langs .lang-row.on .lang-name')).toHaveText('粵語');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, 'setup-portrait.png'), fullPage: true });
});

test('setup play opens a quiet table, then play, pause, re-read, language, slider, and new game', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');

  await page.locator('#setup-play').click();
  await expect(page.locator('#table')).toBeVisible();
  await expect(page.locator('#progress')).toHaveText('0／75');
  await expect(page.locator('#replay')).toBeDisabled();
  await expect(page.locator('#hero')).toHaveClass(/placeholder/);
  expect(await audible(page)).toEqual([]);
  await expect(page.locator('#lang-chip .lang-badge')).toHaveText('粵');
  await expect(page.locator('#lang-chip .lang-name')).toHaveText('粵語');
  expect(await page.locator('#lang-chip').evaluate((el) => {
    const badge = el.querySelector('.lang-badge');
    const name = el.querySelector('.lang-name');
    return Boolean(badge && name && (badge.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);

  await page.locator('#transport').click();
  await expect(page.locator('#replay')).toBeEnabled();
  await expect(page.locator('#progress')).toHaveText('1／75');
  const first = await hero(page);
  const firstUtterance = await page.evaluate((n) => BingoDomain.utterance(Number(n), 'yue'), first.number);
  expect(await audible(page)).toEqual([firstUtterance]);
  expect(first.letter + first.number).not.toMatch(/三十|thirty/);
  await expect(page.locator('#board .cell.now')).toHaveText(first.number);
  await expect(page.locator('#board button')).toHaveCount(0);
  const progress = await page.locator('#progress').innerText();
  await page.locator('#board .cell[data-n="1"]').click();
  await expect(page.locator('#progress')).toHaveText(progress);

  await page.locator('#transport').click();
  await page.evaluate(() => window.__endSpeech());
  await page.clock.runFor(30000);
  await expect(page.locator('#progress')).toHaveText('1／75');
  expect((await page.evaluate(() => window.__locks.acquires)) >= 1).toBe(true);
  expect(await page.evaluate(() => window.__locks.releases)).toBe(0);

  await page.locator('#replay').click();
  await page.clock.runFor(80);
  expect((await audible(page)).at(-1)).toBe(firstUtterance);
  await expect(page.locator('#hero .num')).toHaveText(first.number);
  await page.evaluate(() => window.__endSpeech());

  await page.locator('#transport').click();
  await page.clock.runFor(8000);
  await expect(page.locator('#progress')).toHaveText('2／75');
  const second = await hero(page);
  expect(second.number).not.toBe(first.number);
  await page.locator('#prev-ball').click();
  await page.clock.runFor(80);
  expect((await audible(page)).at(-1)).toBe(firstUtterance);
  await expect(page.locator('#hero .num')).toHaveText(second.number);
  await expect(page.locator('#progress')).toHaveText('2／75');

  const beforeSwitch = (await audible(page)).length;
  await page.locator('#lang-chip').click();
  await expect(page.locator('#sheet-langs .lang-badge')).toHaveText(['EN', '粵']);
  await expect(page.locator('#sheet-langs .lang-name')).toHaveText(['English', '粵語']);
  await page.locator('#sheet-langs .lang-pick').filter({ hasText: 'English' }).click();
  await page.clock.runFor(80);
  const english = await page.evaluate((n) => BingoDomain.utterance(Number(n), 'en'), second.number);
  expect((await audible(page)).at(-1)).toBe(english);
  expect((await audible(page)).length).toBe(beforeSwitch + 1);
  await expect(page.locator('#hero .num')).toHaveText(second.number);
  await expect(page.locator('#lang-chip .lang-badge')).toHaveText('EN');
  await expect(page.locator('#lang-chip .lang-name')).toHaveText('English');
  await expect(page.locator('#progress')).toHaveText('2／75');

  const duringSpeech = (await audible(page)).length;
  await setRange(page, '#table-interval', 1);
  await page.clock.runFor(500);
  expect(await audible(page)).toHaveLength(duringSpeech);
  await page.evaluate(() => window.__endSpeech());
  await page.clock.runFor(999);
  expect(await audible(page)).toHaveLength(duringSpeech);
  await page.clock.runFor(1);
  expect((await audible(page)).length).toBe(duringSpeech + 1);
  await expect(page.locator('#progress')).toHaveText('3／75');
  const third = await page.locator('#hero .num').innerText();

  await page.evaluate(() => history.pushState({ bingo: 1 }, ''));
  await page.goBack();
  await expect(page.locator('#hero .num')).toHaveText(third);
  await expect(page.locator('#progress')).toHaveText('3／75');

  await page.locator('#settings-open').click();
  await page.locator('#settings-new').click();
  await expect(page.locator('#confirm-text')).toHaveText('已叫的數會清零');
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#hero .num')).toHaveText(third);
  await expect(page.locator('#progress')).toHaveText('3／75');
  await expect(page.locator('#lang-chip .lang-name')).toHaveText('English');

  await page.locator('#settings-open').click();
  await page.locator('#settings-new').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#progress')).toHaveText('0／75');
  await expect(page.locator('#replay')).toBeDisabled();
  await expect(page.locator('#hero')).toHaveClass(/placeholder/);
  await expect(page.locator('#lang-chip .lang-badge')).toHaveText('EN');
  await expect(page.locator('#lang-chip .lang-name')).toHaveText('English');
  await expect(page.locator('#table')).toBeVisible();
  await page.locator('#settings-open').click();
  await page.locator('#settings-langs .lang-pick').filter({ hasText: '粵語' }).click();
  await expect(page.locator('#lang-chip .lang-badge')).toHaveText('粵');
  await expect(page.locator('#lang-chip .lang-name')).toHaveText('粵語');
  await page.locator('#settings-close').click();

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, 'portrait-ready.png'), fullPage: true });
});

test('calling screen keeps a large hero in portrait and splits the board in landscape', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');
  await page.locator('#setup-play').click();
  await page.locator('#transport').click();
  await expect(page.locator('#transport .icon-pause')).toBeVisible();
  await expect(page.locator('#transport .icon-play')).toBeHidden();
  const portraitHero = await page.locator('#hero').boundingBox();
  expect(portraitHero.width).toBeGreaterThanOrEqual(240);
  const called = page.locator('#board .cell.called').first();
  const uncalled = page.locator('#board .cell:not(.called)').first();
  expect(Number(await called.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700);
  expect(Number(await uncalled.evaluate((el) => getComputedStyle(el).fontWeight))).toBeLessThanOrEqual(500);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, 'portrait-play.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneHero = await page.locator('#hero').boundingBox();
  expect(phoneHero.width).toBeGreaterThanOrEqual(160);
  expect(phoneHero.width).toBeLessThanOrEqual(210);

  await page.setViewportSize({ width: 1194, height: 834 });
  const heroBox = await page.locator('#hero').boundingBox();
  const boardBox = await page.locator('#board').boundingBox();
  expect(heroBox.x).toBeLessThan(boardBox.x);
  expect(boardBox.width).toBeGreaterThan(heroBox.width);
  expect(heroBox.width).toBeGreaterThanOrEqual(160);
  await page.screenshot({ path: path.join(ARTIFACTS, 'landscape-play.png'), fullPage: true });
});

test('all four themes recolor the page and the night ball keeps dark digits', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');
  const expected = {
    cream: 'rgb(255, 243, 220)',
    ice: 'rgb(228, 238, 245)',
    matcha: 'rgb(230, 240, 227)',
    night: 'rgb(36, 30, 24)',
  };
  for (const [id, color] of Object.entries(expected)) {
    await page.locator(`#setup-themes .theme-option[data-theme-id="${id}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(color);
  }
  await expect(page.locator('body')).not.toContainText('晴光');
  await page.locator('#setup-play').click();
  await page.locator('#transport').click();
  await expect.poll(() => page.locator('#hero .num').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(42, 31, 20)');
  await expect.poll(() => page.locator('#transport').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(84, 185, 198)');
  await expect.poll(() => page.locator('#transport').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(42, 31, 20)');
  const ring = await page.locator('#board .cell:not(.called)').first().evaluate((el) => getComputedStyle(el).borderColor);
  expect(ring).toBe('rgb(196, 180, 154)');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, 'night-play.png'), fullPage: true });

  await page.locator('#settings-open').click();
  await page.locator('#settings-themes .theme-option[data-theme-id="matcha"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'matcha');
  await page.locator('#settings-close').click();
});

test('the countdown shows only after speech and freezes while paused', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');
  const setupOrder = await page.locator('#setup').evaluate((root) => {
    const slider = root.querySelector('.slider-row');
    const themes = root.querySelector('.theme-row');
    return Boolean(slider && themes && (slider.compareDocumentPosition(themes) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(setupOrder).toBe(true);
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#sound-wave')).toBeHidden();

  await page.locator('#setup-play').click();
  await expect(page.locator('#table')).toBeVisible();
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#sound-wave')).toBeHidden();
  await page.locator('#settings-open').click();
  await expect(page.locator('#settings-dialog input[type="range"]')).toHaveCount(0);
  await page.locator('#settings-close').click();

  await page.locator('#transport').click();
  await expect(page.locator('#progress')).toHaveText('1／75');
  await expect(page.locator('#hero')).toHaveClass(/pop/);
  const reveal = await page.locator('#hero').evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      name: style.animationName,
      iterations: style.animationIterationCount,
      transform: style.transform,
    };
  });
  expect(reveal.name).toBe('ball-reveal');
  expect(reveal.iterations).toBe('1');
  expect(reveal.transform).toBe('none');
  await expect(page.locator('#sound-wave')).toBeVisible();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#wait-seconds')).toBeHidden();
  const waveSides = await page.evaluate(() => {
    const wave = document.querySelector('#sound-wave').getBoundingClientRect();
    const button = document.querySelector('#transport').getBoundingClientRect();
    const pulses = getComputedStyle(document.querySelector('#sound-wave .wave')).animationIterationCount;
    return {
      left: wave.left < button.left,
      right: wave.right > button.right,
      pulses: pulses,
    };
  });
  expect(waveSides.left).toBe(true);
  expect(waveSides.right).toBe(true);
  expect(waveSides.pulses).toBe('infinite');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, 'countdown-speak.png') });
  await page.clock.runFor(5000);
  await expect(page.locator('#progress')).toHaveText('1／75');
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#sound-wave')).toBeVisible();
  const revealDuringSpeech = await page.locator('#hero').evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      name: style.animationName,
      iterations: style.animationIterationCount,
    };
  });
  expect(revealDuringSpeech.name).toBe('ball-reveal');
  expect(revealDuringSpeech.iterations).toBe('1');
  await expect(page.locator('#hero .num')).not.toHaveText('');

  await page.evaluate(() => window.__endSpeech());
  await expect(page.locator('#wait-seconds')).toBeVisible();
  await expect(page.locator('#wait-seconds')).toHaveText('8');
  await expect(page.locator('#wait-ring')).toBeVisible();
  await expect(page.locator('#sound-wave')).toBeHidden();
  expect(await ringRemain(page)).toBeGreaterThan(0.9);
  const heroBox = await page.locator('#hero').boundingBox();
  expect(heroBox.width).toBeGreaterThanOrEqual(240);
  await expect(page.locator('#hero .band')).not.toHaveText('');
  await expect(page.locator('#hero #wait-ring, #hero #wait-seconds')).toHaveCount(0);
  await expect(page.locator('progress')).toHaveCount(0);
  const beside = await page.evaluate(() => {
    const seconds = document.querySelector('#wait-seconds').getBoundingClientRect();
    const button = document.querySelector('#transport').getBoundingClientRect();
    const ball = document.querySelector('#hero').getBoundingClientRect();
    const progress = document.querySelector('#progress').getBoundingClientRect();
    return {
      leftOfButton: seconds.right <= button.left,
      levelWithButton: Math.abs((seconds.top + seconds.height / 2) - (button.top + button.height / 2)) < 24,
      belowHero: seconds.top > ball.top + ball.height * 0.55,
      clearOfProgress: seconds.left > progress.right + 4,
    };
  });
  expect(beside.leftOfButton).toBe(true);
  expect(beside.levelWithButton).toBe(true);
  expect(beside.belowHero).toBe(true);
  expect(beside.clearOfProgress).toBe(true);
  const around = await page.evaluate(() => {
    const ring = document.querySelector('#wait-ring').getBoundingClientRect();
    const button = document.querySelector('#transport').getBoundingClientRect();
    return ring.left < button.left
      && ring.right > button.right
      && ring.top < button.top
      && ring.bottom > button.bottom;
  });
  expect(around).toBe(true);

  await page.clock.runFor(3000);
  await expect(page.locator('#wait-seconds')).toHaveText('5');
  await expect(page.locator('#progress')).toHaveText('1／75');
  expect(await ringRemain(page)).toBeLessThan(0.75);
  expect(await ringRemain(page)).toBeGreaterThan(0.5);
  const sliderPct = await page.locator('#table-interval').evaluate((el) => el.style.getPropertyValue('--pct'));
  expect(sliderPct).toBe(`${((8 - 1) / 29) * 100}%`);
  await page.screenshot({ path: path.join(ARTIFACTS, 'countdown-wait.png') });

  await page.locator('#transport').click();
  await expect(page.locator('#transport')).toHaveAttribute('data-mode', 'play');
  await expect(page.locator('#wait-seconds')).toHaveText('5');
  await expect(page.locator('#wait-seconds')).toHaveAttribute('data-frozen', 'true');
  await expect(page.locator('#wait-ring')).toHaveAttribute('data-frozen', 'true');
  const frozen = await ringRemain(page);
  await page.clock.runFor(20000);
  await expect(page.locator('#wait-seconds')).toHaveText('5');
  expect(await ringRemain(page)).toBeCloseTo(frozen, 2);
  await expect(page.locator('#progress')).toHaveText('1／75');

  await page.locator('#transport').click();
  await expect(page.locator('#transport')).toHaveAttribute('data-mode', 'pause');
  await expect(page.locator('#wait-seconds')).toHaveText('5');
  await expect(page.locator('#wait-seconds')).not.toHaveAttribute('data-frozen', 'true');
  await page.clock.runFor(2000);
  await expect(page.locator('#wait-seconds')).toHaveText('3');
  expect(await ringRemain(page)).toBeLessThan(frozen);
  await page.clock.runFor(1000);
  await expect(page.locator('#progress')).toHaveText('1／75');
  await expect(page.locator('#wait-seconds')).toHaveText('2');
  await page.clock.runFor(3000);
  await expect(page.locator('#progress')).toHaveText('2／75');
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#sound-wave')).toBeVisible();
});

test('the slider retimes the countdown without cutting speech', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');
  await page.locator('#setup-play').click();
  await page.locator('#transport').click();
  const duringSpeech = (await audible(page)).length;
  await expect(page.locator('#sound-wave')).toBeVisible();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await setRange(page, '#table-interval', 4);
  await page.clock.runFor(2000);
  expect(await audible(page)).toHaveLength(duringSpeech);
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await page.evaluate(() => window.__endSpeech());
  await expect(page.locator('#wait-seconds')).toHaveText('4');
  await expect(page.locator('#sound-wave')).toBeHidden();
  expect(await ringRemain(page)).toBeGreaterThan(0.9);
  await page.clock.runFor(2000);
  expect(await audible(page)).toHaveLength(duringSpeech);
  await expect(page.locator('#wait-seconds')).toHaveText('2');
  expect(await ringRemain(page)).toBeLessThan(0.6);
  await setRange(page, '#table-interval', 6);
  expect(await audible(page)).toHaveLength(duringSpeech);
  await expect(page.locator('#wait-seconds')).toHaveText('4');
  expect(await ringRemain(page)).toBeGreaterThan(0.6);
  await setRange(page, '#table-interval', 1);
  expect(await audible(page)).toHaveLength(duringSpeech + 1);
  await expect(page.locator('#progress')).toHaveText('2／75');
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#sound-wave')).toBeVisible();

  await page.evaluate(() => window.__endSpeech());
  await setRange(page, '#table-interval', 4);
  await expect(page.locator('#wait-seconds')).toHaveText('4');
  await page.clock.runFor(2000);
  await expect(page.locator('#wait-seconds')).toHaveText('2');
  await page.locator('#replay').click();
  await page.clock.runFor(80);
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#sound-wave')).toBeVisible();
  await expect(page.locator('#progress')).toHaveText('2／75');
  await setRange(page, '#table-interval', 1);
  await page.clock.runFor(500);
  expect(await audible(page)).toHaveLength(duringSpeech + 2);
  await page.evaluate(() => window.__endSpeech());
  expect(await audible(page)).toHaveLength(duringSpeech + 3);
  await expect(page.locator('#progress')).toHaveText('3／75');
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#sound-wave')).toBeVisible();
});

test('the last ball stops auto-call and releases the wake lock', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 834, height: 1110 });
  await page.goto('/');
  await setRange(page, '#setup-interval', 1);
  await page.locator('#setup-play').click();
  await page.locator('#transport').click();
  for (let i = 0; i < 74; i++) {
    await page.evaluate(() => window.__endSpeech());
    await page.clock.runFor(1000);
  }
  await expect(page.locator('#progress')).toHaveText('75／75');
  await expect(page.locator('#transport')).toHaveAttribute('aria-label', '新一局');
  await expect(page.locator('#hero')).toHaveClass(/is-done/);
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  const spoken = (await audible(page)).length;
  expect(spoken).toBe(75);
  await page.evaluate(() => window.__endSpeech());
  await page.clock.runFor(5000);
  expect(await audible(page)).toHaveLength(75);
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#sound-wave')).toBeHidden();
  expect(await page.evaluate(() => window.__locks.releases)).toBeGreaterThanOrEqual(1);
  await page.locator('#transport').click();
  await expect(page.locator('#confirm-text')).toHaveText('已叫的數會清零');
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#progress')).toHaveText('75／75');
});

test('reduced motion skips the speaking wave and the new-ball reveal', async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto('/');
  await page.locator('#setup-play').click();
  await page.locator('#transport').click();
  await expect(page.locator('#hero .num')).not.toHaveText('');
  await expect(page.locator('#hero')).not.toHaveClass(/pop/);
  const reveal = await page.locator('#hero').evaluate((el) => getComputedStyle(el).animationName);
  expect(reveal).toBe('none');
  await expect(page.locator('#sound-wave')).toBeHidden();
  await expect(page.locator('#wait-ring')).toBeHidden();
  await expect(page.locator('#wait-seconds')).toBeHidden();
  await page.evaluate(() => window.__endSpeech());
  await expect(page.locator('#wait-ring')).toBeVisible();
  await expect(page.locator('#wait-seconds')).toHaveText('8');
  expect(await ringRemain(page)).toBeGreaterThan(0.9);
  const motion = await page.locator('#wait-ring circle').evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(motion).toBe('0s');
  await page.clock.runFor(3000);
  await expect(page.locator('#wait-seconds')).toHaveText('5');
  expect(await ringRemain(page)).toBeLessThan(0.75);
});

test('a missing wake lock asks the reader to turn off Auto-Lock', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect(page.locator('#setup-wake')).toBeVisible();
  await expect(page.locator('#setup-wake')).toContainText('自動鎖定');
});

test('language, theme, and interval are still there on the next visit', async ({ page }) => {
  await page.goto('/');
  await page.locator('#setup-langs .lang-pick').filter({ hasText: 'English' }).click();
  await page.locator('#setup-themes .theme-option[data-theme-id="ice"]').click();
  await setRange(page, '#setup-interval', 14);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ice');
  await expect(page.locator('#setup-langs .lang-row.on .lang-name')).toHaveText('English');
  await expect(page.locator('#setup-interval')).toHaveValue('14');
  await expect(page.locator('#setup')).toBeVisible();
});
