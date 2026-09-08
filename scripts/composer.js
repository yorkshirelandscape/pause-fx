// Composer -- the GM-facing UI for building/running a PauseFX sequence, so authoring a
// reveal doesn't require hand-writing a macro's worth of JS. Reachable via a "Pause FX"
// scene-control button (registered below) or `game.modules.get("pause-fx").api.openComposer()`.

import { PauseFX } from "./pause-fx.js";
import {
  defaultStep, stepFromRow, rowFromStep, coerceStepField, stepSummary, startupSummary,
  msToSeconds, configFromGlobals,
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
    icon: "", iconGlow: "", borderColor: "", text: "", pulseLengthS: "",
    closeWindowsPlayers: false, closeWindowsGM: false, endCombat: false, presetName: "",
  };

  #dragDrop = new foundry.applications.ux.DragDrop({
    dragSelector: ".pfx-step-handle",
    dropSelector: ".pfx-step",
    callbacks: {
      dragstart: this.#onDragStart.bind(this),
      dragenter: this.#onDragEnter.bind(this),
      dragleave: this.#onDragLeave.bind(this),
      drop: this.#onDrop.bind(this),
    },
  });

  async _prepareContext() {
    const presets = game.settings.get(MODULE_ID, PRESETS_SETTING);
    return {
      globals: this.globals,
      startupSummaryText: startupSummary(this.globals),
      rows: this.rows.map((row, index) => ({ index, summary: stepSummary(stepFromRow(row)), ...row })),
      presetNames: Object.keys(presets).sort(),
      macroNames: game.macros.contents.map((m) => m.name).sort(),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#dragDrop.bind(this.element); // re-bind every render -- the step <li>s are new DOM each time
    this.element.querySelector('[data-role="preset-select"]')
      ?.addEventListener("change", (event) => this.#loadPreset(event.target.value));
    this.element.querySelectorAll(".pfx-step-remove").forEach((btn) => this.#wireStepRemove(btn));
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

  #onDragStart(event) {
    const index = event.currentTarget.closest("[data-index]")?.dataset.index;
    event.dataTransfer.setData("text/plain", index);
  }

  #onDragEnter(event) {
    event.currentTarget.classList.add("pfx-step-dragover");
  }

  #onDragLeave(event) {
    event.currentTarget.classList.remove("pfx-step-dragover");
  }

  #onDrop(event) {
    event.currentTarget.classList.remove("pfx-step-dragover");
    const from = Number(event.dataTransfer.getData("text/plain"));
    const to = Number(event.currentTarget.dataset.index);
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) return;
    const [dragged] = this.rows.splice(from, 1);
    this.rows.splice(to, 0, dragged);
    this.render({ parts: ["body"] });
  }

  #removeStepAt(index) {
    this.rows.splice(index, 1);
    this.render({ parts: ["body"] });
  }

  async #confirmAndRemoveStep(index) {
    const summary = stepSummary(stepFromRow(this.rows[index]));
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remove step" },
      content: `<p>Remove this step (${summary})? This can't be undone.</p>`,
    });
    if (confirmed) this.#removeStepAt(index);
  }

  // A quick click always confirms (the trash sits fully exposed with no border around it,
  // so it needs a real guard against misclicks) -- but holding it down for HOLD_MS skips
  // the dialog, for building/pruning a sequence quickly once you trust your own aim. The
  // wedge (--pfx-hold-progress, drawn in CSS as a conic-gradient) is the only warning that's
  // possible before the hold completes. No separate click listener needed: by the time a
  // completed hold's eventual pointerup fires, `start` is already null (cleared the moment
  // the hold finished), so the "held" check below naturally skips a second, redundant removal.
  #wireStepRemove(button) {
    const HOLD_MS = 1400;
    const index = () => Number(button.dataset.index);
    let start = null;
    let raf = null;

    const cancelHold = () => {
      start = null;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      button.style.setProperty("--pfx-hold-progress", "0");
    };
    const tick = (now) => {
      if (start === null) return;
      const progress = Math.min((now - start) / HOLD_MS, 1);
      button.style.setProperty("--pfx-hold-progress", String(progress));
      if (progress >= 1) {
        cancelHold();
        this.#removeStepAt(index()); // bypasses the confirmation entirely
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return; // left-click/primary touch only
      start = performance.now();
      raf = requestAnimationFrame(tick);
    });
    button.addEventListener("pointerup", () => {
      const wasHolding = start !== null; // false if the hold already completed above
      cancelHold();
      if (wasHolding) this.#confirmAndRemoveStep(index());
    });
    button.addEventListener("pointerleave", cancelHold);
    button.addEventListener("pointercancel", cancelHold);
  }

  #loadPreset(name) {
    if (!name) return;
    const config = game.settings.get(MODULE_ID, PRESETS_SETTING)[name];
    if (!config) return;
    this.rows = (config.steps ?? []).map(rowFromStep);
    // icon/iconGlow/borderColor/text/endCombat map 1:1 by name; pulseLengthS and the two
    // closeWindows* checkboxes don't -- configFromGlobals nests/converts those on the way
    // out (borderCycleMs in ms, closeAllWindows:{players,gm}), so loading has to reverse it.
    for (const field of ["icon", "iconGlow", "borderColor", "text", "endCombat"]) {
      this.globals[field] = config[field] ?? (typeof this.globals[field] === "boolean" ? false : "");
    }
    this.globals.pulseLengthS = config.borderCycleMs !== undefined ? String(msToSeconds(config.borderCycleMs)) : "";
    this.globals.closeWindowsPlayers = !!config.closeAllWindows?.players;
    this.globals.closeWindowsGM = !!config.closeAllWindows?.gm;
    // presetName is deliberately left alone -- keep whatever name is currently typed.
    this.render({ parts: ["body"] });
  }

  static #onAddStep() {
    this.rows.push(rowFromStep(defaultStep()));
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
