# 1BIT STG v3 — UI / HUD 交付包

这套界面把 UI 当成行为留下的元数据，而不是覆盖在游戏上的装饰层。它展示“你如何发光、如何被看见、何时改写、什么被带到下一局”，不展示分数、排行或奖章。

## 目录

- `mockups/`：10 张 `360 × 640` 完整页面，以及一张总览图。
- `atlas/ui-atlas.png`：`512 × 512`、`8 × 8`、单格 `64 × 64` 的 UI 图集，共 64 个构件。
- `manifests/ui-atlas.json`：图集 frame、pivot、分类、调色与采样规则。
- `manifests/ui-layouts.json`：所有页面的布局、状态绑定、焦点顺序和跨局时间线。
- `manifests/ui-copy.json`：中英文本与不可使用的评价性措辞。
- `manifests/sample-run-state.json`：状态快照与跨局衔接可直接消费的示例数据。
- `manifests/validation-report.json`：尺寸、模式、Alpha 与 SHA-256 验证结果。
- `docs/UI_SYSTEM_ZH.md`：视觉、交互、数据与运行时说明。
- `fonts/`：Noto Sans SC Variable、OFL 许可和来源记录。
- `scripts/build_ui_kit.py`：确定性重建脚本。

## 一键重建

在项目根目录运行：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 work/v3/ui/scripts/build_ui_kit.py
```

需要 Python 3 与 Pillow。脚本只会重写 `work/v3/ui/atlas/`、`mockups/` 和 `manifests/` 内由它负责的文件。

## 快速实现顺序

1. 读取 `ui-atlas.json`，使用 nearest sampling，关闭 mipmap 与平滑缩放。
2. 读取 `ui-layouts.json`，以 `360 × 640` 为逻辑画布并做整数倍 letterbox。
3. Gameplay HUD 绑定 `lightIntensity / gazePressure / room.id / overrideCharge`。
4. 每局结束生成 `sample-run-state.json` 同构的数据；状态快照和 Continue 页读取同一份数据。
5. 新局开始按 `cross_run_transition.timelineMs` 复水 scar、播放一次 ghost path、转向 witness，最后交还输入。

图集与 mockup 均为程序化像素资产，没有魔法阵、准星、赛博线路、Bloom 或柔光。

