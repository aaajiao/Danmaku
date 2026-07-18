#!/usr/bin/env python3
"""Render V4 UI mockups and a machine-readable screen manifest."""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[4]
V4 = ROOT / "work" / "v4"
OUT = V4 / "ui" / "mockups"
REPORTS = V4 / "ui" / "reports"
MANIFESTS = V4 / "manifests" / "ui"
FONT_PATH = (
    ROOT
    / "outputs/01-final-delivery/1bit-stg-complete-asset-kit-v3/fonts/NotoSansSC-Variable.ttf"
)

W, H = 360, 640
INK = "#08090D"
PAPER = "#EFE9DA"
GRAY = "#7D8087"
CYAN = "#17A7CA"
AMBER = "#D6982B"
VIOLET = "#7851B7"
RED = "#B7463C"
MAGENTA = "#F02A92"
PALETTE = [INK, PAPER, GRAY, CYAN, AMBER, VIOLET, RED, MAGENTA]


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size=size)


F8, F9, F10, F12, F16, F22 = (font(n) for n in (8, 9, 10, 12, 16, 22))


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W, H), INK)
    return im, ImageDraw.Draw(im)


def text(d: ImageDraw.ImageDraw, xy, value: str, fill=PAPER, f=F9, anchor=None):
    d.text(xy, value, fill=fill, font=f, anchor=anchor)


def rule(d: ImageDraw.ImageDraw, y: int, color=GRAY, x0=12, x1=348, width=1):
    d.line((x0, y, x1, y), fill=color, width=width)


def header(d: ImageDraw.ImageDraw, code: str, title: str, accent=CYAN):
    d.rectangle((12, 10, 17, 15), fill=accent)
    text(d, (22, 8), code, accent, F8)
    text(d, (12, 28), title, PAPER, F16)
    rule(d, 50, accent)


def footer(d: ImageDraw.ImageDraw, left: str, right: str, accent=CYAN):
    rule(d, 622, accent)
    text(d, (12, 626), left, GRAY, F8)
    text(d, (348, 626), right, accent, F8, "ra")


def pixel_cross(d: ImageDraw.ImageDraw, cx: int, cy: int, c=PAPER, scale=2):
    pts = [(0, -3), (-1, -2), (1, -2), (-2, -1), (2, -1), (-3, 0), (3, 0), (-2, 1), (2, 1), (-1, 2), (1, 2), (0, 3)]
    for x, y in pts:
        d.rectangle((cx + x * scale, cy + y * scale, cx + x * scale + scale - 1, cy + y * scale + scale - 1), fill=c)


def flower(d: ImageDraw.ImageDraw, cx: int, cy: int, level=5, accent=CYAN):
    for i in range(8):
        a = i * math.pi / 4
        x = round(cx + math.cos(a) * 8)
        y = round(cy + math.sin(a) * 8)
        c = accent if i < level else GRAY
        d.rectangle((x - 2, y - 2, x + 2, y + 2), fill=c)
    d.rectangle((cx - 2, cy - 2, cx + 2, cy + 2), fill=PAPER)


def fingerprint(d: ImageDraw.ImageDraw, box, seed=0, accent=CYAN, scars=True):
    x0, y0, x1, y1 = box
    d.rectangle(box, outline=GRAY)
    for y in range(y0 + 5, y1 - 3, 5):
        for x in range(x0 + 5, x1 - 3, 5):
            v = (x * 17 + y * 31 + seed * 43) % 19
            if v < 8:
                d.rectangle((x, y, x + 2, y + 1), fill=accent if v < 3 else GRAY)
    if scars:
        d.line((x0 + 28, y0 + 74, x0 + 76, y0 + 52, x0 + 122, y0 + 86), fill=MAGENTA, width=2)
        d.rectangle((x0 + 75, y0 + 50, x0 + 78, y0 + 54), fill=PAPER)


def bullet_field(d: ImageDraw.ImageDraw, room=CYAN, boss=False):
    for i in range(76 if boss else 52):
        a = i * 0.72 + (0.2 if boss else 0)
        r = 24 + (i % 13) * 10
        cx, cy = (180, 230 if boss else 270)
        x = int(cx + math.cos(a) * r * (1.25 if boss else 1))
        y = int(cy + math.sin(a) * r * 0.78)
        if 16 < x < 344 and 112 < y < 560:
            col = room if i % 5 == 0 else PAPER
            d.rectangle((x, y, x + (2 if i % 7 else 5), y + 1), fill=col)
    pixel_cross(d, 180, 510, CYAN, 1)


def gameplay_hud() -> Image.Image:
    im, d = canvas()
    text(d, (12, 9), "FLOWER / 花", CYAN, F8)
    flower(d, 66, 30, 6, CYAN)
    for i in range(8):
        d.rectangle((86 + i * 7, 25, 90 + i * 7, 31), fill=CYAN if i < 6 else GRAY)
    text(d, (308, 9), "READ", PAPER, F8)
    d.rectangle((338, 24, 342, 91), outline=GRAY)
    d.rectangle((339, 47, 341, 90), fill=AMBER)
    for y in (152, 238, 328, 412):
        d.line((24, y, 336, y + (y % 3) * 3), fill="#25272D")
    bullet_field(d, CYAN)
    d.rectangle((154, 197, 205, 233), outline=GRAY)
    d.rectangle((164, 207, 195, 224), outline=CYAN)
    d.line((180, 184, 180, 246), fill=GRAY)
    text(d, (12, 575), "精神状态 / INFORMATION", CYAN, F8)
    text(d, (12, 590), "刷新遗漏 · 静电预兆", GRAY, F8)
    text(d, (272, 575), "证据  014", PAPER, F8)
    text(d, (272, 590), "留痕  003", VIOLET, F8)
    d.rectangle((150, 605, 260, 609), fill=GRAY)
    d.rectangle((150, 605, 206, 609), fill=CYAN)
    footer(d, "V4 HUD · NO SCORE", "WEATHER / OMEN")
    return im


def boss_hud() -> Image.Image:
    im, d = canvas()
    text(d, (18, 14), "PROTOCOL 06 / CENSOR BODY", AMBER, F8)
    text(d, (18, 32), "删节体 · 正在读取", PAPER, F12)
    d.rectangle((18, 57, 342, 62), fill=GRAY)
    d.rectangle((18, 57, 211, 62), fill=AMBER)
    text(d, (18, 68), "区间剩余：结构尚未闭合", GRAY, F8)
    text(d, (18, 83), "读数：视线越界 2 / 4", CYAN, F8)
    d.rectangle((18, 98, 342, 122), outline=AMBER)
    text(d, (24, 104), "已发现：让四条删节线同时看见彼此", PAPER, F8)
    bullet_field(d, AMBER, True)
    for i, (x, y) in enumerate(((132, 220), (228, 220), (132, 314), (228, 314))):
        d.rectangle((x - 11, y - 11, x + 11, y + 11), outline=AMBER if i < 3 else GRAY)
        d.line((180, 266, x, y), fill=AMBER if i < 3 else GRAY)
    footer(d, "PHASE 2 · ADAPT", "PROTOCOL ≠ LIFE", AMBER)
    return im


def discovery() -> Image.Image:
    im, d = canvas()
    header(d, "DISCOVERY / 03", "遇见之后，界面才说话", CYAN)
    cards = [
        (82, "01", "花未发出信号", "60 秒后才出现： [发出信号]", CYAN),
        (194, "02", "眼先画出一像素地平线", "跨过之后：读取压力被命名", AMBER),
        (306, "03", "局部规则出现缺口", "此时才出现： [按住，使此处规则缺席]", MAGENTA),
        (418, "04", "快照先给出一句观察", "展开后才显示它来自哪些事实", VIOLET),
    ]
    for y, n, a, b, c in cards:
        d.rectangle((18, y, 342, y + 88), outline=c)
        text(d, (28, y + 10), n, c, F12)
        text(d, (58, y + 11), a, PAPER, F10)
        d.line((58, y + 34, 318, y + 34), fill=GRAY)
        text(d, (58, y + 46), b, GRAY, F8)
        d.rectangle((28, y + 67, 34, y + 73), fill=c)
    text(d, (18, 548), "不展示完整因果图；不提前剧透 Boss 解法。", RED, F8)
    footer(d, "CONTEXTUAL · AFTER ENCOUNTER", "NO FRONT-LOADED MAP")
    return im


def snapshot() -> Image.Image:
    im, d = canvas()
    header(d, "SNAPSHOT / 4E8A", "状态快照", VIOLET)
    fingerprint(d, (18, 70, 342, 226), 7, CYAN)
    text(d, (18, 238), "观察 / OBSERVATIONS", VIOLET, F8)
    text(d, (18, 254), "你让读取停留，却没有让身体停下。", PAPER, F10)
    text(d, (18, 274), "黄昏没有出现；声音替它完成了下降。", PAPER, F10)
    text(d, (18, 294), "上一条真实路径在这里经过一次。", PAPER, F10)
    rule(d, 322, VIOLET, 18, 342)
    text(d, (18, 334), "可追溯事实", VIOLET, F8)
    traces = ["gaze.holdMs = 1420", "weather.eclipse.phase = AFTERMATH", "ghostReplay.completed = true"]
    for i, t in enumerate(traces):
        text(d, (28, 354 + i * 17), "└ " + t, GRAY, F8)
    text(d, (18, 420), "下一局仍在场的材料", AMBER, F8)
    groups = [("覆写伤痕", "02", MAGENTA), ("死亡轨迹", "01", RED), ("屏幕灼痕", "03", AMBER), ("幽灵残留", "01", VIOLET)]
    for i, (label, count, c) in enumerate(groups):
        x = 18 + (i % 2) * 164
        y = 442 + (i // 2) * 38
        d.rectangle((x, y, x + 150, y + 28), outline=c)
        text(d, (x + 8, y + 8), label, PAPER, F8)
        text(d, (x + 138, y + 8), count, c, F8, "ra")
    text(d, (18, 532), "结论：读取留下了一个未分类区间", PAPER, F10)
    d.rectangle((18, 562, 226, 590), outline=CYAN)
    text(d, (28, 570), "带着这些材料继续", CYAN, F9)
    text(d, (252, 570), "导出 PNG", GRAY, F8)
    footer(d, "NO RANK · NO MORAL LABEL", "FACTS, NOT SCORE", VIOLET)
    return im


def cross_run() -> Image.Image:
    im, d = canvas()
    header(d, "CROSS-RUN / 1140ms+", "同一条时间线，不同的可见性", MAGENTA)
    d.rectangle((18, 72, 342, 246), outline=GRAY)
    fingerprint(d, (28, 82, 332, 236), 2, VIOLET, False)
    route = [(38, 211), (82, 176), (126, 192), (171, 132), (214, 153), (266, 105), (321, 121)]
    d.line(route, fill=VIOLET, width=2)
    for x, y in route:
        d.rectangle((x - 2, y - 2, x + 2, y + 2), fill=PAPER)
    d.line((88, 92, 136, 130, 167, 108), fill=MAGENTA, width=2)
    text(d, (24, 252), "真实路径只重放一次；之后只留下材料。", PAPER, F9)
    events = [
        (0, "伤痕 / 死亡轨迹 / 灼痕 回填", MAGENTA),
        (420, "上一局幽灵开始", VIOLET),
        (720, "幽灵结束，写入残留", VIOLET),
        (999, "见证者转身", AMBER),
        (1140, "输入归还", CYAN),
    ]
    y0 = 304
    d.line((58, y0, 58, 493), fill=GRAY)
    for i, (t, label, c) in enumerate(events):
        y = y0 + i * 43
        d.rectangle((54, y, 62, y + 8), fill=c)
        text(d, (18, y - 1), str(t), c, F8, "ra")
        text(d, (76, y - 2), label, PAPER, F9)
    text(d, (18, 526), "FULL / REDUCED MOTION / FLASH-OFF", GRAY, F8)
    d.rectangle((18, 545, 342, 565), outline=CYAN)
    text(d, (28, 551), "事件时刻完全相同；仅替换呈现方式", CYAN, F8)
    footer(d, "AUTHORITATIVE GAMEPLAY CLOCK", "RETURN INPUT", MAGENTA)
    return im


def accessibility() -> Image.Image:
    im, d = canvas()
    header(d, "ACCESS / 216", "可见性改变，因果不改变", CYAN)
    rows = [
        ("运动", "完整 / 减弱", VIOLET),
        ("闪烁", "完整 / FLASH-OFF", AMBER),
        ("对比", "标准 / 高对比", CYAN),
        ("色彩", "颜色+形状 / 形状优先", RED),
        ("声音描述", "关闭 / 开启", CYAN),
        ("触觉", "关闭 / 低 / 标准", MAGENTA),
    ]
    for i, (label, choices, c) in enumerate(rows):
        y = 82 + i * 65
        text(d, (18, y), label, PAPER, F10)
        text(d, (342, y), choices, c, F8, "ra")
        d.rectangle((18, y + 24, 342, y + 29), fill=GRAY)
        d.rectangle((18, y + 24, 238 - i * 9, y + 29), fill=c)
        d.rectangle((328, y + 20, 342, y + 33), outline=PAPER)
    d.rectangle((18, 494, 342, 548), outline=AMBER)
    text(d, (28, 505), "硬规则", AMBER, F9)
    text(d, (28, 524), "碰撞窗、警示提前量、跨局事件顺序不可变化。", PAPER, F8)
    text(d, (18, 568), "216 种组合已通过同一事件轨迹验证", CYAN, F9)
    footer(d, "A11Y IS PRESENTATION", "GAMEPLAY IS INVARIANT")
    return im


def continue_screen() -> Image.Image:
    im, d = canvas()
    header(d, "CONTINUE / MEMORY", "继续不是清零", AMBER)
    fingerprint(d, (24, 76, 336, 250), 4, AMBER)
    text(d, (24, 268), "继续会带回：", PAPER, F10)
    items = [("覆写伤痕", MAGENTA), ("死亡轨迹", RED), ("屏幕灼痕", AMBER), ("上一条真实路径", VIOLET), ("见证者的记忆", CYAN)]
    for i, (label, c) in enumerate(items):
        y = 296 + i * 31
        d.rectangle((26, y + 3, 32, y + 9), fill=c)
        text(d, (44, y), label, PAPER, F9)
    d.rectangle((24, 480, 336, 514), outline=AMBER)
    text(d, (36, 490), "带着这些材料继续", AMBER, F10)
    d.rectangle((24, 526, 336, 560), outline=GRAY)
    text(d, (36, 536), "从没有留痕的条件开始", GRAY, F10)
    footer(d, "CHOICE CHANGES CONDITIONS", "NOT DIFFICULTY", AMBER)
    return im


def interruption() -> Image.Image:
    im, d = canvas()
    header(d, "ROUTE / INTERRUPTED", "这一路在这里中断", RED)
    fingerprint(d, (28, 84, 332, 296), 9, RED)
    d.line((74, 245, 126, 204, 179, 222, 235, 167, 286, 188), fill=PAPER, width=2)
    d.rectangle((282, 184, 290, 192), fill=RED)
    text(d, (28, 316), "中断事实", RED, F8)
    text(d, (28, 338), "身体在读取区间关闭前停下。", PAPER, F10)
    text(d, (28, 372), "死亡轨迹已写入；它不是惩罚计数。", GRAY, F9)
    d.rectangle((28, 430, 332, 462), outline=VIOLET)
    text(d, (40, 439), "打开状态快照", VIOLET, F9)
    d.rectangle((28, 476, 332, 508), outline=CYAN)
    text(d, (40, 485), "带着材料继续", CYAN, F9)
    text(d, (28, 540), "返回标题", GRAY, F8)
    footer(d, "FAILURE → MATERIAL TRACE", "NO GAME OVER SCORE", RED)
    return im


def feedback_legend() -> Image.Image:
    im, d = canvas()
    header(d, "FEEDBACK / 37", "同一事件，四条可感知通道", CYAN)
    columns = [("视觉", CYAN), ("界面", VIOLET), ("声音", AMBER), ("触觉", MAGENTA)]
    for i, (label, c) in enumerate(columns):
        x = 20 + i * 83
        text(d, (x, 74), label, c, F9)
        d.rectangle((x, 94, x + 65, 98), fill=c)
    events = ["擦弹事实写入", "眼开始读取", "局部覆写成功", "天气进入爆发", "Boss 协议转相", "非击杀条件成立", "材料跨局回填"]
    for r, label in enumerate(events):
        y = 132 + r * 57
        text(d, (18, y), label, PAPER, F8)
        for c, (_, color) in enumerate(columns):
            x = 20 + c * 83
            active = (r + c) % 4 != 1 or c == 0
            if active:
                d.rectangle((x, y + 21, x + 54, y + 27), fill=color)
                if c == 2:
                    for k in range(6):
                        d.rectangle((x + k * 9, y + 18 - (k % 3) * 2, x + k * 9 + 3, y + 30), fill=color)
            else:
                d.rectangle((x, y + 21, x + 54, y + 27), outline=GRAY)
    text(d, (18, 554), "任何关键信号至少有两条通道；颜色从不单独编码。", GRAY, F8)
    footer(d, "48 WAV · 37 CUES", "NO ORPHAN EVENTS")
    return im


SCREENS = [
    ("01-gameplay-hud-v4.png", gameplay_hud, "Gameplay HUD"),
    ("02-boss-hud-v4.png", boss_hud, "Boss protocol HUD"),
    ("03-discovery-prompts-v4.png", discovery, "Progressive discovery"),
    ("04-state-snapshot-v4.png", snapshot, "State snapshot"),
    ("05-cross-run-transition-v4.png", cross_run, "Cross-run transition"),
    ("06-accessibility-v4.png", accessibility, "Accessibility invariants"),
    ("07-continue-with-memory-v4.png", continue_screen, "Continue with memory"),
    ("08-route-interruption-v4.png", interruption, "Route interruption"),
    ("09-feedback-channels-v4.png", feedback_legend, "Feedback channels"),
]


def make_overview(images: list[tuple[str, Image.Image, str]]) -> Image.Image:
    thumb_w, thumb_h = 180, 320
    margin, label_h = 12, 22
    cols = 5
    rows = math.ceil(len(images) / cols)
    out = Image.new("RGB", (cols * thumb_w + (cols + 1) * margin, rows * (thumb_h + label_h) + (rows + 1) * margin), PAPER)
    d = ImageDraw.Draw(out)
    for i, (name, im, title) in enumerate(images):
        x = margin + (i % cols) * (thumb_w + margin)
        y = margin + (i // cols) * (thumb_h + label_h + margin)
        out.paste(im.resize((thumb_w, thumb_h), Image.Resampling.NEAREST), (x, y))
        d.text((x, y + thumb_h + 4), f"{i + 1:02d} · {title}", fill=INK, font=F8)
    return out


def main() -> int:
    for p in (OUT, REPORTS, MANIFESTS):
        p.mkdir(parents=True, exist_ok=True)
    rendered = []
    for name, builder, title in SCREENS:
        im = builder()
        im.save(OUT / name, optimize=True)
        rendered.append((name, im, title))
    overview = make_overview(rendered)
    overview.save(OUT / "00-ui-overview-v4.png", optimize=True)

    manifest = {
        "schemaVersion": "4.0.0-ui-mockups",
        "canvas": [W, H],
        "palette": PALETTE,
        "screens": [
            {"id": name.removesuffix(".png"), "file": f"ui/mockups/{name}", "purpose": title}
            for name, _, title in rendered
        ],
        "overview": "ui/mockups/00-ui-overview-v4.png",
        "semanticRules": [
            "score is evidence; never leaderboard currency",
            "boss bar is protocol interval; never life",
            "discovery follows first encounter",
            "cross-run presentation never changes authoritative event timing",
            "critical feedback uses at least two perceptual channels",
        ],
    }
    (MANIFESTS / "ui-mockups-v4.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    errors = []
    for name, im, _ in rendered:
        if im.size != (W, H):
            errors.append(f"{name}: wrong size")
    report = {"schemaVersion": "4.0.0-ui-qa", "status": "PASS" if not errors else "FAIL", "screenCount": len(rendered), "errors": errors}
    (REPORTS / "ui-validation-v4.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
