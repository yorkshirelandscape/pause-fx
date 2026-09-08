// Composer -- the GM-facing UI for building/running a PauseFX sequence, so authoring a
// reveal doesn't require hand-writing a macro's worth of JS. Reachable via a "Pause FX"
// scene-control button (registered below) or `game.modules.get("pause-fx").api.openComposer()`.

import { PauseFX } from "./pause-fx.js";
import {
  defaultStep, stepFromRow, rowFromStep, coerceStepField, stepSummary, configFromGlobals,
} from "./composer-logic.js";

const MODULE_ID = "pause-fx";
const PRESETS_SETTING = "presets";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, PRESETS_SETTING, {
    scope: "world", config: false, type: Object, default: {},
  });
});

export class PauseFXComposer extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pause-fx-composer",
    tag: "form",
    window: { title: "Pause FX", icon: "fa-solid fa-clapperboard", resizable: true },
    position: { width: 640, height: 720 },
    form: { handler: PauseFXComposer.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      addStep: PauseFXComposer.#onAddStep,
      removeStep: PauseFXComposer.#onRemoveStep,
      moveStepUp: PauseFXComposer.#onMoveStep,
      moveStepDown: PauseFXComposer.#onMoveStep,
      browseFile: PauseFXComposer.#onBrowseFile,
      savePreset: PauseFXComposer.#onSavePreset,
      deletePreset: PauseFXComposer.#onDeletePreset,
      run: PauseFXComposer.#onRun,
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/composer.hbs` } };

  /** @type {Array<object>} in-progress step rows -- see composer-logic.js's rowFromStep. */
  rows = [];

  // Global (non-step) fields, tracked the same way as `rows` and for the same reason: the
  // template is the ONLY thing that survives a re-render, so anything not fed back into it
  // via _prepareContext gets silently wiped on the next render({parts:["body"]}) -- which
  // happens on every step add/remove/reorder/edit, not just on a preset load. A first version
  // of this class read globals straight off the DOM via FormDataExtended instead of tracking
  // them here, and that's exactly what broke: editing a step, then loading a preset, blanked
  // every global field because the template never bound them to anything in the first place.
  globals = {
    icon: "", iconGlow: "", borderColor: "", text: "", borderCycleMs: "", textCycleMs: "",
    textCycleMultiplier: "", closeAllWindows: false, endCombat: false, presetName: "",
  };

  async _prepareContext() {
    const presets = game.settings.get(MODULE_ID, PRESETS_SETTING);
    return {
      globals: this.globals,
      rows: this.rows.map((row, index) => ({ index, summary: stepSummary(stepFromRow(row)), ...row })),
      presetNames: Object.keys(presets).sort(),
      macroNames: game.macros.contents.map((m) => m.name).sort(),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[data-role="preset-select"]')
      ?.addEventListener("change", (event) => this.#loadPreset(event.target.value));
    // Delegated so per-row fields don't need a listener wired up on every re-render, and so
    // this one listener covers both step-row fields (data-field/data-index) and the plain
    // named global fields alike.
    this.element.addEventListener("change", (event) => {
      const stepRow = event.target.closest("[data-index]");
      const field = event.target.dataset.field;
      const raw = event.target.type === "checkbox" ? event.target.checked : event.target.value;

      if (stepRow && field) {
        this.rows[Number(stepRow.dataset.index)][field] = coerceStepField(field, raw);
        this.render({ parts: ["body"] }); // re-render to refresh this row's own summary line
        return;
      }
      if (event.target.name && event.target.name in this.globals) {
        this.globals[event.target.name] = raw;
        // No re-render needed -- nothing else on the page derives from a global field's value.
      }
    });
  }

  #loadPreset(name) {
    if (!name) return;
    const config = game.settings.get(MODULE_ID, PRESETS_SETTING)[name];
    if (!config) return;
    this.rows = (config.steps ?? []).map(rowFromStep);
    for (const field of Object.keys(this.globals)) {
      if (field === "presetName") continue; // keep whatever name is currently typed
      this.globals[field] = config[field] ?? (typeof this.globals[field] === "boolean" ? false : "");
    }
    this.render({ parts: ["body"] });
  }

  static #onAddStep() {
    this.rows.push(rowFromStep(defaultStep()));
    this.render({ parts: ["body"] });
  }

  static #onRemoveStep(event, target) {
    this.rows.splice(Number(target.dataset.index), 1);
    this.render({ parts: ["body"] });
  }

  static #onMoveStep(event, target) {
    const index = Number(target.dataset.index);
    const delta = target.dataset.action === "moveStepUp" ? -1 : 1;
    const neighbor = index + delta;
    if (neighbor < 0 || neighbor >= this.rows.length) return;
    [this.rows[index], this.rows[neighbor]] = [this.rows[neighbor], this.rows[index]];
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
        this.globals[field] = path; // bypasses the change listener -- FilePicker sets .value directly
      },
    }).render(true);
  }

  static async #onSavePreset() {
    const name = this.globals.presetName?.trim();
    if (!name) {
      ui.notifications.warn("Give the preset a name first.");
      return;
    }
    const steps = this.rows.map(stepFromRow);
    const config = configFromGlobals(this.globals, steps);
    const presets = { ...game.settings.get(MODULE_ID, PRESETS_SETTING), [name]: config };
    await game.settings.set(MODULE_ID, PRESETS_SETTING, presets);
    ui.notifications.info(`pause-fx: saved preset "${name}".`);
    this.render({ parts: ["body"] });
  }

  static async #onDeletePreset() {
    const select = this.element.querySelector('[data-role="preset-select"]');
    const name = select?.value;
    if (!name) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete preset" },
      content: `<p>Delete the "${name}" preset? This can't be undone.</p>`,
    });
    if (!confirmed) return;
    const presets = { ...game.settings.get(MODULE_ID, PRESETS_SETTING) };
    delete presets[name];
    await game.settings.set(MODULE_ID, PRESETS_SETTING, presets);
    this.render({ parts: ["body"] });
  }

  static async #onRun() {
    const steps = this.rows.map(stepFromRow);
    await PauseFX.run(configFromGlobals(this.globals, steps));
  }

  static async #onSubmit() {} // form never actually submits -- every action handles its own save
}

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  controls.pausefx = {
    name: "pausefx",
    title: "Pause FX",
    icon: "fa-solid fa-clapperboard",
    order: Object.keys(controls).length,
    tools: {
      open: {
        name: "open",
        title: "Open the Pause FX composer",
        icon: "fa-solid fa-clapperboard",
        button: true,
        onChange: () => new PauseFXComposer().render(true),
      },
    },
  };
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod?.api) mod.api.openComposer = () => new PauseFXComposer().render(true);
});
