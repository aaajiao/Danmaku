# 1bit STG 游戏设计基线

状态：`V4 CONTRACT + FOUNDATION WIP`

这不是 score attack，也不是善恶判定系统。玩家留下的是行为与材料事实，而不是等级证明。

## 1. 不可约循环

游戏的 metadata 不是“打倒更多敌人”，而是：

> 读取规则 → 身体移动/凝视/擦弹 → 留下 evidence → 在局部撕开规则 → 世界留下材料痕迹 → 当前 Run 被观察和序列化 → 下一 Run 重新遇见这些事实。

内容只是表面，行为才是记录对象。游戏不统计一个抽象分数来替代行为；它记录玩家停留在哪里、如何移动、何时聚焦、看向什么、何时打断规则、在哪里倒下，以及这些动作如何改变下一次读取。

## 2. V4 Run 契约

Canonical Run 不是线性关卡梯子，而是由 seed 和 behavior ledger 进行的精神房间抽样：

| 阶段 | 玩法事实 | 当前工程状态 |
|---|---|---|
| Quiet Awakening | 6–10 秒，无战斗；至少发生可辨认输入后才离开 | RunDirector 用 8 秒/两次 meaningful input 表达，WIP |
| First Eye | 稀疏 `common.eye_acquisition`；解锁 Focus 与 graze evidence | pattern 可执行，Run 接线 WIP |
| Mental Room Sampling | 从 4 房间中按 ledger 加权、不放回抽 2–4 个 | 纯逻辑 schedule 已有，完整 encounter parity 未完成 |
| Local Override | `evidence >= cost` 时可进入；可选，不阻塞 Run | 基础局部扇区 Override 已有，材料写入未完成 |
| Dusk / No Dusk | 达到目标时长或 terminal protocol 后停止新战斗生成 | Dusk schedule 基础；16-state 叙事未接入 |
| State Snapshot | 无战斗、无 judgement；观察当前 Run | recorder/serializer WIP |
| Cross-run Material Memory | 先材料，再 ghost，再 witness，最后返还输入 | 未完成端到端 hydrate/replay |

硬约束：Run 至少 240,000ms、至少进入两个不同房间；Boss 每 Run 最多两个，按房间和行为匹配。Boss 的解法可以是 HP、存活、阅读或世界事实，`HP == 0` 不是全局必要条件。

4 个 canonical room 是 `INFORMATION`、`FORCED_ALIGNMENT`、`IN_BETWEEN`、`POLARIZED`。它们是被抽样的精神状态，不对应“一关比一关高级”。难度只调弹体数量、速度、cadence 和 safe gap，不给玩家贴技能等级。

## 3. 禁止的评价语义

以下内容不得进入 Run schedule、存档字段、UI、遥测或结局命名：

- score、high score、rank、grade、leaderboard；
- victory/defeat；
- good ending/bad ending；
- 用击杀数、资源量或单一路线定义“正确玩家”；
- 用天气、可访问性选项、设备性能或手柄型号改变玩法结果。

合法的 Run end 是已提交的事实，例如 `BODY_COLLAPSE`、`PROTOCOL_WITHDRAWAL`、`READING_FAILED`、`STABLE_INTERSECTION` 或 `NO_DUSK_WITHDRAWAL`。Snapshot 可以描述“发生了什么”，不能评价“做得好不好”。

## 4. Behavior Ledger 与 Material Ledger

### 4.1 Behavior Ledger

当前 RunDirector 的基础字段是：

- `roomTimeMs`：各房间的权威停留时间；
- `flower`：表达/信号强度的行为摘要；
- `gaze`：凝视与 clamp 关系；
- `crack`：规则裂缝的发生事实；
- `override`：局部 Override 的使用事实；
- `contextSwitch`：玩家如何在规则上下文之间切换。

Ledger 只用于抽样权重、witness/world response 和跨 Run 重遇。不得把多个维度压成一个“总分”；不得在 UI 中显示优劣排序。所有记录必须带单位、采样窗口、schema version 和来源事件，避免变成无法解释的数字。

### 4.2 Material Ledger

数字动作必须有物质对应，形成双螺旋：

| 数字行为 | 材料事实 | 约束 |
|---|---|---|
| Directional Override | `overrideScar` | 有世界坐标/方向/类型；不是全屏清弹 |
| 玩家倒下 | `deathTrace` | 与 scar 类型严格分离 |
| 长时间/重复暴露 | `burnIn` | 是沉积，不是奖励倍率 |
| 实际移动路线 | ghost route → `ghostResidue` | route duration 取最后一个权威点 |
| Scar 与 ghost 的关系 | witness orientation | 发生在 ghost residue 之后 |

Restore 固定顺序为 `overrideScar → deathTrace → burnIn → actual ghost route → ghostResidue → witness → input return`。Ghost 的 collision、reward、emitter class 都不能偷偷恢复成敌人或奖励源。

## 5. 战斗语法

- V4 有 48 个 executable pattern：16 ROOM、2 COMMON、3 TRANSITION、3 WEATHER_ECHO、24 BOSS。
- 8 个 Boss 各 3 phase：`observe → enforce → fail_to_totalize`；另有 8 种 laser geometry。
- 弹体必须有显式 `spawn → arm → flight → impact/cancel → residue → cleanup`；flight 属于实体，不按视觉动画固定超时结束。
- Graze 的唯一键是 projectile instance、generation 和 player；同一代弹体对同一玩家最多授予一次 evidence。
- Safe gap 与 exact warning 是玩法契约，不是装饰。视觉关闭、闪烁关闭或降帧不能改变安全路径。
- Directional Override 消耗 evidence，只在玩家前方局部扇区撕开规则；它不提供全局无敌。数字结果是 local-rule-tear，材料结果是带类型和坐标的 scar。
- Weather/background 可以反馈世界状态，但 presentation 不能反向产生碰撞或 RNG。

## 6. 输入设计

| 行为 | 键盘 | 标准映射手柄 | 设计语义 |
|---|---|---|---|
| 移动 | WASD / 方向键 | 左摇杆 / D-pad | 连续身体事实 |
| 表达/射击 | Z | Button 0（A/Cross） | 不是“确认正确答案” |
| 局部 Override | X | Button 1（B/Circle） | edge-triggered，消耗 evidence |
| Focus | Shift | Button 4/5（LB/RB） | 精细移动与读取 |
| Pause | Space | Button 9（Start/Options） | 冻结 gameplay clock |

实现基线是浏览器原生 Gamepad API、0.18 径向死区、D-pad/摇杆择强、热插拔、断开回退和可用时的 dual-rumble。触觉是反馈 sink：不支持振动、权限拒绝或手柄断开都不能改变事件 trace。浏览器“standard mapping”以外的设备在 P1 通过显式 remap profile 支持，不能靠猜测按钮布局。

触摸/指针按住拖动是平台替代输入。所有来源先归一成同一个按 tick `InputFrame`，回放只保存归一化事实和必要 edge，不保存设备品牌。

## 7. PWA 与离线语义

PWA 不是包装层，而是可复现运行环境：

- manifest 提供 standalone、192/512 `any` 和 512 `maskable` 图标；
- shortcut 显式进入 `?mode=pattern-lab`，默认 `/` 面向 RUN；
- 核心脚本、V4 数据、必要图集/音频必须在发布版本可离线复现；
- service worker 更新只能在安全边界提示/切换，不得在 Run 中途混用 content digest；
- 离线与在线使用同一 seed/输入时必须产生同一 trace；
- IndexedDB 存档必须绑定 content digest，迁移失败时保留可导出的原记录。

现有 PWA 图标、manifest 与预缓存是基础；更新事务、存档迁移和自动离线回归仍是 P1。

## 8. 可访问性

Reduced Motion、Flash-Off 和 Full 是正交投影配置。必须满足：同事件 ID、同 simulation tick、同 payload、同顺序。可采用静态替代帧、轮廓、音频 fallback 或触觉 fallback，但不能改变 Boss timing、弹速、碰撞、RNG 和 input return tick。

教学也遵循信息边界：教程可以说明输入，不得提前揭露尚未由玩家行为发现的因果关系。

任何 V4 外的玩法、素材、文案或图标扩展，先执行 [CONTENT_EXTENSION_ZH.md](./CONTENT_EXTENSION_ZH.md) 的 aaajiao Extension ADR；不得以“内容更多”为理由直接进入产品。
