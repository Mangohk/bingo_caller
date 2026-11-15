# Bingo caller

A family can set an iPad down and let this page call all 75 balls. The large number is the ball being called. The board is the map of balls already called. Speech can switch between English and Cantonese at any time.

## Open the page

Open `index.html` in a browser. The page is plain HTML, CSS, and JavaScript, so it does not need a build.

To serve it on your own machine:

```
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

Press play on the setup page to enter the caller. That press does not call a ball. Press play again on the caller to start. Nothing is spoken before the first tap.

## Page
https://mangohk.github.io/bingo_caller/


## Languages

The list has English and 粵語. Each name is written in its own language. A text badge sits in front of the name: EN for English, 粵 for 粵語. The list does not use flags.

The same list is on the setup page, behind the language chip on the caller, and in settings. The speaker on a row previews that language with B 12. Picking a language does not start the game.

English speech is the letter plus the full number. N 37 is spoken “N, thirty-seven”, not “three seven”. Cantonese keeps the English letter name and uses a full numeral. N 37 is spoken 「N，三十七」, not 「三七」. Those words are spoken only. They are not printed on the ball.

The browser asks for a zh-HK voice for Cantonese. If the device has no zh-HK voice, it uses a voice whose name says Cantonese, then any Chinese voice. The words stay Cantonese in every case. A Mandarin voice will not sound like Cantonese.

The page remembers the last language, the theme, and the interval.

## Interval

The slider runs from 1 to 30 seconds, in steps of 1. The default is 8. The same slider is on the setup page and on the caller, under play and pause.

The gap starts when the current utterance ends, so speech does not overlap. Moving the slider does not pause or cut the utterance in progress. If the wait has already lasted longer than the new gap, the next ball is called as soon as that utterance ends.

## Themes

The default theme is 奶油叫號廳. The others are 冰室藍, 抹茶紙, and 夜廳毡. Change theme on the setup page or in settings. The choice is remembered.

## Wake lock

While the page is calling, and while it is paused, it asks the browser to keep the screen awake. The lock is released when all 75 balls have been called, when a new game returns to the idle caller, or when you leave the page.

If the browser cannot do that, the setup page shows one line asking you to turn off Auto-Lock.

## New game

New game is in settings, and it is the main control after all 75 balls. If at least one ball has been called, the page asks you to confirm with 「已叫的數會清零」. Cancel leaves the board as it is. Confirm clears the board, keeps the language, and returns to the idle caller.

## Tests

```
npm test
npx playwright install chromium
npm run test:e2e
```

`npm test` checks the 75-ball shuffle, column ranges, English and Cantonese utterances, and the call timer. `npm run test:e2e` opens the page in Chromium and walks setup, play, pause, re-read, language, the slider, new game, and the four themes.
