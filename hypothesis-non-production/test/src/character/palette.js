const paletteCache = new WeakMap();

export const basePalette = {
  skin: 0xe3b28c,
  skinShade: 0xbe8a68,
  hair: 0x2b2730,
  hairShade: 0x1c1a20,
  eye: 0x181820,
  brow: 0x2b2730,
  suit: 0x33404f,
  suitDark: 0x27313d,
  suitLight: 0x445465,
  pants: 0x252d38,
  pantsDark: 0x1b222b,
  boot: 0x1a1f27,
  glove: 0x2a303b,
  accent: 0xffb36d,
  accentDark: 0xc9834a,
  accentSoft: 0xffd7ad,
  metal: 0x9aa6b5,
  metalDark: 0x65717f,
  coat: 0x3a4759,
  coatDark: 0x2c3747,
  hood: 0x2f3a52,
  hat: 0x394c5c,
  pack: 0x3f5163,
  belt: 0x2a211c,
  glow: 0xffcf9a,
};

export function shade(color, amount) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const mix = (channel) => Math.round(channel + (target - channel) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

export function mixColor(a, b, t) {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t)
  );
}

export function resolvePalette(skin) {
  if (paletteCache.has(skin)) return paletteCache.get(skin);
  const palette = { ...basePalette, ...(skin.palette ?? {}) };
  palette.skinShade = skin.palette?.skinShade ?? shade(palette.skin, -0.16);
  palette.hairShade = skin.palette?.hairShade ?? shade(palette.hair, -0.26);
  palette.suitDark = skin.palette?.suitDark ?? shade(palette.suit, -0.28);
  palette.suitLight = skin.palette?.suitLight ?? shade(palette.suit, 0.2);
  palette.pantsDark = skin.palette?.pantsDark ?? shade(palette.pants, -0.26);
  palette.accentDark = skin.palette?.accentDark ?? shade(palette.accent, -0.28);
  palette.accentSoft = skin.palette?.accentSoft ?? shade(palette.accent, 0.3);
  palette.coatDark = skin.palette?.coatDark ?? shade(palette.coat, -0.24);
  palette.metalDark = skin.palette?.metalDark ?? shade(palette.metal, -0.3);
  palette.glow = skin.palette?.glow ?? palette.accent;
  paletteCache.set(skin, palette);
  return palette;
}

export function colorToCss(color) {
  return `#${(color >>> 0).toString(16).padStart(6, "0")}`;
}
