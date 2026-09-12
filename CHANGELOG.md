# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `macros/demo.js` -- a feature-tour macro built entirely from assets Foundry itself ships,
  doubling as a pasteable demo and a manual test pass; ships pre-seeded in a "Pause FX
  Macros" compendium as well.
- Composer's **Save as Macro** now sets an on-brand clapperboard thumbnail and files new
  macros into a "Pause FX" folder.
- `textGlow` -- a two-ring outline around the pause label's own text (a tight inner ring, a
  diffuse outer one, assigned by contrast so the text reads against any background), and the
  text's own color; defaults to tracking whatever border color is active, and its rings track
  a running Fade in real time. Authored via a new toggle on the Composer's Text block.
- `textFade` -- darkens and brightens the pause text, split out of what used to be one
  combined "text pulse" (which is now Dilate-only: scale, no color). Each is independently
  stoppable (Stop's own Text Pulse / Text Fade).
- This changelog.

### Changed
- A media step's Pre/Post-AV timing badges now group around its own video/image/audio icon
  in the Composer's step list; an explicit Duration override shows as that icon's own badge
  instead of a separate one.
- Stop badges (Text Pulse/Icon Spin/Border Pulse) now show what's actually being paused,
  instead of three near-identical glyphs.
- A wrapped pause message now splits its lines as evenly as possible instead of however it
  happens to break.
- Pressing **Run** in the Composer now collapses the window to its titlebar and moves it out
  of the way, instead of sitting on top of the reveal.
- A step's icon/text now render above its own video/image instead of getting buried under
  it; the pause band moves behind the video instead of disappearing or painting over it.
- Fade's text color now follows whatever border color the run actually set, instead of a
  fixed red-orange regardless of theme.
- The Unpause step badge uses the classic play-pause glyph instead of a plain circle-play icon.

### Fixed
- Wrapped pause text no longer crams its second line against the first, nudges the icon, or
  spills past the pause band uncontained -- caps at two lines (with an ellipsis) and the band
  grows/recenters to fit.
- A step typed into a fresh row (one that never touched the Video/Image switch) no longer
  silently drops its media on save.
- Config-level Icon Glow/Spin on a hand-written macro (not folded into its first step) now
  actually apply.
- Detached audio from an earlier step no longer keeps looping past unpause once a later step
  starts a second one.
- A video that fails to load no longer hangs the sequence forever.
- A failed sound or closeAllWindows broadcast no longer aborts the whole run silently.
- The Composer and step editor no longer accumulate a duplicate change listener on every
  re-render.
- Bound audio (`waitForAudioEnd`) never actually played, ever -- an undocumented early
  return in Foundry's own `AudioHelper.play()` silently swallowed it. Rebuilt directly on
  `foundry.audio.Sound`.
- The default pause message rendered as "Game Paused" instead of Foundry's own uppercase
  "GAME PAUSED" -- a fix meant only for custom text was silently applying unconditionally.
- The Text block's glow toggle squeezed Duration's Pulses/AV pair onto two lines; widened
  the step editor to fit both comfortably.
- A sequence with closeAllWindows enabled (like the demo) closed the Composer window Run
  was just clicked from, along with everything else.
- The step editor's modal dialog (v0.1.7) made Foundry's own file browser unusable when
  picking an icon, media, or audio path -- dropped back to non-modal.
- The pause text's glow/color defaulted to pause-fx's own red the moment anything (even
  Pulse alone) touched styling at all, with no border or text color ever set.
- The Text block's new Fade checkbox squeezed Duration onto two lines again -- widened the
  step editor further.

### Removed
- Dropped the border/text "clock" distinction for a step's Duration -- it was always just two
  names for the same underlying pulse length. Duration is now always in border-pulses.

## [0.1.10] - 2026-09-11

### Added
- Startup and Steps fieldsets get their own icons in the Composer.

### Changed
- The video/image toggle now defaults to image, and its "off" (video) position reads teal
  instead of gray, so both positions read as "on."
- Disabled color swatches (Icon Glow, Border Color) show by a brighter border on the enabled
  state instead of dimming the disabled one, so the actual color is never misrepresented.
- Pre/Post-AV badges recolor to a blue/red pair.
- A step's media now stays frozen on its last frame through Post-AV, instead of disappearing
  immediately once playback ends.
- Duration is now split into Pre-AV, Duration, and Post-AV, matching how a video/image step's
  timing actually works.
- Step effects now apply immediately and Duration describes how long that state holds --
  previously Duration delayed a step's own effects, which read backwards.

### Fixed
- Saving over an existing macro through the Composer now sets its type to "script" -- a macro
  that started as Foundry's default "chat" type would silently just post its command as a chat
  message instead of ever running it.
- Foundry's own pause-screen pulse animation no longer fights pause-fx's own once a themed
  reveal takes over.
- A mid-pulse text change no longer shifts the pulse's scale anchor point.

## [0.1.9] - 2026-09-09

### Fixed
- Loading a saved macro whose config set icon/border/text at the top level (rather than
  folded into the first step) no longer silently drops that opening beat.

## [0.1.8] - 2026-09-09

### Added
- A hand-written macro is now recognized as a Pause FX sequence (loadable back into the
  Composer) via a leading docstring marker, not just macros the Composer itself created.

### Fixed
- Foundry's own icon-spin animation no longer bleeds through once pause-fx takes over the icon.

## [0.1.7] - 2026-09-09

### Added
- The Composer is rebuilt around real per-step macros: every step can carry its own icon,
  glow, border, and media, not just the opening beat.
- Video/image/audio steps, border width, icon spin, and a "Stop" block (turn off
  video/audio/spin/pulse, or unpause outright) are now real, editable fields.
- Vignettes: named macros saved to a scene's own macro directory, replacing the earlier
  settings-backed presets.

### Changed
- Icon, glow, and border color are opt-in per step now, instead of defaulting to pause-fx's
  own red theme.
- The Composer and step editor got a full visual design pass -- structured layout, badges
  summarizing each step, real form controls (sliders for volume, etc.) instead of flat
  utility chrome.
- The step editor is now a real modal dialog.
- README rewritten for the actual end user (a non-technical GM), not as internal design notes.

## [0.1.6] - 2026-09-08

### Changed
- Reworked the Composer's own structure.
- `closeAllWindows` now targets by role (players/GMs) instead of everyone unconditionally.

## [0.1.5] - 2026-09-07

### Added
- A Composer window -- build a sequence visually, no more hand-writing the config as raw JS.

## [0.1.4] - 2026-09-07

### Changed
- The manifest now points at Forgejo's always-latest release alias instead of a version
  pinned at build time.

## [0.1.3] - 2026-09-07

### Changed
- Internal: exported functions documented with real JSDoc; narrative comments moved out of
  the source.

## [0.1.2] - 2026-09-07

### Changed
- Internal: comment/docs cleanup, no functional changes.

## [0.1.1] - 2026-09-07

### Changed
- Pause FX now owns its own border-glow overlay outright; no longer depends on
  Monk's Little Details.

## [0.1.0] - 2026-09-07

### Added
- Initial release: a themed pause-screen reveal (border glow, icon, message text) with
  socketlib-backed window-closing for every connected client, driven by a hand-written macro.

[Unreleased]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.10...main
[0.1.10]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.9...v0.1.10
[0.1.9]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.8...v0.1.9
[0.1.8]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.7...v0.1.8
[0.1.7]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.6...v0.1.7
[0.1.6]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.5...v0.1.6
[0.1.5]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.4...v0.1.5
[0.1.4]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.3...v0.1.4
[0.1.3]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.2...v0.1.3
[0.1.2]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.1...v0.1.2
[0.1.1]: https://forge.volfied.net/volfied/pause-fx/compare/v0.1.0...v0.1.1
[0.1.0]: https://forge.volfied.net/volfied/pause-fx/releases/tag/v0.1.0
