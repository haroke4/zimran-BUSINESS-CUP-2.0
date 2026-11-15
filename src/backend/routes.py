from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from .guards import *
from .schemas import *
from .service import StoryService

router = APIRouter()


@router.post("/api/stories", response_model=JobRef, status_code=202)
async def create_story(data: StoryCreate, service: StoryService = Depends(get_service),
                       session_id: str = Depends(get_session), ip: str = Depends(get_ip)):
    return JobRef(**service.create(session_id, ip, data.model_dump()))


@router.get("/api/stories", response_model=StoryList)
async def list_stories(service: StoryService = Depends(get_service), session_id: str = Depends(get_session)):
    return StoryList(stories=service.list_stories(session_id))


@router.get("/api/jobs/status", response_model=JobStatus)
async def job_status(job: dict[str, Any] = Depends(require_job)):
    return JobStatus(**job, jobId=job["id"], storyId=job["story_id"])


@router.post("/api/jobs/retry", response_model=JobRef, status_code=202)
async def retry_job(job: dict[str, Any] = Depends(require_retry), service: StoryService = Depends(get_service),
                    session_id: str = Depends(get_session), ip: str = Depends(get_ip)):
    return JobRef(**service.retry(session_id, ip, job))


@router.get("/api/playback", response_model=PlaybackPackage)
async def get_playback(story_id: str = Depends(require_story), service: StoryService = Depends(get_service),
                       session_id: str = Depends(get_session)):
    return PlaybackPackage(**service.playback(session_id, story_id))


@router.post("/api/choices", response_model=JobRef, status_code=202)
async def make_choice(data: ChoiceRequest, service: StoryService = Depends(get_service),
                      session_id: str = Depends(get_session), ip: str = Depends(get_ip)):
    return JobRef(**service.choose(session_id, ip, data.model_dump()))


@router.api_route("/media/{scene_id}/{filename}", methods=["GET", "HEAD"], response_class=FileResponse)
async def get_media(path: Path = Depends(require_media)):
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable",
                                      "X-Content-Type-Options": "nosniff",
                                      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})
