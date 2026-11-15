import { compileLayer } from "./geometry.mjs";
import { pixelsPerUnit, viewport } from "./panorama.mjs";

const object = (properties) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const text = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const list = (items, minItems, maxItems) => ({ type: "array", items, minItems, maxItems });
const oneOf = (...values) => ({ type: "string", enum: values });

const director = `Design one original continuous side-on location for FRAMEBREAK, a stylized 2D animated series. You are planning the entire pan, not a single centered view. The camera window is 160 units wide; worldWidth and worldHeight describe the complete drawing, with the origin at top left. Characters will be animated on top.
Write the visual design in English and the title and landmark labels in the language of the brief. Return title, groundY (one continuous walkable floor baseline), design (detail the scene across 160-unit intervals, including major depth planes, architectural or terrain changes, direction of light and a specific dark/middle/highlight palette), and marks (one entry with id, label, x for each requiredMarkIds value). Place the marks at actual story features or at the start and end of the walk. For a long pan distribute the landmarks from near the first area to near the last area. Plan a distinct spatial feature, a different silhouette and its own light or shadow in each camera-width stretch. Treat screen-left and screen-right in the brief as actual horizontal world positions. If travel is supplied, retain the route IDs, story reveal locations and direction implied by the brief. Plan a low-clutter, solid walking surface with at least 16 units of visible room above it for the actor. Keep the location coherent from start to finish.`;

const markSyntax = `Marks are strings in absolute world units: "r #243349 x y width height [radius]", "e #243349 cx cy rx ry", "p #243349 Mx yLx yH...Z", "s #243349 0.8 Mx yLx y". Use valid SVG path commands. Use s with explicit stroke width for seams, outlines and open lines. Use p only for a filled shape closed with Z; a filled straight line is invisible. Use six-digit hex colors, with optional @opacity e.g. "#ffce90@0.35".`;

const artist = `Paint a complete continuous background for a stylized flat 2D animated series. Invent and draw all geometry for this location. Return JSON containing baseColor (six-digit hex sky or ambient color), planes (upper, middle, and ground), and layers in drawing order. Each layer has name, role ("backdrop", "scenery", "light", or "foreground"), gradients and marks. Use the location plan, brief, story anchors, 160-unit camera width and full world coordinates. Illustrate the entire route. All layers share one camera height, character scale, perspective and lighting direction. Leave a clear continuous walk along groundY. Put optional close foreground shapes last and preserve the visible walk and story landmarks. Draw the environment alone, with the actor added separately.
Use vertical coordinates deliberately: y=0 is the TOP edge, y=90 is the BOTTOM. Decreasing y moves UP. The walking baseline groundY is where the actor's feet touch the floor. The floor begins a little above the foot line and continues to y=90. The main scenery and landmarks rise above it, occupying the middle of the image. A landmark at x=180 with a floor line at y=72 might extend from y=27 to y=67. Place its base near or above the foot line. Do not put doors, windows, tree crowns, stairs or distant scenery below the foot line. Wall planes, wood canopies or a distant skyline should use the upper half of the shot. Keep drawn geometry between y=0 and y=90 unless clipped at the edges intentionally.
Build large connected shapes that establish the place: sky or ceiling, walls or silhouettes, ground or floor. Use several intermediate silhouettes and architectural depths across the world. Use curves, bevels and overlapping shapes where appropriate. An interior needs visible side planes and recesses, seams, trim, wall structures and ceiling depth. A forest needs grouped trunks and crowns across different depths. Shade near planes deeper and make far surfaces quieter. Use one consistent warm or cool contrast, favor cool slate/violet structure and amber practical lighting at night. Put pools of colored light on the ground and cast shadows under structures. Give each story anchor a distinct feature at its x position. A body of water or feature on a particular side must be visible in that area.
Define each broad plane with name, material (an English description of material and extent), gradients, and one filled "r" or "p" mark. Each plane should remain visible across the route: upper for sky or ceiling, middle for walls or distant terrain, ground for the surface the character uses. The renderer draws upper, middle, ground, then the ordinary layers. Leave landmark geometry, framing, shadow and light in ordinary layers so they appear on top. The next artist applies texture directly to your planes, so keep their shapes free of opaque full-width overlays in the ordinary layers.
Aim for markBudget using drawn architectural shapes and scenery in addition to surfaces. Give each camera width its own recognisable set dressing and silhouette. Make landmark silhouettes immediately identifiable. If present, show actual stair risers, window trim and glazing, and individual bars on the gate. Place story landmarks in scenery layers behind the actor, including foreground-looking objects the actor walks past. Keep the optional foreground to top or bottom edge fragments that never hide the actor. For a corridor, show the ceiling and wall as distinct connected architectural planes with physical light fixtures, framed openings and columns or wall braces. For an exterior, use composed groups in more than one depth plane. Preserve open acting space around groundY.
${markSyntax} Gradients have a short unique name (ASCII letters, digits, hyphen or underscore), axis ("x", "y", or "halo"), from and to. For each gradient color use "#ffb577" or "#ffb577@0.35". A halo fades to transparent at its outside edge. Use "$name" to apply a gradient defined in the same layer. Keep all names brief. Return only the requested JSON.`;

const detailArtist = `Design vector surface detail for a stylized 2D animated series. You receive the existing artwork and the route. Return upper, middle and ground detail entries matching the three planes in the supplied artwork. Color and shape are your design. Follow the artwork's lighting and perspective.
For manufactured surfaces, draw a repeat tile with visible construction and material cues. Use marking weights large enough to read in a 160 by 90 shot, typically 0.5–1.2 units for structural seams. On a corridor floor, draw several rows with horizontal seams AND staggered or slanted cross joints. Design it around the supplied floor shape and foot line. On walls use inset panels, vertical breaks and a few fine fasteners instead of horizontal bands alone. Give the ceiling its own seams, trim, ribs or conduits. Leave the tile background transparent so the surface color remains visible through the motif. For organic surfaces use irregular clusters, distant shapes, glints, clouds or stars that fit the location. For open sky, leave motif empty and place sparse, irregular accents, such as small points of different sizes at night or softly overlapping cloud silhouettes during the day.
Each entry has tile and accents. Use the same absolute world coordinates for all marks. A tile is an example patch on the actual plane: tile.x and tile.y locate its top-left corner, and tile.width and tile.height are its size. Place tile.motif inside that world rectangle. For example, a 20 by 10 tile at (0,68) contains floor seams at y=68 to 78. The renderer repeats the example patch across that plane. Use an empty motif for a surface that needs only irregular detail. Accents appear once at the given world coordinates, clipped to the plane. Give every plane at least four marks in total. Add individual accents at distinct intervals down the route, with variation tied to landmarks, pools of light and changes in material. For example, the floor may repeat its joints while reflecting particular lamps only where they sit in the drawing. Keep the original base color visible. Use a small range of middle and low contrast colors with selective highlights. Details should read at 16:9 without competing with the actor or landmarks.
${markSyntax} Use explicit colors in every mark. Return only the requested JSON.`;

const gradient = object({ name: text(24), axis: oneOf("x", "y", "halo"), from: text(40), to: text(40) });
const gradients = { type: "array", items: gradient };
const shapes = { type: "array", items: { type: "string" } };
const byPlane = schema => object({ upper: schema, middle: schema, ground: schema });
const plane = object({ name: text(50), material: text(150), mark: text(600), gradients });
const artworkSchema = object({
  baseColor: text(7), planes: byPlane(plane),
  layers: list(object({ name: text(50), role: oneOf("backdrop", "scenery", "light", "foreground"), gradients, marks: shapes }), 2, 12),
});

function filledGeometry(mark) {
  const [kind, , ...coordinates] = mark.trim().split(/\s+/);
  return kind === "p" || kind === "r" ? [kind, ...coordinates].join(" ") : undefined;
}

function paintsSurface(mark, geometry, gradients) {
  const paint = mark.trim().split(/\s+/)[1];
  if (!paint || filledGeometry(mark) !== geometry) return false;
  const opaque = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  return opaque.test(paint) || gradients.some(({ name, axis, from, to }) =>
    paint === `$${name}` && axis !== "halo" && opaque.test(from) && opaque.test(to));
}

function attachPlaneDetails(planeLayers, layers, details) {
  for (const [index, key] of ["upper", "middle", "ground"].entries()) {
    const surface = planeLayers[index].surfaces[0];
    const geometry = filledGeometry(surface.mark);
    // A later fill with the same contour would hide the original surface texture.
    const overlay = layers.findLast(({ role, marks, gradients }) =>
      (role === "backdrop" || role === "scenery") && marks.some(mark => paintsSurface(mark, geometry, gradients)));
    if (overlay && geometry) {
      overlay.markDetails ??= new Map();
      overlay.markDetails.set(overlay.marks.findLastIndex(mark => paintsSurface(mark, geometry, overlay.gradients)), details[key]);
    } else {
      surface.detail = details[key];
    }
  }
}

function compilePanorama({ baseColor, planes, layers }, worldWidth, details) {
  if (!/^#[0-9a-f]{6}$/i.test(baseColor)) throw new Error("Base color must be an opaque hex color");
  const markCount = layers.reduce((count, { marks }) => count + marks.length, 3);
  if (!layers.some(({ role }) => role === "scenery") || markCount < 16) {
    throw new Error("The panorama must include scenery and enough geometry to form a location");
  }
  const planeLayers = ["upper", "middle", "ground"].map(key => {
    const { name, gradients, mark } = planes[key];
    return { name, role: key === "upper" ? "backdrop" : "scenery", gradients, marks: [], surfaces: [{ mark }] };
  });
  const scenery = layers.map(layer => ({ ...layer }));
  if (details) attachPlaneDetails(planeLayers, scenery, details);
  planeLayers[0].surfaces.unshift({ mark: `r ${baseColor} 0 0 ${worldWidth} ${viewport.height}` });
  const ordered = [...planeLayers, ...scenery.filter(({ role }) => role !== "foreground"), ...scenery.filter(({ role }) => role === "foreground")];
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

export async function generateScene(model, brief, beat, { screens = 1, travel, beats } = {}) {
  const started = performance.now();
  const worldWidth = viewport.width * screens;
  const requiredMarkIds = travel ? [...new Set(travel.flatMap(({ from, to }) => [from, to]))] : ["start", "end"];
  const dimensions = { worldWidth, worldHeight: viewport.height, cameraWidth: viewport.width };
  const input = { brief, ...(beat && { beat }), ...(beats && { beats }), ...dimensions };
  const planSchema = object({
    title: text(100), groundY: integer(59, 79), design: text(1600),
    marks: list(object({ id: oneOf(...requiredMarkIds), label: text(70), x: integer(6, worldWidth - 6) }),
      requiredMarkIds.length, requiredMarkIds.length),
  });
  const planned = await model.generate(director, { ...input, requiredMarkIds, ...(travel && { travel }) }, planSchema, {
    label: "panorama_layout", maxTokens: 1500,
    validateResult: ({ marks }) => {
      const positions = new Map(marks.map(({ id, x }) => [id, x]));
      if (positions.size !== requiredMarkIds.length || new Set(positions.values()).size !== positions.size) {
        throw new Error("Every route mark must have its own distinct position");
      }
      const range = Math.max(...positions.values()) - Math.min(...positions.values());
      if (screens > 1 && range < worldWidth * 0.52) {
        throw new Error("Spread the walk across the panorama so the camera can reveal the full location");
      }
    },
  });

  const { title, groundY, marks } = planned.value;
  const positions = new Map(marks.map(mark => [mark.id, mark]));
  const steps = travel ?? [{
    from: "start", to: "end", departureAt: 0, arrivalAt: Math.max(6, Math.round(screens * 5)),
  }];
  const route = steps.map(leg => ({ ...leg, startX: positions.get(leg.from).x, endX: positions.get(leg.to).x }));
  const drawn = await model.generate(artist, { ...input, plan: planned.value, route, markBudget: 30 + 13 * screens },
    artworkSchema, {
      label: "panorama_art", maxTokens: 4800 + screens * 450, temperature: 0.35,
      validateResult: art => { compilePanorama(art, worldWidth); },
    });
  const detailSchema = byPlane(object({
    tile: object({
      x: integer(0, worldWidth), y: integer(0, viewport.height),
      width: integer(1, worldWidth), height: integer(1, viewport.height), motif: shapes,
    }),
    accents: shapes,
  }));
  let layers;
  const detailed = await model.generate(detailArtist,
    { ...input, plan: planned.value, route, artwork: drawn.value }, detailSchema, {
      label: "panorama_detail", maxTokens: 4600 + screens * 500, temperature: 0.35,
      validateResult: details => { layers = compilePanorama(drawn.value, worldWidth, details); },
    });

  const enterX = route[0].startX;
  const stopX = route.at(-1).endX;
  return {
    title, width: worldWidth * pixelsPerUnit, height: viewport.height * pixelsPerUnit, layers,
    viewport: { width: viewport.width * pixelsPerUnit, height: viewport.height * pixelsPerUnit },
    model: drawn.model,
    staging: { groundY, enterX, stopX, targetX: stopX, target: positions.get(steps.at(-1).to).label, marks, route },
    ...(beat && { beat }), ...(beats && { beats }),
    models: [
      { stage: "Постановка", provider: planned.provider, model: planned.model, ms: planned.ms },
      { stage: "Рисунок", provider: drawn.provider, model: drawn.model, ms: drawn.ms },
      { stage: "Детали", provider: detailed.provider, model: detailed.model, ms: detailed.ms },
    ],
    ms: Math.round(performance.now() - started),
  };
}
