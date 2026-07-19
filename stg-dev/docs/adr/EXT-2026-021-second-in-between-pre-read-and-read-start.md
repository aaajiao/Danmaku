# EXT-2026-021：IN_BETWEEN 第二个 occurrence 的双材料 pre-READ 与 READ start

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 实施 commit：`83b3533`（`feat: start second occurrence read authority`）
- 前置：[EXT-2026-019](EXT-2026-019-first-continuation-successor-material-transfer.md)、
  [EXT-2026-020](EXT-2026-020-second-in-between-occurrence-plan.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：chapter orchestration / shared Run tick ownership / deferred occurrence install；不修改 V4、canonical
  event schema、pattern executor、素材、Session、presentation、archive、room completion 或 dependency

## 不可约事实（Metadata）

EXT-020 已在 source tick `T` 把 Context Switch 的 collisionless residue 与 80 个 retained `micro` slots交给
Misregistration Corridor 的 dormant owner，但没有能消费 `T+1` 的 coordinator。若直接使用旧material hold，下一
plan没有owner；若直接启动新kernel，旧材料时钟、room/player和sole-flush会分裂。

无形容词机制句：同一个Run owner在`T+1..T+159`推进room/player、Context Switch residue与第二occurrence边界，
每tick只flush一次，并仅在`T+159` flush后安装Misregistration local tick 0和claim encounter ordinal 1。

## 负空间（Behavior > Content）

Context Switch 的残留会在下一段telegraph早期自然消失。它不是“等清屏才能继续”的门，也不是可回收预算的
提示；它记录上一数字身体仍有材料寿命。第二段的警告/进入时间独立前进，让消失成为跨段痕迹，而不是流程
条件。

本扩展不增加敌人、提示图标、台词或音效。pre-READ保持无新combat entity；玩家movement/Focus继续被Run
消费，Override保持锁定。屏幕表现与Session接线仍未授权，不能用计划状态冒充玩家已经看见telegraph。

## 数字—物质双螺旋

- digital track：EXT-020 plan、draw 2结果、resolved seed、encounter ordinal 1、combined admission与READ claim。
- material track：Context Switch原projectile identity、cleanup deadline、46个source-tick residue与80-slot lease；
  更早Room Threshold carryover已drained但继续作为同Run lineage proof。
- join：每个accepted tick先关闭共享room/player/material mutation，再推进Context Switch collisionless material，
  最后由Run唯一flush；材料drain不写selection，也不释放retained lease。
- witness / restore：snapshot公开当前material count、原lease与next phase；不新增cross-run record或恢复字段。

## 做减法结果

- 复用V4 Misregistration pattern、现有120Hz clock/event bus、Context Switch material kernel、Room FSM、player、
  EXT-020 plan/evaluation与deferred shared-kernel install形态。
- 删除新selector、第二条RNG、等待drain、slot自动归还、parallel pattern、Session/presentation、第三occurrence、
  room close、资产与新event提案。
- 新增预算：chapter phase 2（pre-read/read）；kernel owner 1；canonical event ID 0；RNG draw 0；asset 0 bytes；
  dependency 0；persistence field 0。

## 治理与非单一化

aaajiao审核残留不是门、silence不被通用反馈填满、路径不重抽；Codex实现exact tick/owner/flush与失败原子性。
该执行不评价玩家，不产生score/rank/victory/defeat/telemetry，也不因键盘、触控、Gamepad、weather、
reduced-motion或flash-off改变plan、seed、claim或collision。

当前API只接`CanonicalCombatStepInput`，因此只能证明movement/Focus与Override规则，不能声称signal、gaze、
触控、Gamepad或无障碍player-visible parity。上述证据等Session和presentation接入后再跑。

## 行为契约

### 1. exact source 与边界

- source只能是EXT-020已commit的opaque next owner，绑定同一Run、event bus、room、Context Switch material
  owner、plan与combined evaluation。clone、JSON或另一Run的owner均无效。
- seed 1真实producer的source tick为`T=6788`。通用实现使用plan的`plannedAtTick120`，不得硬编码绝对tick。
- source必须已flush：active/pending occurrence、pending flush和event queue为空；room在`IN_BETWEEN` idle；
  player alive且collision on；Override idle；Room Threshold predecessor已drained；Context Switch material全为
  collisionless residue。

### 2. telegraph / entry / READ start

`crossedTickCount(ms)=ceil(ms*120/1000)`。EXT-020采用`telegraph=520ms`、`entry=800ms`，因此：

```text
dormant admission  = T
telegraph ticks     = T+1 .. T+62
entry start         = T+63
entry ticks         = T+63 .. T+158
READ local tick 0   = T+159
```

seed 1的绝对证据为`6789..6850 / 6851..6946 / 6947`。不能按render frame、wall time或60Hz取整替换。
pre-READ每次只接受`currentTick+1`，跳tick、重复tick、Override edge和READ前后错位均在authority mutation前拒绝。

### 3. 双材料 sole-flush

每个`T+1..T+159` tick必须保持一个共享transaction：

1. 验证原owner/plan/evaluation、room/player与两个material lineage；
2. 推进已drained的Room Threshold predecessor、Run player/input与idle room FSM；
3. 推进Context Switch material kernel到同一个tick，删除到期residue但不产生collision；
4. 更新sealed expected event count；
5. 由`CanonicalRunCombatState`唯一flush该tick。

pre-READ允许的event suffix只有既有`projectile.residue.remove`和`projectile.lifecycle.complete`。没有到期material
时可以是空suffix；任何spawn/arm/collision/damage/room transition或未知event均fail-stop。material count降到0后，
原80个allocated slots仍保留在EXT-020 combined reservation，不能从可见数量推断lease release。

### 4. READ local tick 0 与claim

- `T+159`先完成上述collisionless material/room/player tick并sole-flush；随后才安装已预构造且无entity的
  Misregistration kernel。安装不写canonical event、不推进pattern local tick、不消费RNG。
- kernel参数必须逐项等于EXT-020 plan：pattern、occurrence、room、EASY、resolved seed `4108513047`；pool budget
  从committed evaluation的resolved class/request生成，禁止复制常量80。
- install要求该occurrence从未claim；成功后恰好把它加入claimed set一次并设为active。local tick 0时
  projectile/residue/live collider均为0；`warning.begin`是pattern timeline事实，不等于新增canonical event。
- READ tick 1、spawn、warning/collision geometry投影、damage、pattern completion与material transfer均不在本扩展。

### 5. failure 与withheld边界

- 所有可验证前置在authority mutation前检查。共享tick一旦被接受，任何postcondition/event drift都永久fault该
  Run/owner，不允许重试同tick或切换备用路径。
- 本扩展不接`CanonicalRunSession`，因此完成状态是direct chapter authority capability，不是player-visible或
  E2E-complete。
- READ advance、tail、第三occurrence、room count/completion/handoff、Boss、后续room、archive与完整Run终点
  继续typed withheld。

## 被拒绝或延后的替代方案

- **先等Context Switch residue drain**：拒绝；把材料寿命变成流程门。
- **drain后把80 slots归还再创建kernel**：拒绝；lease只有显式owner transfer/release能改变。
- **新kernel自己flush或先claim再补旧material**：拒绝；产生双flush或同tick半状态。
- **复用旧Room Threshold material作为当前combined carryover**：拒绝；它已drained，EXT-020保留的是Context
  Switch pool。
- **本片继续跑完整Misregistration READ**：延后；READ tick execution/release/tail是下一独立责任。
- **同时接Session和浏览器**：延后；先证明authority coordinator，再在player-visible里程碑运行browser门禁。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；做减法、负空间、双螺旋 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | Context Switch residue 3150ms；Misregistration 10600ms、seed、2 emitters、micro | repository license | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | segment范围、EASY 120 cap、safe-gap 520ms | repository license | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | entity lifecycle、pool与residue预算 | repository license | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `manifests/runtime/event-schema-v4.json` | V4 package / aaajiao | canonical JSON / 4.0.0 | cleanup event identity与same-tick order | repository license | `31c69e627e35e0c8dea828e1564592d6fc71059fa9ce654f92c660114648f0bb` |
| `EXT-2026-020-second-in-between-occurrence-plan.md` | Danmaku / aaajiao + Codex | accepted ADR | exact owner、draw 2、plan与combined admission | repository license | `75677d6eac4b5eb10c115cc3264df789b959e62162a6e7582181f4cba843b9cf` |

## 验证结果

- 唯一真实seed-1 producer case通过，证明`T=6788`、`T+1/+62/+63/+78/+158/+159`，未新增第二条长fixture。
- 46个Context Switch residue在`T+78`前恰好写92条既有cleanup event并drain；80-slot lease、160-slot
  combined reservation与126 residue reservation保持不变。
- `T+158`仍unclaimed；`T+159=6947` sole-flush后恰好claim一次，Misregistration kernel停在local tick 0，
  entity与RNG消费均为0。snapshot明确写`read-advance-withheld`，未把READ tick 1冒充为已授权动作。
- skip/repeat/Override/wrong phase在mutation前拒绝且状态不变；movement/Focus在accepted READ-start tick继续推进。
- `bun --bun vitest run src/authority/run/chapters/first-continuation-transition.test.ts -t "installs READ, starts reserved successor combat, and closes its exact slice"`、
  `bun run typecheck`与`git diff --check`通过。按风险边界未运行全套、build、browser或accessibility；本片没有
  Session、presentation或runtime-build接线。

## 回滚与迁移

实现前可删除本ADR索引和引用，EXT-020 owner仍停在dormant。实现后回滚时移除pre-READ/read-start consumer，
保留EXT-020 plan/admission与Context Switch material owner为只读；不迁移content digest、archive或存档。

## 决策

ACCEPTED。关闭第二occurrence从dormant到READ local tick 0的authority路径：完整推进telegraph/entry、保持旧材料
自然drain但不归还lease、每tickRun sole-flush，并在`T+159`后置claim一次。READ tick 1、Session、presentation、
第三occurrence与room completion继续withheld。
