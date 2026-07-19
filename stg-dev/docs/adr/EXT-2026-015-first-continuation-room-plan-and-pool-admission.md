# EXT-2026-015：首个 continuation room plan 与联合池准入

- 状态：ACCEPTED
- 日期：2026-07-19
- 前置：[EXT-2026-012](EXT-2026-012-first-continuation-room-target.md)、
  [EXT-2026-013](EXT-2026-013-first-continuation-room-transition.md)、
  [EXT-2026-014](EXT-2026-014-first-continuation-transition-input-ownership.md)
- 范围：ordinal 1 target room 的首个 occurrence plan、combined pool admission 与下一 tick 接管边界

## 背景

EXT-013在`transition.room_threshold`的relative tick120 936撤回数字身体、collider、spawn与RNG权，
随后把仍存的collisionless sediment转给material-only owner。player处于alive/quiescent边界时，同tick可
签发target-room handoff；旧材料不再拥有collision、damage、metric或room identity，因此不能被当作等待
下一房的gameplay gate。

handoff仍故意公开
`nextRoomAdmission="withheld-pending-room-plan-and-combined-pool-budget"`。V4定义了room composer pool、
三个intensity tier、encounter segment范围、单一Mulberry32、pattern seed公式和projectile pool上限，却没有
定义以下live连接规则：

- partial metric projection如何选择tier；
- online composer在已经消费room-target draw后从哪个RNG游标选首个pattern；
- `difficultySalt`、精确segment标量与首个successor occurrence ID；
- retained transition pool与新occurrence reservation如何按Run聚合；
- handoff receipt何时消费、旧owner何时失效，以及successor输入何时才有资格另行恢复。

`run-composer.ts`只复现Python QA composer，`live-run-admission.ts`只验证caller-resolved完整facts，现有
`live-room-session.ts`则是ordinal 0 Left/Right Gate的固定独立fixture。三者都不能冒充ordinal 1 producer。

## 决定

### 1. 只规划一个首 occurrence

本扩展建立`first-continuation-room`独立chapter，不复用硬编码ordinal 0的`roomSampling`。plan固定继承
EXT-012的exact target与`roomOrdinal=1`，只选择`encounterOrdinal=0`的一个ROOM pattern：

- 不决定总room count，不声明room complete，不提前选择第二/第三个encounter或Boss；
- 不改变target，不因执行能力、pool mapping或预算不足reroll/substitute；
- pattern候选保持target composer的manifest declaration order与完整四项pool；
- parallel固定`none`，weather echo不进入本次plan；
- canonical event写入为0；V4 event schema没有`room.enter`或segment pseudo-event，不新增替代ID。

缺少执行能力时，formal plan仍保留所选pattern与证据，但`admission`保持typed withheld。目标房继续安静，
不能用manifest第一项、当前支持项或测试seed方便结果替换。

### 2. partial intensity 的显式来源

tier采用V4 Python oracle的公式与阈值：

```text
score = clamp01((avgFlower + gazeRatio + overrideRatio) / 2)
listen/EASY   score < 0.28
read/NORMAL   0.28 <= score < 0.58
enforce/HARD  score >= 0.58
```

`avgFlower`和`gazeRatio`必须来自EXT-011正式projection并保持available；否则fail closed。`overrideRatio`
在源窗口中是typed missing，本扩展采用Python oracle对缺键的`0.0` fallback，但必须记录为
`authored-fallback-not-observed`及原missing reason，不得把它写成观察值、补回metric projection或改变
EXT-012 selection bytes。`recentInputDensity`已经参与target bias，但不进入V4 intensity公式。

### 3. 延续同一 online selection stream

EXT-012的application-authored continuation stream以raw Run seed运行Mulberry32 draw ordinal 0选择target。
本扩展从其exact `stateAfterDrawUint32`继续，draw ordinal 1选择首pattern：

```text
effectiveWeight = baseWeight * (samePreviousStructuralSignature ? 0.15 : 1)
```

previous signature来自已完成的`room.forced.left_right_gate`；signature与候选SHA-256来自V4结构报告。
当前跨房候选signature均不同，penalty实际为1，但证据与算法仍须保留，不能把当前数据巧合硬编码成无
penalty选择。selection完成后总draw数为2；不得重播draw 0或另开测试RNG。

### 4. occurrence、seed 与精确segment

首个successor occurrence固定为：

```text
occurrenceId = run:room:1:encounter:0:<patternId>
difficultySalt = 0x2200
resolvedSeed = rawRunSeed xor pattern.seed.base xor 0 xor 0x2200
```

`0x2200`是本application对ordinal 1首occurrence的窄domain separator，延续ordinal 0固定fixture的
`0x1100`约定；它不是V4全局difficulty policy，也不授权后续encounter照推。pattern仍只使用自己的一个
Mulberry32 stream。

精确segment采用V4范围的最小非早边界：`telegraph=520ms`、`entry=800ms`、
`materialSettle=900ms`、`safeGapHandoff=520ms`；`read=pattern.durationMs`，`rest`取所选tier的exact
`1600/1100/820ms`。这是首occurrence的live scheduling policy，不把QA的`room entry=1200ms`再叠加一次。

### 5. Run-scoped combined pool reservation

handoff receipt必须提供同一Run、同一event bus、同一target与exact handoff tick上的material summary。
旧material已经`liveColliders=0`，但其pool仍保留allocated slots；combined admission不能只看active body，
也不能把累计spawn数误作并发预算。

本扩展把room tier的`maxProjectiles`解释为该successor occurrence的最大并发authority entity reservation，
并由后继coordinator在运行时执行。准入前做以下保守join：

```text
carryover.allocatedSlots[class] + successorReservation[class] <= V4 poolBudgets[class]
carryover.residueVisuals + tier.maxProjectiles <= poolBudgets.residueVisualOnly
pattern.emitterCount <= tier.maxEmitters
tier.maxProjectiles <= encounterDirector.maxProjectileBudget[difficulty]
carryover.liveColliders == 0
```

primary archetype必须有Run options中的exact pool-class mapping。普通pattern把完整
`tier.maxProjectiles`记入该class，其他未生成class为0。若pattern可通过`op.split_generation`产生
`splitChildren`（当前为`room.information.missing_ack`），还必须先有exact child concurrency upper bound并
单独预留`splitChildren`；本扩展没有该证明，因此该formal selection保持
`withheld-missing-split-child-upper-bound`，不能按primary class预算放行。以后新增任何跨class operator也必须
按同一规则显式建模。retained allocated slots即使已pooled也继续占用，直到material owner被正式释放；不能
因`materialCount`下降偷偷扩张新预算。

join同时预留最坏情况下旧residue与新occurrence residue并存的visual-only容量，因此允许在
`materialCount>0`时接管。`drained=true`只是carryover active/residue为0的退化边界，绝不是新的产品门槛。

### 6. 一次性原子接管

plan与combined admission只接受原始opaque handoff receipt；public snapshot、clone、跨Run拼接、重复消费、
错误target/seed/bus/state或stale pool summary全部拒绝。预算失败、unsupported pattern或mapping缺失必须在
共享state/event mutation前返回typed withheld，handoff receipt仍可供同一事实上的合法重试；不允许通过
重抽pattern让预算通过。

成功proposal在handoff tick已经完整flush后提交：

1. 消费handoff与plan/budget reservation；
2. 使EXT-013 transition step owner永久失效并把material-only owner转交successor coordinator；
3. 在已经flush的handoff boundary中原子地把EXT-013 binding替换为持有target、material与budget lease的
   dormant successor owner；不存在“binding已释放但新owner未安装”的claim空窗；
4. 下一master tick只开始target-room telegraph step；同一tick仍只有一个owner/flush；
5. pre-READ期间`combat=null`，但dormant lease持续阻止其他occurrence claim；READ只在精确boundary通过该
   lease原子安装新kernel，不删除或重建旧material pool。

handoff tick仍属于transition。movement与Focus在transition期间本来就持续消费，successor只延续这项身体权，
不得描述成“恢复”。Signal/Gaze请求留痕、Flower/Gaze authority冻结的EXT-014规则继续覆盖dormant、telegraph
与entry；本扩展不尝试恢复，也不补放冻结窗口中的edge或sample。后续只有在独立决定写出carryover、身体、
Gaze/Flower、event append/apply与sole flush的prepared/rollback composite后，才能从某个exact successor tick
恢复这些通道。Override继续遵循独立解锁权，本扩展不借room entry自动开放。

## Presentation 边界

- world/audio identity在owner切换前后都保持formal target，不重启、不回退`FORCED_ALIGNMENT`；
- successor panel只读admitted room/pattern/difficulty/seed，不能从room ID猜pattern；
- pre-READ明确无combat/projectile；READ overlap时显示为old material与new combat两个disjoint identity流的并集，
  不能继续使用`material ?? combat`二选一；
- collisionless sediment仍只表现material；它不写target-room metric、damage或room completion；
- 没有exact enemy-body lifecycle/position binding前`targetVisible=false`，不使用renderer hash生成假敌人；
- 总room count未授权，不显示伪造的`05 / —`进度编号。

## 被拒绝的替代方案

- **等material完全drain再接房**：拒绝；把无碰撞材料重新变成gameplay gate，直接违背EXT-013。
- **调用QA full composer**：拒绝；它需要14项完整fixture、先选择全部rooms，并声明`liveIntegration=false`。
- **把missing metric填0后伪装完整metrics**：拒绝；仅`overrideRatio`在intensity公式处记录authored fallback，
  projection与target证据保持typed missing。
- **从当前已实现patterns筛选再weighted pick**：拒绝；会让机器能力改变玩法选择。
- **把tier budget当累计spawn上限**：拒绝；V4没有该口径，多个合法EASY pattern的候选总数已经超过80。
- **只在各occurrence私有pool内检查**：拒绝；无法证明carryover与新pattern并存时的Run总预算。
- **把split pattern只记入primary class**：拒绝；会绕过V4独立`splitChildren` pool，缺upper bound时必须
  typed withheld。
- **同handoff tick启动新owner**：拒绝；该tick已经由transition接受并flush，会造成双owner或倒写输入。
- **先释放EXT-013、下一tick再安装owner**：拒绝；在两个动作之间留下无预算lease的claim空窗。
- **owner切换即自动恢复Signal/Gaze/Flower**：拒绝；没有跨authority prepared/rollback与sole-flush证明。
- **复用ordinal 0 room session**：拒绝；其room、pattern、seed、bus和boundary均是固定fixture。

## 数字—物质双螺旋与做减法

- digital：formal target → one plan → combined reservation → next-tick telegraph → exact READ；
- material：Room Threshold sediment保留原generation、pool slot与cleanup deadline，在新room旁继续消退；
- 两轨只在预算与presentation union相遇；material不取得selection或collision权，digital不伪造材料已消失；
- 新增room target 0、pattern 0、canonical event ID 0、asset 0、dependency 0、telemetry 0；
- 只计划一个occurrence、parallel none、target hidden，避免提前制造完整composer、敌人层或进度语义。

## 验证门

- pure plan：三target、tier三阈值、draw 1/weight/signature/seed/segment、unsupported不reroll、clone与严格schema；
- combined gate：material>0成功、exact capacity成功、超1拒绝、allocated而非active计数、mapping与emitter cap；
- atomic handoff：fake/cross-run/reuse/stale、失败零mutation、post-flush binding原子替换、旧owner失效、
  下一tick唯一owner/flush；
- session：复用一个真实producer，证明H+1702 artifacts不变、overlap接管、movement/Focus连续且
  Signal/Gaze/Flower继续冻结；
- presentation：old material + new combat union、world不跳、pre-READ无旧combat、target仍隐藏；
- production preview：扩展现有controlled-RAF一条流程，到目标房首个live collider即止；不新增第二条长旅程；
- 每个切片只跑direct focused tests、typecheck与`git diff --check`；presentation路径的Playwright已包含
  `content:check`和production build，不重复跑全套。

## Provenance

| artifact | source/author | tool/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 做减法、行为优先、双螺旋、absence | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | pools、weights、tiers、budgets、constraints | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | segment ranges、difficulty caps、safe gap、parallel | repository license | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | class/residue budgets与overflow policy | repository license | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | pattern/seed/emitter/duration/archetype | repository license | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `gameplay/reports/pattern-structure-signatures-v4.json` | V4 package / aaajiao | generated report / 4.0.0 | structural signature penalty evidence | repository license | `a91e29043276280412c3a823949b04d2fdfc5ef7d5e48c5b9ca9ffea67a9e571` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / 4.0.0 | intensity fallback/threshold与weighted selection | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `src/authority/run-first-continuation-room-target.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | formal target、draw 0与opaque transition receipt | repository license | `8cbceebe45312c40636bc38c907136efb41041d031dbfa93422704fda0d82bb9` |
| `src/authority/run/chapters/first-continuation-transition.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | exact handoff、carryover与withheld admission | repository license | `4f451b41c5b924b5b1fddfce77f3faf50bdb891c8c6bed29b69cc9457b0e624d` |

## 回滚与后续

删除EXT-015 plan、budget receipt与successor coordinator，即回到EXT-013诚实的target-room idle；EXT-012
target、transition、material cleanup与历史capture无需迁移。后续room encounters必须另行决定composition、
metric window与room completion，不得把本次one-occurrence policy泛化。若性能实测要求改变reservation口径，
使用successor ADR并保留本记录，不能通过放宽数字静默绕过fail-closed gate。

## 接受记录

aaajiao于2026-07-19确认现有章节化、聚焦测试、完成即commit/push流程无需再加限制并授权继续开发。
本决定在该授权下采用V4事实与aaajiao skill可支持的最小连接：不重抽target、不填满missing、不等待material、
不提前做完整composer。三路只读审查确认当前阻塞是plan/pool语义而非测试，且上述方案保留EXT-013/014边界。
