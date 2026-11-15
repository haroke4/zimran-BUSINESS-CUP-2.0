# StoryFork

Production: [businesscup.toilap.com/app](https://businesscup.toilap.com/app). Server layout and rollback: [deploy/README.md](deploy/README.md).

A web app for interactive animated stories, built with FastAPI, React, and a private Node.js generator. No account is required. Each completed scene reaches the browser as SVG layers, animation tracks, a mixed audio file, captions, and the choices currently available.

## Getting started

Requires Python 3.12+, Node.js 24, and `uv`.

```sh
./scripts/setup.sh
./scripts/start.sh
```

Open the [app](http://127.0.0.1:8000/app) or the [landing page](http://127.0.0.1:8000/). If the port is occupied, run `STORYFORK_PORT=18080 ./scripts/start.sh`.

“Play corridor demo” starts a prepared scene without calling a model. It has two distinct continuations: open the door or leave. Both are complete packages with animation and audio, processed through the same server export pipeline and player.

“Create a series” generates a short episode live: a 30-second opening scene, followed by one of two 30-second endings based on the chosen action. The hidden plan and the consequences of both choices stay on the server. Copy `.env.example` to `.env` and configure the server-side provider. Vertex requires Google Cloud access through Application Default Credentials and a project with the API enabled. Do not put API keys or model settings in `VITE_*` variables.

For frontend development, run FastAPI on port 8000 and separately run `npm --prefix src/frontend run dev`. Vite proxies `/api` and `/media` to the server. To use a different backend port, run `STORYFORK_API_TARGET=http://127.0.0.1:18080 npm --prefix src/frontend run dev`.

## Project structure

- `src/frontend` — React: the story library, story creation, and a universal player.
- `src/backend` — public schemas, generation jobs, SQLite, anonymous sessions, and server-side choice handling.
- `src/generation` — a private Node.js package for scripting, vector scene generation, staging, animation export, and offline audio rendering.
- `src/pages`, `src/static` — the landing page, prepared portraits, and the built frontend.
- `output/app` — the local database and exported media; use persistent storage when deploying.

All prototypes, experimental assets, model comparisons, and presentation materials are in [`hypothesis-non-production/`](hypothesis-non-production/README.md). The app does not import them at runtime.

## Public API

| Request | Result |
| --- | --- |
| `POST /api/stories` | `{storyId, jobId}`; input: `premise`, `mood`, `notes`, `mode` (`live` or `demo`) |
| `GET /api/stories` | Stories and progress for the current anonymous viewer |
| `GET /api/jobs/status?job_id=…` | `queued`, `generating`, `ready`, or `failed` |
| `POST /api/jobs/retry` | Retry a failed job; input: `jobId` |
| `GET /api/playback?story_id=…` | The public package for the current scene and its `revision` |
| `POST /api/choices` | The next job; input: `storyId`, `choiceId`, `expectedRevision`, `requestId` |
| `GET /media/…` | Registered exports only |

Repeating a `requestId` with the same choice returns the original job. Outdated revisions and unavailable choices are rejected. A new viewer opening a shared link starts at the first scene and gets their own choice history. Deleting the cookie starts a new anonymous session.

Prompts, the full story state, future outcomes, model responses, and diagnostics stay on the server. The public package is assembled from an explicit field allowlist. The full motion library and audio synthesizer are not loaded into the browser; audio is delivered as one prepared WAV file per scene. Dialogue voiceovers are not yet available.

## Validation

```sh
uv run --locked --extra test python -m unittest discover -s src/backend -p 'test_*.py'
npm --prefix src/generation test
npm --prefix src/frontend run build
npm --prefix src/frontend run lint
npm --prefix src/frontend run test:captions
node scripts/smoke.mjs http://127.0.0.1:8000
npm --prefix src/frontend run test:browser
```

Run one FastAPI process at a time: that process manages the local queue. On restart, unfinished jobs are marked as failed and can be retried. The active server locks the data directory; a second instance using the same directory exits with a clear error. Set a different `STORYFORK_DATA_DIR` for an independent local instance. Multiple server processes require an external queue. Public generation is limited by request size, job count, and request rate.
