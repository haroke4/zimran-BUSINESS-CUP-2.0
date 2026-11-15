import { compileLayer } from "./geometry.mjs";
import { commandEnd } from "./object-timeline.mjs";
import { positionAt, viewport } from "./panorama.mjs";

export const objectKinds = ["door", "gate", "barrier", "light", "sunlight"];
export const objectStates = ["closed", "open", "on", "off"];
export const behaviors = ["still", "flicker", "on_cue", "on_arrival"];
const validId = id => typeof id === "string" && /^[a-zA-Z][\w-]{0,39}$/.test(id);
const validTime = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const isLight = kind => kind === "light" || kind === "sunlight";
const statesFor = kind => isLight(kind) ? ["on", "off"] : ["closed", "open"];

export class ObjectScriptError extends Error {}

export function validateObjectScript(objects, commands, markIds) {
  if (!Array.isArray(objects) || objects.length > 6 || !Array.isArray(commands) || commands.length > 24) {
    throw new ObjectScriptError("Укажите до шести объектов и 24 команд.");
  }
  const ids = new Map();
  for (const object of objects) {
    if (!validId(object?.id) || ids.has(object.id) || !objectKinds.includes(object.kind)
      || !markIds.includes(object.anchor) || !statesFor(object.kind).includes(object.initial)
      || typeof object.label !== "string" || !object.label.trim() || object.label.length > 70) {
      throw new ObjectScriptError("У объекта должны быть уникальный id, название, тип, точка маршрута и допустимое начальное состояние.");
    }
    ids.set(object.id, object);
  }
  for (const command of commands) {
    const object = ids.get(command?.target);
    if (!object || !["change", "loop", "interact"].includes(command.op)
      || !statesFor(object.kind).includes(command.state) || !validTime(command.at, 0, 180)
      || !validTime(command.duration, 0.05, 6)
      || (command.op === "loop" ? !validTime(command.period, command.duration * 2, 20) : command.period !== undefined)) {
      throw new ObjectScriptError("Проверьте тип команды, объект, состояние и время. Половина периода loop должна вмещать переход.");
    }
  }
}

function fitsInteraction(anchorX, command, route) {
  const end = commandEnd(command);
  return Math.abs(positionAt(route, command.at).x - anchorX) < 0.01
    && !route.some(leg => command.at < leg.arrivalAt && end > leg.departureAt);
}

export function needsArrival({ behavior, kind, cue }, beats = []) {
  return behavior === "on_arrival" || (behavior === "on_cue" && !isLight(kind)
    && !beats.some(beat => beat.cue === cue));
}

export function planObjectCommands(props, positions, route, beats) {
  const objects = [];
  const commands = [];
  const occupiedIds = new Set();
  for (const { id, label, kind, anchor, behavior, cue, ...plan } of props) {
    if (!validId(id) || occupiedIds.has(id) || !positions.has(anchor)) continue;
    const initial = statesFor(kind).includes(plan.initial) ? plan.initial : statesFor(kind)[0];
    occupiedIds.add(id);
    objects.push({ id, label, kind, anchor, initial });
    const opposite = statesFor(kind).find(state => state !== initial);
    const target = { target: id, state: opposite };
    const event = beats?.find(beat => beat.cue === cue);
    if (behavior === "flicker" && kind === "light") {
      commands.push({ ...target, op: "loop", at: 0.5, duration: 0.12, period: 1.8 });
    }
    if (behavior === "on_cue" && event) {
      commands.push({ ...target, op: "change", at: event.at, duration: isLight(kind) ? 0.2 : 0.8 });
    }
    if (needsArrival({ behavior, kind, cue }, beats)) {
      const leg = route.find(leg => leg.to === anchor);
      if (!leg) continue;
      const command = { ...target, op: "interact", at: leg.arrivalAt + 0.12, duration: kind === "light" ? 0.2 : 0.85 };
      if (fitsInteraction(positions.get(anchor).x, command, route) && !commands.some(other =>
        other.op === "interact" && other.at < commandEnd(command) && command.at < commandEnd(other))) {
        commands.push(command);
      }
    }
  }
  return { objects, commands };
}

export function stageObjects(objects, commands, positions, route, groundY, worldWidth) {
  const resolved = objects.map(object => {
    const { x } = positions.get(object.anchor);
    const arrival = route.findLast(leg => leg.to === object.anchor);
    const facing = arrival ? Math.sign(arrival.endX - arrival.startX) : Math.sign(route[0].endX - route[0].startX);
    const width = object.kind === "barrier" ? 22 : object.kind === "gate" ? 20 : 16;
    const side = x + (width + 3) * facing < 1 || x + (width + 3) * facing > worldWidth - 1 ? -facing : facing;
    const contact = { x: x + 4.5 * side, y: groundY - 8.5 };
    const neutral = { opacity: 1, scaleX: 1, dy: 0 };
    if (isLight(object.kind)) {
      return { ...object, contact, side, fixture: { x, y: groundY - 35 },
        states: { on: neutral, off: { ...neutral, opacity: 0 } } };
    }
    if (object.kind === "barrier") {
      const pivot = { x: x + 2.5 * side, y: contact.y };
      const boom = { x: side > 0 ? pivot.x : pivot.x - width, y: pivot.y - 0.65, width, height: 1.3 };
      const support = { x: pivot.x - 1, y: pivot.y - 1, width: 2, height: groundY - pivot.y + 1 };
      return { ...object, contact, side, pivot, boom, support,
        states: { closed: { ...neutral, angle: 0 }, open: { ...neutral, angle: -82 * side } } };
    }
    const height = object.kind === "gate" ? 28 : 24;
    const edge = x + 2.5 * side;
    const hingeX = edge + width * side;
    const opening = { x: Math.min(edge, hingeX), y: groundY - height, width, height };
    const open = object.kind === "gate" ? { ...neutral, dy: -height } : { ...neutral, scaleX: 0.13 };
    return { ...object, contact, side, opening, hingeX, states: { closed: neutral, open } };
  });
  let actorUntil = -1;
  for (const command of commands.filter(({ op }) => op === "interact").sort((a, b) => a.at - b.at)) {
    const object = resolved.find(({ id }) => id === command.target);
    const { x } = positions.get(object.anchor);
    if (command.at < actorUntil || !fitsInteraction(x, command, route)) {
      throw new ObjectScriptError("Для interact персонаж должен успеть остановиться у объекта и закончить действие до следующего перехода.");
    }
    actorUntil = commandEnd(command);
  }
  return resolved;
}

const isColor = color => /^#[0-9a-f]{6}$/i.test(color);

function tint(color, amount) {
  const toward = amount > 0 ? 255 : 0;
  const strength = Math.abs(amount);
  return "#" + [1, 3, 5].map(offset => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(channel + (toward - channel) * strength).toString(16).padStart(2, "0");
  }).join("");
}

function lightness(color) {
  return [0.21, 0.72, 0.07].reduce((total, weight, channel) => (
    total + weight * Number.parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16)
  ), 0);
}

function paintMechanism(object, { gradients, marks, recessColor, art, viewBox, index }) {
  const { x, y, width, height } = object.opening;
  const { x: gripX, y: gripY } = object.contact;
  const palette = new Map(gradients.map(({ name, from }) => [`$${name}`, from.split("@")[0]]));
  const paints = marks.map(mark => mark.trim().split(/\s+/)[1]?.split("@")[0]);
  const base = paints.map(paint => palette.get(paint) ?? paint).find(color =>
    isColor(color) && Math.abs(lightness(color) - lightness(recessColor)) >= 45)
    ?? tint(recessColor, lightness(recessColor) < 128 ? 0.35 : -0.45);
  const edge = tint(base, lightness(base) < 150 ? 0.35 : -0.35);
  const rect = (left, top, wide, high) => `<rect x="${left}" y="${top}" width="${wide}" height="${high}"/>`;
  const rodPositions = Array.from({ length: 6 }, (_, i) => x + 0.6 + (width - 2.1) * i / 5);
  const grip = `<rect x="${gripX - 1.15}" y="${gripY - 0.37}" width="2.3" height="0.74" rx="0.37"/>`;
  const silhouette = object.kind === "gate"
    ? [...rodPositions.map(left => rect(left, y, 0.9, height)),
      rect(x, y + 0.35, width, 0.85), rect(x, y + height - 1.1, width, 0.9),
      rect(x, gripY - 0.43, width, 0.86)].join("")
    : rect(x, y, width, height);
  const highlights = object.kind === "gate"
    ? rodPositions.map(left => rect(left, y + 1, 0.24, height - 2)).join("")
    : rect(x + (object.side > 0 ? 0.5 : width - 0.78), y + 0.7, 0.28, height - 1.4);
  // Keep the painted finish inside the part that actually moves, even when generated marks miss the opening.
  const clipId = `object-mechanism-${index}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs><clipPath id="${clipId}">${silhouette}</clipPath></defs><g fill="${base}">${silhouette}</g><g clip-path="url(#${clipId})">${art}</g><g fill="${edge}">${highlights}${grip}</g></svg>`;
}

function paintBarrier(object, art, viewBox, index, fixed = false) {
  const { x, y, width, height } = fixed ? object.support : object.boom;
  const clipId = `object-${fixed ? "post" : "boom"}-${index}`;
  const shape = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="0.3"/>`;
  // Constrain generated decoration to the thin rotating boom, without filling the view behind it.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs><clipPath id="${clipId}">${shape}</clipPath></defs><g fill="#80735c">${shape}</g><g clip-path="url(#${clipId})">${art}</g></svg>`;
}

export function paintObjects(objects, artwork, worldWidth) {
  return objects.map((object, index) => {
    const { gradients, fixed, moving, recessColor } = artwork[object.id];
    if (!isColor(recessColor)) throw new Error("Invalid object recess color");
    const viewBox = `0 0 ${worldWidth} ${viewport.height}`;
    function drawPart(marks, part) {
      let invalid = 0;
      const svg = compileLayer({ gradients, marks }, `object-${index}-${part}`, viewBox, {
        onInvalidMark: () => { invalid++; },
      });
      if (marks.length - invalid < 1) throw new Error(`Object ${object.id} has no drawable ${part} part`);
      return svg;
    }
    const fixedArt = drawPart(fixed, "fixed");
    const movingArt = drawPart(moving, "moving");
    return {
      ...object,
      ...(object.opening && { recessColor }),
      fixedSvg: object.kind === "barrier" ? paintBarrier(object, fixedArt, viewBox, index, true) : fixedArt,
      movingSvg: object.kind === "barrier" ? paintBarrier(object, movingArt, viewBox, index) : object.opening
        ? paintMechanism(object, { gradients, marks: moving, recessColor, art: movingArt, viewBox, index })
        : movingArt,
    };
  });
}
