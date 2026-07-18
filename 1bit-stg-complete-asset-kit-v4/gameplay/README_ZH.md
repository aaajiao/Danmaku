# 1bit STG V4：可执行弹幕与战斗编舞

本目录把 V3 的“视觉词典”推进为可执行的 STG 编舞系统。权威源位于 `../manifests/gameplay/`；预览图只是同一份数据生成的几何占位，不是另一套手工示意。

## 交付范围

- 12 个基础运动算子；
- 48 个可执行 pattern：四房间各 4 个、通用／过渡／天气回声遭遇 8 个、八 Boss 各 3 个；
- 16 个普通敌人、8 个真正不同的机械角色；
- 8 个 Boss、24 个阶段、8 种互不相同的非击杀协议终局；
- 8 种真实激光几何，而非同一条 segment 换颜色；
- 四房间 composer、encounter director、run director；
- entity-owned 弹体生命周期与“一弹一次 evidence”擦边规则；
- 确定性模拟、结构归一化去重、Normal／Focus 安全通道求解；
- 五张由权威 manifest 生成的几何预览板。

## 权威文件

| 文件 | 作用 |
|---|---|
| `../manifests/gameplay/gameplay-index-v4.json` | 文件入口、数量与 SHA-256 |
| `../manifests/gameplay/motion-operators-v4.json` | 12 个运动算子及确定性契约 |
| `../manifests/gameplay/executable-patterns-v4.json` | 48 个完整 pattern |
| `../manifests/gameplay/projectile-lifecycle-v4.json` | spawn → arm → entity-owned flight → impact/cancel → residue → cleanup |
| `../manifests/gameplay/enemy-archetypes-v4.json` | 16 敌人的入场、移动、编队、cadence、离场、预警和材料残留 |
| `../manifests/gameplay/boss-rigs-v4.json` | 八 Boss 三阶段 rig、weakpoint、emitter、空间法则与终局 |
| `../manifests/gameplay/laser-geometries-v4.json` | 八种激光拓扑及精确 swept warning 契约 |
| `../manifests/gameplay/room-composers-v4.json` | 四房间的行为权重、预算、休止与材料账本 |
| `../manifests/gameplay/encounter-director-v4.json` | 单次遭遇的节拍与安全约束 |
| `../manifests/gameplay/run-director-v4.json` | 觉醒 → 第一眼 → 房间抽样 → Override → 黄昏 → Snapshot → 跨局材料记忆 |

Boss 世界观事实的唯一权威是 `../narrative/boss-resolutions-v4.json`。Gameplay 使用 `boss.<slug>` 作为 canonical ID，narrative 的 `<slug>` 只作为 alias；builder 每次从该文件读取八组 `resolutionId / fact / condition / terminalEvent / materialRemainder`，不在 gameplay 内另造一套解释。

每个 pattern 都明确包含：

`emitter → geometry/count/angle → speed curve → motion stack → gameplay clock → safe gap → warning → cancel → residue → difficulty → deterministic seed`

pattern 的差异必须来自行为、空间和时间。`geometry.variant` 只是人类可读标签，结构去重时会被排除，不能靠改名通过测试。

## 关键运行规则

1. 动画和透明度永远不能决定碰撞。
2. 普通弹在 `flight` 中没有固定 270ms 或其他视觉超时；其生命周期由实体事件拥有。
3. 取消时先关闭碰撞，再播放数字消失，并在相同坐标提交材料后果。
4. Override 只裁剪定向局部 Void，并将取消坐标写成 `override_scar`；普通 impact 不能伪装成 scar。
5. Full、Reduced Motion、Flash-Off 使用同一 gameplay timeline。
6. 每颗弹每条玩家生命最多生成一次 evidence；不存在 score。
7. Safe gap 是 pattern compiler 的执行契约。遗漏、时间闸门、重定向或可见取消必须在警告中被读到。
8. Boss 第三阶段 hook、退出条件、rupture 事件与材料残留必须逐字段等于 narrative canonical；HP 归零只表示结构破裂。
9. `RAIN / ASH / WIND` 天气本身不能生成弹体、碰撞体或 safe gap，也不能改变运动。三个 `encounter.weather_echo.*` 是由 encounter director 独立调度的战斗回声，与天气并行但无因果输入，weather RNG 永远不能进入 pattern seed。

## 测试和复建

从项目根目录运行：

```bash
python -B work/v4/gameplay/tools/build_gameplay_v4.py
python -B work/v4/gameplay/tools/validate_gameplay_v4.py
python -B work/v4/gameplay/tools/render_gameplay_v4.py
python -B work/v4/gameplay/tools/render_pattern_animations_v4.py
```

当前严格验证：

- `0 errors / 0 warnings`；
- 48/48 pattern 同 seed 同 trace；
- 48 个归一化结构签名，无重复组；
- 48/48 Normal 可达；
- 48/48 Focus 可达；
- 16/16 run composition 同 seed 同 schedule；
- 8 个 Boss 终局事件互不相同；
- 8/8 Boss 解决条件与 narrative canonical 逐字段一致；
- 3/3 weather-echo encounter 与真实天气事件、轨迹、碰撞、safe gap、RNG 完全解耦；
- 8 个 laser geometry type 互不相同。

报告位于 `reports/`：

- `validation-report-v4.json`
- `determinism-report-v4.json`
- `director-determinism-report-v4.json`
- `pattern-structure-signatures-v4.json`
- `safe-gap-report-v4.json`

## Three.js 接入顺序

1. 先实现 `projectile-lifecycle-v4.json`，确保碰撞和视觉分离。
2. 以固定 gameplay tick 执行 motion operator；render loop 只插值表现。
3. Pattern compiler 按固定顺序展开 `emitter → burst → projectile`，使用 Mulberry32 v1。
4. 将 safe-gap compile policy 应用到候选轨迹，再生成 exact swept warning。
5. Encounter director 负责预算和休止，room composer 只做行为加权抽样。
6. Boss rig 直接执行 narrative canonical condition；HP 可以提供阶段压力，但不能成为全局唯一终止条件。
7. 最后绑定 V4 视觉、音频和触觉；绑定层不得回写 gameplay 状态。

## 预览边界

`previews/` 中的弹体是几何菱形，灰色双轨是安全通道，十字是 emitter。它们用于检查运动结构、密度与空间拓扑，不替代最终像素素材。正式运行时与 QA 必须继续读取 `gameplay-index-v4.json` 指向的同一组 manifest。
