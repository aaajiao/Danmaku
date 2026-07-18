#!/usr/bin/env python3
"""Shared, read-only asset access for the v3 QA and preview commands."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

from PIL import Image, ImageDraw, ImageFont


QA_ROOT = Path(__file__).resolve().parent
ID_RE = re.compile(r"^[a-z][a-z0-9_.:-]*$")


class DuplicateKeyError(ValueError):
    pass


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise DuplicateKeyError(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle, object_pairs_hook=_no_duplicate_keys)
    if not isinstance(value, dict):
        raise ValueError(f"top-level JSON must be an object: {path}")
    return value


def safe_output_path(path: Path) -> Path:
    """Refuse writes outside work/v3/qa, even for an accidental CLI path."""
    resolved = path.resolve()
    try:
        resolved.relative_to(QA_ROOT)
    except ValueError as exc:
        raise ValueError(f"output must stay inside {QA_ROOT}: {resolved}") from exc
    return resolved


def locate_first(root: Path, relative_candidates: Iterable[str]) -> Optional[Path]:
    for relative in relative_candidates:
        path = root / relative
        if path.is_file():
            return path
    return None


def find_named_file(root: Path, name: str, preferred: Iterable[Path] = ()) -> Optional[Path]:
    for base in preferred:
        path = (base / name).resolve()
        if path.is_file():
            return path
    hits = sorted(root.rglob(name))
    return hits[0].resolve() if hits else None


def normalize_mapping(value: Any, id_key: str = "id") -> dict[str, dict[str, Any]]:
    if isinstance(value, dict):
        return {str(key): item for key, item in value.items() if isinstance(item, dict)}
    if isinstance(value, list):
        return {
            str(item[id_key]): item
            for item in value
            if isinstance(item, dict) and isinstance(item.get(id_key), str)
        }
    return {}


@dataclass(frozen=True)
class TimelineFrame:
    ref: str
    duration_ms: int
    events: tuple[str, ...]
    source_ordinal: int


class Kit:
    """Tolerant loader for v3 manifests, with v2 compatibility for migration QA."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        if not self.root.is_dir():
            raise FileNotFoundError(f"kit root does not exist: {self.root}")

        self.manifest_paths: dict[str, Optional[Path]] = {
            "animation": locate_first(
                self.root,
                (
                    "manifests/v3/animation-clips.json",
                    "manifests/animation-clips.json",
                    "manifests/v2/animation-clips.json",
                    "animation-clips.json",
                ),
            ),
            "frames": locate_first(
                self.root,
                (
                    "manifests/v3/frame-index-v3.json",
                    "manifests/v3/frame-index.json",
                    "manifests/frame-index-v3.json",
                    "manifests/v2/frame-index-v2.json",
                    "manifests/frame-index.json",
                    "frame-index.json",
                ),
            ),
            "static_frames": locate_first(self.root, ("manifests/frame-index.json",)),
            "asset": locate_first(
                self.root,
                (
                    "manifests/v3/asset-manifest-v3.json",
                    "manifests/v3/asset-manifest.json",
                    "manifests/v2/asset-manifest-v2.json",
                    "manifests/asset-manifest.json",
                ),
            ),
            "static_asset": locate_first(self.root, ("manifests/asset-manifest.json",)),
            "palette": locate_first(
                self.root,
                ("manifests/v3/palette.json", "manifests/palette.json", "palette.json"),
            ),
            "rigs": locate_first(
                self.root,
                ("manifests/v3/boss-rigs.json", "manifests/v2/boss-rigs.json", "boss-rigs.json"),
            ),
            "lasers": locate_first(
                self.root,
                ("manifests/v3/laser-modules.json", "manifests/v2/laser-modules.json", "laser-modules.json"),
            ),
            "effects": locate_first(
                self.root,
                ("manifests/v3/runtime-effects.json", "manifests/v2/runtime-effects.json", "runtime-effects.json"),
            ),
            "qa_config": locate_first(
                self.root,
                ("manifests/v3/qa-config.json", "manifests/qa-config.json", "qa-config.json"),
            ),
            "visual_contract": locate_first(
                self.root,
                (
                    "manifests/v3/visual-contract-v3.json",
                    "manifests/v3/visual-contract.json",
                    "art/visual-contract-v3.json",
                    "visual-contract-v3.json",
                ),
            ),
            "binding_graph": locate_first(
                self.root,
                (
                    "manifests/v3/binding-graph.json",
                    "runtime/binding-graph.json",
                    "binding-graph.json",
                ),
            ),
            "runtime_contract": locate_first(
                self.root,
                (
                    "manifests/v3/runtime-contract.json",
                    "runtime/runtime-contract.json",
                    "runtime-contract.json",
                ),
            ),
        }
        self.animation = self._load("animation")
        self.asset = self._load("asset")
        self.static_asset = self._load("static_asset")
        self.palette = self._load("palette")
        self.rigs = self._load("rigs")
        self.lasers = self._load("lasers")
        self.effects = self._load("effects")
        self.qa_config = self._load("qa_config")
        self.visual_contract = self._load("visual_contract")
        self.binding_graph = self._load("binding_graph")
        self.runtime_contract = self._load("runtime_contract")
        if not self.palette and self.visual_contract:
            self.palette = self.visual_contract

        self.clips = normalize_mapping(self.animation.get("clips"), "id")
        self.frames: dict[str, dict[str, Any]] = {}
        for key in ("static_frames", "frames"):
            path = self.manifest_paths.get(key)
            if not path:
                continue
            for frame in read_json(path).get("frames", []):
                if isinstance(frame, dict) and isinstance(frame.get("id"), str):
                    self.frames[frame["id"]] = frame

        self.atlas_specs: dict[str, dict[str, Any]] = {}
        for atlas_id, spec in normalize_mapping(self.animation.get("atlases"), "id").items():
            self.atlas_specs[atlas_id] = dict(spec)
        for manifest in (self.static_asset, self.asset):
            for atlas_id, spec in normalize_mapping(manifest.get("atlases"), "id").items():
                self.atlas_specs.setdefault(atlas_id, dict(spec))
            for atlas_id, spec in normalize_mapping(manifest.get("motionAtlases"), "id").items():
                self.atlas_specs.setdefault(atlas_id, dict(spec))
        for atlas_id, spec in normalize_mapping(self.lasers.get("externalAtlases"), "id").items():
            self.atlas_specs.setdefault(atlas_id, dict(spec))

        self._atlas_paths: dict[str, Optional[Path]] = {}
        self._images: dict[str, Image.Image] = {}

    def _load(self, key: str) -> dict[str, Any]:
        path = self.manifest_paths.get(key)
        return read_json(path) if path else {}

    def atlas_path(self, atlas_id: str) -> Optional[Path]:
        if atlas_id in self._atlas_paths:
            return self._atlas_paths[atlas_id]
        spec = self.atlas_specs.get(atlas_id, {})
        raw = spec.get("image") or spec.get("file")
        path: Optional[Path] = None
        if isinstance(raw, str):
            preferred = [self.root, self.root / "atlases", self.root / "atlases/motion"]
            animation_path = self.manifest_paths.get("animation")
            if animation_path:
                preferred.insert(0, animation_path.parent)
            path = find_named_file(self.root, Path(raw).name, preferred)
            direct = (self.root / raw).resolve()
            if direct.is_file():
                path = direct
        if path is None:
            guesses = [
                atlas_id.replace("_", "-") + ".png",
                atlas_id.replace("_v3", "-v3").replace("_v2", "-v2").replace("_", "-") + ".png",
                atlas_id.replace("_", "-").replace("-v3", "-v3") + ".png",
            ]
            for guess in guesses:
                path = find_named_file(self.root, guess)
                if path:
                    break
        self._atlas_paths[atlas_id] = path
        return path

    def image(self, atlas_id: str) -> Image.Image:
        if atlas_id not in self._images:
            path = self.atlas_path(atlas_id)
            if path is None:
                raise FileNotFoundError(f"no PNG found for atlas {atlas_id!r}")
            self._images[atlas_id] = Image.open(path).convert("RGBA")
        return self._images[atlas_id]

    def frame_record(self, frame_ref: str) -> Optional[dict[str, Any]]:
        if frame_ref in self.frames:
            return self.frames[frame_ref]
        match = re.match(r"^(.+?):(\d+)$", frame_ref)
        if not match:
            match = re.match(r"^(.+)_([0-9]{2,3})$", frame_ref)
        if not match:
            return None
        atlas_id, index_text = match.groups()
        if atlas_id not in self.atlas_specs:
            return None
        spec = self.atlas_specs[atlas_id]
        grid = spec.get("grid")
        cell = spec.get("cell")
        if not (
            isinstance(grid, list)
            and len(grid) == 2
            and isinstance(cell, list)
            and len(cell) == 2
        ):
            return None
        index = int(index_text)
        columns = int(grid[0])
        return {
            "id": frame_ref,
            "atlas": atlas_id,
            "index": index,
            "row": index // columns,
            "column": index % columns,
            "rect": [(index % columns) * int(cell[0]), (index // columns) * int(cell[1]), int(cell[0]), int(cell[1])],
            "pivot": [0.5, 0.5],
        }

    def crop(self, frame_ref: str) -> Image.Image:
        record = self.frame_record(frame_ref)
        if not record:
            raise KeyError(f"unknown frame {frame_ref!r}")
        atlas_id = record.get("atlas")
        rect = record.get("rect")
        if not isinstance(atlas_id, str) or not (isinstance(rect, list) and len(rect) == 4):
            raise ValueError(f"incomplete frame record for {frame_ref!r}")
        x, y, width, height = (int(value) for value in rect)
        return self.image(atlas_id).crop((x, y, x + width, y + height))

    def all_frame_ids(self) -> list[str]:
        if self.frames:
            return sorted(self.frames)
        refs: set[str] = set()
        for clip in self.clips.values():
            for item in clip.get("frames", []):
                ref = item.get("frameId") or item.get("frame") or item.get("id") if isinstance(item, dict) else item
                if isinstance(ref, str):
                    refs.add(ref)
        return sorted(refs)

    def timeline(self, clip_id: str, expand_playback: bool = True) -> list[TimelineFrame]:
        clip = self.clips[clip_id]
        fps = float(clip.get("fps", 12))
        base_ms = max(1, int(round(1000.0 / fps)))
        raw_frames = clip.get("frames", [])
        events_by_frame: dict[int, list[str]] = {}
        for event in clip.get("events", []):
            if not isinstance(event, dict):
                continue
            ordinal = event.get("frame", event.get("frameIndex", event.get("at")))
            name = event.get("name") or event.get("event") or event.get("id")
            if isinstance(ordinal, int) and isinstance(name, str):
                events_by_frame.setdefault(ordinal, []).append(name)
        timeline: list[TimelineFrame] = []
        hold = clip.get("hold", {}) if isinstance(clip.get("hold"), dict) else {}
        hold_frames = hold.get("frames", {}) if isinstance(hold.get("frames"), dict) else {}
        for ordinal, item in enumerate(raw_frames):
            item_events: list[str] = list(events_by_frame.get(ordinal, []))
            if isinstance(item, dict):
                ref = item.get("frameId") or item.get("frame") or item.get("id") or item.get("ref")
                local_events = item.get("events", [])
                if isinstance(local_events, str):
                    item_events.append(local_events)
                elif isinstance(local_events, list):
                    item_events.extend(
                        event if isinstance(event, str) else event.get("name", "")
                        for event in local_events
                        if isinstance(event, (str, dict))
                    )
                if isinstance(item.get("durationMs"), (int, float)):
                    duration = int(round(float(item["durationMs"])))
                else:
                    multiplier = item.get("holdFrames", item.get("hold", 1))
                    duration = int(round(base_ms * float(multiplier))) if isinstance(multiplier, (int, float)) else base_ms
            else:
                ref = item
                duration = base_ms
            if not isinstance(ref, str):
                continue
            extra = hold_frames.get(str(ordinal), hold_frames.get(ref, 0))
            if isinstance(extra, (int, float)):
                duration += int(round(float(extra)))
            if ordinal == len(raw_frames) - 1 and isinstance(hold.get("lastFrameMs"), (int, float)):
                duration += int(round(float(hold["lastFrameMs"])))
            timeline.append(TimelineFrame(ref, max(1, duration), tuple(x for x in item_events if x), ordinal))
        if expand_playback and clip.get("loop") and clip.get("loopMode") == "pingPong" and len(timeline) > 2:
            timeline.extend(
                TimelineFrame(item.ref, item.duration_ms, item.events, item.source_ordinal)
                for item in reversed(timeline[1:-1])
            )
        return timeline

    def background_paths(self) -> list[Path]:
        paths: list[Path] = []
        for manifest in (self.static_asset, self.asset):
            backgrounds = manifest.get("backgrounds", [])
            if isinstance(backgrounds, dict):
                backgrounds = list(backgrounds.values())
            if isinstance(backgrounds, list):
                for item in backgrounds:
                    if isinstance(item, str):
                        raw = item
                    elif isinstance(item, dict):
                        raw = item.get("image") or item.get("file")
                    else:
                        raw = None
                    if isinstance(raw, str):
                        direct = (self.root / raw).resolve()
                        if direct.is_file():
                            paths.append(direct)
        if not paths:
            for folder in (self.root / "backgrounds/original", self.root / "backgrounds"):
                if folder.is_dir():
                    paths.extend(sorted(folder.glob("*.png")))
                    if paths:
                        break
        return list(dict.fromkeys(path.resolve() for path in paths))


def tight_crop(image: Image.Image, padding: int = 1) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        return image.copy()
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(image.width, bbox[2] + padding)
    bottom = min(image.height, bbox[3] + padding)
    return image.crop((left, top, right, bottom))


def frame_hash(image: Image.Image, normalize_bbox: bool = False) -> str:
    source = tight_crop(image, 0) if normalize_bbox else image
    payload = source.size[0].to_bytes(4, "big") + source.size[1].to_bytes(4, "big") + source.tobytes()
    return hashlib.sha256(payload).hexdigest()


def fit_nearest(image: Image.Image, maximum: tuple[int, int], allow_upscale: bool = True) -> Image.Image:
    ratio = min(maximum[0] / image.width, maximum[1] / image.height)
    if not allow_upscale:
        ratio = min(1.0, ratio)
    # Pixel art stays crisp when the useful scale can be integral.
    if ratio >= 1:
        ratio = max(1, math.floor(ratio))
    size = (max(1, int(round(image.width * ratio))), max(1, int(round(image.height * ratio))))
    return image.resize(size, Image.Resampling.NEAREST)


def alpha_composite_at(canvas: Image.Image, sprite: Image.Image, center: tuple[float, float]) -> None:
    position = (int(round(center[0] - sprite.width / 2)), int(round(center[1] - sprite.height / 2)))
    canvas.alpha_composite(sprite, position)


def render_timeline_frame(
    sprite: Image.Image,
    label: str,
    events: tuple[str, ...],
    size: tuple[int, int] = (288, 288),
) -> Image.Image:
    canvas = Image.new("RGBA", size, (8, 9, 13, 255))
    draw = ImageDraw.Draw(canvas)
    # A sparse 8 px grid reveals pivot jitter without overwhelming the art.
    for x in range(0, size[0], 16):
        draw.line((x, 0, x, size[1] - 28), fill=(28, 31, 38, 255))
    for y in range(0, size[1] - 28, 16):
        draw.line((0, y, size[0], y), fill=(28, 31, 38, 255))
    draw.line((size[0] // 2 - 4, size[1] // 2 - 14, size[0] // 2 + 4, size[1] // 2 - 14), fill=(240, 42, 146, 255))
    draw.line((size[0] // 2, size[1] // 2 - 18, size[0] // 2, size[1] // 2 - 10), fill=(240, 42, 146, 255))
    placed = fit_nearest(sprite, (size[0] - 24, size[1] - 52))
    alpha_composite_at(canvas, placed, (size[0] / 2, (size[1] - 28) / 2))
    draw.rectangle((0, size[1] - 28, size[0], size[1]), fill=(8, 9, 13, 255))
    event_text = " · ".join(events) if events else "—"
    draw.text((6, size[1] - 25), label[:36], fill=(239, 233, 218, 255), font=ImageFont.load_default())
    draw.text((6, size[1] - 13), event_text[:42], fill=(23, 167, 202, 255), font=ImageFont.load_default())
    return canvas


def save_animation(frames: list[Image.Image], durations: list[int], path: Path, kind: str) -> None:
    if not frames:
        raise ValueError("cannot save empty animation")
    path = safe_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    durations = [max(20, int(value)) for value in durations]
    if kind == "gif":
        frames[0].save(
            path,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            disposal=2,
            optimize=False,
        )
    elif kind == "apng":
        frames[0].save(
            path,
            format="PNG",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            disposal=2,
            blend=0,
        )
    else:
        raise ValueError(f"unknown animation kind {kind!r}")


def write_json(path: Path, value: Any) -> None:
    path = safe_output_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def srgb_luminance(rgb: tuple[int, int, int]) -> float:
    components = []
    for byte in rgb:
        value = byte / 255.0
        components.append(value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2]


def contrast_ratio(a: float, b: float) -> float:
    bright, dark = max(a, b), min(a, b)
    return (bright + 0.05) / (dark + 0.05)
