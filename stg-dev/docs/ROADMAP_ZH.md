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
| Pattern Authority | WIP | direct kernel 为 26/48；exported live-admission registry 为 21，另有 5 个 private direct-only capability。当前 family 快照：FORCED_ALIGNMENT 4/4、IN_BETWEEN 3/4、INFORMATION 3/4、POLARIZED 4/4、TRANSITION 3/3、weather echo 3/3 |
| Projectile / player / damage | WIP（核心） | entity-owned flight、collision lease、graze/evidence、damage/respawn 与局部 Override 有 authority 证据；通用跨 authority transaction 与完整 Run 组合未完成 |
| Canonical Run | WIP | 首房关闭 → transition/material → Context Switch → Misregistration → post-close material hold已由同一Session与只读presentation闭合到global8683；两次换手不清屏，drain后80-slot lease保留。下一consumer与room completion/handoff仍未授权 |
| First-occurrence observation boundary | DONE | EXT-2026-008 在 H+1701 冻结 `[1,H+1701]` 观察；只闭合首 occurrence slice，不授予 room completion、metric、selection 或 transition |
| First fixed room closure | DONE | EXT-2026-009 在H+1702原子关闭单occurrence bootstrap首房并冻结`1/1/0`与typed visit fact；closure自身仍不承载metric、selection、transition或handoff |
| First-room metric projection | DONE（partial） | EXT-2026-010/011从exact H+1702来源投影`avgFlower`/`gazeRatio`/`recentInputDensity`，其余11项typed missing；整体不ready，不授权composer、RNG、target、selection或transition |
| Room composition / execution | WIP（首个 live 切片） | Misregistration encounter ordinal 1已进入真实Session，完成80-slot READ、global8219 gameplay release、rest8327、close8519与post-close material hold；formal fixture的63个residue在8682自然排空且lease不自动释放。下一occurrence/room决定与完整multi-pool仍未完成 |
| Boss / laser | WIP（隔离 authority） | 4/8 rigs 的 observe pattern、4/24 Boss patterns 与一条 Misreader enforce-entry/laser seam 可测；完整 phase evaluator、live cycle、resolution 与 renderer 未接 |
| Narrative / cross-run memory | WIP（authority） | snapshot、in-memory archive、restore 顺序与 narrative reducer 有隔离证据；durable storage、boot rehydrate、null-route、IndexedDB 与完整 handoff 未接 |
| Renderer / input / PWA | WIP（首批因果素材族） | shared/chapter runtime registry已闭合7/7图集与448 frame atlas依赖，当前接4个房间背景、4个room bed和6个既有feedback音效；First Eye、Room Threshold及projectile arm/live collision边界已由真实Run事实驱动正式V4 frame，含对应Reduced Motion fallback。其余事件族、动态clip、reaction、升级迁移和实机矩阵未完成 |
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
| P0-03 | 48-pattern production authority | WIP | direct kernel 从 26/48 完成到 48/48；EXT-018已把Misregistration Corridor的单draw相位、orbit/release分段、完整preflight与material drain接入live registry。近期缺口包含 `room.information.missing_ack`、`room.in_between.borrowed_rule` 与其余未接 patterns；Ash Memory 仅完成 isolated direct authority，尚未取得 live weather scheduling |
| P0-04 | Projectile/player/damage 闭环 | WIP | 完成 run-owned causality、damage→impact/terminal 组合、pool/budget 语义与失败原子性；表现不拥有 collider/lifecycle |
| P0-05 | Live room composer | WIP | EXT-012 target、EXT-013 transition、EXT-015—024 direct authority及EXT-025 Session/presentation已闭合两个IN_BETWEEN occurrence到global8683，完成residue自然排空并保留lease。下一consumer与room completion仍withheld |
| P0-06 | Boss/laser phase loop | WIP | 8×3 phases、8 laser、phase evidence evaluator、resolution/terminal 与 room handoff 进入同一 live Run；禁止从 family association 推断 active laser |
| P0-07 | Canonical Run / narrative | WIP | awakening、First Eye、固定首房、captures、partial metrics、target、Room Threshold、Context Switch与Misregistration已进入同一Session/只读presentation并到global8683；下一consumer、room handoff和完整Run终点仍未授权 |
| P0-08 | Save/replay/cross-run | WIP | durable archive、versioned migration、boot restore、null-route、corruption isolation 与 deterministic replay 端到端闭合 |
| P0-09 | Presentation / accessibility | WIP（首批因果素材族） | `stg-dev/src/assets`已让共享层唯一绑定V4物理URL、章节层只选择ID，并闭合7张正式图集；First Eye、Room Threshold与projectile arm/live frame已从真实Run提交事实投影，projectile replacement由EXT-026冻结且不拥有碰撞。下一缺口是Flower等事件族；动态clip、房间声床crossfade与reaction须先闭合其组合规则。完整Run的full/reduced-motion/flash-off gameplay trace仍须证明相同 |
| P0-10 | QA / performance | WIP | 完整 Run E2E、oracle/accessibility parity、固定设备性能、10 分钟 soak 与失败 artifact 闭合；恢复自动 CI |
| P0-11 | PWA release path | WIP | 本地root preview可启动并离线warm reload；GitHub Pages尚无deploy workflow，`/Danmaku/` base、manifest identity与子路径smoke未接。之后再闭合冷启动、N→N+1 worker、存档迁移及未知URL fallback |
| P0-12 | 文档与扩展治理 | DONE（基础） | GDD/TDD/Roadmap/QA 单一职责；每个 V4 外扩展都有 focused ADR 与 provenance |

### 当前生产顺序

1. 沿进入真实Run的章节事件继续补Flower等被动素材投影；First Eye、Room Threshold与projectile当前只闭合
   V4已给出且已有状态边界的steady事实，不冒充动态clip、未绑定声音或房间声床crossfade。动态playhead、
   crossfade与reaction组合规则先走focused决定；章节只选择共享V4 ID，不复制素材，不把preview/QA图当
   runtime资产，`dist`继续由部署阶段生成。
2. 后续producer ADR按实际进入Run的机制逐项补11个missing metric的window、denominator与threshold；总room
   count、完整room order、difficulty与RNG continuation在各自消费边界明确，禁止再次形成“后置事实先齐”的门。
3. 沿同一 consumer 边界扩展 rooms、Boss 与 narrative 的单一 Run 路径；在 V4 缺失 policy 明确前，不把
   isolated capability 冒充 live room/Run。
4. 接 durable cross-run persistence，再完成完整 Run browser/accessibility/performance 证据。
5. P0 闭合、完整门禁稳定后恢复 GitHub push/PR 自动 CI，并进入 Alpha 候选；GitHub Pages用部署阶段构建的
   `stg-dev/dist` artifact，不把hash产物提交进开发分支。

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
