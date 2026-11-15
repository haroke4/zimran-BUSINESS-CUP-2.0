"""A second allowlist at the process boundary: private worker data never reaches HTTP."""
from typing import Any


def public_package(value: dict[str, Any], scene_id: str) -> dict[str, Any]:
    def media_url(url: Any) -> str:
        if not isinstance(url, str) or not url.startswith(f"/media/{scene_id}/"):
            raise ValueError("Invalid exported media URL")
        filename = url.rsplit("/", 1)[-1]
        if "/" in url[len(f"/media/{scene_id}/"):] or ".." in filename or not filename:
            raise ValueError("Invalid exported filename")
        return url

    duration = float(value["duration"])
    if not 0 < duration <= 300 or value["sceneId"] != scene_id:
        raise ValueError("Invalid playback identity or duration")
    choices = value["choices"]
    return {
        "sceneId": scene_id,
        "duration": duration,
        "viewport": {key: int(value["viewport"][key]) for key in ("width", "height")},
        "layers": [{"svgUrl": media_url(layer["svgUrl"]),
                    "placement": layer.get("placement", "background") if layer.get("placement", "background") in ("background", "foreground") else "background"}
                   for layer in value["layers"]],
        "animationUrl": media_url(value["animationUrl"]),
        "audioUrl": media_url(value["audioUrl"]),
        "captions": [{"start": float(row["start"]), "end": float(row["end"]), "text": str(row["text"])}
                     for row in value.get("captions", [])],
        "choices": {"revealAt": float(choices["revealAt"]), "enableAt": float(choices["enableAt"]),
                    "options": [{"id": str(row["id"]), "label": str(row["label"])}
                                for row in choices["options"]]},
        "terminal": bool(value.get("terminal", False)),
        "title": str(value.get("title", "StoryFork"))[:300],
    }
