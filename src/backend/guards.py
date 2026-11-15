from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException, Query, Request

from .schemas import *
from .service import StoryService


def get_service(request: Request) -> StoryService:
    return request.app.state.stories


def get_session(request: Request) -> str:
    return request.state.session_id


def get_ip(request: Request) -> str:
    # Do not trust caller-controlled X-Forwarded-For without a configured proxy.
    return request.client.host if request.client else "local"


def require_story(story_id: Identifier = Query(), service: StoryService = Depends(get_service)) -> str:
    if not service.store.one("SELECT id FROM stories WHERE id=?", (story_id,)):
        raise HTTPException(404, "История не найдена.")
    return story_id


def require_job(job_id: Identifier = Query(), service: StoryService = Depends(get_service),
                session_id: str = Depends(get_session)) -> dict[str, Any]:
    job = service.store.one("SELECT * FROM jobs WHERE id=? AND session_id=?", (job_id, session_id))
    if not job:
        raise HTTPException(404, "Задание не найдено.")
    return job


def require_retry(data: RetryRequest, service: StoryService = Depends(get_service),
                  session_id: str = Depends(get_session)) -> dict[str, Any]:
    job = service.store.one("SELECT * FROM jobs WHERE id=? AND session_id=?", (data.jobId, session_id))
    if not job:
        raise HTTPException(404, "Задание не найдено.")
    if job["status"] != "failed":
        raise HTTPException(409, "Повтор доступен после ошибки генерации.")
    return job


def require_media(scene_id: str, filename: str, service: StoryService = Depends(get_service)) -> Path:
    if not service.store.one("SELECT scene_id FROM media WHERE scene_id=? AND filename=?", (scene_id, filename)):
        raise HTTPException(404, "Файл не найден.")
    path = (service.media_dir / scene_id / filename).resolve()
    if not path.is_relative_to(service.media_dir.resolve()) or not path.is_file():
        raise HTTPException(404, "Файл не найден.")
    return path
