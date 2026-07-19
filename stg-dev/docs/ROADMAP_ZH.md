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
| Canonical Run | WIP | 首房关闭 → transition/material → successor首slice → material transfer → 同房encounter ordinal 1 telegraph/entry/READ local0已闭合；EXT-022已接受local1..1272与gameplay release规则但尚未实现，材料tail、Session消费与room completion/handoff仍未完成 |
| First-occurrence observation boundary | DONE | EXT-2026-008 在 H+1701 冻结 `[1,H+1701]` 观察；只闭合首 occurrence slice，不授予 room completion、metric、selection 或 transition |
| First fixed room closure | DONE | EXT-2026-009 在H+1702原子关闭单occurrence bootstrap首房并冻结`1/1/0`与typed visit fact；closure自身仍不承载metric、selection、transition或handoff |
| First-room metric projection | DONE（partial） | EXT-2026-010/011从exact H+1702来源投影`avgFlower`/`gazeRatio`/`recentInputDensity`，其余11项typed missing；整体不ready，不授权composer、RNG、target、selection或transition |
| Room composition / execution | WIP（首个 live 切片） | ordinal 1首occurrence已推进到exact slice close；Misregistration encounter ordinal 1已由EXT-021安装到READ local0。EXT-022已冻结80-slot执行、capacity audit与global8219 release规则，代码、材料tail、Session消费、room count/order与完整multi-pool仍未完成 |
| Boss / laser | WIP（隔离 authority） | 4/8 rigs 的 observe pattern、4/24 Boss patterns 与一条 Misreader enforce-entry/laser seam 可测；完整 phase evaluator、live cycle、resolution 与 renderer 未接 |
| Narrative / cross-run memory | WIP（authority） | snapshot、in-memory archive、restore 顺序与 narrative reducer 有隔离证据；durable storage、boot rehydrate、null-route、IndexedDB 与完整 handoff 未接 |
| Renderer / input / PWA | WIP（基础可用） | Three.js、键盘/触控/标准手柄、manifest、离线warm reload与图标已存在；V4源素材由构建直接打包，但runtime当前只接5/7图集、4个房间背景及部分音频，完整章节素材、causal clips、升级迁移和实机矩阵未完成 |
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
| P0-05 | Live room composer | WIP | EXT-012 target、EXT-013 transition及EXT-015—017 successor plan/terminal/session已闭合首个ordinal 1 live slice；EXT-018—021已把下一合法Misregistration推进到READ local0。EXT-022已接受local1..1272、80-slot rejection与occurrence release规则但实现pending；tail、Session与room completion仍withheld |
| P0-06 | Boss/laser phase loop | WIP | 8×3 phases、8 laser、phase evidence evaluator、resolution/terminal 与 room handoff 进入同一 live Run；禁止从 family association 推断 active laser |
| P0-07 | Canonical Run / narrative | WIP | awakening、First Eye、固定首房、captures、partial metrics、target、Room Threshold及successor首slice已进入同一session/只读presentation；第二occurrence authority已推进到READ local0，READ/release决定已接受但代码与Session接线pending。room handoff和完整Run终点仍未授权 |
| P0-08 | Save/replay/cross-run | WIP | durable archive、versioned migration、boot restore、null-route、corruption isolation 与 deterministic replay 端到端闭合 |
| P0-09 | Presentation / accessibility | WIP | 建立`stg-dev/src/assets`运行时registry，源文件继续唯一指向V4；按共享/章节接完7张正式图集与实际流程所需音频。完整Run的full/reduced-motion/flash-off gameplay trace相同，UI、音频、触觉、天气只读投影，关键causal clips可追溯到事件/tick |
| P0-10 | QA / performance | WIP | 完整 Run E2E、oracle/accessibility parity、固定设备性能、10 分钟 soak 与失败 artifact 闭合；恢复自动 CI |
| P0-11 | PWA release path | WIP | 在线/离线冷暖启动、N→N+1 service-worker 更新、存档迁移、未知 URL fallback 与安装路径通过 |
| P0-12 | 文档与扩展治理 | DONE（基础） | GDD/TDD/Roadmap/QA 单一职责；每个 V4 外扩展都有 focused ADR 与 provenance |

### 当前生产顺序

1. 实施EXT-022：从EXT-021 `read-advance-withheld`边界推进Misregistration READ local`1..1272`，继续同步
   retained material、room/player与新combat并由Run sole-flush；钉住80-slot唯一capacity audit与global`8219`
   occurrence release。材料tail从`8220`另片处理，不顺带接Session、第三occurrence或room completion。
2. 建立只引用V4唯一源文件的共享/章节素材registry，按实际Run章节补齐图集、背景、causal clip与音频；
   不复制二进制素材，不把preview/QA图当runtime资产，并让`dist`继续由部署阶段生成。
3. 后续producer ADR按实际进入Run的机制逐项补11个missing metric的window、denominator与threshold；总room
   count、完整room order、difficulty与RNG continuation在各自消费边界明确，禁止再次形成“后置事实先齐”的门。
4. 沿同一 consumer 边界扩展 rooms、Boss 与 narrative 的单一 Run 路径；在 V4 缺失 policy 明确前，不把
   isolated capability 冒充 live room/Run。
5. 接 durable cross-run persistence，再完成完整 Run browser/accessibility/performance 证据。
6. P0 闭合、完整门禁稳定后恢复 GitHub push/PR 自动 CI，并进入 Alpha 候选；GitHub Pages用部署阶段构建的
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
