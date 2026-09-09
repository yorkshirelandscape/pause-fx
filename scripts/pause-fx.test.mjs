// Unit tests for pause-fx's pure/isolable logic (node's built-in test runner, no
// dependencies) -- not the full PauseFX.run() sequence, which needs a real Foundry
// runtime and is covered by live testing instead.
//
// Minimal Foundry globals (`ui`, `foundry`, `Hooks`) are stubbed just enough for
// closeAllWindowsHandler to run and for the module to import cleanly without socketlib
// present.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.ui = { windows: {} };
globalThis.foundry = { applications: { instances: new Map() } };
globalThis.game = { user: { isGM: false } };
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
  // Regression test: naively closing every entry in foundry.applications.instances also
  // closes persistent chrome (sidebar, hotbar, players, scene-controls, ...), blanking a
  // client's whole UI rather than just its open dialogs.
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

test("closeAllWindowsHandler: a client skips entirely when its own role isn't targeted", () => {
  // Every connected client runs this handler regardless of who a reveal meant to target --
  // each one has to decide for itself whether to act, based on game.user.isGM locally.
  const closed = [];
  const mkApp = (id) => ({ id, hasFrame: true, close: () => closed.push(id) });
  globalThis.ui.windows = { dialog: mkApp("dialog") };
  globalThis.foundry.applications.instances = new Map();

  globalThis.game.user.isGM = true;
  closeAllWindowsHandler({ players: true, gm: false }); // targets players only
  assert.deepEqual(closed, [], "a GM client must not close anything when gm:false");

  closeAllWindowsHandler({ players: true, gm: true });
  assert.deepEqual(closed, ["dialog"], "the same GM client acts once gm:true");

  closed.length = 0;
  globalThis.game.user.isGM = false;
  closeAllWindowsHandler({ players: false, gm: true }); // targets GMs only
  assert.deepEqual(closed, [], "a player client must not close anything when players:false");

  globalThis.game.user.isGM = false; // restore the module-wide default for later tests
});

test("closeAllWindowsHandler: no target argument defaults to acting on every role", () => {
  const closed = [];
  globalThis.ui.windows = { dialog: { id: "dialog", hasFrame: true, close: () => closed.push("dialog") } };
  globalThis.foundry.applications.instances = new Map();

  globalThis.game.user.isGM = true;
  closeAllWindowsHandler();
  assert.deepEqual(closed, ["dialog"]);
  globalThis.game.user.isGM = false;
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

// Table-driven -- one test() per row, not a loop of asserts inside one, so each row still
// reports individually and `--test-name-pattern` can target just one.
const CLOCK_MS_CASES = [
  ["border clock", { units: 1.5, clock: "border" }, 5460],
  ["text clock, not border", { units: 2, clock: "text" }, 14560],
  ["fractional units, text", { units: 1.45, clock: "text" }, 10556],
  ["fractional units, border", { units: 0.5, clock: "border" }, 1820],
  ["missing clock defaults to border (matches run()'s own fallback)", { units: 1 }, 3640],
];
const clocks = { borderCycleMs: 3640, textCycleMs: 7280 };
for (const [label, waitSpec, expected] of CLOCK_MS_CASES) {
  test(`clockMsFor: ${label}`, () => {
    assert.equal(clockMsFor(waitSpec, clocks), expected);
  });
}
