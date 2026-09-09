// pause-fx -- declarative Foundry pause-screen effects engine.
//
// Two named clocks (`border`, `text`, independently timeable) drive a declarative `steps`
// array instead of a hand-written imperative sequence. See PauseFX.run's own JSDoc below
// for the config shape.

const MODULE_ID = "pause-fx";
const BORDER_CLASS = "pause-fx-bordered";
const BORDER_FROZEN_CLASS = "pause-fx-border-frozen";
const BORDER_COLOUR_VAR = "--pause-fx-border-color";
const BORDER_SCALE_VAR = "--pause-fx-border-scale";
// No icon-GIF-timing auto-detection -- pass borderCycleMs explicitly to sync against a
// specific asset's real loop length.
const DEFAULT_BORDER_CYCLE_MS = 3640;

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

// ---- manual advance -- a GM keybind that resolves whichever step(s) are waiting on it ----

let advanceResolvers = [];

/**
 * @param {AbortSignal} [signal] - resolves early (without actually being "advanced") if this
 *   fires first -- an unpause mid-sequence shouldn't leave a manual-advance step hung forever.
 * @returns {Promise<void>} resolves the next time the GM presses the advance keybind.
 */
function waitForManualAdvance(signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    advanceResolvers.push(resolve);
    signal?.addEventListener("abort", () => {
      const i = advanceResolvers.indexOf(resolve);
      if (i !== -1) advanceResolvers.splice(i, 1);
      resolve();
    }, { once: true });
  });
}

Hooks.once("init", () => {
  game.keybindings.register(MODULE_ID, "advance", {
    name: "Advance Pause FX",
    hint: "While a pause-fx sequence is waiting on a manual-advance step (a 0-pulse timer), advances it.",
    editable: [],
    restricted: true, // GM only
    onDown: () => {
      if (!advanceResolvers.length) return false; // not consumed -- let it fall through
      const resolvers = advanceResolvers;
      advanceResolvers = [];
      resolvers.forEach((resolve) => resolve());
      return true;
    },
  });
});

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
 * this -- called via socket.executeForEveryone so every connected client closes its own,
 * each deciding for itself whether to act based on its own role vs. `target`. Leaves
 * Foundry's own docked UI chrome untouched.
 * @param {object} [target]
 * @param {boolean} [target.players=true] - act on this client if its user is not a GM.
 * @param {boolean} [target.gm=true] - act on this client if its user is a GM.
 */
export function closeAllWindowsHandler({ players = true, gm = true } = {}) {
  if (game.user.isGM ? !gm : !players) return;
  Object.values(ui.windows).forEach((app) => app.close());
  for (const app of foundry.applications.instances.values()) {
    if (isRealWindow(app)) app.close();
  }
}

// `signal` is a run's own AbortController (see PauseFX.run) -- resolves this early on unpause.
const wait = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const id = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(id); resolve(); }, { once: true });
});

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

    /* ${BORDER_SCALE_VAR} defaults to 1 (its keyframe-local fallback below) when never set --
       setBorderWidth() is the only thing that ever sets it, and it's entirely opt-in. */
    @keyframes pause-fx-border-pulse {
      0%, 100% { box-shadow: rgba(var(${BORDER_COLOUR_VAR}), 0.15) 0px 0px calc(30px * var(${BORDER_SCALE_VAR}, 1)) calc(15px * var(${BORDER_SCALE_VAR}, 1)) inset; }
      50% { box-shadow: rgba(var(${BORDER_COLOUR_VAR}), 0.35) 0px 0px calc(70px * var(${BORDER_SCALE_VAR}, 1)) calc(45px * var(${BORDER_SCALE_VAR}, 1)) inset; }
    }
    @media (prefers-reduced-motion: reduce) {
      body.${BORDER_CLASS}:before {
        box-shadow: rgba(var(${BORDER_COLOUR_VAR}), 0.25) 0px 0px calc(40px * var(${BORDER_SCALE_VAR}, 1)) calc(20px * var(${BORDER_SCALE_VAR}, 1)) inset !important;
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      body.${BORDER_CLASS}:before {
        animation: pause-fx-border-pulse ${borderCycleMs / 1000}s ease-in-out infinite;
      }
      /* animation-play-state freezes in place without resetting -- toggled via a class
         (step.stopBorderPulse) since a pseudo-element has no DOM node for inline style,
         unlike the icon/label below. Specificity alone beats the base rule; !important
         here would cancel the animation outright instead of just pausing it. */
      body.${BORDER_FROZEN_CLASS}.${BORDER_CLASS}:before {
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

    /* The icon's own spin, on the border's pulse clock rather than Foundry's fixed duration. */
    @keyframes pause-fx-icon-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: no-preference) {
      .pause-fx-icon-spin { animation: pause-fx-icon-spin ${borderCycleMs / 1000}s linear infinite; }
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

// deltaPct: 0/unset is the keyframes' baked-in size, -100 shrinks to nothing, +100 doubles it.
// Clamped to >= 0 -- a hand-authored macro could pass below the UI's own -100 floor.
function setBorderWidth(deltaPct) {
  const scale = Math.max(0, 1 + deltaPct / 100);
  document.body.style.setProperty(BORDER_SCALE_VAR, String(scale));
}

function clearBorderWidth() {
  document.body.style.removeProperty(BORDER_SCALE_VAR);
}

const IMAGE_EXTENSION = /\.(webp|png|jpe?g|gif|svg|avif|bmp)$/i;

/**
 * `path` may be a single image file or a folder of them (a slideshow) -- this is what tells
 * the two apart. A path that already looks like an image file is trusted as one outright
 * (skips the browse call entirely); anything else is browsed as a folder, falling back to
 * treating it as a single file if that fails or turns up nothing.
 * @param {string} path
 * @returns {Promise<Array<string>>} one or more file paths, in folder order.
 */
async function resolveImageFiles(path) {
  if (IMAGE_EXTENSION.test(path)) return [path];
  try {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    const { files } = await FilePicker.browse("data", path);
    const images = files.filter((f) => IMAGE_EXTENSION.test(f)).sort();
    return images.length ? images : [path];
  } catch {
    return [path]; // not a browsable folder -- treat the path as a single file after all
  }
}

// ---- shared by initial setup AND any step that touches icon/border, not just the first ----

/**
 * Sparse -- only touches the fields actually given, same "omitted = don't touch" as steps.
 * `cycles` (borderCycleMs/textCycleMs) is only actually needed when turning spin on, to
 * inject the keyframes if nothing else has yet -- harmless to pass always.
 */
function applyIconChanges(iconEl, { icon, iconSpin, iconGlow }, cycles) {
  if (!iconEl) return;
  // Foundry's own pause icon spins by default (GamePause's own `spin: true` option adds
  // FontAwesome's fa-spin class directly to the <img>) -- once pause-fx starts managing this
  // icon at all, that native spin needs to actually stop, not just get ignored by our own
  // separate iconSpin toggle, which only ever touches pause-fx-icon-spin.
  iconEl.classList.remove("fa-spin");
  if (icon !== undefined) iconEl.src = icon;
  if (iconSpin !== undefined) {
    if (iconSpin && !styleEl) injectStyles(cycles);
    iconEl.classList.toggle("pause-fx-icon-spin", iconSpin);
    iconEl.style.animationPlayState = ""; // clears any earlier stopIconSpin freeze
  }
  if (iconGlow !== undefined) iconEl.style.filter = iconGlow ? `drop-shadow(0 0 12px ${iconGlow})` : "";
}

/** Idempotent -- injects the keyframes once, but setBorderColour always runs (may be a new colour). */
function activateBorder(colour, { borderCycleMs, textCycleMs, label }) {
  setBorderColour(colour);
  if (!styleEl) injectStyles({ borderCycleMs, textCycleMs });
  label?.classList.add("pause-fx-label");
  document.body.classList.remove(BORDER_FROZEN_CLASS); // clears any earlier stopBorderPulse freeze
}

/** Starts the label's own pulse independently of border activation (activateBorder does this
 * too, as a side effect -- this is for wanting the text to pulse without a border glow). */
function activateTextPulse(label, { borderCycleMs, textCycleMs }) {
  if (!styleEl) injectStyles({ borderCycleMs, textCycleMs });
  label.classList.add("pause-fx-label");
  label.style.animationPlayState = ""; // clears any earlier stopTextPulse freeze
}

// ---- the sequencer itself ----

export class PauseFX {
  /**
   * @param {object} config
   * @param {string} [config.icon] - image/GIF path for the pause icon. Omitted, Foundry's own
   *   default icon stays untouched.
   * @param {string} [config.iconGlow] - CSS colour for the icon's drop-shadow.
   * @param {string} [config.borderColor] - CSS colour for pause-fx's border-glow overlay.
   *   Omitted, no overlay (the label's pulsing text-colour rides on this too).
   * @param {number} [config.borderWidth] - % difference from the border glow's default size.
   * @param {boolean} [config.iconSpin=false] - spin the icon, on the border pulse clock.
   * @param {string} [config.text] - initial label text. Omitted, Foundry's "Game Paused" stays.
   * @param {number} [config.borderCycleMs=3640] - border/eye pulse period, in ms.
   * @param {number} [config.textCycleMs] - text pulse period. Defaults to
   *   borderCycleMs * textCycleMultiplier.
   * @param {number} [config.textCycleMultiplier=2] - only used if textCycleMs is omitted.
   * @param {object} [config.closeAllWindows] - broadcast closeAllWindows before the sequence
   *   starts. Omitted, skipped entirely.
   * @param {boolean} [config.closeAllWindows.players=true]
   * @param {boolean} [config.closeAllWindows.gm=true]
   * @param {boolean} [config.endCombat=false] - end the active encounter before the sequence starts.
   * @param {Array<object>} config.steps - each step may set `wait` plus any of the fields
   *   handled in the loop below, applicable at any point in the sequence, not just the start.
   */
  static async run(config) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can trigger this.");
      return;
    }

    // This run's own cancellation token -- any unpause (the pause button, another run, this
    // run's own step.unpause) fires it, and every wait/gate/loop below listens for it, so
    // nothing keeps applying later steps' effects after the game is no longer paused.
    const runController = new AbortController();
    const { signal } = runController;

    const {
      icon,
      iconGlow,
      borderColor,
      borderWidth,
      iconSpin = false,
      text: initialText,
      borderCycleMs = DEFAULT_BORDER_CYCLE_MS,
      textCycleMs,
      textCycleMultiplier = 2,
      closeAllWindows,
      endCombat: shouldEndCombat = false,
      steps = [],
    } = config;
    const resolvedTextCycle = resolveTextCycleMs({ textCycleMs, borderCycleMs, textCycleMultiplier });

    if (shouldEndCombat) await game.combat?.endCombat();
    if (closeAllWindows) {
      if (!socket) ui.notifications.warn("pause-fx: socketlib isn't ready yet, skipping closeAllWindows.");
      else await socket.executeForEveryone("closeAllWindows", closeAllWindows);
    }

    // Opt-in -- an un-customized run looks like Foundry's own pause screen, not a themed one.
    if (borderColor) {
      setBorderColour(borderColor);
      injectStyles({ borderCycleMs, textCycleMs: resolvedTextCycle });
    }
    if (borderWidth !== undefined) setBorderWidth(borderWidth);

    // overlay/activeAudio are declared further down -- safe to close over here since this
    // function isn't called until the pauseGame hook fires, well after those declarations run.
    const resetOnUnpause = (paused) => {
      if (paused) return; // ignore the pause-on event this run itself triggers below
      runController.abort(); // stop every pending wait/gate/background loop this run owns
      overlay?.remove();
      overlay = null;
      activeAudio?.stop();
      activeAudio = null;
      clearBorderColour();
      clearBorderWidth();
      document.body.classList.remove(BORDER_FROZEN_CLASS);
      removeStyles();
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
      if (icon !== undefined) applyIconChanges(iconEl, { icon, iconSpin, iconGlow }, { borderCycleMs, textCycleMs: resolvedTextCycle });

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
      // Foundry forces text-transform:uppercase on #pause's caption; a custom message should
      // render as typed. An inline style beats that regardless of specificity, and stays put
      // through every later label.textContent rewrite.
      label.style.textTransform = "none";
      if (borderColor) label.classList.add("pause-fx-label"); // see the run()-level comment above
      if (initialText !== undefined) label.textContent = initialText; // else leave "Game Paused"
    };
    const skin = (app, html) => {
      applySkin(app, html);
      Hooks.off("renderPause", skin);
      Hooks.off("renderGamePause", skin);
    };
    // Both a hook listener and a synchronous capture are needed -- togglePause(true) can
    // replace the pause screen's content even on an already-paused game. Whichever applySkin
    // call lands last wins, since iconEl/label are shared closure variables.
    Hooks.once("renderPause", skin); // pre-V13 class name
    Hooks.once("renderGamePause", skin); // V13+ (GamePause)
    if (ui.pause.rendered) applySkin(ui.pause, ui.pause.element);

    await game.togglePause(true, { broadcast: true });

    // Give a real render (and the hooks above) a moment to land before trusting anything --
    // then stop listening, so a stray LATER pause elsewhere doesn't re-skin mid-sequence.
    await wait(150, signal);
    Hooks.off("renderPause", skin);
    Hooks.off("renderGamePause", skin);
    if (!iconEl || !label) await wait(200, signal); // still not ready? slower client -- give it longer.
    if (!document.getElementById("pause") || !label) {
      ui.notifications.error("pause-fx: pause screen never rendered, aborting the sequence.");
      return;
    }

    let overlay = null; // the current video/image element, if any
    let activeAudio = null; // the current standalone Sound, if any (see step.audio)
    let activeImageSlideshowDone = null; // resolves once the current slideshow completes one
    // full pass (looping or not) -- see step.waitForImageEnd below

    for (const step of steps) {
      // An unpause (this run's own step.unpause included) cuts the sequence off here.
      if (signal.aborted) break;

      // Gates, not replacements -- a step's own `wait` still runs after, just doesn't start
      // counting until the gated event fires. Races the abort signal too, so an unpause that
      // stops the thing being waited on doesn't hang on an event that'll now never fire. This
      // is the cross-step case, gating on media an EARLIER step started; a step that starts
      // its own media and also sets the matching waitForXEnd waits for that instead, right
      // after creating it further down.
      if (step.waitForVideoEnd && overlay instanceof HTMLVideoElement) {
        await new Promise((resolve) => {
          overlay.addEventListener("ended", resolve, { once: true });
          signal.addEventListener("abort", resolve, { once: true });
        });
      }
      if (step.waitForAudioEnd && activeAudio) {
        await new Promise((resolve) => {
          activeAudio.addEventListener("end", resolve, { once: true });
          signal.addEventListener("abort", resolve, { once: true });
        });
      }
      if (step.waitForImageEnd && activeImageSlideshowDone) await activeImageSlideshowDone;
      if (step.wait) {
        await wait(clockMsFor(step.wait, { borderCycleMs, textCycleMs: resolvedTextCycle }), signal);
      }
      if (signal.aborted) break; // the wait/gate above may be what the unpause interrupted

      if (step.text !== undefined) label.textContent = step.text;
      if (step.textPulse) activateTextPulse(label, { borderCycleMs, textCycleMs: resolvedTextCycle });
      if (step.stopTextPulse) label.style.animationPlayState = "paused";
      if (step.iconVisible !== undefined && iconEl) {
        iconEl.style.visibility = step.iconVisible ? "visible" : "hidden";
      }

      if (step.icon !== undefined || step.iconSpin !== undefined || step.iconGlow !== undefined) {
        applyIconChanges(
          iconEl,
          { icon: step.icon, iconSpin: step.iconSpin, iconGlow: step.iconGlow },
          { borderCycleMs, textCycleMs: resolvedTextCycle },
        );
      }
      if (step.stopIconSpin && iconEl) iconEl.style.animationPlayState = "paused";
      if (step.borderColor) {
        activateBorder(step.borderColor, { borderCycleMs, textCycleMs: resolvedTextCycle, label });
      }
      if (step.borderWidth !== undefined) setBorderWidth(step.borderWidth);
      if (step.stopBorderPulse) document.body.classList.add(BORDER_FROZEN_CLASS);

      if (step.audio) {
        activeAudio = await foundry.audio.AudioHelper.play(
          { src: step.audio, volume: step.audioVolume ?? 0.8, autoplay: true, loop: !!step.audioLoop },
          false,
        );
        // The early gate above only catches waitForAudioEnd on a LATER step, for audio an
        // earlier one started -- this is the same-step case, waiting for what was just set.
        if (step.waitForAudioEnd) {
          await new Promise((resolve) => {
            activeAudio.addEventListener("end", resolve, { once: true });
            signal.addEventListener("abort", resolve, { once: true });
          });
        }
      }

      if (step.video || step.image) {
        const isVideo = !!step.video;
        const imageFiles = isVideo ? null : await resolveImageFiles(step.image);

        const el = document.createElement(isVideo ? "video" : "img");
        Object.assign(el.style, {
          position: "fixed",
          inset: "0",
          margin: "auto",
          width: "min(90vmin, 800px)",
          maxHeight: "90vh",
          zIndex: "100000", // above Foundry's own UI chrome, not just #pause
        });
        if (isVideo) {
          Object.assign(el, { src: step.video, autoplay: true, loop: !!step.loop, controls: false, volume: step.videoVolume ?? 0.5 });
        } else {
          el.src = imageFiles[0]; // a folder's first file, alphabetically, or the single file itself
        }
        document.body.appendChild(el);
        overlay = el;

        // Same-step case (see the audio one above) -- waitForVideoEnd on the step that
        // itself started this video, not just a later step gating on an earlier one's.
        if (isVideo && step.waitForVideoEnd) {
          await new Promise((resolve) => {
            el.addEventListener("ended", resolve, { once: true });
            signal.addEventListener("abort", resolve, { once: true });
          });
        }

        // A slideshow (imagePulses set): advances through imageFiles on the pulse clock, 0
        // units meaning wait for a manual advance. Closes over `el` directly, not `overlay`
        // -- a later closeVideo swapping overlay mustn't redirect this write. Fire-and-forget
        // by default; this step or a later one opts in via waitForImageEnd.
        if (!isVideo && step.imagePulses !== undefined) {
          let resolveSlideshowDone;
          activeImageSlideshowDone = new Promise((resolve) => { resolveSlideshowDone = resolve; });
          const showSlideshow = async () => {
            let i = 0;
            while (true) {
              // Checked before waiting again -- an aborted signal resolves every future wait
              // instantly, so this stops the loop instead of spinning through every image.
              if (signal.aborted) {
                resolveSlideshowDone(); // unblock anything gated on waitForImageEnd, not left hanging
                return;
              }
              if (i > 0) el.src = imageFiles[i % imageFiles.length];
              if (step.imagePulses === 0) await waitForManualAdvance(signal);
              else await wait(clockMsFor({ units: step.imagePulses }, { borderCycleMs, textCycleMs: resolvedTextCycle }), signal);
              i++;
              if (i >= imageFiles.length) {
                resolveSlideshowDone(); // one full pass done, looping or not -- fires exactly once
                if (!step.loop) break;
              }
            }
          };
          void showSlideshow();
          if (step.waitForImageEnd) await activeImageSlideshowDone; // same-step case, as above
        }
      }
      if (step.closeVideo) {
        overlay?.remove();
        overlay = null;
      }
      if (step.stopAudio) {
        activeAudio?.stop();
        activeAudio = null;
      }
      if (step.unpause) {
        // resetOnUnpause (the pauseGame hook above) does the actual cleanup and aborts this
        // run; the loop's own abort check catches it on the next iteration.
        await game.togglePause(false, { broadcast: true });
      }
    }
  }
}

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { run: PauseFX.run.bind(PauseFX) };
});
