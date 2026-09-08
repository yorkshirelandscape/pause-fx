// Unit tests for the Composer UI's form<->config translation -- pure logic, no DOM/Foundry
// runtime needed. See composer.js for where these get wired to actual form fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStep, stepFromRow, rowFromStep, coerceStepField, stepBadges, stepDisplayText,
  secondsToMs, msToSeconds, configFromGlobals, commandForConfig,
} from "./composer-logic.js";

const BLANK_ROW = {
  waitUnits: "", text: "", textNone: false, freeze: false, resume: false,
  iconVisibility: "", closeVideo: false, stopAudio: false, unpause: false,
  waitForVideoEnd: false, waitForAudioEnd: false, audio: "", audioVolume: "",
  mediaType: "none", mediaPath: "", videoVolume: "", icon: "", iconSpin: false,
  iconGlowEnabled: false, iconGlow: "#ff0000", borderColorEnabled: false,
  borderColor: "#ff0000", borderWidthPct: "",
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

test("stepFromRow: iconVisibility picks hidden vs. visible vs. untouched", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, iconVisibility: "hidden" }), { iconVisible: false });
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, iconVisibility: "visible" }), { iconVisible: true });
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, iconVisibility: "" }), {});
});

test("stepFromRow: waitForVideoEnd/waitForAudioEnd are gates, independent of wait itself", () => {
  const row = { ...BLANK_ROW, waitUnits: "1", waitForVideoEnd: true, waitForAudioEnd: true };
  assert.deepEqual(stepFromRow(row), { wait: { units: 1 }, waitForVideoEnd: true, waitForAudioEnd: true });
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

test("stepFromRow: stopAudio is the audio equivalent of closeVideo -- its own step, own field", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, stopAudio: true }), { stopAudio: true });
});

test("stepFromRow: unpause is its own field, same 'Stop' block as closeVideo/stopAudio", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, unpause: true }), { unpause: true });
  assert.deepEqual(
    stepFromRow({ ...BLANK_ROW, closeVideo: true, stopAudio: true, unpause: true }),
    { closeVideo: true, stopAudio: true, unpause: true },
  );
});

test("stepFromRow: icon/glow/border/spin/width -- same rules as the old startup fields, now per-step", () => {
  const row = {
    ...BLANK_ROW, icon: "eye.gif", iconSpin: true, iconGlowEnabled: true, iconGlow: "#00ff00",
    borderColorEnabled: true, borderColor: "#0000ff", borderWidthPct: "150",
  };
  assert.deepEqual(stepFromRow(row), {
    icon: "eye.gif", iconSpin: true, iconGlow: "#00ff00", borderColor: "#0000ff", borderWidth: 150,
  });
});

test("stepFromRow: borderWidth works even without borderColorEnabled -- resizing a glow set earlier", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, borderWidthPct: "50" }), { borderWidth: 50 });
});

test("stepFromRow: a colour set but not enabled is left out, same as blank", () => {
  const row = { ...BLANK_ROW, iconGlow: "#123456", borderColor: "#654321" };
  assert.deepEqual(stepFromRow(row), {});
});

test("rowFromStep: fills every field with a defined default, never undefined", () => {
  const row = rowFromStep({});
  for (const value of Object.values(row)) assert.notEqual(value, undefined);
  assert.equal(row.mediaType, "none");
  assert.equal(row.iconVisibility, "");
});

test("stepFromRow(rowFromStep(step)) round-trips a representative step", () => {
  const steps = [
    { wait: { units: 1.45 }, text: "...AND SUDDENLY...", freeze: true },
    { video: "father-skinsaw.webm", videoVolume: 0.5, iconVisible: false },
    { image: "spooky.webp" },
    { audio: "sting.ogg", audioVolume: 0.8, waitForAudioEnd: true },
    { closeVideo: true, stopAudio: true, unpause: true, iconVisible: true, resume: true },
    { waitForVideoEnd: true },
    { icon: "eye.gif", iconSpin: true, iconGlow: "#960018", borderColor: "#FF0000", borderWidth: 150 },
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
  assert.equal(coerceStepField("borderWidthPct", "150"), 150);
});

test("coerceStepField: everything else passes through untouched", () => {
  assert.equal(coerceStepField("text", "hello"), "hello");
  assert.equal(coerceStepField("mediaType", "video"), "video");
  assert.equal(coerceStepField("borderColor", "#ff0000"), "#ff0000");
  assert.equal(coerceStepField("iconVisibility", "hidden"), "hidden");
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
    waitForVideoEnd: true, waitForAudioEnd: true, borderColor: "#FF0000", icon: "eye.gif",
    video: "a.webm", audio: "sting.ogg", freeze: true, closeVideo: true, stopAudio: true,
    unpause: true,
  };
  assert.deepEqual(stepBadges(step), [
    { type: "waitForVideoEnd" },
    { type: "waitForAudioEnd" },
    { type: "border", colour: "#FF0000" },
    { type: "icon", icon: "eye.gif", glow: undefined, spin: false, visible: undefined },
    { type: "video" },
    { type: "audio" },
    { type: "freeze" },
    { type: "closeVideo" },
    { type: "stopAudio" },
    { type: "unpause" },
  ]);
});

test("stepBadges: an icon badge appears even with only glow/spin/visibility set, no icon path", () => {
  assert.deepEqual(
    stepBadges({ iconSpin: true }),
    [{ type: "icon", icon: undefined, glow: undefined, spin: true, visible: undefined }],
  );
  assert.deepEqual(
    stepBadges({ iconVisible: false }),
    [{ type: "icon", icon: undefined, glow: undefined, spin: false, visible: false }],
  );
});

test("stepDisplayText: explicit '' reads as none, otherwise the real text, then ''", () => {
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

test("configFromGlobals: endCombat and closeAllWindows are Startup-only, not per-step", () => {
  assert.deepEqual(
    configFromGlobals({ pulseLengthS: "", endCombat: true }, []),
    { steps: [], endCombat: true },
  );
  assert.deepEqual(
    configFromGlobals({ pulseLengthS: "", closeWindowsPlayers: true }, []),
    { steps: [], closeAllWindows: { players: true, gm: false } },
  );
  assert.deepEqual(
    configFromGlobals({ pulseLengthS: "", closeWindowsGM: true }, []),
    { steps: [], closeAllWindows: { players: false, gm: true } },
  );
  // neither set -- omitted entirely, same as the other optional globals
  assert.deepEqual(configFromGlobals({ pulseLengthS: "" }, []), { steps: [] });
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
