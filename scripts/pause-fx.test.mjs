// Unit tests for pause-fx's pure/isolable logic (node's built-in test runner, no
// dependencies) -- not the full PauseFX.run() sequence, which needs a real Foundry
// runtime and is covered by live testing instead. [CC+: whole-file preamble]
//
// Minimal Foundry globals (`ui`, `foundry`, `Hooks`) are stubbed just enough for
// closeAllWindowsHandler to run and for the module to import cleanly without socketlib
// present.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.ui = { windows: {}, notifications: { warn() {} } };
globalThis.foundry = { applications: { instances: new Map() } };
globalThis.game = { user: { isGM: false } };
// socketlib isn't present in this test env, so the module's top-level code falls back to
// Hooks.once("socketlib.ready", ...) on import -- stub just enough for that to no-op cleanly.
globalThis.Hooks = { once() {} };

const {
  isRealWindow, closeAllWindowsHandler, clockMsFor, beatDurationS, wait, waitForEvent,
} = await import("./pause-fx.js");

test("isRealWindow: true only for apps with a real frame (a titled window with a close control)", () => {
  assert.equal(isRealWindow({ hasFrame: true }), true);
  assert.equal(isRealWindow({ hasFrame: false }), false);
  assert.equal(isRealWindow({}), false); // undefined hasFrame -- docked chrome that never set it
});

test("closeAllWindowsHandler: closes real floating windows, leaves docked UI chrome alone", () => {
  // Regression: closing every instance also took out persistent chrome, and (separately)
  // Pause FX's own Composer -- which Run's own closeAllWindows would close on itself.
  const closed = [];
  const mkApp = (id, hasFrame) => ({ id, hasFrame, close: () => closed.push(id) });

  globalThis.ui.windows = { legacyDialog: mkApp("legacy-dialog", true) };
  globalThis.foundry.applications.instances = new Map([
    ["sidebar", mkApp("sidebar", false)], // docked chrome -- must NOT close
    ["hotbar", mkApp("hotbar", false)], // docked chrome -- must NOT close
    ["pause", mkApp("pause", false)], // the pause overlay itself -- must NOT close
    ["UserConfig-abc123", mkApp("user-config", true)], // a real floating dialog -- must close
    ["pause-fx-composer", mkApp("pause-fx-composer", true)], // Run's own Composer -- must NOT close
    ["pause-fx-step-editor", mkApp("pause-fx-step-editor", true)], // ditto -- must NOT close
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

// Table-driven -- one test() per row, not a loop of asserts inside one, so each row still
// reports individually and `--test-name-pattern` can target just one.
const CLOCK_MS_CASES = [
  ["whole units", { units: 1.5 }, 5460],
  ["fractional units", { units: 0.5 }, 1820],
];
const clocks = { cycleMs: 3640 };
for (const [label, waitSpec, expected] of CLOCK_MS_CASES) {
  test(`clockMsFor: ${label}`, () => {
    assert.equal(clockMsFor(waitSpec, clocks), expected);
  });
}

test("beatDurationS: cycleMs / beatsPerCycle, in seconds", () => {
  assert.equal(beatDurationS(3000, 1, "text"), 3);
  assert.equal(beatDurationS(3000, 2, "icon"), 1.5);
});

test("beatDurationS: falsy beatsPerCycle (0/undefined) treated as 1", () => {
  assert.equal(beatDurationS(3000, 0, "text"), 3);
  assert.equal(beatDurationS(3000, undefined, "text"), 3);
});

test("beatDurationS: clamps to the photosensitive-safety floor and warns when it bites", () => {
  const warnings = [];
  globalThis.ui.notifications.warn = (msg) => warnings.push(msg);

  assert.equal(beatDurationS(3000, 100, "border"), 0.5); // 30ms/beat -> clamped to 500ms
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /border/);

  warnings.length = 0;
  assert.equal(beatDurationS(3000, 6, "icon"), 0.5); // exactly the floor -- still clamps
  assert.equal(warnings.length, 0); // >= floor, not below it -- no warning

  globalThis.ui.notifications.warn = () => {}; // restore the no-op for later tests
});

// A real AbortSignal that also counts its own live listeners -- a sequence runs dozens of
// waits against one signal, so each has to detach itself however it finishes.
function countingSignal() {
  const controller = new AbortController();
  const { signal } = controller;
  let live = 0;
  const { addEventListener, removeEventListener } = signal;
  signal.addEventListener = (...args) => { live++; return addEventListener.apply(signal, args); };
  signal.removeEventListener = (...args) => { live--; return removeEventListener.apply(signal, args); };
  return { controller, signal, liveListeners: () => live };
}

test("wait: resolves immediately on an already-aborted signal, without listening at all", async () => {
  const { controller, signal, liveListeners } = countingSignal();
  controller.abort();
  await wait(60_000, signal); // would hang for a minute if the aborted check didn't short-circuit
  assert.equal(liveListeners(), 0);
});

test("wait: an abort mid-wait resolves it early", async () => {
  const { controller, signal } = countingSignal();
  const pending = wait(60_000, signal);
  controller.abort();
  await pending;
});

test("wait: detaches its abort listener once the timer fires normally", async () => {
  const { signal, liveListeners } = countingSignal();
  await wait(1, signal);
  assert.equal(liveListeners(), 0);
});

test("waitForEvent: the first of its events resolves it, and every listener detaches", async () => {
  const { signal, liveListeners } = countingSignal();
  const target = new EventTarget();
  const pending = waitForEvent(target, ["ended", "error"], signal);
  target.dispatchEvent(new Event("error")); // an unloadable video -- "ended" never comes
  await pending;
  assert.equal(liveListeners(), 0);
});

test("waitForEvent: an abort resolves it too, so an unpause can't leave a step hung", async () => {
  const { controller, signal } = countingSignal();
  const pending = waitForEvent(new EventTarget(), ["ended"], signal);
  controller.abort();
  await pending;
});
