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

Building a sequence doesn't require writing JS: the GM-only "Pause FX" scene-control button
(clapperboard icon) opens a Composer for the same config below -- a Startup section (pulse
length, close-windows targeting, end combat), a pinned look/feel entry, named presets saved
per world, and an add/reorder/remove step list. `game.modules.get("pause-fx").api.openComposer()`
opens it too, if you'd rather bind that to a macro/hotkey.

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

`npm test` (or `node --test`, no path argument -- Node's own default test-file discovery
finds every `scripts/*.test.mjs`) runs the unit suite -- node's built-in test runner, no
dependencies. It covers the pure/isolable logic (the `hasFrame` window-close filter, the
clock/wait math, and the Composer's form<->config translation), not the full `PauseFX.run()`
sequence or the Composer's own rendering -- those are covered by live two-client testing
instead (Hooks/game/togglePause/ApplicationV2 are real Foundry globals, not worth mocking
wholesale just to re-prove what a live run already proved more directly). See
`scripts/pause-fx.test.mjs`'s own header comment for the reasoning.

Target one test (or a table-driven case within one, e.g. a single `clockMsFor` row) via
`node --test --test-name-pattern=<regex>`. That flag has to come *before* any positional
test-path argument or Node silently ignores it -- which is exactly why the script above has
no `scripts/` positional: `npm test -- --test-name-pattern=...` always appends after the
script's own arguments, so a positional there would land in the wrong place and the pattern
would never apply.

## Known limitations

- **No automatic icon-GIF-timing detection.** `borderCycleMs` has to be supplied by the
  caller if it should match a specific asset's real loop length -- read the source GIF's
  frame delays yourself (e.g. Python's Pillow: `im.info["duration"]` per frame) and pass
  the total. A future version could do this client-side; not done yet.
- **`macro` steps aren't sandboxed.** `pause-fx` just calls `.execute()` at the right beat
  -- it's on whoever authors the sequence to confirm the macro they picked actually plays
  nicely with an active pause overlay.
