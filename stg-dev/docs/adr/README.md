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

## 新 ADR 规则

1. 一个文件只回答一个 durable 决定：背景、选择、替代方案、后果、provenance、验证与回滚。
2. 普通 capability 进度、coverage、测试输出和当前 backlog 不创建或更新 ADR。
3. 新 adapter seam、V4 omission policy、外部资产/内容或持久化兼容决定使用新的 focused ADR，
   并链接相关 architecture、tests、commit 与被继承的历史 ADR。
4. 移动 provenance 前必须保留原记录、commit/digest 和双向链接；不得用“整理文档”为由删除来源。
5. 命名保持 `EXT-YYYY-NNN-short-name.md`；状态变化写日期和 successor/predecessor。
