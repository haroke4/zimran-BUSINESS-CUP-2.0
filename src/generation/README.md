# Private generation worker

This package is a server dependency. FastAPI executes `cli.mjs` and registers only the files named in `internal.mediaFiles` as public media. None of this directory is mounted as a static directory or imported by the frontend.

```sh
npm --prefix src/generation ci
npm --prefix src/generation exec playwright install chromium
npm --prefix src/generation test
```

The worker reads one JSON object from stdin and writes exactly one JSON object to stdout. Provider diagnostics go to stderr. Credentials are read from the repository root `.env` and then the process environment; `.env` is never exported. Set `STORYFORK_CHROME_EXECUTABLE` to use an installed Chrome instead of Playwright Chromium. On macOS installed Google Chrome is used by default.

Input:

```json
{"action":"generate","storyId":"story_example","sceneId":"scene_example","outputDir":"/absolute/path/to/media","premise":"A locked corridor and a familiar signal","mood":"mystery","notes":"","mode":"live","branch":null}
```

The result is `{playback, internal}`. Only `playback` is public. Preserve `internal` in server storage, then pass it as `state` with `branch: "open"` or `"leave"` for a continuation. The `mode: "demo"` path is deterministic story content and needs no model credentials; it still compiles actor/object tracks and renders actual audio using the same export pipeline.

The first episode format is one 30-second opening and two distinct 30-second terminal continuations. Live mode privately plans a central question, answer, cast and both branch consequences, writes the current block, generates its SVG location and objects, and exports only that block. A continuation consumes the saved plan and selected typed effect. This is deliberately a three-block episode, not the ten-block experimental planner. The copied episode prompt is a private writing reference. Models may produce imperfect artwork or staging; failures remain retryable jobs, rather than silently becoming demo content.

`engine/` is the migrated reusable geometry, staging, model routing and sound code. `rig/` is private skeletal artwork and animation logic. No runtime import references `test_no_asset`, `test`, `actual_implementation` or the public asset library.

The exporter writes allowlisted fields and files only:

- `background.svg`, optional `foreground.svg`: flattened current-scene drawing.
- `actor-N.svg`, `object-N.svg`: SVG atlases containing only poses used in this scene, as `<g id="...">` entries inside `<defs>`.
- `animation.json`: sampled camera and transform keyframes, plus discrete `{t,symbol}` frame switches. The player uses same-origin external SVG `<use href="/media/.../actor-0.svg#idle-0">`; no rig or animation compiler is delivered.
- `audio.wav`: one mixed 30-second mono 22,050 Hz PCM track, rendered with OfflineAudioContext in a private headless browser. It contains ambience, footsteps and supported event sounds. Dialogue is text and gestures; there is no TTS.

Animation coordinates are pixels in the panorama. `viewBox` is `[0,0,worldWidth,900]`. Tracks have `svgUrl`, `keyframes: [{t,x,y,scaleX,scaleY,rotation,opacity}]` and `frames: [{t,symbol}]`. Camera entries are `{t,x,y,width,height}`. The player linearly interpolates numeric keys and switches symbol frames at their timestamps. Foreground layers are drawn after tracks. The default camera is 1.8× closer to the main actor and widens for nearby dialogue partners.

SVG output is checked for scripts, event handlers, embedded HTML and external resource references. Secret plans, prompts, provider responses, facts, effects and future outcomes remain exclusively in `internal`. Media is a visible playback artifact and can be downloaded by viewers.
