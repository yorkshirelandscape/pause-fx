/** @pause-fx-sequence */
// Pause FX -- feature tour, built entirely from assets Foundry itself ships, so it runs
// unmodified in any world. Paste as a Script macro, or Load it into the Composer.
if (!game.modules.get("pause-fx")?.active) {
  ui.notifications.error("This macro needs the Pause FX module active.");
  return;
}
await game.modules.get("pause-fx").api.run({
  "borderCycleMs": 3000,
  "endCombat": true,
  "closeAllWindows": { "players": true, "gm": true },
  "steps": [
    {
      "icon": "ui/pause.svg", "iconGlow": "#4DD0E1", "borderColor": "#4DD0E1",
      "text": "PAUSE FX", "wait": { "units": 2 }
    },
    { "text": "a quick tour of what it can do", "wait": { "units": 2 } },
    { "textPulse": true, "text": "text can pulse in time with the border", "wait": { "units": 3 } },
    { "stopTextPulse": true, "text": "...and freeze in place, mid-pulse", "wait": { "units": 2 } },
    { "borderColor": "#4ADE80", "borderWidth": 40, "text": "the border can change color and size", "wait": { "units": 2 } },
    { "stopBorderPulse": true, "text": "...or stop pulsing entirely", "wait": { "units": 2 } },
    { "icon": "icons/svg/light.svg", "iconGlow": "#FFD700", "iconSpin": true, "borderColor": "#4d94ff", "text": "icons can swap, glow, and spin (the border pulse is back too)", "wait": { "units": 3 } },
    { "stopIconSpin": true, "text": "...and stop spinning on cue", "wait": { "units": 2 } },
    { "iconVisible": false, "text": "it can hide entirely, too", "wait": { "units": 2 } },
    { "iconVisible": true, "icon": "icons/svg/light.svg", "text": "...and come back exactly as it was", "wait": { "units": 1.5 } },
    {
      "iconVisible": false, "text": "here's a short video, full-screen",
      "video": "toolclips/tools/token-target.webm", "videoVolume": 0,
      "preAV": { "units": 0.5 }, "postAV": { "units": 1 }
    },
    { "iconVisible": true, "icon": "ui/pause.svg", "iconGlow": "#4DD0E1", "text": "pre/post-AV timed that hold automatically", "wait": { "units": 2 } },
    {
      "text": "a still image works the same way", "image": "icons/dice/d20black.svg",
      "imagePulses": 2, "preAV": { "units": 0.3 }, "postAV": { "units": 0.5 }
    },
    {
      "text": "sound can be bound to a step's own timing",
      "audio": "sounds/combat/epic-start-horn.ogg", "audioVolume": 0.6, "waitForAudioEnd": true,
      "preAV": { "units": 0.3 }, "postAV": { "units": 0.5 }
    },
    {
      "text": "...or run detached, stopped explicitly, later",
      "audio": "sounds/notify.wav", "audioVolume": 0.5, "audioLoop": true, "wait": { "units": 2 }
    },
    { "text": "...and it's still looping, right through this unrelated step", "wait": { "units": 2 } },
    { "stopAudio": true, "text": "stopped, right on cue", "wait": { "units": 1.5 } },
    { "borderColor": "#4DD0E1", "text": "that's the whole toolkit -- unpausing now", "wait": { "units": 2 } },
    { "unpause": true }
  ]
});
