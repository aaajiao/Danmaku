#!/usr/bin/env python3
"""Generate deterministic, license-free procedural audio for the 1bit V4 kit.

The files are intentionally dry and sparse. They are signals and material traces,
not a cinematic soundtrack. Only Python's standard library is required.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 48_000
V4_ROOT = Path(__file__).resolve().parent.parent
AUDIO_ROOT = V4_ROOT / "audio"
ASSET_ROOT = AUDIO_ROOT / "assets"
MANIFEST_PATH = V4_ROOT / "manifests" / "narrative" / "audio-manifest-v4.json"


def clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 0.0
    x = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return x * x * (3.0 - 2.0 * x)


def decay(t: float, rate: float) -> float:
    return math.exp(-max(0.0, t) * rate)


def sine(freq: float, t: float, phase: float = 0.0) -> float:
    return math.sin(math.tau * freq * t + phase)


def square(freq: float, t: float, duty: float = 0.5) -> float:
    return 1.0 if (t * freq) % 1.0 < duty else -1.0


def chirp(f0: float, f1: float, duration: float, t: float, phase: float = 0.0) -> float:
    k = (f1 - f0) / max(duration, 1e-6)
    return math.sin(math.tau * (f0 * t + 0.5 * k * t * t) + phase)


def periodic_grain(t: float, duration: float, seed: int, partials: int = 12) -> float:
    """Periodic noise-like signal whose loop boundary is phase-continuous."""
    rng = random.Random(seed)
    value = 0.0
    weight = 0.0
    for _ in range(partials):
        cycles = rng.randint(24, 2800)
        amp = 1.0 / math.sqrt(cycles)
        value += amp * sine(cycles / duration, t, rng.random() * math.tau)
        weight += amp
    return value / max(weight, 1e-6)


def write_wav(path: Path, seconds: float, channels: int, render) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(round(seconds * SAMPLE_RATE))
    payload = bytearray()
    peak = 0.0
    sum_sq = 0.0
    for i in range(frames):
        t = i / SAMPLE_RATE
        values = render(t, i, frames)
        if channels == 1:
            values = (values,) if isinstance(values, (int, float)) else values
        for value in values:
            sample = clamp(float(value) * 0.92)
            peak = max(peak, abs(sample))
            sum_sq += sample * sample
            payload.extend(struct.pack("<h", int(round(sample * 32767))))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(payload)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    rms = math.sqrt(sum_sq / max(1, frames * channels))
    return {
        "durationMs": round(frames * 1000 / SAMPLE_RATE),
        "sampleRate": SAMPLE_RATE,
        "channels": channels,
        "bitDepth": 16,
        "peak": round(peak, 6),
        "rms": round(rms, 6),
        "sha256": digest,
        "bytes": path.stat().st_size,
    }


ROOM_SPECS = {
    "INFORMATION": {
        "id": "room.information.bed",
        "file": "audio/assets/rooms/information-bed.wav",
        "description": "Unanswered packets: 60 Hz body, asynchronous chirp slots and periodic granular omissions.",
        "behaviorParameters": ["flowerIntensity -> chirp send", "gazePressure -> high partial removal"],
    },
    "FORCED_ALIGNMENT": {
        "id": "room.forced_alignment.bed",
        "file": "audio/assets/rooms/forced-alignment-bed.wav",
        "description": "Two spatial claims with a 20 Hz difference and no resolved center.",
        "behaviorParameters": ["xNorm -> claim gain", "seamDistance -> interference depth"],
    },
    "IN_BETWEEN": {
        "id": "room.in_between.bed",
        "file": "audio/assets/rooms/in-between-bed.wav",
        "description": "Two incompatible clocks share the output without phase-locking.",
        "behaviorParameters": ["claimA -> left clock", "claimB -> right clock", "intersection -> shared fifth"],
    },
    "POLARIZED": {
        "id": "room.polarized.bed",
        "file": "audio/assets/rooms/polarized-bed.wav",
        "description": "Dry 440/880 binary clock with no reverb and exact on/off edges.",
        "behaviorParameters": ["gazePressure -> clock density", "noDusk -> phase inversion without fade"],
    },
}


def render_room(room: str, duration: float):
    def information(t: float, _i: int, _n: int):
        base = 0.12 * sine(60, t) + 0.035 * sine(120, t, 0.2)
        grain_l = periodic_grain(t, duration, 101) * 0.16
        grain_r = periodic_grain(t, duration, 102) * 0.16
        slot = t % 3.0
        ping_env = math.sin(math.pi * min(1.0, slot / 0.09)) ** 2 * decay(slot, 14) if slot < 0.5 else 0.0
        ping_l = ping_env * chirp(2200, 5100, 0.5, slot) * 0.14
        delayed = (t - 0.37) % 3.0
        ping_r = (decay(delayed, 17) * chirp(3400, 1800, 0.45, delayed) * 0.11) if delayed < 0.45 else 0.0
        return base + grain_l + ping_l, base + grain_r + ping_r

    def forced(t: float, _i: int, _n: int):
        ledger = 0.02 * square(2.0, t, 0.04)
        left = 0.13 * sine(330, t) + 0.055 * sine(550, t, 0.1) + ledger
        right = 0.13 * sine(350, t) + 0.055 * sine(570, t, 0.1) - ledger
        pulse = (0.5 + 0.5 * sine(20, t)) * 0.025
        return left + pulse, right - pulse

    def between(t: float, _i: int, _n: int):
        clock_a = 0.11 * sine(50, t) + 0.05 * sine(75, t)
        clock_b = 0.09 * sine(70.5, t, 0.8) + 0.045 * sine(105.75, t, 0.8)
        intersection = 0.035 * sine(100, t) * (0.5 + 0.5 * sine(0.5, t))
        misread = periodic_grain(t, duration, 303, 6) * 0.08
        return clock_a + clock_b * 0.55 + intersection, clock_b + clock_a * 0.45 - intersection + misread

    def polarized(t: float, _i: int, _n: int):
        beat = t % 0.5
        on = 1.0 if beat < 0.055 else 0.0
        which = int(t / 0.5) % 2
        f = 440 if which == 0 else 880
        click = on * sine(f, t) * decay(beat, 34) * 0.2
        dry_clock = 0.025 * square(2.0, t, 0.08)
        return click + dry_clock, click - dry_clock

    return {"INFORMATION": information, "FORCED_ALIGNMENT": forced, "IN_BETWEEN": between, "POLARIZED": polarized}[room]


BOSS_SPECS = {
    "absent_receiver": "Three calls; the expected acknowledgement slot remains empty.",
    "unanswering_feed": "A packet train accelerates and stops without a return channel.",
    "one_sun_one_rule": "One dry fundamental imposes a ruler of aligned harmonics.",
    "two_claims": "Left and right claims overlap without merging.",
    "misreader": "A read chirp is answered by the wrong interval.",
    "misregistered_twin_moons": "Two nearly matching cycles drift across the stereo field.",
    "no_dusk": "A binary clock cuts the image while its low descent continues.",
    "absolute_reader": "A scanning ledger rises around a deliberately blank interval.",
}


def render_boss(boss_id: str, duration: float):
    def render(t: float, _i: int, _n: int):
        fade = smoothstep(0, 0.015, t) * (1.0 - smoothstep(duration - 0.05, duration, t))
        if boss_id == "absent_receiver":
            value = 0.0
            for at in (0.12, 0.52, 0.92):
                dt = t - at
                if 0 <= dt < 0.25:
                    value += chirp(880, 1320, 0.25, dt) * decay(dt, 12) * 0.22
            return value * fade, value * fade
        if boss_id == "unanswering_feed":
            value = 0.0
            for k in range(10):
                at = 0.08 + k * (0.12 - k * 0.004)
                dt = t - at
                if 0 <= dt < 0.08:
                    value += sine(1600 + k * 130, dt) * decay(dt, 44) * 0.12
            return value * fade, value * fade * 0.86
        if boss_id == "one_sun_one_rule":
            env = smoothstep(0, 0.03, t) * (1 - smoothstep(1.35, duration, t))
            value = (0.16 * sine(110, t) + 0.08 * sine(220, t) + 0.04 * sine(440, t)) * env
            tick = 0.08 * square(8, t, 0.025)
            return (value + tick) * fade, (value + tick) * fade
        if boss_id == "two_claims":
            left = 0.18 * sine(294, t) + 0.06 * sine(441, t)
            right = 0.18 * sine(311, t, 0.4) + 0.06 * sine(466.5, t, 0.4)
            return left * fade, right * fade
        if boss_id == "misreader":
            read = chirp(700, 2600, duration, t) * 0.14
            response_t = max(0, t - 0.35)
            wrong = sine(933, response_t) * decay(response_t, 2.2) * 0.14 if t > 0.35 else 0.0
            return (read + wrong) * fade, (read - wrong * 0.7) * fade
        if boss_id == "misregistered_twin_moons":
            env = 0.45 + 0.55 * sine(1.0, t) ** 2
            return 0.16 * sine(220, t) * env * fade, 0.16 * sine(223.5, t, 0.3) * env * fade
        if boss_id == "no_dusk":
            gate = 1.0 if int(t / 0.18) % 2 == 0 else 0.0
            binary = gate * sine(440 if gate else 880, t) * 0.12
            descent = chirp(96, 48, duration, t) * 0.14
            return (binary + descent) * fade, (binary + descent) * fade
        blank = 0.72 <= t <= 0.96
        scan = 0.0 if blank else chirp(240, 4200, duration, t) * 0.12
        ledger = 0.05 * square(12, t, 0.035)
        return (scan + ledger) * fade, (scan - ledger) * fade

    return render


SFX_SPECS = {
    "flower_breathe": (0.72, "tone", 180, 220, 0.02, "Quiet flower breath."),
    "flower_resonance": (0.82, "double", 220, 330, 0.01, "Middle-band mutual resonance."),
    "flower_exposure": (0.55, "rise", 330, 920, 0.02, "Bright flower becomes legible to infrastructure."),
    "gaze_acquire": (0.24, "double", 420, 680, 0.0, "Eye acquires a read."),
    "flower_clamp": (0.42, "fall", 620, 110, 0.03, "Forced dimming, distinct from voluntary focus."),
    "gaze_hold_pulse": (0.16, "pulse", 96, 96, 0.0, "Sparse held-read pulse."),
    "gaze_release": (0.28, "fall", 480, 240, 0.0, "Clamp releases before flower recovers."),
    "flower_recover": (0.64, "rise", 150, 280, 0.0, "Delayed flower recovery."),
    "graze_evidence": (0.13, "notch", 1800, 1150, 0.0, "One unique near-miss fact."),
    "evidence_ready": (0.34, "double", 660, 990, 0.0, "Enough evidence exists for a local void."),
    "override_charge": (1.0, "rise", 80, 2400, 0.08, "Directional local-void charge."),
    "override_tear": (0.38, "tear", 400, 3600, 0.45, "Local rule tear; band-limited, not full-band shock."),
    "override_void_decay": (0.72, "fall", 1800, 70, 0.09, "Digital exception closes."),
    "scar_write": (0.42, "material", 520, 180, 0.15, "Material scar is written at real coordinates."),
    "projectile_arm": (0.10, "pulse", 920, 920, 0.0, "Projectile collision becomes authoritative."),
    "projectile_cancel": (0.22, "fall", 1600, 240, 0.05, "Digital projectile deletion."),
    "projectile_impact": (0.16, "material", 420, 130, 0.12, "Contact-normal material notch."),
    "player_damage": (0.34, "material", 280, 70, 0.22, "Body-scale fiber tear."),
    "player_collapse": (0.92, "fall", 420, 34, 0.18, "Digital self deletion and material trace."),
    "player_return": (0.58, "rise", 72, 240, 0.02, "Input returns after memory settles."),
    "protocol_withdraw": (0.88, "fall", 880, 55, 0.05, "Protocol withdraws without victory fanfare."),
    "room_threshold": (0.28, "notch", 560, 420, 0.0, "Mental-state threshold commit."),
    "cable_upload": (0.62, "steps", 700, 2600, 0.02, "Packets move from player toward Eye."),
    "cable_burnin": (0.54, "material", 760, 95, 0.16, "Cable heat mark remains."),
    "burnin_capture": (0.30, "notch", 3100, 900, 0.08, "Sustained look captured as hard dots."),
    "ghost_replay": (0.68, "route", 160, 560, 0.02, "Actual previous route begins replay."),
    "ghost_burnout": (0.74, "fall", 720, 42, 0.1, "Route extinguishes oldest first."),
    "witness_turn": (0.42, "material", 140, 110, 0.04, "A witness turns toward a recorded fact."),
    "snapshot_collect": (0.86, "steps", 120, 960, 0.02, "Fact channels assemble a fingerprint."),
    "snapshot_handoff": (0.72, "fall", 960, 84, 0.03, "Fingerprint reduces to a next-run seed."),
    "no_dusk_cut": (0.92, "binary", 440, 880, 0.01, "Image cuts in two states while low descent continues."),
    "weather_static": (1.20, "tear", 1800, 4200, 0.12, "Static omen and dropout grain."),
    "weather_rain": (1.20, "steps", 900, 1700, 0.05, "Dry world-space rain impulses."),
    "weather_ash": (1.20, "grain", 120, 420, 0.18, "Low granular ash deposition."),
    "weather_wind": (1.20, "grain", 360, 1800, 0.14, "Two asynchronous wind bands."),
    "weather_eclipse": (1.50, "fall", 220, 65, 0.04, "Continuous eclipse descent."),
}


def render_sfx(name: str, spec: tuple):
    duration, profile, f0, f1, noise_amount, _description = spec
    seed = int(hashlib.sha256(name.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    phases = [rng.random() * math.tau for _ in range(8)]

    def noise_like(t: float) -> float:
        value = 0.0
        for index, phase in enumerate(phases):
            freq = 80 + ((seed >> (index * 3)) & 1023)
            value += sine(freq, t, phase) / (index + 2)
        return value / 1.8

    def render(t: float, _i: int, _n: int):
        attack = smoothstep(0, min(0.02, duration * 0.12), t)
        release = 1.0 - smoothstep(duration * 0.68, duration, t)
        env = attack * release
        if profile == "tone":
            core = sine(f0, t) * (0.65 + 0.35 * sine(1.4, t))
        elif profile == "double":
            core = sine(f0, t) * 0.62 + sine(f1, t, 0.3) * 0.38
        elif profile == "rise":
            core = chirp(f0, f1, duration, t)
        elif profile == "fall":
            core = chirp(f0, f1, duration, t)
        elif profile == "pulse":
            core = sine(f0, t) * decay(t, 18)
        elif profile == "notch":
            core = chirp(f0, f1, duration, t) * (1.0 if (t / duration < 0.42 or t / duration > 0.56) else 0.0)
        elif profile == "tear":
            core = chirp(f0, f1, duration, t) * 0.45 + noise_like(t) * 0.55
        elif profile == "material":
            core = sine(f0, t) * decay(t, 9) + noise_like(t) * decay(t, 5) * 0.55
        elif profile == "steps":
            step = int(t / max(0.04, duration / 8))
            freq = f0 + (f1 - f0) * min(1.0, step / 7)
            local = t % max(0.04, duration / 8)
            core = sine(freq, t) * decay(local, 25)
        elif profile == "route":
            core = sine(f0 + (f1 - f0) * (t / duration), t) * (0.65 + 0.35 * square(7, t, 0.6))
        elif profile == "binary":
            core = sine(f0 if int(t / 0.16) % 2 == 0 else f1, t) * (1 if int(t / 0.08) % 2 == 0 else 0)
            core += 0.5 * chirp(84, 42, duration, t)
        elif profile == "grain":
            core = noise_like(t) * 0.8 + chirp(f0, f1, duration, t) * 0.2
        else:
            raise ValueError(profile)
        core = (core * (1 - noise_amount) + noise_like(t) * noise_amount) * env * 0.34
        offset = 0.0007 + (seed % 7) * 0.00011
        right = core * 0.92 + sine(max(30, f0 * 0.5), t + offset) * env * 0.018
        return core, right

    return duration, render


def main() -> None:
    assets = []
    room_duration = 12.0
    for room, spec in ROOM_SPECS.items():
        relative = Path(spec["file"]).relative_to("audio")
        path = AUDIO_ROOT / relative
        metadata = write_wav(path, room_duration, 2, render_room(room, room_duration))
        assets.append({
            "id": spec["id"], "category": "room-bed", "room": room,
            "path": spec["file"], "loop": True, "loopCrossfadeMs": 0,
            "description": spec["description"], "behaviorParameters": spec["behaviorParameters"],
            **metadata,
        })

    boss_duration = 1.8
    for boss_id, description in BOSS_SPECS.items():
        file_name = boss_id.replace("_", "-") + "-signal.wav"
        path = ASSET_ROOT / "bosses" / file_name
        metadata = write_wav(path, boss_duration, 2, render_boss(boss_id, boss_duration))
        assets.append({
            "id": f"boss.{boss_id}.signal", "category": "boss-signal", "bossId": boss_id,
            "path": f"audio/assets/bosses/{file_name}", "loop": False,
            "description": description, **metadata,
        })

    for name, spec in SFX_SPECS.items():
        duration, render = render_sfx(name, spec)
        path = ASSET_ROOT / "sfx" / f"{name.replace('_', '-')}.wav"
        metadata = write_wav(path, duration, 2, render)
        assets.append({
            "id": f"sfx.{name}", "category": "sfx",
            "path": f"audio/assets/sfx/{path.name}", "loop": False,
            "description": spec[-1], **metadata,
        })

    manifest = {
        "schemaVersion": "4.0.0-audio",
        "generator": "audio/generate_audio_v4.py",
        "license": "Project-authored procedural audio; no external samples.",
        "format": {"container": "WAV", "encoding": "PCM", "sampleRate": SAMPLE_RATE, "bitDepth": 16},
        "mixContract": {
            "headroomDb": -6,
            "roomCrossfadeMs": 500,
            "gazeLowPassHz": {"open": 20000, "clamped": 400},
            "buses": ["room", "boss", "events", "weather", "ui"],
            "rule": "Audio is feedback. It cannot gate gameplay or determine event completion."
        },
        "accessibility": {
            "disableBinaural": "Downmix claims to mono and retain a <=8% amplitude beat.",
            "audioDescriptions": "Critical cues expose localized state text through UI copy.",
            "independentGains": ["master", "room", "boss", "events", "weather", "ui"]
        },
        "assets": assets,
    }
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(assets)} assets -> {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
