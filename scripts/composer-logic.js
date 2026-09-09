// Pure form<->config translation for the Composer UI (scripts/composer.js). Split out from
// the ApplicationV2 classes themselves so this logic is unit-testable without a DOM/Foundry
// runtime -- see composer-logic.test.mjs.
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

/**
 * One editable step-row's fields -> a clean PauseFX step object. Optional fields are OMITTED
 * (not set to "" / false) when left blank, matching PauseFX.run's own `step.text !== undefined`
 * style checks -- an omitted field means "don't touch," not "clear." No `clock` on the wait --
 * the Composer only ever exposes one clock ("Pulse Cycles"); pause-fx.js's own default (an
 * omitted clock means "border") already does the right thing without the Composer saying so.
 * @param {object} row - see rowFromStep for the field shape.
 * @returns {object} a step object per pause-fx.js's `steps` schema.
 */
export function stepFromRow(row) {
  const step = {};
  if (row.waitUnits !== "" && row.waitUnits !== null && row.waitUnits !== undefined) {
    step.wait = { units: Number(row.waitUnits) };
  }
  if (row.textNone) step.text = ""; // explicitly blank, not "untouched"
  else if (row.text) step.text = row.text;
  if (row.textPulse) step.textPulse = true;
  if (row.closeVideo) step.closeVideo = true;
  if (row.stopAudio) step.stopAudio = true;
  if (row.stopTextPulse) step.stopTextPulse = true;
  if (row.stopIconSpin) step.stopIconSpin = true;
  if (row.stopBorderPulse) step.stopBorderPulse = true;
  if (row.unpause) step.unpause = true;
  if (row.waitForVideoEnd) step.waitForVideoEnd = true;
  if (row.waitForAudioEnd) step.waitForAudioEnd = true;
  if (row.waitForImageEnd) step.waitForImageEnd = true;
  if (row.audio) {
    step.audio = row.audio;
    if (row.audioVolume !== "" && row.audioVolume !== null && row.audioVolume !== undefined) {
      step.audioVolume = Number(row.audioVolume);
    }
    if (row.audioLoop) step.audioLoop = true;
  }
  if (row.mediaType === "video" && row.mediaPath) {
    step.video = row.mediaPath;
    if (row.videoVolume !== "" && row.videoVolume !== null && row.videoVolume !== undefined) {
      step.videoVolume = Number(row.videoVolume);
    }
    if (row.loop) step.loop = true;
  }
  if (row.mediaType === "image" && row.mediaPath) {
    step.image = row.mediaPath;
    if (row.imagePulses !== "" && row.imagePulses !== null && row.imagePulses !== undefined) {
      step.imagePulses = Number(row.imagePulses);
    }
    if (row.loop) step.loop = true;
  }
  if (row.iconNone) step.iconVisible = false; // explicitly hidden, not "untouched" -- same pattern as textNone
  else if (row.icon) step.icon = row.icon;
  if (row.iconSpin) step.iconSpin = true;
  if (row.iconGlowEnabled && row.iconGlow) step.iconGlow = row.iconGlow;
  if (row.borderColorEnabled && row.borderColor) step.borderColor = row.borderColor;
  if (row.borderWidthPct !== "" && row.borderWidthPct !== null && row.borderWidthPct !== undefined) {
    step.borderWidth = Number(row.borderWidthPct);
  }
  return step;
}

/**
 * The inverse of stepFromRow -- a step object -> editable row fields, for populating the
 * dialog when a step (or a loaded macro's saved step) is opened for editing.
 * `stepFromRow(rowFromStep(step))` round-trips `step` (a `clock` on the original step is
 * intentionally NOT preserved -- the Composer has nowhere left to show or re-set it).
 * @param {object} step
 * @returns {object} row fields, all defined (never undefined) so they bind cleanly to inputs.
 */
export function rowFromStep(step) {
  return {
    waitUnits: step.wait?.units ?? "",
    text: step.text ?? "",
    textNone: step.text === "",
    textPulse: !!step.textPulse,
    closeVideo: !!step.closeVideo,
    stopAudio: !!step.stopAudio,
    stopTextPulse: !!step.stopTextPulse,
    stopIconSpin: !!step.stopIconSpin,
    stopBorderPulse: !!step.stopBorderPulse,
    unpause: !!step.unpause,
    waitForVideoEnd: !!step.waitForVideoEnd,
    waitForAudioEnd: !!step.waitForAudioEnd,
    waitForImageEnd: !!step.waitForImageEnd,
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
    iconGlow: step.iconGlow ?? "#ff0000",
    borderColorEnabled: step.borderColor !== undefined,
    borderColor: step.borderColor ?? "#ff0000",
    borderWidthPct: step.borderWidth ?? "",
  };
}

const NUMBER_FIELDS = new Set(["waitUnits", "audioVolume", "videoVolume", "borderWidthPct", "imagePulses"]);
const BOOL_FIELDS = new Set([
  "textNone", "textPulse", "closeVideo", "stopAudio", "stopTextPulse",
  "stopIconSpin", "stopBorderPulse", "unpause", "waitForVideoEnd", "waitForAudioEnd",
  "waitForImageEnd", "iconNone", "iconSpin", "iconGlowEnabled", "borderColorEnabled", "audioLoop", "loop",
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
  if (step.wait) {
    const seconds = pulseLengthS ? (step.wait.units * Number(pulseLengthS)).toFixed(1) + "s" : `${step.wait.units}x`;
    badges.push({ type: "wait", label: seconds });
  }
  if (step.waitForVideoEnd) badges.push({ type: "waitForVideoEnd" });
  if (step.waitForAudioEnd) badges.push({ type: "waitForAudioEnd" });
  if (step.waitForImageEnd) badges.push({ type: "waitForImageEnd" });
  if (step.borderColor) badges.push({ type: "border", colour: step.borderColor });
  if (step.icon || step.iconGlow !== undefined || step.iconSpin !== undefined || step.iconVisible !== undefined) {
    badges.push({ type: "icon", icon: step.icon, glow: step.iconGlow, spin: !!step.iconSpin, visible: step.iconVisible });
  }
  if (step.video) badges.push({ type: "video" });
  if (step.image) badges.push({ type: "image" });
  if (step.audio) badges.push({ type: "audio" });
  if (step.loop || step.audioLoop) badges.push({ type: "loop" });
  if (step.textPulse) badges.push({ type: "textPulse" });
  if (step.stopTextPulse) badges.push({ type: "stopTextPulse" });
  if (step.stopIconSpin) badges.push({ type: "stopIconSpin" });
  if (step.stopBorderPulse) badges.push({ type: "stopBorderPulse" });
  if (step.closeVideo) badges.push({ type: "closeVideo" });
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
  if (globals.pulseLengthS !== "" && globals.pulseLengthS !== null && globals.pulseLengthS !== undefined) {
    config.borderCycleMs = secondsToMs(globals.pulseLengthS);
  }
  if (globals.endCombat) config.endCombat = true;
  if (globals.closeWindowsPlayers || globals.closeWindowsGM) {
    config.closeAllWindows = { players: !!globals.closeWindowsPlayers, gm: !!globals.closeWindowsGM };
  }
  return config;
}

/**
 * A saved sequence is a real Foundry macro. `command` is independently readable/runnable JS;
 * the Composer reads the config back from a flag instead, not by re-parsing this text.
 * @param {object} config - see configFromGlobals.
 * @returns {string} the macro's `command` body.
 */
export function commandForConfig(config) {
  const json = JSON.stringify(config, null, 2);
  return [
    'if (!game.modules.get("pause-fx")?.active) {',
    '  ui.notifications.error("This macro needs the Pause FX module active.");',
    "  return;",
    "}",
    `await game.modules.get("pause-fx").api.run(${json});`,
  ].join("\n");
}
