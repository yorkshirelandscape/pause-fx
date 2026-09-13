// Unit tests for the Composer UI's form<->config translation -- pure logic, no DOM/Foundry
// runtime needed. See composer.js for where these get wired to actual form fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultStep, stepFromRow, rowFromStep, coerceStepField, stepBadges, stepDisplayText,
  secondsToMs, msToSeconds, configFromGlobals, commandForConfig, formatBeatsPerCycle, formatMixedFraction,
  hasMacroMarker, configFromCommand, stepsFromConfig, effectiveIconVisible, effectiveMediaType,
  effectiveIconSpin, effectiveTextPulse, effectiveIcon, effectiveText,
} from "./composer-logic.js";

const BLANK_ROW = {
  waitUnits: "", preAvUnits: "", postAvUnits: "",
  text: "", textNone: false, textPulse: false, textFade: false,
  stopAudio: false, stopTextPulse: false, stopTextFade: false,
  stopIconSpin: false, stopBorderPulse: false, unpause: false,
  waitForAudioEnd: false, audio: "", audioVolume: "", audioLoop: false,
  mediaType: "none", mediaPath: "", videoVolume: "", imagePulses: "", loop: false, icon: "",
  iconNone: false, iconSpin: false, iconGlowEnabled: false, iconGlow: "#4DD0E1",
  borderColorEnabled: false, borderColor: "#4DD0E1", borderWidthPct: "",
  iconBeatsPerCycle: "", textBeatsPerCycle: "", borderBeatsPerCycle: "",
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

test("effectiveIconVisible: visible by default when nothing before it ever set one", () => {
  assert.equal(effectiveIconVisible([]), true);
  assert.equal(effectiveIconVisible([{ text: "hi" }, { borderColor: "#FF0000" }]), true);
});

test("effectiveIconVisible: carries forward the nearest earlier explicit value", () => {
  assert.equal(effectiveIconVisible([{ iconVisible: false }, { text: "hi" }]), false);
  assert.equal(effectiveIconVisible([{ iconVisible: false }, { iconVisible: true }, { text: "hi" }]), true);
});

test("effectiveIconSpin/effectiveTextPulse: on by default, carry forward the nearest explicit value", () => {
  assert.equal(effectiveIconSpin([]), true);
  assert.equal(effectiveIconSpin([{ iconSpin: false }, { text: "hi" }]), false);
  assert.equal(effectiveIconSpin([{ iconSpin: false }, { iconSpin: true }, { text: "hi" }]), true);
  assert.equal(effectiveTextPulse([]), true);
  assert.equal(effectiveTextPulse([{ textPulse: false }, { text: "hi" }]), false);
  assert.equal(effectiveTextPulse([{ textPulse: false }, { textPulse: true }, { text: "hi" }]), true);
});

test("effectiveIcon/effectiveText: default to Foundry's own real ones, inclusive of the step itself", () => {
  assert.equal(effectiveIcon([{}]), "ui/pause.svg");
  assert.equal(effectiveIcon([{ icon: "custom.svg" }, {}]), "custom.svg"); // carries forward
  assert.equal(effectiveIcon([{ icon: "custom.svg" }, { icon: "newer.svg" }]), "newer.svg"); // wins outright
  assert.equal(effectiveText([{}]), "GAME PAUSED");
  assert.equal(effectiveText([{ text: "hi" }, {}]), "hi");
  assert.equal(effectiveText([{ text: "hi" }, { text: "" }]), ""); // explicit blank carries forward too
});

// iconSpin/textPulse are always concrete now too (see stepFromRow itself) -- shorthand for
// the pair every expected object below carries alongside iconVisible.
const ON = { iconSpin: true, textPulse: true };
const OFF = { iconSpin: false, textPulse: false };

test("stepFromRow: blank optional fields are omitted, not set to '' / false", () => {
  // Icon visibility, spin and pulse are the exceptions -- see the iconNone tests below for why.
  assert.deepEqual(stepFromRow(BLANK_ROW), { iconVisible: true, ...OFF });
});

test("stepFromRow: wait and text come through when set", () => {
  const row = { ...BLANK_ROW, waitUnits: "2.5", text: "Hello" };
  assert.deepEqual(stepFromRow(row), { wait: { units: 2.5 }, text: "Hello", iconVisible: true, ...OFF });
});

test("stepFromRow: textNone forces an explicit blank, even if text also has a value", () => {
  const row = { ...BLANK_ROW, textNone: true, text: "ignored" };
  assert.deepEqual(stepFromRow(row), { text: "", iconVisible: true, ...OFF });
});

test("stepFromRow: textPulse starts the label's pulse independently of border activation", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, textPulse: true }), { iconVisible: true, iconSpin: false, textPulse: true });
});

test("stepFromRow: iconNone (Icon field's own None, not Stop -- hiding isn't time-sensitive) is always a concrete iconVisible, never omitted", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, iconNone: true }), { iconVisible: false, ...OFF });
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, iconNone: false }), { iconVisible: true, ...OFF });
});

test("stepFromRow: iconNone forces an explicit hide even if icon also has a value", () => {
  const row = { ...BLANK_ROW, iconNone: true, icon: "ignored.gif" };
  assert.deepEqual(stepFromRow(row), { iconVisible: false, ...OFF });
});

test("stepFromRow: unchecked None keeps the icon path", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, icon: "eye.gif" }), { iconVisible: true, icon: "eye.gif", ...OFF });
});

test("stepFromRow: Stop's freeze checks are per-target -- stopTextPulse/stopIconSpin/stopBorderPulse, not a shared freeze", () => {
  assert.deepEqual(
    stepFromRow({ ...BLANK_ROW, stopTextPulse: true, stopIconSpin: true, stopBorderPulse: true }),
    { stopTextPulse: true, stopIconSpin: true, stopBorderPulse: true, iconVisible: true, ...OFF },
  );
});

test("stepFromRow: preAV/postAV carry through independently of wait itself", () => {
  const row = { ...BLANK_ROW, waitUnits: "1", preAvUnits: "0.5", postAvUnits: "1.5" };
  assert.deepEqual(stepFromRow(row), {
    wait: { units: 1 }, preAV: { units: 0.5 }, postAV: { units: 1.5 }, iconVisible: true, ...OFF,
  });
});

test("stepFromRow: waitForAudioEnd binds audio to this step's AV lifecycle -- same field, new meaning", () => {
  const row = { ...BLANK_ROW, audio: "sting.ogg", waitForAudioEnd: true };
  assert.deepEqual(stepFromRow(row), { audio: "sting.ogg", waitForAudioEnd: true, iconVisible: true, ...OFF });
});

test("stepFromRow: mediaType picks video vs. image -- video carries volume/loop, image carries imagePulses/loop", () => {
  const videoRow = { ...BLANK_ROW, mediaType: "video", mediaPath: "a.webm", videoVolume: "0.3", loop: true };
  assert.deepEqual(stepFromRow(videoRow), { video: "a.webm", videoVolume: 0.3, loop: true, iconVisible: true, ...OFF });

  const imageRow = { ...BLANK_ROW, mediaType: "image", mediaPath: "spooky/", imagePulses: "0", loop: true };
  assert.deepEqual(stepFromRow(imageRow), { image: "spooky/", imagePulses: 0, loop: true, iconVisible: true, ...OFF });
});

test("effectiveMediaType: the switch has two positions -- only an explicit 'video' isn't image", () => {
  assert.equal(effectiveMediaType("video"), "video");
  assert.equal(effectiveMediaType("image"), "image");
  assert.equal(effectiveMediaType("none"), "image"); // a row that never touched the switch
  assert.equal(effectiveMediaType(undefined), "image");
});

test("stepFromRow: a path on an untouched switch still saves, as the image it shows on screen", () => {
  // Regression: the switch renders in its image position for a blank row, but the row's own
  // mediaType stays "none" until it's actually toggled -- media typed in was silently dropped.
  const row = { ...BLANK_ROW, mediaType: "none", mediaPath: "spooky.webp", imagePulses: "2" };
  assert.deepEqual(stepFromRow(row), { image: "spooky.webp", imagePulses: 2, iconVisible: true, ...OFF });
});

test("stepFromRow: a blank path saves no media at all, whatever the switch says", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, mediaType: "video" }), { iconVisible: true, ...OFF });
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, mediaType: "image" }), { iconVisible: true, ...OFF });
});

test("stepFromRow: a real 0 is a value, not a blank -- pulses, volumes and widths all keep it", () => {
  const row = {
    ...BLANK_ROW, waitUnits: 0, preAvUnits: 0, postAvUnits: 0, borderWidthPct: 0,
    audio: "sting.ogg", audioVolume: 0, mediaType: "video", mediaPath: "a.webm", videoVolume: 0,
  };
  assert.deepEqual(stepFromRow(row), {
    wait: { units: 0 }, preAV: { units: 0 }, postAV: { units: 0 }, borderWidth: 0,
    audio: "sting.ogg", audioVolume: 0, video: "a.webm", videoVolume: 0, iconVisible: true, ...OFF,
  });
});

test("stepFromRow: audio carries its own volume and loop, independent of media fields", () => {
  const row = { ...BLANK_ROW, audio: "sting.ogg", audioVolume: "0.5", audioLoop: true };
  assert.deepEqual(stepFromRow(row), { audio: "sting.ogg", audioVolume: 0.5, audioLoop: true, iconVisible: true, ...OFF });
});

test("stepFromRow: stopAudio is its own field -- explicitly stops detached audio a later step started", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, stopAudio: true }), { stopAudio: true, iconVisible: true, ...OFF });
});

test("stepFromRow: unpause is its own field, same 'Stop' block as stopAudio", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, unpause: true }), { unpause: true, iconVisible: true, ...OFF });
  assert.deepEqual(
    stepFromRow({ ...BLANK_ROW, stopAudio: true, unpause: true }),
    { stopAudio: true, unpause: true, iconVisible: true, ...OFF },
  );
});

test("stepFromRow: icon/glow/border/spin/width -- same rules as the old startup fields, now per-step", () => {
  const row = {
    ...BLANK_ROW, icon: "eye.gif", iconSpin: true, iconGlowEnabled: true, iconGlow: "#00ff00",
    borderColorEnabled: true, borderColor: "#0000ff", borderWidthPct: "150",
  };
  assert.deepEqual(stepFromRow(row), {
    icon: "eye.gif", iconSpin: true, iconGlow: "#00ff00", borderColor: "#0000ff", borderWidth: 150,
    iconVisible: true, textPulse: false,
  });
});

test("stepFromRow: borderWidth works even without borderColorEnabled -- resizing a glow set earlier", () => {
  assert.deepEqual(stepFromRow({ ...BLANK_ROW, borderWidthPct: "-50" }), { borderWidth: -50, iconVisible: true, ...OFF });
});

test("stepFromRow: a colour set but not enabled is left out, same as blank", () => {
  const row = { ...BLANK_ROW, iconGlow: "#123456", borderColor: "#654321" };
  assert.deepEqual(stepFromRow(row), { iconVisible: true, ...OFF });
});

test("stepFromRow: icon/text/border beats-per-cycle are independent per-step overrides", () => {
  const row = { ...BLANK_ROW, iconBeatsPerCycle: "2", textBeatsPerCycle: "0.5", borderBeatsPerCycle: "1.5" };
  assert.deepEqual(stepFromRow(row), {
    iconVisible: true, iconBeatsPerCycle: 2, textBeatsPerCycle: 0.5, borderBeatsPerCycle: 1.5, ...OFF,
  });
});

test("rowFromStep: fills every field with a defined default, never undefined", () => {
  const row = rowFromStep({});
  for (const value of Object.values(row)) assert.notEqual(value, undefined);
  assert.equal(row.mediaType, "none");
  assert.equal(row.iconNone, false);
});

test("stepFromRow(rowFromStep(step)) round-trips a representative step", () => {
  // iconVisible/iconSpin/textPulse are included on every entry now -- all three are always
  // concrete, so a step missing one wouldn't actually round-trip (see rowFromStep's own JSDoc).
  const steps = [
    { wait: { units: 1.45 }, text: "...AND SUDDENLY...", iconVisible: true, iconSpin: false, textPulse: true },
    { wait: { units: 4 }, text: "A MANNEQUIN BEGINS TO TWITCH", iconVisible: true, ...OFF },
    { video: "reveal.webm", videoVolume: 0.5, loop: true, iconVisible: false, ...OFF },
    { preAV: { units: 0.5 }, video: "reveal.webm", iconVisible: true, borderColor: "#FF0000", ...OFF },
    { postAV: { units: 1.5 }, iconVisible: true, ...OFF },
    { image: "spooky/", imagePulses: 0, loop: true, iconVisible: true, ...OFF },
    { image: "spooky.webp", iconVisible: true, ...OFF },
    { audio: "sting.ogg", audioVolume: 0.8, audioLoop: true, waitForAudioEnd: true, iconVisible: true, ...OFF },
    {
      stopAudio: true, unpause: true, stopTextPulse: true,
      stopIconSpin: true, stopBorderPulse: true, iconVisible: true, ...OFF,
    },
    {
      icon: "eye.gif", iconGlow: "#960018", borderColor: "#FF0000", borderWidth: 150,
      iconVisible: true, iconSpin: true, textPulse: false,
    },
    { text: "", iconVisible: true, ...OFF }, // explicit blank
    { iconBeatsPerCycle: 2, textBeatsPerCycle: 0.5, borderBeatsPerCycle: 1, iconVisible: true, ...OFF },
  ];
  for (const step of steps) assert.deepEqual(stepFromRow(rowFromStep(step)), step);
});

test("coerceStepField: bool fields always become real booleans", () => {
  assert.equal(coerceStepField("textPulse", true), true);
  assert.equal(coerceStepField("textPulse", ""), false); // an unchecked box's raw value
  assert.equal(coerceStepField("iconGlowEnabled", true), true);
  assert.equal(coerceStepField("iconNone", true), true);
  assert.equal(coerceStepField("waitForAudioEnd", true), true);
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
  assert.equal(secondsToMs(3.6401), 3640); // rounds -- cycleMs is always a whole ms count
  assert.equal(msToSeconds(3640), 3.64);
});

test("stepBadges: empty step has no badges", () => {
  assert.deepEqual(stepBadges({}), []);
});

test("stepBadges: wait renders in real seconds when pulseLengthS is given, else raw pulse units", () => {
  assert.deepEqual(stepBadges({ wait: { units: 2 } }, "3.64"), [{ type: "wait", label: "7.3s" }]);
  assert.deepEqual(stepBadges({ wait: { units: 2 } }), [{ type: "wait", label: "2×" }]);
});

test("stepBadges: one badge per active field, in a stable order", () => {
  const step = {
    preAV: { units: 0.5 }, wait: { units: 2 }, postAV: { units: 1.5 },
    waitForAudioEnd: true, borderColor: "#FF0000",
    icon: "eye.gif", video: "a.webm", audio: "sting.ogg", loop: true, textPulse: true,
    stopTextPulse: true, stopIconSpin: true, stopBorderPulse: true,
    stopAudio: true, unpause: true,
  };
  assert.deepEqual(stepBadges(step), [
    { type: "preAV", label: "½×" },
    { type: "avType", mediaType: "video", label: "2×" },
    { type: "postAV", label: "1½×" },
    { type: "audioBound" },
    { type: "border", colour: "#FF0000" },
    { type: "icon", icon: "eye.gif", glow: undefined, spin: false, visible: undefined },
    { type: "audio" },
    { type: "loop" },
    { type: "textPulse" },
    { type: "stopTextPulse" },
    { type: "stopIconSpin" },
    { type: "stopBorderPulse" },
    { type: "stopAudio" },
    { type: "unpause" },
  ]);
});

test("stepBadges: audio alone (not bound) still gets the plain audio badge, no audioBound", () => {
  assert.deepEqual(stepBadges({ audio: "sting.ogg" }), [{ type: "audio" }]);
});

test("stepBadges: a media step with no Duration override gets a bare type glyph, no orange badge", () => {
  assert.deepEqual(
    stepBadges({ preAV: { units: 0.5 }, video: "a.webm", postAV: { units: 1.5 } }),
    [{ type: "preAV", label: "½×" }, { type: "video" }, { type: "postAV", label: "1½×" }],
  );
});

test("stepBadges: bound audio with no video/image claims the avType cluster itself", () => {
  assert.deepEqual(
    stepBadges({ audio: "sting.ogg", waitForAudioEnd: true, wait: { units: 2 } }),
    [{ type: "avType", mediaType: "audio", label: "2×" }],
  );
  // No override -- bare glyph, same as video/image's own natural-end case.
  assert.deepEqual(
    stepBadges({ audio: "sting.ogg", waitForAudioEnd: true }),
    [{ type: "audio" }],
  );
});

test("stepBadges: a non-media step's Duration stays a plain wait badge", () => {
  assert.deepEqual(stepBadges({ wait: { units: 1 } }), [{ type: "wait", label: "1×" }]);
});

test("stepBadges: loop badge fires off audioLoop too, not just the video/image loop", () => {
  assert.deepEqual(stepBadges({ audioLoop: true }), [{ type: "loop" }]);
});

test("stepBadges: an icon badge appears with only glow/visibility set, no icon path -- but not from iconSpin alone", () => {
  // iconSpin is always concrete now (see foundry-default-continuity), so on its own it
  // must NOT trigger the badge -- every step would show one otherwise.
  assert.deepEqual(stepBadges({ iconSpin: true }), []);
  assert.deepEqual(
    stepBadges({ iconVisible: false }),
    [{ type: "icon", icon: undefined, glow: undefined, spin: false, visible: false }],
  );
  assert.deepEqual(
    stepBadges({ iconGlow: "#00ff00", iconSpin: true }),
    [{ type: "icon", icon: undefined, glow: "#00ff00", spin: true, visible: undefined }],
  );
});

test("stepBadges: a hidden icon never shows as spinning, even if iconSpin is true", () => {
  assert.deepEqual(
    stepBadges({ iconSpin: true, iconVisible: false }),
    [{ type: "icon", icon: undefined, glow: undefined, spin: false, visible: false }],
  );
});

test("formatBeatsPerCycle: common fractions get their own glyph, everything else a decimal multiplier", () => {
  assert.equal(formatBeatsPerCycle(1), "1×");
  assert.equal(formatBeatsPerCycle(2), "2×");
  assert.equal(formatBeatsPerCycle(0.5), "½×");
  assert.equal(formatBeatsPerCycle(1 / 3), "⅓×");
  assert.equal(formatBeatsPerCycle(1.5), "1½×"); // whole + fraction, not a raw decimal
  assert.equal(formatBeatsPerCycle(2.2), "2.2×"); // no glyph for .2 -- falls back to decimal
});

test("formatMixedFraction: whole and fraction combine with no separator, no glyph falls back to decimal", () => {
  assert.equal(formatMixedFraction(0.5), "½");
  assert.equal(formatMixedFraction(1.5), "1½");
  assert.equal(formatMixedFraction(2), "2");
  assert.equal(formatMixedFraction(2.2), "2.2");
});

test("stepBadges: icon/text/border beats-per-cycle each get their own badge", () => {
  assert.deepEqual(
    stepBadges({ iconBeatsPerCycle: 2, textBeatsPerCycle: 0.5, borderBeatsPerCycle: 1 }),
    [
      { type: "iconBpc", label: "2×" },
      { type: "textBpc", label: "½×" },
      { type: "borderBpc", label: "1×" },
    ],
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

test("configFromGlobals: pulseLengthS converts to cycleMs in whole ms", () => {
  assert.deepEqual(configFromGlobals({ pulseLengthS: "3.64" }, []), { steps: [], cycleMs: 3640 });
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
  const config = { cycleMs: 3640, steps: [{ text: "hi" }] };
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
  const config = { cycleMs: 3640, endCombat: true, steps: [{ text: "hi", wait: { units: 2 } }] };
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
