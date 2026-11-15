const validId = value => typeof value === "string" && /^[a-zA-Z][\w-]{0,39}$/.test(value);
const finite = value => Number.isFinite(value);

export function validateDialogue(value, { worldWidth = Infinity } = {}) {
  if (!value || !Array.isArray(value.actors) || value.actors.length < 2 || value.actors.length > 4
    || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > 80) {
    throw new Error("Для диалога нужны от двух до четырёх персонажей и до 80 реплик.");
  }
  const ids = new Set();
  value.actors.forEach((actor, index) => {
    if (!validId(actor?.id) || ids.has(actor.id) || typeof actor.name !== "string" || !actor.name.trim()
      || actor.name.length > 60 || (actor.skin !== undefined && !validId(actor.skin))
      || (index > 0 && (!finite(actor.x) || actor.x < 4 || actor.x > worldWidth - 4))) {
      throw new Error("Проверьте имена, уникальные ID и координаты собеседников.");
    }
    ids.add(actor.id);
  });
  let previousEnd = -1;
  for (const line of [...value.lines].sort((a, b) => a.at - b.at)) {
    if (!ids.has(line?.speaker) || typeof line.text !== "string" || !line.text.trim() || line.text.length > 400
      || !finite(line.at) || !finite(line.duration) || line.at < 0 || line.duration < 0.4
      || line.duration > 20 || line.at + line.duration > 300 || line.at < previousEnd) {
      throw new Error("Реплики должны иметь автора, текст и непересекающиеся интервалы до 300 секунд.");
    }
    previousEnd = line.at + line.duration;
  }
  return value;
}

export function compileDialogue(value) {
  if (!value) return { actors: [], primaryId: undefined, duration: 0, frame: () => ({ line: undefined, speaker: undefined, progress: 0, active: false }) };
  validateDialogue(value);
  const actors = value.actors.map(actor => ({ ...actor }));
  const lines = value.lines.map(line => ({ ...line })).sort((a, b) => a.at - b.at);
  const start = lines[0].at;
  const duration = lines.at(-1).at + lines.at(-1).duration;
  return {
    actors, primaryId: actors[0].id, duration,
    frame(time) {
      const line = lines.find(line => time >= line.at && time < line.at + line.duration);
      return { line, speaker: line && actors.find(({ id }) => id === line.speaker),
        progress: line ? (time - line.at) / line.duration : 0, active: time >= start && time < duration };
    },
  };
}

export function makeDialogueDemo(scene) {
  const worldWidth = scene.width / 10;
  const route = scene.staging.route;
  const end = route.at(-1);
  const direction = Math.sign(end.endX - end.startX) || 1;
  const preferred = end.endX + direction * 17;
  const partnerX = preferred < 8 || preferred > worldWidth - 8 ? end.endX - direction * 17 : preferred;
  const start = Math.max(end.arrivalAt, ...(scene.commands ?? []).map(command =>
    command.at + command.duration + (command.op === "interact" ? 0.65 : 0))) + 0.8;
  return {
    actors: [{ id: "mara", name: "Мара", skin: "kit" },
      { id: "ranger", name: "Лесник", skin: "morgan", x: Math.max(4, Math.min(worldWidth - 4, partnerX)) }],
    lines: [
      { speaker: "mara", at: start, duration: 3.2, text: "Подожди. Это ты стучал по дереву?" },
      { speaker: "ranger", at: start + 3.6, duration: 3.8, text: "Нет. Я услышал ответ со стороны старой вышки." },
      { speaker: "mara", at: start + 7.8, duration: 3.2, text: "Три удара, пауза, два. Это сигнал моего брата." },
      { speaker: "ranger", at: start + 11.4, duration: 3.5, text: "Тогда пойдём вместе. За шлагбаумом есть другая тропа." },
    ],
  };
}
