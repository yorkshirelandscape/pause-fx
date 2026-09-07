---
id: hasframe-regression
title: closeAllWindows was closing Foundry's own docked UI, not just open dialogs
type: bug
summary: >
  Naively closing every entry in foundry.applications.instances also closed persistent
  chrome (sidebar, hotbar, players list, scene controls, the pause overlay itself),
  blanking a client's whole UI instead of just its open sheets/dialogs. Fixed by filtering
  on app.hasFrame -- false on every docked chrome piece, true on every real floating window.
tags:
  - bug
  - regression
references:
  - file: scripts/pause-fx.js
    line: 59
links:
  - border-glow-owns-mld
---

First live two-client test of `closeAllWindows`: triggered it from a GM client targeting a
second client with an open dialog, and watched that second client's *entire UI* disappear
-- sidebar, hotbar, players list, scene controls, even the pause overlay itself, not just
the one dialog that was supposed to close.

`foundry.applications.instances` (the ApplicationV2 registry) holds both kinds of app
indiscriminately: Foundry's own persistent docked UI regions *and* real floating
windows/sheets/dialogs. Closing the whole registry closes both.

Checked what actually distinguishes them (inspecting real instances rather than guessing):
every docked chrome piece has `hasFrame: false`; every real floating window (the one that
was supposed to close) has `hasFrame: true`. That's Foundry's own signal for "this is a
titled window with a close control" -- filtering on it fixes the bug and is the more
correct semantic anyway (docked UI was never meant to be "closable" in the same sense).
