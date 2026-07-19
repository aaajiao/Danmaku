# EXT-2026-013：首个 continuation target 的 room transition

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置记录：[EXT-2026-009](EXT-2026-009-first-fixed-room-closure.md)、
  [EXT-2026-012](EXT-2026-012-first-continuation-room-target.md)
- 稳定边界：[ARCHITECTURE_ZH §10](../ARCHITECTURE_ZH.md)；接受时同步更新completion/handoff窄例外
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：formal target receipt / transition combat / atomic world identity / player collision lease /
  material-residue carryover / presentation projection；不修改 V4、target 选择结果、总 room count、目标房
  pattern/tier/difficulty、Boss、archive、asset 或 dependency

## 不可约事实（Metadata）

EXT-012 已在首房关闭 tick `H+1702` 冻结 ordinal 1 target，但正式 Run 之后仍让已关闭的
`FORCED_ALIGNMENT` owner 继续 idle。V4 同时提供两套互不调用的权威：

1. `RoomTransitionMachine` 在 accepted request 后以 `240/500/650ms` 提交 world swap、room ready 与
   complete，并拥有四个 canonical `room.transition.*` ID；
2. `transition.room_threshold` 在 `7800ms` 内运行 departing columns、arriving angles、可碰撞 safe-gap
   bridge 与 `2741ms` 无碰撞 sediment。

V4 没有规定二者的启动关系、transition difficulty/seed live policy、player `room-transition` lease 窗口，
也没有规定 pattern complete 后尚存 sediment 是否阻塞下一房。QA `sim_core.py` 只安排
`room.withdraw → 7800ms transition → next room.enter`，不调用 atomic FSM；这些 QA label 不是 canonical
event。

删除本扩展后，target 既不改变 world identity，也不产生 V4 已写出的转场行为。无形容词机制句：Run 在
`H+1703` 一次性消费正式 target，同时启动 Room Threshold 与 atomic FSM；FSM 管房间身份和 player blocker，
pattern 管可碰撞行为与材料，pattern complete 后只把无碰撞 sediment 交给 carryover owner，释放下一房入口。

## 负空间（Behavior > Content）

只切背景会把玩家穿过 moving threshold bridge 的行为藏掉；只播放 pattern 会让画面变化没有 room identity
事实。等 sediment 全部消失才允许下一房，则会在 V4 QA 的 `7800ms` 入口后额外制造 `2741ms` 无碰撞空档，
把材料余留误当成 gameplay 阻塞。

本扩展保留三种时间：650ms 后房间身份稳定，7800ms 后数字规则完成交接，sediment 继续以 source identity
存在直至自己的 cleanup。后者不评价玩家、不阻塞新规则，也不被通用反馈填满。

## 决定

### 1. 一次性 formal target 与 H+1703 边界

- 只有 EXT-012 登记在 module-private `WeakSet` 的原 in-memory formal target 可签发一次 opaque transition
  receipt。公开 snapshot clone、JSON round-trip、unbranded derivation、伪造 receipt 与重复消费均拒绝。
- receipt 必须复验：source 是 `FORCED_ALIGNMENT / ordinal 0` 的 H+1702 exact closure，target ordinal 为 1，
  target 属于 exact remaining universe `INFORMATION / IN_BETWEEN / POLARIZED`，raw Run seed、content identity、
  source projection 与 EXT-012 RNG evidence 未漂移。
- H+1702 已由 first-room owner flush 后才生成 target，禁止向该 tick 倒写事件。第一个合法边界固定为下一
  accepted master tick `H+1703`；开始前必须证明 shared bus/run state idle、无 pending flush、无 active
  occurrence、player exact `alive / collisionEnabled=true / activeLeases=[]`、无recovery/respawn deadline，旧房
  digital body/collider/residue为0。虽然EXT-009 closure已要求该状态，transition receipt仍须在使用点复验。
- 三个合法 target 共用同一 transition admission；不得只为当前 seed 开门，不得 reroll、替换目标或硬编码
  `POLARIZED`。

### 2. 同 tick 启动两条 V4 权威

- 在 H+1703 的唯一 shared-bus flush 前完成三件事：
  1. 为 player 取得 owner=`room-transition`、reason=`atomic-world-swap` 的 collision blocker；
  2. 以 `FORCED_ALIGNMENT → targetRoom` 请求 `RoomTransitionAuthority` generation 1；
  3. 在同一 `CanonicalRunCombatState` 安装 `transition.room_threshold` occurrence，并消费 H+1703 为
     pattern local tick 0。
- 三件事由一个窄prepared composite提交，不按上述文字顺序逐个调用现有immediate-mutation API。composite先
  纯验证target、H+1703 input、shared position/player/Override timer推进、player lease after-state、FSM
  after-state、deferred occurrence claim/local-tick-0 after-state、pending-flush ownership与全部event drafts，再以
  一次prepared batch append取得完整receipts；只有append成功后才把shared current tick从H+1702推进到
  H+1703、claim occurrence并统一apply各prevalidated after-state，最后由既有run-combat独占owner恰好flush
  H+1703。hostile validation或append失败时为零event、零state且不消费target；receipt apply后若出现不可能的
  内部invariant异常，立即quarantine该target并使Run fail-stop，禁止重试或跨Run复用。
- 这是一个明确的prepared `start-next-tick` seam；不得先走现有idle advance再claim，也不得在H+1702构造
  kernel。H+1703既是shared state接受的新tick，也是transition pattern local tick 0。实现只新增Room
  Threshold专用的deferred-install端口，不放宽通用`CanonicalCombatKernel` constructor/claim规则。
- formal target只在prepared composite全部apply成功后登记为consumed。receipt签发本身不消费target；同一个
  formal target同时只能存在一个in-flight proposal，拒绝并发prepare/commit。
- same-tick canonical order保持 `player.collision.off → room.transition.begin → collision-on → spawn → feedback`；
  H+1703 不伪造 `transition.begin`、`room.withdraw`、`room.enter`、segment 或 warning event。
- occurrence ID固定为
  `run:room:0-to-1:transition:transition.room_threshold`。本次 transition 不消费 selection RNG draw；
  EXT-013显式author `transitionEncounterOrdinal := sourceRoomOrdinal = 0`与
  `transitionDifficultySalt := 0`，resolved seed按V4四项形状计算
  `rawRunSeed xor pattern.seed.base(577557179) xor transitionEncounterOrdinal(0) xor
  transitionDifficultySalt(0)`，记录在独立domain`ext-013-first-continuation-room-transition`。数值与QA的
  `runSeed xor base xor roomOrdinal`相同，但ordinal映射和salt=0是本扩展policy，不是V4或QA提供的live
  authority，也不得冒充完整composer RNG cursor。
- difficulty 固定 `NORMAL`，因为其 V4 multipliers 全为 1；这是 EXT-013 的首个 transition bootstrap policy，
  不是 Run difficulty 或目标房 tier 决定。target、profile、weather、wall time 与 render cadence不改变 seed。
- `CanonicalCombatKernel` 的静态combat room context固定为source `FORCED_ALIGNMENT`；动态world identity只由
  atomic FSM拥有。transition tick不得写入source或target room metric window，不得把world-swap后的safe-gap
  行为倒算成目标房pattern行为。

### 3. Atomic FSM 只管理 world identity 与 blocker

- `RoomTransitionAuthority` 继续按 first-non-early runtime60 偶数 master tick推进。world identity只在
  `room.transition.world_swap.commit` 切到 target；`room_ready`与`complete`不得由 presentation 或 pattern
  timeline反推。
- canonical payload保持V4 exact schema：begin/world-swap为`{generation,fromRoom,toRoom}`，room-ready/complete
  为`{generation,room}`，player collision off/on为`{owner,reason}`；不追加target ordinal、seed、pattern或
  presentation字段。
- `PlayerDamageAuthority`与`RoomTransitionAuthority`分别新增opaque prepared acquire/release与
  request/advance proposal/view/apply端口；production join禁止调用旧immediate-mutation路径。player source
  validator同时钉住V4 exact blocker owner universe
  `damage / respawn / room-transition / cutscene / system-handoff`，未知owner fail closed。
- player blocker 从 H+1703 begin 持有到 FSM `room.transition.complete` 的 exact tick。该 tick先提交
  complete state/event，再提交 `player.collision.on`；若其他合法 lease仍存在，则不得错误重开 collision。
- 每个transition tick先完整验证caller input、combat tick与FSM advance；有FSM boundary的tick使用prepared
  proposal，complete tick把FSM complete与player release放进同一prepared batch，apply后仍只由run-combat
  owner flush一次。validation/append失败不得只推进FSM或只释放lease。
- atomic complete只表示 room identity稳定。它不取消、快进或完成7800ms pattern；pattern首个 authored
  collision arm晚于该窗口，两个权威不互相伪造完成条件。

### 4. 7800ms gameplay transition 与 material-only carryover

- Room Threshold必须运行完整 `crossedTickCount(7800ms)=936` 个 master ticks，保留两个 emitter、全部 RNG
  candidate identity、phase gate、continuous safe-gap sweep、damage/graze、profile parity与 pattern-end
  cancellation。source difficulty为上节固定的 `NORMAL`。
- pattern complete tick 必须已经撤回全部 digital body与live collider；仍存在的
  `threshold_sediment` 保持 `gameplayCollision=false`。该 tick在唯一 flush 后释放 transition occurrence，
  不等待 sediment 的 `2741ms` cleanup。
- 这是对稳定架构“entity/residue drain后才handoff”的唯一窄例外：transition occurrence的gameplay entity、
  collider与spawn/RNG权已经drain，尚存residue不是被遗弃或宣称complete，而是以opaque receipt原子转移给
  material-only owner继续完整生命周期。其他COMMON/ROOM/BOSS/WEATHER/TRANSITION occurrence仍须自身
  entity/residue全部drain后才能handoff。本次接受已同步更新`ARCHITECTURE_ZH.md` §10并回链本ADR。
- `CanonicalCombatKernel`新增仅对`transition.room_threshold`开放的opaque detach proposal：relative936先
  复验pattern complete、全部active entity都已是collisionless residue且live collider为0，flush前登记
  occurrence release，flush成功后才铸造carryover capability。旧kernel随后永久禁止再走advance/spawn/RNG/
  contact端口；只有carryover能持有并推进原pool中的剩余generation。
- 释放时铸造一次 opaque material-carryover receipt。carryover只可逐 master tick推进既有 residue，到期按
  V4顺序提交`projectile.residue.remove → projectile.lifecycle.complete`：不得RNG、spawn、arm、collision、
  contact、damage、graze、Override、metric或room identity写入。它必须在下一房tick owner flush前推进，
  使新occurrence与旧材料共享event bus，但不共享gameplay authority。
- pattern complete同tick冻结transition gameplay exit：记录 formal target、generation、
  request/world-swap/ready/complete ticks、transition occurrence/seed、pattern complete tick、
  transition encounter ordinal/difficulty salt、digital/collider count 0、material count与carryover receipt。
  若shared player已非terminal且timed state
  quiescent，同tick再冻结target-room handoff；否则只释放transition occurrence，在target room继续推进合法的
  recovery/respawn timer与material carryover，等player回到非terminal quiescent boundary才签发handoff。
  `run-ended`永不进入下一房。
- target-room handoff允许后继审查room admission；不自行选择目标房pattern/tier/difficulty，也不伪造
  `room.enter`。若后继room session尚未安装，Run在target room用idle owner继续推进input/timers与material
  carryover；不重开旧房session，不把sediment drain或player recovery冒充room completion。
- handoff公开`nextRoomAdmission="withheld-pending-room-plan-and-combined-pool-budget"`。material carryover
  可与同bus的后继owner组合不等于新occurrence已经安全admitted；successor必须先建立run-scoped aggregate
  pool reservation并证明carryover+新plan总预算，才能消费handoff启动战斗。EXT-013阶段只允许target-room
  idle与carryover并行。

### 5. 只读 presentation 与可见证据

- presentation的 world room ID来自 atomic FSM：preparing阶段仍是`FORCED_ALIGNMENT`，world-swap tick起为
  target，并保持到后续 owner接手。现有四房背景直接复用，不新增素材。
- transition pattern的warning、projectile与sediment来自combat snapshot；可复用V4 `threshold.*` frame做
  state/event-driven overlay，但动画时间、alpha、Reduced Motion或Flash Off不得写回FSM、collision或handoff。
- Run可增加renderer-independent子阶段`first_continuation_transition`，但narrative state与既有behavior
  owner仍是V4 `ROOM_SAMPLING`，不新增叙事phase/event或改写EXT-006 schema。accepted transition tick的
  committed `roomId`固定为`null`，active occurrence保留transition ID；目标房behavior window只从后继
  handoff消费后的首tick开始。这样不把transition算进任一room，也不改变H+1702 closure/projection字节。
- gameplay trace在Full、Reduced Motion、Flash Off完全一致。当前 audio若只能硬切，不得宣称已经实现V4
  room crossfade；该presentation能力单独验收。

## 被拒绝或延后的替代方案

- **只接650ms FSM**：拒绝；只改变房间身份/背景，删除了V4 authored transition gameplay与材料轨。
- **只跑7800ms pattern**：拒绝；没有canonical world identity、room-ready或player blocker事实。
- **把FSM放到pattern末尾**：拒绝；V4没有这个offset，且会让完整transition期间的world identity与blocker
  来源继续缺失。最小新规则是accepted transition request与pattern同tick开始。
- **等2741ms sediment drain再交接**：拒绝；把明确无碰撞材料误作gameplay gate，并偏离QA的7800ms下一房
  boundary。
- **H+1702同tick启动**：拒绝；该tick在formal target出现前已关闭，倒写会破坏event/tick ownership。
- **只支持当前integration seed的POLARIZED**：拒绝；EXT-012已经证明三target可达，transition必须覆盖完整
  legal output universe。
- **本片直接选择下一房occurrence**：延后；三房live admission仍缺partial-metric、tier、pattern与execution
  policy，不能用standalone fixture或14项伪数字偷渡。

## 数字—物质双螺旋与治理

- digital track：formal target → canonical world swap → 936-tick safe-gap behavior → target-room handoff。
- material track：departing/arriving规则相叠，digital cancellation留下threshold sediment；它可跨过下一房入口，
  但失去collision、damage与选择权后只等待自身cleanup。
- 旧规则不是被“战胜”，新房也不是奖励。三个target保持可达；无score、rank、阵营、好坏路线、telemetry或
  玩家画像。
- aaajiao审核同时启动、材料carryover与absence；Codex实现receipt、collision lease join、shared tick owner、
  projection与验证。无新增素材、依赖、网络、语言或设备门槛。

## 做减法结果与失败方式

- 已复用：EXT-012 exact target、V4 RoomTransitionMachine与四个event、Room Threshold完整pattern、
  PlayerDamage blocker lease、shared Run state/bus、现有四房背景与threshold frame。
- 删除：新event、伪room labels、第二套transition animation、target-specific reroll、完整composer、下一房
  occurrence、audio crossfade claim、asset与dependency。
- 新增预算：composition policy 1；prepared start-next-tick composite 1；formal receipt 1；transition
  occurrence 1；collision lease 1；handoff 1；material carryover owner 1；canonical event ID 0；asset 0 bytes；
  dependency 0；persistence field 0。
- receipt/source/H+1703/state/bus/player/pool/seed/content任一漂移在副作用前fail closed；运行中跨authority
  invariant failure使整个Run永久fail-stop，不继续暴露或恢复部分transition。
- carryover保留的allocation必须计入后继room的combined pool/performance admission；handoff receipt本身不
  分配新pool，也不保证任意后继plan都能与该材料预算共存；在successor gate完成前next-room combat保持
  typed withheld。
- offline无降级；pause冻结gameplay/FSM/carryover推进，丢弃暂停期间wall time。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；做减法、行为优先、双螺旋 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/runtime/state-machines-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | atomic room-transition states/events | repository license | `eb1c62d53b71c0c2bbf0fc91098791b59054be4f5472efbbf112dcd12f0794fd` |
| `runtime/world.ts` | V4 package / aaajiao | TypeScript reference / 4.0.0 | `240/500/650ms` RoomTransitionMachine | repository license | `15a06e0d92fe4d8e8a62f37903071b57a59ab150bfed6df67eb8fc48c1a56eec` |
| `manifests/runtime/runtime-contract-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | same-timestamp order、room-transition lease owner、residue no collision | repository license | `29c97a1c3c20b15b90b9d6c70e3c9cb5f41b5ca9fe2a2831c9a961e768d12306` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | Room Threshold 7800ms、seed、safe gap、2741ms sediment | repository license | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / 4.0.0 | transition schedule、seed、7800ms next-room boundary；非canonical join | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `src/authority/run-first-continuation-room-target.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | formal EXT-012 target与未消费WeakSet | repository license | `b85116bbec43763de8ffdd3e245a415b50d12952bfda6bc4407890f280ac3057` |
| `src/authority/room-transition.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | exact atomic FSM adapter；当前未接Run | repository license | `25d3a388780d08a9fd210a42a373b299250bd511c49ec415f3e330504346909a` |
| `src/authority/combat-kernel.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | Room Threshold direct capability与shared state；当前join withheld | repository license | `15e97d1d1a55d3a276a3e2d9ea23efdf93b3cbf7ca19966ccecb962098d83da1` |

## 实施验收门

- source integrity：V4 schema/ID/timing/pattern/seed/lease owner/residue contract与全部SHA-256 fail-fast。
- pure receipt/join：三target、clone/forgery/reuse/concurrent proposal、wrong boundary/content/seed/state/bus/
  player/pool；H+1702无写入；H+1703 prepared append/apply/flush原子性、local tick 0与same-tick exact order；
  显式锁定encounter ordinal 0、difficulty salt 0及四项seed evidence。
- atomic FSM：chunked/step parity、奇偶start、四event一次、world ID exact boundary、collision blocker begin→complete，
  其他lease共存不误开collision。
- gameplay：NORMAL exact schedule/RNG/safe-gap/contact/profile parity；relative936 complete时digital/collider为0；
  material-only carryover不spawn/RNG/collide/damage，按exact residue deadline cleanup。
- integration：复用唯一真实Run producer到H+1702，再推进同一session至atomic complete、pattern complete与handoff；
  三target使用pure exact source覆盖，不重复三次长前缀。
- presentation/E2E：扩展现有唯一`canonical-run.spec.ts`，证明target、world-swap背景、transition实体、complete、
  material handoff与无console/page error；smoke继续只负责boot，不复制长旅程。
- strict typecheck、直接受影响focused tests、`content:check`、production build与`git diff --check`；不并发运行
  heavy suites。

## 回滚与迁移

删除target transition receipt、join/session、material carryover、Run/presentation字段，即回到EXT-012的
`transitionAllowed=false`边界。V4、首房closure/projection/target bytes、selection RNG与archive无需迁移。
若后继room bootstrap改变handoff消费方式，必须以successor ADR消费或supersede本receipt，不能把standalone
room fixture静默接到旧target。

## 决策

ACCEPTED。V4没有写atomic FSM与Room Threshold的composition；“H+1703 prepared同tick启动、650ms只
稳定身份、7800ms释放gameplay入口、无碰撞sediment跨房carryover”接受为本扩展新增的最小连接规则。
authority、实现可行性与文档/provenance三路复核关闭全部P0/P1；实现仍须通过上列验收门才可提交。目标房
pattern/tier/difficulty、combined pool admission与真正的ordinal 1 room session继续由后继决定。
