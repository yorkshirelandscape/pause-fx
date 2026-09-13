// Step editor -- one dialog, shared by every row.
// Every field is always visible (see composer.css) -- nothing here hides/resets on its own.

import { coerceStepField, effectiveMediaType } from "./composer-logic.js";

const MODULE_ID = "pause-fx";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PauseFXStepEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pause-fx-step-editor",
    tag: "dialog", //+dialog-tag-default-padding still a <dialog>, just non-modal -- see _onFirstRender
    modal: false, //+step-editor-modal-dialog dropped -- blocked FilePicker, see that note
    window: { title: "Edit Step", icon: "fa-solid fa-list-check", resizable: false, contentTag: "form" },
    position: { width: 600, height: "auto" },
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

  //+step-editor-modal-dialog same trigger DialogV2 itself uses -- the base class calls
  // neither automatically, so this does, after super(). See that note for why modal:false.
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.options.modal ? this.element.showModal() : this.element.show();
    // Delegated off the dialog itself, which outlives every re-render -- wiring it in
    // _onRender instead would stack up one duplicate listener per render.
    this.element.addEventListener("change", (event) => this.#onFieldChange(event.target));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#syncMediaTypeFields(this.row.mediaType); // reflect the current type on every (re)render
  }

  #onFieldChange(target) {
    const field = target.name;
    if (!field) return;
    this.row[field] = coerceStepField(field, this.#rawValue(target));
    this.#syncPairedField(target); // e.g. the "enable" checkbox next to a colour picker
    if (field === "mediaType") this.#syncMediaTypeFields(this.row.mediaType);
  }

  // The Video/Image switch is a real checkbox (see composer.css) driving the same
  // "video"/"image" string the old radio pair set, not a bare boolean.
  #rawValue(target) {
    if (target.name === "mediaType") return target.checked ? "image" : "video";
    if (target.type === "checkbox") return target.checked;
    return target.value;
  }

  // Video and image show different field sets; a blank row's "none" reads as image (see
  // effectiveMediaType -- the same rule stepFromRow saves by).
  #syncMediaTypeFields(type) {
    const effective = effectiveMediaType(type);
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
