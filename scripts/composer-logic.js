// Pure form<->config translation for the Composer UI (scripts/composer.js). Split out from
// the ApplicationV2 class itself so this logic is unit-testable without a DOM/Foundry runtime
// -- see composer-logic.test.mjs.

/** A blank step, used as the seed for "Add Step." */
export function defaultStep() {
  return { wait: { units: 1, clock: "border" } };
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
  if (row.waitUnits !== "" && row.waitUnits !== null && row.waitUnits !== undefined) {
    step.wait = { units: Number(row.waitUnits), clock: row.waitClock || "border" };
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
 * form when a preset loads. `stepFromRow(rowFromStep(step))` round-trips `step`.
 * @param {object} step
 * @returns {object} row fields, all defined (never undefined) so they bind cleanly to inputs.
 */
export function rowFromStep(step) {
  return {
    waitUnits: step.wait?.units ?? "",
    waitClock: step.wait?.clock ?? "border",
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
  if (step.wait) parts.push(`wait ${step.wait.units}× ${step.wait.clock ?? "border"}`);
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
  for (const field of ["borderCycleMs", "textCycleMs", "textCycleMultiplier"]) {
    if (globals[field] !== "" && globals[field] !== null && globals[field] !== undefined) {
      config[field] = Number(globals[field]);
    }
  }
  if (globals.closeAllWindows) config.closeAllWindows = true;
  if (globals.endCombat) config.endCombat = true;
  return config;
}
