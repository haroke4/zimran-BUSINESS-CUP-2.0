const still = { opacity: 1, scaleX: 1, dy: 0 };
export const reachTime = 0.35;
export const releaseTime = 0.3;

function commandStart(command) {
  return command.at + (command.op === "interact" ? reachTime : 0);
}

export function commandEnd(command) {
  return commandStart(command) + command.duration + (command.op === "interact" ? releaseTime : 0);
}

const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

function blend(from, to, progress) {
  const t = smooth(progress);
  return {
    opacity: from.opacity + (to.opacity - from.opacity) * t,
    scaleX: from.scaleX + (to.scaleX - from.scaleX) * t,
    dy: from.dy + (to.dy - from.dy) * t,
    ...((from.angle !== undefined || to.angle !== undefined) && {
      angle: (from.angle ?? 0) + ((to.angle ?? 0) - (from.angle ?? 0)) * t,
    }),
  };
}

export function objectTransform(object, pose) {
  if (object.pivot) return `rotate(${pose.angle ?? 0} ${object.pivot.x} ${object.pivot.y})`;
  if (object.hingeX !== undefined) {
    return `translate(${object.hingeX} ${pose.dy}) scale(${pose.scaleX} 1) translate(${-object.hingeX} 0)`;
  }
  return "";
}

export function objectContact(object, pose) {
  if (object.pivot) {
    const angle = (pose.angle ?? 0) * Math.PI / 180;
    const dx = object.contact.x - object.pivot.x;
    const dy = object.contact.y - object.pivot.y;
    return { x: object.pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: object.pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  }
  return { x: object.hingeX === undefined ? object.contact.x
    : object.hingeX + (object.contact.x - object.hingeX) * pose.scaleX,
  y: object.contact.y + pose.dy };
}

function sample(track, time) {
  const event = track.events.findLast(({ start }) => start <= time);
  if (!event) return { ...track.initial, state: track.initialState };
  const elapsed = time - event.start;
  if (event.period) {
    const phase = elapsed % event.period;
    const half = event.period / 2;
    if (phase >= half) {
      return { ...blend(event.to, event.from, (phase - half) / event.duration), state: event.previous };
    }
    return { ...blend(event.from, event.to, phase / event.duration), state: event.state };
  }
  return { ...blend(event.from, event.to, elapsed / event.duration), state: event.state };
}

export function compileObjectTimeline(objects = [], commands = []) {
  const tracks = new Map(objects.map(object => [object.id, {
    object, initial: object.states[object.initial] ?? still, initialState: object.initial, events: [],
  }]));
  const interactions = [];
  for (const command of [...commands].sort((a, b) => commandStart(a) - commandStart(b))) {
    const track = tracks.get(command.target);
    if (command.op === "interact") interactions.push(command);
    const start = commandStart(command);
    const { state: previous, ...from } = sample(track, start);
    track.events.push({
      start, from, previous, to: track.object.states[command.state], state: command.state,
      duration: command.duration, period: command.period,
    });
  }
  return {
    frame(time) {
      const poses = new Map([...tracks].map(([id, track]) => [id, sample(track, time)]));
      const interaction = interactions.find(command => command.at <= time && time < commandEnd(command));
      return { poses, interaction };
    },
  };
}
