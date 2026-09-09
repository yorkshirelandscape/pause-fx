// Step editor -- one dialog, shared by every row (including the undeletable first one).
// Every field is always visible (a fixed 2-column layout -- see composer.css); nothing here
// hides or resets fields on its own, since there's no "block off" state to keep tidy anymore.

import { coerceStepField } from "./composer-logic.js";

const MODULE_ID = "pause-fx";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PauseFXStepEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pause-fx-step-editor",
    tag: "form",
    window: { title: "Edit Step", icon: "fa-solid fa-list-check", resizable: false },
    position: { width: 480, height: "auto" },
    form: { handler: PauseFXStepEditor.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
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
  }

  async _prepareContext() {
    return { row: this.row };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#syncMediaTypeFields(this.row.mediaType); // reflect the current type on every (re)render
    this.element.addEventListener("change", (event) => {
      const field = event.target.name;
      if (!field) return;
      // The Video/Image switch is a real checkbox (restyled -- see composer.css) but the row
      // field it drives is the same "video"/"image" string the old radio pair set, not a bare
      // boolean -- unchecked reads as video, checked as image.
      const raw = field === "mediaType" ? (event.target.checked ? "image" : "video")
        : event.target.type === "checkbox" ? event.target.checked
        : event.target.value;
      this.row[field] = coerceStepField(field, raw);
      this.#syncPairedField(event.target); // e.g. the "enable" checkbox next to a colour picker
      if (field === "mediaType") this.#syncMediaTypeFields(this.row.mediaType);
    });
  }

  // The Media block shows one set of fields for video, a different set for image (a slideshow
  // timer instead of volume). A freshly-blank row's mediaType is "none" -- matches neither, so
  // it falls back to showing the video fields (the switch's own unchecked/left position).
  #syncMediaTypeFields(type) {
    const effective = type === "image" ? "image" : "video";
    this.element.querySelectorAll("[data-media-show]").forEach((el) => {
      el.hidden = el.dataset.mediaShow !== effective;
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
