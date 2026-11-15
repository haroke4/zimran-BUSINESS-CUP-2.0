const hex = /^#[0-9a-f]{3}(?:[0-9a-f]{3}(?:[0-9a-f]{2})?)?$/i;
const gradientName = /^[a-z][a-z0-9_-]{0,23}$/i;
const paintPattern = /^(#[0-9a-f]{3}(?:[0-9a-f]{3}(?:[0-9a-f]{2})?)?|\$[a-z][a-z0-9_-]{0,23})(?:@(0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?$/i;
const pathPattern = /^[Mm](?=[\s.,+\-0-9])[MmLlHhVvCcSsQqTtAaZz\s.,+\-0-9]+$/;

function gradientColor(value) {
  if (value === "transparent") return { color: "#000000", opacity: 0 };
  if (hex.test(value)) return { color: value, opacity: 1 };
  const match = value.match(paintPattern);
  if (match && hex.test(match[1])) return { color: match[1], opacity: Number(match[2]) };
  const rgba = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$/i);
  if (rgba && rgba.slice(1, 4).every(channel => Number(channel) <= 255)) {
    return { color: `#${rgba.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, "0")).join("")}`, opacity: Number(rgba[4] ?? 1) };
  }
  throw new Error("Invalid vector gradient color");
}

function drawMark(mark, gradients, { fillOverride, strokeOpenPaths = false } = {}) {
  const [command, paint, ...coordinates] = mark.trim().split(/\s+/);
  const match = paint?.match(paintPattern);
  if (!match) throw new Error("A vector mark has invalid paint");
  const [, color, opacity = "1"] = match;
  const gradient = color.startsWith("$") ? gradients.get(color.slice(1)) : undefined;
  if (color.startsWith("$") && !gradient) throw new Error("A vector mark uses an undefined gradient");
  const ink = gradient ? `url(#${gradient})` : color;
  const fill = `fill="${fillOverride ?? ink}" opacity="${opacity}"`;

  if (command === "p" || command === "s") {
    let thickness = 0.45;
    let path;
    const line = command === "s" && [4, 5].includes(coordinates.length)
      && coordinates.every(token => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(token));
    if (line) {
      if (coordinates.length === 5) thickness = Number(coordinates.shift());
      const [x1, y1, x2, y2] = coordinates;
      path = `M${x1} ${y1}L${x2} ${y2}`;
    } else {
      if (command === "s") thickness = Number(coordinates.shift());
      path = coordinates.join(" ");
    }
    if (!pathPattern.test(path)) throw new Error("A vector mark has an invalid path");
    if (command === "p" && !(strokeOpenPaths && !/[zZ]/.test(path))) return `<path d="${path}" ${fill}/>`;
    if (!(thickness > 0 && thickness <= 15)) throw new Error("A vector stroke has invalid thickness");
    return `<path d="${path}" fill="none" stroke="${ink}" stroke-width="${thickness}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
  }

  const values = coordinates.map(Number);
  if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > 4096)) {
    throw new Error("A vector mark has invalid coordinates");
  }
  const [x, y, w, h, radius] = values;
  if (w > 0 && h > 0) {
    if (command === "r" && (values.length === 4 || (values.length === 5 && radius >= 0))) {
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius ?? 0}" ${fill}/>`;
    }
    if (command === "e" && values.length === 4) {
      return `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${h}" ${fill}/>`;
    }
  }
  throw new Error("A vector mark has an invalid shape");
}

export function compileLayer({ gradients, marks, surfaces = [], markDetails }, index, viewBox, { onInvalidMark } = {}) {
  const ids = new Map();
  const definitions = gradients.map(({ name, axis, from, to }, position) => {
    if (!gradientName.test(name) || ids.has(name)) {
      throw new Error("Invalid or duplicate vector gradient name");
    }
    const id = `layer-${index}-gradient-${position}`;
    ids.set(name, id);
    const start = gradientColor(from);
    const end = gradientColor(to);
    const radial = axis === "halo";
    const tag = radial ? "radialGradient" : "linearGradient";
    const direction = axis === "y" ? ' x2="0%" y2="100%"' : "";
    return `<${tag} id="${id}"${direction}><stop stop-color="${start.color}" stop-opacity="${start.opacity}"/><stop offset="1" stop-color="${end.color}" stop-opacity="${radial ? 0 : end.opacity}"/></${tag}>`;
  });
  const safeMark = (mark, options, onError) => {
    try {
      return drawMark(mark, ids, options);
    } catch (error) {
      if (!onError) throw error;
      onError();
      return "";
    }
  };

  const drawDetail = mark => safeMark(mark, { strokeOpenPaths: true }, () => {});
  const drawSurface = (mark, detail, id) => {
    if (!/^[pr]\s/.test(mark.trim())) throw new Error("A painted surface must be a filled rectangle or path");
    const base = drawMark(mark, ids);
    if (!detail) return base;
    const { width, height, x, y, motif } = detail.tile;
    const tile = motif.map(drawDetail).filter(Boolean);
    const accents = detail.accents.map(drawDetail).filter(Boolean);
    let patternFill = "";
    if (tile.length) {
      definitions.push(`<pattern id="${id}-pattern" patternUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">${tile.join("")}</pattern>`);
      patternFill = drawMark(mark, ids, { fillOverride: `url(#${id}-pattern)` });
    }
    if (!accents.length) return base + patternFill;
    definitions.push(`<clipPath id="${id}-clip">${drawMark(mark, ids, { fillOverride: "#fff" })}</clipPath>`);
    return `${base}${patternFill}<g clip-path="url(#${id}-clip)">${accents.join("")}</g>`;
  };
  const planes = surfaces.map(({ mark, detail }, position) => (
    drawSurface(mark, detail, `layer-${index}-surface-${position}`)
  )).join("");
  const shapes = marks.map((mark, position) => {
    const detail = markDetails?.get(position);
    return detail
      ? drawSurface(mark, detail, `layer-${index}-mark-${position}`)
      : safeMark(mark, undefined, onInvalidMark);
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs>${definitions.join("")}</defs>${planes}${shapes}</svg>`;
}
