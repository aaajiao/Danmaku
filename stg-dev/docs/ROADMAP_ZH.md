# 1bit STG 工业化路线图

状态快照：2026-07-18

目标：把当前 V4 Lab/PWA 基础推进为可验证、可离线、可重放、可发布的完整 STG。本文按证据标状态，不以文件存在代替系统完成。

## 1. 状态定义

- `DONE`：代码、自动化测试和文档均存在，当前分支验证通过；
- `WIP`：已有实现或测试骨架，但尚未端到端/未全部门禁；
- `TODO`：尚无可接受实现；
- `BLOCKED`：有明确外部阻塞和 owner；“工作量大”不算阻塞。

## 2. 当前基础，不是完整游戏

| 能力 | 状态 | 证据与边界 |
|---|---|---|
| Bun/Vite/TypeScript/Three.js 工程 | DONE | Bun 1.3.14 单一入口、精确依赖版本、strict build、Three.js renderer |
| V4 48 pattern 数据入口 | DONE | Content Authority 展开 13 个入口、验证 781 个物理文件/778 个 SHA-256、版本/ID/引用并生成确定性 digest |
| 120Hz fixed-step Lab simulation | DONE（基础） | 主循环已使用整数 120Hz master/60Hz due scheduler；默认应用仍使用旧 `GameSimulation` adapter，尚未装配新 authority kernel |
| Pattern authority | WIP | 48/48 NORMAL trace hash 与 96/96 safe-gap path 精确匹配 V4 oracle；三难度与应用增量 adapter 未完成 |
| Run Director | WIP | deterministic schedule、默认 RUN 接线与单测已完成；完整 encounter/narrative phases 未完成 |
| Run Memory | WIP | recorder/validator、ghost 压缩、storage adapter 与单测已完成；app archive/restore/IndexedDB 未完成 |
| Keyboard/pointer/gamepad | DONE（浏览器基础） | standard mapping、dead zone、hotplug、edge、可选 haptics；实机矩阵未完成 |
| PWA/图标 | DONE（基础） | manifest、SW、any/maskable 图标；升级事务/存档迁移未完成 |
| Unit tests | WIP | 135 tests / 14 files 覆盖 clock/event/content/oracle/projectile/player/laser/encounter/narrative 及既有 game 层；缺 authority→application、完整 Run、accessibility/perf |
| Playwright E2E/smoke | DONE（基础） | Bun/production preview/CI 已接通，6 Chromium E2E + 1 smoke；离线升级与完整 Run 门禁未完成 |
| Boss/laser/narrative/cross-run | WIP（authority） | 8×3 Boss phase、8 laser、16-state narrative/cross-run reducer 已有单测；live producers、默认应用与持久化未接通 |

因此当前正确称呼是“工业化基础 / playable reference”，不能称为 complete game、release candidate 或 production-ready。

## 3. P0：权威正确与完整可玩

P0 全部完成后才进入 Alpha 候选。

| ID | 工作 | 状态 | 完成定义 |
|---|---|---|---|
| P0-01 | Content index/schema/hash | DONE | 13 入口、40 版本、9 schema、818 ID、781 文件/778 hash/3 exclusion；dev/build fail-fast |
| P0-02 | 120Hz master + 60Hz runtime due-time | DONE（scheduler） | 30/60/90/120/144Hz、large delta、pause、一小时无漂移；V4 machine adapter 仍归各系统 |
| P0-03 | Canonical ordered event bus | DONE（authority） | 72 event、required payload、occurrence 去重、五阶段顺序、只读 feedback；旧 UI trace adapter 待移除 |
| P0-04 | 48 pattern oracle parity | WIP | NORMAL 48/48 trace、96/96 safe-gap、12 operator/13 geometry；三难度增量 runtime 尚缺 |
| P0-05 | Projectile authority | WIP（authority） | 7-stage、entity-owned flight、swept circle/capsule、固定 pool、generation graze 已完成；`GameSimulation` adapter 尚未替换 |
| P0-06 | Player/damage/Override | WIP（authority） | leases、稳定多 hit、原子 fatal/non-fatal、respawn/handoff、evidence/graze、局部扇区与真实坐标 scar 已测；默认应用仍走旧实现 |
| P0-07 | Encounter/room Run | WIP | 旧 `RunDirector` 已接默认应用并满足完整时长骨架；新 authority combat plan 覆盖 room/wave/segment/transition 与单个 terminal Boss，二者尚未合并成完整 Run |
| P0-08 | Boss 与 laser | WIP（authority） | 8 Boss × 3 phase 事件机、8 laser lifecycle/连续碰撞已测；phase 条件求值、Boss↔pattern/projectile/laser 组合与 app/renderer adapter 未完成 |
| P0-09 | Narrative/world memory | WIP（authority） | 16 state、64 observations、8 Boss resolution projection 与 material→ghost→residue→witness→input 顺序已测；live producers、archive/restore、IndexedDB 与 app E2E 未完成 |
| P0-10 | Deterministic save/replay | WIP | seed/input/content digest/trace hash；canonical serializer；同输入可重放 |
| P0-11 | 测试/CI | WIP | type/unit/build、4 V4 validator、E2E/smoke 已自动化；oracle/accessibility parity 与长期 artifact 未完成 |
| P0-12 | 文档/扩展治理 | DONE（基础） | 架构、设计、测试、路线图与 Extension ADR gate 已落地；后续扩展逐项执行 |

P0 发布硬门：0 schema warning、0 unknown operator、0 orphan event、0 fixed projectile flight timeout、0 feedback→gameplay edge、0 accessibility trace mismatch。

已知的 V4/adapter 边界必须保持显式：`broken_polyline` 与 `scrolling_comb` 未声明 beam width，laser authority 暂以 manifest 的 `sampleTolerancePx = 1.5` 回退；narrative source 中 `GLITCH`、`player.graze`、6 个 threshold action 与 canonical crossing payload 仍有缺口，reducer 不自行推断；`encounters.ts` 的 combat plan 不是包含 Awakening/Snapshot 的完整 Run。

## 4. P1：生产硬化与跨设备发布

P1 全部完成后才进入 Beta/Release Candidate 候选。

| ID | 工作 | 状态 | 完成定义 |
|---|---|---|---|
| P1-01 | 完整视觉绑定 | TODO | 7 atlas/448 frame、16 reaction overlay、4 room 背景与 fallback 全引用验证 |
| P1-02 | Feedback/accessibility graph | WIP | audio/visual/haptic/UI 单向 sink；Full/Reduced/Flash-Off trace parity 与 fallback |
| P1-03 | 音频图 | WIP | 48 WAV 绑定、room bed、ducking、unlock、丢失 cue 降级、资源预算 |
| P1-04 | 工业手柄 | WIP | Xbox/DualSense/Switch/通用/移动实机矩阵；remap profile；连接状态诊断 |
| P1-05 | IndexedDB + PWA | TODO | versioned migration、atomic archive、quota/损坏恢复、离线 N→N+1 更新事务 |
| P1-06 | Renderer 性能 | TODO | sprite/projectile pool、texture/material 生命周期、draw-call/heap/GPU benchmark、10 分钟 soak |
| P1-07 | UI 与可访问性 | WIP | RUN/LAB 边界、键盘 focus、390px、文本/非闪烁替代、诊断与导出 |
| P1-08 | Release engineering | TODO | reproducible build、Git/content/extension digest、artifact signing/checksum、rollback notes |
| P1-09 | 浏览器/设备矩阵 | TODO | Desktop + Mobile PWA 在线/离线/后台恢复/弱网，风险有 owner 与期限 |

P1 只做生产所需硬化。新的房间、敌人或装饰内容不能挤占权威/性能/持久化缺口。

## 5. P2：有基准后再做的工具

P2 不应提前进入主运行时：

| ID | 工作 | 进入条件 | 约束 |
|---|---|---|---|
| P2-01 | Pattern/trace inspector | P0 oracle 已稳定 | 只读；不得成为第二套权威 |
| P2-02 | Manifest authoring/preview | schema/content index 已稳定 | 产物必须走同一 validator/Extension ADR |
| P2-03 | Deterministic replay viewer | canonical replay 已稳定 | viewer 不修正或补写 trace |
| P2-04 | Privacy-preserving telemetry | 有具体发布决策问题 | 默认关闭；记录行为事实而非玩家 rank；可导出/删除 |
| P2-05 | Worker/WASM 优化 | profile 证明主线程为瓶颈 | 同 trace hash；无共享时序隐患；可回退单线程 |
| P2-06 | 多 renderer/实验 projection | 核心/投影依赖门禁完成 | 不复制 simulation，不改变 accessibility parity |

## 6. 里程碑

### Alpha：完整权威闭环

- P0 全绿；
- 固定 seed 可从 Awakening 跑到 Snapshot/Archive，再进入下一 Run restore；
- 48 pattern、8×3 Boss、8 laser 和 16-state narrative 可执行；
- 无 score/rank/moral ending；行为与材料 ledger 可检查、可重放。

### Beta：生产环境闭环

- P1 全绿；
- PWA 在线/离线/升级/迁移通过；
- 性能 soak 和实机手柄矩阵有归档证据；
- 发布包能报告 Git/content/extension digest。

### Release Candidate：只修阻断

- 冻结内容 digest；
- 只接受安全、数据损坏、确定性、崩溃、可访问性和发布阻断修复；
- 每次修复重跑完整验收并生成可回滚 artifact。

## 7. 开发流与提交边界

建议按可验证垂直切片提交，而不是按文件类型堆积：

1. `chore(content): ...`：schema/index/hash 与 fixture；
2. `feat(authority): ...`：clock/event/order，附 parity tests；
3. `feat(gameplay): ...`：一个可闭环 operator/lifecycle/Boss slice；
4. `feat(narrative): ...`：一个 state + material record + restore test；
5. `test(e2e): ...`：对应用户路径；
6. `docs: ...`：同步 ADR/验收/迁移。

每个提交都必须能独立说明权威变化、验证命令和回滚范围。不要把 asset kit、运行时重构、生成素材和文档塞进一个无法审查的提交。V4 外扩展提交必须带 [CONTENT_EXTENSION_ZH.md](./CONTENT_EXTENSION_ZH.md) 的 ADR/provenance。
