export type CaptionCue = { start: number; end: number; text: string }
export type CaptionTimeline = CaptionCue & {
  key: string
  prefix: string
  glyphs: string[]
  revealAt: number[]
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

// All positions come from scene time: seeking never starts a separate timer.
export function captionTimeline(cue: CaptionCue): CaptionTimeline {
  const prefix = cue.text.match(/^[^:：\n]{1,48}[:：]\s*/u)?.[0] ?? ""
  const glyphs = [...segmenter.segment(cue.text.slice(prefix.length))].map(
    ({ segment }) => segment
  )
  let cursor = 0
  const revealAt = glyphs.map((_glyph, index) => {
    const previous = glyphs[index - 1] ?? ""
    cursor += /[.!?…]/u.test(previous)
      ? 0.13
      : /[,;—]/u.test(previous)
        ? 0.075
        : 0.029
    return cursor
  })
  const available = Math.max(0.05, Math.min(3.4, (cue.end - cue.start) * 0.65))
  const speed = Math.min(1, available / Math.max(cursor, 0.001))
  return {
    ...cue,
    key: `${cue.start}:${cue.end}:${cue.text}`,
    prefix,
    glyphs,
    revealAt: revealAt.map((at) => at * speed),
  }
}

export function captionFrame(
  line: CaptionTimeline,
  time: number,
  reduced = false
) {
  const elapsed = Math.max(0, time - line.start)
  const count = reduced
    ? line.glyphs.length
    : line.revealAt.filter((at) => at <= elapsed).length
  return {
    count,
    text: line.prefix + line.glyphs.slice(0, count).join(""),
    complete: count === line.glyphs.length,
  }
}

type SoundFrame = { line: CaptionTimeline; time: number; count: number }

// No catch-up sounds after a seek, stalled frame, mute, or paused playback.
export class CaptionSoundGate {
  private previous: SoundFrame | null = null
  private lastTick = -Infinity

  reset() {
    this.previous = null
    this.lastTick = -Infinity
  }

  advance(frame: SoundFrame | null, enabled: boolean): boolean {
    const previous = this.previous
    this.previous = frame
    if (!frame || !enabled) {
      this.lastTick = -Infinity
      return false
    }
    const sameLine = previous?.line.key === frame.line.key
    const continuous =
      previous &&
      frame.time >= previous.time &&
      frame.time - previous.time < 0.2
    const atStart = !sameLine && frame.time - frame.line.start < 0.16
    if ((!sameLine || !continuous) && !atStart) {
      this.lastTick = -Infinity
      return false
    }
    const from = sameLine ? previous!.count : 0
    if (frame.count <= from || frame.time - this.lastTick < 0.09) return false
    const letters = frame.line.glyphs.slice(from, frame.count).join("")
    if (!/[\p{L}\p{N}]/u.test(letters)) return false
    this.lastTick = frame.time
    return true
  }
}
