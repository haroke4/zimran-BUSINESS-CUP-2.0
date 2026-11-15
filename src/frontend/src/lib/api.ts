import type { DraftInput } from "@/stories"

export type JobStatus = "queued" | "generating" | "ready" | "failed"
export type StorySummary = {
  storyId: string
  title: string
  status: JobStatus
  jobId: string | null
  revision: number
  mode: "demo" | "live"
}
export type Job = {
  jobId: string
  storyId: string
  status: JobStatus
  error?: string | null
}
export type JobTicket = { storyId: string; jobId: string }
export type PlaybackPackage = {
  sceneId: string
  title?: string
  revision: number
  duration: number
  viewport: { width: number; height: number }
  layers: { svgUrl: string; placement?: "background" | "foreground" }[]
  animationUrl: string
  audioUrl: string
  captions: { start: number; end: number; text: string }[]
  choices: {
    revealAt: number
    enableAt: number
    options: { id: string; label: string }[]
  }
  terminal?: boolean
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body ? body.detail : null
    throw new ApiError(
      typeof detail === "string"
        ? detail
        : "The request could not be completed. Please try again.",
      response.status
    )
  }
  return body as T
}

export function createStory(input: DraftInput, mode: "demo" | "live" = "live") {
  return request<JobTicket>("/api/stories", {
    method: "POST",
    body: JSON.stringify({ ...input, mode }),
  })
}

export function waitForJob(
  jobId: string,
  signal: AbortSignal,
  onStatus?: (job: Job) => void
): Promise<Job> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal.addEventListener("abort", abort, { once: true })
    async function poll() {
      try {
        const job = await request<Job>(
          `/api/jobs/status?job_id=${encodeURIComponent(jobId)}`,
          { signal }
        )
        onStatus?.(job)
        if (job.status === "ready" || job.status === "failed") {
          signal.removeEventListener("abort", abort)
          resolve(job)
        } else timer = setTimeout(() => void poll(), 1200)
      } catch (error) {
        signal.removeEventListener("abort", abort)
        reject(error)
      }
    }
    if (signal.aborted) abort()
    else void poll()
  })
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again."
}
