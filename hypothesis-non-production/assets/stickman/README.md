# Stickman

One rig and one shared set of animation clips. Skins change proportions, colors, hair, and clothing without changing animations. Everything is rendered as SVG at runtime; there are no per-frame image assets.

## Files

| File | Contents |
| --- | --- |
| `rig.js` | Builds skeletons from skin proportions, solves and blends poses |
| `animations.js` | 25 clips: loops, actions, emotions, and postures |
| `animator.js` | Automatic transitions between body postures |
| `skins.js` | 20 reusable cast members |
| `render.js` | Flat SVG rendering, `createFigure` |
| `index.html` | Interactive viewer |

## Viewer

Body-language emotions without changing facial expressions: nod, sigh, laugh,
anger, fear, celebration, and sadness. Pose checks: `node assets/stickman/animations.test.mjs`.

Base postures: `sit` (on the floor), `lie`, and `kneel`. There is no separate
"stand up" command: `StickmanAnimator.play(id)` builds the transition to the
requested action. Lying to standing passes through sitting and kneeling;
the reverse follows the same route backwards. The target clip starts after
the transition. A new command during a transition preserves the current pose
and rebuilds the remaining path.

```js
import { StickmanAnimator } from "./animator.js?v=16";
const animator = new StickmanAnimator(skeletonFor(skin));
animator.play("lie");
// In the game loop:
animator.update(dt); // seconds; pause by not calling update
figure.update(animator.pose, time);
// Calling animator.play("walk") will automatically get the character up.
```

From the repository root:

```sh
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/assets/stickman/`. ES modules will not load over `file://`; use a static server. The viewer includes skin selection, every clip, a timeline, skeleton debugging, and horizontal flip.

On desktop, the preview, controls, and timeline stay on the left. Two
independently scrolling lists on the right contain characters and animations.
The workspace fits the window height. On narrow screens the panels stack,
with the preview sticking to the top while scrolling.

Cards show the entire cast in the same pose. Keys `1`–`9` select the first
nine characters; `0` selects Ray. Hold `Shift` with those number keys to
select the second ten, from Ada to Nika. Suggested roles appear in card
tooltips and below the preview. Ctrl, Cmd, and Alt shortcuts are not intercepted.

## Recurring cast

| ID | Name | Archetype | Visual identity |
| --- | --- | --- | --- |
| `kit` | Kit | Resourceful go-between | Hood, indigo and mint |
| `roxy` | Roxy | Practical expert | Sturdy build, bun, olive and amber |
| `nova` | Nova | Self-starter | Long legs, messy hair, coral |
| `morgan` | Morgan | Mentor | Broad build, sand and teal |
| `lis` | Lis | Negotiator | Tall and slim, swept hair, plum and cream |
| `mika` | Mika | Connector | Short, rounded bob, apricot and teal |
| `nord` | Nord | The team's rock | Tallest and broadest, cropped hair, slate and rust |
| `iva` | Iva | Strategist | Slim, topknot, burgundy and pink |
| `theo` | Theo | Researcher | Thin, large head, fringe, sky blue |
| `ray` | Ray | The team's spark | Compact, short blond hair, cobalt and lemon |
| `ada` | Ada | Wise skeptic | Short, silver bun and glasses, lilac and gold |
| `boris` | Boris | Old hand | Sturdy, gray hair and beard, pine and honey |
| `lumi` | Lumi | Dreamer | Shortest, curls, ochre and lavender |
| `sana` | Sana | Diplomat | Slim, dark ponytail, sea green and peach |
| `oscar` | Oscar | Perfectionist | Tall and narrow, swept hair and glasses, sage and terracotta |
| `zara` | Zara | Improviser | Full curls, warm red and gold |
| `felix` | Felix | Wry observer | Wavy fringe and beard, caramel and blue |
| `vera` | Vera | Truth-teller | Red bob, glasses and freckles, periwinkle and salmon |
| `amir` | Amir | Quiet leader | Broad, shaved head and dark beard, cream and jade |
| `nika` | Nika | Trailblazer | Compact, ponytail and freckles, lime-olive and orange |

`role` is an archetype label, not a fixed occupation. `casting` suggests roles
across different series. Keep the ID, face, hair, proportions, and accent color;
change clothing and props by creating a variant without mutating the original:

```js
import { skins } from "./skins.js";
const lis = skins.find((skin) => skin.id === "lis");
const travellingLis = {
  ...lis,
  role: "Traveler",
  outfit: { kind: "hoodie" },
  gear: ["messengerbag"],
};
```

The other 18 characters have no props by default; the original Kit and Roxy
retain their outfits. A new role should keep the actor recognizable, but does
not have to preserve their occupation or relationships with the rest of the cast.

Tests: `node assets/stickman/animations.test.mjs` (poses and transitions for all
20 characters) and `node assets/stickman/skins.test.mjs` (cast data and SVG).

## Usage

```js
import { clips } from "./animations.js";
import { resolvePose } from "./rig.js";
import { createFigure, skeletonFor } from "./render.js";

const figure = createFigure(skin);
container.append(figure.svg);

const metrics = skeletonFor(skin);
const pose = resolvePose(clips.walk.pose(0.4, metrics), metrics);
figure.update(pose, elapsedSeconds, { facing: -1, debug: false });
```

`pose(t, s)` takes progress from 0 to 1 and skeleton metrics. For clips with `loop: false`, progress stops at 1; the caller controls repetition. `update` takes time in seconds for blinking and small details.

## Adding a skin

A skin is a plain object. Only `id` is required by the renderer; other properties use defaults. Viewer entries also provide `name`, `role`, `tagline`, and `casting`.

```js
{
  id: "scout",
  name: "Scout",
  role: "Scout",
  tagline: "Goes first. Usually without a word.",
  casting: ["scout", "explorer", "guide", "messenger"],
  blinkOffset: 0.8,
  proportions: { height: 1.02, width: 0.94, head: 1.05, arms: 1, legs: 1, torso: 1 },
  palette: {
    skin: 0xd8a27a,
    hair: 0x373038,
    shirt: 0x33404f,
    shirtDark: 0x27313d,
    pants: 0x242d39,
    shoe: 0x1a1f27,
    accent: 0xffb36d,
    accentDark: 0xc9834a,
    bag: 0x263443,
    belt: 0x2a211c,
    eye: 0x181820,
  },
  head: {
    hair: "short",
    brow: "stern",
    mouth: "neutral",
    hood: false,
    headphones: false,
    goggles: false,
    freckles: false,
  },
  outfit: { kind: "hoodie" },
  gear: ["messengerbag", "toolbelt"],
}
```

Supported values:

| Field | Values |
| --- | --- |
| `head.hair` | `short`, `messy`, `bun`, `none`, `swept`, `bob`, `topknot`, `fringe`, `crop`, `curls`, `ponytail`, `wave` |
| `head.brow` | `straight`, `up`, `stern` |
| `head.mouth` | `neutral`, `smile`, `smirk` |
| `outfit.kind` | `hoodie`, `overalls`, `plain` |
| `gear` | `messengerbag`, `toolbelt` |

`hood`, `headphones`, `goggles`, `glasses`, `beard`, and `freckles` are boolean flags in `head`.
Glasses leave the eye and blinking visible; beards use the hair color. All head
details follow its tilt and flip with the character.
Proportions multiply the base measurements: `height: 1` is 150 units; the other fields scale individual body parts relative to that height.

## Adding a clip

Add a clip to `clips` that returns a partial pose. Unspecified fields fall back to the neutral standing pose.

```js
nod: {
  label: "Nod",
  group: "Actions",
  duration: 1.4,
  loop: true,
  pose(t, s) {
    return {
      torso: 0.04,
      head: Math.sin(t * Math.PI * 2) * 0.16,
      armL: { shoulder: -0.1, elbow: 0.24 },
      armR: { shoulder: 0.1, elbow: 0.2 },
    };
  },
},
```

Pose fields: `rootX`, `bob`, `lift`, `lean`, `torso`, `head`, `shoulderLift`;
`footL` and `footR` with `{ x, y, angle }`; `armL` and `armR` with `{ shoulder, elbow }`;
`armBendL` and `armBendR` for elbow bend direction; `handL` and `handR` for IK
wrist targets; `handWeightL` and `handWeightR` for IK weights from 0 to 1.
Setting `handL`/`handR` to `null` frees that arm. Coordinates: ground is `y = 0`,
up is negative `y`, and the character faces `+x`. Angles are in radians.

## Notes

Clips are skin-independent: bone lengths come from `s`, so one set works across
different proportions. Adding a skin only requires data; adding a clip requires
a pose function. New clothing or head details must be drawn in `render.js`.
