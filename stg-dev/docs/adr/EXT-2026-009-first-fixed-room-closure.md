# EXT-2026-009：首个 fixed room 单 occurrence 关闭

- 状态：PROPOSED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置记录：[EXT-2026-008](EXT-2026-008-first-occurrence-observation-capture.md)
- aaajiao skill：`1.1.1`；SHA-256 `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256 `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256 `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：first fixed room closure / bounded source-window capture / typed visit fact；不修改 V4、metric projection、composer、room count、difficulty、selection、transition、asset、dependency 或 persistence schema

## 不可约事实（Metadata）

V4 encounter director 允许 READ 显式包含 `1..3` 个 pattern slot；EXT-2026-005 已在首个
`FORCED_ALIGNMENT` room 完整执行 slot 0：telegraph、entry、`room.forced.left_right_gate` READ、
material settle、required rest 与 residue drain 均已闭合。V4 没有规定每 room 必须执行几个 occurrence，
也没有 room completion guard 或 canonical `room.complete` event。

删除本扩展后无法保留的 application 决定是：fixed bootstrap 首房采用 V4 允许的最小 cardinality，
`occurrenceCount=1 / remainingOccurrenceCount=0`；`H+1701` 仍只是 EXT-2026-008 的 observation boundary，
到下一个独立 room-owned tick `H+1702` 才提交 room closure 与一次 typed visit fact。

无形容词机制句：`CanonicalRunSession` 在 `H+1702` 前复验 H+1701 observation；
`CanonicalRunRoomSession` 只复验首 occurrence、required rest与自身entity/run-state drain，再用同一run
state/event bus关闭一个idle tick；parent ledger记录该tick后原子冻结 `[1,H+1702]` closure capture，room
completion不自动取得下一房选择或transition权限。

## 负空间（Behavior > Content）

首房不需要把四个 pool pattern 全部展示完才算被观察，也不因屏幕无弹体就自动“通关”。Left/Right Gate
已经留下 seam filament，随后 residue 消失、声音与碰撞不再被新反馈填满；`H+1702` 的关闭来自显式
application policy，而不是胜利、清场、玩家水平、presentation cue 或 QA schedule。

## 决定

### 1. fixed bootstrap 首房总计一个 occurrence

- 该规则只适用于 room ordinal 0 的 EXT-2026-005 fixed bootstrap，不推广成所有 V4 rooms 的默认规则。
- 首房计划固定为一个 READ slot：encounter ordinal 0、`room.forced.left_right_gate`、`listen / EASY`。
  `unstable_middle`、`ballot_shift` 与 `crack_fall_loop` 仍留在 canonical pool，未被删除或标记不可用。
- V4 `patternSlots=[1,3]` 证明 cardinality 1 合法，但不提供 room closure；`roomComplete` 仍是本 ADR
  新增的 application policy。
- 不重开已关闭的 READ，不追加第二个 telegraph/entry/rest，不调用 composer，不消费 pattern-selection RNG。

### 2. H+1702 是独立 closure tick

- `H+1701` 顺序与公开结果保持 EXT-2026-008 不变：fixed slice close → rolling facts 写入 → observation
  capture；该 snapshot 仍为 `roomComplete=false / handoffReady=false`。
- `H+1702` 由 `room_sampling` owner 消费。parent必须在任何H+1702 authority mutation前复验H+1701
  observation capture available、identity/content/raw seed一致且frozen bytes未变；room authority只复验：
  - fixed slice 与 required rest 已关闭；
  - digital body、live collider、residue visual 均为 0；
  - retained combat pattern complete、projectile lifecycle drained、run timers quiescent、occurrence handoff-ready；
  - shared run state `activeOccurrenceId=null`、`pendingFlushTick120=null`、claimed occurrence 只有既有
    First Eye 与首房 occurrence；
  - canonical event cursor仍是 source prefix，player 未处于 terminal run-ended state。
- 同一 shared run state/bus 关闭 `H+1702`。ROOM_SAMPLING 的 movement/focus、Gaze 与 Flower 继续按既有
  input policy 采样；Override edges仍 withheld。postflight 全部通过后才设 `roomComplete=true`。
- `handoffReady=false`：room closure 不是 target selection、world swap 或 transition-ready。

### 3. 冻结 H+1702 closure capture

`CanonicalRunSession` 在 room step成功且 EXT-2026-006 已记录 `H+1702` 后，恰好冻结一次
`CanonicalRunFirstRoomClosureCapture`：

- source epoch 为 `current-run-through-first-room-closure`，window 为 accepted ticks `[1,H+1702]`；
- 记录 raw Run seed、共享 V4 content identity、pre-room H、H+1701 observation、closure tick、
  room ID/ordinal、`plannedOccurrenceCount=1`、`completedOccurrenceCount=1`、
  `remainingOccurrenceCount=0` 与一份 recursively frozen behavior-facts snapshot；
- 提交 `roomComplete=true`、`completedRoomVisit={roomId: FORCED_ALIGNMENT, roomOrdinal: 0}` 与
  `distinctVisitedDelta=1`。
  该 delta 是首次完成一个唯一 room category 的待消费 typed fact，不是进度、奖励或评价；本切片
  不读取或改写 narrative distinct-room ledger；
- `metricProjection=false`、`selectionAllowed=false`、`transitionAllowed=false`、
  `targetRoom=null`、`selectionRngDraws=0`、`canonicalEventWrites=0`、`handoffReady=false`。

`H+1703` 及更晚 accepted ticks可继续进入 live rolling ledger，但不得改写 closure capture。rejected 或
faulted `H+1702` 不得公开半份 room-complete state或半份 capture。

### 4. canonical event 与 transition firewall

- event schema没有 `room.complete`、`room.withdraw`、`room.enter` 或 `encounter.begin` canonical ID；
  本切片不伪造这些 QA/narrative labels。
- `room.transition.begin → world_swap.commit → room_ready → complete` 只在后续 target 已选且 transition
  request被接受后使用；其中 `complete` 是 atomic swap完成，不是 source room closure。
- `transition.room_threshold` gameplay occurrence 与 240/500/650ms atomic room FSM 仍未 join，本切片不运行。
- 不生成成功文案、奖励、成就、音效、震动、闪白、telemetry 或 archive row。

### 5. 后续责任顺序

successor ADR 依次负责：

1. 逐项定义 14 个 metric 的 producer/window/denominator/threshold/missing，并从 H+1702 frozen source
   生成版本化 metric snapshot；
2. 明确 room count、difficulty/tier/salt、remaining room candidates 与单一 RNG stream；
3. 消耗并记录 selection RNG，冻结 target；
4. join transition gameplay occurrence与atomic room FSM，再发 canonical transition events；
5. 明确closure visit fact、destination `world_swap.commit`与narrative distinct-room ledger的exact consume/order；
   本 ADR不预先规定它是在target ready前还是后发生。

禁止把 `distinctVisitedDelta=1` 当作允许 ROOM_SAMPLING 退出的单独条件；V4 narrative仍要求至少两个
distinct rooms或150000ms，Run end仍要求至少240000ms与两个 distinct rooms。

## 被拒绝或延后的替代方案

- **再固定一个 occurrence**：可选 `unstable_middle` 并继续 `listen/EASY`，但会新增长约1966 tick的
  schedule、seed/ordinal、safe-gap与closure policy；当前没有体验证据要求填充它。
- **固定总计三个 occurrence**：数量与 Python QA fixture偶合，但不因此获得V4 authority；仍需作者选择
  两个pattern及顺序。
- **现在调用 composer**：拒绝。14项 metric、missing policy、room count、difficulty mapping、remaining
  set与RNG顺序尚未 author，默认0会把缺失能力伪装成玩家行为。
- **H+1701 同 tick关闭**：拒绝。它会改写已接受的 EXT-2026-008 source snapshot与同 tick责任。
- **从无实体画面直接推断**：拒绝。presentation/alpha/audio不能拥有room lifecycle。

## 数字—物质双螺旋

- authoritative input/event/state：integer `tick120`、shared run state/bus、EXT-006 ledger、EXT-008 frozen
  observation与H+1702 typed closure；presentation不能回写。
- material record：Left/Right Gate 的projectile/collider/residue真实经历arm/flight/cancel/residue/drain，
  required rest不被难度删除；关闭保存其缺席而不补generic feedback。
- presentation：可继续表现安静、残留已退场与空间等待，但不显示“完成”“正确”或下一目标。
- restore / witness：本切片不持久化；future consumer必须校验capture schema/producer/content identity，
  不能用H+1703后的rolling facts冒充H+1702 source。

## 做减法结果

- 已复用：V4 1..3 slot范围、EXT-005固定计划/seed/shared body、EXT-006 ledger、EXT-007 H capture、
  EXT-008 H+1701 observation与content identity gate。
- 删除：额外pattern、composer、metric projection、tier变化、selection RNG、target、transition、
  canonical event、UI/copy、telemetry与persistence。
- 为什么仍需新增：V4只允许cardinality范围，不决定fixed bootstrap采用哪个cardinality，也不提供
  room closure guard；rolling facts跨过H+1702后不能反演exact closure prefix。
- 新增预算：gameplay policy 1条；canonical event 0；RNG draw 0；asset 0 bytes；dependency 0；
  persistence field 0；每Run最多1份bounded first-room closure capture。

## 治理与非单一化

- 本提案等待 aaajiao 接受 fixed bootstrap采用最小1 slot；接受后 Codex只实现exact tick、source
  isolation与fail-stop验证。后续playtest若证明房间过短，必须用successor ADR显式增加occurrence，
  不能静默改trace。
- one-occurrence只约束首次bootstrap，不让所有rooms同长、同顺序或同一解释。
- position、Flower、Gaze、damage、scar或input density不被解释为能力、阵营、好坏或最优路线。
- 没有score、rank、victory、defeat、achievement、good/bad ending或隐藏评价。

## 行为契约与失败方式

- time / owner：H+1701仍是slice/observation；H+1702是first room closure；pause/wall time不采样。
- seed / RNG：保留既有raw/resolved seed与claimed occurrence；closure不调用RNG。
- event：H+1702可包含既有Gaze/Flower authority commit，但closure/capture自身写0个canonical event；
  capture cursor/multiset必须等于bus prefix。
- atomicity：early/late close、missing/tampered H+1701 capture、live entity/residue、active occurrence、
  pending flush、terminal player、event divergence、extra field或non-frozen source均fail-stop。
- determinism：同seed/input/content得到相同closure tick、room snapshot、capture bytes与event trace。
- boundedness：不保存per-tick history；H+1703后capture cardinality/bytes不增长。
- offline/profile：无network/service；full/reduced-motion/flash-off必须得到相同gameplay trace。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；metadata、做减法、双螺旋与非单一化门 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | 2..4 rooms与behavior selection；无room closure | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | Forced pool/tier/rest/cooldown；无occurrence count | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | READ 1..3 slots、required rest与safe gap | repository license | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | Left/Right Gate lifecycle与pool peers | repository license | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `manifests/runtime/event-schema-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | transition IDs；无room-complete event | repository license | `31c69e627e35e0c8dea828e1564592d6fc71059fa9ce654f92c660114648f0bb` |
| `narrative/narrative-state-machine-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | distinct/time exit与minimum run facts | repository license | `1b8d80a930c5338603f63620d40fc1b2dc44f37643d9f9cc73006185b5db6daf` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / V4 4.0.0 | hard-coded3-pattern fixture仅作反证 | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `src/authority/live-run-admission.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | caller-resolved1..3 capability gate；非default scheduler | repository license | `51885d411e518e072e9402cb44ab5fabe15a7631e634b623f22c0cf07eba7757` |
| `src/authority/run-room-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | H+1699 drain与H+1701 fixed slice baseline | repository license | `c36d27002aa9203c5a8b9f897f76222940905fc272d9a0b998167cf352b31e5e` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | owner/ledger/capture ordering seam | repository license | `36c1685cb5b2e7a24e97cc507f6dfeb31d1cceb755406b03e1b23a92b494ebc6` |
| `src/authority/run-behavior-capture.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | H+1701 frozen observation baseline | repository license | `6b90f68b3a19aeadf9a5dbd7b6a932cee59e7698dfae99e5b038921eeb999524` |

V4 source tree保持只读。application hashes是提案基线；接受时补充implementation/test与最终hashes。

## 验证证据（待实现）

- H+1700/H+1701仍`roomComplete=false`；H+1702恰好true且closure capture available；H+1703幂等；
- zero entities、required rest、retained combat drain/quiescence、shared run null/null与claimed IDs精确；
- closure前后canonical event bytes只受既有Gaze/Flower影响，closure/capture自身写0；RNG/target/transition不变；
- closure capture的H+1701 provenance、behavior facts、planned/completed/remaining occurrence counts、
  `distinctVisitedDelta=1`与所有firewall精确且deep frozen；
- early/late、hostile source与composite failure无半份room complete/capture；同seed/input bytes一致；
- focused room/capture/session tests、strict typecheck、content/build、`git diff --check`通过；
- 若`data-room-complete`路径改变，运行controlled-RAF production-preview单例；不跑无关full suites。

## 回滚与迁移

删除本扩展恢复H+1702后的idle non-complete room，并移除一次性in-memory closure capture。EXT-005
occurrence、EXT-006 rolling facts、EXT-007 H capture、EXT-008 H+1701 observation与canonical trace不变。
无archive migration。

任何metric projection、room count、target selection、transition join、next-room handoff或persistence必须新增
successor ADR；不得从current rolling facts或presentation推断。

## 决策

PROPOSED。fixed bootstrap首房采用V4-compatible最小1 occurrence，并在独立H+1702 authority tick提交
room closure与typed visit fact；所有下一房、metric、selection和transition权限继续withheld。
