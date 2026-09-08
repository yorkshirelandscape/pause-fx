# Pause FX

Declarative, reusable Foundry pause-screen effects: a themed icon/border/text overlay
that can run a scripted sequence of changes -- text swaps, freezing the pulse, showing a
video or image, playing an audio cue, dropping in an existing macro, or closing every
connected client's open windows -- instead of hand-writing a new imperative macro per
reveal.

## Requires

[socketlib](https://github.com/manuelVo/foundryvtt-socketlib) (for `closeAllWindows`).
Nothing else -- the border-glow overlay is entirely `pause-fx`'s own, so it looks the same
whether or not another pause-screen module (e.g. Monk's Little Details) is also installed.

## Composer UI

Three GM-only scene-control buttons: new sequence, load a saved macro into the Composer, or
run one directly. `game.modules.get("pause-fx").api.openComposer()` opens a blank one too.
Run and Save (as a real, draggable/compendium-packable macro) live in the window's own
header controls.

`icon`/`iconGlow`/`borderColor` are all opt-in -- omit them and a run looks like Foundry's
own native pause screen, not pause-fx's themed one.

## Usage

```js
await game.modules.get("pause-fx").api.run({
  icon: "modules/my-module/art/eye.gif",
  iconGlow: "#960018",
  borderColor: "#FF0000",
  borderCycleMs: 3640, // match the icon GIF's own real loop length, if it has one
  closeAllWindows: { players: true, gm: false }, // gm:false -- a connected GM keeps their windows
  endCombat: true,
  steps: [
    { wait: { units: 2, clock: "text" }, text: "SOMETHING STIRS" },
    { wait: { units: 1.45, clock: "text" }, text: "...AND SUDDENLY...", freeze: true },
    { wait: { units: 0.5, clock: "border" }, audio: "modules/my-module/audio/sting.ogg" },
    { wait: { units: 0.25, clock: "border" }, video: "modules/my-module/video/reveal.webm", hideIcon: true, blankText: true },
    { waitForVideoEnd: true },
    { wait: { units: 1.5, clock: "border" }, closeVideo: true, showIcon: true, resume: true },
    { wait: { units: 1, clock: "border" }, macro: "Some Existing Macro" },
  ],
});
```

Two independent clocks drive every `wait`: `border` (the border/icon pulse period) and
`text` (the label's own pulse period, `textCycleMultiplier` × `border` by default -- 2×
out of the box). A step's `wait` is always expressed as a number of units on one of those,
never a raw millisecond count -- keeps a sequence's timing readable against whatever
rhythm the reveal is actually built on.

See `scripts/pause-fx.js`'s own JSDoc on `PauseFX.run` for the full step vocabulary.

## Testing

`npm test` (or bare `node --test`) runs the unit suite -- pure logic only (clock/wait math,
the Composer's form<->config translation); `PauseFX.run()` and the Composer's own rendering
are covered by live testing instead.

Target one test via `node --test --test-name-pattern=<regex>` (must come before any
positional path argument, or Node silently ignores it).

## Known limitations

- **No automatic icon-GIF-timing detection.** Pass `borderCycleMs` explicitly to match a
  specific asset's real loop length.
- **`macro` steps aren't sandboxed.** `pause-fx` just calls `.execute()` at the right beat --
  it's on the sequence's author to confirm that plays nicely with an active pause overlay.
