// Step editor -- one dialog, shared by every row (including the undeletable first one) --
// no more inline chevron/expand-grid. ~20 fields is too much to show at once, so they're
// grouped into "blocks" toggled on/off via small buttons, rather than all visible together.

import { coerceStepField, rowFromStep } from "./composer-logic.js";

const MODULE_ID = "pause-fx";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const BLOCK_FIELDS = {
  wait: ["waitUnits"],
  text: ["text", "textNone", "textPulse"],
  icon: ["icon", "iconSpin", "iconGlowEnabled", "iconGlow"],
  border: ["borderColorEnabled", "borderColor", "borderWidthPct"],
  media: ["mediaType", "mediaPath", "videoVolume", "imagePulses", "loop", "waitForVideoEnd"],
  audio: ["audio", "audioVolume", "audioLoop", "waitForAudioEnd"],
  stop: ["closeVideo", "stopAudio", "hideIcon", "stopTextPulse", "stopIconSpin", "unpause"],
};

// Style defaults to solid; only entries that need the outline/regular variant override it
// (Font Awesome Free ships both styles for a handful of common glyphs, square included).
const BLOCK_META = {
  wait: { icon: "fa-hourglass-half", label: "Timer" },
  text: { icon: "fa-font", label: "Text" },
  icon: { icon: "fa-star", label: "Icon" },
  border: { icon: "fa-square", label: "Border", style: "fa-regular" },
  media: { icon: "fa-video", label: "Media" },
  audio: { icon: "fa-volume-high", label: "Audio" },
  stop: { icon: "fa-circle-stop", label: "Stop" },
};

/** Whether a block should start expanded -- true if the row already has content for it. */
function isBlockActive(row, block) {
  switch (block) {
    case "wait": return row.waitUnits !== "";
    case "text": return !!row.text || row.textNone || row.textPulse;
    case "icon": return !!row.icon || row.iconSpin || row.iconGlowEnabled;
    case "border": return row.borderColorEnabled || row.borderWidthPct !== "";
    case "media": return row.mediaType !== "none" || row.waitForVideoEnd;
    case "audio": return !!row.audio || row.audioLoop || row.waitForAudioEnd;
    case "stop":
      return row.closeVideo || row.stopAudio || row.hideIcon || row.stopTextPulse
        || row.stopIconSpin || row.unpause;
    default: return false;
  }
}

export class PauseFXStepEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pause-fx-step-editor",
    tag: "form",
    window: { title: "Edit Step", icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 480, height: 640 },
    form: { handler: PauseFXStepEditor.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      toggleBlock: PauseFXStepEditor.#onToggleBlock,
      browseFile: PauseFXStepEditor.#onBrowseFile,
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/step-editor.hbs` } };

  /**
   * @param {object} row - mutated directly as fields change; the caller owns re-rendering
   *   its own summary off this same object once we're done (see `onClose`).
   * @param {object} [opts]
   * @param {Function} [opts.onClose]
   */
  constructor(row, { onClose } = {}) {
    super();
    this.row = row;
    this.onClose = onClose;
    this.visibleBlocks = new Set(Object.keys(BLOCK_FIELDS).filter((b) => isBlockActive(row, b)));
  }

  async _prepareContext() {
    const visible = {};
    for (const key of Object.keys(BLOCK_META)) visible[key] = this.visibleBlocks.has(key);
    return {
      row: this.row,
      blocks: Object.keys(BLOCK_META).map((key) => ({
        key, ...BLOCK_META[key], style: BLOCK_META[key].style ?? "fa-solid", visible: visible[key],
      })),
      visible, // flat, keyed by block -- simpler {{#if visible.wait}} than searching `blocks`
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#syncMediaTypeFields(this.row.mediaType); // reflect the current type on every (re)render
    this.element.addEventListener("change", (event) => {
      const field = event.target.name;
      if (!field) return;
      const raw = event.target.type === "checkbox" ? event.target.checked : event.target.value;
      this.row[field] = coerceStepField(field, raw);
      this.#syncPairedField(event.target); // e.g. the "enable" checkbox next to a colour picker
      if (field === "mediaType") this.#syncMediaTypeFields(this.row.mediaType);
    });
  }

  // The Media block shows one set of fields for video, a different set for image (a slideshow
  // timer instead of volume) -- toggled live via [hidden] rather than a re-render, same spirit
  // as #syncPairedField below.
  #syncMediaTypeFields(type) {
    this.element.querySelectorAll("[data-media-show]").forEach((el) => {
      el.hidden = el.dataset.mediaShow !== type;
    });
  }

  // Same pattern as the Composer's own -- a checkbox with data-enables="name" (or the inverse,
  // data-disables="name") toggles that field's `disabled` live, without waiting on a re-render.
  #syncPairedField(el) {
    if (el.dataset.enables) {
      const target = this.element.querySelector(`[name="${el.dataset.enables}"]`);
      if (target) target.disabled = !el.checked;
    }
    if (el.dataset.disables) {
      const target = this.element.querySelector(`[name="${el.dataset.disables}"]`);
      if (target) target.disabled = el.checked;
    }
  }

  // Hiding a block clears its fields back to blank rather than just collapsing the UI --
  // otherwise a hidden block could still secretly be "on" (e.g. borderColorEnabled left
  // true), which would be a real correctness bug, not just a display one.
  static #onToggleBlock(event, target) {
    const block = target.dataset.block;
    if (this.visibleBlocks.has(block)) {
      this.visibleBlocks.delete(block);
      const blank = rowFromStep({});
      for (const field of BLOCK_FIELDS[block]) this.row[field] = blank[field];
    } else {
      this.visibleBlocks.add(block);
      // Media's own type toggle (video/image) needs a real value to have anything selected --
      // "none" only means anything as "this block isn't in use," which no longer applies now
      // that it's being opened.
      if (block === "media" && this.row.mediaType === "none") this.row.mediaType = "video";
    }
    this.render({ parts: ["body"] });
  }

  static async #onBrowseFile(event, target) {
    const field = target.dataset.for;
    const input = this.element.querySelector(`[name="${field}"]`);
    if (!input) return;
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    new FilePicker({
      type: target.dataset.pickerType || "imagevideo",
      current: input.value,
      callback: (path) => {
        input.value = path;
        this.row[field] = path; // bypasses the change listener -- FilePicker sets .value directly
      },
    }).render(true);
  }

  static async #onSubmit() {} // form never actually submits -- every field auto-saves on change

  async close(options) {
    this.onClose?.();
    return super.close(options);
  }
}
