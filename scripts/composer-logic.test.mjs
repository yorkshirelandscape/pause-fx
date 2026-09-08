// Unit tests for the Composer UI's form<->config translation -- pure logic, no DOM/Foundry
// runtime needed. See composer.js for where these get wired to actual form fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStep, stepFromRow, rowFromStep, coerceStepField, stepBadges, stepDisplayText,
  secondsToMs, msToSeconds, configFromGlobals, commandForConfig,
} from "./composer-logic.js";

const BLANK_ROW = {
  waitUnits: "", waitForVideoEnd: false, text: "", textNone: false, freeze: false,
  resume: false, hideIcon: false, showIcon: false, blankText: false, closeVideo: false,
  audio: "", audioVolume: "", mediaType: "none", mediaPath: "", videoVolume: "", macro: "",
  icon: "", iconSpin: false, iconGlowEnabled: false, iconGlow: "#ff0000",
  borderColorEnabled: false, borderColor: "#ff0000", endCombat: false,
  closeWindowsPlayers: false, closeWindowsGM: false,
};

test("defaultStep: a sensible seed for a freshly-added row", () => {
  assert.deepEqual(defaultStep(), { wait: { units: 1 } });
});

test("stepFromRow: blank optional fields are omitted, not set to '' / false", () => {
  assert.deepEqual(stepFromRow(BLANK_ROW), {});
});

test("stepFromRow: wait, text and flags all come through when set -- wait carries no clock", () => {
  const row = { ...BLANK_ROW, waitUnits: "2.5", text: "Hello", freeze: true };
  assert.deepEqual(stepFromRow(row), { wait: { units: 2.5 }, text: "Hello", freeze: true });
});

test("stepFromRow: textNone forces an explicit blank, even if text also has a value", () => {
  const row = { ...BLANK_ROW, textNone: true, text: "ignored" };
  assert.deepEqual(stepFromRow(row), { text: "" });
});

test("stepFromRow: mediaType picks video vs. image, and only carries videoVolume for video", () => {
  const videoRow = { ...BLANK_ROW, mediaType: "video", mediaPath: "a.webm", videoVolume: "0.3" };
  assert.deepEqual(stepFromRow(videoRow), { video: "a.webm", videoVolume: 0.3 });

  const imageRow = { ...videoRow, mediaType: "image", mediaPath: "a.webp", videoVolume: "" };
  assert.deepEqual(stepFromRow(imageRow), { image: "a.webp" });
});

test("stepFromRow: audio carries its own volume, independent of media fields", () => {
  const row = { ...BLANK_ROW, audio: "sting.ogg", audioVolume: "0.5" };
  assert.deepEqual(stepFromRow(row), { audio: "sting.ogg", audioVolume: 0.5 });
});

test("stepFromRow: icon/glow/border/spin -- same rules as the old startup fields, now per-step", () => {
  const row = {
    ...BLANK_ROW, icon: "eye.gif", iconSpin: true,
    iconGlowEnabled: true, iconGlow: "#00ff00", borderColorEnabled: true, borderColor: "#0000ff",
  };
  assert.deepEqual(stepFromRow(row), {
    icon: "eye.gif", iconSpin: true, iconGlow: "#00ff00", borderColor: "#0000ff",
  });
});

test("stepFromRow: a colour set but not enabled is left out, same as blank", () => {
  const row = { ...BLANK_ROW, iconGlow: "#123456", borderColor: "#654321" };
  assert.deepEqual(stepFromRow(row), {});
});

test("stepFromRow: endCombat and closeAllWindows are per-step now too", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, endCombat: true }), { endCombat: true });
  assert.deepEqual(
    stepFromRow({ ...BLANK_ROW, closeWindowsPlayers: true }),
    { closeAllWindows: { players: true, gm: false } },
  );
});

test("rowFromStep: fills every field with a defined default, never undefined", () => {
  const row = rowFromStep({});
  for (const value of Object.values(row)) assert.notEqual(value, undefined);
  assert.equal(row.mediaType, "none");
});

test("stepFromRow(rowFromStep(step)) round-trips a representative step", () => {
  const steps = [
    { wait: { units: 1.45 }, text: "...AND SUDDENLY...", freeze: true },
    { video: "father-skinsaw.webm", videoVolume: 0.5, hideIcon: true },
    { image: "spooky.webp" },
    { audio: "sting.ogg", audioVolume: 0.8 },
    { macro: "Chandelier Falls" },
    { closeVideo: true, showIcon: true, resume: true },
    { waitForVideoEnd: true },
    { icon: "eye.gif", iconSpin: true, iconGlow: "#960018", borderColor: "#FF0000" },
    { endCombat: true, closeAllWindows: { players: true, gm: false } },
    { text: "" }, // explicit blank
  ];
  for (const step of steps) assert.deepEqual(stepFromRow(rowFromStep(step)), step);
});

test("coerceStepField: bool fields always become real booleans", () => {
  assert.equal(coerceStepField("freeze", true), true);
  assert.equal(coerceStepField("freeze", ""), false); // an unchecked box's raw value
  assert.equal(coerceStepField("iconGlowEnabled", true), true);
});

test("coerceStepField: number fields parse, but stay '' when blank (not NaN/0)", () => {
  assert.equal(coerceStepField("waitUnits", "2.5"), 2.5);
  assert.equal(coerceStepField("waitUnits", ""), "");
});

test("coerceStepField: everything else passes through untouched", () => {
  assert.equal(coerceStepField("text", "hello"), "hello");
  assert.equal(coerceStepField("mediaType", "video"), "video");
  assert.equal(coerceStepField("borderColor", "#ff0000"), "#ff0000");
});

test("secondsToMs / msToSeconds round-trip and secondsToMs rounds to whole ms", () => {
  assert.equal(secondsToMs("3.64"), 3640);
  assert.equal(secondsToMs(3.6401), 3640); // rounds -- borderCycleMs is always a whole ms count
  assert.equal(msToSeconds(3640), 3.64);
});

test("stepBadges: empty step has no badges", () => {
  assert.deepEqual(stepBadges({}), []);
});

test("stepBadges: wait renders in real seconds when pulseLengthS is given, else raw pulse units", () => {
  assert.deepEqual(stepBadges({ wait: { units: 2 } }, "3.64"), [{ type: "wait", label: "7.3s" }]);
  assert.deepEqual(stepBadges({ wait: { units: 2 } }), [{ type: "wait", label: "2x" }]);
});

test("stepBadges: one badge per active field, in a stable order", () => {
  const step = {
    endCombat: true, closeAllWindows: { players: true, gm: true }, borderColor: "#FF0000",
    icon: "eye.gif", video: "a.webm", audio: "sting.ogg", macro: "Chandelier Falls", freeze: true,
  };
  assert.deepEqual(stepBadges(step), [
    { type: "endCombat" },
    { type: "closeWindows" },
    { type: "border", colour: "#FF0000" },
    { type: "icon", icon: "eye.gif", glow: undefined, spin: false },
    { type: "video" },
    { type: "audio" },
    { type: "macro", label: "Chandelier Falls" },
    { type: "freeze" },
  ]);
});

test("stepBadges: an icon badge appears even with only glow/spin set, no icon path", () => {
  assert.deepEqual(stepBadges({ iconSpin: true }), [{ type: "icon", icon: undefined, glow: undefined, spin: true }]);
});

test("stepDisplayText: blankText wins, then explicit '', then the real text, then ''", () => {
  assert.equal(stepDisplayText({ blankText: true, text: "ignored" }), "(blank)");
  assert.equal(stepDisplayText({ text: "" }), "(none)");
  assert.equal(stepDisplayText({ text: "hi" }), "hi");
  assert.equal(stepDisplayText({}), "");
});

test("configFromGlobals: blank pulseLengthS is omitted", () => {
  assert.deepEqual(configFromGlobals({ pulseLengthS: "" }, []), { steps: [] });
});

test("configFromGlobals: pulseLengthS converts to borderCycleMs in whole ms", () => {
  assert.deepEqual(configFromGlobals({ pulseLengthS: "3.64" }, []), { steps: [], borderCycleMs: 3640 });
});

test("configFromGlobals: passes steps through untouched", () => {
  const steps = [{ text: "hi" }];
  assert.deepEqual(configFromGlobals({ pulseLengthS: "" }, steps), { steps });
});

test("commandForConfig: guards on the module being active, then calls the real API with the config", () => {
  const config = { borderCycleMs: 3640, steps: [{ text: "hi" }] };
  const command = commandForConfig(config);
  assert.match(command, /game\.modules\.get\("pause-fx"\)\?\.active/);
  assert.match(command, /ui\.notifications\.error/);
  assert.match(command, /game\.modules\.get\("pause-fx"\)\.api\.run\(/);
  // The embedded JSON has to be the exact config, parseable back out -- not just
  // string-matched fragments, in case key order or formatting ever drifts.
  const jsonMatch = command.match(/api\.run\((\{[\s\S]*\})\);$/);
  assert.deepEqual(JSON.parse(jsonMatch[1]), config);
});
