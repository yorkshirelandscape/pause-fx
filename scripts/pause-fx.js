// pause-fx -- declarative Foundry pause-screen effects engine.
//
// Two named clocks (`border`, `text`, independently timeable) drive a declarative `steps`
// array instead of a hand-written imperative sequence. See README.md for the config shape
// and a worked example.

const MODULE_ID = "pause-fx";
const BORDER_CLASS = "pause-fx-bordered";
const BORDER_COLOUR_VAR = "--pause-fx-border-color";
const DEFAULT_BORDER_CYCLE_MS = 3640; // no icon-GIF-timing auto-detection yet -- pass borderCycleMs explicitly for anything that should sync to a specific asset's real loop length (see README "Known limitations")

let socket;

// Registers pause-fx's socketlib socket -- immediately if socketlib is already loaded,
// otherwise once its "ready" hook fires.
function registerSocket() {
  socket = socketlib.registerModule(MODULE_ID);
  socket.register("closeAllWindows", closeAllWindowsHandler);
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.socket = socket;
}

if (globalThis.socketlib) {
  registerSocket();
} else {
  Hooks.once("socketlib.ready", registerSocket);
}

/**
 * Whether `app` is a real floating window (a titled window with a close control), as
 * opposed to one of Foundry's own persistent docked UI regions.
 * @param {object} app - an ApplicationV2 instance.
 * @returns {boolean}
 */
export function isRealWindow(app) {
  return !!app.hasFrame;
}

/**
 * Closes every real floating window (legacy and ApplicationV2) on whichever client runs
 * this -- called via socket.executeForEveryone so every connected client closes its own.
 * Leaves Foundry's own docked UI chrome untouched.
 */
export function closeAllWindowsHandler() {
  Object.values(ui.windows).forEach((app) => app.close());
  for (const app of foundry.applications.instances.values()) {
    if (isRealWindow(app)) app.close();
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} opts
 * @param {number} [opts.textCycleMs] - explicit override; wins if given.
 * @param {number} opts.borderCycleMs
 * @param {number} [opts.textCycleMultiplier=2]
 * @returns {number} the text pulse period, in ms.
 */
export function resolveTextCycleMs({ textCycleMs, borderCycleMs, textCycleMultiplier = 2 }) {
  return textCycleMs ?? borderCycleMs * textCycleMultiplier;
}

/**
 * @param {object} waitSpec
 * @param {number} waitSpec.units
 * @param {"border"|"text"} [waitSpec.clock="border"]
 * @param {object} clocks
 * @param {number} clocks.borderCycleMs
 * @param {number} clocks.textCycleMs
 * @returns {number} the wait, in ms.
 */
export function clockMsFor(waitSpec, { borderCycleMs, textCycleMs }) {
  const cycleMs = waitSpec.clock === "text" ? textCycleMs : borderCycleMs;
  return waitSpec.units * cycleMs;
}

// ---- style injection (border + text pulse keyframes, scoped to this run) ----

let styleEl = null;

function injectStyles({ borderCycleMs, textCycleMs }) {
  styleEl = document.createElement("style");
  styleEl.id = "pause-fx-styles";
  styleEl.textContent = `
    body.${BORDER_CLASS}:before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 90000; /* above the game canvas, below the video/image overlay's 100000 */
    }

    @keyframes pause-fx-border-pulse {
      0%, 100% { box-shadow: rgba(var(${BORDER_COLOUR_VAR}), 0.15) 0px 0px 30px 15px inset; }
      50% { box-shadow: rgba(var(${BORDER_COLOUR_VAR}), 0.35) 0px 0px 70px 45px inset; }
    }
    @media (prefers-reduced-motion: reduce) {
      body.${BORDER_CLASS}:before {
        box-shadow: rgba(var(${BORDER_COLOUR_VAR}), 0.25) 0px 0px 40px 20px inset !important;
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      body.${BORDER_CLASS}:before {
        animation: pause-fx-border-pulse ${borderCycleMs / 1000}s ease-in-out infinite;
      }
      /* Higher specificity (extra class) wins without !important -- and needs to: an
         always-on !important box-shadow would silently cancel the animation above,
         since !important declarations beat active CSS animations on the same property
         even from a totally unrelated rule. animation-play-state just freezes/resumes
         in place, doesn't reset it. */
      body.pause-fx-frozen.${BORDER_CLASS}:before {
        animation-play-state: paused;
      }
    }

    @keyframes pause-fx-text-pulse {
      0%, 100% { color: #330000; transform: scale(1); }
      50% { color: #FF2400; transform: scale(1.08); }
    }
    @media (prefers-reduced-motion: reduce) {
      .pause-fx-label { color: #FF2400; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .pause-fx-label { animation: pause-fx-text-pulse ${textCycleMs / 1000}s ease-in-out infinite; }
    }
  `;
  document.head.appendChild(styleEl);
}

function removeStyles() {
  styleEl?.remove();
  styleEl = null;
}

// ---- border colour: an inline custom property + class on <body>, local to this client ----

let colourProbe = null;
// Resolves any real CSS colour to "r, g, b" via the browser's own colour parser.
function resolveRgbTriplet(colour) {
  if (!colourProbe) {
    colourProbe = document.createElement("div");
    colourProbe.style.display = "none";
    document.body.appendChild(colourProbe);
  }
  colourProbe.style.color = colour;
  const [r, g, b] = getComputedStyle(colourProbe).color.match(/\d+(\.\d+)?/g) ?? [255, 0, 0];
  return `${r}, ${g}, ${b}`;
}

function setBorderColour(colour) {
  document.body.style.setProperty(BORDER_COLOUR_VAR, resolveRgbTriplet(colour));
  document.body.classList.add(BORDER_CLASS);
}

function clearBorderColour() {
  document.body.classList.remove(BORDER_CLASS);
  document.body.style.removeProperty(BORDER_COLOUR_VAR);
}

// ---- the sequencer itself ----

export class PauseFX {
  /**
   * @param {object} config
   * @param {string} [config.icon] - image/GIF path for the pause icon.
   * @param {string} [config.iconGlow="red"] - CSS colour for the icon's drop-shadow.
   * @param {string} [config.borderColor="red"] - any real CSS colour for pause-fx's own
   *   border-glow overlay (hex, a named colour, rgb()/hsl(), ...).
   * @param {string} [config.text=""] - initial label text.
   * @param {number} [config.borderCycleMs] - border/eye pulse period, in ms. Defaults to
   *   3640ms if not given -- pass this explicitly to sync against a specific icon's own
   *   real loop length instead (e.g. a GIF's actual per-frame timing).
   * @param {number} [config.textCycleMs] - text pulse period. Defaults to
   *   borderCycleMs * textCycleMultiplier.
   * @param {number} [config.textCycleMultiplier=2] - only used if textCycleMs is omitted.
   * @param {boolean} [config.closeAllWindows=false] - broadcast closeAllWindows to every
   *   connected client (via socketlib) before the sequence starts.
   * @param {boolean} [config.endCombat=false] - end the active encounter, if any, before
   *   the sequence starts.
   * @param {Array<object>} config.steps - see README.md for the full shape. Each step may
   *   have `wait: {units, clock: "border"|"text"}` or `waitForVideoEnd: true`, plus any of:
   *   `text`, `freeze`, `resume`, `hideIcon`, `showIcon`, `blankText`, `video`, `image`,
   *   `audio` (+ optional `audioVolume`), `videoVolume`, `closeVideo`, `macro`.
   */
  static async run(config) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can trigger this.");
      return;
    }

    const {
      icon,
      iconGlow = "red",
      borderColor = "red",
      text: initialText = "",
      borderCycleMs = DEFAULT_BORDER_CYCLE_MS,
      textCycleMs,
      textCycleMultiplier = 2,
      closeAllWindows: shouldCloseAllWindows = false,
      endCombat: shouldEndCombat = false,
      steps = [],
    } = config;
    const resolvedTextCycle = resolveTextCycleMs({ textCycleMs, borderCycleMs, textCycleMultiplier });

    if (shouldEndCombat) await game.combat?.endCombat();
    if (shouldCloseAllWindows) {
      if (!socket) ui.notifications.warn("pause-fx: socketlib isn't ready yet, skipping closeAllWindows.");
      else await socket.executeForEveryone("closeAllWindows");
    }

    setBorderColour(borderColor);
    injectStyles({ borderCycleMs, textCycleMs: resolvedTextCycle });

    const resetOnUnpause = (paused) => {
      if (paused) return; // ignore the pause-on event this run itself triggers below
      clearBorderColour();
      removeStyles();
      document.body.classList.remove("pause-fx-frozen");
      Hooks.off("pauseGame", resetOnUnpause);
    };
    Hooks.on("pauseGame", resetOnUnpause);

    let iconEl, label;
    const applySkin = (_app, html) => {
      const root = document.getElementById("pause") ?? (html instanceof jQuery ? html[0] : html);
      if (!root) return;

      iconEl = root.querySelector("img, svg, i");
      if (iconEl && iconEl.tagName !== "IMG") {
        const img = document.createElement("img");
        img.className = iconEl.className;
        iconEl.replaceWith(img);
        iconEl = img;
      }
      if (iconEl && icon) {
        iconEl.src = icon;
        iconEl.style.animation = "none"; // inline style beats whatever core's spin class does
        iconEl.style.filter = `drop-shadow(0 0 12px ${iconGlow})`;
      }

      label = [...root.children].find((el) => el !== iconEl);
      if (!label) {
        label = document.createElement("div");
        Object.assign(label.style, {
          textAlign: "center",
          marginTop: "0.5em",
          fontSize: "2rem",
          textShadow: "0 0 8px black",
        });
        root.appendChild(label);
      }
      label.classList.add("pause-fx-label");
      label.textContent = initialText;
    };
    const skin = (app, html) => {
      applySkin(app, html);
      Hooks.off("renderPause", skin);
      Hooks.off("renderGamePause", skin);
    };
    if (ui.pause.rendered) applySkin(ui.pause, ui.pause.element); // already paused? skin it now
    Hooks.once("renderPause", skin); // pre-V13 class name
    Hooks.once("renderGamePause", skin); // V13+ (GamePause)

    await game.togglePause(true, { broadcast: true });

    // Render is async on some clients -- give it a beat before running the sequence off
    // elements that might not exist yet.
    if (!iconEl || !label) await wait(200);
    if (!document.getElementById("pause") || !label) {
      ui.notifications.error("pause-fx: pause screen never rendered, aborting the sequence.");
      return;
    }

    let overlay = null; // the current video/image element, if any

    for (const step of steps) {
      if (step.waitForVideoEnd) {
        if (overlay instanceof HTMLVideoElement) {
          await new Promise((resolve) => overlay.addEventListener("ended", resolve, { once: true }));
        }
        continue;
      }
      if (step.wait) {
        await wait(clockMsFor(step.wait, { borderCycleMs, textCycleMs: resolvedTextCycle }));
      }

      if (step.text !== undefined) label.textContent = step.text;
      if (step.freeze) {
        label.style.animationPlayState = "paused";
        document.body.classList.add("pause-fx-frozen");
      }
      if (step.resume) {
        label.style.animationPlayState = "running";
        document.body.classList.remove("pause-fx-frozen");
      }
      if (step.hideIcon && iconEl) iconEl.style.visibility = "hidden";
      if (step.showIcon && iconEl) iconEl.style.visibility = "visible";
      if (step.blankText) label.textContent = "";

      if (step.audio) {
        foundry.audio.AudioHelper.play(
          { src: step.audio, volume: step.audioVolume ?? 0.8, autoplay: true, loop: false },
          false,
        );
      }

      if (step.macro) {
        const m = game.macros.getName(step.macro);
        // pause-fx only invokes it at the right beat -- it's on whoever authors the
        // sequence to make sure the macro they picked actually plays nicely with an
        // active pause overlay, not something pause-fx tries to guarantee.
        if (m) m.execute();
        else ui.notifications.warn(`pause-fx: no macro named "${step.macro}"`);
      }

      if (step.video || step.image) {
        const el = document.createElement(step.video ? "video" : "img");
        Object.assign(el.style, {
          position: "fixed",
          inset: "0",
          margin: "auto",
          width: "min(90vmin, 800px)",
          maxHeight: "90vh",
          zIndex: "100000", // above Foundry's own UI chrome, not just #pause
        });
        if (step.video) {
          Object.assign(el, { src: step.video, autoplay: true, loop: false, controls: false, volume: step.videoVolume ?? 0.5 });
        } else {
          el.src = step.image;
        }
        document.body.appendChild(el);
        overlay = el;
      }
      if (step.closeVideo) {
        overlay?.remove();
        overlay = null;
      }
    }
  }
}

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { run: PauseFX.run.bind(PauseFX) };
});
