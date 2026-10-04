// Unit tests for pause-fx's pure/isolable logic (node's built-in test runner, no
// dependencies) -- not the full PauseFX.run() sequence, which needs a real Foundry
// runtime and is covered by live testing instead. [CC+: whole-file preamble]
//
// Minimal Foundry globals (`ui`, `foundry`, `game`, `Hooks`) are stubbed just enough for
// closeAllWindowsHandler/socket routing to run and for the module to import cleanly.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.ui = { windows: {}, notifications: { warn() {} } };
globalThis.foundry = { applications: { instances: new Map() } };
globalThis.game = { user: { isGM: false }, paused: false };
// A tiny real hook bus -- waitForPause actually listens on pauseGame.
const hookListeners = new Map();
globalThis.Hooks = {
  once() {},
  on(name, fn) { (hookListeners.get(name) ?? hookListeners.set(name, new Set()).get(name)).add(fn); },
  off(name, fn) { hookListeners.get(name)?.delete(fn); },
  call(name, ...args) { for (const fn of [...(hookListeners.get(name) ?? [])]) fn(...args); },
};

const {
  isRealWindow, closeAllWindowsHandler, clockMsFor, beatDurationS, wait, waitForEvent,
  waitForPause, waitForManualAdvance, onSocketMessage, SOCKET_NAME,
} = await import("./pause-fx.js");

test("isRealWindow: true only for apps with a real frame (a titled window with a close control)", () => {
  assert.equal(isRealWindow({ hasFrame: true }), true);
  assert.equal(isRealWindow({ hasFrame: false }), false);
  assert.equal(isRealWindow({}), false); // undefined hasFrame -- docked chrome that never set it
});

test("closeAllWindowsHandler: minimizes real floating windows, leaves docked UI chrome alone", () => {
  // Regression: closing every instance also took out persistent chrome, and (separately)
  // Pause FX's own Composer -- which Run's own closeAllWindows would close on itself.
  const minimized = [];
  const mkApp = (id, hasFrame) => ({ id, hasFrame, minimize: () => minimized.push(id) });

  globalThis.ui.windows = { legacyDialog: mkApp("legacy-dialog", true) };
  globalThis.foundry.applications.instances = new Map([
    ["sidebar", mkApp("sidebar", false)], // docked chrome -- must NOT minimize
    ["hotbar", mkApp("hotbar", false)], // docked chrome -- must NOT minimize
    ["pause", mkApp("pause", false)], // the pause overlay itself -- must NOT minimize
    ["UserConfig-abc123", mkApp("user-config", true)], // a real floating dialog -- must minimize
    ["pause-fx-composer", mkApp("pause-fx-composer", true)], // Run's own Composer -- must NOT minimize
    ["pause-fx-step-editor", mkApp("pause-fx-step-editor", true)], // ditto -- must NOT minimize
  ]);

  closeAllWindowsHandler();

  assert.deepEqual(minimized.sort(), ["legacy-dialog", "user-config"]);
});

test("closeAllWindowsHandler: a client skips entirely when its own role isn't targeted", () => {
  // Every connected client runs this handler regardless of who a reveal meant to target --
  // each one has to decide for itself whether to act, based on game.user.isGM locally.
  const minimized = [];
  const mkApp = (id) => ({ id, hasFrame: true, minimize: () => minimized.push(id) });
  globalThis.ui.windows = { dialog: mkApp("dialog") };
  globalThis.foundry.applications.instances = new Map();

  globalThis.game.user.isGM = true;
  closeAllWindowsHandler({ players: true, gm: false }); // targets players only
  assert.deepEqual(minimized, [], "a GM client must not minimize anything when gm:false");

  closeAllWindowsHandler({ players: true, gm: true });
  assert.deepEqual(minimized, ["dialog"], "the same GM client acts once gm:true");

  minimized.length = 0;
  globalThis.game.user.isGM = false;
  closeAllWindowsHandler({ players: false, gm: true }); // targets GMs only
  assert.deepEqual(minimized, [], "a player client must not minimize anything when players:false");

  globalThis.game.user.isGM = false; // restore the module-wide default for later tests
});

test("closeAllWindowsHandler: no target argument defaults to acting on every role", () => {
  const minimized = [];
  globalThis.ui.windows = { dialog: { id: "dialog", hasFrame: true, minimize: () => minimized.push("dialog") } };
  globalThis.foundry.applications.instances = new Map();

  globalThis.game.user.isGM = true;
  closeAllWindowsHandler();
  assert.deepEqual(minimized, ["dialog"]);
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
  globalThis.game.user.isGM = true;
  const warnings = [];
  globalThis.ui.notifications.warn = (msg) => warnings.push(msg);

  assert.equal(beatDurationS(3000, 100, "border"), 0.5); // 30ms/beat -> clamped to 500ms
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /border/);

  warnings.length = 0;
  assert.equal(beatDurationS(3000, 6, "icon"), 0.5); // exactly the floor -- still clamps
  assert.equal(warnings.length, 0); // >= floor, not below it -- no warning

  globalThis.game.user.isGM = false; // a player's client clamps too, but stays quiet
  beatDurationS(1000, 10, "border");
  assert.equal(warnings.length, 0);
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

test("SOCKET_NAME: Foundry's own per-module channel, no third-party socket library", () => {
  assert.equal(SOCKET_NAME, "module.pause-fx");
});

test("onSocketMessage: the GM's advance resolves this client's own pending manual advance", async () => {
  // Regression: players only ever saw Foundry's plain pause screen -- the whole sequence,
  // manual slideshow advances included, ran on the GM's client alone.
  let advanced = false;
  const pending = waitForManualAdvance(new AbortController().signal).then(() => { advanced = true; });
  onSocketMessage({ action: "nonsense" }); // unknown actions are ignored
  await wait(5);
  assert.equal(advanced, false);
  onSocketMessage({ action: "advance" });
  await pending;
  assert.equal(advanced, true);
});

test("onSocketMessage: tolerates an empty/malformed payload", () => {
  assert.doesNotThrow(() => onSocketMessage());
  assert.doesNotThrow(() => onSocketMessage({}));
});

test("waitForPause: resolves true immediately when the game is already paused", async () => {
  globalThis.game.paused = true;
  assert.equal(await waitForPause(new AbortController().signal, 50), true);
  globalThis.game.paused = false;
});

test("waitForPause: resolves true once the GM's pause arrives, ignoring an unpause first", async () => {
  const pending = waitForPause(new AbortController().signal, 1000);
  Hooks.call("pauseGame", false); // not a pause -- keep waiting
  Hooks.call("pauseGame", true);
  assert.equal(await pending, true);
  assert.equal(hookListeners.get("pauseGame").size, 0, "listener must detach");
});

test("waitForPause: resolves false on timeout or abort, and detaches either way", async () => {
  assert.equal(await waitForPause(new AbortController().signal, 10), false);
  const ctl = new AbortController();
  const pending = waitForPause(ctl.signal, 1000);
  ctl.abort();
  assert.equal(await pending, false);
  assert.equal(hookListeners.get("pauseGame").size, 0);
});

test("onSocketMessage: ignores a message whose server-stamped sender isn't a GM", async () => {
  globalThis.game.users = new Map([["gm1", { isGM: true }], ["pc1", { isGM: false }]]);
  let advanced = false;
  const pending = waitForManualAdvance(new AbortController().signal).then(() => { advanced = true; });
  onSocketMessage({ action: "advance" }, "pc1");
  onSocketMessage({ action: "advance" }, "nobody");
  await wait(5);
  assert.equal(advanced, false);
  onSocketMessage({ action: "advance" }, "gm1");
  await pending;
  assert.equal(advanced, true);
  delete globalThis.game.users;
});

