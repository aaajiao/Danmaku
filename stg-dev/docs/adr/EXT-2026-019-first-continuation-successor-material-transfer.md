# EXT-2026-019：首个 continuation successor 的材料转交边界

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置：[EXT-2026-015](EXT-2026-015-first-continuation-room-plan-and-pool-admission.md)、
  [EXT-2026-016](EXT-2026-016-first-continuation-terminal-material.md)、
  [EXT-2026-017](EXT-2026-017-first-continuation-session-projection.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：chapter owner / material lifecycle / pool capacity lease / next-occurrence admission seam；不修改 V4、
  canonical event、RNG stream、composer segment、room completion、handoff、asset、audio、archive 或 dependency

## 不可约事实（Metadata）

EXT-016 允许首个 successor occurrence 在释放 gameplay claim 后继续推进 residue，但 exact slice close 时，
正式 `room.in_between.context_switch` producer 仍有 46 个 collisionless residue。等待它们 drain 会把 V4
`materialSettle + rest` 重新解释成可碰撞玩法门；清除它们则会删除 entity-owned lifecycle。

此时 EXT-013 transition material 已经排空，但其 capacity lease 尚未被显式退休；successor residue 又仍由
已经完成切片的 owner 持有。没有新的所有权边界，下一次 plan 无法区分“可以退休的旧 allocation”和“必须
继续计入预算的在场材料”。46 是当前 formal producer 的 exact source fact，不是通用 pool 常量；通用边界
转交来源 snapshot 中的完整 material set。

无形容词机制句：exact slice-close tick 已唯一 flush 后，prepare/commit 在同 tick 退休已排空的 transition
capacity lease，并把 successor 的原 pool、projectile identity 与 cleanup deadline 转给 sealed occurrence
material carryover；该提交不推进 tick、不写 event、不消费 RNG，下一 occurrence 继续 typed withheld。

## 负空间（Behavior > Content）

屏幕上的弹体已经不再碰撞，但它们仍占有 generation、slot 与剩余寿命。等待材料消失会把不可见的 allocation
变成额外关卡时间；只按 `materialCount` 下降释放预算，则会让同一 slot 在材料仍有 lineage 时被重复占用。

本扩展让“数字身体结束、材料仍在”的重叠可被下一次准入观察。它不增加代表材料的图标，也不把淡出动画
当成释放证据；只有 authority 的显式 lease retirement 可以改变容量归属。

## 数字—物质双螺旋

- digital authority：exact slice-close source、旧 owner lineage、原 pool allocation、projectile generation/
  identity、material deadline 与一次性 transfer receipt。
- material authority：46 个 collisionless residue 按原 occurrence/source identity 继续到各自
  `projectile.residue.remove → projectile.lifecycle.complete`，不复制、不改名、不重计时。
- join：已排空的 transition material lease 可在同一原子提交中退休；新 occurrence material carryover 的
  `allocatedSlots` 在它被显式释放前始终进入后续 combined admission。
- witness / restore：本切片不新增 archive、跨 Run record 或 restore 规则；公开 snapshot 不是可消费 receipt。

## 做减法结果

- 复用 V4 projectile lifecycle、现有 run-owned event bus/pools、EXT-015 capacity 口径与 EXT-016 terminal
  material port；不新增 projectile、residue、事件、计时器或视觉层。
- 抽出一个 occurrence-neutral 的 sealed material carryover，而不是为每个 pattern 复制材料 owner；本决定只
  授权首个 continuation successor 使用，其他 chapter 仍须在各自 admission 边界证明来源与预算。
- 不在本切片选择、规划、reserve、claim 或执行下一 occurrence；不接 Canonical Run Session，也不宣称
  多 pool join 已完成。
- 新增预算：canonical event 0；RNG draw 0；asset 0 bytes；dependency 0；material-transfer boundary 1；
  capacity lease retirement 1。

## 治理与非单一化

转交只接受当前 formal selection 真实产生的 exact source，不因 residue 数量、pattern class 或实现能力而重抽
或替换下一 pattern。键盘、手柄、weather、reduced motion 与 flash-off 不进入该 authority；表现缺席不会
缩短 lifecycle。该边界不产生 score、rank、胜负、好坏结局、玩家画像或 telemetry。

aaajiao 审核材料不被清空、等待不成为新玩法门以及 allocation 的可见归属；Codex 实现 opaque receipt、
owner retirement 与 focused evidence。新增素材、外部服务和隐私表面均为 0。

## 行为契约

1. formal source 必须是 EXT-016/017 的原 in-memory successor owner，并处于 exact slice-complete、sole-flushed
   boundary。`activeOccurrenceId`与pending release均为空，pattern 已 complete，digital body与live collider
   为0，剩余 projectile 全为 collisionless residue。当前正式 source 的 material count 固定为46；通用
   carryover 不把46编码成其他 occurrence 的准入规则。
2. prepare 是纯验证：复验同一 Run/state/bus、tick、content identity、owner lineage、pool identity、完整
   projectile set、无重复 generation identity，以及旧 transition material 已 drained 且其 capacity lease 可
   退休。clone、JSON round-trip、跨 Run 拼接、重复使用、stale tick、非空 collider或material drift均拒绝。
3. commit 只能发生在该 tick 已 flush 后；`tickAdvance=0`、`canonicalEventWrites=0`、`rngDraws=0`。成功提交
   原子完成三件事：使旧 successor step owner永久失效；退休已排空的 transition material capacity lease；
   铸造唯一 occurrence material carryover。任一步验证失败都不得留下部分 owner 或 lease mutation。
4. carryover 保留原 projectile pool、class mapping、slot/generation/instance identity、source pattern与occurrence、
   terminal reason及cleanup deadline。它只可从下一 accepted tick逐 tick推进现有 residue；不得spawn、arm、
   collision、RNG、contact、damage、graze、Override、metric、selection、room FSM或presentation写回。
5. transition lease只有在material与active entity均为0且本次commit显式退休后，才从后续预算中移除。新的
   carryover按原 pool的`allocatedSlots`计入容量，即使`materialCount`后来变为0也不自动释放；只有显式
   carryover release才归还该lease，禁止按active/residue数量偷偷扩大预算。
6. transfer snapshot 明确保持 `roomCompletion="withheld"`、`roomHandoff="withheld"` 与
   `nextOccurrenceAdmission="withheld-pending-plan-and-combined-pool-admission"`。它只提供下一 plan/admission 可消费
   的 opaque material/capacity source，不签发 plan、reservation、occurrence claim或新 step owner。
7. 本切片的完成深度是 shared sealed boundary 加一个真实 successor producer 的直接消费证据；它不是 Session
   wiring、同 tick 双 owner coordinator、presentation union、完整 multi-pool admission、room close 或 handoff。
8. 后续 carryover step继续遵守pause冻结和现有same-tick event顺序；本次零事件 transfer不能重开已关闭的
   event tick，也不能把未来 residue cleanup 倒写到 slice-close tick。

## 被拒绝或延后的替代方案

- **等待46个 residue drain再规划**：拒绝；把 collisionless material 重新变成 gameplay gate。
- **slice close清空或重建 projectile**：拒绝；删除原 lifecycle，或制造第二组 identity/material history。
- **按 `materialCount=0` 自动释放 allocation**：拒绝；allocated slot 与当前可见数量不是同一事实。
- **让 complete successor owner同时持有旧 gameplay与下一 occurrence**：拒绝；混合已经撤回的数字权与新
  occurrence authority，且无法形成一次性 capacity source。
- **把旧 transition lease永久计入预算**：拒绝；其 material 已排空，显式退休后继续占用会制造假阻塞。
- **本切片同时完成下一 plan、Session与多 pool coordinator**：延后；这些有独立选择、预算和sole-flush
  风险，应由下一 vertical slice消费本 receipt后分别证明。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 做减法、行为优先、双螺旋、absence | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/runtime/runtime-contract-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | residue no collision、same-timestamp order | repository license | `29c97a1c3c20b15b90b9d6c70e3c9cb5f41b5ca9fe2a2831c9a961e768d12306` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | class/residue budget、terminal lifecycle | repository license | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | materialSettle、rest与tier budget | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `EXT-2026-015-first-continuation-room-plan-and-pool-admission.md` | predecessor admission contract | repository ADR | allocated-slot combined gate | repository source | `489b53e78152cc6606c925cfb613cc4ae74fddb1fa3c5e97e832dbecdc570a18` |
| `EXT-2026-016-first-continuation-terminal-material.md` | predecessor terminal contract | repository ADR | slice-close material hold | repository source | `0b08e64e31e64b3b038edda6ffb54fc01e9e52dcef99115596473ea90fad03b6` |
| `EXT-2026-017-first-continuation-session-projection.md` | predecessor Session contract | repository ADR | formal successor owner lineage | repository source | `4ec9dd3e431a8c19bbaa2b8b73146dd573a31a4cda9bcdcdb48f9172634bc853` |

## 验证证据

- 一个真实 successor producer推进到 exact slice close，证明46个 residue均collisionless，transfer前后
  tick/event trace/RNG cursor不变，projectile/pool/generation/source/terminal identity逐项相同，旧 owner不能再step。
- 同一 focused producer覆盖过早prepare、重复prepare、重复commit与旧owner再次step；失败路径保持Run和event
  serialization不变。其余伪owner、跨Run与stale state由opaque owner反查及commit重验证fail closed，本切片不把
  它们冒充已单独跑过的case。
- capacity证据固定旧transition空池78个allocated micro slots与successor material pool 80个allocated slots；
  transfer后的live lease只公开后者。snapshot继续把room completion/handoff/next admission标为withheld；
  drain后的显式release仍是后续切片，不在本轮声称已完成。
- focused test、strict typecheck与`git diff --check`作为实现提交gate。本切片不把Session、presentation、
  next-occurrence execution或multi-pool flow列为已通过证据。

## 回滚与迁移

删除 occurrence material transfer receipt、capacity retirement与sealed carryover端口，即回到EXT-016的
post-close material hold：旧 owner继续只推进residue，下一 occurrence保持withheld。不得以回滚为由等待
drain、清空材料、复用projectile identity或自动释放allocation。既有trace与EXT-015—017 provenance继续只读
保留；若以后统一所有chapter的material transfer，使用successor ADR并保留本决定。

## 决策

接受。该边界只把已经失去碰撞和选择权的材料从完成的数字 owner 中分离，同时把容量归还条件变成显式事实。
它让下一次 plan 能看到真实的材料预算，但不提前制造plan、Session、多pool组合、room completion或handoff。
