# Pause FX

Declarative, reusable Foundry pause-screen effects: a themed icon/border/text overlay
that can run a scripted sequence of changes -- text swaps, freezing the pulse, showing a
video or image, playing an audio cue, dropping in an existing macro, or closing every
connected client's open windows -- instead of hand-writing a new imperative macro per
reveal.

Grew out of Curtain Call's Norgorber pause-screen reveal (2026-09-07); see that project's
`temp-pause.js` / `norgorber-takes-his-due.js` macros for the original one-off versions
this generalizes.

## Requires

[socketlib](https://github.com/manuelVo/foundryvtt-socketlib) (for `closeAllWindows`).
Recommends [Monk's Little Details](https://github.com/ironmonk88/monks-little-details)
for the border-glow steps -- without it, border-colour changes are silently skipped and
everything else still works.

## Usage

```js
await game.modules.get("pause-fx").api.run({
  icon: "curtain-call/art/bk2/Norgorber.gif",
  iconGlow: "#960018",
  borderColor: "#FF0000",
  borderCycleMs: 3640, // 28 frames @ 130ms -- Norgorber.gif's own real loop length
  closeAllWindows: true,
  endCombat: true,
  steps: [
    { wait: { units: 2, clock: "text" }, text: "A MANNEQUIN BEGINS TO TWITCH" },
    { wait: { units: 1.45, clock: "text" }, text: "...AND SUDDENLY...", freeze: true },
    { wait: { units: 0.5, clock: "border" }, audio: "curtain-call/audio/sting.ogg" },
    { wait: { units: 0.25, clock: "border" }, video: "curtain-call/art/bk2/father-skinsaw.webm", hideIcon: true, blankText: true },
    { waitForVideoEnd: true },
    { wait: { units: 1.5, clock: "border" }, closeVideo: true, showIcon: true, resume: true },
    { wait: { units: 1, clock: "border" }, macro: "Chandelier Falls" },
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
finds `scripts/pause-fx.test.mjs`) runs the unit suite -- node's built-in test runner, no
dependencies. It covers the pure/isolable logic (the `hasFrame` window-close filter and the
clock/wait math), not the full `PauseFX.run()` sequence itself -- that's covered by live
two-client testing instead (Hooks/game/togglePause/ApplicationV2 are real Foundry globals,
not worth mocking wholesale just to re-prove what a live run already proved more directly).
See `scripts/pause-fx.test.mjs`'s own header comment for the reasoning.

Target one test (or a table-driven case within one, e.g. a single `clockMsFor` row) via
`node --test --test-name-pattern=<regex>` -- also reachable as `hone test pause-fx
<pattern>`. The pattern flag has to come *before* any positional test-path argument or
Node silently ignores it (confirmed live 2026-09-07 -- this is exactly why the script above
has no `scripts/` positional: `npm test -- --test-name-pattern=...` always appends after
the script's own arguments, so a positional there would land in the wrong place and the
pattern would never apply).

## Known limitations

- **No automatic icon-GIF-timing detection.** `borderCycleMs` has to be supplied by the
  caller if it should match a specific asset's real loop length -- read the source GIF's
  frame delays yourself (e.g. Python's Pillow: `im.info["duration"]` per frame) and pass
  the total. A future version could do this client-side; not done yet.
- **`macro` steps aren't sandboxed.** `pause-fx` just calls `.execute()` at the right beat
  -- it's on whoever authors the sequence to confirm the macro they picked actually plays
  nicely with an active pause overlay.
