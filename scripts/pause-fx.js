// pause-fx -- declarative Foundry pause-screen effects engine. [CC+: whole-file preamble]
//
// One base clock (Cycle Time) plus a per-element, per-step "beats per cycle" multiplier for
// each of icon/text/border drives a declarative `steps` array instead of a hand-written
// imperative sequence. See PauseFX.run's own JSDoc below for the config shape.

const MODULE_ID = "pause-fx";
const BORDER_CLASS = "pause-fx-bordered"; //+border-glow-owns-mld own body class, not MLD's
const BORDER_FROZEN_CLASS = "pause-fx-border-frozen";
const BAND_ID = "pause-fx-band"; // #pause's own background, recreated behind media -- see injectStyles
const BORDER_COLOUR_VAR = "--pause-fx-border-color";
const BORDER_SCALE_VAR = "--pause-fx-border-scale";
const BORDER_DURATION_VAR = "--pause-fx-border-duration";
const TEXT_COLOUR_VAR = "--pause-fx-text-color"; //+text-pulse-animation-beats-inline-color
const TEXT_DURATION_VAR = "--pause-fx-text-duration"; // shared by dilate and fade
const TEXT_GLOW_CLASS = "pause-fx-label-glow";
const TEXT_GLOW_DARK_CLASS = "pause-fx-text-glow-dark"; // which ring mixes toward white vs black
const DILATE_PLAY_VAR = "--pause-fx-dilate-play";
const FADE_PLAY_VAR = "--pause-fx-fade-play";
const ICON_DURATION_VAR = "--pause-fx-icon-duration";
// //+cycle-time-beats-per-cycle no per-element default chases Foundry's own (mismatched)
// timings -- one beat per cycle for everything is the simpler zero-config baseline.
export const DEFAULT_CYCLE_MS = 3000;
// Seizure-safety floor -- //+cycle-time-beats-per-cycle for the guidance this follows.
const MIN_BEAT_MS = 500;

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

// ---- manual advance -- a double-click on the slideshow image resolves whatever's waiting ----

let advanceResolvers = [];

/** Resolves every pending waitForManualAdvance() at once -- wired to the slideshow image's
 *  own dblclick, not a keybind (see git history for the earlier keybind-based version). */
function advanceAll() {
  const resolvers = advanceResolvers;
  advanceResolvers = [];
  resolvers.forEach((resolve) => resolve());
}

/**
 * @param {AbortSignal} [signal] - resolves early (without actually being "advanced") if this
 *   fires first -- an unpause mid-sequence shouldn't leave a manual-advance step hung forever.
 * @returns {Promise<void>} resolves the next time the displayed image is double-clicked.
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

/**
 * Whether `app` is a real floating window (a titled window with a close control), as
 * opposed to one of Foundry's own persistent docked UI regions.
 * @param {object} app - an ApplicationV2 instance.
 * @returns {boolean}
 */
export function isRealWindow(app) {
  return !!app.hasFrame; //+hasframe-regression closeAllWindows' own real-window signal
}

// Pause FX's own authoring tools -- minimizing these as a side effect of a sequence's own
// closeAllWindows would fight the Composer's own self-minimize when a GM clicks Run to preview it.
const OWN_WINDOW_IDS = new Set(["pause-fx-composer", "pause-fx-step-editor"]);

/**
 * Minimizes every real floating window (legacy and ApplicationV2) on whichever client runs
 * this -- called via socket.executeForEveryone so every connected client minimizes its own,
 * each deciding for itself whether to act based on its own role vs. `target`. Leaves
 * Foundry's own docked UI chrome, and Pause FX's own Composer/step editor, untouched.
 * Minimizing, not closing -- nothing open gets lost, it's just out of the way.
 * @param {object} [target]
 * @param {boolean} [target.players=true] - act on this client if its user is not a GM.
 * @param {boolean} [target.gm=true] - act on this client if its user is a GM.
 */
export function closeAllWindowsHandler({ players = true, gm = true } = {}) {
  if (game.user.isGM ? !gm : !players) return;
  Object.values(ui.windows).forEach((app) => app.minimize());
  for (const app of foundry.applications.instances.values()) {
    if (isRealWindow(app) && !OWN_WINDOW_IDS.has(app.id)) app.minimize();
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
 * @param {object} waitSpec
 * @param {number} waitSpec.units - always in Cycle Time units; beats-per-cycle (below) only
 *   affects how fast icon/text/border visually animate, never a step's own Duration.
 * @param {object} clocks
 * @param {number} clocks.cycleMs
 * @returns {number} the wait, in ms.
 */
export function clockMsFor(waitSpec, { cycleMs }) {
  return waitSpec.units * cycleMs;
}

/**
 * cycleMs / beatsPerCycle, clamped to MIN_BEAT_MS (and warning when that clamp actually
 * bites) so a GM dialing beats-per-cycle up can't silently produce a seizure-risk flicker --
 * see MIN_BEAT_MS's own comment for the guidance this follows.
 * @param {number} cycleMs
 * @param {number} beatsPerCycle - 0/falsy treated as 1 (one beat per cycle, the baseline).
 * @param {string} label - which element this is for for ("icon"/"text"/"border"), for the
 *   warning message only.
 * @returns {number} the beat's own period, in seconds (ready for a CSS animation-duration).
 */
export function beatDurationS(cycleMs, beatsPerCycle, label) {
  const rawMs = cycleMs / (beatsPerCycle || 1);
  if (rawMs >= MIN_BEAT_MS) return rawMs / 1000;
  ui.notifications.warn(
    `pause-fx: ${label}'s beats-per-cycle would pulse faster than ${MIN_BEAT_MS}ms -- capped for photosensitivity safety.`,
  );
  return MIN_BEAT_MS / 1000;
}

// Foundry's own real icon-spin duration, hardcoded -- //+foundry-default-continuity why.
const FOUNDRY_ICON_SPIN_MS = 5000;

// ---- style injection (border + text pulse keyframes, scoped to this run) ----

let styleEl = null;

// Fully static -- every duration is a CSS var, set on its own element (setBeatDuration),
// not interpolated here. //+cycle-time-beats-per-cycle why, and why that's an improvement.
function injectStyles() {
  if (styleEl) return;
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
        animation: pause-fx-border-pulse var(${BORDER_DURATION_VAR}, 3s) ease-in-out infinite;
      }
      /* Toggled via a class, not inline style like the icon/label below -- a pseudo-element
         has no DOM node for that. */
      body.${BORDER_FROZEN_CLASS}.${BORDER_CLASS}:before {
        animation-play-state: paused;
      }
    }

    /* Only present once real customization happens; currentColor tracks Fade live.
       //+text-glow-double-ring-outline */
    .${TEXT_GLOW_CLASS} {
      text-shadow:
        0 0 1.5px color-mix(in srgb, currentColor 55%, black),
        0 0 1.5px color-mix(in srgb, currentColor 55%, black),
        0 0 10px color-mix(in srgb, currentColor 55%, white);
    }
    .${TEXT_GLOW_CLASS}.${TEXT_GLOW_DARK_CLASS} {
      text-shadow:
        0 0 1.5px color-mix(in srgb, currentColor 55%, white),
        0 0 1.5px color-mix(in srgb, currentColor 55%, white),
        0 0 10px color-mix(in srgb, currentColor 55%, black);
    }

    /* No hardcoded fallback -- inherits Foundry's own colour, not red. //+text-glow-double-ring-outline
       //+text-pulse-animation-beats-inline-color the animation itself has to read the var. */
    .pause-fx-label { color: var(${TEXT_COLOUR_VAR}, rgb(var(${BORDER_COLOUR_VAR}))); }
    @keyframes pause-fx-text-fade {
      0%, 100% { color: color-mix(in srgb, var(${TEXT_COLOUR_VAR}, rgb(var(${BORDER_COLOUR_VAR}))) 30%, black); }
      50% { color: var(${TEXT_COLOUR_VAR}, rgb(var(${BORDER_COLOUR_VAR}))); }
    }
    .pause-fx-text-fade { animation: pause-fx-text-fade var(${TEXT_DURATION_VAR}, 3s) ease-in-out infinite; animation-play-state: var(${FADE_PLAY_VAR}, running); }

    @keyframes pause-fx-text-dilate {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.025); } /* Foundry's own real peak -- //+foundry-default-continuity */
    }
    @media (prefers-reduced-motion: no-preference) {
      .pause-fx-text-dilate { animation: pause-fx-text-dilate var(${TEXT_DURATION_VAR}, 3s) ease-in-out infinite; animation-play-state: var(${DILATE_PLAY_VAR}, running); }
    }

    /* Foundry's own fixed-duration spin -- see foundry-icon-fa-spin-default -- is stopped
       and replaced with this once pause-fx manages the icon at all. */
    @keyframes pause-fx-icon-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: no-preference) {
      .pause-fx-icon-spin { animation: pause-fx-icon-spin var(${ICON_DURATION_VAR}, 3s) linear infinite; }
    }
  `;
  document.head.appendChild(styleEl);
}

function removeStyles() {
  styleEl?.remove();
  styleEl = null;
}

// Sets one element's own beat-duration var -- see beatDurationS for the actual math/clamp.
function setBeatDuration(el, varName, cycleMs, beatsPerCycle, label) {
  el.style.setProperty(varName, `${beatDurationS(cycleMs, beatsPerCycle, label)}s`);
}

// Keeps a mid-flight speed change seamless -- //+icon-spin-retiming-jump why. animationNames
// may be one name or several (retimes whichever's actually running); pseudo e.g. "::before".
function retimeAnimation(el, animationNames, varName, cycleMs, beatsPerCycle, label, pseudo) {
  const names = Array.isArray(animationNames) ? animationNames : [animationNames];
  const anim = el.getAnimations({ subtree: true }).find((a) => names.includes(a.animationName));
  const durationMs = () => parseFloat(getComputedStyle(el, pseudo).animationDuration) * 1000;
  const oldDurationMs = anim ? durationMs() : 0;
  const phase = oldDurationMs ? (anim.currentTime % oldDurationMs) / oldDurationMs : 0;
  setBeatDuration(el, varName, cycleMs, beatsPerCycle, label);
  if (anim) anim.currentTime = phase * durationMs();
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
 *  assigned so whichever ring touches the letters always contrasts with them -- dark text
 *  gets a light inner ring and a dark outer one, light text the reverse. `colour` only
 *  decides that light/dark assignment (CSS can't branch on a var's own lightness, so this
 *  runs in JS); the tints themselves are computed live in CSS via currentColor, not baked
 *  in here, so the rings track the label's actual rendered colour -- including a running
 *  Fade animation -- automatically. */
function setTextGlowRings(label, colour) {
  const isDark = relativeLuminance(resolveRgbTriplet(colour)) < 0.5;
  label.classList.add(TEXT_GLOW_CLASS);
  label.classList.toggle(TEXT_GLOW_DARK_CLASS, isDark);
}

// The "no glow at all" counterpart -- an explicit textGlow cleared with nothing to fall
// back on (no border ever set either) should read as fully un-customized, not just un-tinted.
function clearTextGlowRings(label) {
  label.classList.remove(TEXT_GLOW_CLASS, TEXT_GLOW_DARK_CLASS);
}

// Border colour read back off <body>, or null if unset (not pause-fx's own red) --
// //+text-glow-double-ring-outline
function currentBorderColourCss() {
  const triplet = getComputedStyle(document.body).getPropertyValue(BORDER_COLOUR_VAR).trim();
  return triplet ? `rgb(${triplet})` : null;
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
 * (skips the browse call entirely); anything else is browsed as a folder. `browse()` itself
 * takes the storage source as a plain required argument -- no inference, no "just tell me
 * what's there" form -- so a bare path (all a hand-written or Composer-saved step ever has)
 * genuinely doesn't say which one it lives under; a GM's own upload is "data", a core-shipped
 * folder like icons/* is "public". Tried in that order (favoring the more common real-world
 * case), and the server's own success/failure is what settles it -- not a copy of Foundry's
 * own internal directory list, which could drift out of sync with a future version. Falls
 * back to treating the path as a single file if neither resolves it.
 * @param {string} path
 * @returns {Promise<Array<string>>} one or more file paths, in folder order.
 */
async function resolveImageFiles(path) {
  if (IMAGE_EXTENSION.test(path)) return [path];
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  for (const source of ["data", "public"]) {
    try {
      const { files } = await FilePicker.browse(source, path);
      const images = files.filter((f) => IMAGE_EXTENSION.test(f)).sort();
      if (images.length) return images;
    } catch {
      // not browsable under this source -- try the other, or fall through to the literal path
    }
  }
  return [path];
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
 * Its own beat duration is set wherever iconBeatsPerCycle is known, not here (see setBeatDuration).
 * currentlySpinning/the return value thread continuity across calls -- //+foundry-default-continuity.
 * durationEverSet decides whether a spin reaches for Foundry's real rate --
 * //+icon-spin-duration-source-of-truth why this, not iconSpin's own explicit/inherited
 * status (a Composer-authored step's iconSpin is never genuinely "inherited" on the wire).
 * @returns {boolean} the spin state now in effect, for the caller's own next call.
 */
function applyIconChanges(iconEl, { icon, iconSpin, iconGlow }, currentlySpinning, durationEverSet) {
  if (!iconEl) return currentlySpinning;
  const spinning = iconSpin !== undefined ? iconSpin : currentlySpinning;
  iconEl.classList.remove("fa-spin"); //+foundry-icon-fa-spin-default Foundry's own native class -- replaced by our own below
  if (icon !== undefined) iconEl.src = icon;
  if (spinning) {
    injectStyles();
    if (!durationEverSet) iconEl.style.setProperty(ICON_DURATION_VAR, `${FOUNDRY_ICON_SPIN_MS / 1000}s`);
  }
  iconEl.classList.toggle("pause-fx-icon-spin", spinning);
  // Only an explicit iconSpin resume clears a stopIconSpin freeze -- an icon/iconGlow change
  // alone shouldn't quietly restart a rotation the author deliberately froze.
  if (iconSpin !== undefined) iconEl.style.animationPlayState = "";
  if (iconGlow !== undefined) iconEl.style.filter = iconGlow ? `drop-shadow(0 0 12px ${iconGlow})` : "";
}

/** An explicit override for the label's ring glow AND its own fill colour -- a glow alone
 *  left the letters themselves still tracking border colour via .pause-fx-label's CSS,
 *  which read as "still the border's colour" instead of genuinely independent. Both a
 *  plain inline style.color AND the CSS var below are set: the var is what Fade's own
 *  keyframes (see injectStyles) actually read, since a running animation overrides a plain
 *  inline style every frame -- see //+text-pulse-animation-beats-inline-color.
 *  `label.dataset.textGlowSticky` marks the override active so a later step's own borderColor
 *  (activateBorder) doesn't reset the rings back to border-tracking out from under it. Falsy
 *  drops all three back to border-tracking (fill, rings, and the sticky flag itself) -- or,
 *  with no border ever set either, to fully un-customized; never called at all leaves that
 *  same default alone. */
function applyTextGlow(label, colour) {
  label.style.color = colour || "";
  if (colour) label.style.setProperty(TEXT_COLOUR_VAR, colour);
  else label.style.removeProperty(TEXT_COLOUR_VAR);
  label.dataset.textGlowSticky = colour ? "1" : "";
  const ringColour = colour || currentBorderColourCss();
  if (ringColour) setTextGlowRings(label, ringColour);
  else clearTextGlowRings(label);
}

/** Idempotent -- injects the keyframes once, but setBorderColour always runs (may be a new colour). */
function activateBorder(colour, { label }) {
  setBorderColour(colour);
  injectStyles();
  label?.classList.add("pause-fx-label");
  // An explicit step.textGlow owns the rings until its own falsy step -- don't let a later
  // border change silently override it (see applyTextGlow's own comment on the flag).
  if (label && !label.dataset.textGlowSticky) setTextGlowRings(label, colour);
  document.body.classList.remove(BORDER_FROZEN_CLASS); // clears any earlier stopBorderPulse freeze
}

/** Starts the label's own dilate (scale only, no colour) independently of border activation. */
// //+text-dilate-fade-mutually-exclusive each clears the other's class -- both are the same
// `animation` shorthand property on one element, so leaving both set is never additive.
function activateTextDilate(label) {
  injectStyles();
  label.classList.remove("pause-fx-text-fade");
  label.classList.add("pause-fx-text-dilate");
  label.style.removeProperty(DILATE_PLAY_VAR); // clears any earlier stopTextPulse freeze
}

/** Starts the label's own fade (colour only, no scale) independently of border activation --
 *  needs .pause-fx-label too, for the resting fill colour its own keyframes read between
 *  pulses (see injectStyles' fade keyframes). */
function activateTextFade(label) {
  injectStyles();
  label.classList.remove("pause-fx-text-dilate");
  label.classList.add("pause-fx-label", "pause-fx-text-fade");
  label.style.removeProperty(FADE_PLAY_VAR); // clears any earlier stopTextFade freeze
}

// ---- the sequencer itself ----

export class PauseFX {
  /**
   * @param {object} config
   * @param {string} [config.icon] - image/GIF path for the pause icon. Omitted, Foundry's own
   *   default icon stays untouched.
   * @param {string} [config.iconGlow] - CSS colour for the icon's drop-shadow.
   * @param {string} [config.borderColor] - CSS colour for pause-fx's border-glow overlay.
   *   Omitted, no overlay (the label's own text colour rides on this too, unless textGlow
   *   overrides it).
   * @param {number} [config.borderWidth] - % difference from the border glow's default size.
   * @param {string} [config.textGlow] - CSS colour for the label's own text, and the base
   *   for its two-ring outline (a tight inner ring, a diffuse outer one, each a lighter/
   *   darker tint assigned by contrast against the text). Omitted, both track whatever
   *   borderColor is active instead of a fixed one; with neither ever set, the label stays
   *   fully un-customized -- no ring, no tint, matching Foundry's own plain caption.
   * @param {boolean} [config.iconSpin=false] - spin the icon.
   * @param {string} [config.text] - initial label text. Omitted, Foundry's "GAME PAUSED" stays.
   * @param {number} [config.cycleMs=3000] - the one base Cycle Time every beats-per-cycle
   *   below is measured against, in ms. A step's own Duration is always in cycles, regardless
   *   of any element's own beats-per-cycle -- that only ever affects visual pulse speed.
   * @param {number} [config.iconBeatsPerCycle=1] - the icon's own spin speed, as a multiple
   *   of cycleMs (2 = twice as fast as one cycle). Also settable per step; clamped (with a
   *   warning) to never pulse faster than photosensitive-safety guidance allows.
   * @param {number} [config.textBeatsPerCycle=1] - the text's own dilate/fade speed, same
   *   idea and same clamp. Also settable per step.
   * @param {number} [config.borderBeatsPerCycle=1] - the border glow's own pulse speed, same
   *   idea and same clamp. Also settable per step.
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
      cycleMs = DEFAULT_CYCLE_MS,
      iconBeatsPerCycle = 1,
      textBeatsPerCycle = 1,
      borderBeatsPerCycle = 1,
      closeAllWindows,
      endCombat: shouldEndCombat = false,
      steps = [],
    } = config;

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
      injectStyles();
    }
    if (borderWidth !== undefined) setBorderWidth(borderWidth);
    // Harmless to set even when border's never activated -- read only once the CSS rule
    // that uses it actually applies.
    setBeatDuration(document.body, BORDER_DURATION_VAR, cycleMs, borderBeatsPerCycle, "border");

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
    let iconSpinning = true; // Foundry's own default -- see applyIconChanges
    // True once iconBeatsPerCycle has ever been applied -- //+icon-spin-duration-source-of-truth why.
    let iconDurationEverSet = config.iconBeatsPerCycle !== undefined;
    const applySkin = (_app, html) => {
      const root = document.getElementById("pause") ?? (html instanceof jQuery ? html[0] : html);
      if (!root) return;
      // Always, not gated on any actual customization -- else Foundry's own default band
      // shows first and visibly swaps to this one the moment a step finally styles anything.
      injectStyles();
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
      setBeatDuration(iconEl, ICON_DURATION_VAR, cycleMs, iconBeatsPerCycle, "icon");
      // Any of the three on its own is enough -- glow or spin without a new icon path still applies.
      if (icon !== undefined || iconSpin !== undefined || iconGlow !== undefined) {
        iconSpinning = applyIconChanges(iconEl, { icon, iconSpin, iconGlow }, iconSpinning, iconDurationEverSet);
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
      setBeatDuration(label, TEXT_DURATION_VAR, cycleMs, textBeatsPerCycle, "text");
      // Text dilates by default, matching Foundry's own -- //+foundry-default-continuity why.
      activateTextDilate(label);
      if (borderColor) {
        label.classList.add("pause-fx-label"); // see the run()-level comment above
        setTextGlowRings(label, borderColor); // default; textGlow below wins if also set
      }
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
        //+icon-text-vertical-recenter out of flow (not display:none -- see the icon's own
        // case below) so the icon re-centers alone in #pause's own column when text is empty.
        label.style.position = step.text ? "" : "absolute";
      }
      if (step.textGlow !== undefined) applyTextGlow(label, step.textGlow);
      if (step.textPulse) activateTextDilate(label);
      if (step.stopTextPulse) label.style.setProperty(DILATE_PLAY_VAR, "paused");
      if (step.textFade) activateTextFade(label);
      if (step.stopTextFade) label.style.setProperty(FADE_PLAY_VAR, "paused");
      if (step.textBeatsPerCycle !== undefined) {
        retimeAnimation(label, ["pause-fx-text-dilate", "pause-fx-text-fade"], TEXT_DURATION_VAR, cycleMs, step.textBeatsPerCycle, "text");
      }
      if (step.iconVisible !== undefined && iconEl) {
        iconEl.style.visibility = step.iconVisible ? "visible" : "hidden";
        //+icon-text-vertical-recenter position, not display:none -- keeps the spin
        // animation's own currentTime ticking (see icon-spin-retiming-jump) while hidden.
        iconEl.style.position = step.iconVisible ? "" : "absolute";
      }

      if (step.icon !== undefined || step.iconSpin !== undefined || step.iconGlow !== undefined) {
        iconSpinning = applyIconChanges(iconEl, { icon: step.icon, iconSpin: step.iconSpin, iconGlow: step.iconGlow }, iconSpinning, iconDurationEverSet);
      }
      if (step.stopIconSpin && iconEl) iconEl.style.animationPlayState = "paused";
      if (step.iconBeatsPerCycle !== undefined && iconEl) {
        retimeAnimation(iconEl, "pause-fx-icon-spin", ICON_DURATION_VAR, cycleMs, step.iconBeatsPerCycle, "icon");
        iconDurationEverSet = true;
      }
      if (step.borderColor) activateBorder(step.borderColor, { label });
      if (step.borderWidth !== undefined) setBorderWidth(step.borderWidth);
      if (step.stopBorderPulse) document.body.classList.add(BORDER_FROZEN_CLASS);
      if (step.borderBeatsPerCycle !== undefined) {
        // //+icon-spin-retiming-jump same mid-flight jump, same fix -- border's own pulse
        // lives on a ::before pseudo-element, not <body> itself.
        retimeAnimation(document.body, "pause-fx-border-pulse", BORDER_DURATION_VAR, cycleMs, step.borderBeatsPerCycle, "border", "::before");
      }

      // //+pre-av-duration-post-av-step-model AV phase: video/image self-contained per step;
      // audio joins it only when waitForAudioEnd binds it, else detached (starts now, stoppable later).
      const hasVisual = !!(step.video || step.image);
      const audioBound = !!step.audio && !!step.waitForAudioEnd;
      const cycles = { cycleMs };

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
          } else {
            // Harmless when nothing's actually waiting on it -- advanceAll() is a no-op then.
            visualEl.style.cursor = "pointer";
            visualEl.addEventListener("dblclick", advanceAll);
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
