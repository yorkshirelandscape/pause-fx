// pause-fx -- declarative Foundry pause-screen effects engine.
//
// Two named clocks (`border`, `text`, independently timeable) drive a declarative `steps`
// array instead of a hand-written imperative sequence. See README.md for the config shape
// and a worked example.

const MODULE_ID = "pause-fx";
const BORDER_CLASS = "pause-fx-bordered";
const BORDER_FROZEN_CLASS = "pause-fx-border-frozen";
const BORDER_COLOUR_VAR = "--pause-fx-border-color";
const BORDER_SCALE_VAR = "--pause-fx-border-scale";
// No icon-GIF-timing auto-detection yet -- pass borderCycleMs explicitly to sync against a
// specific asset's real loop length (see README "Known limitations").
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

// `signal` (a run's own AbortController, see PauseFX.run) resolves this early -- so an
// unpause mid-sequence stops every pending timer immediately instead of them quietly firing
// in the background and applying a later step's effects to a game that's no longer paused.
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
      /* Higher specificity (extra class) wins without !important -- and needs to: an
         always-on !important box-shadow would silently cancel the animation above, since
         !important declarations beat active CSS animations on the same property even from
         a totally unrelated rule. animation-play-state just freezes it in place, doesn't
         reset it -- a pseudo-element has no real DOM node to set inline style on directly,
         which is why this is a class (toggled by step.stopBorderPulse) rather than the
         direct element.style.animationPlayState used for the icon/label. */
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

    /* The icon's own spin -- on the border's pulse clock, not whatever fixed duration
       Foundry's native icon spin used. Only this class ever drives the icon's animation
       property, so there's no risk of a second animation (e.g. a hypothetical icon-pulse)
       fighting it for the same property -- spin is the only thing that ever animates the icon. */
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

// A percentage DIFFERENCE from the border glow's default size -- 0 (or unset) is the size
// baked into the keyframes below, -100 shrinks it to nothing, +100 doubles it. setBorderWidth
// just scales that default via a CSS var, no re-injection needed. Clamped to >= 0: a macro
// hand-authoring JSON directly could pass something below the UI's own -100 floor.
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
   * @param {string} [config.iconGlow] - CSS colour for the icon's drop-shadow. Omitted, no glow.
   * @param {string} [config.borderColor] - any real CSS colour for pause-fx's own border-glow
   *   overlay. Omitted, no border overlay (and the label's pulsing text-colour rides on this
   *   too -- one themed effect, not two independent knobs).
   * @param {number} [config.borderWidth] - a percentage DIFFERENCE from the border glow's
   *   default size: 0 or omitted is that default, -100 shrinks it to nothing, +100 doubles
   *   it. Works independently of borderColor (a later step can resize a glow an earlier step
   *   already activated).
   * @param {boolean} [config.iconSpin=false] - spin the icon, on the border pulse clock (not
   *   whatever fixed duration Foundry's own native icon spin used). Freezable mid-rotation via
   *   a step's `stopIconSpin`.
   * @param {string} [config.text] - initial label text. Omitted, Foundry's own "Game Paused"
   *   stays untouched.
   * @param {number} [config.borderCycleMs] - border/eye pulse period, in ms. Defaults to
   *   3640ms if not given -- pass this explicitly to sync against a specific icon's own
   *   real loop length instead (e.g. a GIF's actual per-frame timing).
   * @param {number} [config.textCycleMs] - text pulse period. Defaults to
   *   borderCycleMs * textCycleMultiplier.
   * @param {number} [config.textCycleMultiplier=2] - only used if textCycleMs is omitted.
   * @param {object} [config.closeAllWindows] - broadcast closeAllWindows (via socketlib)
   *   before the sequence starts. Omit entirely to skip it; otherwise each connected client
   *   decides for itself whether to act, based on its own role.
   * @param {boolean} [config.closeAllWindows.players=true] - act on non-GM clients.
   * @param {boolean} [config.closeAllWindows.gm=true] - act on GM clients.
   * @param {boolean} [config.endCombat=false] - end the active encounter, if any, before
   *   the sequence starts.
   * @param {Array<object>} config.steps - see README.md for the full shape. Each step may
   *   have `wait: {units, clock: "border"|"text"}`, plus any of:
   *   - `text`, `textPulse`/`stopTextPulse` (start/freeze the label's own pulse, independent
   *     of borderColor activating it)
   *   - `icon`, `iconSpin`, `stopIconSpin`, `iconGlow`, `iconVisible`
   *   - `borderColor`, `borderWidth` (a percentage difference from the glow's default size --
   *     0 or omitted is that default), `stopBorderPulse` (freezes it in place; a later step
   *     setting borderColor again clears this automatically)
   *   - `video`, `loop` (video or image slideshow), `videoVolume`, `closeVideo`,
   *     `waitForVideoEnd`
   *   - `image` (a file, or a folder browsed as a slideshow), `imagePulses` (pulses to show
   *     each image before advancing -- 0 waits for the GM's manual-advance keybind instead;
   *     omitted, the old single-image behaviour: shown, no wait of its own), `waitForImageEnd`
   *   - `audio` (+ `audioVolume`, `audioLoop`), `stopAudio`, `waitForAudioEnd`
   *   - `unpause`
   *
   *   The non-`wait`/`text` fields above (other than the per-media ones) are the same fields
   *   `config` itself takes, just applicable at any point in the sequence, not only at the
   *   start (sparse: a step touches only the fields it sets). `closeVideo`/`stopAudio` tear
   *   down whatever `video`/`image`/`audio` an earlier step started -- symmetric pair, same
   *   idea, different media. `unpause` ends the sequence: `game.togglePause(false)` cuts the
   *   WHOLE run off right there (border/style state cleared, any overlay removed, any audio
   *   stopped) -- steps after it never run, the same as if the GM had pressed the pause
   *   button mid-sequence, which does the identical cleanup.
   *   `waitForVideoEnd`/`waitForAudioEnd`/`waitForImageEnd` gate the step's OWN `wait`
   *   from starting until the video/audio/slideshow currently playing (started by an earlier
   *   step) finishes -- they don't replace `wait`, they delay when it starts counting. A
   *   slideshow never blocks the step that starts it (same fire-and-forget shape as video/
   *   audio); `waitForImageEnd` fires once its first full pass completes, whether or not
   *   `loop` keeps it cycling in the background afterward.
   *   `endCombat`/`closeAllWindows` are `config`-level only -- there's no per-step equivalent.
   */
  static async run(config) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can trigger this.");
      return;
    }

    // This run's own cancellation token -- any unpause (the pause button, another run,
    // this run's own `step.unpause`) fires it, and every wait/gate below listens for it.
    // Without this, unpausing only ever cleared border state; a still-running sequence's
    // timers, gates, and background slideshow loop kept ticking and applying later steps'
    // effects (including a lingering video/image overlay) to a game that was no longer
    // paused -- see resetOnUnpause below for the actual cleanup this triggers.
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

    // `overlay`/`activeAudio` are declared with `let` further down (closer to where they're
    // actually set) -- referencing them here via closure is safe even though this function is
    // defined first, because it's never CALLED until the pauseGame hook actually fires, always
    // well after those declarations have run.
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
      if (borderColor) label.classList.add("pause-fx-label"); // see the run()-level comment above
      if (initialText !== undefined) label.textContent = initialText; // else leave "Game Paused"
    };
    const skin = (app, html) => {
      applySkin(app, html);
      Hooks.off("renderPause", skin);
      Hooks.off("renderGamePause", skin);
    };
    // Always register the hooks AND try a synchronous capture -- confirmed live that
    // togglePause(true) can replace the pause screen's content even when the game was
    // ALREADY paused (not just on a session's very first pause), so a synchronous capture
    // alone can never be trusted as final: whichever applySkin call actually lands last
    // (sync, or hook-driven) wins, since iconEl/label are shared closure variables.
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
      // An unpause (this run's own step.unpause included -- same hook, same cleanup) cuts
      // the whole sequence off right here; steps after it never run, not even the ones
      // whose effects wouldn't touch the pause screen at all.
      if (signal.aborted) break;

      // Gates, not replacements -- a step's own `wait` still runs afterward, it just doesn't
      // START counting until whichever event this step is gated on fires. Each races the
      // abort signal too -- an unpause that removes/stops the very thing being waited on
      // must not leave this hanging on an "ended"/"end" event that'll now never fire.
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

        // A slideshow (imagePulses set): advances through imageFiles on the pulse clock, 0
        // units meaning wait for a manual advance instead. Closes over `el` directly, not the
        // shared `overlay` var -- a later closeVideo removing/replacing overlay must not make
        // this write into the wrong element (or crash writing into null). Never blocks the step
        // that starts it -- same fire-and-forget shape as video/audio; a later step opts in to
        // actually waiting for it via `waitForImageEnd`, same two-step idiom as
        // `waitForVideoEnd`/`waitForAudioEnd`.
        if (!isVideo && step.imagePulses !== undefined) {
          let resolveSlideshowDone;
          activeImageSlideshowDone = new Promise((resolve) => { resolveSlideshowDone = resolve; });
          const showSlideshow = async () => {
            let i = 0;
            while (true) {
              // Checked BEFORE waiting again, not just relied on to fall out of an
              // already-resolved wait() -- otherwise an aborted signal (every future wait/
              // advance resolves instantly) would spin the loop through every remaining
              // image in one tick instead of actually stopping.
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
        // The pauseGame hook registered above (resetOnUnpause) does the actual cleanup
        // (border/style state, overlay, audio) and aborts this run -- it fires for ANY
        // unpause, not just one this run triggers itself. Steps after this one -- if any --
        // never run: the loop's own abort check at the top catches it on the next iteration.
        await game.togglePause(false, { broadcast: true });
      }
    }
  }
}

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { run: PauseFX.run.bind(PauseFX) };
});
