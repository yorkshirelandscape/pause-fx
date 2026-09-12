// pause-fx -- declarative Foundry pause-screen effects engine. [CC+: whole-file preamble]
//
// Two named clocks (`border`, `text`, independently timeable) drive a declarative `steps`
// array instead of a hand-written imperative sequence. See PauseFX.run's own JSDoc below
// for the config shape.

const MODULE_ID = "pause-fx";
const BORDER_CLASS = "pause-fx-bordered"; //+border-glow-owns-mld own body class, not MLD's
const BORDER_FROZEN_CLASS = "pause-fx-border-frozen";
const BAND_ID = "pause-fx-band"; // #pause's own background, recreated behind media -- see injectStyles
const BORDER_COLOUR_VAR = "--pause-fx-border-color";
const BORDER_SCALE_VAR = "--pause-fx-border-scale";
const TEXT_COLOUR_VAR = "--pause-fx-text-color"; //+text-pulse-animation-beats-inline-color
const TEXT_GLOW_INNER_VAR = "--pause-fx-text-glow-inner";
const TEXT_GLOW_OUTER_VAR = "--pause-fx-text-glow-outer";
const DEFAULT_GLOW_COLOUR = "rgb(255, 36, 0)"; // matches every other var's own hardcoded fallback
// No icon-GIF-timing auto-detection -- pass borderCycleMs explicitly to sync against a
// specific asset's real loop length.
const DEFAULT_BORDER_CYCLE_MS = 3640;

let socket;

//+socketlib-ready-race Registers pause-fx's socket immediately if socketlib is already
// loaded, otherwise once its "ready" hook fires -- load order isn't guaranteed.
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
    // Each side detaches the other, so neither outlives the wait it belongs to.
    const advance = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
    const onAbort = () => {
      const i = advanceResolvers.indexOf(advance);
      if (i !== -1) advanceResolvers.splice(i, 1);
      resolve();
    };
    advanceResolvers.push(advance);
    signal?.addEventListener("abort", onAbort, { once: true });
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
  return !!app.hasFrame; //+hasframe-regression closeAllWindows' own real-window signal
}

// Pause FX's own authoring tools -- closing these as a side effect of a sequence's own
// closeAllWindows would take out the very Composer a GM just clicked Run from to preview it.
const OWN_WINDOW_IDS = new Set(["pause-fx-composer", "pause-fx-step-editor"]);

/**
 * Closes every real floating window (legacy and ApplicationV2) on whichever client runs
 * this -- called via socket.executeForEveryone so every connected client closes its own,
 * each deciding for itself whether to act based on its own role vs. `target`. Leaves
 * Foundry's own docked UI chrome, and Pause FX's own Composer/step editor, untouched.
 * @param {object} [target]
 * @param {boolean} [target.players=true] - act on this client if its user is not a GM.
 * @param {boolean} [target.gm=true] - act on this client if its user is a GM.
 */
export function closeAllWindowsHandler({ players = true, gm = true } = {}) {
  if (game.user.isGM ? !gm : !players) return;
  Object.values(ui.windows).forEach((app) => app.close());
  for (const app of foundry.applications.instances.values()) {
    if (isRealWindow(app) && !OWN_WINDOW_IDS.has(app.id)) app.close();
  }
}

// `signal` is a run's own AbortController (see PauseFX.run) -- resolves this early on unpause.
// The listener is detached on a normal timeout, so a long sequence doesn't pile them up.
export const wait = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const onAbort = () => { clearTimeout(id); resolve(); };
  const id = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

// Resolves on the first of `events` to fire on `target`, or early on abort -- every listener
// self-detaches either way, so a long sequence doesn't pile them up on the run's own signal.
export function waitForEvent(target, events, signal) {
  return new Promise((resolve) => {
    const done = () => {
      for (const event of events) target.removeEventListener(event, done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    for (const event of events) target.addEventListener(event, done, { once: true });
    signal.addEventListener("abort", done, { once: true });
  });
}

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
 * @param {number} waitSpec.units - always in border-pulses; there's no other clock any more.
 * @param {object} clocks
 * @param {number} clocks.borderCycleMs
 * @returns {number} the wait, in ms.
 */
export function clockMsFor(waitSpec, { borderCycleMs }) {
  return waitSpec.units * borderCycleMs;
}

// ---- style injection (border + text pulse keyframes, scoped to this run) ----

let styleEl = null;

function injectStyles({ borderCycleMs, textCycleMs }) {
  styleEl?.remove(); // never orphan an earlier run's sheet under the same id
  styleEl = document.createElement("style");
  styleEl.id = "pause-fx-styles";
  styleEl.textContent = `
    /* Foundry's own 3s scale pulse on #pause.paused compounds against ours instead of
       complementing it, since the two are never in phase. */
    #pause.paused {
      animation: none !important;
      /* Foundry's own 180px overflows once our text pulse + a wrapped 2-line message are
         both in play (measured live). top shifts too, keeping Foundry's own visual center. */
      height: 240px;
      top: calc(50vh - 130px);
      /* Raised above the video/image overlay's 100000 -- a caption stays readable instead of
         buried under it. Its own band moves to #${BAND_ID} below, else it'd paint over the video. */
      background: none;
      z-index: 100001;
    }
    /* #pause's own band, recreated as its own element so it can sit behind the video/image
       overlay while #pause itself (icon/text) sits in front -- same gradient, same box. */
    #${BAND_ID} {
      position: fixed;
      width: 100%;
      height: 240px;
      top: calc(50vh - 130px);
      left: 0;
      background: linear-gradient(to right, transparent 0%, var(--color-cool-5-50) 40%, var(--color-cool-5-50) 60%, transparent 100%);
      pointer-events: none;
    }

    /*+border-glow-owns-mld own pseudo-element, works with or without MLD installed */
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
      /* Toggled via a class, not inline style like the icon/label below -- a pseudo-element
         has no DOM node for that. */
      body.${BORDER_FROZEN_CLASS}.${BORDER_CLASS}:before {
        animation-play-state: paused;
      }
    }

    /* Always on -- see setTextGlowRings. //+text-glow-double-ring-outline */
    .pause-fx-label-glow {
      text-shadow:
        0 0 1.5px var(${TEXT_GLOW_INNER_VAR}, black),
        0 0 1.5px var(${TEXT_GLOW_INNER_VAR}, black),
        0 0 10px var(${TEXT_GLOW_OUTER_VAR}, black);
    }

    /* Rides on border colour by default, or an explicit textGlow via the var above --
       //+text-pulse-animation-beats-inline-color the animation itself has to read the var. */
    @keyframes pause-fx-text-pulse {
      0%, 100% { color: color-mix(in srgb, var(${TEXT_COLOUR_VAR}, rgb(var(${BORDER_COLOUR_VAR}, 255, 36, 0))) 30%, black); transform: scale(1); }
      50% { color: var(${TEXT_COLOUR_VAR}, rgb(var(${BORDER_COLOUR_VAR}, 255, 36, 0))); transform: scale(1.08); }
    }
    @media (prefers-reduced-motion: reduce) {
      .pause-fx-label { color: var(${TEXT_COLOUR_VAR}, rgb(var(${BORDER_COLOUR_VAR}, 255, 36, 0))); }
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
  colourProbe.style.color = ""; // reset first, else an unparseable colour keeps the last one
  colourProbe.style.color = colour;
  const [r, g, b] = getComputedStyle(colourProbe).color.match(/\d+(\.\d+)?/g) ?? [255, 0, 0];
  return `${r}, ${g}, ${b}`;
}

// WCAG relative luminance (0 black -- 1 white) of an "r, g, b" triplet string.
function relativeLuminance(rgbTriplet) {
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgbTriplet.split(",").map((n) => linear(parseFloat(n) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The two-ring text glow: a tight inner ring and a diffuse outer one, lighter/darker tints
 *  of `colour` (via color-mix, same technique the pulse keyframes use), assigned so whichever
 *  ring touches the letters always contrasts with them -- dark text gets a light inner ring
 *  and a dark outer one, light text the reverse. A classic subtitle-outline trick, and one
 *  CSS can't do reactively on its own (no way to branch on a var's own lightness), so this
 *  runs in JS at every point the label's effective colour changes instead. */
function setTextGlowRings(label, colour) {
  const triplet = resolveRgbTriplet(colour);
  const lighter = `color-mix(in srgb, rgb(${triplet}) 55%, white)`;
  const darker = `color-mix(in srgb, rgb(${triplet}) 55%, black)`;
  const isDark = relativeLuminance(triplet) < 0.5;
  label.style.setProperty(TEXT_GLOW_INNER_VAR, isDark ? lighter : darker);
  label.style.setProperty(TEXT_GLOW_OUTER_VAR, isDark ? darker : lighter);
}

// The run's current border colour, read back off <body> -- used to recompute the glow rings'
// default (border-tracking) state without threading borderColor through every call site.
function currentBorderColourCss() {
  const triplet = getComputedStyle(document.body).getPropertyValue(BORDER_COLOUR_VAR).trim();
  return triplet ? `rgb(${triplet})` : DEFAULT_GLOW_COLOUR;
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

/**
 * AudioHelper.play(data) with autoplay:false is a documented no-op returning undefined --
 * "backwards compatibility" in Foundry's own source, not a loaded-but-paused Sound the way
 * pre-AV's own delayed start needs. Sound itself loads and starts independently instead.
 * @returns {Promise<object|null>} the Sound, or null if it couldn't be played.
 */
async function playSound(spec) {
  try {
    const sound = new foundry.audio.Sound(spec.src, { context: game.audio.interface });
    await sound.load();
    sound.volume = spec.volume ?? 1;
    sound.loop = !!spec.loop;
    if (spec.autoplay !== false) sound.play();
    return sound;
  } catch (error) {
    console.error("pause-fx | audio playback failed", error);
    ui.notifications.warn(`pause-fx: couldn't play "${spec.src}" -- carrying on without it.`);
    return null;
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
  //+foundry-icon-fa-spin-default Foundry's own icon spins by default -- stop once
  // we're managing it at all.
  iconEl.classList.remove("fa-spin");
  if (icon !== undefined) iconEl.src = icon;
  if (iconSpin !== undefined) {
    if (iconSpin && !styleEl) injectStyles(cycles);
    iconEl.classList.toggle("pause-fx-icon-spin", iconSpin);
    iconEl.style.animationPlayState = ""; // clears any earlier stopIconSpin freeze
  }
  if (iconGlow !== undefined) iconEl.style.filter = iconGlow ? `drop-shadow(0 0 12px ${iconGlow})` : "";
}

/** An explicit override for the label's ring glow AND its own fill colour -- a glow alone
 *  left the letters themselves still tracking border colour via .pause-fx-label's CSS,
 *  which read as "still the border's colour" instead of genuinely independent. Both a
 *  plain inline style.color AND the CSS var below are set: the var is what the always-on
 *  pulse animation (see its own keyframes) actually reads, since a running animation
 *  overrides a plain inline style every frame -- see //+text-pulse-animation-beats-inline-color.
 *  `label.dataset.textGlowSticky` marks the override active so a later step's own borderColor
 *  (activateBorder) doesn't reset the rings back to border-tracking out from under it. Falsy
 *  drops all three back to border-tracking (fill, rings, and the sticky flag itself); never
 *  called at all leaves that same default alone. */
function applyTextGlow(label, colour) {
  label.style.color = colour || "";
  if (colour) label.style.setProperty(TEXT_COLOUR_VAR, colour);
  else label.style.removeProperty(TEXT_COLOUR_VAR);
  label.dataset.textGlowSticky = colour ? "1" : "";
  setTextGlowRings(label, colour || currentBorderColourCss());
}

/** Idempotent -- injects the keyframes once, but setBorderColour always runs (may be a new colour). */
function activateBorder(colour, { borderCycleMs, textCycleMs, label }) {
  setBorderColour(colour);
  if (!styleEl) injectStyles({ borderCycleMs, textCycleMs });
  label?.classList.add("pause-fx-label");
  // An explicit step.textGlow owns the rings until its own falsy step -- don't let a later
  // border change silently override it (see applyTextGlow's own comment on the flag).
  if (label && !label.dataset.textGlowSticky) setTextGlowRings(label, colour);
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
   * @param {string} [config.textGlow] - CSS colour for the label's own text, and the base
   *   for its two-ring outline (a tight inner ring, a diffuse outer one, each a lighter/
   *   darker tint assigned by contrast against the text). Always on; omitted, all three
   *   track whatever borderColor is currently active instead of a fixed one.
   * @param {boolean} [config.iconSpin=false] - spin the icon, on the border pulse clock.
   * @param {string} [config.text] - initial label text. Omitted, Foundry's "GAME PAUSED" stays.
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

    // This run's own cancellation token -- any unpause fires it; every wait/gate below listens.
    const runController = new AbortController();
    const { signal } = runController;

    const {
      icon,
      iconGlow,
      borderColor,
      borderWidth,
      textGlow,
      iconSpin,
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
      // A socket hiccup shouldn't cost the whole reveal -- the GM's own screen still works.
      else await socket.executeForEveryone("closeAllWindows", closeAllWindows).catch((error) => {
        console.error("pause-fx | closeAllWindows broadcast failed", error);
      });
    }

    // Opt-in -- an un-customized run looks like Foundry's own pause screen, not a themed one.
    if (borderColor) {
      setBorderColour(borderColor);
      injectStyles({ borderCycleMs, textCycleMs: resolvedTextCycle });
    }
    if (borderWidth !== undefined) setBorderWidth(borderWidth);

    // Every sound this run started and hasn't stopped yet -- a set, not a single slot, so an
    // earlier detached track can't be orphaned (and left looping past unpause) by a later one.
    const activeSounds = new Set();
    const stopAllSounds = () => {
      for (const sound of activeSounds) sound.stop();
      activeSounds.clear();
    };

    // `overlay` is declared further down -- safe to close over here since this function isn't
    // called until the pauseGame hook fires, well after that declaration runs.
    const resetOnUnpause = (paused) => {
      if (paused) return; // ignore the pause-on event this run itself triggers below
      runController.abort(); //+abort-controller-unpause-cleanup stops every pending
      // wait/gate/background loop this run owns
      overlay?.remove();
      overlay = null;
      stopAllSounds();
      clearBorderColour();
      clearBorderWidth();
      document.body.classList.remove(BORDER_FROZEN_CLASS);
      removeStyles();
      document.getElementById(BAND_ID)?.remove();
      Hooks.off("pauseGame", resetOnUnpause);
    };
    Hooks.on("pauseGame", resetOnUnpause);

    let iconEl, label;
    const applySkin = (_app, html) => {
      const root = document.getElementById("pause") ?? (html instanceof jQuery ? html[0] : html);
      if (!root) return;
      if (!document.getElementById(BAND_ID)) {
        const band = document.createElement("div");
        band.id = BAND_ID;
        document.body.appendChild(band);
      }

      iconEl = root.querySelector("img, svg, i");
      if (iconEl && iconEl.tagName !== "IMG") {
        const img = document.createElement("img");
        img.className = iconEl.className;
        iconEl.replaceWith(img);
        iconEl = img;
      }
      // Any of the three on its own is enough -- glow or spin without a new icon path still applies.
      if (icon !== undefined || iconSpin !== undefined || iconGlow !== undefined) {
        applyIconChanges(iconEl, { icon, iconSpin, iconGlow }, { borderCycleMs, textCycleMs: resolvedTextCycle });
      }

      label = [...root.children].find((el) => el !== iconEl);
      if (!label) {
        label = document.createElement("div");
        Object.assign(label.style, {
          marginTop: "0.5em",
          fontSize: "2rem",
        });
        root.appendChild(label);
      }
      //+label-transform-origin-epicycle fixed, not content-based -- avoids moving
      // scale()'s own anchor point mid-pulse.
      label.style.width = "min(90vw, 32rem)";
      label.style.textAlign = "center";
      label.style.textWrap = "balance"; // spreads a wrap across the min line count evenly
      // Foundry's figcaption rule sets line-height:1rem, cramming a wrapped second line into
      // the first. Reserve room for two lines always (like width above) so length never nudges the icon.
      label.style.lineHeight = "1.15";
      label.style.height = "2.3em";
      // Hard 2-line cap (ellipsis past it) -- webkit-box, not flex, since line-clamp needs it;
      // box-pack replaces align-items for centering a short message within the reserved height.
      label.style.display = "-webkit-box";
      label.style.webkitBoxOrient = "vertical";
      label.style.webkitBoxPack = "center";
      label.style.webkitLineClamp = "2";
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";
      if (borderColor) label.classList.add("pause-fx-label"); // see the run()-level comment above
      label.classList.add("pause-fx-label-glow"); // always on -- see injectStyles' own rule
      setTextGlowRings(label, borderColor || DEFAULT_GLOW_COLOUR); // default; textGlow below wins if set
      if (textGlow !== undefined) applyTextGlow(label, textGlow);
      //+pause-text-transform-override only when actually setting custom text -- else the
      // untouched default should still read Foundry's own uppercase "GAME PAUSED".
      if (initialText !== undefined) {
        label.textContent = initialText;
        label.style.textTransform = "none";
      }
    };
    const skin = (app, html) => {
      applySkin(app, html);
      Hooks.off("renderPause", skin);
      Hooks.off("renderGamePause", skin);
    };
    //+render-pause-can-refire-mid-session both a hook listener and a synchronous
    // capture are needed -- either can land last.
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

    for (const step of steps) {
      // An unpause (this run's own step.unpause included) cuts the sequence off here.
      if (signal.aborted) break;

      //+apply-then-wait-step-model apply this step's own effects first, then hold
      // for its own duration (below).
      if (step.text !== undefined) {
        label.textContent = step.text;
        label.style.textTransform = "none"; //+pause-text-transform-override
      }
      if (step.textGlow !== undefined) applyTextGlow(label, step.textGlow);
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

      // //+pre-av-duration-post-av-step-model AV phase: video/image self-contained per step;
      // audio joins it only when waitForAudioEnd binds it, else detached (starts now, stoppable later).
      const hasVisual = !!(step.video || step.image);
      const audioBound = !!step.audio && !!step.waitForAudioEnd;
      const cycles = { borderCycleMs, textCycleMs: resolvedTextCycle };

      if (step.audio && !audioBound) {
        const detached = await playSound(
          { src: step.audio, volume: step.audioVolume ?? 0.8, autoplay: true, loop: !!step.audioLoop },
        );
        if (detached) activeSounds.add(detached);
      }

      if (hasVisual || audioBound) {
        const isVideo = !!step.video;
        const imageFiles = hasVisual && !isVideo ? await resolveImageFiles(step.image) : null;
        let visualEl = null;
        if (hasVisual) {
          visualEl = document.createElement(isVideo ? "video" : "img");
          Object.assign(visualEl.style, {
            position: "fixed",
            inset: "0",
            margin: "auto",
            width: "min(90vmin, 800px)",
            maxHeight: "90vh",
            zIndex: "100000", // above Foundry's own UI chrome -- #pause's icon/text sit higher still
          });
          // Loaded but not yet playing -- pre-AV (below) elapses before anything actually starts.
          if (isVideo) {
            Object.assign(visualEl, { src: step.video, autoplay: false, loop: !!step.loop, controls: false, volume: step.videoVolume ?? 0.5 });
          }
          document.body.appendChild(visualEl);
          overlay = visualEl;
        }
        let boundSound = null;
        if (audioBound) {
          boundSound = await playSound(
            { src: step.audio, volume: step.audioVolume ?? 0.8, autoplay: false, loop: !!step.audioLoop },
          );
          if (boundSound) activeSounds.add(boundSound);
        }

        if (step.preAV) await wait(clockMsFor(step.preAV, cycles), signal);
        if (signal.aborted) break;

        // 0-units imagePulses waits for a manual advance between slides; no imagePulses at
        // all is a single still with nothing to advance through.
        let slideshowDone = null;
        if (hasVisual) {
          if (isVideo) {
            visualEl.play();
          } else {
            visualEl.src = imageFiles[0];
            if (step.imagePulses !== undefined) {
              let resolveSlideshowDone;
              slideshowDone = new Promise((resolve) => { resolveSlideshowDone = resolve; });
              const showSlideshow = async () => {
                let i = 0;
                while (true) {
                  //+slideshow-closes-over-element-not-overlay isConnected: the step already
                  // ended and took the element with it -- else this loops past the run.
                  if (signal.aborted || !visualEl.isConnected) { resolveSlideshowDone(); return; }
                  if (i > 0) visualEl.src = imageFiles[i % imageFiles.length];
                  if (step.imagePulses === 0) await waitForManualAdvance(signal);
                  else await wait(clockMsFor({ units: step.imagePulses }, cycles), signal);
                  i++;
                  if (i >= imageFiles.length) {
                    resolveSlideshowDone(); // one full pass done, looping or not -- fires once
                    if (!step.loop) break;
                  }
                }
              };
              void showSlideshow();
            }
          }
        }
        if (boundSound) boundSound.play();

        // Explicit Duration always wins when set. Unset, wait for the later of whichever
        // channels aren't looping -- see the linked note if everything loops instead.
        const naturalEnds = [];
        if (hasVisual && !step.loop) {
          // "error" too: an unloadable video never fires "ended", and would hang the sequence.
          if (isVideo) naturalEnds.push(waitForEvent(visualEl, ["ended", "error"], signal));
          else if (slideshowDone) naturalEnds.push(slideshowDone);
        }
        if (boundSound && !step.audioLoop) {
          naturalEnds.push(waitForEvent(boundSound, ["end"], signal));
        }
        if (step.wait) {
          await wait(clockMsFor(step.wait, cycles), signal);
        } else if (naturalEnds.length) {
          await Promise.all(naturalEnds);
        } else {
          ui.notifications.error("pause-fx: a step's media all loops with no Duration set -- add one so it knows when to stop.");
        }
        if (signal.aborted) break;

        // Freeze rather than clean up outright -- holds through post-AV the same way a
        // video that already reached its own natural end just sits on its last frame.
        if (isVideo && visualEl) visualEl.pause();
        if (step.postAV) await wait(clockMsFor(step.postAV, cycles), signal);
        if (hasVisual) { overlay?.remove(); overlay = null; }
        if (boundSound) { boundSound.stop(); activeSounds.delete(boundSound); }
      }

      if (step.stopAudio) stopAllSounds();
      if (signal.aborted) break;

      // A step with no AV phase of its own just holds for its plain Duration, as always.
      if (!hasVisual && !audioBound && step.wait) {
        await wait(clockMsFor(step.wait, cycles), signal);
      }
      if (signal.aborted) break; // the wait/gate above may be what the unpause interrupted

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
  // ??=, not a plain assignment -- composer.js adds openComposer to this same object.
  if (mod) (mod.api ??= {}).run = PauseFX.run.bind(PauseFX);
});
