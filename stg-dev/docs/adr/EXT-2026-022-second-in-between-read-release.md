# EXT-2026-022：IN_BETWEEN 第二个 occurrence 的 READ 与 gameplay release

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 实施 commit：`661c87e`（`feat: release second occurrence gameplay authority`）
- 前置：[EXT-2026-018](EXT-2026-018-misregistration-orbit-release.md)、
  [EXT-2026-020](EXT-2026-020-second-in-between-occurrence-plan.md)、
  [EXT-2026-021](EXT-2026-021-second-in-between-pre-read-and-read-start.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- 内容扩展门：`CONTENT_EXTENSION_ZH.md`；SHA-256
  `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：chapter orchestration / shared Run tick ownership / projectile pool audit / occurrence release；
  不修改 V4、canonical event schema、pattern geometry、素材、Session、presentation、archive、第三 occurrence、
  room completion 或 dependency

## 不可约事实（Metadata）

EXT-021 已在 global tick `6947` 安装 `room.in_between.misregistration_corridor` 的 READ local tick 0，
并恰好 claim encounter ordinal 1 一次；它明确拒绝消费 local tick 1。V4 已给出 pattern、EASY cadence、
projectile lifecycle、pool overflow policy 与 `10600ms` completion，但没有把该 kernel 与当前 Run 的旧材料、
room/player、sole-flush 和 occurrence release 自动组合。

无形容词机制句：同一个 Run owner 在 global `6948..8219` 推进 Misregistration READ local `1..1272`、
已 drain 的 Context Switch material lineage、idle room 与 player，每 tick 只 flush 一次，并在 local `1272`
数字身体全部撤回后释放 gameplay occurrence；材料 tail 从下一 accepted tick `8220` 另行推进。

## 负空间（Behavior > Content）

seed 1 的 EASY acceptance trace 在最后一个 authored burst 前已经占满 80 个 `micro` slots。最后一个候选仍然
消费 RNG 并通过 safe-gap preflight，却被 V4 `reject_new_spawn_and_log` policy 拒绝。屏幕不会显示它，canonical
event bus 也不会为它伪造 spawn、cancel 或 residue；它只作为 pool audit 保留。把它改成 safe-gap omission、
扩大预算、回收 live collider 或重抽 pattern，都会抹掉真实的容量行为。

pattern complete 后剩余形态不是“已消失”。数字 collider 在同 tick 关闭，材料继续保留 source identity、
cause 与 cleanup deadline；gameplay claim 释放不等待 renderer、alpha、声音或 residue drain。

## 数字—物质双螺旋

- digital track：EXT-021 exact owner、seed `4108513047`、EASY、126 个候选 draw、稳定 cadence/source order、
  swept safe-gap、80-slot pool gate、player contact/damage 与 local `1272` occurrence release。
- material track：成功取得 identity 的 projectile 按 impact、out-of-bounds 或 pattern-end cause 进入
  `misregistration_flake`；被 safe-gap 省略或 capacity 拒绝的候选没有材料历史。
- join：READ tick 同步推进旧 Context Switch lineage与新 combat；release tick先提交所有 collision-off/state
  事实，Run sole-flush 后才把新 combat 降为 sealed material-only owner。旧 lineage 的 retained lease不因
  material count 为零而自动归还。
- witness / restore：本扩展不新增 archive、snapshot schema 或 cross-run record；pool rejection保持运行期
  audit，不冒充 canonical gameplay event或玩家评价。

## 做减法结果

- 复用 V4 `room.in_between.misregistration_corridor`、`bullet.micro.notch_e`、`op.orbit_release`、`op.linear`、
  `offset_corridor`、projectile lifecycle、event IDs 和 pool overflow policy。
- 复用 EXT-016 已接受的“digital drain 后释放 gameplay，collisionless material 另行推进”原则，但为第二
  occurrence 的 owner/lease/sole-flush composition建立独立决定，不改写首 occurrence 历史。
- 删除新事件、容量提示、补偿 spawn、重抽、自动扩容、尾段等待、Session/presentation、第三 occurrence与
  room completion。
- 新增预算：canonical event ID 0；RNG domain 0；asset 0 bytes；dependency 0；persistence field 0；
  chapter phase `read/released-material` 1 组；pool audit沿用 V4 既有类型。

## 治理与非单一化

aaajiao 审核不可见的 safe-gap omission、capacity rejection 与 residue 都保留各自原因；Codex负责 exact tick、
owner、lease、event order与失败原子性。该路径不产生 score、rank、胜负、道德结局或评价性 telemetry。

movement 与 Focus 继续由 Run 身体权消费；合法 player contact 可以提交既有 damage/impact/lifecycle事件，不能
为了固定一条无伤 trace 而关闭伤害。Override仍未取得 Local Resistance，press/release edge必须在任何 tick
mutation前拒绝。键盘、触控、Gamepad、weather、reduced motion和flash-off不得进入seed、candidate order、
collision或release条件；这些player-visible parity仍等Session与presentation接入后验证。

## 行为契约

### 1. source、时间与 owner

- source必须是EXT-021安装的original opaque owner，绑定同一Run、event bus、idle `IN_BETWEEN` room、
  已drain的Context Switch material owner、committed plan/evaluation和Misregistration kernel。clone、JSON、
  另一Run或替换kernel均无效。
- global `6947` / local `0` 已由EXT-021关闭且flush；EXT-022只接受exact-next global `6948..8219`，对应
  local `1..1272`。通用实现必须从plan/read start推导，不能硬编码seed 1的绝对tick。
- 每个accepted tick先完整验证全部owner、exact-next input与idle room proposal，再由Misregistration combat推进
  shared Run player/input和gameplay facts，同步推进已drain predecessor、旧material lineage与idle room FSM，
  最后封存expected event count并由Run sole-flush。任何分裂flush、跳tick、重复tick或ambient flush都fail closed。

### 2. authored cadence 与真实 entity边界

`crossedTickCount(ms)=ceil(ms×120/1000)`。seed 1 / EASY 的关键事实为：

```text
READ local/global start          0 / 6947
collision.arm + first emit      90 / 7037
first armed/flight/collision-on 95 / 7042
pattern midpoint               636 / 7583
authored emit.end             1188 / 8135
authored residue.commit       1222 / 8169
last authored burst           1259 / 8206
last armed/collision-on       1264 / 8211
last safe-trace OOB cancel    1267 / 8214
pattern complete/release      1272 / 8219
```

- EASY cadence形成21个burst，每个6个候选，共126个候选与126次Mulberry32 call；候选无论safe-gap omission、
  capacity rejection或成功spawn都不得重抽或退回draw。
- `emit.end`与`residue.commit`是timeline marker，不是spawn cutoff或canonical event；`atMs=10491`的最后burst
  仍因`atMs < durationMs`合法执行。
- 对seed 1的无伤、safe-gap-following acceptance trace：43个候选被完整swept preflight省略；local `1259`
  的`print-a / burst 10 / source index 5`是唯一capacity rejection；82个entity取得identity。该拒绝只写
  `projectile.spawn.rejected` audit，不写canonical event或residue。
- 上述82个entity与唯一rejection是该acceptance input trace的验收证据，不是假定所有合法player输入都产生
  相同terminal count。player impact可合法改变entity cause与material timing；不变的是126候选/RNG order、
  80-slot硬上限、不得回收live collider和local `1272` pattern-end数字撤回。

### 3. pool、damage 与 canonical order

- 新kernel只能使用EXT-020 committed evaluation派生的`micro=80 / residueVisualOnly=80`预算。旧Context Switch
  retained `micro=80` lease继续计入combined `micro=160`；visible旧material已为0不能释放该lease。
- pool满时按V4拒绝当前新spawn并写audit；不得抛弃Run、借用第81个slot、提前删除residue或把拒绝改写成
  `source_withdrawn`。audit不是event schema ID，不能进入canonical serialization。
- movement/Focus每个accepted tick继续生效。Override edge继续锁定。player contact使用共享swept collision与
  damage transaction；damage、death、recovery或respawn timer不替代projectile digital-drain barrier，也不要求
  Run timed state quiescent后才能释放该occurrence。
- canonical same-tick order保持：

```text
spawn:   projectile.arm.begin → projectile.spawn.commit
arm:     projectile.armed → projectile.flight.begin
         → projectile.collision.on
cancel:  projectile.collision.off
         → projectile.cancel.commit → projectile.residue.begin
cleanup: projectile.residue.remove → projectile.lifecycle.complete
```

  phase priority始终为`collision-off → state/damage → collision-on → entity-spawn → feedback`；同phase再按稳定
  entity identity与local sequence排序。不得新增`warning.begin`、`emit.end`、`pattern.complete`或segment伪事件。

### 4. exact release 与 acceptance trace

- local `1272`先设置pattern complete并对全部remaining digital body执行pattern-end cancellation。只有
  `patternComplete=true`、`digitalBodiesDrained=true`、`liveColliders=0`且remaining entity全为collisionless
  residue时，才请求release。
- release请求发生在tick mutation内；Run sole-flush成功前active occurrence仍保持。flush成功后
  `activeOccurrenceId=null`、pending release/flush清空，并冻结Misregistration final combat snapshot。
  release本身不新增canonical event。
- seed 1无伤acceptance trace在release前总计82个entity：24个`out_of_bounds`、58个`pattern_end`；两个较早
  residue已完成，global `8219`精确保留80个collisionless residue、0 live collider、80 allocated `micro`
  slots。任何更宽泛输入路径只按其真实impact/cancel material计算，不伪造该固定count。
- release后的owner只能推进既有residue、Run player timer、旧material lineage与idle room；不能spawn、消费RNG、
  恢复collision、contact、damage、metric、selection或room transition。

### 5. tail 与 withheld边界

- global `8219`是READ/gameplay release边界；material-only tail从下一accepted tick `8220`开始，必须由后续切片
  决定并实现。
- 既有plan边界为rest start `8327`、slice close `8519`；无伤acceptance trace在`8519`仍有63个residue，
  最终在`8682` drain。不得延长composer segment等待drain，也不得在slice close强制清空。
- 本扩展不实现tail coordinator、material transfer、Session、presentation、warning footprint、音频、触觉、
  accessibility browser evidence、第三occurrence、room count/completion/handoff、Boss、后续room、archive或
  完整Run终点。

## 被拒绝或延后的替代方案

- **把READ与完整tail做成一个切片**：拒绝；gameplay release是清晰责任边界，材料继续存在不应阻塞claim释放。
- **给Misregistration 81个slot**：拒绝；绕过committed `listen` tier 80预算并改变可观察容量行为。
- **把最后候选算成safe-gap omission**：拒绝；它已经通过swept preflight，原因必须保持`budget_exhausted`。
- **pool满时重抽pattern或回收live collider**：拒绝；违反V4 overflow与single-stream规则。
- **等待player/Override timer quiescent才release**：拒绝；这些是Run-owned timed state，不是occurrence数字身体。
- **直接接Session和presentation**：延后；当前完成深度仅为direct chapter authority capability。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；做减法、负空间、双螺旋 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `stg-dev/docs/CONTENT_EXTENSION_ZH.md` | Danmaku / aaajiao + Codex | authored Markdown / mandatory gate | 完整读取；V4外composition与provenance | repository license | `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040` |
| `manifests/v4/package-manifest-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | package identity与authority order | repository source | `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | Misregistration cadence、motion、safe-gap、residue、seed | repository source | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | segment、EASY director cap、same-tick调度 | repository source | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | `listen` tier 80 projectile / 2 emitter / 1600ms rest | repository source | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | entity lifecycle、pool overflow、3851ms material residue | repository source | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `manifests/runtime/event-schema-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | canonical event IDs与required payload | repository source | `31c69e627e35e0c8dea828e1564592d6fc71059fa9ce654f92c660114648f0bb` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | immutable QA oracle / Python 3 `-B` | seed `4108513047`、EASY、30Hz reference | repository source | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `EXT-2026-021-second-in-between-pre-read-and-read-start.md` | Danmaku / aaajiao + Codex | accepted ADR / implemented at `83b3533` | global6947/local0 exact owner | repository license | `180bfb62a04769af89f0b4b3104202cc8a03ae66015510814dbdf9c5b84bba34` |

## 验证结果

- `python3 -B` QA oracle确认seed/EASY为21 burst、126 candidate，reference trace SHA-256为
  `1751456508b5d5898d03036d7038b4d1499aa0d9805a53cff27769046e03fd59`；其30Hz endpoint与golden-ordinal
  orbit phase只作reference，不替代EXT-018 production swept adapter。
- 现有seed-1真实producer已从EXT-021 local0推进到local1272。无伤safe-gap路径证明local90首spawn、local95
  首次armed/flight/collision-on、local1264最后collision-on、local1267最后OOB，以及release tick先58条
  collision-off再58组cancel/residue事实。
- 无伤路径精确得到126 RNG、82 entity、`24 OOB + 58 pattern_end`；local1259只有一条冻结的
  `budget_exhausted` pool audit，canonical event中没有伪spawn；global8219保留80个collisionless residue、
  0 live collider与80 allocated `micro` slots，combined allocated峰值160。
- 同一filtered case另用original admission/owner producer执行真实contact路径；它产生`player.damage.commit`，
  release时`runTimedStateQuiescent=false`且recovery/respawn deadline仍存在，但occurrence仍在global8219释放。
  这证明player timer不是digital-body release门。
- Override hostile edge与skip tick均在mutation前拒绝；release后READ port再次调用也零修改拒绝。claim始终一次，
  old material/predecessor/room每tick同步，tail明确停在`tail-advance-withheld`。
- `bun --bun vitest run src/authority/run/chapters/first-continuation-transition.test.ts -t "installs READ, starts reserved successor combat, and closes its exact slice"`、
  `bun run typecheck`与`git diff --check`通过；filtered case约13秒。本片未改Session、bundle或player-visible路径，
  因此按风险边界未运行build、smoke、E2E或browser；这些在对应接线里程碑补齐。

## 回滚与迁移

实现前回滚只删除本ADR索引和架构/路线图引用，EXT-021 owner仍安全停在`read-advance-withheld`。实现后回滚时
移除第二occurrence READ/release consumer，保留EXT-021 exact owner、EXT-020 plan/admission与V4 content digest；
已形成的canonical trace按extension provenance只读解释。不得以回滚为由扩大预算、重抽或清空material。

## 决策

ACCEPTED，implemented at `661c87e`。第二个IN_BETWEEN occurrence从EXT-021 global `6947` / local 0继续，
只推进local `1..1272`并在global `8219` digital drain与sole-flush后释放gameplay authority。80-slot capacity
拒绝、合法player damage与collisionless residue各自保留真实原因；material tail从global `8220`另片处理，
Session、presentation、第三occurrence与room completion继续withheld。
