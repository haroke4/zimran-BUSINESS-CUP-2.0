import { useEffect, useRef, useState } from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Library } from "@/components/Library"
import { Player } from "@/components/Player"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Toaster } from "@/components/ui/sonner"
import {
  ApiError,
  createStory,
  errorMessage,
  request,
  waitForJob,
  type JobTicket,
  type PlaybackPackage,
  type StorySummary,
} from "@/lib/api"
import type { DraftInput } from "@/stories"

function route() {
  const params = new URLSearchParams(window.location.search)
  return {
    storyId: params.get("story"),
    jobId: params.get("job"),
    demo: params.get("demo") === "1",
  }
}

let automaticDemo: Promise<JobTicket> | undefined

function StoryScreen({
  storyId,
  jobId,
  onLibrary,
}: {
  storyId: string
  jobId: string | null
  onLibrary: () => void
}) {
  const [playback, setPlayback] = useState<PlaybackPackage | null>(null)
  const [status, setStatus] = useState("Loading your story…")
  const [error, setError] = useState("")
  const [retryJob, setRetryJob] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [activeJob, setActiveJob] = useState(jobId)
  const choiceRequests = useRef(new Map<string, string>())

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setError("")
      setStatus(activeJob ? "Preparing your scene…" : "Loading your story…")
      let pendingJob = activeJob
      try {
        if (!pendingJob) {
          try {
            const result = await request<PlaybackPackage>(
              `/api/playback?story_id=${encodeURIComponent(storyId)}`,
              { signal: controller.signal }
            )
            if (!controller.signal.aborted) {
              setPlayback(result)
              const readyLocation = new URL(window.location.href)
              readyLocation.searchParams.delete("job")
              window.history.replaceState(null, "", readyLocation)
              setStatus("")
            }
            return
          } catch (cause) {
            if (!(cause instanceof ApiError) || cause.status !== 409)
              throw cause
            const library = await request<{ stories: StorySummary[] }>(
              "/api/stories",
              { signal: controller.signal }
            )
            pendingJob =
              library.stories.find((story) => story.storyId === storyId)
                ?.jobId ?? null
            if (!pendingJob)
              throw new Error(
                "This story is still being prepared. Try again shortly.",
                { cause }
              )
          }
        }
        setRetryJob(pendingJob)
        const job = await waitForJob(pendingJob, controller.signal, (value) =>
          setStatus(
            value.status === "queued"
              ? "Your story is in the queue…"
              : "Creating the next scene…"
          )
        )
        if (job.status === "failed")
          throw new Error(
            job.error || "We couldn't create this scene. You can try again."
          )
        const result = await request<PlaybackPackage>(
          `/api/playback?story_id=${encodeURIComponent(storyId)}`,
          { signal: controller.signal }
        )
        if (!controller.signal.aborted) {
          setPlayback(result)
          const readyLocation = new URL(window.location.href)
          readyLocation.searchParams.delete("job")
          window.history.replaceState(null, "", readyLocation)
          setStatus("")
          setRetryJob(null)
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause))
          setStatus("")
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [storyId, activeJob, attempt])

  async function retry() {
    if (retryJob) {
      setStatus("Trying again…")
      setError("")
      try {
        const ticket = await request<JobTicket>("/api/jobs/retry", {
          method: "POST",
          body: JSON.stringify({ jobId: retryJob }),
        })
        const nextLocation = new URL(window.location.href)
        nextLocation.searchParams.set("job", ticket.jobId)
        window.history.replaceState(null, "", nextLocation)
        setActiveJob(ticket.jobId)
        setAttempt((value) => value + 1)
      } catch (cause) {
        setError(errorMessage(cause))
        setStatus("")
      }
    } else setAttempt((value) => value + 1)
  }

  async function choose(choiceId: string) {
    if (!playback) return
    const key = `${playback.revision}:${choiceId}`
    const requestId = choiceRequests.current.get(key) ?? crypto.randomUUID()
    choiceRequests.current.set(key, requestId)
    const ticket = await request<JobTicket>("/api/choices", {
      method: "POST",
      body: JSON.stringify({
        storyId,
        choiceId,
        expectedRevision: playback.revision,
        requestId,
      }),
    })
    const nextLocation = new URL(window.location.href)
    nextLocation.searchParams.set("job", ticket.jobId)
    window.history.replaceState(null, "", nextLocation)
    setActiveJob(ticket.jobId)
    setAttempt((value) => value + 1)
    setStatus("Creating the next scene…")
  }

  if (playback && !status && !error)
    return (
      <Player
        key={playback.sceneId}
        playback={playback}
        onLibrary={onLibrary}
        onChoice={choose}
      />
    )
  return (
    <main className="status-page" aria-labelledby="scene-status-title">
      <Button variant="ghost" className="status-back" onClick={onLibrary}>
        <ArrowLeft data-icon="inline-start" /> Library
      </Button>
      {error ? (
        <Alert variant="destructive" className="status-card">
          <AlertTitle id="scene-status-title">
            Couldn't load the scene
          </AlertTitle>
          <AlertDescription>
            {error}
            <Button variant="outline" onClick={() => void retry()}>
              <RefreshCw data-icon="inline-start" /> Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="status-card" role="status">
          <Spinner className="size-8" />
          <h1 id="scene-status-title">{status || "Loading…"}</h1>
          <p>You can return to the library while we prepare it.</p>
        </div>
      )}
    </main>
  )
}

export default function App() {
  const [location, setLocation] = useState(route)
  const [stories, setStories] = useState<StorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [refresh, setRefresh] = useState(0)

  function selectStory(
    storyId: string | null,
    jobId?: string,
    replace = false
  ) {
    const next = new URL(window.location.href)
    next.search = ""
    if (storyId) next.searchParams.set("story", storyId)
    if (jobId) next.searchParams.set("job", jobId)
    window.history[replace ? "replaceState" : "pushState"](null, "", next)
    setLocation(route())
    if (!storyId) setRefresh((value) => value + 1)
  }

  useEffect(() => {
    const sync = () => setLocation(route())
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  useEffect(() => {
    if (location.storyId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function loadLibrary() {
      try {
        if (location.demo) {
          automaticDemo ??= createStory(
            {
              premise: "A quiet corridor. Someone knocks behind a locked door.",
              mood: "Mysterious",
              notes: "",
            },
            "demo"
          )
          const ticket = await automaticDemo
          if (!controller.signal.aborted) {
            const next = new URL(window.location.href)
            next.search = new URLSearchParams({
              story: ticket.storyId,
              job: ticket.jobId,
            }).toString()
            window.history.replaceState(null, "", next)
            setLocation(route())
          }
          return
        }
        const result = await request<{ stories: StorySummary[] }>(
          "/api/stories",
          { signal: controller.signal }
        )
        if (!controller.signal.aborted) {
          setStories(result.stories)
          setError("")
          setLoading(false)
          if (
            result.stories.some(
              (story) =>
                story.status === "queued" || story.status === "generating"
            )
          )
            timer = setTimeout(() => void loadLibrary(), 3000)
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(errorMessage(cause))
          setLoading(false)
          automaticDemo = undefined
        }
      }
    }
    void loadLibrary()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [location.storyId, location.demo, refresh])

  async function create(input: DraftInput, mode: "demo" | "live" = "live") {
    setCreating(true)
    try {
      const ticket = await createStory(input, mode)
      selectStory(ticket.storyId, ticket.jobId)
    } catch (cause) {
      toast.error(errorMessage(cause))
      throw cause
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {location.storyId ? (
        <StoryScreen
          key={location.storyId}
          storyId={location.storyId}
          jobId={location.jobId}
          onLibrary={() => selectStory(null)}
        />
      ) : location.demo && !error ? (
        <main className="status-page" role="status">
          <Spinner className="size-8" />
          <h1>Preparing the corridor demo…</h1>
        </main>
      ) : (
        <Library
          stories={stories}
          loading={loading}
          error={error}
          creating={creating}
          onRetry={() => {
            if (location.demo) selectStory(null, undefined, true)
            else setRefresh((value) => value + 1)
          }}
          onCreate={create}
          onDemo={() =>
            void create(
              {
                premise:
                  "A quiet corridor. Someone knocks behind a locked door.",
                mood: "Mysterious",
                notes: "",
              },
              "demo"
            ).catch(() => {})
          }
          onPlay={(id) => {
            const story = stories.find((item) => item.storyId === id)
            selectStory(
              id,
              story?.status !== "ready"
                ? (story?.jobId ?? undefined)
                : undefined
            )
          }}
        />
      )}
      <Toaster position="bottom-right" closeButton />
    </>
  )
}
