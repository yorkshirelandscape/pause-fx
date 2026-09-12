# Pause FX

Pause FX turns Foundry's plain "GAME PAUSED" screen into a scripted reveal: a glowing border, a custom icon, message text that changes over time, a video or image, a sound cue -- built visually in a window, no scripting required. Trigger it from the scene controls, run it live, or save it as a macro to reuse.

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Requires

[socketlib](https://github.com/manuelVo/foundryvtt-socketlib). Foundry will offer to install it automatically alongside Pause FX -- it's what makes the effect show up for everyone at the table, not just the GM triggering it.

## Building a reveal

Once enabled in a world, a clapperboard icon labeled **Pause FX** appears in the scene controls on the left (GMs only). It offers three buttons: open a new, blank sequence in the Composer; load a previously saved one into the Composer; or run a saved one right away without opening it.

### The Composer window

**Startup**, at the top, covers what's true for the whole session: **Pulse Time** (how many seconds one pulse of the glow/animation takes -- every step's timing is measured in pulses of this, not raw seconds, so the whole sequence stays readable), whether to **End Active Encounter**, and whether to **Close Windows** for Players and/or GMs when the sequence starts.

**Steps** is the sequence itself -- an ordered list of beats. The first entry is pinned in place (it can't be dragged or deleted) and is where the icon, its glow, the border color, and the opening message get set; past that, it behaves exactly like any other step, opened and edited the same way. Click **+ Add Step** to add another; drag a step's handle to reorder it; click its trash icon to remove it (click once to confirm, or hold it down for about a second to skip the confirmation).

Clicking a step opens its editor, with one block per kind of change:

- **Duration** -- how many pulses this step's state holds before the next step's changes apply. A video/image/bound-audio step also gets **Pre-AV** (delay after it loads, before playback starts) and **Post-AV** (hold on the last frame after it ends, before the next step).
- **Text** -- the message on the pause screen. **None** clears it; **Pulse** dilates and contracts it in time with Duration's pulses; **Fade** darkens and brightens it the same way; the glow swatch sets its own color (and its two-ring outline), independent of the border -- left off, it just tracks whatever border color is active.
- **Icon** -- swap the icon image, its glow color, spin it, or hide it (**None**).
- **Border** -- change the glowing border's color and/or thickness.
- **Media** -- show a video, a single image, or a folder of images as a slideshow (toggle between Video and Image), with an option to loop it. Once set, it always plays out in full: Pre-AV, then Duration (if set) or its own natural end, then Post-AV.
- **Audio** -- play a sound cue. **Bound** ties it to this step's own Pre-AV/Duration/Post-AV timing, the same as Media; unbound, it starts now and keeps playing until a later step's Stop Audio.
- **Stop** -- turn off something already running: a sound, the icon's spin, the text's pulse or fade, the border's pulse, or actually unpause the game, ending the sequence right there.

When it's ready, the window's own header has **Run** (play it live, right now) and **Save** (store it as a real, reusable macro -- draggable to a hotbar, or loaded back into the Composer later to edit).

### A simple example

Building tension before a reveal might look like: the pinned first step sets a red glow and an eye icon, with the pause screen reading "Something stirs." A few pulses later, a step changes the text to "...and suddenly--" A step after that plays a sting sound. The next step hides the icon and plays a video full-screen, holding on its last frame for a couple of pulses once it ends (Post-AV) before the final step brings the icon back then unpauses the game.

## Tips

- If your icon is an animated GIF, set Pulse Time to match its own loop length so the border glows in time with it.
- Only a GM can start a sequence; everyone at the table sees the same effect once it runs, thanks to socketlib.
