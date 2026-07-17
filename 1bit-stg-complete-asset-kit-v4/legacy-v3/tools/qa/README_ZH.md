# v3 Danmaku QA 与真实预览工具

这组工具只读取素材包；所有报告和预览都被硬性限制在本目录下，不能覆盖 `outputs/`。

## 两个入口

```bash
python3 work/v3/qa/qa_v3.py \
  --kit-root <asset-kit-root> \
  --report work/v3/qa/v3-report.json
```

返回码：`0` 通过；`1` 有 QA 硬错误；`2` 是输入、路径或 JSON 本身不可读。加 `--strict-warnings` 可把警告也作为失败。

```bash
python3 work/v3/qa/render_v3_previews.py \
  --kit-root <asset-kit-root> \
  --out work/v3/qa/previews \
  --format both \
  --all-clips \
  --boss all \
  --laser all \
  --stress
```

也可以只选一部分：

```bash
python3 work/v3/qa/render_v3_previews.py \
  --kit-root <asset-kit-root> \
  --out work/v3/qa/previews \
  --format both \
  --clip 'combat.bullet.*' \
  --boss absent_receiver \
  --laser info_scanline \
  --stress --stress-count 220
```

## QA 门槛

1. **目标调色板 / 每格色数**：只统计 alpha 大于零的 RGB。优先读取 `visual-contract-v3.json`（当前契约为普通格最多 4 色），否则从 `palette.json` 收集颜色并使用 6 色保守默认；`qa-config.json` 可覆盖。
2. **语义 ID**：每个 frame 必须有唯一、稳定且机器可读的 `semanticId`；坐标型 frame ID 不能代替语义。
3. **pivot**：每个 frame 的 pivot 必须是 `[0..1, 0..1]`，同一 clip 默认最大漂移 `0.02`。
4. **重复 frame / clip**：相同图像仍要被发现；同一 clip 重复 frame 是错误，应改成 `hold`。完全相同的 clip 也是错误。
5. **spawn / delete / residue 单调性**：显式 `monotonic` 优先；否则从 semantic clip ID 推断。按可见 alpha 面积检查，默认容忍 3% 量化抖动。
6. **事件图无环**：若存在 `binding-graph.json`，直接检查唯一节点/边、端点、terminal 出边、visual→gameplay 逆向边与环；否则从 `clip → event → effect/action → clip` 推导。播放循环 `loop:true` 不算事件环，但事件重新触发自身算环。
7. **reduced-motion parity**：每个 clip 必须有 `reducedMotionClip`、`reducedMotionFrames` 或 `reducedMotionFrame`。只用静态帧且原 clip 有事件时，必须写 `reducedMotionPreservesEvents:true`、列出 `reducedMotionEvents`，或由 `runtime-contract.json` 明确声明 gameplay timeline 是事件权威且要求同时间/同顺序等价。
8. **背景亮度 / 弹幕对比**：默认至少 90% 的 bullet/projectile frame 相对每张背景中位亮度达到 `3.0:1`。报告同时保留背景 P10/P50/P90 和项目符号通过率。

## animation-clips 时序

兼容 v2 的字符串 frame 写法，也支持 v3 的逐帧对象：

```json
{
  "clips": {
    "combat.bullet.spawn": {
      "atlas": "combat_vfx_v3",
      "fps": 12,
      "loop": false,
      "loopMode": "once",
      "frames": [
        {"frameId": "combat_vfx_v3:00", "holdFrames": 1},
        {"frameId": "combat_vfx_v3:01", "durationMs": 140, "events": ["collision_on"]}
      ],
      "hold": {"lastFrameMs": 80},
      "events": [{"frame": 0, "name": "spawn_started"}],
      "monotonic": "increase",
      "reducedMotionFrame": "combat_vfx_v3:01",
      "reducedMotionPreservesEvents": true
    }
  }
}
```

优先级：逐帧 `durationMs` > `holdFrames/hold × (1000/fps)` > `1000/fps`；clip 级 `hold.frames` 与 `hold.lastFrameMs` 会继续累加。`pingPong` 会在预览中展开成一个完整周期。每个 clip 同时输出 `*.timeline.json`，逐项记录真实开始时间、时长和事件；GIF 会受 10ms 时间粒度约束，APNG 保留毫秒时长。

## 组合预览

- **Boss assembled rig**：按 `renderOrder`、父体 normalized anchor 与 frame/node pivot 合成，不是把 atlas 单元平铺。默认画出锚点，便于肉眼发现漂移。
- **Laser lifecycle**：使用真实模块 warning/emitter/body/end，按 warning、charge、grow、minimum-live 和 shutdown 时长生成；每帧标出碰撞开关。
- **360×640 stress**：真实背景、玩家、敌人、Boss 与指定数量弹幕组合；固定 seed，可复现同一压力场景。

## 可选 qa-config.json

把 [qa-config.example.json](./qa-config.example.json) 复制到素材包的 `manifests/v3/qa-config.json`，并按项目目标调整。没有该文件时使用上述保守默认值。
