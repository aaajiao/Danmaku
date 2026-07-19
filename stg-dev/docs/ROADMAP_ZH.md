# 1bit STG 制作路线图

状态快照：2026-07-19

当前阶段：`FOUNDATION`

目标：把 V4 playable reference 推进为可验证、可离线、可重放、可发布的完整 STG。

本文是唯一人工维护的制作状态源，只记录状态、优先级、依赖、风险与完成定义。
玩法规则见[游戏设计](GAME_DESIGN_ZH.md)，稳定技术边界见[技术架构](ARCHITECTURE_ZH.md)，
验证方法见[测试与验收](TESTING_ZH.md)。精确 seed、trace、hash 与事件计数以可执行测试为准。

## 1. 状态定义

- `DONE`：责任边界已实现，相关验证通过，所属文档已更新。
- `WIP`：已有可执行切片，但尚未闭合端到端责任。
- `TODO`：尚无可接受实现。
- `PAUSED`：有意暂停，并写明恢复条件。
- `BLOCKED`：存在明确外部阻塞、owner 与解除条件；工作量大不算阻塞。

## 2. 当前制作状态

| 系统 | 状态 | 当前边界 |
|---|---|---|
| V4 Content Authority | DONE | 48 个 executable patterns 与 canonical manifests、ID、引用、文件 universe、SHA-256 均 fail-fast；V4 素材包保持只读 |
| 120Hz clock / ordered event bus | DONE（核心） | 整数 `tick120`、60Hz even-tick adapter、pause、同 tick 五阶段顺序与 occurrence 去重已建立 |
| Pattern Authority | WIP | direct kernel 为 25/48；exported live-admission registry 为 20，另有 5 个 private direct-only capability。当前 family 快照：FORCED_ALIGNMENT 4/4、IN_BETWEEN 2/4、INFORMATION 3/4、POLARIZED 4/4、TRANSITION 3/3、weather echo 3/3 |
| Projectile / player / damage | WIP（核心） | entity-owned flight、collision lease、graze/evidence、damage/respawn 与局部 Override 有 authority 证据；通用跨 authority transaction 与完整 Run 组合未完成 |
| Canonical Run | WIP | 默认路径已完成 guarded awakening → First Eye → delayed Flower recovery，并暴露 typed `ROOM_SAMPLING` ready boundary；尚无真实 room consumer，不回退 legacy Run |
| Room composition / execution | WIP（隔离切片） | caller-resolved admission 与两条 exact READ-through-rest executor 已存在；仍无通用 composer、selection、scheduler、parallel/multi-pool、room completion 或 handoff |
| Boss / laser | WIP（隔离 authority） | 4/8 rigs 的 observe pattern、4/24 Boss patterns 与一条 Misreader enforce-entry/laser seam 可测；完整 phase evaluator、live cycle、resolution 与 renderer 未接 |
| Narrative / cross-run memory | WIP（authority） | snapshot、in-memory archive、restore 顺序与 narrative reducer 有隔离证据；durable storage、boot rehydrate、null-route、IndexedDB 与完整 handoff 未接 |
| Renderer / input / PWA | DONE（基础） | Three.js 像素表现、键盘/触控/标准手柄、manifest、离线 warm reload 与图标已存在；完整 causal clips、升级迁移和实机矩阵未完成 |
| QA / release evidence | WIP | focused/unit/content/build/smoke/E2E 与 V4 validators 可运行；完整 Run、性能、soak、设备和升级证据未闭合 |
| GitHub 自动 CI | PAUSED（FOUNDATION） | push/PR 自动触发暂停，手动 workflow 保留；进入 Alpha 候选且完整门禁稳定后恢复 |

因此当前产品称为“工业化基础 / playable reference”，不是 complete game、release
candidate 或 production-ready。

## 3. P0：完整权威闭环（Alpha 候选）

P0 全部完成后才允许进入 Alpha 候选。

| ID | 工作 | 状态 | 完成定义 / 下一缺口 |
|---|---|---|---|
| P0-01 | Content index 与 schema | DONE | 所有 V4 入口、版本、ID、引用、文件与 digest fail-fast；未知内容不静默降级 |
| P0-02 | Clock 与 canonical event bus | DONE（核心） | 120/60Hz due-time、pause、五阶段顺序、payload、occurrence 与只读 feedback 契约闭合 |
| P0-03 | 48-pattern production authority | WIP | direct kernel 从 25/48 完成到 48/48；每个新增 adapter 保留 V4 声明顺序、RNG/identity、safe gap、生命周期与 profile parity。近期缺口包含 `room.information.missing_ack` 与其余未接 patterns；Ash Memory 仅完成 isolated direct authority，尚未取得 live weather scheduling |
| P0-04 | Projectile/player/damage 闭环 | WIP | 完成 run-owned causality、damage→impact/terminal 组合、pool/budget 语义与失败原子性；表现不拥有 collider/lifecycle |
| P0-05 | Live room composer | WIP | 明确 room count、difficulty salt、segments、parallel/weather、tier budget 与 safe-gap handoff producer；选择、排程、执行和完成均写 canonical facts |
| P0-06 | Boss/laser phase loop | WIP | 8×3 phases、8 laser、phase evidence evaluator、resolution/terminal 与 room handoff 进入同一 live Run；禁止从 family association 推断 active laser |
| P0-07 | Canonical Run / narrative | WIP | quiet awakening、First Eye 与 typed `ROOM_SAMPLING` boundary 已闭合；下一步消费该 handoff，随后让 rooms、Boss、Dusk、witness 与 input return 均由 authored facts 驱动 |
| P0-08 | Save/replay/cross-run | WIP | durable archive、versioned migration、boot restore、null-route、corruption isolation 与 deterministic replay 端到端闭合 |
| P0-09 | Presentation / accessibility | WIP | 完整 Run 的 full/reduced-motion/flash-off gameplay trace 相同；UI、音频、触觉、天气只读投影，关键 causal clips 可追溯到事件/tick |
| P0-10 | QA / performance | WIP | 完整 Run E2E、oracle/accessibility parity、固定设备性能、10 分钟 soak 与失败 artifact 闭合；恢复自动 CI |
| P0-11 | PWA release path | WIP | 在线/离线冷暖启动、N→N+1 service-worker 更新、存档迁移、未知 URL fallback 与安装路径通过 |
| P0-12 | 文档与扩展治理 | DONE（基础） | GDD/TDD/Roadmap/QA 单一职责；每个 V4 外扩展都有 focused ADR 与 provenance |

### 当前生产顺序

1. 以 typed `ROOM_SAMPLING` handoff 为入口，闭合首个 Forced Alignment room composer/scheduler。
2. 继续补齐为 live room 所需的 pattern authority；在 V4 缺失 policy 明确前，不把 isolated capability 冒充 live room/Run。
3. 沿同一 consumer 边界扩展 rooms、Boss 与 narrative 的单一 Run 路径。
4. 接 durable cross-run persistence，再完成完整 Run browser/accessibility/performance 证据。
5. P0 闭合、完整门禁稳定后恢复 GitHub push/PR 自动 CI，并进入 Alpha 候选。

## 4. P1：生产硬化（Beta 候选）

| 工作 | 完成定义 |
|---|---|
| 性能与资源预算 | 固定硬件/浏览器场景有 tick、frame、heap、GPU、pool 与 soak 基线；降级只影响表现 |
| 持久化与迁移 | IndexedDB schema/version、quota、损坏隔离、导出与多版本迁移均可恢复 |
| PWA 更新事务 | service worker 只在安全 Run 边界接管；禁止 content digest 混用 |
| 设备与可访问性 | 目标键盘、触控、Gamepad 实机矩阵有记录；输入边沿和 trace parity 通过 |
| 可观测性与诊断 | 构建可报告 commit、content digest、extension digest、版本与受控错误；不记录评价性 telemetry |
| 发布自动化 | 自动 CI、release artifact、浏览器矩阵、失败证据保留和回滚流程稳定 |

## 5. P2：有基准后再做的工具

- deterministic replay inspector 与 trace diff 工具；
- manifest/schema authoring helper；
- 视觉回归与固定性能场景自动化；
- 只有 profile 证明收益后才考虑 Worker、更多渲染后端或并发执行。

工具不能成为第二套 gameplay authority，也不能绕开 V4/adapter contract。

## 6. 里程碑

### Alpha：完整权威闭环

- 一个完整 seeded Run 从 boot 到 observation/handoff 可玩；
- 48/48 production pattern authority 与 live room/Boss/narrative 路径闭合；
- snapshot/archive/restore 有 durable 路径；
- focused、full、browser、accessibility 与基础性能门禁稳定；
- GitHub push/PR 自动 CI 恢复。

### Beta：生产环境闭环

- 离线/升级/迁移、设备矩阵、性能/soak 与诊断闭合；
- 无已知 authority divergence、存档损坏或 gameplay/profile trace mismatch；
- 只剩内容打磨和有边界的兼容性问题。

### Release Candidate：只修阻断

- 固定 commit/content/extension digest 的候选包通过发布验收；
- 不再加入新机制、依赖或素材扩展；
- 回滚、迁移与恢复路径已有演练记录。

## 7. 制作风险

- V4 没有定义的 policy 被误写成 V4 事实；
- isolated pattern/room/Boss 证据被误称为完整 Run；
- 表现状态反向成为碰撞、生命周期或 handoff authority；
- 精确 hash/count 被复制到多份文档后漂移；
- 在性能与设备基线缺失时过早增加并发或平台复杂度；
- 为追求反馈密度填满 authored silence、absence、residue 或 interruption。

## 8. 开发与提交节奏

每个切片只解决一个可验收责任：先 focused 测试，再按风险扩展验证；完成后立即独立
commit，并在已授权的当前非主分支 push，再进入下一切片。Roadmap 只更新状态和 DoD；
技术决定写 architecture/focused ADR，精确证据留在 tests/fixtures。
