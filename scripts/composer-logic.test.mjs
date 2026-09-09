// Unit tests for the Composer UI's form<->config translation -- pure logic, no DOM/Foundry
// runtime needed. See composer.js for where these get wired to actual form fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStep, stepFromRow, rowFromStep, coerceStepField, stepBadges, stepDisplayText,
  secondsToMs, msToSeconds, configFromGlobals, commandForConfig,
  hasMacroMarker, configFromCommand, stepsFromConfig,
} from "./composer-logic.js";

const BLANK_ROW = {
  waitUnits: "", text: "", textNone: false, textPulse: false,
  closeVideo: false, stopAudio: false, stopTextPulse: false,
  stopIconSpin: false, stopBorderPulse: false, unpause: false, waitForVideoEnd: false,
  waitForAudioEnd: false, waitForImageEnd: false, audio: "", audioVolume: "", audioLoop: false,
  mediaType: "none", mediaPath: "", videoVolume: "", imagePulses: "", loop: false, icon: "",
  iconNone: false, iconSpin: false, iconGlowEnabled: false, iconGlow: "#4DD0E1",
  borderColorEnabled: false, borderColor: "#4DD0E1", borderWidthPct: "",
};

test("defaultStep: a sensible seed for a freshly-added row", () => {
  assert.deepEqual(defaultStep(), { wait: { units: 1 } });
});

test("stepsFromConfig: a Composer-native config (no top-level startup fields) passes steps through", () => {
  const steps = [{ text: "hi" }, { unpause: true }];
  assert.deepEqual(stepsFromConfig({ steps }), steps);
});

test("stepsFromConfig: an empty Composer-native config seeds a single default step", () => {
  assert.deepEqual(stepsFromConfig({}), [defaultStep()]);
});

test("stepsFromConfig: top-level icon/border/text get synthesized into a prepended row 0", () => {
  const config = {
    icon: "eye.gif", iconGlow: "#960018", borderColor: "#FF0000", text: "EVERYTHING PAUSES",
    steps: [{ wait: { units: 2 }, text: "...AND SUDDENLY..." }],
  };
  assert.deepEqual(stepsFromConfig(config), [
    { icon: "eye.gif", iconGlow: "#960018", borderColor: "#FF0000", text: "EVERYTHING PAUSES" },
    { wait: { units: 2 }, text: "...AND SUDDENLY..." },
  ]);
});

test("stepsFromConfig: only the startup fields actually set are pulled into row 0", () => {
  assert.deepEqual(stepsFromConfig({ borderColor: "#FF0000", steps: [] }), [{ borderColor: "#FF0000" }]);
});

test("stepFromRow: blank optional fields are omitted, not set to '' / false", () => {
  assert.deepEqual(stepFromRow(BLANK_ROW), {});
});

test("stepFromRow: wait and text come through when set -- wait carries no clock", () => {
  const row = { ...BLANK_ROW, waitUnits: "2.5", text: "Hello" };
  assert.deepEqual(stepFromRow(row), { wait: { units: 2.5 }, text: "Hello" });
});

test("stepFromRow: textNone forces an explicit blank, even if text also has a value", () => {
  const row = { ...BLANK_ROW, textNone: true, text: "ignored" };
  assert.deepEqual(stepFromRow(row), { text: "" });
});

test("stepFromRow: textPulse starts the label's pulse independently of border activation", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, textPulse: true }), { textPulse: true });
});

test("stepFromRow: iconNone (Icon field's own None, not Stop -- hiding isn't time-sensitive) maps to iconVisible: false, same pattern as textNone", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, iconNone: true }), { iconVisible: false });
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, iconNone: false }), {});
});

test("stepFromRow: iconNone forces an explicit hide even if icon also has a value", () => {
  const row = { ...BLANK_ROW, iconNone: true, icon: "ignored.gif" };
  assert.deepEqual(stepFromRow(row), { iconVisible: false });
});

test("stepFromRow: Stop's freeze checks are per-target -- stopTextPulse/stopIconSpin/stopBorderPulse, not a shared freeze", () => {
  assert.deepEqual(
    stepFromRow({ ...BLANK_ROW, stopTextPulse: true, stopIconSpin: true, stopBorderPulse: true }),
    { stopTextPulse: true, stopIconSpin: true, stopBorderPulse: true },
  );
});

test("stepFromRow: waitForVideoEnd/waitForAudioEnd/waitForImageEnd are gates, independent of wait itself", () => {
  const row = {
    ...BLANK_ROW, waitUnits: "1", waitForVideoEnd: true, waitForAudioEnd: true, waitForImageEnd: true,
  };
  assert.deepEqual(stepFromRow(row), {
    wait: { units: 1 }, waitForVideoEnd: true, waitForAudioEnd: true, waitForImageEnd: true,
  });
});

test("stepFromRow: mediaType picks video vs. image -- video carries volume/loop, image carries imagePulses/loop", () => {
  const videoRow = { ...BLANK_ROW, mediaType: "video", mediaPath: "a.webm", videoVolume: "0.3", loop: true };
  assert.deepEqual(stepFromRow(videoRow), { video: "a.webm", videoVolume: 0.3, loop: true });

  const imageRow = { ...BLANK_ROW, mediaType: "image", mediaPath: "spooky/", imagePulses: "0", loop: true };
  assert.deepEqual(stepFromRow(imageRow), { image: "spooky/", imagePulses: 0, loop: true });
});

test("stepFromRow: audio carries its own volume and loop, independent of media fields", () => {
  const row = { ...BLANK_ROW, audio: "sting.ogg", audioVolume: "0.5", audioLoop: true };
  assert.deepEqual(stepFromRow(row), { audio: "sting.ogg", audioVolume: 0.5, audioLoop: true });
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
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, borderWidthPct: "-50" }), { borderWidth: -50 });
});

test("stepFromRow: a colour set but not enabled is left out, same as blank", () => {
  const row = { ...BLANK_ROW, iconGlow: "#123456", borderColor: "#654321" };
  assert.deepEqual(stepFromRow(row), {});
});

test("rowFromStep: fills every field with a defined default, never undefined", () => {
  const row = rowFromStep({});
  for (const value of Object.values(row)) assert.notEqual(value, undefined);
  assert.equal(row.mediaType, "none");
  assert.equal(row.iconNone, false);
});

test("stepFromRow(rowFromStep(step)) round-trips a representative step", () => {
  const steps = [
    { wait: { units: 1.45 }, text: "...AND SUDDENLY...", textPulse: true },
    { video: "reveal.webm", videoVolume: 0.5, loop: true, iconVisible: false },
    { image: "spooky/", imagePulses: 0, loop: true },
    { image: "spooky.webp" },
    { waitForImageEnd: true },
    { audio: "sting.ogg", audioVolume: 0.8, audioLoop: true, waitForAudioEnd: true },
    {
      closeVideo: true, stopAudio: true, unpause: true, stopTextPulse: true,
      stopIconSpin: true, stopBorderPulse: true,
    },
    { waitForVideoEnd: true },
    { icon: "eye.gif", iconSpin: true, iconGlow: "#960018", borderColor: "#FF0000", borderWidth: 150 },
    { text: "" }, // explicit blank
  ];
  for (const step of steps) assert.deepEqual(stepFromRow(rowFromStep(step)), step);
});

test("coerceStepField: bool fields always become real booleans", () => {
  assert.equal(coerceStepField("textPulse", true), true);
  assert.equal(coerceStepField("textPulse", ""), false); // an unchecked box's raw value
  assert.equal(coerceStepField("iconGlowEnabled", true), true);
  assert.equal(coerceStepField("iconNone", true), true);
  assert.equal(coerceStepField("waitForImageEnd", true), true);
  assert.equal(coerceStepField("loop", true), true);
});

test("coerceStepField: number fields parse, but stay '' when blank (not NaN/0)", () => {
  assert.equal(coerceStepField("waitUnits", "2.5"), 2.5);
  assert.equal(coerceStepField("waitUnits", ""), "");
  assert.equal(coerceStepField("borderWidthPct", "-50"), -50);
  assert.equal(coerceStepField("imagePulses", "0"), 0);
  assert.equal(coerceStepField("imagePulses", ""), "");
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
    waitForVideoEnd: true, waitForAudioEnd: true, waitForImageEnd: true, borderColor: "#FF0000",
    icon: "eye.gif", video: "a.webm", audio: "sting.ogg", loop: true, textPulse: true,
    stopTextPulse: true, stopIconSpin: true, stopBorderPulse: true, closeVideo: true,
    stopAudio: true, unpause: true,
  };
  assert.deepEqual(stepBadges(step), [
    { type: "waitForVideoEnd" },
    { type: "waitForAudioEnd" },
    { type: "waitForImageEnd" },
    { type: "border", colour: "#FF0000" },
    { type: "icon", icon: "eye.gif", glow: undefined, spin: false, visible: undefined },
    { type: "video" },
    { type: "audio" },
    { type: "loop" },
    { type: "textPulse" },
    { type: "stopTextPulse" },
    { type: "stopIconSpin" },
    { type: "stopBorderPulse" },
    { type: "closeVideo" },
    { type: "stopAudio" },
    { type: "unpause" },
  ]);
});

test("stepBadges: loop badge fires off audioLoop too, not just the video/image loop", () => {
  assert.deepEqual(stepBadges({ audioLoop: true }), [{ type: "loop" }]);
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

test("hasMacroMarker: true only for a command that opens with the marker", () => {
  const config = { steps: [{ text: "hi" }] };
  assert.equal(hasMacroMarker(commandForConfig(config)), true);
  assert.equal(hasMacroMarker("await game.modules.get(\"pause-fx\").api.run({});"), false);
  assert.equal(hasMacroMarker(undefined), false);
});

test("configFromCommand: round-trips commandForConfig's own output", () => {
  const config = { borderCycleMs: 3640, endCombat: true, steps: [{ text: "hi", wait: { units: 2 } }] };
  assert.deepEqual(configFromCommand(commandForConfig(config)), config);
});

test("configFromCommand: null for a command with no marker, even if it calls run() the same way", () => {
  const config = { steps: [] };
  const unmarked = commandForConfig(config).replace(/^.*\n/, ""); // drop just the marker line
  assert.equal(configFromCommand(unmarked), null);
});

test("configFromCommand: null (not a throw) for a marked command whose JSON is broken", () => {
  const broken = ['/** @pause-fx-sequence */', "await game.modules.get(\"pause-fx\").api.run({not: valid json});"].join("\n");
  assert.equal(configFromCommand(broken), null);
});
