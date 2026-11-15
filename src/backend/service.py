import asyncio
import hashlib
import fcntl
import logging
import os
import re
import signal
import time
import uuid
from pathlib import Path
from typing import Any

from .export import public_package
from .store import Store, decode, encode

logger = logging.getLogger("storyfork.jobs")
ROOT = Path(__file__).resolve().parents[2]
PUBLIC_FAILURE = "Не удалось подготовить сцену. Попробуйте ещё раз."


class ServiceError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        self.status = status
        self.detail = detail
        super().__init__(detail)


class StoryService:
    def __init__(self, data_dir: Path, concurrency: int = 2, timeout: float = 300,
                 rate_limit: int = 12) -> None:
        self.store = Store(data_dir / "stories.sqlite3")
        self.media_dir = data_dir / "media"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.semaphore = asyncio.Semaphore(concurrency)
        self.timeout = timeout
        self.rate_limit = rate_limit
        self.tasks: set[asyncio.Task[None]] = set()
        self.closed = False
        self._lock_fd: int | None = None

    def _acquire_lock(self) -> None:
        if self._lock_fd is not None:
            return
        lock_path = self.store.path.parent / "app.lock"
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            os.close(fd)
            raise RuntimeError(
                f"StoryFork data directory is already in use: {self.store.path.parent}. "
                "Run one Uvicorn worker, or choose a separate STORYFORK_DATA_DIR for this server."
            ) from exc
        except BaseException:
            os.close(fd)
            raise
        self._lock_fd = fd

    def _release_lock(self) -> None:
        if self._lock_fd is not None:
            fd, self._lock_fd = self._lock_fd, None
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def _mark_interrupted_jobs(self) -> None:
        with self.store.connect(write=True) as db:
            db.execute("UPDATE jobs SET status='failed',error=? WHERE status IN ('queued','generating')",
                       (PUBLIC_FAILURE,))

    def recover(self) -> None:
        # Acquire during lifespan startup, never module import. A second server
        # must not mistake another process's running jobs for interrupted jobs.
        self._acquire_lock()
        try:
            self._mark_interrupted_jobs()
            self.closed = False
        except BaseException:
            self._release_lock()
            raise

    async def close(self) -> None:
        self.closed = True
        try:
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            if self._lock_fd is not None:
                self._mark_interrupted_jobs()
        finally:
            self._release_lock()

    def rate(self, db: Any, session_id: str, ip: str) -> None:
        now = time.time()
        db.execute("DELETE FROM limits WHERE created < ?", (now - 3600,))
        for kind, subject in (("session", session_id), ("ip", hashlib.sha256(ip.encode()).hexdigest())):
            count = db.execute("SELECT count(*) FROM limits WHERE kind=? AND subject=? AND created>?",
                               (kind, subject, now - 3600)).fetchone()[0]
            if count >= self.rate_limit:
                raise ServiceError(429, "Слишком много генераций. Попробуйте позже.")
        pending = db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','generating')").fetchone()[0]
        if pending >= 12:
            raise ServiceError(429, "Очередь генерации заполнена. Попробуйте позже.")
        for kind, subject in (("session", session_id), ("ip", hashlib.sha256(ip.encode()).hexdigest())):
            db.execute("INSERT INTO limits VALUES(?,?,?)", (kind, subject, now))

    def enqueue(self, job_id: str) -> None:
        task = asyncio.create_task(self.run(job_id))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    def create(self, session_id: str, ip: str, data: dict[str, Any]) -> dict[str, str]:
        story_id, job_id = f"story_{uuid.uuid4().hex}", f"job_{uuid.uuid4().hex}"
        scene_id = f"scene_{uuid.uuid4().hex}"
        payload = {**data, "action": "generate", "storyId": story_id, "sceneId": scene_id,
                   "outputDir": str(self.media_dir), "branch": None, "state": None}
        title = data["premise"].strip().splitlines()[0][:80]
        with self.store.connect(write=True) as db:
            self.rate(db, session_id, ip)
            db.execute("INSERT INTO stories(id,title,input,created) VALUES(?,?,?,?)",
                       (story_id, title, encode(data), time.time()))
            db.execute("INSERT INTO progress(session_id,story_id,job_id) VALUES(?,?,?)", (session_id, story_id, job_id))
            db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?)",
                       (job_id, session_id, story_id, "queued", encode(payload), None, time.time()))
        self.enqueue(job_id)
        return {"storyId": story_id, "jobId": job_id}

    def list_stories(self, session_id: str) -> list[dict[str, Any]]:
        rows = self.store.all('''SELECT s.id AS storyId,s.title,j.status,j.id AS jobId,p.revision,s.input
            FROM progress p JOIN stories s ON s.id=p.story_id JOIN jobs j ON j.id=p.job_id
            WHERE p.session_id=? ORDER BY s.created DESC LIMIT 100''', (session_id,))
        return [{**{key: row[key] for key in ("storyId", "title", "status", "jobId", "revision")},
                 "mode": decode(row["input"])["mode"]} for row in rows]

    def playback(self, session_id: str, story_id: str) -> dict[str, Any]:
        with self.store.connect(write=True) as db:
            progress = db.execute("SELECT * FROM progress WHERE session_id=? AND story_id=?",
                                  (session_id, story_id)).fetchone()
            if not progress:
                story = db.execute("SELECT * FROM stories WHERE id=?", (story_id,)).fetchone()
                if not story:
                    raise ServiceError(404, "История не найдена.")
                if not story["opening"]:
                    raise ServiceError(409, "Сцена ещё готовится.")
                # A public visitor starts their own decision history at the opening.
                job_id = f"job_{uuid.uuid4().hex}"
                db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?)",
                           (job_id, session_id, story_id, "ready", "{}", None, time.time()))
                db.execute("INSERT INTO progress VALUES(?,?,?,?,?,?)",
                           (session_id, story_id, 0, story["opening"], story["opening_internal"], job_id))
                return {**decode(story["opening"]), "revision": 0}
            if not progress["playback"]:
                raise ServiceError(409, "Сцена ещё готовится.")
            return {**decode(progress["playback"]), "revision": progress["revision"]}

    def choose(self, session_id: str, ip: str, data: dict[str, Any]) -> dict[str, str]:
        with self.store.connect(write=True) as db:
            existing = db.execute("SELECT * FROM decisions WHERE session_id=? AND story_id=? AND request_id=?",
                                  (session_id, data["storyId"], data["requestId"])).fetchone()
            if existing:
                if existing["choice_id"] != data["choiceId"] or existing["expected_revision"] != data["expectedRevision"]:
                    raise ServiceError(409, "Этот запрос уже использован для другого решения.")
                return {"storyId": data["storyId"], "jobId": existing["job_id"]}
            progress = db.execute("SELECT * FROM progress WHERE session_id=? AND story_id=?",
                                  (session_id, data["storyId"])).fetchone()
            if not progress or not progress["playback"]:
                raise ServiceError(404, "Сначала откройте сцену.")
            status = db.execute("SELECT status FROM jobs WHERE id=?", (progress["job_id"],)).fetchone()[0]
            if progress["revision"] != data["expectedRevision"] or status in ("queued", "generating"):
                raise ServiceError(409, "Сцена изменилась. Обновите её перед выбором.")
            playback = decode(progress["playback"])
            if playback.get("terminal") or data["choiceId"] not in {row["id"] for row in playback["choices"]["options"]}:
                raise ServiceError(422, "Этот выбор недоступен.")
            self.rate(db, session_id, ip)
            job_id = f"job_{uuid.uuid4().hex}"
            story = db.execute("SELECT input FROM stories WHERE id=?", (data["storyId"],)).fetchone()
            payload = {**decode(story["input"]), "action": "generate", "storyId": data["storyId"],
                       "sceneId": f"scene_{uuid.uuid4().hex}", "outputDir": str(self.media_dir),
                       "branch": data["choiceId"], "state": decode(progress["internal"])}
            db.execute("INSERT INTO jobs VALUES(?,?,?,?,?,?,?)",
                       (job_id, session_id, data["storyId"], "queued", encode(payload), None, time.time()))
            db.execute("INSERT INTO decisions VALUES(?,?,?,?,?,?)",
                       (session_id, data["storyId"], data["requestId"], data["choiceId"], data["expectedRevision"], job_id))
            db.execute("UPDATE progress SET revision=revision+1,job_id=? WHERE session_id=? AND story_id=?",
                       (job_id, session_id, data["storyId"]))
        self.enqueue(job_id)
        return {"storyId": data["storyId"], "jobId": job_id}

    def retry(self, session_id: str, ip: str, job: dict[str, Any]) -> dict[str, str]:
        with self.store.connect(write=True) as db:
            fresh = db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
            progress = db.execute("SELECT job_id FROM progress WHERE session_id=? AND story_id=?",
                                  (session_id, job["story_id"])).fetchone()
            if not progress or progress["job_id"] != job["id"] or fresh["status"] != "failed":
                raise ServiceError(409, "Задание уже изменилось.")
            self.rate(db, session_id, ip)
            db.execute("UPDATE jobs SET status='queued',error=NULL WHERE id=?", (job["id"],))
        self.enqueue(job["id"])
        return {"storyId": job["story_id"], "jobId": job["id"]}

    async def invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        process = await asyncio.create_subprocess_exec(
            "node", str(ROOT / "src/generation/cli.mjs"), cwd=str(ROOT),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True, limit=32 * 1024 * 1024,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(encode(payload).encode()), self.timeout)
            if stderr:
                # Provider diagnostics remain on the server; no raw output is returned to HTTP.
                log = logger.error if process.returncode else logger.info
                log("Generation %s: %s", payload["sceneId"], stderr.decode(errors="replace")[-12000:])
            if process.returncode:
                raise RuntimeError(f"Generation worker exited {process.returncode}")
            if len(stdout) > 32 * 1024 * 1024:
                raise ValueError("Generation worker output exceeded limit")
            return decode(stdout.decode())
        finally:
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except TimeoutError:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    await process.wait()

    async def run(self, job_id: str) -> None:
        async with self.semaphore:
            job = self.store.one("SELECT * FROM jobs WHERE id=?", (job_id,))
            if not job or job["status"] != "queued":
                return
            with self.store.connect(write=True) as db:
                db.execute("UPDATE jobs SET status='generating' WHERE id=?", (job_id,))
            payload = decode(job["payload"])
            try:
                result = await self.invoke(payload)
                playback = public_package(result["playback"], payload["sceneId"])
                internal = result.get("internal", {})
                scene_dir = self.media_dir / payload["sceneId"]
                files = internal.get("mediaFiles")
                if not isinstance(files, list) or not files or not all(isinstance(name, str) for name in files):
                    raise ValueError("Worker must declare its public media files")
                safe_files = [name for name in files if re.fullmatch(r"[A-Za-z0-9_-]+\.(svg|json|wav|webm|ogg|mp3)", name)
                              and (scene_dir / name).is_file()]
                required = [row["svgUrl"].rsplit("/", 1)[-1] for row in playback["layers"]]
                required += [playback[key].rsplit("/", 1)[-1] for key in ("animationUrl", "audioUrl")]
                if len(safe_files) != len(files) or not all(name in safe_files for name in required):
                    raise ValueError("Worker omitted a required exported asset")
                animation = decode((scene_dir / required[-2]).read_text())
                for track in animation.get("tracks", []):
                    url = track.get("svgUrl", "")
                    prefix = f"/media/{payload['sceneId']}/"
                    if not isinstance(url, str) or not url.startswith(prefix) or url[len(prefix):] not in safe_files:
                        raise ValueError("Animation referenced an unregistered media file")
                with self.store.connect(write=True) as db:
                    db.execute("UPDATE jobs SET status='ready',error=NULL WHERE id=?", (job_id,))
                    db.execute("UPDATE progress SET playback=?,internal=? WHERE session_id=? AND story_id=? AND job_id=?",
                               (encode(playback), encode(internal), job["session_id"], job["story_id"], job_id))
                    if payload["branch"] is None:
                        db.execute("UPDATE stories SET opening=?,opening_internal=?,title=? WHERE id=? AND opening IS NULL",
                                   (encode(playback), encode(internal), playback["title"], job["story_id"]))
                    db.executemany("INSERT OR IGNORE INTO media VALUES(?,?)", [(payload["sceneId"], name) for name in safe_files])
            except asyncio.CancelledError:
                self.fail(job_id)
                raise
            except Exception:
                logger.exception("Generation failed for job %s", job_id)
                self.fail(job_id)

    def fail(self, job_id: str) -> None:
        with self.store.connect(write=True) as db:
            db.execute("UPDATE jobs SET status='failed',error=? WHERE id=?", (PUBLIC_FAILURE, job_id))
