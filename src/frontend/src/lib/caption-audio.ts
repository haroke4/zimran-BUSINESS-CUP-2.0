import { CaptionSoundGate, type CaptionTimeline } from "./caption"

// A finished, quiet UI sample. The scene's synthesis engine stays on the server.
export class CaptionAudio {
  private voices = Array.from({ length: 3 }, () => {
    const audio = new Audio("/static/audio/text-tap-v1.wav")
    audio.preload = "auto"
    return audio
  })
  private gate = new CaptionSoundGate()
  private nextVoice = 0
  private revision = 0

  prime() {
    const revision = ++this.revision
    for (const voice of this.voices) {
      voice.muted = true
      voice.volume = 0
      void voice
        .play()
        .then(() => {
          if (this.revision === revision) {
            voice.pause()
            voice.currentTime = 0
            voice.muted = false
          }
        })
        .catch(() => {})
    }
  }

  update(
    line: CaptionTimeline | null,
    time: number,
    count: number,
    enabled: boolean,
    volume: number
  ) {
    const tick = this.gate.advance(line ? { line, time, count } : null, enabled)
    if (!enabled) this.silence()
    if (!tick) return
    this.revision++
    const voice = this.voices[this.nextVoice++ % this.voices.length]
    voice.pause()
    voice.currentTime = 0
    voice.muted = false
    voice.volume = Math.max(0, Math.min(1, volume)) * 0.26
    voice.playbackRate = 0.98 + (this.nextVoice % 3) * 0.02
    void voice.play().catch(() => {})
  }

  private silence() {
    this.revision++
    for (const voice of this.voices) {
      voice.pause()
      voice.currentTime = 0
    }
  }

  stop() {
    this.silence()
    this.gate.reset()
  }

  dispose() {
    this.stop()
    for (const voice of this.voices) {
      voice.removeAttribute("src")
      voice.load()
    }
  }
}
