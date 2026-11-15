export const viewport = { width: 160, height: 90 };
export const pixelsPerUnit = 10;

export function cameraLeft(worldWidth, actorX, viewWidth = viewport.width) {
  return Math.max(0, Math.min(worldWidth - viewWidth, actorX - viewWidth * 0.5));
}

// Coordinates remain in the drawing's world units. Cropping the camera, rather
// than scaling the figure, keeps feet, props and interactions at the same scale.
export function cameraFrame(worldWidth, actorX, groundY, { zoom = 1.8, focusXs = [] } = {}) {
  const magnification = Math.max(1, Math.min(2.4, Number.isFinite(zoom) ? zoom : 1.8));
  const clampX = x => Math.max(0, Math.min(worldWidth, x));
  const subjects = [actorX, ...focusXs].filter(Number.isFinite).map(clampX);
  const leftSubject = Math.min(...subjects);
  const rightSubject = Math.max(...subjects);
  // Widen for a nearby conversation partner while preserving the 16:9 frame.
  const width = Math.min(worldWidth, viewport.width,
    Math.max(viewport.width / magnification, rightSubject - leftSubject + 24));
  const height = width * viewport.height / viewport.width;
  const x = cameraLeft(worldWidth, (leftSubject + rightSubject) / 2, width);
  const y = Math.max(0, Math.min(viewport.height - height, groundY - height * 0.82));
  return { x, y, width, height };
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
