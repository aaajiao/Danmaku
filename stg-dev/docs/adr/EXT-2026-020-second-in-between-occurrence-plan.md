# EXT-2026-020：IN_BETWEEN 第二个 occurrence 的计划与准入

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 实施 commit：`2b85078d4bc04067ec26e52e819d9612f4cb2be1`
- 前置：[EXT-2026-015](EXT-2026-015-first-continuation-room-plan-and-pool-admission.md)、
  [EXT-2026-018](EXT-2026-018-misregistration-orbit-release.md)、
  [EXT-2026-019](EXT-2026-019-first-continuation-successor-material-transfer.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：chapter composer continuation / occurrence plan / combined pool admission；不修改 V4、canonical
  event、已完成 occurrence、材料生命周期、room completion、session、asset、audio、archive 或 dependency

## 不可约事实（Metadata）

EXT-019 已把首个 continuation occurrence 的 gameplay authority 释放，并在 exact slice-close tick 保留
`room.in_between.context_switch` 的 46 个 collisionless residue、原 projectile identity 与 80 个已分配
`micro` slots。该材料不会伤害玩家，但仍占用容量；如果没有下一次正式计划，Run 只能停在材料 hold。

V4 composer 有四项 IN_BETWEEN pool、带权无放回算法、intensity tier 与 QA 选择器，但没有规定 fixed bootstrap
之后的 live RNG 游标、后续 occurrence salt、精确 segment 标量或 material carryover 与下一 reservation 的原子
连接。

无形容词机制句：EXT-019 exact source 在同一已 flush tick 上延续 application composer stream 的 draw 2，
从移除 Context Switch 后的 pool 选择 Misregistration Corridor，并以保留材料加新 reservation 完成一次
encounter ordinal 1 的零 tick、零 canonical-event 准入。

## 负空间（Behavior > Content）

屏幕上残留的 46 个 flake 容易被误当成等待关卡结束的计时器。它们实际只记录上一 occurrence 的材料寿命；
下一次选择由 composer state 决定，不由残影是否消失决定。

本扩展不增加提示、敌人或路线标签。它让“上一数字身体已经退出、材料仍在、下一计划已经确定”三个事实同时
可观察，并继续拒绝用清屏、等待、重抽或当前 executor 便利性改变路线。

## 数字—物质双螺旋

- digital authority：原 formal target/plan lineage、draw 1 后的 Mulberry32 state、已选 pattern 集、room tier、
  encounter ordinal 1、resolved occurrence seed 与 combined reservation。
- material authority：Context Switch 的 46 个 collisionless residue、80 个 retained `micro` allocated slots、
  generation/source identity 与原 cleanup deadline。
- join：同一 source tick 上先验证 retained lease，再冻结下一 plan 和 reservation；材料继续老化，但不拥有
  selection、spawn、collision 或 room-completion authority。
- witness / restore：本扩展不新增 archive、跨 Run record 或恢复字段；公开 snapshot 不能消费 formal source。

## 做减法结果

- 复用 V4 `composer.in_between`、三个剩余 pattern、Mulberry32、结构签名、EASY tier、encounter segment 范围、
  projectile pool budget，以及 EXT-018 已支持的 Misregistration executor。
- 删除重新采样 metric、等待 residue drain、重放 draw 0/1、能力过滤、reroll、weather echo、room close、
  presentation、asset 与 persistence。
- 仍需新增的只有一个窄 live join：EXT-019 source 到 encounter ordinal 1 formal plan/combined admission。
- 新增预算：composer RNG draw 1；formal plan 1；reservation 1；canonical event 0；tick advance 0；
  gameplay asset 0 bytes；dependency 0；persistence field 0。

## 治理与非单一化

aaajiao 审核不等待材料、不因实现能力换 pattern、以及无放回路线仍保留多种结果；Codex 负责 exact source、
RNG、seed、segment 与容量验证。选择不产生 score、rank、胜负、好坏房间、玩家画像或 telemetry。

键盘、触控、Gamepad、weather、reduced motion、flash-off 与 renderer 均不能进入 selection。当前 seed 1 选择
Misregistration 是一条可复现路径，不是默认路线；其他合法 seed 即使选择暂不支持的 pattern，也必须保留原
结果并 typed-withhold admission。

## 行为契约

### 1. exact source 与原子边界

- source 只能由 EXT-019 原 in-memory material carryover 的 module-private receipt 签发，并绑定同一 Run、bus、
  target room、首 plan、slice-close tick、projectile pool、material identities 与 selection state。公开 clone、
  JSON round-trip、跨 Run 拼接或只提交数字摘要均无权规划。
- source 必须处于已 flush 的 `successor-material` boundary：active occurrence、pending release/flush 与 event queue
  均为空；旧 transition material lease 已退休；retained projectiles 全为 collisionless residue。
- EXT-019 transfer 自身继续保持 RNG 0。EXT-020 plan 只推进 composer continuation stream 一次；combined
  admission 不再消费 RNG。整个 plan/admission 不推进 master tick、不写 canonical event，也不推进 residue。

### 2. draw 2 与无放回选择

EXT-012 用 draw 0 选择 target，EXT-015 用 draw 1 选择首 pattern。EXT-020 从正式首 plan 的
`stateAfterDrawUint32` 继续同一个 application-authored domain，消费 zero-based draw ordinal 2；禁止从raw seed
另开 stream、重播历史 draw、按 capability 过滤或失败后重抽。

首 pattern `room.in_between.context_switch` 从 composer pool 移除，剩余 declaration order 与权重为：

```text
room.in_between.stable_intersection       1.08
room.in_between.misregistration_corridor  1.16
room.in_between.borrowed_rule             1.24
```

三个候选的 V4 structural signature 都不同于 Context Switch，因此 immediate signature penalty 都是 `1`，
`candidateTotalWeight=3.48`。当前正式 raw seed `1` 的 exact evidence 为：

```text
continuedFromStateAfterDrawUint32 = 3663131627
drawOrdinal                         = 2
drawValue                           = 0.5274470399599522
stateAfterDrawUint32                = 1199730144
cursorInitial                       = 1.8355156990606338
selectedPatternId                   = room.in_between.misregistration_corridor
selectionRngDrawsTotal              = 3
```

cursor 按上列顺序减去 `1.08` 后仍为正，再减 `1.16` 后命中 Misregistration Corridor。结果不允许因 pool、
Session 或 renderer 尚未接好而替换。

### 3. tier、occurrence seed 与 segment

V4 QA 在进入一个 room 时只计算一次 intensity tier，再给该房三个 pick 共用。EXT-020 因此复用首 formal plan
已经冻结的 `listen / EASY`、`maxProjectiles=80`、`maxEmitters=2` 与 `restMs=1600`；不重新读取行为账本，
也不把 source window 之后的 missing metric 补成数字。

第二个 occurrence 固定为：

```text
occurrenceId   = run:room:1:encounter:1:room.in_between.misregistration_corridor
roomOrdinal    = 1
encounterOrdinal = 1
difficulty     = EASY
difficultySalt = 0x2201
resolvedSeed   = 1 xor 4108504342 xor 1 xor 0x2201 = 4108513047
```

`0x2201` 是 application 为本次 occurrence 新增的 domain separator。V4 没有 difficulty-salt mapping；它不能
被描述为 V4 全局公式，也不能自动推出 encounter ordinal 2 的 salt。

精确 segment 继续采用 EXT-015 的最小非早策略，但只授权本 occurrence：

```text
telegraph=520ms / entry=800ms / read=10600ms /
materialSettle=900ms / rest=1600ms / safeGapHandoff=520ms
```

parallel 固定为 `none`。weather echo 的 membership 与 seed 仍不构成 live scheduling authority。

### 4. combined pool admission

当前 exact EXT-019 source 与 EASY reservation 的保守 join 为：

```text
retained allocated micro = 80
new reserved micro        = 80
combined micro            = 160 <= V4 2048

retained residue visuals  = 46
new reserved residue      = 80
combined residue visuals  = 126 <= V4 1536

emitters                   = 2 <= tier 2
new projectile reservation = 80 <= director EASY cap 120
live carryover colliders   = 0
```

因此该 exact source 的 admission 为 committed。`80/46/160/126` 是当前 producer evidence，不是通用常量；
任何 material、allocation、class mapping、emitter、tier 或 content drift 都必须重新按 source 数值 fail closed。
retained lease 在 materialCount 降为 0 后也不自动归还，只有后续显式 release 才能改变预算。

成功 commit 在 source tick 铸造 dormant encounter-1 owner；该 tick 不执行 telegraph。最早只可在下一
accepted master tick 开始 telegraph。执行时 collisionless old material 必须与新 owner 共享 sole-flush 顺序，
但该双 pool tick coordinator 与 Canonical Run Session 接线不在本扩展范围内。

### 5. V4 oracle 差异与 withheld 边界

- `sim_core.py` 的 full QA composer 先选完所有 rooms，再为每房选 patterns；其默认 `room_count=3` 只是函数
  默认值。当前 application 在 fixed bootstrap 后用 draw 0/1/2 逐步选择，不能声称与 full QA cursor 相同。
- V4 run manifest 只给 `roomsSampled=[2,4]`，没有 live exact room count；后续 room order继续为 `null`。
- room composer 写有 `cooldownEncounters=2` 与 `sameStructuralSignatureWithin=3`；QA oracle 则从本房 pool
  直接移除已选 pattern，并只对上一 structural signature 施加 `0.15` penalty。当前四个 signature互异，
  所以该差异不改变本次结果；其他数据下必须单独决策，不能泛化。
- encounter director 写 `runSeed xor roomOrdinal xor encounterOrdinal`，pattern manifest 写
  `runSeed xor base xor encounterOrdinal xor difficultySalt`，QA schedule 又使用
  `runSeed xor base xor roomOrdinal xor encounterOrdinal`。`0x2201` 明确解决本 application join，不宣称修订V4。
- QA 每房最多选择三个 pattern，并在第三个 rest 后 `room.withdraw`。本扩展只授权 encounter ordinal 1；
  encounter ordinal 2、它的 draw/salt/plan/admission、room completion、handoff、Boss 与后续 room全部 withheld。
- 任一 source、selection state、content identity、tier、seed、segment或容量复验失败，都必须在plan/admission
  mutation前返回typed withheld；离线使用同一tracked V4来源，不存在网络降级或备用选择器。

## 被拒绝或延后的替代方案

- **等 46 个 residue 排空再选**：拒绝；把 collisionless material 变成额外玩法门。
- **释放 retained 80 slots 后再准入**：拒绝；材料 lineage 尚在，slot lease 不能由可见数量代替。
- **从完整四项 pool 重抽或选择当前最方便项**：拒绝；破坏 without-replacement 与路线多样性。
- **直接复用 V4 full QA cursor**：拒绝；其 room-selection draw 顺序与 fixed-bootstrap application domain不同。
- **重新计算 tier 或补齐 missing metric**：拒绝；没有新的正式 metric window/producer。
- **本片同时接 Session、双 pool tick、第三 occurrence 或 room close**：延后；这些是独立 owner/handoff决定。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；absence、做减法、双螺旋、非单一化 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | 2–4 rooms、无重复room、Mulberry32；无exact live room count | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | IN_BETWEEN pool、weights、tier、constraints | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | segment ranges、safe-gap、EASY cap、parallel | repository license | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | pool/residue budget与collisionless lifecycle | repository license | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | Misregistration duration、base seed、emitters、residue | repository license | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `gameplay/reports/pattern-structure-signatures-v4.json` | V4 package / aaajiao | generated report / 4.0.0 | exact signature comparison | repository license | `a91e29043276280412c3a823949b04d2fdfc5ef7d5e48c5b9ca9ffea67a9e571` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / 4.0.0 | weighted cursor、remove、tier once per room、three picks；非live cursor policy | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `EXT-2026-015-first-continuation-room-plan-and-pool-admission.md` | Danmaku / aaajiao + Codex | accepted ADR | draw 1、首plan、segment与combined budget前置 | repository license | `489b53e78152cc6606c925cfb613cc4ae74fddb1fa3c5e97e832dbecdc570a18` |
| `EXT-2026-019-first-continuation-successor-material-transfer.md` | Danmaku / aaajiao + Codex | accepted ADR | exact 80 allocated / 46 residue transfer source | repository license | `c96a5865185c8b8b7dce102f9c6a4aaf7a3660d140d23b2a3b5b9ead3d8cda02` |

## 验证证据

- 设计阶段只读审计确认 raw seed 1 的 draw 2、candidate order、weight cursor、Misregistration base/duration、
  EASY tier与V4 pool上限。
- `first-continuation-transition.test.ts` 的exact producer路径证明draw 2、formal plan、`160/126` capacity join、
  zero-event/zero-tick/zero-claim dormant commit、重复消费拒绝、旧material hold失效，以及telegraph最早为下一tick；
  该focused文件9/9通过。
- `bun run typecheck`与`git diff --check`通过。Session、浏览器、full/reduced-motion/flash-off与完整Run门禁留到
  双pool coordinator进入player-visible路径时运行，不在本零tick切片重复消耗开发时间。

## 回滚与迁移

回滚时移除encounter-1 plan/admission consumer，让现有EXT-019 source恢复typed withheld；保留首occurrence、
材料identity与lease为只读，不迁移archive或content digest。
如果未来采用不同的full composer cursor、salt或room-count policy，使用successor ADR并保留本记录与exact
seed-1 evidence，不静默改写。

## 决策

ACCEPTED。只关闭 encounter ordinal 1 的 plan/admission：继续 application draw 2、无放回选择
Misregistration Corridor、复用EASY tier、显式采用`0x2201`、提交当前`160 micro / 126 residue`联合预算，并把
执行留到下一 master tick。代码已在`2b85078d`实现exact source到dormant owner的原子交接；第三occurrence、
room completion、Session与双pool tick coordinator继续withheld。
