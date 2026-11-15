export type TransformFrame = {
  t: number
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
}
export type CameraFrame = {
  t: number
  x: number
  y: number
  width: number
  height: number
}
export type AnimationTrack = {
  id: string
  svgUrl: string
  keyframes: TransformFrame[]
  frames: { t: number; symbol: string }[]
}
export type PlaybackAnimation = {
  version: 1
  duration: number
  viewBox: [number, number, number, number]
  camera: CameraFrame[]
  tracks: AnimationTrack[]
}

export function mediaUrl(value: string) {
  const url = new URL(value, window.location.origin)
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/media/") ||
    url.search ||
    url.hash
  )
    throw new Error("This scene contains an invalid media URL.")
  return url.pathname
}

export function interpolate<T extends { t: number }>(
  frames: T[],
  time: number
): T {
  const last = frames.length - 1
  if (last < 0) throw new Error("The scene is missing animation frames.")
  if (time <= frames[0].t) return frames[0]
  if (time >= frames[last].t) return frames[last]
  let low = 0
  let high = last
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (frames[middle].t <= time) low = middle
    else high = middle
  }
  const before = frames[low]
  const after = frames[high]
  const weight = (time - before.t) / Math.max(0.0001, after.t - before.t)
  return Object.fromEntries(
    Object.entries(before).map(([key, value]) => [
      key,
      typeof value === "number"
        ? value + ((after[key as keyof T] as number) - value) * weight
        : value,
    ])
  ) as T
}

export function symbolAt(frames: AnimationTrack["frames"], time: number) {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (frames[middle].t <= time) low = middle + 1
    else high = middle
  }
  const symbol = frames[Math.max(0, low - 1)]?.symbol
  if (!symbol || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(symbol))
    throw new Error("The scene contains an invalid animation frame.")
  return symbol
}
