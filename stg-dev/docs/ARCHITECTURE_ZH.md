# 1bit STG 技术架构基线

状态：`STABLE AUTHORITY CONTRACT`

本文只描述稳定技术契约、依赖方向与跨模块决策。当前覆盖率、优先级和施工缺口见
[制作路线图](ROADMAP_ZH.md)；验证方法见[测试与验收](TESTING_ZH.md)；独立设计决定与
provenance 见 [ADR 索引](adr/README.md)。

## 1. 权威来源与依赖方向

来源冲突时使用以下顺序：

1. `1bit-stg-complete-asset-kit-v4/manifests/**` canonical contracts；
2. `1bit-stg-complete-asset-kit-v4/runtime/**` reference machines/oracles；
3. `1bit-stg-complete-asset-kit-v4/gameplay/tools/sim_core.py` QA oracle；
4. `stg-dev/src/authority/**` production authority adapters；
5. `stg-dev/src/game/**` application/presentation integration。

依赖只允许向下游移动：

```text
V4 manifests / reference oracles
              ↓
        Content Authority
              ↓
 deterministic gameplay authorities
              ↓
     coordinator / Run session
              ↓
 read-only projections and adapters
              ↓
 renderer / audio / haptics / UI / PWA
```

Renderer、动画、音频、UI、weather、accessibility、PWA 和设备 API 不得向上游写 gameplay
authority。V4 素材包不因应用测试失败而修改。

## 2. 模块职责

| 路径 | 责任 | 禁止拥有 |
|---|---|---|
| `src/content/` | 加载 canonical entrypoints；验证版本、schema、ID、引用、文件 universe 与 digest | gameplay selection、mutable fallback、renderer state |
| `src/authority/` | clock、event、pattern、projectile、player、Boss/laser、narrative、snapshot/restore 等确定性状态 | DOM、Three.js、audio、wall-clock identity |
| `src/assets/` | 把 V4 manifest 条目绑定到浏览器 URL；声明共享素材与章节选择 | gameplay authority、复制二进制素材、preview/QA 替代品 |
| `src/game/` | 装配 authority、输入投影、renderer/audio/UI adapter 与应用生命周期 | 重解释 manifest、根据画面推断 collision/lifecycle |
| `src/main.ts` | boot mode、显式 URL facts、Run/Lab 入口和应用 wiring | 隐式 seed、第二套 Run authority |
| `e2e/` | production-preview 用户路径验证 | 注入私有 gameplay state 以伪造完成 |

Authority 只暴露冻结 snapshots、readonly views 或窄命令端口。调用方不能取得可变 pool、event
buffer、ledger 或内部 state 引用。

## 3. Content Authority

- 只从 V4 canonical entrypoints 建立 manifest-derived registries；禁止复制 ID 清单。
- version、schema、ID、引用、文件 universe 或 SHA-256 漂移立即 fail-fast。
- unknown operator、event、pattern、geometry、Boss binding 或 required payload 是错误，不回退到
  默认实现。
- V4 canonical counts 是内容契约；production coverage 是制作状态，两者不能混写。
- V4 外内容必须经过 `CONTENT_EXTENSION_ZH.md`、focused ADR 与 provenance；不得修改 V4 tree
  让 application tests 通过。

### 3.1 浏览器素材 registry

`src/assets/shared-v4.ts` 是 Vite `?url` 导入的唯一应用入口。每个物理 URL 必须与 V4 manifest 的
canonical ID、相对路径、SHA-256 和尺寸闭合；完整 frame universe 引用的 atlas 必须全部可用。未知
frame、atlas、room 或必需素材应 fail closed，不能用通用子弹、INFORMATION 房间或别的声音静默替代。

`src/assets/chapters/**` 只声明章节需要的 canonical ID、room projection 与明确的 feedback selection，
不再复制路径或二进制文件。共享 registry 是被动素材目录，不消费 RNG、不推进 tick、不拥有 collision
或 lifecycle；章节 snapshot/event 仍是何时显示或播放的唯一上游事实。QA preview、pattern 动画和生成过程图
不得进入 runtime registry。

V4 源素材与应用源码提交到 Git；`dist/`、hash 文件名和 service-worker artifact 由部署阶段构建，保持忽略。

## 4. 时间模型

整数 `tick120` 是唯一 gameplay 时间 identity。毫秒只用于输入/manifest 表达，并在边界向上取整
投影为 due tick；浮点时间不能成为 entity、event 或 occurrence identity。

- V4 60Hz machine 只在偶数 master tick 到期。
- 一次 frame 可以推进多个 gameplay ticks；每个 tick 仍按相同顺序独立提交。
- Pause 冻结 gameplay time，并丢弃暂停期间积累的 wall time；恢复时不补跑。
- Renderer 可插值表现，但不能推进或跳过 gameplay tick。
- cadence、arm、pattern end 与 residue drain 各自拥有 due-time；晚 materialize 不能因接近 complete
  而被提前删除。

## 5. Canonical event bus

Event ID 只来自 V4 schema。每个 event 带整数 tick、显式 occurrence identity、完整 required payload
和稳定 serialization；unknown ID、duplicate occurrence key、hole/accessor/custom prototype 等 hostile
输入 fail-closed。

同 tick 提交顺序固定为：

```text
collision-off → state/damage → collision-on → entity-spawn → feedback
```

Coordinator 可以保留当前 tick 给多个 authority 写入，但 tick close 后不可重开。Feedback 端口只读，
不能调用 gameplay command 或写状态。

需要跨多个 draft 的操作先完整 preflight，再一次 append。Receipt 只证明 exact bus/tick/draft group
已受理，可授权预计算 after-state；它不是通用数据库 transaction，也不能回滚任意 sibling mutation。

## 6. Determinism 与 identity

- 一个 pattern occurrence 使用一个 seeded Mulberry32 stream；消费顺序由 manifest source/declaration
  order 决定，不受 renderer cadence、对象插入顺序或 locale sort 影响。
- occurrence、generation、entity 和 event key 使用显式稳定 identity；排序使用稳定 code-point/byte
  规则。
- canonical serializer 拒绝非有限数字、稀疏数组、访问器、symbol、自定义 prototype 与重复 key。
- 同 seed、输入、content digest 与 profile-independent gameplay facts 必须产生同一 trace。
- accessibility 与 presentation weather 不进入 gameplay hash。

## 7. Pattern 与 motion adapter

Pattern adapter 必须验证完整 contract，而不是只挑实现方便的字段。Emitter cadence、geometry、motion
operator stack、safe gap、hook、residue、difficulty 和 pool ownership 都属于同一责任边界。

- operator 严格按 manifest declaration order 执行；跨 boundary 的 tick 必须明确旧/新 heading 或
  speed 在哪一段生效。
- safe-gap preflight 使用完整 swept path；warning 与 collision geometry 共享受权威证明的路径，
  不能只检查 endpoint。
- clock gate、phase gate、seam/offset discontinuity、turn 与 envelope 各自保留其声明语义；不能
  合并为通用“删除弹体”。
- Python/30Hz QA、declared contract 与 120Hz production path 分层记录。采样层不同就不宣称未证明
  的 trajectory、redirect 或 lifecycle parity。
- pattern 声明存在但没有 producer/evaluator policy 的 hook 必须 exact-validate 并保持 inert。

`room.in_between.misregistration_corridor`的production adapter把每个候选已有的唯一Mulberry32 draw同时
用于jitter与`phase = draw × 2π`，不增加RNG消费；arm后的轨道弧、精确release边界和linear余段组成同一
ordered swept path。完整未来路径在entity分配前执行spawn omission，运行时重复侵入则fail-stop。30Hz QA
的golden-ordinal phase与未定义的tangent组合不被冒充为production事实；决定与回滚见
[EXT-2026-018](adr/EXT-2026-018-misregistration-orbit-release.md)。

一个 isolated direct-kernel capability 只证明该 occurrence 可以在给定 authority 内执行。它不自动
授予 live admission、composer、selection、scheduler、room completion、session、renderer 或 handoff。

## 8. Projectile、collision 与 material lifecycle

Projectile/laser flight 由 entity authority 拥有：

```text
scheduled → materialized → armed → collision lease → terminal cancel/impact/OOB
          → collisionless residue → drained/released
```

- arm 前不移动/碰撞；collision lease 只由 gameplay authority 改变。
- contact、graze、Override、warning 与 rule clip 使用连续 swept geometry 和相同 ordered path。
- 不连续的 authority path 必须显式分隔 collision components；consumer 只在 component 内 sweep，
  不得跨 authored absence 自动补 connector。Ash Memory 的 accepted seam 见
  [EXT-2026-003](adr/EXT-2026-003-ash-memory-history-replay.md)。
- collision-off 必须先于同 tick terminal/cancel；residue 永不碰撞。
- renderer frame、alpha、animation end、audio、reduced motion 或 pool visual 不能终止实体。
- pool 满时拒绝新的 live collider；不得回收仍存活的 collider。
- generation 的 RNG/identity 和 material residue 不因表现缺席而消失。

Laser geometry 由 manifest topology/width/tolerance 驱动；pattern family association 不代表当前 Boss
phase 已授权 active laser。

## 9. Player 与局部 Override

Player movement、Focus、graze/evidence、damage、death/respawn 与 input lock 都属于 gameplay authority。
一次 damage proposal 必须绑定 owner、bus、tick、revision 和 exact draft receipt，append 成功后才应用
after-state。

Directional Override 只对授权区域/方向的实际 swept path 生效，并在真实 terminal 坐标留下 scar。
它不是全屏清弹，也不能由 UI、动画或 pattern hook 自动触发。dead、respawning、run-ended 或未授权
阶段必须拒绝其 edge。

## 10. Run、room 与 Boss 组合

把以下层级分开：

1. **Contract validation**：candidate 的 schema、seed domain、metrics、segments、parallel、Boss binding
   和 capability 完整；不写 bus。
2. **Admission**：确认 caller-resolved facts 可进入某个已支持的 authority；不选择、不组合、不排程。
3. **Composition/selection**：由明确 producer 生成 room order、difficulty salt、parallel/weather 与 Boss。
4. **Execution**：创建 run-owned bus/state/pools，按 causal boundary 执行 occurrence。
5. **Completion/handoff**：只有 authored terminal、entity/residue drain、narrative/room barriers 全部满足
   才提交。

任何下层 artifact 都不能被命名或投影成更高层已完成。Boss observe、phase exit、laser start、resolution
与 terminal 是不同 facts；generic projectile drain 不等于 Boss phase handoff。

Material transfer只允许focused ADR明确授权的窄边界：

- [EXT-2026-013](adr/EXT-2026-013-first-continuation-room-transition.md)允许
  `transition.room_threshold`在relative tick120 936撤回全部digital body、live collider、spawn与RNG权后，
  把仍存的collisionless residue以opaque receipt原子转交material-only carryover，再释放transition gameplay
  occurrence。
- [EXT-2026-019](adr/EXT-2026-019-first-continuation-successor-material-transfer.md)允许首个successor在exact
  slice close已sole-flush后，以零tick、零event、零RNG的prepare/commit把原pool与projectile identity转给
  occurrence material carryover，同时显式退休已经排空的transition capacity lease。新carryover的
  `allocatedSlots`在显式release前继续进入后续combined admission，不能从active或material数量推断释放。

两类carryover都只能继续原generation到
`projectile.residue.remove → projectile.lifecycle.complete`，不得spawn、collision、contact、damage、metric、
selection或room identity写入。除上述formal source外，occurrence仍须entity/residue全部drain后才能handoff；
material transfer本身也不授予handoff或下一occurrence，后继combat必须另行通过run-scoped aggregate pool
admission。

Canonical Run 的 rolling raw-facts port 只在一个 gameplay tick 全部关闭后观察：owner 在 step 前锁存，
validated request 与 committed authority 分栏，尚未消费的 domain 显式 missing；聚合内存受 canonical ID
universe 限制，不保存逐 tick history。该 port 不计算 composer metric、不消费 RNG、不写 event，也不把
handoff `H` 的新返回 phase 冒充本 tick owner。契约与 provenance 见
[EXT-2026-006](adr/EXT-2026-006-canonical-run-behavior-facts.md)。

进入首个 room owner 的 handoff tick `H` 由旧 owner 关闭；EXT-006 写入 H 后、公开 snapshot 返回前，Run
恰好冻结一次 accepted ticks `[1,H]` 的 exact aggregate capture。capture 使用共享 V4 content identity pin，
逐层拒绝额外字段，并明确不含 room plan、metric、selection 或 RNG authority；H+1 后 rolling facts 继续增长，
该 capture 永不改写。契约与 provenance 见
[EXT-2026-007](adr/EXT-2026-007-pre-room-behavior-capture.md)。

首个 fixed room slice 在 `H+1701` 的 room authority 与 rolling facts 同 tick 关闭后，Run 恰好冻结一次
accepted ticks `[1,H+1701]` 的观察边界；`H+1702` 及更晚 facts 不得回写该 snapshot。该边界只证明首个
occurrence 及其 material/rest tail 已被观察闭合，明确保持 `roomComplete=false`，且不取得 continuation、
metric projection、selection、transition、RNG 或 canonical-event 写入权限。它不替代 `[1,H]` pre-room
capture，也不授权下一房。契约与 provenance 见
[EXT-2026-008](adr/EXT-2026-008-first-occurrence-observation-capture.md)。

首个fixed room采用V4允许的最小1个READ occurrence；`H+1702`前parent先复验H+1701 frozen observation，
room authority再以同一shared run state/event bus关闭一个idle tick。preflight、idle与postflight全部通过后才
原子提交`roomComplete=true`；closure自身不写canonical event，parent同tick只允许既有Gaze/Flower suffix。
rolling ledger通过模块私有opaque receipt绑定exact `[1,H+1702]` facts，随后冻结planned/completed/remaining
为`1/1/0`、`completedRoomVisit={FORCED_ALIGNMENT,0}`、`distinctVisitedDelta=1`的typed closure capture。
该fact不是评价或进度，也不授权metric、selection、transition、target或handoff。契约与provenance见
[EXT-2026-009](adr/EXT-2026-009-first-fixed-room-closure.md)。

首房closure factory登记exact source并签发module-private receipt；Run在公开同一个`H+1702` snapshot前，
只从该receipt生成一次partial metric projection。EXT-011另在authority step前冻结per-channel consumption
proposal，成功关闭tick后才把`[H+1,H+1702]`的movement/signal/Focus/qualified-Gaze同tick并集提交到
O(1) private supplement；公开EXT-006 facts与EXT-009 closure bytes不变。closure source与supplement receipt
必须带同一个ledger lineage，seed/tick/window相同的跨session拼接也会fail-stop。投影可用项为`avgFlower`、
committed `clamped` `gazeRatio`与`recentInputDensity`；其他项继续typed missing。partial artifact没有
composer-ready `metrics`，不消费RNG、不写event，也不授权target、selection或transition；`H+1703`后的
rolling facts不得改写它。契约与provenance见
[EXT-2026-010](adr/EXT-2026-010-first-room-metric-projection.md)与
[EXT-2026-011](adr/EXT-2026-011-first-room-recent-input-density.md)。

EXT-012由正式projection对象签发单一opaque receipt；公开snapshot clone与unbranded fixture不能进入live
selector。Run在同一个`H+1702`公开边界中，从V4 room/composer一致的declaration order移除已完成的
`FORCED_ALIGNMENT`，按metric ID code-point order先从0累加available behavior bias，再计算
`totalWeight=1+bias`；missing term保留reason且不生成numeric 0。application-authored first-continuation domain
以raw Run seed执行一次Mulberry32 draw 0，冻结ordinal 1 target与候选证据。该target不解析总room count、
difficulty或pattern plan，不写canonical event，也不授权transition/handoff；H+1703后保持不变。契约与
provenance见[EXT-2026-012](adr/EXT-2026-012-first-continuation-room-target.md)。

EXT-013只消费原formal target；H+1703用prepared start-next-tick composite原子取得`room-transition` player
blocker、请求atomic FSM并安装Room Threshold local tick 0。world identity只在
`room.transition.world_swap.commit`改变；650ms complete只释放blocker，不结束7800ms gameplay pattern。
transition tick的rolling room context为null，不进入旧房或目标房metric window。relative936完成数字交接后，
纯材料residue按上列窄例外继续；target-room handoff仍不选择pattern/tier/difficulty，combined pool gate完成前
只允许target-room idle与carryover。契约与provenance见
[EXT-2026-013](adr/EXT-2026-013-first-continuation-room-transition.md)。

EXT-015只在该opaque handoff之后规划ordinal 1首个occurrence：以正式partial facts计算V4 intensity，
`overrideRatio`的QA fallback显式标为未观察；沿EXT-012 continuation Mulberry32 stream消费draw 1，完整保留
target composer pool且不按当前实现能力重抽。plan使用最小V4 segment边界、固定`0x2200` occurrence salt与
parallel none，不决定后续encounter或room completion。准入按Run合并retained carryover allocated slots、
residue visual与新tier concurrent reservation；material未排空也可安全接管，drain不是新gate。handoff tick仍
归transition，post-flush原子换成持有预算的dormant successor owner，下一tick才开始step。movement/Focus按
既有身体权继续；Signal/Gaze/Flower在另有原子successor input决定前保持EXT-014冻结。契约与provenance见
[EXT-2026-015](adr/EXT-2026-015-first-continuation-room-plan-and-pool-admission.md)。

EXT-016在successor pattern撤回数字身体、collider、spawn与RNG权后先释放gameplay occurrence，剩余
collisionless residue由同一sealed owner单独推进；`materialSettle + rest`和slice close保持composer原值，
不为等待residue而延长，也不在close强制清除。slice complete后owner继续exact-next-tick material hold，
但不取得room completion、handoff或下一occurrence权限。契约与provenance见
[EXT-2026-016](adr/EXT-2026-016-first-continuation-terminal-material.md)。

EXT-017把该owner接入正式Canonical Run：transition sole flush后的同tick以零event、零tick admission转移，
下一accepted tick才开始successor telegraph；transition chapter作为只读lineage保留且不得再step。pre-READ
顶层combat为null，不回退旧transition combat；presentation把旧transition material与当前successor
combat/residue按各自identity并列投影，任一lineage、pattern或projectile identity漂移均fail closed。typed
withheld保留原reason且不重抽或静默重试。契约与provenance见
[EXT-2026-017](adr/EXT-2026-017-first-continuation-session-projection.md)。

EXT-019在该successor exact slice close后建立下一消费边界：正式source仍有collisionless residue时不等待
drain，也不延长composer segment或清空材料；post-flush prepare/commit只替换sealed material owner并处理
capacity lease，不推进Run。原pool、identity与deadline保持，next plan必须继续计算retained allocated slots；
room completion、handoff与next-occurrence admission均保持typed withheld。本边界可供下一plan/admission消费，
但不代表Session接线、同tick双owner协调或完整multi-pool flow已经完成。契约与provenance见
[EXT-2026-019](adr/EXT-2026-019-first-continuation-successor-material-transfer.md)。

EXT-020只消费上述original in-memory exact source，在同一个已flush slice-close tick规划并准入
`encounterOrdinal=1`。它延续EXT-012/015的application Mulberry32 stream消费draw 2，从移除Context Switch后的
manifest顺序无放回选择Misregistration Corridor；复用首plan冻结的`listen/EASY`，使用明确标为V4外policy的
`0x2201` salt、最小非早segment与parallel none。当前source的80个retained `micro` allocated slots/46个residue
与新80-slot reservation合并为`160 micro / 126 residue`后通过V4容量门。selection消耗一次composer draw，
admission本身仍为零event、零tick、零额外RNG；同tick只安装dormant owner，下一accepted tick才可telegraph。
该stream不冒充先抽完room的full QA cursor；第三occurrence、room count/completion、Session接线与双pool sole-flush
coordinator继续withheld。契约与provenance见
[EXT-2026-020](adr/EXT-2026-020-second-in-between-occurrence-plan.md)。exact producer到dormant owner的原子交接
已经实现；下一tick双pool coordinator与Session接线状态以Roadmap为准。

EXT-021接受下一段authority边界：EXT-020 dormant owner从`T+1`开始，在一个Run-owned transaction中推进已drained
threshold lineage、room/player与Context Switch collisionless material，最后sole-flush；`T+1..T+62`为telegraph、
`T+63..T+158`为entry。`T+159`仍先关闭material/room tick，随后才安装空的Misregistration local-tick-zero
kernel并claim encounter ordinal 1一次。material drain不释放retained pool lease。READ advance、Session、
presentation与room completion继续withheld；契约见
[EXT-2026-021](adr/EXT-2026-021-second-in-between-pre-read-and-read-start.md)，exact authority路径已由`83b3533`
实现并停在typed `read-advance-withheld`边界。

EXT-022接受第二occurrence的READ/release composition：从EXT-021已flush的local tick 0开始，每个exact-next tick
继续在同一个Run transaction中推进旧material lineage、room/player与Misregistration combat，并由Run sole-flush。
pool exhaustion沿V4 policy只拒绝当前spawn并留下audit，不伪造成safe-gap omission、canonical event或residue；
movement/Focus继续，player damage合法，Override在Local Resistance取得前锁定。pattern-end先撤回全部digital
body/collider，sole-flush成功后释放gameplay claim，collisionless residue由独立material-only tail继续；release
不等待material drain或Run timer quiescence。契约见
[EXT-2026-022](adr/EXT-2026-022-second-in-between-read-release.md)；exact authority路径已由`661c87e`实现并停在
typed `tail-advance-withheld`边界。Session、presentation、第三occurrence与room completion不由该决定授权。

EXT-023接受第二occurrence的collisionless tail与owner replacement：global `8220..8519`继续在一个Run
transaction中推进两个已drain lineage、Misregistration residue、room/player并sole-flush；材料lineage只允许原
entity cleanup，既有Run-owned player deadline event继续。composer rest在`8327`开始，slice必须在`8519`关闭，
即使真实producer仍有63个residue；不得等待`8682` drain或强制清屏。close后零tick/event/RNG退休旧Context
Switch material lease，并把Misregistration原pool、identity、deadline和80-slot lease交给新的opaque material
owner。契约见[EXT-2026-023](adr/EXT-2026-023-second-in-between-material-tail-transfer.md)；exact authority路径已由
`902e57d`实现，Session、第三occurrence、room completion与handoff继续withheld。

EXT-024只消费上述exact material owner：global `8520..8682`逐tick同步Run/player、idle room、两条已排空
历史lineage与Misregistration residue，并继续由Run sole-flush。每个entity按自己的deadline产生相邻
`projectile.residue.remove → projectile.lifecycle.complete`；正式producer最后一组位于`8682`。drain后仍保留
80-slot allocation，`8683` empty hold也不自动release、选择第三occurrence或关闭room。Run在不可逆flush前验证
exact owner、四lineage、pool admission、room/player/Override与tick同步。契约见
[EXT-2026-024](adr/EXT-2026-024-second-in-between-post-close-material-hold.md)；exact authority路径已由`953159e`
实现；该决定自身不授权Session、下一consumer、room completion或handoff。

EXT-025把EXT-019—024的original opaque owners装入一个章节级判别式progression owner，Session只保留一个
`firstContinuationRoom`引用并把accepted tick交给当前child。global `6788`在首slice sole-flush后同tick完成
Context Switch material transfer与Misregistration plan/admission；global `8519`同样在第二slice sole-flush后
立即转为Misregistration material owner。两次换手均为零tick/event/RNG，旧owner不可恢复，顶层Session phase与
`segmentTick120`不重置。公开stage只可能是`first-occurrence`、`first-material-withheld`、
`second-occurrence`或`second-material`；typed withheld只推进原material，不重试或重抽。

只读presentation按transition material → progression material → combat稳定排序，并按stage校验plan、room、
pattern、occurrence、difficulty和material lineage；重复projectile identity或来源漂移fail closed。material hold
从read-start推导连续显示时间，不在owner换手时把HUD归零。global `8683`仍是同一Session中的empty material
hold与80-slot allocation；第三occurrence、room completion/handoff和下一consumer继续缺席。契约与provenance见
[EXT-2026-025](adr/EXT-2026-025-second-in-between-session-projection.md)，实现提交为`0c54b9a`。

## 11. Narrative、snapshot 与 cross-run restore

Snapshot 只观察当前 Run，不评价玩家，也不自行写 cross-run event。Serialize 成功后才能铸造与
exact bus/token/payload/tick 绑定的 receipt；Archive 只接受该 receipt，durable storage 另有责任。

Restore 顺序固定为：

```text
material record → ghost route → ghost residue → witness → input return
```

Ghost collision/reward/emitter 为 `NONE`。Snapshot complete、archive acceptance、gaze release 或 room
swap 都不能单独授权 handoff。跨 Run ledger 必须防止 previous-run、route 与 next-run 的重复/冲突，
失败时不留下部分 index。

## 12. Presentation、PWA 与更新

- Renderer/audio/haptics/UI 只消费 frozen projection；不得保存隐藏 gameplay state。
- 视觉截图是表现证据，不是 collision/order/lifecycle 证据。
- `full`、`reducedMotion`、`flashOff` 与 weather presentation 必须产生相同 gameplay trace。
- PWA 使用 waiting-worker；运行中的 gameplay 不由新 worker 接管。只有安全 boot/Run boundary 可以
  提升版本，禁止混用 content digest。
- build/release metadata 记录 Git commit、V4 package/content digest、extension digest、Bun/runtime
  版本与 build mode。

## 13. Failure 与扩展原则

- validation 在 mutation 前完成；不可恢复的 authority mismatch 立即 fail-stop。
- event append 拒绝、stale receipt、reentry、wrong owner/tick/revision 都不得留下部分 gameplay state。
- 不为“看起来能跑”创建默认 ID、fallback pattern、伪事件、固定生命周期 timeout 或 renderer-owned
  completion。
- V4 没有定义的数值/映射必须标记 `application-required-v4-omission`，记录来源、影响、测试和回滚。
- 新机制、内容、文案、视觉/音频语言或 provenance 决定使用 focused ADR；不要继续扩张历史 umbrella
  ADR，也不要建立第二套 gameplay language。
