// Composer -- the GM-facing UI for building/running a PauseFX sequence, so authoring a
// reveal doesn't require hand-writing a macro's worth of JS. Reachable via the "Pause FX"
// scene-control buttons (registered below) or `game.modules.get("pause-fx").api.openComposer()`.

import { PauseFX } from "./pause-fx.js";
import {
  defaultStep, stepFromRow, rowFromStep, stepBadges, stepDisplayText,
  msToSeconds, configFromGlobals, commandForConfig, hasMacroMarker, configFromCommand,
} from "./composer-logic.js";
import { PauseFXStepEditor } from "./step-editor.js";

const MODULE_ID = "pause-fx";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** A macro this class recognizes -- one it can load/overwrite -- vs. any other macro in the
 * world: either saved via this Composer (carries the flag) or a hand-written macro that
 * opens with the @pause-fx-sequence marker (see composer-logic.js's hasMacroMarker). */
function isPauseFxMacro(macro) {
  return !!macro.getFlag(MODULE_ID, "config") || hasMacroMarker(macro.command);
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
      editStep: PauseFXComposer.#onEditStep,
      saveMacro: PauseFXComposer.#onSaveMacro,
      run: PauseFXComposer.#onRun,
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/composer.hbs` } };

  /** @type {Array<object>} in-progress step rows -- see composer-logic.js's rowFromStep.
   *  rows[0] is always present and can't be deleted (it can still be dragged elsewhere --
   *  whichever row currently sits first loses/gains that protection, not a specific row). */
  rows = [rowFromStep(defaultStep())];

  // Startup-only fields -- everything else (icon/glow/border/text/wait/media/audio/macro/...)
  // lives on a step, including the first one, edited the same way as any other via the
  // step-editor dialog. endCombat/closeWindows stay here rather than on a step -- see
  // composer-logic.js's top comment for why.
  globals = { pulseLengthS: "", macroName: "", endCombat: false, closeWindowsPlayers: false, closeWindowsGM: false };

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
      rows: this.rows.map((row, index) => ({
        index,
        badges: stepBadges(stepFromRow(row), this.globals.pulseLengthS),
        text: stepDisplayText(stepFromRow(row)),
      })),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#dragDrop.bind(this.element); // re-bind every render -- the step <li>s are new DOM each time
    this.#ensureHeaderButtons();
    this.element.querySelectorAll(".pfx-step-remove").forEach((btn) => this.#wireStepRemove(btn));
    // Only Startup's own fields live here -- everything else is in the step editor.
    this.element.addEventListener("change", (event) => {
      if (event.target.name && event.target.name in this.globals) {
        this.globals[event.target.name] =
          event.target.type === "checkbox" ? event.target.checked : event.target.value;
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
    const text = stepDisplayText(stepFromRow(this.rows[index]));
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remove Step" },
      content: `<p>Remove this step${text ? ` ("${text}")` : ""}? This can't be undone.</p>`,
    });
    if (confirmed) this.#removeStepAt(index);
  }

  // Quick click confirms; holding HOLD_MS bypasses the dialog (wedge = progress). `start`
  // clears the instant a hold completes, so that hold's own pointerup won't double-remove.
  // Row 0 has no remove button at all (see composer.hbs) -- nothing to wire here for it.
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
    if (!macro || !isPauseFxMacro(macro)) return;
    // The flag is authoritative when present (a Composer-saved macro always has one); a
    // hand-written macro recognized only via the marker falls back to parsing its own command.
    const config = macro.getFlag(MODULE_ID, "config") ?? configFromCommand(macro.command);
    if (!config) {
      ui.notifications.warn(`pause-fx: recognized "${macro.name}" as a sequence but couldn't read its config back out -- open it in a text editor instead.`);
      return;
    }
    this.rows = (config.steps?.length ? config.steps : [defaultStep()]).map(rowFromStep);
    this.globals.pulseLengthS = config.borderCycleMs !== undefined ? String(msToSeconds(config.borderCycleMs)) : "";
    this.globals.endCombat = !!config.endCombat;
    this.globals.closeWindowsPlayers = !!config.closeAllWindows?.players;
    this.globals.closeWindowsGM = !!config.closeAllWindows?.gm;
    this.globals.macroName = macro.name; // re-saving under this same name overwrites this macro
    this.render({ parts: ["body"] });
  }

  static #onAddStep() {
    this.rows.push(rowFromStep(defaultStep()));
    this.render({ parts: ["body"] });
  }

  static #onEditStep(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    new PauseFXStepEditor(this.rows[index], {
      onClose: () => this.render({ parts: ["body"] }), // refresh this row's summary badges
    }).render(true);
  }

  static async #onSaveMacro() {
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: "Save as Macro" },
      content: '<input type="text" name="macroName" placeholder="Macro Name..." autofocus>',
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
        title: "New Pause FX Sequence",
        icon: "fa-solid fa-clapperboard",
        button: true,
        onChange: () => new PauseFXComposer().render(true),
      },
      loadSaved: {
        name: "loadSaved",
        title: "Load a Saved Pause FX Macro",
        icon: "fa-solid fa-folder-open",
        button: true,
        onChange: () => pickMacroToLoad(),
      },
      runSaved: {
        name: "runSaved",
        title: "Run a Saved Pause FX Macro",
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
