// Unit tests for pause-fx's pure/isolable logic -- node's built-in test runner, no
// dependencies (`node --test scripts/`). Deliberately NOT trying to mock Foundry's whole
// Hooks/game/togglePause/ApplicationV2 surface to drive the full PauseFX.run() sequence
// end-to-end here -- that's already exercised live (2026-09-07, two real browser clients,
// see pause-fx's Almanac notes) far more convincingly than a pile of mocks would, and
// chasing full coverage of Foundry-coupled code through mocks would be effort spent for
// little real confidence beyond what that live test already gave. What's covered here is
// the genuinely pure logic: the exact hasFrame regression this module hit live, and the
// clock/wait math, which is easy to get subtly wrong and easy to test in isolation.
//
// Minimal Foundry globals (`ui`, `foundry`) are stubbed just enough for
// closeAllWindowsHandler to run -- set up before importing pause-fx.js, since its top-level
// code touches `globalThis.socketlib` at import time (harmlessly skips registration when
// absent, per the same-day fix for the socketlib-ready race -- see that comment in the
// source).

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.ui = { windows: {} };
globalThis.foundry = { applications: { instances: new Map() } };
// socketlib isn't present in this test env, so the module's top-level code falls back to
// Hooks.once("socketlib.ready", ...) on import -- stub just enough for that to no-op cleanly.
globalThis.Hooks = { once() {} };

const { isRealWindow, closeAllWindowsHandler, resolveTextCycleMs, clockMsFor } = await import("./pause-fx.js");

test("isRealWindow: true only for apps with a real frame (a titled window with a close control)", () => {
  assert.equal(isRealWindow({ hasFrame: true }), true);
  assert.equal(isRealWindow({ hasFrame: false }), false);
  assert.equal(isRealWindow({}), false); // undefined hasFrame -- docked chrome that never set it
});

test("closeAllWindowsHandler: closes real floating windows, leaves docked UI chrome alone", () => {
  // Regression test for the exact bug found live 2026-09-07: naively closing every entry in
  // foundry.applications.instances also closed persistent chrome (sidebar, hotbar, players,
  // scene-controls, ...) and blanked a client's whole UI, not just its open dialogs.
  const closed = [];
  const mkApp = (id, hasFrame) => ({ id, hasFrame, close: () => closed.push(id) });

  globalThis.ui.windows = { legacyDialog: mkApp("legacy-dialog", true) };
  globalThis.foundry.applications.instances = new Map([
    ["sidebar", mkApp("sidebar", false)], // docked chrome -- must NOT close
    ["hotbar", mkApp("hotbar", false)], // docked chrome -- must NOT close
    ["pause", mkApp("pause", false)], // the pause overlay itself -- must NOT close
    ["UserConfig-abc123", mkApp("user-config", true)], // a real floating dialog -- must close
  ]);

  closeAllWindowsHandler();

  assert.deepEqual(closed.sort(), ["legacy-dialog", "user-config"]);
});

test("resolveTextCycleMs: explicit textCycleMs always wins over the multiplier", () => {
  assert.equal(resolveTextCycleMs({ textCycleMs: 5000, borderCycleMs: 3640, textCycleMultiplier: 2 }), 5000);
});

test("resolveTextCycleMs: defaults to borderCycleMs * 2 when nothing else is given", () => {
  assert.equal(resolveTextCycleMs({ borderCycleMs: 3640 }), 7280);
});

test("resolveTextCycleMs: a custom multiplier is honored when textCycleMs is omitted", () => {
  assert.equal(resolveTextCycleMs({ borderCycleMs: 1000, textCycleMultiplier: 3 }), 3000);
});

// Table-driven -- same behavior (unit-count * the right clock) across varying inputs, so one
// row per case reads better as a table than as separately-argued tests. Each row still
// registers as its own `test()`, not a loop of asserts inside one -- so a single row shows up
// as its own ✔/✖ line, and `--test-name-pattern` (or `hone test pause-fx <pattern>`) can
// target just that one row instead of the whole table.
const CLOCK_MS_CASES = [
  ["border clock", { units: 1.5, clock: "border" }, 5460],
  ["text clock, not border", { units: 2, clock: "text" }, 14560],
  ["fractional units, text (real Norgorber beat)", { units: 1.45, clock: "text" }, 10556],
  ["fractional units, border", { units: 0.5, clock: "border" }, 1820],
  ["missing clock defaults to border (matches run()'s own fallback)", { units: 1 }, 3640],
];
const clocks = { borderCycleMs: 3640, textCycleMs: 7280 };
for (const [label, waitSpec, expected] of CLOCK_MS_CASES) {
  test(`clockMsFor: ${label}`, () => {
    assert.equal(clockMsFor(waitSpec, clocks), expected);
  });
}
