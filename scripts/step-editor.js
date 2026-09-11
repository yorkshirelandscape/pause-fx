// Step editor -- one dialog, shared by every row (including the undeletable first one).
// Every field is always visible (see composer.css) -- nothing here hides/resets on its own.

import { coerceStepField } from "./composer-logic.js";

const MODULE_ID = "pause-fx";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PauseFXStepEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pause-fx-step-editor",
    tag: "dialog", // for real showModal() blocking -- see _onFirstRender. Content area stays "form".
    modal: true, // read by _onFirstRender below, not the base class itself
    window: { title: "Edit Step", icon: "fa-solid fa-list-check", resizable: false, contentTag: "form" },
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

  // showModal() is what actually blocks interaction with the Composer behind this and adds
  // the ::backdrop -- the base class doesn't call it itself, so this does, after super().
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    if (this.options.modal) this.element.showModal();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#syncMediaTypeFields(this.row.mediaType); // reflect the current type on every (re)render
    this.#setManualAdvancePlaceholder();
    this.element.addEventListener("change", (event) => {
      const field = event.target.name;
      if (!field) return;
      // The Video/Image switch is a real checkbox (see composer.css) driving the same
      // "video"/"image" string the old radio pair set, not a bare boolean.
      const raw = field === "mediaType" ? (event.target.checked ? "image" : "video")
        : event.target.type === "checkbox" ? event.target.checked
        : event.target.value;
      this.row[field] = coerceStepField(field, raw);
      this.#syncPairedField(event.target); // e.g. the "enable" checkbox next to a colour picker
      if (field === "mediaType") this.#syncMediaTypeFields(this.row.mediaType);
    });
  }

  // Shows the actually-configured "Advance Pause FX" keybind (unbound by default -- see
  // its own registration) in place of the template's static "manual" placeholder.
  #setManualAdvancePlaceholder() {
    const field = this.element.querySelector('[name="imagePulses"]');
    const [binding] = game.keybindings.bindings.get(`${MODULE_ID}.advance`) ?? [];
    if (!field || !binding) return; // stays "manual" from the template if still unbound
    const { KeyboardManager } = foundry.helpers.interaction;
    const keys = [...binding.modifiers, binding.key]
      .map((code) => KeyboardManager.getKeycodeDisplayString(code)).join("+");
    field.placeholder = `"${keys}"`; // quoted -- a bound digit key would read as a real value otherwise
  }

  // Video and image show different field sets. A blank row's mediaType is "none" -- falls
  // back to image (the switch's own default checked position), not video.
  #syncMediaTypeFields(type) {
    const effective = type === "video" ? "video" : "image";
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
