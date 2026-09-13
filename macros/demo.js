/** @pause-fx-sequence */
// Pause FX -- feature tour, built entirely from assets Foundry itself ships, so it runs
// unmodified in any world. Paste as a Script macro, or Load it into the Composer.
if (!game.modules.get("pause-fx")?.active) {
  ui.notifications.error("This macro needs the Pause FX module active.");
  return;
}
await game.modules.get("pause-fx").api.run({
  "cycleMs": 4000,
  "endCombat": true,
  "closeAllWindows": { "players": true, "gm": true },
  "steps": [
    { "wait": {"units": 1}, "textPulse": true, "textFade": false, "iconVisible": true, "iconSpin": true },
    { "wait": {"units": 1}, "text": "PAUSE FX", "textPulse": false, "textFade": false, "textGlow": "#ffffff", "audio": "sounds/combat/epic-turn-1hit.ogg", "audioVolume": 0.7, "iconVisible": true, "icon": "modules/pause-fx/ui/clapperboard.svg", "iconSpin": false, "iconGlow": "#4DD0E1" },
    { "wait": {"units": 1}, "text": "Intermission Theatre", "textPulse": false, "textFade": false, "audio": "sounds/combat/epic-turn-2hit.ogg", "audioVolume": 0.7, "iconVisible": true, "icon": "modules/pause-fx/ui/clapperboard.svg", "iconSpin": false, "iconGlow": "#4DD0E1" },
    { "wait": {"units": 0.5}, "text": "LIGHTS!", "textPulse": false, "textFade": true, "textGlow": "#ff4d00", "iconVisible": false, "iconSpin": false, "borderColor": "#ff4d00", "borderWidth": 1.2, "borderBeatsPerCycle": 1 },
    { "wait": {"units": 0.5}, "text": "CAMERA!!", "textPulse": false, "textFade": false, "textGlow": "#ff8800", "iconVisible": true, "icon": "icons/svg/video.svg", "iconSpin": false, "iconGlow": "#ff8800", "borderColor": "#ff8800", "textBeatsPerCycle": 2, "borderBeatsPerCycle": 2 },
    { "wait": {"units": 1}, "text": "ACTION!!!", "textPulse": true, "textFade": false, "textGlow": "#4dd0e1", "iconVisible": true, "icon": "modules/pause-fx/ui/clapperboard.svg", "iconSpin": true, "iconGlow": "#4DD0E1", "borderColor": "#4dd0e1", "iconBeatsPerCycle": 3, "textBeatsPerCycle": 3, "borderBeatsPerCycle": 3 },
    { "wait": {"units": 1.5}, "text": "Grab your players' attention with eye-catching cutscenes", "textPulse": false, "textFade": false, "iconVisible": false, "iconSpin": false },
    { "wait": {"units": 1.5}, "text": "Pulse or fade text in your choice of color", "textPulse": true, "textFade": true, "textGlow": "#8f00dd", "stopBorderPulse": true, "iconVisible": false, "iconSpin": false, "textBeatsPerCycle": 2 },
    { "wait": {"units": 1.5}, "text": "Or do the same with a border", "textPulse": false, "textFade": false, "textGlow": "#4ade80", "stopTextPulse": true, "stopTextFade": true, "iconVisible": false, "iconSpin": false, "borderColor": "#4ADE80", "borderWidth": 1.4 },
    { "wait": {"units": 1.5}, "text": "Mix and match your colors and speeds", "textPulse": true, "textFade": false, "textGlow": "#FF2478", "iconVisible": false, "iconSpin": false, "borderColor": "#4ade80", "textBeatsPerCycle": 3, "borderBeatsPerCycle": 4 },
    { "wait": {"units": 2}, "text": "Then come to a sudden stop", "textPulse": false, "textFade": false, "textGlow": "#ff0000", "stopTextPulse": true, "stopTextFade": true, "stopIconSpin": true, "stopBorderPulse": true, "iconVisible": true, "icon": "icons/svg/cancel.svg", "iconSpin": false, "iconGlow": "#ff0000", "borderColor": "#ff0000" },
    { "preAV": {"units": 0.5}, "postAV": {"units": 0.5}, "text": "Play video or audio with pre- and post-av pauses", "textPulse": false, "textFade": true, "video": "toolclips/tools/light-reset.webm", "videoVolume": 0, "iconVisible": false, "iconSpin": true, "borderWidth": 0, "textBeatsPerCycle": 0.8 },
    { "preAV": {"units": 0.5}, "text": "Share images, or a folder of them, as a slideshow", "textPulse": true, "textFade": false, "textGlow": "#4DD0E1", "image": "icons/environment/vehicles", "imagePulses": 0.3, "iconVisible": false, "iconSpin": true },
    { "wait": {"units": 1}, "text": "You can even set them to advance manually!", "textPulse": false, "textFade": false, "image": "icons/environment/cosmos", "iconVisible": false, "iconSpin": true },
    { "text": "Double click to advance to the next slide", "textPulse": false, "textFade": false, "image": "icons/environment/cosmos", "iconVisible": false, "iconSpin": true },
    { "wait": {"units": 0.6}, "text": "Sounds can be bound to a step", "textPulse": true, "textFade": false, "textGlow": "#4ade80", "waitForAudioEnd": true, "audio": "sounds/doors/futuristic/close-hydraulic.ogg", "audioVolume": 0.6, "audioLoop": true, "iconVisible": true, "icon": "icons/svg/sound.svg", "iconSpin": false, "iconGlow": "#ffdd00", "textBeatsPerCycle": 1.25 },
    { "wait": {"units": 1}, "preAV": {"units": 0.25}, "text": "...or run detached...", "textPulse": true, "textFade": false, "audio": "sounds/notify.wav", "audioVolume": 0.5, "audioLoop": true, "iconVisible": true, "iconSpin": true },
    { "wait": {"units": 1}, "text": "...continuing through later steps...", "textPulse": true, "textFade": false, "iconVisible": true, "icon": "icons/svg/sound.svg", "iconSpin": true },
    { "wait": {"units": 1}, "text": "...and then stopped on cue.", "textPulse": true, "textFade": false, "stopAudio": true, "iconVisible": true, "icon": "icons/svg/sound-off.svg", "iconSpin": false },
    { "wait": {"units": 1}, "text": "Start putting your bright ideas on screen.", "textPulse": true, "textFade": true, "textGlow": "#00b3ff", "iconVisible": true, "icon": "icons/svg/light-off.svg", "iconSpin": false, "iconGlow": "#808080", "borderColor": "#0d00bd", "borderWidth": 1.25, "textBeatsPerCycle": 0.5, "borderBeatsPerCycle": 0.5 },
    { "wait": {"units": 1}, "preAV": {"units": 0.3}, "text": "Where you go from here is up to you.", "textPulse": true, "textFade": false, "textGlow": "#4dd0e1", "stopBorderPulse": true, "waitForAudioEnd": true, "audio": "sounds/combat/mc-turn-itsyour.ogg", "audioVolume": 0.7, "iconVisible": true, "icon": "icons/svg/light.svg", "iconSpin": true, "iconGlow": "#ffbb00", "borderColor": "#ffd970", "iconBeatsPerCycle": 2 },
    { "wait": {"units": 1.5}, "text": "PAUSE FX", "textPulse": false, "textFade": true, "textGlow": "#4dd0e1", "iconVisible": true, "icon": "modules/pause-fx/ui/clapperboard.svg", "iconSpin": false, "iconGlow": "#0c8797", "borderColor": "#ffd970", "borderWidth": 0.8, "borderBeatsPerCycle": 0.75 },
    { "wait": {"units": 0}, "textPulse": false, "textFade": false, "unpause": true, "iconVisible": true, "iconSpin": false }
  ]
});
