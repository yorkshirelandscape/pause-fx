// Pure form<->config translation for the Composer UI (scripts/composer.js). [CC+: whole-file
// design note, not tied to one line] Split out from the ApplicationV2 classes themselves so
// this logic is unit-testable without a DOM/Foundry runtime -- see composer-logic.test.mjs.
//
// Every row shares ONE schema, whether it's the first (undeletable) row or any other --
// icon/iconGlow/borderColor/borderWidth are just step fields, usable anywhere in the
// sequence, matching what pause-fx.js's own steps[] schema accepts (see that file's
// PauseFX.run JSDoc). endCombat and closeAllWindows stay Startup-only (globals, not a
// per-step field) -- ending an encounter or closing windows partway through a sequence
// isn't a thing pause-fx needs to support.

/** A blank step, used as the seed for "Add Step" and for a freshly-opened Composer's row 0. */
export function defaultStep() {
  return { wait: { units: 1 } };
}

/** Icon visibility carries forward step to step (same principle as the runtime engine's own
 *  "nothing new set, keep doing what it was already doing" behavior) -- so a step new to the
 *  Composer (freshly added, or loaded from a hand-written macro that never touched icon
 *  visibility) should start already reflecting whatever the sequence's state actually is by
 *  that point, not an ambiguous blank. Walks backward for the nearest explicit value; defaults
 *  to visible when nothing before it has ever set one.
 * @param {Array<object>} precedingSteps - the steps before the one being seeded.
 * @returns {boolean}
 */
export function effectiveIconVisible(precedingSteps) {
  for (let i = precedingSteps.length - 1; i >= 0; i--) {
    if (precedingSteps[i].iconVisible !== undefined) return precedingSteps[i].iconVisible;
  }
  return true;
}

/** Whether a row field carries a real value, as opposed to a blank/never-filled input.
 *  0 counts -- a 0-pulse wait and a 0 volume both mean something. */
function hasValue(value) {
  return value !== "" && value !== null && value !== undefined;
}

/**
 * The step-editor's media switch has two positions, not three -- a row that never touched it
 * (mediaType "none") reads as the switch's own default position, so a path typed alongside it
 * still saves rather than being silently dropped.
 * @param {string} mediaType
 * @returns {"video"|"image"}
 */
export function effectiveMediaType(mediaType) {
  return mediaType === "video" ? "video" : "image";
}

const STARTUP_FIELDS = ["icon", "iconGlow", "borderColor", "iconSpin", "borderWidth", "text", "textGlow"];

// //+composer-loadmacro-drops-config-level-startup-fields synthesizes row 0 from
// top-level fields a hand-written macro used instead of steps[0].
/**
 * PauseFX.run() also accepts icon/iconGlow/borderColor/text at config's own top level (as
 * initial state), not just folded into steps[0] the way Composer rows always save them --
 * loadMacro needs both shapes recognized, or a hand-written macro's opening beat has nowhere
 * to go.
 * @param {object} config
 * @returns {Array<object>} step objects ready for rowFromStep -- config.steps as-is, or with
 *   a synthesized row 0 prepended for whichever config-level fields were actually set.
 */
export function stepsFromConfig(config) {
  const steps = config.steps?.length ? config.steps : [];
  const startupFields = Object.fromEntries(
    STARTUP_FIELDS.filter((f) => config[f] !== undefined).map((f) => [f, config[f]]),
  );
  if (Object.keys(startupFields).length === 0) return steps.length ? steps : [defaultStep()];
  return [startupFields, ...steps];
}

/**
 * One editable step-row's fields -> a clean PauseFX step object. Optional fields are OMITTED
 * (not set to "" / false) when left blank, matching PauseFX.run's own `step.text !== undefined`
 * style checks -- an omitted field means "don't touch," not "clear."
 * @param {object} row - see rowFromStep for the field shape.
 * @returns {object} a step object per pause-fx.js's `steps` schema.
 */
export function stepFromRow(row) {
  const step = {};
  if (hasValue(row.waitUnits)) step.wait = { units: Number(row.waitUnits) };
  // //+pre-av-duration-post-av-step-model preAV/postAV only mean anything on a step with
  // media (see pause-fx.js) -- harmless to always carry them through regardless.
  if (hasValue(row.preAvUnits)) step.preAV = { units: Number(row.preAvUnits) };
  if (hasValue(row.postAvUnits)) step.postAV = { units: Number(row.postAvUnits) };
  if (row.textNone) step.text = ""; // explicitly blank, not "untouched"
  else if (row.text) step.text = row.text;
  if (row.textPulse) step.textPulse = true;
  if (row.textGlowEnabled && row.textGlow) step.textGlow = row.textGlow;
  if (row.stopAudio) step.stopAudio = true;
  if (row.stopTextPulse) step.stopTextPulse = true;
  if (row.stopIconSpin) step.stopIconSpin = true;
  if (row.stopBorderPulse) step.stopBorderPulse = true;
  if (row.unpause) step.unpause = true;
  // Bound audio (see pause-fx.js) vs. detached -- same checkbox as before, new meaning.
  if (row.waitForAudioEnd) step.waitForAudioEnd = true;
  if (row.audio) {
    step.audio = row.audio;
    if (hasValue(row.audioVolume)) step.audioVolume = Number(row.audioVolume);
    if (row.audioLoop) step.audioLoop = true;
  }
  if (row.mediaPath) {
    if (effectiveMediaType(row.mediaType) === "video") {
      step.video = row.mediaPath;
      if (hasValue(row.videoVolume)) step.videoVolume = Number(row.videoVolume);
    } else {
      step.image = row.mediaPath;
      if (hasValue(row.imagePulses)) step.imagePulses = Number(row.imagePulses);
    }
    if (row.loop) step.loop = true;
  }
  // Always a concrete true/false -- the single None checkbox has no third "untouched" state,
  // so every Composer-authored step now says its own piece rather than inheriting silently.
  step.iconVisible = !row.iconNone;
  if (!row.iconNone && row.icon) step.icon = row.icon;
  if (row.iconSpin) step.iconSpin = true;
  if (row.iconGlowEnabled && row.iconGlow) step.iconGlow = row.iconGlow;
  if (row.borderColorEnabled && row.borderColor) step.borderColor = row.borderColor;
  if (hasValue(row.borderWidthPct)) step.borderWidth = Number(row.borderWidthPct);
  return step;
}

/**
 * The inverse of stepFromRow -- a step object -> editable row fields, for populating the
 * dialog when a step (or a loaded macro's saved step) is opened for editing.
 * `stepFromRow(rowFromStep(step))` round-trips `step`, with one exception: iconVisible is a
 * single checkbox now (see the step-editor template), not omittable -- an input step missing
 * it round-trips as `iconVisible: true`, not back to missing. Call sites that create a step
 * from scratch (composer.js's load/addStep) seed a real value themselves first, via
 * effectiveIconVisible, so this only surfaces for a step object built by hand without it.
 * @param {object} step
 * @returns {object} row fields, all defined (never undefined) so they bind cleanly to inputs.
 */
export function rowFromStep(step) {
  return {
    waitUnits: step.wait?.units ?? "",
    preAvUnits: step.preAV?.units ?? "",
    postAvUnits: step.postAV?.units ?? "",
    text: step.text ?? "",
    textNone: step.text === "",
    textPulse: !!step.textPulse,
    textGlowEnabled: step.textGlow !== undefined,
    textGlow: step.textGlow ?? "#4DD0E1", // same deliberate teal default as iconGlow/borderColor
    stopAudio: !!step.stopAudio,
    stopTextPulse: !!step.stopTextPulse,
    stopIconSpin: !!step.stopIconSpin,
    stopBorderPulse: !!step.stopBorderPulse,
    unpause: !!step.unpause,
    waitForAudioEnd: !!step.waitForAudioEnd,
    audio: step.audio ?? "",
    audioVolume: step.audioVolume ?? "",
    audioLoop: !!step.audioLoop,
    mediaType: step.video ? "video" : step.image ? "image" : "none",
    mediaPath: step.video ?? step.image ?? "",
    videoVolume: step.videoVolume ?? "",
    imagePulses: step.imagePulses ?? "",
    loop: !!step.loop,
    icon: step.icon ?? "",
    iconNone: step.iconVisible === false,
    iconSpin: !!step.iconSpin,
    iconGlowEnabled: step.iconGlow !== undefined,
    iconGlow: step.iconGlow ?? "#4DD0E1", // a deliberate teal default, not an arbitrary placeholder
    borderColorEnabled: step.borderColor !== undefined,
    borderColor: step.borderColor ?? "#4DD0E1",
    borderWidthPct: step.borderWidth ?? "",
  };
}

const NUMBER_FIELDS = new Set([
  "waitUnits", "preAvUnits", "postAvUnits", "audioVolume", "videoVolume", "borderWidthPct", "imagePulses",
]);
const BOOL_FIELDS = new Set([
  "textNone", "textPulse", "stopAudio", "stopTextPulse",
  "stopIconSpin", "stopBorderPulse", "unpause", "waitForAudioEnd",
  "iconNone", "iconSpin", "iconGlowEnabled", "borderColorEnabled", "textGlowEnabled", "audioLoop", "loop",
]);

/**
 * Types a raw DOM field value (always a string, or a checkbox's `.checked` boolean) into
 * what stepFromRow/the template expect for that field.
 * @param {string} field
 * @param {string|boolean} rawValue
 */
export function coerceStepField(field, rawValue) {
  if (BOOL_FIELDS.has(field)) return !!rawValue;
  if (NUMBER_FIELDS.has(field) && rawValue !== "") return Number(rawValue);
  return rawValue;
}

// preAV/postAV share wait's own {units} shape, so they share this rendering too.
function pulseLabel(waitSpec, pulseLengthS) {
  const cycleS = pulseLengthS ? Number(pulseLengthS) : null;
  return cycleS ? (waitSpec.units * cycleS).toFixed(1) + "s" : `${waitSpec.units}x`;
}

/** Which channel owns a step's AV timing cluster, if any -- video and image outrank audio,
 *  and unbound audio has no timing of its own to cluster around. */
function avTypeFor(step) {
  if (step.video) return "video";
  if (step.image) return "image";
  if (step.audio && step.waitForAudioEnd) return "audio";
  return null;
}

/**
 * A step's summary, as a list of small typed badges for the always-visible row (no more
 * chevron/expand -- editing happens in a dialog now). The template renders each badge type
 * as its own little icon/swatch; `text` is handled separately (see stepDisplayText) since it
 * takes up the remaining width rather than sitting in the badge row.
 * @param {object} step
 * @param {number} [pulseLengthS] - to render the wait as real seconds, not just pulse units.
 * @returns {Array<object>} badge descriptors, e.g. {type: "wait", label: "2.0s"}.
 */
export function stepBadges(step, pulseLengthS) {
  const badges = [];
  // A media step's timing clusters around its type icon: preAV/postAV flank it, an explicit
  // Duration override becomes the orange badge itself (icon in its corner) instead of a bare glyph.
  const avType = avTypeFor(step);
  if (avType) {
    if (step.preAV) badges.push({ type: "preAV", label: pulseLabel(step.preAV, pulseLengthS) });
    if (step.wait) badges.push({ type: "avType", mediaType: avType, label: pulseLabel(step.wait, pulseLengthS) });
    else badges.push({ type: avType });
    if (step.postAV) badges.push({ type: "postAV", label: pulseLabel(step.postAV, pulseLengthS) });
  } else if (step.wait) {
    badges.push({ type: "wait", label: pulseLabel(step.wait, pulseLengthS) });
  }
  // Bound audio alongside a video/image already reads via the cluster above; only needs its
  // own indicator when nothing else claimed that cluster's icon.
  if (step.audio && step.waitForAudioEnd && avType !== "audio") badges.push({ type: "audioBound" });
  if (step.borderColor) badges.push({ type: "border", colour: step.borderColor });
  if (step.textGlow !== undefined) badges.push({ type: "textGlow", colour: step.textGlow });
  if (step.icon || step.iconGlow !== undefined || step.iconSpin !== undefined || step.iconVisible === false) {
    badges.push({ type: "icon", icon: step.icon, glow: step.iconGlow, spin: !!step.iconSpin, visible: step.iconVisible });
  }
  if (step.audio && avType !== "audio") badges.push({ type: "audio" });
  if (step.loop || step.audioLoop) badges.push({ type: "loop" });
  if (step.textPulse) badges.push({ type: "textPulse" });
  if (step.stopTextPulse) badges.push({ type: "stopTextPulse" });
  if (step.stopIconSpin) badges.push({ type: "stopIconSpin" });
  if (step.stopBorderPulse) badges.push({ type: "stopBorderPulse" });
  if (step.stopAudio) badges.push({ type: "stopAudio" });
  if (step.unpause) badges.push({ type: "unpause" });
  return badges;
}

/** The text a step's row shows in its own remaining space, distinct from the badge list. */
export function stepDisplayText(step) {
  if (step.text === "") return "(none)";
  return step.text ?? "";
}

/**
 * Pulse Length is shown to the user in decimal seconds; PauseFX.run() wants borderCycleMs.
 * Kept as real functions (not inlined) so the rounding is unit-tested, not just eyeballed.
 */
export function secondsToMs(seconds) {
  return Math.round(Number(seconds) * 1000);
}
export function msToSeconds(ms) {
  return ms / 1000;
}

/**
 * The Composer's Startup-only (non-step) fields -> the top-level PauseFX.run() config.
 * Everything else lives in `steps`.
 * @param {object} globals - `{ pulseLengthS, endCombat, closeWindowsPlayers, closeWindowsGM }`.
 * @param {Array<object>} steps - already-built step objects (see stepFromRow).
 * @returns {object} a full config object, ready for PauseFX.run().
 */
export function configFromGlobals(globals, steps) {
  const config = { steps };
  if (hasValue(globals.pulseLengthS)) config.borderCycleMs = secondsToMs(globals.pulseLengthS);
  if (globals.endCombat) config.endCombat = true;
  if (globals.closeWindowsPlayers || globals.closeWindowsGM) {
    config.closeAllWindows = { players: !!globals.closeWindowsPlayers, gm: !!globals.closeWindowsGM };
  }
  return config;
}

/** Marks a macro's `command` as a pause-fx sequence, so a hand-written macro (not built via
 * the Composer, and so missing the pause-fx flag) is still recognized by isPauseFxMacro --
 * see composer.js. Composer-saved macros carry it too, for the same uniform recognition. */
export const MACRO_MARKER = "/** @pause-fx-sequence */";

/** Whether `command` opens with MACRO_MARKER -- the cheap check used to list a macro in the
 * Load/Run pickers, independent of whether its config can actually be parsed back out. */
export function hasMacroMarker(command) {
  return typeof command === "string" && command.trimStart().startsWith(MACRO_MARKER);
}

/**
 * The inverse of commandForConfig -- pulls the config back out of a marked macro's own
 * command text, for a hand-written macro that has the marker but no pause-fx flag (one built
 * via the Composer has both; its flag is read directly instead, this is the fallback).
 * @param {string} command
 * @returns {object|null} the parsed config, or null if unmarked or unparseable (e.g. the
 *   author added their own code after the run() call, breaking the boundary this looks for).
 */
export function configFromCommand(command) {
  if (!hasMacroMarker(command)) return null;
  const match = command.match(/api\.run\((\{[\s\S]*\})\);/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * A saved sequence is a real Foundry macro. `command` is independently readable/runnable JS;
 * the Composer reads the config back from a flag instead, not by re-parsing this text (see
 * configFromCommand for the fallback used when there's no flag to read).
 * @param {object} config - see configFromGlobals.
 * @returns {string} the macro's `command` body.
 */
export function commandForConfig(config) {
  const json = JSON.stringify(config, null, 2);
  return [
    MACRO_MARKER,
    'if (!game.modules.get("pause-fx")?.active) {',
    '  ui.notifications.error("This macro needs the Pause FX module active.");',
    "  return;",
    "}",
    `await game.modules.get("pause-fx").api.run(${json});`,
  ].join("\n");
}
