# Architecture Decision Records

本目录保存不可逆或跨模块的设计决定，以及 V4 外扩展所需的 provenance。ADR 不是 changelog、
制作状态或测试总数账本；这些分别由 Git、`ROADMAP_ZH.md` 与可执行测试承担。

## 状态

- `PROPOSED`：正在评审，尚未成为工程约束。
- `ACCEPTED`：决定生效；除状态、明确 supersession 或带日期勘误外保持不变。
- `ACCEPTED / FROZEN`：历史 umbrella/provenance 记录，只读保留；后续决定使用 successor ADR。
- `SUPERSEDED`：由新 ADR 取代；旧记录和 provenance 仍保留，并双向链接。
- `REJECTED`：评审后未采用，保留拒绝原因。

## 索引

| ADR | 状态 | 责任 |
|---|---|---|
| [EXT-2026-001：PWA signal icon](EXT-2026-001-pwa-signal-icon.md) | ACCEPTED | V4 外 PWA identity、asset provenance 与回滚 |
| [EXT-2026-002：Canonical Run fragment adapters](EXT-2026-002-canonical-run-fragment-adapters.md) | ACCEPTED / FROZEN at `8e99ab4` | 历史 umbrella adapter 决定与接受时 evidence/provenance |
| [EXT-2026-003：Ash Memory history replay](EXT-2026-003-ash-memory-history-replay.md) | ACCEPTED | reverse history replay、离散 contact components 与 weather firewall |
| [EXT-2026-004：First Eye recovery handoff](EXT-2026-004-first-eye-recovery-handoff.md) | ACCEPTED | device-neutral gaze intent、30-tick Flower recovery projection 与 typed `ROOM_SAMPLING` boundary |
| [EXT-2026-005：首个 Forced Alignment 房间 bootstrap](EXT-2026-005-first-forced-room-bootstrap.md) | ACCEPTED | fixed non-composer bootstrap、seed domain、共享 authority 与完整 pre-read/READ 调度 |
| [EXT-2026-006：Canonical Run rolling 原始行为事实账本](EXT-2026-006-canonical-run-behavior-facts.md) | ACCEPTED | accepted-tick 机械聚合、owner/request/commit 分栏、handoff 归属与显式 missing |
| [EXT-2026-007：Canonical Run pre-room 行为事实冻结](EXT-2026-007-pre-room-behavior-capture.md) | ACCEPTED | H 后一次性 `[1,H]` raw-facts capture、exact-schema isolation 与 metric/composer firewall |
| [EXT-2026-008：首个 room occurrence 观察闭合冻结](EXT-2026-008-first-occurrence-observation-capture.md) | ACCEPTED | H+1701 post-occurrence raw-facts capture；room completion/selection/transition 继续 withheld |
| [EXT-2026-009：首个 fixed room 单 occurrence 关闭](EXT-2026-009-first-fixed-room-closure.md) | ACCEPTED | fixed bootstrap最小cardinality、H+1702 room closure与bounded typed visit fact；metric/selection/transition仍withheld |
| [EXT-2026-010：首房 closure 的 typed metric projection](EXT-2026-010-first-room-metric-projection.md) | ACCEPTED | H+1702投影2项available ratio与12项typed missing；composer/selection继续withheld |
| [EXT-2026-011：首房 recent input union](EXT-2026-011-first-room-recent-input-density.md) | ACCEPTED | 首房per-channel-consumed同tickactive union与`recentInputDensity`；projection仍partial |
| [EXT-2026-012：首房 partial facts 的下一房 target](EXT-2026-012-first-continuation-room-target.md) | ACCEPTED | 保留typed missing，只用available bias和一次Mulberry32 draw冻结ordinal 1 target；不接transition |
| [EXT-2026-013：首个 continuation target 的 room transition](EXT-2026-013-first-continuation-room-transition.md) | PROPOSED | H+1703拼接atomic FSM与Room Threshold；650ms身份稳定、7800ms gameplay交接及material-only carryover |

## 新 ADR 规则

1. 一个文件只回答一个 durable 决定：背景、选择、替代方案、后果、provenance、验证与回滚。
2. 普通 capability 进度、coverage、测试输出和当前 backlog 不创建或更新 ADR。
3. 新 adapter seam、V4 omission policy、外部资产/内容或持久化兼容决定使用新的 focused ADR，
   并链接相关 architecture、tests、commit 与被继承的历史 ADR。
4. 移动 provenance 前必须保留原记录、commit/digest 和双向链接；不得用“整理文档”为由删除来源。
5. 命名保持 `EXT-YYYY-NNN-short-name.md`；状态变化写日期和 successor/predecessor。
