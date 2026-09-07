---
id: socketlib-ready-race
title: socketlib.ready can fire before this module's own esmodule finishes loading
type: bug
summary: >
  A bare Hooks.once("socketlib.ready", ...) silently never ran on a fresh module-enable --
  socketlib's own ready hook had already fired and gone stale by the time this esmodule's
  import resolved. Fixed by registering immediately if socketlib is already on the page,
  falling back to the hook only when it genuinely isn't loaded yet.
tags:
  - socketlib
  - bug
references:
  - file: scripts/pause-fx.js
    line: 33
  - file: module.json
    line: 8
links: []
---

`closeAllWindows` silently did nothing the first time it was tested end-to-end (no error,
no warning past the first attempt) -- traced to `socket` staying `undefined` forever after
module load. `socketlib.modules` was empty; manually re-registering `Hooks.once("socketlib.ready", ...)`
well after the page had fully settled *still* never fired, confirming the hook had already
dispatched once and gone stale (Hooks.once doesn't replay past events for a listener
registered after the fact).

Root cause: esmodules load asynchronously (dynamic import), so nothing guarantees this
module's top-level code runs before Foundry's `ready` hook (and thus `socketlib.ready`,
dispatched from inside it) fires -- especially likely right when a module is *freshly
enabled*, competing with socketlib's own load.

Fix is the standard defensive pattern for this exact class of race: check whether the
thing you're waiting on is already present synchronously, and only register the hook as a
fallback for the case where it genuinely isn't there yet.

Separately (and this one really did need to be findable, not guessed): socketlib also
requires the *consuming* module's own manifest to declare `"socket": true` -- a distinct
flag from `relationships.requires`. Missing it makes `registerModule()` silently return
`undefined` (logged via `console.error`, easy to miss if you're not watching for that exact
string). See `module.json`.
