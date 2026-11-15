const number = value => Number(value.toFixed(3));
const point = (x, y) => `${number(x)} ${number(y)}`;
const path = (color, points) => `p ${color} M${points.map(([x, y]) => point(x, y)).join(" L")} Z`;
const rect = (color, x, y, width, height) => `r ${color} ${[x, y, width, height].map(number).join(" ")}`;
const hex = /^#[0-9a-f]{6}$/i;

function check(form, dimensions, colors) {
  if (dimensions.some(key => !Number.isFinite(form[key])) || colors.some(key => !hex.test(form[key]))) {
    throw new Error("Background form needs finite dimensions and opaque hex colors");
  }
  if (form.height <= 0 || (form.width ?? form.crownWidth) <= 0 || form.baseY < 0 || form.baseY > 90) {
    throw new Error("Background form has invalid size or ground position");
  }
}

// Model-controlled layout and palette, connected vector parts instead of a silhouette that can lose its trunk.
export function treeMarks(tree) {
  check(tree, ["x", "baseY", "height", "crownWidth", "trunkPercent", "variant"], ["bark", "foliage", "shade"]);
  if (tree.trunkPercent < 12 || tree.trunkPercent > 35) throw new Error("Tree needs an exposed trunk below its crown");
  const { x, baseY, height, crownWidth, bark, foliage, shade, variant } = tree;
  const exposed = height * tree.trunkPercent / 100;
  const crownBottom = baseY - exposed;
  const top = baseY - height;
  const crownHeight = crownBottom - top;
  const trunkWidth = Math.max(0.45, crownWidth * 0.075);
  const noise = i => Math.sin((variant + 1) * 12.9898 + i * 78.233) * 0.5 + 0.5;
  const lean = (noise(0) - 0.5) * crownWidth * 0.12;
  const tiers = 5 + variant % 3;
  const left = [], right = [];
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers;
    const y = top + crownHeight * t;
    const center = x + lean * (1 - t);
    const half = crownWidth * 0.5 * (0.23 + 0.77 * t);
    left.push([center - half * (0.85 + noise(i) * 0.15), y - crownHeight * 0.015],
      [center - half * (0.48 + noise(i + 9) * 0.09), y - crownHeight * 0.035]);
    right.push([center + half * (0.48 + noise(i + 19) * 0.09), y - crownHeight * 0.035],
      [center + half * (0.83 + noise(i + 29) * 0.17), y + crownHeight * 0.012]);
  }
  const crown = [[x + lean, top], ...right, [x, crownBottom + crownHeight * 0.025], ...left.reverse()];
  return [
    path(bark, [[x - trunkWidth / 2, baseY], [x - trunkWidth * 0.3 + lean, top + height * 0.12],
      [x + trunkWidth * 0.3 + lean, top + height * 0.12], [x + trunkWidth / 2, baseY]]),
    path(foliage, crown),
    path(shade, [[x + lean, top + crownHeight * 0.12], ...right.slice(2),
      [x, crownBottom + crownHeight * 0.025], [x + crownWidth * 0.08, crownBottom - crownHeight * 0.16]]),
  ];
}

export function lookoutMarks(tower) {
  check(tower, ["x", "baseY", "height", "width"], ["timber", "roof", "shade"]);
  const { x, baseY, width, height, timber, roof, shade } = tower;
  const top = baseY - height;
  const deckY = baseY - height * 0.65;
  const eaves = top + height * 0.15;
  const deckLeft = x - width / 2;
  const deckRight = x + width / 2;
  const beam = Math.max(0.6, width * 0.045);
  const marks = [];
  for (const side of [-1, 1]) {
    const foot = x + side * width * 0.46;
    const shoulder = x + side * width * 0.32;
    marks.push(path(timber, [[foot - beam / 2, baseY], [shoulder - beam / 2, deckY],
      [shoulder + beam / 2, deckY], [foot + beam / 2, baseY]]));
    marks.push(rect(shade, shoulder - beam / 3, eaves, beam * 0.65, deckY - eaves));
  }
  // Bracing stops beneath the platform, leaving the raised shelter open.
  marks.push(path(shade, [[deckLeft + width * 0.18, deckY + beam], [deckLeft + width * 0.18 + beam, deckY + beam],
    [deckRight - width * 0.06, baseY - beam], [deckRight - width * 0.06 - beam, baseY - beam]]));
  marks.push(path(shade, [[deckRight - width * 0.18, deckY + beam], [deckRight - width * 0.18 - beam, deckY + beam],
    [deckLeft + width * 0.06, baseY - beam], [deckLeft + width * 0.06 + beam, baseY - beam]]));
  marks.push(rect(timber, deckLeft, deckY, width, beam * 1.3));
  marks.push(rect(timber, deckLeft + beam, deckY - height * 0.09, width - beam * 2, beam * 0.6));
  for (const u of [0.08, 0.3, 0.7, 0.92]) {
    marks.push(rect(timber, deckLeft + width * u, deckY - height * 0.09, beam * 0.6, height * 0.09));
  }
  const ladderTopX = x + width * 0.15;
  const ladderBottomX = x + width * 0.58;
  const ladderWidth = width * 0.14;
  const ladderHeight = baseY - deckY;
  for (const side of [-1, 1]) {
    marks.push(path(timber, [[ladderTopX + side * ladderWidth / 2, deckY],
      [ladderTopX + side * ladderWidth / 2 + beam * 0.35, deckY],
      [ladderBottomX + side * ladderWidth / 2 + beam * 0.35, baseY],
      [ladderBottomX + side * ladderWidth / 2, baseY]]));
  }
  const rungs = Math.max(5, Math.ceil(ladderHeight / 2.5));
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs;
    const cx = ladderTopX + (ladderBottomX - ladderTopX) * t;
    marks.push(rect(timber, cx - ladderWidth / 2, deckY + ladderHeight * t, ladderWidth, beam * 0.35));
  }
  marks.push(path(roof, [[deckLeft - beam * 2, eaves], [x, top], [deckRight + beam * 2, eaves]]));
  marks.push(path(shade, [[x, top], [deckRight + beam * 2, eaves], [x + width * 0.15, eaves - beam * 0.6]]));
  return marks;
}

export function backgroundFormLayers({ trees = [], lookouts = [] }) {
  const forest = ["far", "middle", "near"].map(depth => ({
    name: `${depth} trees`, role: depth === "far" ? "backdrop" : "scenery", gradients: [],
    marks: trees.filter(tree => tree.depth === depth).flatMap(treeMarks),
  })).filter(({ marks }) => marks.length);
  const structures = lookouts.length ? [{ name: "Raised lookout structures", role: "scenery", gradients: [],
    marks: lookouts.flatMap(lookoutMarks) }] : [];
  return { forest, structures };
}
