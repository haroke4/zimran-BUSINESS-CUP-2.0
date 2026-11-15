import { compileLayer } from "./geometry.mjs";
import { backgroundFormLayers } from "./background-forms.mjs";
import { generateSoundPlan } from "./sound-plan.mjs";
import {
  behaviors, needsArrival, objectKinds, objectStates, paintObjects, planObjectCommands, stageObjects, validateObjectScript,
} from "./object-staging.mjs";
import { pixelsPerUnit, viewport } from "./panorama.mjs";

const object = (properties) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const text = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const list = (items, minItems, maxItems) => ({ type: "array", items, minItems, maxItems });
const oneOf = (...values) => ({ type: "string", enum: values });

const backgroundStyle = `Visual hierarchy: establish depth with large filled value masses, overlapping silhouettes, recessed side faces and broad cast shadows. Distant planes have a narrower value range and less detail; nearer forms have deeper occlusion shadows. Quiet areas still need recognizable environment silhouettes and readable local color. Separate neighboring planes by their fill values rather than outlining every boundary. Reserve the strongest highlights for actual light sources and a few short edges facing them. Material seams sit close to the local surface color, usually slightly darker. Avoid a wireframe look, luminous panel grids, repeated bright horizontal bands, and high-contrast lines running across the camera or panorama. Top and bottom framing should be broad subdued shapes, not bright stripes. Match exposure and palette to the brief: clear noon needs bright sky gaps, readable foliage colors and sunlit ground, even inside a dense forest. Cool shadows are a local lighting contrast, not a reason to turn the whole image into night. Let only genuinely shadowed edges and texture disappear.`;

const director = `Design one original continuous side-on location for FRAMEBREAK, a stylized 2D animated series. You are planning the entire pan, not a single centered view. The camera window is 160 units wide; worldWidth and worldHeight describe the complete drawing, with the origin at top left. Characters will be animated on top.
Write the visual design in English and the title and landmark labels in the language of the brief. Return title, groundY (one continuous walkable floor baseline), design (detail the scene across 160-unit intervals, including major depth planes, architectural or terrain changes, direction of light and a specific dark/middle/highlight palette), and marks (one entry with id, label, x for each requiredMarkIds value). You may add up to six other marks with unique short ASCII IDs for intermediate object locations. Without supplied travel, place start/end at the walk endpoints and give objects near intermediate landmarks their own mark there, rather than relocating everything to end. The actor walks through those marks in spatial order and pauses for interactions. For example, sunlight at a tower and a barrier further down the trail need separate anchors. Place all marks at distinct x positions. If travel is supplied, anchor interactions to that route. For a long pan distribute the landmarks from near the first area to near the last area. Plan a distinct spatial feature, a different silhouette and its own light or shadow in each camera-width stretch. Treat screen-left and screen-right in the brief as actual horizontal world positions. If travel is supplied, retain the route IDs, story reveal locations and direction implied by the brief. Plan a low-clutter, solid walking surface with at least 16 units of visible room above it for the actor. Keep the location coherent from start to finish.
${backgroundStyle} In design, specify the relative lightness of the far, middle and near planes and where broad shadow masses and quiet areas belong. Keep this hierarchy coherent throughout the pan.
Also return visualBrief: setting describes the actual environment and its natural or built materials; lighting explicitly preserves the stated time of day, weather, exposure, ambient fill and sunlit/shadow colors; landmarks lists EVERY requested visible place or structure with label, x and silhouette (the specific visible parts that make it recognizable, plus any concealment/reveal placement). Include static landmarks even when they are not route marks or props. Route IDs are identifiers only: a mark called window in a supplied route can correspond to a forest tower in this brief. The brief determines what it looks like. For a ravine, show an irregular exposed bank, roots and a drop beyond the level walk; for a hunting tower, show elevated timber platform, legs, ladder and roof. For dense conifers, plan overlapping pointed, tiered crowns and tall irregular trunks at several depths, with sunlit gaps. Preserve off-screen people as off-screen; sound-only cues do not require a visible character or object. Arrange reveal objects beyond the named landmark and outside the earlier camera window where possible, using a stand of trees or terrain to motivate concealment. Do not hide all landmarks under one opaque covering shape.
When the schema asks for props, list only objects that visibly change or take part in an interaction in this scene. Supported kinds: door, gate (a vertically sliding barred grille), barrier (a horizontal boom that pivots upward, including a шлагбаум), light (an artificial fixture), sunlight (a natural sunbeam/pool that fades when a cloud covers the sun). door/gate/barrier use closed or open; light/sunlight use on or off. Never substitute a door or grille for a boom barrier, or a lamp for sunlight. Use short unique ASCII IDs starting with a letter. anchor is any mark ID in your marks array, and label describes the actual object and material for the viewer. Use behavior "on_cue" only for an exact cue ID present in the supplied beat or beats. Never invent a cue ID. If the brief says the actor opens a barrier or door without a timed cue, use "on_arrival" at its own mark. Use "flicker" only for an artificial light that repeatedly flickers, "on_arrival" when the character physically uses the object after reaching the mark, and "still" if the object must stay in its initial state. Set cue to an empty string for the other behaviors. Without a supplied route, walking runs from start through intermediate marks to end; anchor on_arrival at the actual object location. A sunbeam is never operated by the actor; without a matching timed cue keep it still. Include every requested moving door, gate, barrier or light. Give different objects different IDs. Keep props empty when none are needed. If the input supplies objects, make space for them at their anchors.`;

const markSyntax = `Marks are strings in absolute world units: "r #243349 x y width height [radius]", "e #243349 cx cy rx ry", "p #243349 Mx yLx yH...Z", "s #243349@0.2 0.2 Mx yLx y". Use valid SVG path commands. Use s with explicit stroke width for seams and open lines. Use p only for a filled shape closed with Z; a filled straight line is invisible. Use six-digit hex colors, with optional @opacity e.g. "#ffce90@0.35".`;

const artist = `Paint a complete continuous background for a stylized 2D animated series with recognizable silhouettes and spatial depth. Compose the geometry for this location. Return JSON containing baseColor (six-digit hex sky or ambient color), planes (upper, middle, and ground), trees, lookouts, and layers in drawing order. Each layer has name, role ("backdrop", "scenery", "light", or "foreground"), gradients and marks. Use the location plan, visualBrief, brief, story anchors, 160-unit camera width and full world coordinates. Illustrate the entire route. All layers share one camera height, character scale, perspective and lighting direction. Leave a clear continuous walk along groundY. Put optional close foreground shapes last and preserve the visible walk and story landmarks. Draw the environment alone, with the actor added separately.
${backgroundStyle}
Treat visualBrief as a checklist: draw every listed static landmark with its distinguishing silhouette, at its planned position. Environment identity must already be clear in this base artwork; texture cannot supply missing trees, a tower or terrain later. Respect the brief's time of day and materials over any generic style examples. For a daylight forest, use pale sky or luminous canopy gaps, muted blue-green distant trees, richer middle foliage, cool local shadows and sunlit moss/soil. Do not use a uniformly near-black green palette for noon.
For natural environments, draw terrain with irregular filled contours, roots, rocks, undergrowth and a distinct narrow earth/moss trail surrounded by forest floor. groundY is the actor's foot level, not a demand for a full-width rectangular road, platform, kerb or railing. Keep the path level enough for walking while varying its visible edges and banks. For every individual conifer, use the trees array instead of a hand-drawn tree mark. Each entry places a complete vector tree: x is its trunk center, baseY its root position, height its total height, crownWidth its widest foliage extent, trunkPercent the exposed trunk height as a percent of total height (18–30 is usually suitable), variant an integer 0–99 controlling irregular branch tiers, and depth far/middle/near. Give bark, foliage and shade as opaque six-digit hex colors: bark should read as wood, foliage as needles, shade as a nearby darker foliage tone. The renderer supplies a slender visible trunk and a separately filled, irregular tiered crown. Choose varied heights, widths, spacing and variants. For dense forest, compose overlapping tree groups throughout every camera-width stretch and at several depths, not four identical isolated icons. Far trees are smaller and lighter; near trees are taller and darker. Keep clear gaps around landmarks. Do not duplicate these trees as triangle/trapezoid/oval marks in layers. Broad distant forest silhouettes may still belong in planes.middle. Use trees=[] where no conifers are present.
For every raised wooden hunting/lookout tower use lookouts rather than hand-drawn tower marks. Each entry has x (center), baseY (where the supports touch terrain near groundY), height (roof peak to ground), width (platform width), and opaque timber, roof, shade hex colors. A typical tower width is 20–30 and height 40–55, scaled to a 15-unit actor. The renderer builds connected splayed legs, bracing UNDER the platform, a raised deck with rails, open upper shelter, supported roof and a slanted ladder with visible rungs. Do not redraw those parts in layers. Use lookouts=[] when no such tower exists. Other landmark types still use normal marks; a dugout needs an earth/moss mound and recessed entrance, rather than a freestanding metal box. Draw man-made shapes only where the brief calls for them.
Objects in animatedObjects are drawn separately, including frames, door leaves, bars, barrier booms, lamp glow or natural sunbeams and their local reflections. Continue the actual environment behind their coordinates (foliage/trail outdoors, wall/floor indoors). Do not draw static copies of those objects or their light effects. Keep their moving silhouettes clear. A window around an animated artificial light can be part of the background.
Use vertical coordinates deliberately: y=0 is the TOP edge, y=90 is the BOTTOM. Decreasing y moves UP. The walking baseline groundY is where the actor's feet touch the floor. The floor begins a little above the foot line and continues to y=90. The main scenery and landmarks rise above it, occupying the middle of the image. A landmark at x=180 with a floor line at y=72 might extend from y=27 to y=67. Place its base near or above the foot line. Do not put doors, windows, tree crowns, stairs or distant scenery below the foot line. Wall planes, wood canopies or a distant skyline should use the upper half of the shot. Keep drawn geometry between y=0 and y=90 unless clipped at the edges intentionally.
Build large connected shapes that establish the place: sky or ceiling, walls or silhouettes, ground or floor. Use several intermediate silhouettes and spatial depths across the world. Use curves, bevels and overlapping shapes where appropriate. Only for an architectural interior, use visible side planes, dark recesses, filled trim faces and ceiling depth expressed as broad shadow shapes. Match the warm/cool contrast to visualBrief.lighting. At night artificial lights may illuminate small local pools; in daylight the whole environment receives ambient sky fill and sunlit areas are broad enough to establish daytime. Cast shadows under structures. Give each story anchor a distinct feature at its x position. A body of water or feature on a particular side must be visible in that area.
Define each broad plane with name, material (an English description of material and extent), gradients, and one filled "r" or "p" mark. Each plane should remain visible across the route: upper for sky or ceiling, middle for walls or distant terrain, ground for the surface the character uses. The renderer draws upper, middle and ground planes, then backdrop layers, generated trees, scenery marks, generated lookout structures, light layers and foreground. Do not cover trees with opaque full-width scenery rectangles; keep local landmark marks in scenery so the generated tower can remain intact above them. Leave landmark geometry, framing, shadow and light in ordinary layers so they appear on top. The next artist applies texture directly to your planes, so keep their shapes free of opaque full-width overlays in the ordinary layers.
Use markBudget as the working target for meaningful filled forms, shadow masses and scenery. A long pan needs dozens of actual environmental forms across its camera-width stretches; a handful of triangles and rectangles is an unfinished blockout. Spend these marks on recognizable silhouettes, not decorative strokes. Give each camera width its own recognisable set dressing and silhouette. Make landmark silhouettes immediately identifiable. Draw stair risers, trim and glazing as filled lit and shaded faces; avoid tracing every edge with a highlight. Place story landmarks in scenery layers behind the actor, including foreground-looking objects the actor walks past. Keep the optional foreground to subdued top or bottom edge fragments that never hide the actor. For a corridor, build wall segments out of recessed panels, overlapping trim, and side faces that catch and fall away from key light; continue these forms along the route. Give the floor shallow perspective through broad value changes, contact shadows and localized reflected pools under practical lights. Leave material joints and fine surface marks to the detail stage so they are not drawn twice. For an exterior, use composed groups in more than one depth plane. Preserve open acting space around groundY.
${markSyntax} Gradients have a short unique name (ASCII letters, digits, hyphen or underscore), axis ("x", "y", or "halo"), from and to. For each gradient color use "#ffb577" or "#ffb577@0.35". A halo fades to transparent at its outside edge. Use "$name" to apply a gradient defined in the same layer. Keep all names brief. Return only the requested JSON.`;

const detailArtist = `Design vector surface detail for a stylized 2D animated series. You receive the existing artwork and the route. Return upper, middle and ground detail entries matching the three planes in the supplied artwork. Color and shape are your design. Follow the artwork's lighting and perspective.
${backgroundStyle}
Surface detail is optional and subordinate to the existing filled forms. Match each plane's actual material and visualBrief.lighting. Natural ground gets irregular moss patches, needles, stones and sparse broken sun flecks; it never gets panel seams, tile joints, rails or full-width stripes. A forest canopy is already established by tree silhouettes in the artwork (including its trees entries): do not cover it with a repeating pattern of detached oval crowns. Organic and sky planes should normally have empty tile.motif and only sparse non-repeating accents. Preserve daylight exposure; do not wash the sky or foliage with dark overlays. For manufactured surfaces only, suggest material with sparse inset joints, a few fasteners or small patches of tonal variation. Use thin seam strokes, typically 0.1–0.25 world units with @0.12–0.28 opacity, in a color close to and slightly darker than the local base. For example, on a #2b3a4a plane, "s #202c38@0.2 0.15 M6 72L14 72" is a quiet seam. Do not repeat broad opaque lines or equally bright outlines on every panel. A corridor floor may have a few staggered, short joints following shallow perspective; leave most of it uninterrupted. Ceiling detail can be empty when the architecture already establishes it. Do not add full-width horizontal strokes, regular ladders of parallel lines, or a grid covering the shot. Keep tile backgrounds transparent. For open sky, use an empty motif and only the stars or soft cloud silhouettes the scene needs.
Each entry has tile and accents. Use the same absolute world coordinates for all marks. A tile is an example patch on the actual plane: tile.x and tile.y locate its top-left corner, and tile.width and tile.height are its size. Place tile.motif inside that world rectangle. The renderer repeats the example patch across the whole plane: even one edge-to-edge stroke can become an endless stripe. Prefer an empty motif and a few localized accents when repetition would be visible. Accents appear once at the given world coordinates, clipped to the plane. Both motif and accents may be empty; there is no minimum detail count. Keep shadowed and distant areas especially quiet. Place occasional accents near meaningful material changes or landmarks and let their contrast fade away from the light. Short edge glints belong only near a real light source and should be accents, never a repeated motif. Keep the original base color and depth hierarchy dominant. Judge the result at the 160 by 90 camera scale: texture should recede while silhouettes and lighting remain legible.
${markSyntax} Use explicit colors in every mark. Return only the requested JSON.`;

const objectArtist = `Draw the animated SVG objects for this side-on 2D series, using the story brief and palette. The top-level JSON keys MUST be the exact IDs from animatedObjects. Each value contains only gradients, fixed and moving arrays of drawing marks in absolute world coordinates, and recessColor (a six-digit hex color for the space seen through an open door or gate; use a dark hex for a light too). Put multiple visible marks into BOTH fixed and moving for every object. Prefer r and e for simple shapes. Put fine visual details into the object, at the same scale as the surrounding location. Coordinates in contact, opening, fixture, pivot, support and boom are exact. Keep artwork local to each object.
Follow the actual environment, material and time of day from visualBrief. The engine fills opening with recessColor only for doors and grilles, and clips their fixed frame marks outside that rectangle. Make fixed frames and rails extend a little outwards from opening. For a door: draw the beveled frame in fixed. Draw the opaque leaf to fill the exact opening in moving, including insets, highlights and a small clearly visible handle centered at contact. The engine swings the leaf by narrowing it towards its hinge and reveals the recess. For a gate: draw the guide rails in fixed. In moving, draw individual bars with visible gaps, a crosspiece and a grip centered at contact. Keep those parts within opening. The engine raises them behind the top edge. For a barrier: draw the short support post within support and pivot hardware in fixed around pivot. Draw a thin horizontal wooden or metal boom filling boom in moving, with a grip at contact; it pivots upward around pivot when opened. It has no filled doorway, frame, tall leaf or recess. For a light: draw its housing (and a wall switch at contact if someone uses it) in fixed. Draw the glowing core, radial halo and any colored reflections in moving. Use fixture for the source. For sunlight: there is no housing, bulb, switch, post or electrical fixture. Draw two small foliage-edge shapes in fixed; in moving draw a translucent diagonal sun shaft from fixture towards the ground near contact.x, plus an irregular pale gold sunlit moss patch, using colors consistent with daytime. The engine fades the moving effects as a cloud passes, leaving daylight ambient fill in the background. Draw enough contrast for both states to read.
${markSyntax} For gradients use name, axis ("x", "y", or "halo"), from and to as hex colors with optional @opacity. Apply a gradient using "$name" from the same entry. JSON only.`;

const gradient = object({ name: text(24), axis: oneOf("x", "y", "halo"), from: text(40), to: text(40) });
const gradients = { type: "array", items: gradient };
const shapes = { type: "array", items: { type: "string" } };
const byPlane = schema => object({ upper: schema, middle: schema, ground: schema });
const plane = object({ name: text(50), material: text(150), mark: text(600), gradients });
const artworkSchema = object({
  baseColor: text(7), planes: byPlane(plane),
  trees: list(object({
    x: integer(0, 1280), baseY: integer(1, 90), height: integer(8, 90), crownWidth: integer(3, 60),
    trunkPercent: integer(12, 35), variant: integer(0, 99), depth: oneOf("far", "middle", "near"),
    bark: text(7), foliage: text(7), shade: text(7),
  }), 0, 80),
  lookouts: list(object({
    x: integer(0, 1280), baseY: integer(1, 90), height: integer(20, 75), width: integer(12, 45),
    timber: text(7), roof: text(7), shade: text(7),
  }), 0, 12),
  layers: list(object({ name: text(50), role: oneOf("backdrop", "scenery", "light", "foreground"), gradients, marks: shapes }), 2, 12),
});

function filledGeometry(mark) {
  const [kind, , ...coordinates] = mark.trim().split(/\s+/);
  return kind === "p" || kind === "r" ? [kind, ...coordinates].join(" ") : undefined;
}

function opaqueFill(mark, gradients) {
  const paint = mark.trim().split(/\s+/)[1];
  if (!paint || !filledGeometry(mark)) return false;
  const opaque = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  return opaque.test(paint) || gradients.some(({ name, axis, from, to }) =>
    paint === `$${name}` && axis !== "halo" && opaque.test(from) && opaque.test(to));
}

function rectangleBounds(mark) {
  const [kind, , ...coordinates] = mark.trim().split(/\s+/);
  if (kind !== "r" || coordinates.length < 4 || coordinates.length > 5) return undefined;
  const values = coordinates.map(Number);
  if (values.some(value => !Number.isFinite(value) || Math.abs(value) > 4096)) return undefined;
  const [x, y, width, height, radius = 0] = values;
  if (width <= 0 || height <= 0 || radius < 0) return undefined;
  return { x, y, width, height };
}

function coversSamePlane(mark, planeBounds) {
  if (!planeBounds) return false;
  const bounds = rectangleBounds(mark);
  if (!bounds) return false;
  const margin = planeBounds.height * 0.15;
  const overlap = Math.min(bounds.x + bounds.width, planeBounds.x + planeBounds.width) - Math.max(bounds.x, planeBounds.x);
  return overlap >= Math.min(viewport.width * 0.5, planeBounds.width * 0.65)
    && overlap >= bounds.width * 0.9
    && Math.abs(bounds.y - planeBounds.y) <= margin
    && Math.abs(bounds.y + bounds.height - planeBounds.y - planeBounds.height) <= margin;
}

function attachPlaneDetails(planeLayers, layers, details) {
  for (const [index, key] of ["upper", "middle", "ground"].entries()) {
    const surface = planeLayers[index].surfaces[0];
    const geometry = filledGeometry(surface.mark);
    const bounds = rectangleBounds(surface.mark);
    surface.detail = details[key];
    for (const layer of layers) {
      if (layer.role !== "backdrop" && layer.role !== "scenery") continue;
      layer.marks.forEach((mark, position) => {
        if (!opaqueFill(mark, layer.gradients)) return;
        const exact = filledGeometry(mark) === geometry;
        if (!exact && !coversSamePlane(mark, bounds)) return;
        // Each solid repaint needs the same world-aligned texture as the surface under it.
        layer.markDetails ??= new Map();
        layer.markDetails.set(position, details[key]);
        if (exact) delete surface.detail;
      });
    }
  }
}

function compilePanorama({ baseColor, planes, layers, trees, lookouts }, worldWidth, details) {
  if (!/^#[0-9a-f]{6}$/i.test(baseColor)) throw new Error("Base color must be an opaque hex color");
  const { forest, structures } = backgroundFormLayers({ trees, lookouts });
  const allLayers = [...layers, ...forest, ...structures];
  for (const layer of layers.filter(({ role }) => role === "foreground")) {
    if (layer.marks.some(mark => opaqueFill(mark, layer.gradients) && Object.values(planes).some(plane =>
      filledGeometry(mark) === filledGeometry(plane.mark) || coversSamePlane(mark, rectangleBounds(plane.mark))))) {
      throw new Error("Foreground must not repaint a whole environment plane and hide its landmarks");
    }
  }
  const markCount = allLayers.reduce((count, { marks }) => count + marks.length, 3);
  if (!allLayers.some(({ role }) => role === "scenery") || markCount < 16) {
    throw new Error("The panorama must include scenery and enough geometry to form a location");
  }
  const planeLayers = ["upper", "middle", "ground"].map(key => {
    const { name, gradients, mark } = planes[key];
    return { name, role: key === "upper" ? "backdrop" : "scenery", gradients, marks: [], surfaces: [{ mark }] };
  });
  const scenery = layers.map(layer => ({ ...layer }));
  if (details) attachPlaneDetails(planeLayers, scenery, details);
  planeLayers[0].surfaces.unshift({ mark: `r ${baseColor} 0 0 ${worldWidth} ${viewport.height}` });
  const ordered = [...planeLayers, ...scenery.filter(({ role }) => role === "backdrop"), ...forest,
    ...scenery.filter(({ role }) => role === "scenery"), ...structures,
    ...scenery.filter(({ role }) => role === "light"), ...scenery.filter(({ role }) => role === "foreground")];
  let invalidMarks = 0;
  const result = ordered.map(({ name, role, gradients, marks, surfaces, markDetails }, index) => ({
    name, role, x: 0, y: 0, width: worldWidth * pixelsPerUnit, height: viewport.height * pixelsPerUnit,
    svg: compileLayer({ gradients, marks, surfaces, markDetails }, index, `0 0 ${worldWidth} ${viewport.height}`, {
      onInvalidMark: () => { invalidMarks++; },
    }),
  }));
  if (markCount - invalidMarks < Math.max(16, worldWidth / viewport.width * 6)) {
    throw new Error("Too much of the panorama geometry failed to compile");
  }
  return result;
}

function planWalk(marks, props, beats, screens) {
  const start = marks.find(({ id }) => id === "start");
  const end = marks.find(({ id }) => id === "end");
  const direction = Math.sign(end.x - start.x);
  const ordered = [...marks].sort((a, b) => (a.x - b.x) * direction);
  const secondsPerUnit = Math.max(6, Math.round(screens * 5)) / Math.abs(end.x - start.x);
  const stops = new Set(props.filter(prop => needsArrival(prop, beats)).map(({ anchor }) => anchor));
  let departureAt = 0;
  return ordered.slice(1).map((to, index) => {
    const from = ordered[index];
    const arrivalAt = departureAt + Math.abs(to.x - from.x) * secondsPerUnit;
    const leg = { from: from.id, to: to.id, departureAt, arrivalAt };
    departureAt = arrivalAt + (stops.has(to.id) ? 2 : 0);
    return leg;
  });
}

export async function generateScene(model, brief, beat, { screens = 1, travel, beats, objectScript } = {}) {
  const started = performance.now();
  const worldWidth = viewport.width * screens;
  const requiredMarkIds = travel ? [...new Set(travel.flatMap(({ from, to }) => [from, to]))] : ["start", "end"];
  const dimensions = { worldWidth, worldHeight: viewport.height, cameraWidth: viewport.width };
  if (objectScript) validateObjectScript(objectScript.objects, objectScript.commands, requiredMarkIds);
  const input = { brief, ...(beat && { beat }), ...(beats && { beats }), ...dimensions };
  const planSchema = object({
    title: text(100), groundY: integer(59, 79), design: text(3200),
    visualBrief: object({
      setting: text(400), lighting: text(600),
      landmarks: list(object({ label: text(80), x: integer(0, worldWidth), silhouette: text(400) }), 1, 12),
    }),
    marks: list(object({ id: text(60), label: text(70), x: integer(6, worldWidth - 6) }),
      requiredMarkIds.length, requiredMarkIds.length + 6),
    ...(!objectScript && { props: list(object({
      id: text(40), label: text(70), kind: oneOf(...objectKinds), anchor: text(60),
      initial: oneOf(...objectStates), behavior: oneOf(...behaviors), cue: { type: "string", maxLength: 100 },
    }), 0, 6) }),
  });
  const planned = await model.generate(director, {
    ...input, requiredMarkIds, ...(travel && { travel }), ...(objectScript && { objects: objectScript.objects }),
  }, planSchema, {
    label: "panorama_layout", maxTokens: 3400,
    validateResult: ({ marks, props = [] }) => {
      const positions = new Map(marks.map(({ id, x }) => [id, x]));
      if (positions.size !== marks.length || !requiredMarkIds.every(id => positions.has(id))
        || marks.some(({ id }) => !requiredMarkIds.includes(id) && !/^[a-zA-Z][\w-]{0,39}$/.test(id))
        || props.some(({ anchor }) => !positions.has(anchor))
        || new Set(positions.values()).size !== positions.size) {
        throw new Error("Every route mark must have its own distinct position");
      }
      if (!travel && marks.some(({ x }) => x < Math.min(positions.get("start"), positions.get("end"))
        || x > Math.max(positions.get("start"), positions.get("end")))) {
        throw new Error("Intermediate marks must lie between start and end");
      }
      const range = Math.max(...positions.values()) - Math.min(...positions.values());
      if (screens > 1 && range < worldWidth * 0.52) {
        throw new Error("Spread the walk across the panorama so the camera can reveal the full location");
      }
    },
  });

  const { title, groundY, marks } = planned.value;
  const positions = new Map(marks.map(mark => [mark.id, mark]));
  const events = beats ?? (beat ? [{ ...beat, at: 0 }] : []);
  const steps = travel ?? planWalk(marks, planned.value.props ?? [], events, screens);
  const route = steps.map(leg => ({ ...leg, startX: positions.get(leg.from).x, endX: positions.get(leg.to).x }));
  const { objects, commands } = objectScript ?? planObjectCommands(planned.value.props, positions, route, events);
  const stagedObjects = stageObjects(objects, commands, positions, route, groundY, worldWidth);
  const animatedObjects = stagedObjects.map(({ states, ...prop }) => ({
    ...prop, usedByActor: commands.some(command => command.target === prop.id && command.op === "interact"),
  }));
  const pictureInput = { ...input, plan: planned.value, visualBrief: planned.value.visualBrief, route, animatedObjects };
  const drawPicture = model.generate(artist, { ...pictureInput, markBudget: 40 + 24 * screens },
    artworkSchema, {
      label: "panorama_art", maxTokens: 5600 + screens * 800, temperature: 0.35,
      validateResult: art => { compilePanorama(art, worldWidth); },
    });
  let paintedObjects = [];
  const drawProps = stagedObjects.length ? model.generate(objectArtist, pictureInput,
    object(Object.fromEntries(stagedObjects.map(({ id }) => [id, object({
      gradients, fixed: list(text(600), 2, 48), moving: list(text(600), 2, 48), recessColor: text(7),
    })]))), {
      label: "panorama_objects", maxTokens: 1200 + stagedObjects.length * 1300,
      validateResult: art => { paintedObjects = paintObjects(stagedObjects, art, worldWidth); },
    }) : undefined;
  const [drawn, propsDrawn, audioPlan] = await Promise.all([
    drawPicture, drawProps, generateSoundPlan(model, { brief, visualBrief: planned.value.visualBrief, route }),
  ]);
  const detailSchema = byPlane(object({
    tile: object({
      x: integer(0, worldWidth), y: integer(0, viewport.height),
      width: integer(1, worldWidth), height: integer(1, viewport.height), motif: shapes,
    }),
    accents: shapes,
  }));
  let layers;
  const detailed = await model.generate(detailArtist,
    { ...pictureInput, artwork: drawn.value }, detailSchema, {
      label: "panorama_detail", maxTokens: 4600 + screens * 500, temperature: 0.35,
      validateResult: details => { layers = compilePanorama(drawn.value, worldWidth, details); },
    });

  const enterX = route[0].startX;
  const stopX = route.at(-1).endX;
  return {
    title, width: worldWidth * pixelsPerUnit, height: viewport.height * pixelsPerUnit, layers,
    visualBrief: planned.value.visualBrief,
    sound: audioPlan.sound,
    viewport: { width: viewport.width * pixelsPerUnit, height: viewport.height * pixelsPerUnit },
    model: drawn.model,
    staging: { groundY, enterX, stopX, targetX: stopX, target: positions.get(steps.at(-1).to).label, marks, route },
    ...(paintedObjects.length && { objects: paintedObjects, commands }),
    ...(beat && { beat }), ...(beats && { beats }),
    models: [
      { stage: "Постановка", provider: planned.provider, model: planned.model, ms: planned.ms },
      { stage: "Рисунок", provider: drawn.provider, model: drawn.model, ms: drawn.ms },
      ...(propsDrawn ? [{ stage: "Объекты", provider: propsDrawn.provider, model: propsDrawn.model, ms: propsDrawn.ms }] : []),
      { stage: "Детали", provider: detailed.provider, model: detailed.model, ms: detailed.ms },
      audioPlan.metadata,
    ],
    ms: Math.round(performance.now() - started),
  };
}
