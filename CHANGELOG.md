# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-13

### Added
- Initial release: a declarative pause-screen reveal engine. A sequence is a `steps` array,
  each step patching border glow (color, width, pulse), icon (image, glow, spin), text
  (message, pulse, fade, glow), video/image/audio playback, or window/combat state -- all
  timed against a shared, configurable Cycle Time.
- The Composer: a GM-facing window for building a sequence visually, no scripting required --
  drag-to-reorder steps, a per-step editor with one block per kind of change, and inherited-
  value placeholders so a blank field always shows what it'll actually fall back to.
- Save a sequence as a real, reusable macro (draggable to a hotbar, filed into its own "Pause
  FX" folder); Run one immediately, or Load it back into the Composer to keep editing.
- `closeAllWindows` (targeted by player/GM role) and `endCombat`, both socketlib-backed so
  they apply to every connected client, not just the GM who triggered the sequence.
- A bundled demo macro -- a feature tour built entirely from stock Foundry assets -- copied
  into the world's own "Pause FX" macro folder the first time Load or Run is used.

[1.0.0]: https://forge.volfied.net/volfied/pause-fx/releases/tag/v1.0.0
