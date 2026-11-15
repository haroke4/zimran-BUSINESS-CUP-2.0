import { useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react"
import { toast } from "sonner"
import { PlayerMenu } from "@/components/PlayerMenu"
import { ShareDialog } from "@/components/ShareDialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage, request, type PlaybackPackage } from "@/lib/api"
import {
  interpolate,
  mediaUrl,
  symbolAt,
  type PlaybackAnimation,
} from "@/lib/playback"

function formatTime(value: number) {
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function Scene({
  animation,
  playback,
  time,
}: {
  animation: PlaybackAnimation
  playback: PlaybackPackage
  time: number
}) {
  const camera = interpolate(animation.camera, time)
  function layer(item: PlaybackPackage["layers"][number], index: number) {
    return (
      <image
        key={`${item.svgUrl}-${index}`}
        href={mediaUrl(item.svgUrl)}
        x={0}
        y={0}
        width={animation.viewBox[2]}
        height={animation.viewBox[3]}
      />
    )
  }
  return (
    <svg
      className="player-scene"
      viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
      role="img"
      aria-label={playback.title || "Animated story scene"}
      preserveAspectRatio="xMidYMid meet"
    >
      {playback.layers
        .filter((item) => item.placement !== "foreground")
        .map(layer)}
      {animation.tracks.map((track) => {
        const frame = interpolate(track.keyframes, time)
        return (
          <g
            key={track.id}
            data-track={track.id}
            transform={`translate(${frame.x} ${frame.y}) rotate(${frame.rotation}) scale(${frame.scaleX} ${frame.scaleY})`}
            opacity={frame.opacity}
          >
            <use
              href={`${mediaUrl(track.svgUrl)}#${symbolAt(track.frames, time)}`}
            />
          </g>
        )
      })}
      {playback.layers
        .filter((item) => item.placement === "foreground")
        .map(layer)}
    </svg>
  )
}

export function Player({
  playback,
  onLibrary,
  onChoice,
}: {
  playback: PlaybackPackage
  onLibrary: () => void
  onChoice: (choiceId: string) => Promise<void>
}) {
  const stage = useRef<HTMLElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [animation, setAnimation] = useState<PlaybackAnimation | null>(null)
  const [ready, setReady] = useState(false)
  const [assetAttempt, setAssetAttempt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [time, setTime] = useState(0)
  const [error, setError] = useState("")
  const [choiceError, setChoiceError] = useState("")
  const [choosing, setChoosing] = useState(false)
  const [controls, setControls] = useState(true)
  const [fullscreen, setFullscreen] = useState(
    Boolean(document.fullscreenElement)
  )
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(0.65)
  const ended = time >= playback.duration - 0.025
  const caption = playback.captions.find(
    (line) => time >= line.start && time < line.end
  )?.text

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const data = await request<PlaybackAnimation>(
          mediaUrl(playback.animationUrl),
          { signal: controller.signal }
        )
        if (
          data.version !== 1 ||
          !data.camera?.length ||
          !Array.isArray(data.tracks)
        )
          throw new Error("This scene uses an unsupported playback format.")
        data.tracks.forEach((track) => {
          mediaUrl(track.svgUrl)
          interpolate(track.keyframes, 0)
          symbolAt(track.frames, 0)
        })
        playback.layers.forEach((layer) => mediaUrl(layer.svgUrl))
        mediaUrl(playback.audioUrl)
        if (!controller.signal.aborted) setAnimation(data)
      } catch (cause) {
        if (!controller.signal.aborted) setError(errorMessage(cause))
      }
    }
    void load()
    stage.current?.focus({ preventScroll: true })
    const media = audio.current
    return () => {
      controller.abort()
      media?.pause()
      clearTimeout(idle.current)
    }
  }, [playback, assetAttempt])

  useEffect(() => {
    if (!playing) return
    let frame: number
    function update() {
      const media = audio.current
      if (media) setTime(Math.min(playback.duration, media.currentTime))
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [playing, playback.duration])

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement))
    const visibility = () => {
      if (document.hidden) audio.current?.pause()
    }
    document.addEventListener("visibilitychange", visibility)
    document.addEventListener("fullscreenchange", sync)
    return () => {
      document.removeEventListener("fullscreenchange", sync)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])

  function reveal() {
    setControls(true)
    clearTimeout(idle.current)
    if (playing) idle.current = setTimeout(() => setControls(false), 1800)
  }

  function pause() {
    audio.current?.pause()
    setPlaying(false)
    setBuffering(false)
    setControls(true)
    clearTimeout(idle.current)
  }

  async function start() {
    if (!audio.current || !animation) return
    if (ended) {
      audio.current.currentTime = 0
      setTime(0)
    }
    setBuffering(true)
    setError("")
    try {
      await audio.current.play()
      clearTimeout(idle.current)
      idle.current = setTimeout(() => setControls(false), 1800)
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setError("Couldn't start the sound. Press play to try again.")
      setBuffering(false)
    }
  }

  function seek(value: number | readonly number[]) {
    if (!audio.current) return
    const next = Math.max(
      0,
      Math.min(playback.duration, typeof value === "number" ? value : value[0])
    )
    audio.current.currentTime = next
    setTime(next)
    if (next >= playback.duration) pause()
    reveal()
  }

  async function choose(id: string) {
    if (choosing || time < playback.choices.enableAt) return
    pause()
    setChoosing(true)
    setChoiceError("")
    try {
      await onChoice(id)
    } catch (cause) {
      setChoiceError(errorMessage(cause))
      setChoosing(false)
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await stage.current?.requestFullscreen()
    } catch {
      toast.error("Fullscreen is unavailable")
    }
  }

  function library() {
    pause()
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {})
    onLibrary()
  }

  return (
    <main
      className="player"
      data-controls-hidden={playing && !buffering && !controls}
      ref={stage}
      tabIndex={-1}
      aria-labelledby="player-title"
      onPointerMove={reveal}
      onPointerDown={reveal}
      onKeyDown={(event) => {
        reveal()
        if (
          !event.repeat &&
          event.code === "Space" &&
          event.target === event.currentTarget
        ) {
          event.preventDefault()
          if (playing) pause()
          else void start()
        }
      }}
    >
      <audio
        ref={audio}
        src={mediaUrl(playback.audioUrl)}
        preload="auto"
        onCanPlay={(event) => {
          event.currentTarget.volume = volume
          event.currentTarget.muted = muted
          setReady(true)
        }}
        onPlaying={() => {
          setPlaying(true)
          setBuffering(false)
        }}
        onWaiting={() => {
          if (!audio.current?.paused) setBuffering(true)
        }}
        onPause={() => {
          setPlaying(false)
          setBuffering(false)
          setControls(true)
        }}
        onEnded={() => {
          setTime(playback.duration)
          setPlaying(false)
          setBuffering(false)
          setControls(true)
        }}
        onError={() => {
          setError("Couldn't load the scene's audio. Try reloading the scene.")
          setReady(false)
        }}
      />
      {animation && (
        <Scene animation={animation} playback={playback} time={time} />
      )}
      <div className="player-scrim" aria-hidden="true" />
      <div className="player-controls">
        <header className="player-header">
          <div className="player-heading">
            <PlayerMenu onOpen={pause} onLibrary={library} />
            <div className="player-title">
              <h1 id="player-title">{playback.title || "Your story"}</h1>
              <p>
                {playback.terminal
                  ? "Final scene"
                  : "Your next decision is ahead"}
              </p>
            </div>
          </div>
          <div className="player-actions">
            <ShareDialog onOpen={pause} />
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Fullscreen"
              aria-pressed={fullscreen}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </Button>
          </div>
        </header>
        <div className="player-transport" aria-label="Playback controls">
          <Button
            size="icon-lg"
            aria-label={ended ? "Watch again" : playing ? "Pause" : "Play"}
            disabled={!animation || !ready || choosing}
            aria-busy={buffering}
            onClick={() => {
              if (playing) pause()
              else void start()
            }}
          >
            {buffering || !animation || !ready ? (
              <Spinner />
            ) : playing ? (
              <Pause fill="currentColor" />
            ) : ended ? (
              <RotateCcw />
            ) : (
              <Play fill="currentColor" />
            )}
          </Button>
          <Slider
            className="player-timeline"
            min={0}
            max={playback.duration}
            step={0.1}
            largeStep={5}
            value={[time]}
            disabled={!animation || !ready || choosing}
            thumbLabel="Playback position"
            onValueChange={seek}
          />
          <span className="player-time">
            {formatTime(time)} <span>/ {formatTime(playback.duration)}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            onClick={() => {
              const value = !muted
              setMuted(value)
              if (audio.current) audio.current.muted = value
            }}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Slider
            className="player-volume"
            min={0}
            max={1}
            step={0.05}
            value={[volume]}
            thumbLabel="Volume"
            onValueChange={(value) => {
              const next = typeof value === "number" ? value : value[0]
              setVolume(next)
              if (audio.current) audio.current.volume = next
            }}
          />
        </div>
      </div>
      <div className="player-bottom">
        {error && (
          <Alert variant="destructive" className="player-error">
            <AlertTitle>Couldn't play this scene</AlertTitle>
            <AlertDescription>
              {error}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError("")
                  audio.current?.load()
                  setAssetAttempt((value) => value + 1)
                }}
              >
                Reload scene
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!animation && !error && (
          <p role="status">
            <Spinner className="inline size-4" /> Loading the scene…
          </p>
        )}
        {caption && <p className="player-caption">{caption}</p>}
        {time >= playback.choices.revealAt &&
          playback.choices.options.length > 0 && (
            <section className="player-choice" aria-label="Story fork">
              <h2>
                {time < playback.choices.enableAt
                  ? "Your decision is coming…"
                  : "What happens next?"}
              </h2>
              <div className="choice-actions">
                {playback.choices.options.map((choice) => (
                  <Button
                    key={choice.id}
                    variant="outline"
                    size="lg"
                    disabled={time < playback.choices.enableAt || choosing}
                    aria-busy={choosing}
                    onClick={() => void choose(choice.id)}
                  >
                    {choice.label}
                    {choosing ? (
                      <Spinner data-icon="inline-end" />
                    ) : (
                      <ArrowRight data-icon="inline-end" />
                    )}
                  </Button>
                ))}
              </div>
              {choiceError && (
                <p role="alert" className="choice-error">
                  {choiceError}
                </p>
              )}
            </section>
          )}
        {ended && playback.terminal && (
          <section className="player-choice">
            <h2>The end</h2>
            <Button variant="secondary" onClick={library}>
              Back to library
            </Button>
          </section>
        )}
      </div>
    </main>
  )
}
