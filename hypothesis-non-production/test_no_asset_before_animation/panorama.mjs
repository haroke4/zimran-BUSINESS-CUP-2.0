export const viewport = { width: 160, height: 90 };
export const pixelsPerUnit = 10;

export function cameraLeft(worldWidth, actorX) {
  return Math.max(0, Math.min(worldWidth - viewport.width, actorX - viewport.width * 0.5));
}

export function positionAt(route, time) {
  let x = route[0].startX;
  let facing = Math.sign(route[0].endX - x);
  for (const leg of route) {
    if (time < leg.departureAt) break;
    facing = Math.sign(leg.endX - leg.startX);
    if (time < leg.arrivalAt) {
      const progress = (time - leg.departureAt) / (leg.arrivalAt - leg.departureAt);
      return { x: leg.startX + progress * (leg.endX - leg.startX), facing, walking: true };
    }
    x = leg.endX;
  }
  return { x, facing, walking: false };
}

export function isResolvedTravel(travel) {
  return Array.isArray(travel) && travel.length > 0 && travel.length <= 12
    && travel.every((leg, index) => {
      const previous = travel[index - 1];
      return leg && [leg.cue, leg.from, leg.to].every(key => typeof key === "string" && /^[\w-]{1,60}$/.test(key))
        && leg.from !== leg.to && Number.isFinite(leg.departureAt) && Number.isFinite(leg.arrivalAt)
        && leg.departureAt >= 0 && leg.arrivalAt > leg.departureAt && leg.arrivalAt <= 180
        && (!previous || (previous.to === leg.from && previous.arrivalAt <= leg.departureAt));
    });
}
