---
id: border-glow-owns-mld
title: Border glow was always Monk's Little Details' effect, not ours
type: decision
summary: >
  An earlier version retinted Monk's Little Details' own pause-screen glow via its
  pause-border-colour setting, instead of drawing an overlay of its own. Checking MLD's
  real installed source showed it owns the entire visual outright, so "retint it" only
  ever worked when MLD happened to be active, with nothing to fall back to otherwise.
tags:
  - design
  - border-glow
references:
  - file: scripts/pause-fx.js
    line: 151
  - file: scripts/pause-fx.js
    line: 162
links:
  - hasframe-regression
---

The border glow this module produces used to work by calling
`game.settings.set("monks-little-details", "pause-border-colour", colour)` and letting
MLD's own CSS render it. That looked like a real dependency at first ("recommends MLD"),
but checking MLD's actual installed source turned up the real mechanism:

```js
// monks-little-details.js
$("body").addClass("mld-paused");
```
```css
/* monks-little-details.css */
body.mld-paused:after {
  box-shadow: rgba(var(--pause-border-color), 0.5) 0px 0px 100px 50px inset;
}
```

`--pause-border-color` only ever does anything inside `body.mld-paused:after` — and MLD is
the only thing that ever adds that class. Without MLD active, there's no pseudo-element for
the variable to affect at all; the effect isn't "dimmer without MLD," it's entirely absent.

Rewritten to own the whole thing: `pause-fx`'s own body class (`pause-fx-bordered`), its
own `:before` pseudo-element, its own `--pause-fx-border-color` custom property resolved
from any real CSS colour via an offscreen probe element's computed style (not a hex-only
parser, since callers have passed named colours like `"royalblue"` in practice). Works
identically whether or not MLD is installed. Also let the old localStorage safety net go
away entirely — that existed to protect MLD's *world-scoped* setting from getting stuck for
everyone if a session died mid-pause; a body class + inline style are purely local to one
client and just reset on reload, nothing shared left to protect.
