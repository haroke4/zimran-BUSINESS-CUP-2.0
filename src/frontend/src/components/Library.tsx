import { Film, Play } from "lucide-react"
import { CreateSeriesDialog } from "@/components/CreateSeriesDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { StorySummary } from "@/lib/api"
import type { DraftInput } from "@/stories"

export function Library({
  stories,
  loading,
  error,
  creating,
  onCreate,
  onDemo,
  onPlay,
  onRetry,
}: {
  stories: StorySummary[]
  loading: boolean
  error: string
  creating: boolean
  onCreate: (input: DraftInput) => Promise<void>
  onDemo: () => void
  onPlay: (id: string) => void
  onRetry: () => void
}) {
  return (
    <div className="library">
      <header className="library-masthead">
        <div className="library-shell">
          <a className="wordmark" href="/">
            FRAME<span>BREAK</span>
          </a>
        </div>
      </header>
      <main
        className="library-shell library-main"
        aria-labelledby="library-title"
      >
        <div className="library-heading">
          <h1 id="library-title">Your stories</h1>
          <CreateSeriesDialog onCreate={onCreate} />
        </div>
        <p className="library-description">
          A story unfolds. You decide what happens next. Your progress is saved
          in this browser's anonymous session.
        </p>
        {error && (
          <Alert variant="destructive" className="library-alert">
            <AlertTitle>Couldn't load your library</AlertTitle>
            <AlertDescription>
              {error}
              <Button variant="outline" onClick={onRetry}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {loading && !error && (
          <div className="library-loading" role="status">
            <Spinner /> Loading your stories…
          </div>
        )}
        <ul className="story-grid">
          <li>
            <button
              type="button"
              className="story-card demo-card"
              onClick={onDemo}
              disabled={creating}
            >
              <span className="story-art corridor-art" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <Badge variant="secondary" className="story-status">
                Playable demo
              </Badge>
              <span className="story-card-body">
                <span className="story-title">Behind the Door</span>
                <span className="story-meta">30 seconds · two paths</span>
              </span>
              <span className="story-play" aria-hidden="true">
                {creating ? <Spinner /> : <Play fill="currentColor" />}
              </span>
            </button>
          </li>
          {stories.map((story) => (
            <li key={story.storyId}>
              <button
                type="button"
                className="story-card"
                onClick={() => onPlay(story.storyId)}
              >
                <span className="story-art draft-art" aria-hidden="true">
                  <Film />
                </span>
                <Badge variant="secondary" className="story-status">
                  {story.status === "ready"
                    ? story.mode === "demo"
                      ? "Demo"
                      : "Ready"
                    : story.status === "failed"
                      ? "Try again"
                      : "Preparing…"}
                </Badge>
                <span className="story-card-body">
                  <span className="story-title">{story.title}</span>
                  <span className="story-meta">
                    {story.status === "ready"
                      ? "Continue your story"
                      : story.status === "failed"
                        ? "Open to retry"
                        : "You can come back later"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
