// Unit tests for the Composer UI's form<->config translation -- pure logic, no DOM/Foundry
// runtime needed. See composer.js for where these get wired to actual form fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStep, stepFromRow, rowFromStep, coerceStepField, stepSummary, configFromGlobals,
} from "./composer-logic.js";

test("defaultStep: a sensible seed for a freshly-added row", () => {
  assert.deepEqual(defaultStep(), { wait: { units: 1, clock: "border" } });
});

test("stepFromRow: blank optional fields are omitted, not set to '' / false", () => {
  const row = {
    waitUnits: "", waitClock: "border", waitForVideoEnd: false, text: "", freeze: false,
    resume: false, hideIcon: false, showIcon: false, blankText: false, closeVideo: false,
    audio: "", audioVolume: "", mediaType: "none", mediaPath: "", videoVolume: "", macro: "",
  };
  assert.deepEqual(stepFromRow(row), {});
});

test("stepFromRow: wait, text and flags all come through when set", () => {
  const row = {
    waitUnits: "2.5", waitClock: "text", waitForVideoEnd: false, text: "Hello", freeze: true,
    resume: false, hideIcon: false, showIcon: false, blankText: false, closeVideo: false,
    audio: "", audioVolume: "", mediaType: "none", mediaPath: "", videoVolume: "", macro: "",
  };
  assert.deepEqual(stepFromRow(row), { wait: { units: 2.5, clock: "text" }, text: "Hello", freeze: true });
});

test("stepFromRow: mediaType picks video vs. image, and only carries videoVolume for video", () => {
  const videoRow = {
    waitUnits: "", waitClock: "border", waitForVideoEnd: false, text: "", freeze: false,
    resume: false, hideIcon: false, showIcon: false, blankText: false, closeVideo: false,
    audio: "", audioVolume: "", mediaType: "video", mediaPath: "a.webm", videoVolume: "0.3", macro: "",
  };
  assert.deepEqual(stepFromRow(videoRow), { video: "a.webm", videoVolume: 0.3 });

  const imageRow = { ...videoRow, mediaType: "image", mediaPath: "a.webp", videoVolume: "" };
  assert.deepEqual(stepFromRow(imageRow), { image: "a.webp" });
});

test("stepFromRow: audio carries its own volume, independent of media fields", () => {
  const row = {
    waitUnits: "", waitClock: "border", waitForVideoEnd: false, text: "", freeze: false,
    resume: false, hideIcon: false, showIcon: false, blankText: false, closeVideo: false,
    audio: "sting.ogg", audioVolume: "0.5", mediaType: "none", mediaPath: "", videoVolume: "", macro: "",
  };
  assert.deepEqual(stepFromRow(row), { audio: "sting.ogg", audioVolume: 0.5 });
});

test("rowFromStep: fills every field with a defined default, never undefined", () => {
  const row = rowFromStep({});
  for (const value of Object.values(row)) assert.notEqual(value, undefined);
  assert.equal(row.waitClock, "border");
  assert.equal(row.mediaType, "none");
});

test("stepFromRow(rowFromStep(step)) round-trips a representative step", () => {
  const steps = [
    { wait: { units: 1.45, clock: "text" }, text: "...AND SUDDENLY...", freeze: true },
    { video: "father-skinsaw.webm", videoVolume: 0.5, hideIcon: true },
    { image: "spooky.webp" },
    { audio: "sting.ogg", audioVolume: 0.8 },
    { macro: "Chandelier Falls" },
    { closeVideo: true, showIcon: true, resume: true },
    { waitForVideoEnd: true },
  ];
  for (const step of steps) assert.deepEqual(stepFromRow(rowFromStep(step)), step);
});

test("coerceStepField: bool fields always become real booleans", () => {
  assert.equal(coerceStepField("freeze", true), true);
  assert.equal(coerceStepField("freeze", ""), false); // an unchecked box's raw value
});

test("coerceStepField: number fields parse, but stay '' when blank (not NaN/0)", () => {
  assert.equal(coerceStepField("waitUnits", "2.5"), 2.5);
  assert.equal(coerceStepField("waitUnits", ""), "");
});

test("coerceStepField: everything else passes through untouched", () => {
  assert.equal(coerceStepField("text", "hello"), "hello");
  assert.equal(coerceStepField("mediaType", "video"), "video");
});

const SUMMARY_CASES = [
  { step: {}, expected: "(empty step)" },
  { step: { wait: { units: 2, clock: "text" } }, expected: "wait 2× text" },
  { step: { wait: { units: 1 } }, expected: "wait 1× border" }, // clock defaults for display too
  { step: { text: "A MANNEQUIN BEGINS TO TWITCH" }, expected: 'text: "A MANNEQUIN BEGINS TO TWITCH"' },
  { step: { audio: "curtain-call/audio/sting.ogg" }, expected: "audio: sting.ogg" }, // basename only
  { step: { video: "art/bk2/father-skinsaw.webm", hideIcon: true }, expected: "hide icon · video: father-skinsaw.webm" },
  { step: { macro: "Chandelier Falls" }, expected: "macro: Chandelier Falls" },
];
for (const { step, expected } of SUMMARY_CASES) {
  test(`stepSummary: ${expected}`, () => assert.equal(stepSummary(step), expected));
}

test("configFromGlobals: blank optional globals are omitted", () => {
  const globals = {
    icon: "", iconGlow: "", borderColor: "", text: "", borderCycleMs: "", textCycleMs: "",
    textCycleMultiplier: "", closeAllWindows: false, endCombat: false,
  };
  assert.deepEqual(configFromGlobals(globals, []), { steps: [] });
});

test("configFromGlobals: numeric fields parse, checkboxes only appear when true", () => {
  const globals = {
    icon: "art/eye.gif", iconGlow: "red", borderColor: "#960018", text: "", borderCycleMs: "3640",
    textCycleMs: "", textCycleMultiplier: "2", closeAllWindows: true, endCombat: false,
  };
  const steps = [{ text: "hi" }];
  assert.deepEqual(configFromGlobals(globals, steps), {
    steps, icon: "art/eye.gif", iconGlow: "red", borderColor: "#960018",
    borderCycleMs: 3640, textCycleMultiplier: 2, closeAllWindows: true,
  });
});
