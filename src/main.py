import os
import re
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from src.backend.routes import router
from src.backend.schemas import PublicError
from src.backend.service import ServiceError, StoryService

SRC_DIR = Path(__file__).resolve().parent
PAGES_DIR = SRC_DIR / "pages"
STATIC_DIR = SRC_DIR / "static"
APP_PAGE = STATIC_DIR / "dist" / "index.html"
COOKIE_NAME = "storyfork_session"


def create_app(data_dir: Path | None = None, service: StoryService | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.stories.recover()
        try:
            yield
        finally:
            await app.state.stories.close()

    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.stories = service or StoryService(
        data_dir or Path(os.environ.get("STORYFORK_DATA_DIR", SRC_DIR.parent / "output" / "app")),
        concurrency=max(1, min(4, int(os.environ.get("STORYFORK_GENERATION_CONCURRENCY", "2")))),
        timeout=float(os.environ.get("STORYFORK_GENERATION_TIMEOUT", "300")),
        rate_limit=int(os.environ.get("STORYFORK_RATE_LIMIT", "12")),
    )
    # Only the built frontend and landing assets are mounted. Generation, prompts,
    # source modules, actor libraries and the database are outside public mounts.
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.include_router(router)

    @app.middleware("http")
    async def anonymous_session(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.method in ("POST", "PUT", "PATCH"):
            declared = request.headers.get("content-length", "0")
            if not declared.isdigit() or int(declared) > 16384:
                return JSONResponse(PublicError(detail="Слишком большой запрос.").model_dump(), status_code=413)
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 16384:
                    return JSONResponse(PublicError(detail="Слишком большой запрос.").model_dump(), status_code=413)
            # Preserve the bounded body for FastAPI after consuming its stream.
            request._body = bytes(body)
            origin = request.headers.get("origin")
            if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
                return JSONResponse(PublicError(detail="Источник запроса не разрешён.").model_dump(), status_code=403)
        cookie = request.cookies.get(COOKIE_NAME, "")
        fresh = not re.fullmatch(r"[a-f0-9]{32}", cookie)
        request.state.session_id = secrets.token_hex(16) if fresh else cookie
        response = await call_next(request)
        if fresh:
            response.set_cookie(COOKIE_NAME, request.state.session_id, max_age=60 * 60 * 24 * 365,
                                httponly=True, samesite="lax", secure=request.url.scheme == "https")
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(ServiceError)
    async def service_error(request: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(PublicError(detail=exc.detail).model_dump(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(PublicError(detail="Проверьте поля запроса.").model_dump(), status_code=422)

    @app.api_route("/", methods=["GET", "HEAD"])
    async def landing_page():
        return FileResponse(PAGES_DIR / "index.html", media_type="text/html")

    @app.api_route("/app", methods=["GET", "HEAD"])
    async def app_page():
        if APP_PAGE.is_file():
            return FileResponse(APP_PAGE, media_type="text/html")
        return FileResponse(PAGES_DIR / "app.html", media_type="text/html", status_code=503)

    return app


app = create_app()
