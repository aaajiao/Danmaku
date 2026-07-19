# EXT-2026-023：IN_BETWEEN 第二个 occurrence 的材料尾段与转交

- 状态：ACCEPTED（实施 pending）
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置：[EXT-2026-019](EXT-2026-019-first-continuation-successor-material-transfer.md)、
  [EXT-2026-020](EXT-2026-020-second-in-between-occurrence-plan.md)、
  [EXT-2026-022](EXT-2026-022-second-in-between-read-release.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- 内容扩展门：`CONTENT_EXTENSION_ZH.md`；SHA-256
  `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：chapter orchestration / material lifecycle / pool lease / sole-flush；不修改 V4、canonical event、
  pattern、素材、Session、presentation、第三 occurrence、room completion、archive 或 dependency

## 不可约事实（Metadata）

EXT-022 已在 global `8219` / READ local `1272` 释放 Misregistration gameplay claim。无伤 acceptance trace
仍保留80个 collisionless `misregistration_flake` residue；旧 Context Switch material 与更早 Room Threshold
lineage虽已排空，仍须和同一 Run tick 保持同步。V4 composer 同时规定 material-settle、rest 与 slice close，
但不会替应用层决定完成 occurrence 后的 owner 更换。

无形容词机制句：global `8220..8519`逐 tick 推进 Run player、idle room、两个已排空 lineage 与
Misregistration residue，只允许 entity-owned cleanup event；global `8519`按 composer 边界关闭 slice，退休旧
Context Switch material lease，并把仍在场的63个 residue 原样交给新的 sealed material owner。

## 负空间（Behavior > Content）

玩法 collider 已经缺席，材料占用没有缺席。等待 `8682` 最后一个 residue 消失才关闭 slice，会把看不见的
材料寿命变成额外关卡；在 `8519` 清屏则会删除17个已完成和63个仍在场 entity各自不同的时间史。

本扩展让“章节已关闭、材料仍占有 slot”成为可观察 authority。它不增加图标、倒计时或提示，也不从 alpha、
动画帧、声音或 renderer 判断完成；行为事实由 tick、projectile identity、cleanup deadline 与显式 lease transfer
共同给出。

## 数字—物质双螺旋

- digital track：EXT-022 original owner、global tick、composer segment boundary、Run/player/room sole-flush、
  collisionless gate与一次性 transfer receipt。
- material track：80个 Misregistration residue按原 source、generation、terminal cause与deadline继续；其中17个在
  slice close前自然完成，63个越过close继续存在。
- join：old Context Switch material虽然 count 已为0，其80-slot lease直到 `8519`原子提交才退休；新
  Misregistration 80-slot lease随63个 material identity转给下一 owner，不能按当前 count缩成63。
- witness / restore：本扩展不新增 archive、cross-run record或presentation；公开 snapshot不是可消费 receipt。

## 做减法结果

- 复用V4 `misregistration_flake` lifecycle、既有cleanup event IDs、EXT-016 released-material推进原则、EXT-019
  zero-tick transfer与EXT-020 committed pool evaluation。
- 不新建事件、计时器、弹体、素材、选择、RNG stream、room FSM或第三 occurrence plan。
- 不复用旧 material owner承载新的 occurrence identity；旧 Context Switch 与新 Misregistration 是两段 lineage，
  共享一个对象会掩盖哪一个 lease 在何时退休。
- 新增预算：canonical event ID 0；RNG draw 0；asset 0 bytes；dependency 0；tail/complete phase 1组；
  material-transfer boundary 1；新的 opaque material owner 1。

## 治理与非单一化

aaajiao审核“缺席但仍占用”的材料事实、章节时间不被残影绑架以及清屏不删除历史；Codex负责 exact tick、
owner、lease、event order和失败原子性。该路径不产生 score、rank、胜负、好坏结局、玩家画像或评价性
telemetry。

movement与Focus仍属于Run身体；合法damage后的recovery/respawn timer继续推进，不能成为tail或transfer的
完成门。Override在Local Resistance取得前保持锁定。weather、reduced motion、flash-off、键盘、触控与Gamepad
不得改变cleanup deadline、close tick或transfer结果；浏览器层parity等Session接线后验证。

## 行为契约

### 1. exact source与时间边界

- source只能是EXT-022在global `8219` sole-flush后留下的original opaque owner；必须绑定同一Run、event bus、
  idle `IN_BETWEEN` room、committed plan/evaluation、旧Context Switch material、已drain Room Threshold predecessor
  与Misregistration kernel。clone、JSON、跨Run、替换kernel或伪owner均无效。
- tail只接受exact-next global `8220..8519`。实现必须从plan和120Hz crossed-tick规则推导：

```text
gameplay release / material-settle start  8219  (combat local 1272)
first tail tick                          8220  (combat local 1273)
rest start                               8327  (combat local 1380)
slice close                              8519  (combat local 1572)
full residue drain                       8682  (combat local 1735; 本片之外)
```

- `material-settle`与`rest`是同一collisionless tail的两个composer segment，不重新claim occurrence、不重启
  combat，也不制造segment marker event。global `8519`必须关闭，不得延长到`8682`。

### 2. 每 tick 的 authority join

- 每个accepted tick在mutation前完整验证owner、exact-next input、两个旧lineage、new residue、idle room proposal、
  player/Override与空event queue。
- 同一Run transaction依次推进shared player/Run clock、已drain Room Threshold predecessor、已drain Context Switch
  material、Misregistration residue与idle room，封存expected event count后只由Run flush一次。
- 旧lineage必须保持drained并且不产生event；新lineage只能产生
  `projectile.residue.remove → projectile.lifecycle.complete`。不得spawn、arm、恢复collision、消费RNG、contact、
  damage、graze、metric、selection或room transition。
- cleanup保持canonical same-tick phase与稳定entity order；每个remove必须紧邻同identity的lifecycle complete，
  不能把未来cleanup倒写到release或slice-close tick。
- movement/Focus与player timer继续。Override press/release edge在任何mutation前拒绝；tail不要求player
  `runTimedStateQuiescent`，只要求Override仍为idle/locked。

### 3. slice close事实

- global `8519` accepted tick必须得到`activeOccurrenceId=null`、pending flush/release为空、room仍idle、两个旧
  lineage仍drained、new combat `patternComplete=true`、`digitalBodiesDrained=true`与`liveColliders=0`。
- seed 1 / EASY 无伤 acceptance trace在close时必须保留63个collisionless residue、80个allocated `micro`
  slots与126 RNG calls；tail只自然完成17个entity。63是该真实producer的验收事实，不是其他输入/occurrence的
  通用常量。
- close不要求`projectileLifecycleDrained`或`handoffReady`，不写room completion、handoff、session或第三
  occurrence事实，也不清除、复制、改名或重计时residue。

### 4. zero-tick材料转交

- prepare只在已flush exact slice-close边界签发一次性proposal；它复验Run/bus/tick、old/new kernel、完整
  projectile set、两个旧lineage、pool identity、无live collider、event serialization与无并行proposal。
- commit在同一个global `8519`原子完成：使旧next-occurrence step owner失效；退休已排空的Context Switch
  material lease；铸造唯一Misregistration material owner。Room Threshold lease已经在EXT-019退休，不得重复计入。
- prepare/commit均为`tickAdvance=0`、`canonicalEventWrites=0`、`rngCalls=0`。失败、取消、重复commit或stale
  proposal不能留下部分phase、owner或lease mutation。
- 新owner保留原kernel/pool、80-slot allocation、63个projectile的instance/generation/source/burst/index、terminal
  cause与cleanup deadline；即使后续count变为0，lease也只能在未来显式边界退休。
- snapshot保持`gameplayAuthority="released"`、`roomCompletion="withheld"`、`roomHandoff="withheld"`与
  `nextOccurrenceAdmission="withheld-pending-decision"`。本片不授予material hold、第三occurrence plan或Session。

## 被拒绝或延后的替代方案

- **等到8682再close**：拒绝；把collisionless material重新变成章节玩法时间。
- **8519强制清屏或缩短deadline**：拒绝；删除63个entity-owned material history。
- **按63个可见residue把allocation缩成63**：拒绝；slot lease不是当前数量，后续准入会得到假容量。
- **继续让EXT-022 owner永久持有材料**：拒绝；混合已关闭chapter step权与未来material ownership。
- **复用Context Switch material对象改写source**：拒绝；掩盖旧lease退休与新lineage开始的边界。
- **顺带规划第三occurrence、关闭room或接Session**：延后；它们有独立RNG、cardinality、projection与handoff门。
- **先实现完整drain hold**：延后；当前真实consumer只需要关闭并转交，不能用未消费的通用能力扩大切片。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；做减法、负空间、双螺旋 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `stg-dev/docs/CONTENT_EXTENSION_ZH.md` | Danmaku / aaajiao + Codex | mandatory gate | 完整读取；V4外composition与provenance | repository license | `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040` |
| `manifests/v4/package-manifest-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | package identity与authority order | repository source | `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | Misregistration lifecycle、residue与seed | repository source | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | segment与120Hz调度 | repository source | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | materialSettle、rest与pool budget | repository source | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | collisionless residue、cleanup与pool overflow | repository source | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `manifests/runtime/event-schema-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | canonical cleanup event IDs与payload | repository source | `31c69e627e35e0c8dea828e1564592d6fc71059fa9ce654f92c660114648f0bb` |
| `manifests/runtime/runtime-contract-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | material不得恢复gameplay authority | repository source | `29c97a1c3c20b15b90b9d6c70e3c9cb5f41b5ca9fe2a2831c9a961e768d12306` |
| `EXT-2026-022-second-in-between-read-release.md` | Danmaku / aaajiao + Codex | accepted ADR / `661c87e` | global8219 original owner | repository license | `c6a78842ecfefe1606ff2c2617f50ad3c6fb31fe144f094687842a7ed975f548` |

## 验证计划

- 复用同一真实producer，从EXT-022 owner推进global `8220..8519`；断言rest start、slice close、old lineage同步、
  cleanup-only event、0新增RNG/spawn/collision/damage、63 residue与80-slot lease。
- 覆盖skip/repeat tick、Override edge、过早close/transfer、重复prepare/commit与old owner失效；失败前后的Run、
  event serialization和owner snapshot必须相同。
- transfer前后比较tick、canonical event bytes、RNG cursor、projectile identity/deadline/pool；证明只改owner与旧
  material lease归属。
- focused producer、strict typecheck与`git diff --check`作为实现gate。本片不改bundle或player-visible路径，
  不运行build、smoke、E2E或browser；这些留给Session/presentation接线。

## 回滚与迁移

实现前回滚只删除本ADR索引和架构/路线图引用，EXT-022 owner仍安全停在`tail-advance-withheld`。实现后回滚时
移除tail/close/transfer consumer，保留EXT-022 exact source、V4 content digest与历史canonical trace；不得以
回滚为由等待drain、清屏、缩短deadline或自动释放capacity。未来若统一多generation material chain，以新ADR
supersede并保留本决定及首次实施commit。

## 决策

ACCEPTED，implementation pending。章节时间在global `8519`关闭，材料时间继续；63个在场residue与80-slot lease
必须显式转给新的opaque owner。最后drain `8682`、Session、第三occurrence、room completion与handoff继续withheld。
