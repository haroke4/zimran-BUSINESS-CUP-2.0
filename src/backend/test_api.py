import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

import httpx

from src.backend.service import StoryService
from src.main import create_app


class FakeService(StoryService):
    def __init__(self, directory: Path, rate_limit: int = 100) -> None:
        super().__init__(directory, concurrency=1, rate_limit=rate_limit)
        self.calls: list[dict[str, Any]] = []
        self.fail_next = False
        self.active = 0
        self.max_active = 0

    async def invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            await asyncio.sleep(0.01)
            self.calls.append(payload)
            if self.fail_next:
                self.fail_next = False
                raise ValueError("SECRET PROVIDER TOKEN diagnostic prompt")
            scene_id = payload["sceneId"]
            directory = self.media_dir / scene_id
            directory.mkdir(parents=True, exist_ok=True)
            for filename, content in (("background.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>'),
                                      ("animation.json", '{"tracks":[]}'), ("audio.wav", "RIFF")):
                (directory / filename).write_text(content)
            base = f"/media/{scene_id}"
            return {"playback": {"sceneId": scene_id, "duration": 30,
                     "viewport": {"width": 1600, "height": 900},
                     "layers": [{"svgUrl": f"{base}/background.svg", "prompt": "SECRET"}],
                     "animationUrl": f"{base}/animation.json", "audioUrl": f"{base}/audio.wav",
                     "captions": [{"start": 0, "end": 8, "text": payload["branch"] or "Opening"}],
                     "choices": {"revealAt": 27, "enableAt": 30,
                                 "options": [] if payload["branch"] else [{"id": "open", "label": "Open"}, {"id": "leave", "label": "Leave"}]},
                     "terminal": bool(payload["branch"]), "title": "Corridor", "prompt": "SECRET"},
                    "internal": {"plan": "SECRET future branches", "state": payload["branch"],
                                 "mediaFiles": ["background.svg", "animation.json", "audio.wav"]}}
        finally:
            self.active -= 1


class PublicApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.service = FakeService(Path(self.temp.name))
        self.app = create_app(service=self.service)
        self.lifespan = self.app.router.lifespan_context(self.app)
        await self.lifespan.__aenter__()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        await self.lifespan.__aexit__(None, None, None)
        self.temp.cleanup()

    async def settled(self, job_id: str) -> dict[str, Any]:
        for _ in range(100):
            response = await self.client.get("/api/jobs/status", params={"job_id": job_id})
            job = response.json()
            if job["status"] in ("ready", "failed"):
                return job
            await asyncio.sleep(0.005)
        self.fail("Job never settled")

    async def opening(self) -> tuple[str, dict[str, Any]]:
        response = await self.client.post("/api/stories", json={"premise": "A corridor", "mode": "demo"})
        self.assertEqual(response.status_code, 202, response.text)
        ref = response.json()
        self.assertEqual((await self.settled(ref["jobId"]))["status"], "ready")
        package = (await self.client.get("/api/playback", params={"story_id": ref["storyId"]})).json()
        return ref["storyId"], package

    async def test_exports_are_allowlisted_and_media_is_not_a_directory_mount(self) -> None:
        story_id, package = await self.opening()
        self.assertNotIn("SECRET", json.dumps(package))
        self.assertNotIn("prompt", json.dumps(package))
        self.assertEqual(package["revision"], 0)
        self.assertEqual((await self.client.get(package["layers"][0]["svgUrl"])).status_code, 200)
        for path in ("/assets/stickman/rig.js", "/src/generation/cli.mjs", "/test_no_asset/scene.mjs",
                     f'/media/{package["sceneId"]}/internal.json', "/media/stories.sqlite3"):
            self.assertEqual((await self.client.get(path)).status_code, 404)
        cookie = self.client.cookies.get("storyfork_session")
        self.assertEqual(len(cookie), 32)
        summary = (await self.client.get("/api/stories")).json()["stories"][0]
        self.assertEqual(summary["storyId"], story_id)
        self.assertEqual(summary["status"], "ready")

    async def test_choice_idempotency_stale_revisions_and_branch_state(self) -> None:
        story_id, package = await self.opening()
        data = {"storyId": story_id, "choiceId": "open", "expectedRevision": 0, "requestId": "request-one"}
        first, duplicate = await asyncio.gather(self.client.post("/api/choices", json=data),
                                               self.client.post("/api/choices", json=data))
        self.assertEqual(first.status_code, 202, first.text)
        self.assertEqual(duplicate.json(), first.json())
        conflict = await self.client.post("/api/choices", json={**data, "choiceId": "leave"})
        self.assertEqual(conflict.status_code, 409)
        stale = await self.client.post("/api/choices", json={**data, "requestId": "another"})
        self.assertEqual(stale.status_code, 409)
        await self.settled(first.json()["jobId"])
        outcome = (await self.client.get("/api/playback", params={"story_id": story_id})).json()
        self.assertEqual(outcome["revision"], 1)
        self.assertTrue(outcome["terminal"])
        self.assertEqual(outcome["captions"][0]["text"], "open")
        self.assertEqual(self.service.calls[-1]["state"]["plan"], "SECRET future branches")
        self.assertEqual(len(self.service.calls), 2)

    async def test_public_viewer_has_independent_progress_and_private_jobs(self) -> None:
        story_id, _ = await self.opening()
        response = await self.client.post("/api/choices", json={"storyId": story_id, "choiceId": "open", "expectedRevision": 0, "requestId": "owner-choice"})
        await self.settled(response.json()["jobId"])
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test") as visitor:
            self.assertEqual((await visitor.get("/api/jobs/status", params={"job_id": response.json()["jobId"]})).status_code, 404)
            opening = (await visitor.get("/api/playback", params={"story_id": story_id})).json()
            self.assertEqual(opening["revision"], 0)
            self.assertFalse(opening["terminal"])
            choice = await visitor.post("/api/choices", json={"storyId": story_id, "choiceId": "leave", "expectedRevision": 0, "requestId": "visitor-choice"})
            self.assertEqual(choice.status_code, 202)
            await asyncio.sleep(0.05)
            outcome = (await visitor.get("/api/playback", params={"story_id": story_id})).json()
            self.assertEqual(outcome["captions"][0]["text"], "leave")
        owner = (await self.client.get("/api/playback", params={"story_id": story_id})).json()
        self.assertEqual(owner["captions"][0]["text"], "open")

    async def test_failures_are_private_and_retry_reuses_job(self) -> None:
        self.service.fail_next = True
        with self.assertLogs("storyfork.jobs", level="ERROR"):
            ref = (await self.client.post("/api/stories", json={"premise": "A corridor", "mode": "demo"})).json()
            job = await self.settled(ref["jobId"])
        self.assertEqual(job["status"], "failed")
        self.assertNotIn("SECRET", json.dumps(job))
        retry = await self.client.post("/api/jobs/retry", json={"jobId": ref["jobId"]})
        self.assertEqual(retry.json(), ref)
        self.assertEqual((await self.settled(ref["jobId"]))["status"], "ready")

    async def test_limits_bad_inputs_and_parallel_generation(self) -> None:
        for _ in range(3):
            await self.client.post("/api/stories", json={"premise": "A corridor", "mode": "demo"})
        await asyncio.gather(*list(self.service.tasks))
        self.assertEqual(self.service.max_active, 1)
        self.service.rate_limit = 1
        self.assertEqual((await self.client.post("/api/stories", json={"premise": "Another"})).status_code, 429)
        invalid = await self.client.post("/api/stories", json={"premise": "SECRET" * 1000})
        self.assertEqual(invalid.status_code, 422)
        self.assertNotIn("SECRET", invalid.text)
        self.assertEqual((await self.client.post("/api/stories", content=b"a" * 17000)).status_code, 413)
        async def streamed_body():
            for _ in range(20):
                yield b"a" * 1000
        self.assertEqual((await self.client.post("/api/stories", content=streamed_body())).status_code, 413)
        self.assertEqual((await self.client.post("/api/stories", json={"premise": "Okay"}, headers={"Origin": "https://evil.example"})).status_code, 403)

    async def test_restart_marks_interrupted_jobs_failed_but_keeps_progress(self) -> None:
        story_id, package = await self.opening()
        with self.service.store.connect(write=True) as db:
            db.execute("UPDATE jobs SET status='generating'")
        await self.service.close()
        second = StoryService(Path(self.temp.name))
        second.recover()
        retained = second.playback(self.client.cookies["storyfork_session"], story_id)
        self.assertEqual(retained["sceneId"], package["sceneId"])
        self.assertEqual(second.list_stories(self.client.cookies["storyfork_session"])[0]["status"], "failed")
        await second.close()


    async def test_second_server_cannot_recover_or_change_an_active_servers_jobs(self) -> None:
        story_id, _ = await self.opening()
        with self.service.store.connect(write=True) as db:
            db.execute("UPDATE jobs SET status='generating'")
        second = StoryService(Path(self.temp.name))
        second_app = create_app(service=second)
        with self.assertRaisesRegex(RuntimeError, "STORYFORK_DATA_DIR"):
            async with second_app.router.lifespan_context(second_app):
                self.fail("Second server must not start")
        await second.close()
        jobs = self.service.store.all("SELECT status FROM jobs WHERE story_id=?", (story_id,))
        self.assertEqual(jobs[0]["status"], "generating")
        await self.service.close()
        async with second_app.router.lifespan_context(second_app):
            self.assertEqual(second.list_stories(self.client.cookies["storyfork_session"])[0]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
