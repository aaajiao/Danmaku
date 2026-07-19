# EXT-2026-004：First Eye recovery handoff

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 设计提交：`92413afa922321e05cc93ff88051ddb12803d31d`
- 实现提交：`b626c624e0cc7d9d07f039b2c609ced56cb363d3`
- 前置记录：[EXT-2026-002](EXT-2026-002-canonical-run-fragment-adapters.md)（只读历史基线）
- aaajiao skill：`1.1.1`；SHA-256 `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256 `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256 `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：authority / narrative / application input / projection；不修改 V4、asset、canonical event ID、dependency 或 persistence schema

## 背景与不可约缺口（Metadata）

V4 要求 `FIRST_EYE -> FIRST_CLAMP_RECOVERY -> ROOM_SAMPLING`。`GazeMachine` 已定义
60-tick acquire 与 54-tick delayed release，Flower resolver 也定义
`Override > Gaze > Focus > Signal`。但 V4 没有定义浏览器设备如何产生 gaze sample，也没有定义
Flower 在 release 后经过多久恢复。

`event-projections-v4.json` 把 canonical `flower.intensity.commit` 只读投影为
`flower.recovery.complete`，predicate 写为 `source=GAZE_RECOVERY and target band reached`；与此同时，
V4 `FlowerSource` 只有 `override | gaze | focus | signal`，canonical event schema 也没有
`flower.recovery.complete`。因此默认 RUN 维持 neutral gaze 并停在未完成 barrier 是此前唯一诚实行为，
不能从 `flower.recover_delay` 动画或 `sfx.flower_recover` 音频反推 gameplay 时间。

此前不可见的行为事实是：玩家主动维持与 Eye 的关系、解除该关系后，Flower 在稍后的独立 gameplay
tick 恢复，First Eye 才能把 authority 交给房间采样。删除本扩展后，这条 release 与 recovery 之间的
不可约时间差，以及完成它的设备中立行为，都无法进入默认 RUN。

无形容词机制句：玩家保持 gaze intent 60 ticks 触发 clamp，释放后由 V4 gaze machine 完成 release，
再过 30 ticks 由 V4 Flower resolver 提交非 gaze 强度；四个 barrier 完成后暴露
`ROOM_SAMPLING` handoff。

## 负空间（Behavior > Content）

当前界面已经显示 Eye、Flower 与 First Eye 弹幕，却没有任何浏览器输入能改变 neutral gaze sample；
内容表面因此遮住了“保持—释放—稍后恢复”的玩家行为。扩展不增加提示图标、命令文案、动画或奖励，
而是让独立 gaze intent、Eye、Flower 与 canonical events 形成可观察的时序。

## 决定

### 1. 设备中立 gaze intent

- 新增独立的 held `gazeIntent` application input fact，并保持它与 V4 Focus action 分离：键盘
  `KeyG`、standard gamepad top face button 3，以及双指 pointer hold。双指期间首个仍存活 pointer
  继续拥有移动目标，任一 pointer 继续维持既有 signal；第二个 pointer 只增加 gaze intent，不改 Focus。
- 在 First Eye fragment 内，intent held 映射为显式 sample
  `{skyEyeVisible:true, pitchDegrees:60, alignment:1}`；未 held 映射为
  `{skyEyeVisible:true, pitchDegrees:0, alignment:0}`。AWAKENING 继续提供不可见的 neutral sample。
- 该 adapter 只声明玩家意图，不声称摄像头或真实眼动测量。它不从移动方向、pointer 坐标、renderer、
  Eye frame、音频或 wall time 推断 gaze。未来 eye-tracking 只能成为同一 explicit sample port 的
  替代 adapter，并需 successor ADR。

### 2. 30-tick Flower recovery projection

- 第一次及其后每一次已接受的 canonical `gaze.clamp.release` 都把 pending recovery anchor 设为
  `release.tick120 + 30`。30 master ticks 是 application-authored 250ms policy；毫秒只作派生显示。
- due tick 之前保留 Gaze 强制的 0.1 Flower resolution。due tick 只有在 clamp inactive 时，才以当前
  signal/Focus inputs 调用原 V4 Flower resolver。不得直接写 Flower snapshot。
- 同一 due tick 必须提交 canonical `flower.intensity.commit`，payload source 必须为 `focus` 或
  `signal`，且 `targetIntensity > 0.1`，才能把该 commit 在 recovery context 中只读投影为 narrative
  `flower.recovery.complete`。`GAZE_RECOVERY` 是 projection context，不是 canonical payload alias，
  不新增或覆盖 V4 source/event ID。
- handoff ready 前出现新的 `gaze.clamp.commit`，会使 pending 或已完成但尚未交接的 recovery 失效；
  必须等待下一次 canonical release，并重新 anchor `+30`。这防止在当前 Flower 又被 clamp 时交接。

### 3. Typed `ROOM_SAMPLING` boundary

- handoff barrier 固定为：source combat lifecycle drained、至少一次 gaze clamp commit、对应 release、
  当前 recovery complete。全部满足后的 exact tick latch：
  `state = ready_for_room_sampling`、`target = ROOM_SAMPLING`、`ready = true` 与不可变 `atTick120`。
- authority 转移还要求 run-owned timers 已 quiescent，且 Gaze FSM 为 `idle`、没有未决 deadline；这是防止
  live authority 被冻结的 transfer safety，不是第五个 narrative progress fact。若 recovery 到期时新 cycle
  仍在 `acquiring`，recovery 可以完成，但 handoff 要等 acquire cancel 回 idle 或下一次 clamp/release。
- 该 latch 只说明 next authority 已具备输入，不把 session phase 假称为已经执行的 room sampling，
  不选择 room、不发 `room.ledger.sample`、不启动 composer/director，也不修改 combat trace。
- 同 tick 顺序保持：Gaze proposal/commit -> Flower resolution -> existing combat/event flush -> barrier
  evaluation -> immutable handoff snapshot。collision ordering与 projectile lifecycle 不变。

## 数字—物质双螺旋

- authoritative input/event/state：held `gazeIntent` sample；`gaze.clamp.commit`；
  `gaze.clamp.release`；30-tick recovery deadline；`flower.intensity.commit`；typed handoff latch。
- material record / 坐标 / 生命周期：Eye 只读呈现 gaze committed state；Flower 呈现 resolver 已提交的
  0.1 与恢复后 target band；first-eye projectiles 仍由 entity lifecycle 独立 drain。
- restore / witness 关系：本切片不增加 archive 字段。handoff 是当前 run 的只读边界；未来存档或 witness
  若需保存 recovery context，必须另立 schema/ADR，不能从视觉帧恢复。

## 做减法结果

- 已复用 V4：`GazeMachine`、`FlowerIntensityResolver`、`gaze.*` 与
  `flower.intensity.commit` canonical IDs、FIRST_CLAMP_RECOVERY guard，以及现有 keyboard/gamepad/pointer
  input aggregator；不复用语义独立的 Focus action。
- 已删除的提案：camera/eye-tracking permission、Focus alias、恢复事件/source alias、提示 copy、动画
  timer、音频 timer、room composer 与 persistence 字段。
- 仍需新增：浏览器 device adapter、一个 30-tick pending recovery state、typed handoff fields；否则默认
  RUN 没有可完成路径。
- 新增预算：canonical event 0；canonical source 0；asset 0 bytes；dependency 0；RNG draw 0；
  persistence field 0。

## 治理与非单一化

- aaajiao 决定恢复关系与输入语义；Codex 实现、验证、记录 provenance；后续维护者只能通过 successor
  ADR 改时序、predicate 或设备 route。
- 键盘、standard gamepad 与双指 pointer 共用一个 gaze intent fact，避免单一键盘路线。真实眼动设备、单手
  触控、运动能力、浏览器 pointer 差异与实体手柄仍可能被模拟测试隐藏；未经设备矩阵不得声称硬件兼容。
- 该行为没有 score、rank、正确姿势、效率奖励或道德结局。重复 clamp 只重新建立因果 deadline，
  不惩罚、不累计评价。

## 行为契约与失败方式

- seed / RNG domain：无 RNG；同一 tick-addressed input trace 必须产生同一 canonical serialization。
- canonical tick：只使用 integer `tick120`；pause 冻结且丢弃 pause wall time；恢复 deadline 不读 RAF、
  CSS、animation、audio 或 renderer clock。
- event/payload：只接受 V4 `gaze.clamp.commit`、`gaze.clamp.release` 与
  `flower.intensity.commit {source,targetIntensity}`；未知 ID、缺 payload、重复 occurrence 继续 fail-closed。
- collision / safe gap / warning：无修改。combat drain 仍要求 live collider、projectile 与 residue 全部归零。
- snapshot/archive/restore：snapshot 增加 recovery/handoff facts；archive schema 不变。
- offline degradation：无网络、摄像头或新 permission；键盘、pointer 与已连接 gamepad 均为本地输入。
  无合法 input sample 时保持 barrier pending，不伪造进度。

## 未采用方案

- 永久 neutral gaze：保真但让默认 RUN 无法完成 First Eye。
- 从动画或音频时长恢复：让 presentation 获得 gameplay authority。
- 新增 canonical `GAZE_RECOVERY` source 或 `flower.recovery.complete` event：与 V4 ID universe 冲突。
- 把 Shift/Focus 当作 gaze：会合并 V4 明确分开的 authority，并同时改写 Flower Focus resolution。
- 只加键盘 gaze key：制造单一设备路线；因此同一 fact 必须同时有 gamepad 与 pointer route。
- ready 时直接进入虚构 room：会在 composer、director、seed 与 ledger authority 缺失时伪造进度。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | N/A | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/runtime/state-machines-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | N/A | repository license | `eb1c62d53b71c0c2bbf0fc91098791b59054be4f5472efbbf112dcd12f0794fd` |
| `narrative/narrative-state-machine-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | N/A | repository license | `1b8d80a930c5338603f63620d40fc1b2dc44f37643d9f9cc73006185b5db6daf` |
| `manifests/integration/event-projections-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | N/A | repository license | `fee2579b8542e910cad7bb0d77f8f028bbd1563d08f5d2786757e6bcd39e2ae9` |
| `runtime/perception.ts` | V4 package / aaajiao | TypeScript / V4 4.0.0 | N/A | repository license | `151d598ca3871facd817c9a33cf659091d8b88d063252bc5e29756a0c3888db4` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | this decision | repository license | `1384c6077544784497ea5e4bf1507b6341887afeee76276ed1ac092dc88e1948` |
| `src/authority/run-session.test.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / Vitest | focused authority evidence | repository license | `fc800fa1addc3bbb08b81edce4cb00242b51c5043cab15b83e8ff7d9dffb8b8a` |
| `src/game/input.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | KeyG / button 3 / ordered pointers | repository license | `910371a1b7a413ea01d89ef8bcc8d064fc98542d2ae4125e574fd47cb37765f0` |
| `src/game/input.test.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / Vitest | device aggregate evidence | repository license | `61acd0a56aac488a10efd8499604dc30eafce2b01e441d4ba1c9a0b26855e996` |
| `src/game/simulation.test.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / Vitest | InputFrame consumer fixture | repository license | `f1a12d824ef2d36bd5f8a7a4a4819b2fde4605383ea9d3dbe17422018c52abb5` |
| `src/main.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | causal input adapter + HUD projection | repository license | `89a6ad3575e2528a5be619e07be28d3b861fec79103517b166254466922a551e` |
| `e2e/canonical-run.spec.ts` | Danmaku / aaajiao + Codex | Playwright / Chromium | production-preview Run path | repository license | `edab6cade0811dd179335605c97f1be1c0cfd16662fbda669608d6c961a9c2d9` |
| `e2e/causal-input-clock.spec.ts` | Danmaku / aaajiao + Codex | Playwright / Chromium | backlog + profile parity | repository license | `f1194692cb334640b4cbfa1728b87cce80b701bf35636bed8a929f894084fd2d` |

V4 source tree保持只读。application hashes 对应实现提交 `b626c62`。

## 验证证据

- exact V4 manifest/projection/source validation 与 `content:check` 通过，canonical ID universe 不变；
- focused Input/Run-session/Presentation/Simulation Vitest 通过：KeyG、gamepad button 3、双 pointer、
  release+29/+30、re-clamp、source-first、gaze quiescence 与 frozen ready boundary 均有 executable evidence；
- strict typecheck、production build 与 `git diff --check` 通过；
- production-preview `canonical-run.spec.ts` 实际 hold/release G，并到达 typed `ROOM_SAMPLING` ready；
- production-preview `causal-input-clock.spec.ts` 证明 backlog 不倒写 gaze input，并让 Full、Reduced Motion、
  Flash-Off 都执行 clamp/release/recovery 后得到相同 authority trace；
- pool、RNG、asset、dependency 与 persistence budget 均为零。未记录物理设备矩阵，因此不作实机兼容声明。

## 回滚与迁移

回滚恢复 explicit neutral sample 与 recovery-pending handoff；不迁移存档，不用视觉/音频补写 recovery。
已经提交的 canonical trace 保留只读。未来真实 gaze sensor、不同 recovery delay/target predicate、
`ROOM_SAMPLING` consumer 或 room composer 必须新建 successor ADR，引用本记录与实现提交。

## 决策

ACCEPTED。三类设备 route、exact tick recovery、re-clamp policy、authority quiescence、typed handoff、
profile parity 与 production-preview E2E 已通过，并绑定实现提交与 artifact hashes。尚未解决的边界是
`ROOM_SAMPLING` 的 room composer/director；本记录明确不授权推断该 producer。
