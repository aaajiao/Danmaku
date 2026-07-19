# EXT-2026-005：首个 Forced Alignment 房间 bootstrap

- 状态：PROPOSED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置记录：[EXT-2026-004](EXT-2026-004-first-eye-recovery-handoff.md)
- aaajiao skill：`1.1.1`；SHA-256 `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256 `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256 `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：authority / simulation / narrative handoff / projection；不修改 V4、asset、canonical event ID、dependency 或 persistence schema

## 不可约事实（Metadata）

EXT-2026-004 只证明 First Eye 在 source combat、Gaze 与 Flower 全部完成后，可以把 authority
交给 `ROOM_SAMPLING`。当前默认 RUN 在该 tick 之后仍没有 consumer。仓库已有的
`CanonicalLiveRoomExecutionFragment` 不能直接接入：它从 caller-established READ 开始，跳过
telegraph/entry，并创建新的 event bus 与 run combat state，因此会丢失玩家位置、生命、证据、Override
和 occurrence ledger。

删除本扩展后不可记录的事实是：First Eye 排空后的同一个玩家身体和 canonical trace，经过一段没有
spawn/collider 的预读时间，进入首个真实 room pattern；来源 trace 必须仍是后续 trace 的完整前缀。

无形容词机制句：在 handoff tick `H` 安装一个固定的 Forced Alignment bootstrap，`H+63` 结束
520ms telegraph，`H+159` 结束累计 1320ms pre-read，并在同一 run combat state 上以 READ local tick 0
启动 `room.forced.left_right_gate`。

## 负空间（Behavior > Content）

界面已经能显示 Forced Alignment 的音床、pattern 名称与独立 Lab 预览，但这些内容不能证明默认 RUN
实际进入了房间。扩展不新增房间图标、说明文案、过场动画或奖励；它让“source 排空—无碰撞预读—
同一身体进入下一 occurrence”成为可执行、可重放的 authority 关系。

## 决定

### 1. 固定 bootstrap，不冒充 V4 composer

- 首个生产 vertical slice 固定为 `FORCED_ALIGNMENT`、`composer.forced_alignment`、
  `listen / EASY`、room ordinal `0`、encounter ordinal `0`、
  `room.forced.left_right_gate`。
- selection authority 明确为 `ext-005-fixed-first-room-bootstrap`；`composer=false`、
  `weightedSelection=false`、selection RNG draw `0`。它不是 V4
  `weighted_without_replacement` 的结果，也不声称 declaration order 等于选择结果。
- 本切片只执行一个 admitted-by-policy occurrence。结束时是 `first_room_slice_complete`，不是
  room complete，不增加 `distinctVisited`，不退出 `ROOM_SAMPLING`，也不生成下一房 handoff。
- V4 的 2–4 room count、14 项 live behavior-ledger producer、完整单流 RNG、pattern
  without-replacement、Boss 与 parallel weather 均保持未决；后续真正 composer 必须用 successor ADR
  supersede 本 bootstrap，不能读取测试 fixture 或 QA default 冒充 live policy。

### 2. 顶层 raw Run seed 与 occurrence seed 分域

- 默认 RUN 的顶层 identity 改为 domain-tagged `raw-run-seed`。URL `seed` 显示和解析该 raw uint32；
  不再把它描述成已解析的 First Eye encounter seed。
- First Eye resolved seed 固定为
  `rawRunSeed xor common.eye_acquisition.seed.base xor encounterOrdinal(0) xor 0x0100`。
- 首房 resolved seed 固定为
  `rawRunSeed xor room.forced.left_right_gate.seed.base xor encounterOrdinal(0) xor 0x1100`。
- `0x0100` 与 `0x1100` 是 application-authored difficulty-salt mapping，只服务本 bootstrap；snapshot
  必须同时暴露 raw 与 resolved identity，禁止把同一数值静默换 domain。
- 旧 URL 没有 archive/persistence schema，因此不迁移存档；旧链接的弹道会改变。显式 raw seed 与同一
  input trace 仍须得到同一 canonical serialization。

### 3. 首房直接安装与 exact tick ownership

- First Eye 使用 `INFORMATION` 只是 `common.eye_acquisition` kernel 所需的 combat room context，不构成
  mental-room 已访问事实。首个 sampled room 因此在 `H` 直接安装，不调用需要 canonical
  `fromRoom` 的 `RoomTransitionAuthority`，也不伪造 `PROLOGUE`、same-room transition 或
  `room.enter` event。
- `H` 已由 First Eye owner 精确关闭。bootstrap constructor 只锁存 immutable plan/boundaries，不再消费
  `H` 的 input、不 flush、不发 event；`H+1` 才由 room pre-read owner 消费下一帧。
- `CanonicalEventBus`、`CanonicalRunCombatState`、player damage/evidence/Override/position 和 occurrence
  ledger 全部复用；不得把 mutable state 或 bus 暴露在 snapshot。
- pre-read 与 READ 期间，Gaze/Flower 继续由既有 V4 authority 在同一 tick enqueue；shared run state
  保持唯一 flush owner。ROOM_SAMPLING 尚未解锁 Local Resistance，因此 Override edges 不进入 room kernel。

### 4. 分段、safe gap 与 terminal tail

- 采用 V4 已声明范围内、并与现有 Left/Right exact fixture 一致的时长：telegraph `520ms`、entry
  `800ms`、READ `10200ms`、material settle `1050ms`、rest `1600ms`、safe-gap handoff `520ms`。
- 毫秒用 cumulative first-non-early master tick 投影：telegraph `+63`、READ start `+159`、
  material settle `+1383`、rest `+1509`、slice complete `+1701`。READ start tick 只建立 local tick 0，
  不把同一 input 再交给 kernel。
- First Eye handoff 在 `H` 已证明 live entities/colliders/residue 为零；`H..H+62` 不创建 room kernel，
  因而 520ms incoming handoff 是 collider-free temporal absence。截图或 alpha 不参与该证明。
- Left/Right `seam_filament` 的 2631ms lifetime 在 READ start 后 `+1540` master ticks 排空，早于
  slice complete `+1542`；最后两个 tick 只作 eventless neutral closure。若 lifecycle、run-owned timer
  或 occurrence 尚未 quiescent，slice fail-stop，不提前完成。
- 预算沿用已验证 counting policy：active arm/flight peak `56 <= listen 80 <= EASY director 120`；
  含 residue authority entities peak `77` 只作观察，不把累计 spawn 当并发 budget。pool 满时仍拒绝回收
  live collider。

### 5. 事实表达与呈现

- 不新增 canonical IDs。`room.ledger.sample`、`room.enter`、`encounter.begin`、`segment.*`、
  `material.settle` 等 narrative/QA label 不进入 event bus；selection、phase 与 boundary 是 immutable
  composite snapshot facts。
- 呈现只读 room/pattern/phase/combat snapshot；telegraph/entry 必须为 0 projectile、0 collider。READ
  projectile 与 safe gap 来自真实 `CanonicalCombatKernel`，不能由 UI timer 或 renderer 生成。
- Full、Reduced Motion、Flash-Off 使用同一 gameplay trace；profile 只改变帧选择。

## 数字—物质双螺旋

- authoritative input/event/state：raw/resolved seed domains；typed handoff `H`；pre-read boundaries；共享
  run-state occurrence；entity-owned projectile/residue lifecycle。
- material record / 坐标 / 生命周期：First Eye 的空场保留为 520ms incoming absence；Left/Right wall 与
  lane omission 写成 projectile 位置、collision lease 与 `seam_filament`，不是一个代表“房间已进入”的图标。
- restore / witness 关系：本切片不增加 archive。未来保存 room plan/phase 时必须绑定 raw seed、V4 content
  digest、policy version 与 exact tick；不能从画面恢复。

## 做减法结果

- 已复用 V4：`FORCED_ALIGNMENT`、`composer.forced_alignment` 的 membership/tier/budget、
  `room.forced.left_right_gate`、encounter segment ranges、safe gap、canonical kernel、shared run state 与事件总线。
- 已删除的提案：复制 `test.behavior-ledger`、把 QA room count `3` 当 live policy、伪造 14 项 metric、
  复用 `CanonicalLiveRoomExecutionFragment` 的新 bus、房间 enter event、transition 动画、parallel weather、
  新 copy 与新素材。
- 仍需新增：两个 difficulty salt、一个 fixed bootstrap plan/scheduler snapshot、同 session 的 owner switch、
  room presentation projection。
- 新增预算：canonical event `0`；asset `0 bytes`；dependency `0`；selection RNG draw `0`；
  persistence field `0`。

## 治理与非单一化

- aaajiao 决定首个可玩闭环是否继续固定或由 successor composer 取代；Codex 实现、验证并记录。
- 固定 Forced/Left–Right 是开发 bootstrap，不是玩家类型判断、正确路线、默认人格或推荐 build。它不写
  score/rank/victory/defeat/good/bad end，也不把左右任一侧解释为偏好或成功。
- 键盘、gamepad、pointer 继续汇入同一 input facts；本切片未新增设备依赖。物理设备兼容仍需实机矩阵。

## 行为契约与失败方式

- canonical time：integer `tick120`；pause 冻结 gameplay time；pre-read 不读 RAF/CSS/audio。
- same-tick：Gaze/Flower proposal、room/combat proposal、shared run-state flush，最终仍由 canonical event phase
  排序。constructor 不回写已关闭的 `H`。
- failure：seed domain、source manifest、pool mapping、boundary、tick continuity、active occurrence、timer、
  budget evidence 或 source handoff 任一不符即 fail closed；不退回 legacy Run。
- offline：无网络、新 permission 或服务；V4 content digest 继续由现有 content authority 绑定。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | room sampling contract | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | Forced membership/tier/budget | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | segment/safe-gap/director budget | repository license | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | First Eye + Left/Right seed/lifecycle | repository license | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `narrative/narrative-state-machine-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | ROOM_SAMPLING boundary | repository license | `1b8d80a930c5338603f63620d40fc1b2dc44f37643d9f9cc73006185b5db6daf` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / V4 4.0.0 | inspected, not used as live policy | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |

V4 source tree 保持只读。application artifacts 与实现提交在 ACCEPTED 时补入。

## 验证计划

- focused unit：seed domain/formula、hostile values、`H/H+63/H+159` ownership、source trace prefix、共享
  player/evidence/Override/position、pre-read 0 spawn/collider、READ first spawn/arm、residue drain、neutral close；
- deterministic：同 raw seed/input 在不同 start tick 与 clock cadence 得到相同 relative trace；
- projection：Forced room/pattern/safe gap/实体来自 authority snapshot，profile parity 不改 gameplay；
- production preview：真实 boot → gaze clamp/release/recovery → typed handoff → Forced telegraph/entry/READ →
  live projectile/collider，且 pause 冻结；
- `typecheck`、`content:check`、`build`、`git diff --check`。本切片不跑全量 `test:all`。

## 回滚与迁移

回滚后默认 RUN 恢复停在 EXT-004 typed handoff；已产生的 canonical trace 保留为只读证据。没有 archive
schema 迁移。未来 live behavior-ledger composer、不同 room/tier/pattern、parallel、room completion 或下一房
handoff必须新建 successor ADR，并明确 supersede bootstrap 的哪些 policy。

## 决策

PROPOSED。实现前已确认 V4 不指定首房、首 pattern、difficulty salt、live metric producer、room count 或
canonical room-enter event。固定 bootstrap 是为了先闭合同一身体/事件 trace 的真实 room execution，且不会
把 QA fixture 或 UI 呈现冒充完整 composer。
