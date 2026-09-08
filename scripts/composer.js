// Composer -- the GM-facing UI for building/running a PauseFX sequence, so authoring a
// reveal doesn't require hand-writing a macro's worth of JS. Reachable via the "Pause FX"
// scene-control buttons (registered below) or `game.modules.get("pause-fx").api.openComposer()`.

import { PauseFX } from "./pause-fx.js";
import {
  defaultStep, stepFromRow, rowFromStep, coerceStepField, stepSummary, startupSummary,
  msToSeconds, configFromGlobals, commandForConfig,
} from "./composer-logic.js";

const MODULE_ID = "pause-fx";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** A macro this class saved -- one it can load/overwrite -- vs. any other macro in the world. */
function isPauseFxMacro(macro) {
  return !!macro.getFlag(MODULE_ID, "config");
}

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
      saveMacro: PauseFXComposer.#onSaveMacro,
      run: PauseFXComposer.#onRun,
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/composer.hbs` } };

  /** @type {Array<object>} in-progress step rows -- see composer-logic.js's rowFromStep. */
  rows = [];

  // Global (non-step) fields, tracked as instance state like `rows` -- a render() reads only
  // from here, so an untracked field would get wiped on the next one.
  globals = {
    icon: "", iconSpin: false,
    iconGlowEnabled: false, iconGlow: "#ff0000", borderColorEnabled: false, borderColor: "#ff0000",
    text: "", textNone: false, pulseLengthS: "",
    closeWindowsPlayers: false, closeWindowsGM: false, endCombat: false, macroName: "",
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
    return {
      globals: this.globals,
      startupSummaryText: startupSummary(this.globals),
      rows: this.rows.map((row, index) => ({ index, summary: stepSummary(stepFromRow(row)), ...row })),
      macroNames: game.macros.contents.map((m) => m.name).sort(), // for a step's own "Run macro" field
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#dragDrop.bind(this.element); // re-bind every render -- the step <li>s are new DOM each time
    this.#ensureHeaderButtons();
    this.element.querySelectorAll(".pfx-step-remove").forEach((btn) => this.#wireStepRemove(btn));
    // Delegated: covers both step-row fields and named global fields in one listener.
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
        this.#syncPairedField(event.target); // e.g. the "enable" checkbox next to a colour picker
        // No further re-render needed -- nothing else on the page derives from this value.
      }
    });
  }

  // Foundry's own header only ever renders the toggle-controls/close buttons directly --
  // window.controls entries land in the dropdown behind the ellipsis, not the bar itself.
  // Inserted once (idempotent) rather than in PARTS, since the header isn't a part at all.
  #ensureHeaderButtons() {
    const header = this.element.querySelector(".window-header");
    if (!header || header.querySelector('[data-action="run"]')) return;
    const ellipsis = header.querySelector('[data-action="toggleControls"]');
    const makeButton = (action, icon, tooltip) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `header-control icon ${icon}`;
      btn.dataset.action = action;
      btn.dataset.tooltip = tooltip;
      btn.setAttribute("aria-label", tooltip);
      return btn;
    };
    header.insertBefore(makeButton("run", "fa-solid fa-play", "Run"), ellipsis);
    header.insertBefore(makeButton("saveMacro", "fa-solid fa-floppy-disk", "Save as Macro"), ellipsis);
  }

  // A checkbox with data-enables="name"/data-disables="name" toggles that field's `disabled`
  // live, without waiting on a re-render -- e.g. the colour picker next to "enable glow".
  #syncPairedField(el) {
    const enables = this.element.querySelector(`[name="${el.dataset.enables}"]`);
    if (enables) enables.disabled = !el.checked;
    const disables = this.element.querySelector(`[name="${el.dataset.disables}"]`);
    if (disables) disables.disabled = el.checked;
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

  // Quick click confirms; holding HOLD_MS bypasses the dialog (wedge = progress). `start`
  // clears the instant a hold completes, so that hold's own pointerup won't double-remove.
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

  /** Public -- called from the toolbar's "Load a saved macro" picker, not just from within. */
  loadMacro(macroId) {
    if (!macroId) return;
    const macro = game.macros.get(macroId);
    const config = macro && isPauseFxMacro(macro) ? macro.getFlag(MODULE_ID, "config") : null;
    if (!config) return;
    this.rows = (config.steps ?? []).map(rowFromStep);
    // Most of these don't map 1:1 to config keys -- see configFromGlobals for the reverse.
    this.globals.icon = config.icon ?? "";
    this.globals.iconSpin = !!config.iconSpin;
    this.globals.iconGlowEnabled = config.iconGlow !== undefined;
    if (config.iconGlow !== undefined) this.globals.iconGlow = config.iconGlow;
    this.globals.borderColorEnabled = config.borderColor !== undefined;
    if (config.borderColor !== undefined) this.globals.borderColor = config.borderColor;
    this.globals.textNone = config.text === "";
    this.globals.text = config.text || "";
    this.globals.endCombat = !!config.endCombat;
    this.globals.pulseLengthS = config.borderCycleMs !== undefined ? String(msToSeconds(config.borderCycleMs)) : "";
    this.globals.closeWindowsPlayers = !!config.closeAllWindows?.players;
    this.globals.closeWindowsGM = !!config.closeAllWindows?.gm;
    this.globals.macroName = macro.name; // re-saving under this same name overwrites this macro
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

  static async #onSaveMacro() {
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: "Save as Macro" },
      content: '<input type="text" name="macroName" placeholder="macro name..." autofocus>',
      render: (event, dialog) => {
        const input = dialog.element.querySelector('[name="macroName"]');
        input.value = this.globals.macroName; // prefilled, not interpolated -- no escaping to get wrong
        input.select();
      },
    });
    if (!result) return; // cancelled
    const name = result.macroName?.trim();
    if (!name) {
      ui.notifications.warn("Give the macro a name first.");
      return;
    }

    const steps = this.rows.map(stepFromRow);
    const config = configFromGlobals(this.globals, steps);
    const command = commandForConfig(config);

    // Overwrites a same-named macro only if WE made it -- never clobbers an unrelated one.
    const existing = game.macros.find((m) => m.name === name && isPauseFxMacro(m));
    if (existing) {
      await existing.update({ command, flags: { [MODULE_ID]: { config } } });
    } else {
      await Macro.create({ name, type: "script", scope: "global", command, flags: { [MODULE_ID]: { config } } });
    }
    this.globals.macroName = name;
    ui.notifications.info(`pause-fx: saved "${name}" as a macro.`);
    this.render({ parts: ["body"] });
  }

  static async #onRun() {
    const steps = this.rows.map(stepFromRow);
    await PauseFX.run(configFromGlobals(this.globals, steps));
  }

  static async #onSubmit() {} // form never actually submits -- every action handles its own save
}

// Shared by the two "pick a saved macro" toolbar buttons below.
async function pickSavedMacro(title, ok) {
  const macros = game.macros.filter(isPauseFxMacro).sort((a, b) => a.name.localeCompare(b.name));
  if (!macros.length) {
    ui.notifications.warn("pause-fx: no saved macros yet -- build one in the Composer and save it first.");
    return null;
  }
  const result = await foundry.applications.api.DialogV2.input({
    window: { title },
    content: '<select name="macroId" autofocus></select>',
    render: (event, dialog) => {
      const select = dialog.element.querySelector('[name="macroId"]');
      for (const m of macros) {
        const option = document.createElement("option");
        option.value = m.id;
        option.textContent = m.name; // set as a property, not interpolated -- no escaping to get wrong
        select.appendChild(option);
      }
    },
    ok,
  });
  return result?.macroId ? game.macros.get(result.macroId) : null;
}

async function pickMacroToLoad() {
  const macro = await pickSavedMacro("Load a Saved Macro", { label: "Load", icon: "fa-solid fa-folder-open" });
  if (!macro) return;
  const composer = new PauseFXComposer();
  await composer.render(true);
  composer.loadMacro(macro.id);
}

async function pickMacroToRun() {
  const macro = await pickSavedMacro("Run a Saved Macro", { label: "Run", icon: "fa-solid fa-play" });
  await macro?.execute();
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
        title: "New Pause FX sequence",
        icon: "fa-solid fa-clapperboard",
        button: true,
        onChange: () => new PauseFXComposer().render(true),
      },
      loadSaved: {
        name: "loadSaved",
        title: "Load a saved Pause FX macro",
        icon: "fa-solid fa-folder-open",
        button: true,
        onChange: () => pickMacroToLoad(),
      },
      runSaved: {
        name: "runSaved",
        title: "Run a saved Pause FX macro",
        icon: "fa-solid fa-play",
        button: true,
        onChange: () => pickMacroToRun(),
      },
    },
  };
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod?.api) mod.api.openComposer = () => new PauseFXComposer().render(true);
});
