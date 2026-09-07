// pause-fx -- declarative Foundry pause-screen effects engine.
//
// Generalizes everything learned building Curtain Call's Norgorber pause-screen reveal
// (2026-09-07, see that world's `temp-pause.js` / `norgorber-takes-his-due.js` macros for
// the original one-off versions this replaces): two named clocks (a `border` cycle and a
// `text` cycle, independently timeable), a declarative `steps` array instead of a
// hand-written imperative sequence, and three hard-won CSS/DOM techniques baked in so
// callers never have to rediscover them:
//   - the pause-border glow lives on Monk's Little Details' own `pause-border-colour`
//     world setting (not a raw CSS variable -- that gets fought/overwritten by MLD's own
//     onChange), with a localStorage safety net in case a session dies mid-pause before
//     cleanup runs (world-scoped settings persist across logins; nothing else does).
//   - freezing a pulse uses `animation-play-state: paused`, not `animation: none` --
//     the former freezes exactly where it visually is, the latter resets it.
//   - a video/image overlay is `position: fixed` on `<body>`, never positioned relative
//     to `#pause` itself -- that element is only ever sized for its own small icon+label,
//     not a full-screen container, and inserting a large child into it both clips to that
//     tiny box and shoves the rest of Foundry's UI around.
//
// See README.md for the full config shape and a worked example.

const MODULE_ID = "pause-fx";
const MLD_MODULE = "monks-little-details";
const MLD_SETTING = "pause-border-colour";
const BORDER_STASH_KEY = "pauseFxPrevBorderColour";
const DEFAULT_BORDER_CYCLE_MS = 3640; // no icon-GIF-timing auto-detection yet -- pass borderCycleMs explicitly for anything that should sync to a specific asset's real loop length (see README "Known limitations")

let socket;

// pause-fx's own esmodule loads asynchronously (dynamic import, like every esmodule) --
// confirmed live (2026-09-07) that on a fresh module-enable this can resolve *after*
// socketlib's own "ready" hook has already fired and gone stale, so a bare
// `Hooks.once("socketlib.ready", ...)` never runs and `socket` stays undefined forever
// (silently -- socketlib.modules just stays empty, no error). If `socketlib` is already
// on the page by the time this evaluates, register immediately instead of waiting on a
// hook that may never come again; only fall back to the hook when socketlib itself
// genuinely hasn't loaded yet.
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

// Closes both legacy (Application v1) and ApplicationV2 windows on whichever client runs
// this -- called via socket.executeForEveryone so every connected client closes its own.
// API confirmed against 5 real installed modules on the actual production Foundry server,
// not guessed (escape-window, monks-active-tiles, monks-tokenbar, patrol,
// xdy-pf2e-workbench, pf2e-skill-issue).
//
// foundry.applications.instances holds every ApplicationV2 instance, including Foundry's
// own persistent docked UI chrome (sidebar, hotbar, players list, scene controls/nav,
// each sidebar tab, the pause overlay itself, etc.) alongside real floating windows
// (sheets, config dialogs) -- confirmed live (2026-09-07) that closing the former blanks
// a client's entire UI, not just its open sheets. `hasFrame` is Foundry's own signal for
// "this is a real titled window with a close control" -- false on every docked chrome
// piece, true on every floating window -- so filter on that rather than the registry as
// a whole.
// Extracted as its own pure predicate so the regression it guards against (see comment
// above) has a direct unit test, not just the one-off live check that originally caught it.
export function isRealWindow(app) {
  return !!app.hasFrame;
}

export function closeAllWindowsHandler() {
  Object.values(ui.windows).forEach((app) => app.close());
  for (const app of foundry.applications.instances.values()) {
    if (isRealWindow(app)) app.close();
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- pure clock math -- pulled out of run()'s loop so it has its own direct tests instead
// of only being exercised indirectly through a full (Foundry-globals-dependent) sequence ----

// textCycleMs, if given, always wins; otherwise derive it from borderCycleMs and the
// multiplier (2x by default -- "half speed", per the original Curtain Call brief).
export function resolveTextCycleMs({ textCycleMs, borderCycleMs, textCycleMultiplier = 2 }) {
  return textCycleMs ?? borderCycleMs * textCycleMultiplier;
}

// A step's `wait: {units, clock}` is always a number of units on a named clock, never a raw
// ms count (see README) -- this is the one place that unit count actually becomes a delay.
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
    @keyframes pause-fx-border-pulse {
      0%, 100% { box-shadow: rgba(var(--pause-border-color), 0.15) 0px 0px 30px 15px inset; }
      50% { box-shadow: rgba(var(--pause-border-color), 0.35) 0px 0px 70px 45px inset; }
    }
    @media (prefers-reduced-motion: reduce) {
      body.mld-paused:after {
        box-shadow: rgba(var(--pause-border-color), 0.25) 0px 0px 40px 20px inset !important;
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      body.mld-paused:after {
        animation: pause-fx-border-pulse ${borderCycleMs / 1000}s ease-in-out infinite;
      }
      /* Higher specificity (extra class) wins without !important -- and needs to: an
         always-on !important box-shadow would silently cancel the animation above,
         since !important declarations beat active CSS animations on the same property
         even from a totally unrelated rule. animation-play-state just freezes/resumes
         in place, doesn't reset it. */
      body.pause-fx-frozen.mld-paused:after {
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

// ---- MLD border colour, with the localStorage recovery safety net ----

async function setBorderColour(colour) {
  if (!game.modules.get(MLD_MODULE)?.active) return null; // MLD not installed/enabled -- border steps just no-op
  let prev = localStorage.getItem(BORDER_STASH_KEY);
  if (prev) {
    ui.notifications.warn(
      "pause-fx: found a leftover pause-border colour from an interrupted run -- restoring it once this pause ends.",
    );
  } else {
    prev = game.settings.get(MLD_MODULE, MLD_SETTING);
    localStorage.setItem(BORDER_STASH_KEY, prev);
  }
  await game.settings.set(MLD_MODULE, MLD_SETTING, colour);
  return prev;
}

async function restoreBorderColour(prev) {
  if (prev == null || !game.modules.get(MLD_MODULE)?.active) return;
  await game.settings.set(MLD_MODULE, MLD_SETTING, prev);
  localStorage.removeItem(BORDER_STASH_KEY);
}

// ---- the sequencer itself ----

export class PauseFX {
  /**
   * @param {object} config
   * @param {string} [config.icon] - image/GIF path for the pause icon.
   * @param {string} [config.iconGlow="red"] - CSS colour for the icon's drop-shadow.
   * @param {string} [config.borderColor="red"] - CSS hex colour for MLD's pause border.
   * @param {string} [config.text=""] - initial label text.
   * @param {number} [config.borderCycleMs] - border/eye pulse period. Defaults to 3640ms
   *   (28 frames @ 130ms, Norgorber.gif's real loop length) if not given -- pass this
   *   explicitly to sync against a different asset's own real timing instead.
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

    const prevBorderColour = await setBorderColour(borderColor);
    injectStyles({ borderCycleMs, textCycleMs: resolvedTextCycle });

    const resetOnUnpause = (paused) => {
      if (paused) return; // ignore the pause-on event this run itself triggers below
      restoreBorderColour(prevBorderColour);
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
