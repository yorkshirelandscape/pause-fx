// Pure form<->config translation for the Composer UI (scripts/composer.js). Split out from
// the ApplicationV2 class itself so this logic is unit-testable without a DOM/Foundry runtime
// -- see composer-logic.test.mjs.

/** A blank step, used as the seed for "Add Step." */
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
  if (row.waitForVideoEnd) step.waitForVideoEnd = true;
  if (row.text) step.text = row.text;
  if (row.freeze) step.freeze = true;
  if (row.resume) step.resume = true;
  if (row.hideIcon) step.hideIcon = true;
  if (row.showIcon) step.showIcon = true;
  if (row.blankText) step.blankText = true;
  if (row.closeVideo) step.closeVideo = true;
  if (row.audio) {
    step.audio = row.audio;
    if (row.audioVolume !== "" && row.audioVolume !== null && row.audioVolume !== undefined) {
      step.audioVolume = Number(row.audioVolume);
    }
  }
  if (row.mediaType === "video" && row.mediaPath) {
    step.video = row.mediaPath;
    if (row.videoVolume !== "" && row.videoVolume !== null && row.videoVolume !== undefined) {
      step.videoVolume = Number(row.videoVolume);
    }
  }
  if (row.mediaType === "image" && row.mediaPath) step.image = row.mediaPath;
  if (row.macro) step.macro = row.macro;
  return step;
}

/**
 * The inverse of stepFromRow -- a step object -> editable row fields, for populating the
 * form when a preset loads. `stepFromRow(rowFromStep(step))` round-trips `step` (a `clock` on
 * the original step is intentionally NOT preserved -- see stepFromRow; a preset saved before
 * the Composer dropped clock selection could carry `clock: "text"` on some step, and loading
 * it back into the Composer silently drops that down to the one clock the UI still exposes).
 * @param {object} step
 * @returns {object} row fields, all defined (never undefined) so they bind cleanly to inputs.
 */
export function rowFromStep(step) {
  return {
    waitUnits: step.wait?.units ?? "",
    waitForVideoEnd: !!step.waitForVideoEnd,
    text: step.text ?? "",
    freeze: !!step.freeze,
    resume: !!step.resume,
    hideIcon: !!step.hideIcon,
    showIcon: !!step.showIcon,
    blankText: !!step.blankText,
    closeVideo: !!step.closeVideo,
    audio: step.audio ?? "",
    audioVolume: step.audioVolume ?? "",
    mediaType: step.video ? "video" : step.image ? "image" : "none",
    mediaPath: step.video ?? step.image ?? "",
    videoVolume: step.videoVolume ?? "",
    macro: step.macro ?? "",
  };
}

const NUMBER_FIELDS = new Set(["waitUnits", "audioVolume", "videoVolume"]);
const BOOL_FIELDS = new Set([
  "waitForVideoEnd", "freeze", "resume", "hideIcon", "showIcon", "blankText", "closeVideo",
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

/** A short, one-line human-readable summary of a step, for the collapsed list view. */
export function stepSummary(step) {
  const basename = (p) => p.split("/").pop();
  const parts = [];
  if (step.wait) parts.push(`wait ${step.wait.units} pulse${step.wait.units === 1 ? "" : "s"}`);
  if (step.waitForVideoEnd) parts.push("wait for video end");
  if (step.text) parts.push(`text: "${step.text}"`);
  if (step.blankText) parts.push("blank text");
  if (step.freeze) parts.push("freeze");
  if (step.resume) parts.push("resume");
  if (step.hideIcon) parts.push("hide icon");
  if (step.showIcon) parts.push("show icon");
  if (step.audio) parts.push(`audio: ${basename(step.audio)}`);
  if (step.video) parts.push(`video: ${basename(step.video)}`);
  if (step.image) parts.push(`image: ${basename(step.image)}`);
  if (step.closeVideo) parts.push("close video");
  if (step.macro) parts.push(`macro: ${step.macro}`);
  return parts.join(" · ") || "(empty step)";
}

/**
 * Same idea as stepSummary, for the pinned "Startup" row (icon/glow/border/text -- the
 * top-level look-and-feel fields, not a real step). Kept separate from stepSummary rather
 * than shoehorned into it since these fields aren't part of the real `steps[]` schema at all.
 * @param {object} startup - a subset of `globals`: icon, iconGlow, borderColor, text.
 */
export function startupSummary(startup) {
  const basename = (p) => p.split("/").pop();
  const parts = [];
  if (startup.icon) parts.push(`icon: ${basename(startup.icon)}`);
  if (startup.iconGlow) parts.push(`glow: ${startup.iconGlow}`);
  if (startup.borderColor) parts.push(`border: ${startup.borderColor}`);
  if (startup.text) parts.push(`text: "${startup.text}"`);
  return parts.join(" · ") || "(nothing set)";
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
 * The global (non-step) form fields -> the top-level PauseFX.run() config fields. Optional
 * fields are omitted when blank, same rationale as stepFromRow.
 * @param {object} globals - raw field values (strings/booleans), as read off the form.
 * @param {Array<object>} steps - already-built step objects (see stepFromRow).
 * @returns {object} a full config object, ready for PauseFX.run().
 */
export function configFromGlobals(globals, steps) {
  const config = { steps };
  if (globals.icon) config.icon = globals.icon;
  if (globals.iconGlow) config.iconGlow = globals.iconGlow;
  if (globals.borderColor) config.borderColor = globals.borderColor;
  if (globals.text) config.text = globals.text;
  if (globals.pulseLengthS !== "" && globals.pulseLengthS !== null && globals.pulseLengthS !== undefined) {
    config.borderCycleMs = secondsToMs(globals.pulseLengthS);
  }
  if (globals.closeWindowsPlayers || globals.closeWindowsGM) {
    config.closeAllWindows = { players: !!globals.closeWindowsPlayers, gm: !!globals.closeWindowsGM };
  }
  if (globals.endCombat) config.endCombat = true;
  return config;
}

/**
 * A saved vignette is a real Foundry macro (not a bespoke settings-backed "preset") -- it
 * already gets a directory, folders, drag-to-hotbar, and compendium packing for free that
 * way, none of which a from-scratch storage mechanism would. The macro's `command` is human-
 * readable/independently runnable JS (works even if you hand-edit it and never touch the
 * Composer again); the *config* the Composer reads back for editing lives in a flag instead
 * of getting parsed back out of that JS text, which would be far more brittle.
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
