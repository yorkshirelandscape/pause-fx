// Composer -- the GM-facing UI for building/running a PauseFX sequence, so authoring a
// reveal skips hand-writing JS. Reachable via the scene-control buttons or api.openComposer().

import { PauseFX, DEFAULT_CYCLE_MS } from "./pause-fx.js";
import {
  defaultStep, stepFromRow, rowFromStep, stepBadges, stepDisplayText,
  msToSeconds, configFromGlobals, commandForConfig, hasMacroMarker, configFromCommand,
  stepsFromConfig, effectiveIconVisible, effectiveIconSpin, effectiveTextPulse,
  effectiveIcon, effectiveText, effectiveStateAt,
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

/** Finds (or creates) the "Pause FX" Macro folder, so Composer-saved sequences land grouped
 *  together instead of loose in the directory. */
async function ensurePauseFxFolder() {
  return game.folders.find((f) => f.type === "Macro" && f.name === "Pause FX")
    ?? Folder.create({ name: "Pause FX", type: "Macro" });
}

// Registered at init so it exists before ensureDemoMacroImported's first read/write --
// world-scoped, not exposed in Settings config (a plain "did this run yet" flag, not a preference).
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "demoImported", { scope: "world", config: false, type: Boolean, default: false });
});

/** Imports the bundled demo macro from this module's own compendium into the world's "Pause
 *  FX" folder the first time a GM opens either macro picker -- so a world that's never
 *  touched Pause FX before still has something to Run or Load. Idempotent via a setting,
 *  not by checking whether the macro is still there, so deleting the imported copy later
 *  doesn't cause it to silently come back. */
async function ensureDemoMacroImported() {
  if (game.settings.get(MODULE_ID, "demoImported")) return;
  await game.settings.set(MODULE_ID, "demoImported", true);
  const pack = game.packs.get(`${MODULE_ID}.macros`);
  const index = pack ? [...(await pack.getIndex())][0] : null;
  if (!index) return;
  const demo = await pack.getDocument(index._id);
  const folder = await ensurePauseFxFolder();
  await Macro.create({ ...demo.toObject(), folder: folder.id }, { keepId: false });
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
      duplicateStep: PauseFXComposer.#onDuplicateStep,
      playFromHere: PauseFXComposer.#onPlayFromHere,
      saveMacro: PauseFXComposer.#onSaveMacro,
      run: PauseFXComposer.#onRun,
      setDurationUnit: PauseFXComposer.#onSetDurationUnit,
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/composer.hbs` } };

  /** @type {Array<object>} in-progress step rows -- see composer-logic.js's rowFromStep.
   *  Starts with one blank row; any row (including that one) can be deleted, reordered, or
   *  duplicated -- nothing pins a specific row in place. */
  rows = [rowFromStep({ ...defaultStep(), iconSpin: effectiveIconSpin([]), textPulse: effectiveTextPulse([]) })];

  // Display-only, never saved -- a personal "how do I want to read this window's own step
  // list right now" preference, not part of the sequence itself. Always starts on beats.
  showSeconds = false;

  /** @type {?PauseFXStepEditor} the one currently-open row editor, if any -- #onEditStep
   *  closes it before opening another, so only one can ever be open at once. */
  activeStepEditor = null;

  // Startup-only fields -- everything else lives on a step (incl. the first one), edited like
  // any other. endCombat/closeWindows stay here instead -- see composer-logic.js's top comment.
  globals = {
    pulseLengthS: "", macroName: "", endCombat: false, closeWindowsPlayers: false, closeWindowsGM: false,
    freezeAudio: false,
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
    const steps = this.rows.map(stepFromRow);
    return {
      globals: this.globals,
      showSeconds: this.showSeconds,
      defaultPulseLengthLabel: `${msToSeconds(DEFAULT_CYCLE_MS)} sec`, // the placeholder's own value
      rows: steps.map((step, index) => {
        // Badges/text preview what's really on screen here -- //+foundry-default-continuity why.
        const stepsSoFar = steps.slice(0, index + 1);
        const resolved = { ...step, icon: effectiveIcon(stepsSoFar), text: effectiveText(stepsSoFar) };
        const pulseLengthS = this.showSeconds ? this.globals.pulseLengthS : null;
        return { index, badges: stepBadges(resolved, pulseLengthS), text: stepDisplayText(resolved) };
      }),
    };
  }

  // Delegated off the window frame, which outlives every re-render -- wiring it in _onRender
  // instead would stack up one duplicate listener per render.
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Only Startup's own fields live here -- everything else is in the step editor.
    this.element.addEventListener("change", (event) => {
      if (event.target.name && event.target.name in this.globals) {
        this.globals[event.target.name] =
          event.target.type === "checkbox" ? event.target.checked : event.target.value;
      }
    });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#dragDrop.bind(this.element); // re-bind every render -- the step <li>s are new DOM each time
    this.element.querySelectorAll(".pfx-step-remove").forEach((btn) => this.#wireStepRemove(btn));
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

  // Quick click confirms; holding HOLD_MS bypasses it (wedge = progress), clearing `start` so
  // that hold's pointerup won't double-remove. Row 0 has no button here at all (see composer.hbs).
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
    // Steps missing iconVisible/iconSpin/textPulse get seeded from the sequence's own state --
    // //+foundry-default-continuity why a checkbox shouldn't just read as off.
    const steps = stepsFromConfig(config); //+composer-loadmacro-drops-config-level-startup-fields
    this.rows = steps.map((step, i) => rowFromStep({
      ...step,
      iconVisible: step.iconVisible ?? effectiveIconVisible(steps.slice(0, i)),
      iconSpin: step.iconSpin ?? effectiveIconSpin(steps.slice(0, i)),
      textPulse: step.textPulse ?? effectiveTextPulse(steps.slice(0, i)),
    }));
    this.globals.pulseLengthS = config.cycleMs !== undefined ? String(msToSeconds(config.cycleMs)) : "";
    this.globals.endCombat = !!config.endCombat;
    this.globals.closeWindowsPlayers = !!config.closeAllWindows?.players;
    this.globals.closeWindowsGM = !!config.closeAllWindows?.gm;
    this.globals.freezeAudio = !!config.freezeAudio;
    this.globals.macroName = macro.name; // re-saving under this same name overwrites this macro
    this.render({ parts: ["body"] });
  }

  static #onAddStep() {
    const precedingSteps = this.rows.map(stepFromRow);
    this.rows.push(rowFromStep({
      ...defaultStep(),
      iconVisible: effectiveIconVisible(precedingSteps),
      iconSpin: effectiveIconSpin(precedingSteps),
      textPulse: effectiveTextPulse(precedingSteps),
    }));
    this.render({ parts: ["body"] });
  }

  static #onDuplicateStep(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    this.rows.splice(index + 1, 0, { ...this.rows[index] });
    this.render({ parts: ["body"] });
  }

  //+play-from-here-state-reconstruction seeds a wait:0 step with the sticky state the
  // real sequence would already have set by this point, so it looks right immediately.
  static async #onPlayFromHere(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    const steps = this.rows.map(stepFromRow);
    const seed = { ...effectiveStateAt(steps, index), wait: { units: 0 } };
    // No endCombat/closeAllWindows -- previewing a step shouldn't re-trigger those.
    const config = configFromGlobals({ pulseLengthS: this.globals.pulseLengthS }, [seed, ...steps.slice(index)]);
    this.setPosition({ top: 10, left: 10 });
    this.minimize();
    await PauseFX.run(config);
  }

  static #onSetDurationUnit(event, target) {
    this.showSeconds = target.dataset.unit === "seconds";
    this.render({ parts: ["body"] });
  }

  static #onEditStep(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    this.activeStepEditor?.close(); // only one editor open at a time
    const precedingSteps = this.rows.slice(0, index).map(stepFromRow);
    const effective = effectiveStateAt(precedingSteps, precedingSteps.length);
    const row = this.rows[index];
    // A disabled color swatch shows what's actually inherited, not a fixed placeholder color --
    // same "what you'll get if you leave this alone" idea as the text/number placeholders below.
    if (!row.iconGlowEnabled && effective.iconGlow !== undefined) row.iconGlow = effective.iconGlow;
    if (!row.textGlowEnabled && effective.textGlow !== undefined) row.textGlow = effective.textGlow;
    if (!row.borderColorEnabled && effective.borderColor !== undefined) row.borderColor = effective.borderColor;
    const placeholders = {
      icon: effective.icon,
      text: effective.text,
      iconBeatsPerCycle: effective.iconBeatsPerCycle ?? 1,
      textBeatsPerCycle: effective.textBeatsPerCycle ?? 1,
      borderBeatsPerCycle: effective.borderBeatsPerCycle ?? 1,
      borderWidthFactor: effective.borderWidth ?? 1,
    };
    const editor = new PauseFXStepEditor(row, {
      placeholders,
      onClose: () => {
        if (this.activeStepEditor === editor) this.activeStepEditor = null;
        this.render({ parts: ["body"] }); // refresh this row's summary badges
      },
    });
    this.activeStepEditor = editor;
    editor.render(true);
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
    // type: "script" forced too -- a hand-authored macro may have started life as "chat".
    const existing = game.macros.find((m) => m.name === name && isPauseFxMacro(m));
    if (existing) {
      await existing.update({ type: "script", command, flags: { [MODULE_ID]: { config } } });
    } else {
      // On-brand thumbnail + grouping folder -- only on create, never forced onto an
      // existing macro whose img/folder the author may have deliberately changed since.
      const folder = await ensurePauseFxFolder();
      await Macro.create({
        name, type: "script", scope: "global", command, flags: { [MODULE_ID]: { config } },
        img: `modules/${MODULE_ID}/ui/clapperboard.svg`, folder: folder.id,
      });
    }
    this.globals.macroName = name;
    ui.notifications.info(`pause-fx: saved "${name}" as a macro.`);
    this.render({ parts: ["body"] });
  }

  static async #onRun() {
    const steps = this.rows.map(stepFromRow);
    // Out of the way of whatever's about to play -- not awaited, so the sequence starts
    // immediately rather than waiting on minimize()'s own ~1s collapse animation.
    this.setPosition({ top: 10, left: 10 });
    this.minimize();
    await PauseFX.run(configFromGlobals(this.globals, steps));
  }

  static async #onSubmit() {} // form never actually submits -- every action handles its own save
}

// Shared by the two "pick a saved macro" toolbar buttons below.
async function pickSavedMacro(title, ok) {
  await ensureDemoMacroImported();
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
  // ??=, not a plain read -- doesn't depend on pause-fx.js's own ready hook having run first.
  if (mod) (mod.api ??= {}).openComposer = () => new PauseFXComposer().render(true);
});
