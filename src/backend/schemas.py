from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import Annotated


class PublicSchema(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


Identifier = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9_-]{1,96}$")]


class StoryCreate(PublicSchema):
    premise: str = Field(min_length=3, max_length=4000)
    mood: str = Field(default="mystery", max_length=80)
    notes: str = Field(default="", max_length=2000)
    mode: Literal["demo", "live"] = "live"


class JobRef(PublicSchema):
    storyId: str
    jobId: str


class JobStatus(JobRef):
    status: Literal["queued", "generating", "ready", "failed"]
    error: str | None = None


class ChoiceRequest(PublicSchema):
    storyId: Identifier
    choiceId: Identifier
    expectedRevision: int = Field(ge=0)
    requestId: Identifier


class RetryRequest(PublicSchema):
    jobId: Identifier


class Viewport(PublicSchema):
    width: int = Field(gt=0, le=32000)
    height: int = Field(gt=0, le=32000)


class Layer(PublicSchema):
    svgUrl: str
    placement: Literal["background", "foreground"] = "background"


class Caption(PublicSchema):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = Field(max_length=3000)


class ChoiceOption(PublicSchema):
    id: str
    label: str = Field(max_length=300)


class Choices(PublicSchema):
    revealAt: float = Field(ge=0)
    enableAt: float = Field(ge=0)
    options: list[ChoiceOption] = Field(max_length=4)


class PlaybackPackage(PublicSchema):
    sceneId: str
    duration: float = Field(gt=0, le=300)
    viewport: Viewport
    layers: list[Layer] = Field(min_length=1, max_length=30)
    animationUrl: str
    audioUrl: str
    captions: list[Caption] = Field(default_factory=list, max_length=200)
    choices: Choices
    terminal: bool = False
    title: str = Field(default="StoryFork", max_length=300)
    revision: int = Field(default=0, ge=0)


class StorySummary(PublicSchema):
    storyId: str
    title: str
    status: Literal["queued", "generating", "ready", "failed"]
    jobId: str
    revision: int
    mode: Literal["demo", "live"]


class StoryList(PublicSchema):
    stories: list[StorySummary]


class PublicError(PublicSchema):
    detail: str
