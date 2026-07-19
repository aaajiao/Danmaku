# EXT-2026-024：IN_BETWEEN 第二个 occurrence 的 post-close 材料持有

- 状态：PROPOSED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置：[EXT-2026-023](EXT-2026-023-second-in-between-material-tail-transfer.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- 内容扩展门：`CONTENT_EXTENSION_ZH.md`；SHA-256
  `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：chapter material lifecycle / idle room / player timer / sole-flush；不修改 V4、canonical event、
  RNG、pattern、第三 occurrence、room completion、Session、presentation、archive、素材或 dependency

## 不可约事实（Metadata）

EXT-023 在 global `8519` 关闭第二个 occurrence slice，并把仍在场的63个 collisionless
`misregistration_flake` residue及原80-slot `micro` allocation交给新的opaque material owner。V4 projectile
lifecycle要求这些entity按各自deadline自然产生cleanup；正式seed-1 / EASY producer的最后一个residue在global
`8682`消失。V4没有规定slice关闭后立即规划第三 occurrence、关闭room或等待材料排空。

无形容词机制句：从global `8520`起，exact material owner逐tick推进shared player、idle `IN_BETWEEN` room、
两条已排空历史lineage和现有Misregistration residue，并由Run sole-flush；global `8682`自然清理最后一个entity，
但80-slot allocation和room/next-occurrence决定继续由同一owner显式持有。

## 负空间（Behavior > Content）

slice已经结束，残留没有因此消失。把第三 occurrence或room completion绑到global `8682`，会让不可碰撞材料重新
成为玩法进度门；在`8519`清屏则会删除每个entity自己的物质时间。本扩展只保留“章节时间结束后，材料继续老化”
这一行为，不增加等待提示、倒计时、音效或评价。

材料排空也不是自动释放capacity的证据。`materialCount=0`表示现场已经缺席，`allocatedSlots=80`表示这段lineage
仍未被未来consumer显式退休；两者必须同时可观察，不能用一个覆盖另一个。

## 数字—物质双螺旋

- digital track：exact-next global tick、opaque owner、Run player、idle room、空event queue与sole-flush。
- material track：63个既有residue保留instance/generation/source/terminal cause和cleanup deadline；只允许自然
  `projectile.residue.remove → projectile.lifecycle.complete`。
- join：两条旧lineage只同步tick且保持drained，不恢复capacity或gameplay lease；新lineage排空后仍保留原80-slot
  allocation，等待未来显式consumer。
- witness / restore：本扩展不新增archive或presentation；公开snapshot不是room/next-occurrence receipt。

## 做减法结果

- 复用V4 projectile lifecycle、EXT-016 material-only推进原则、EXT-023 owner/pool和现有Run sole-flush。
- 不新增事件、RNG draw、projectile、timer、segment、room FSM、素材或依赖。
- 不选择第三 occurrence，不计算room cardinality，不退休80-slot lease，不签发room completion/handoff。
- 新增预算：material-only step port 1；canonical event ID 0；RNG draw 0；asset 0 bytes；dependency 0。

## 治理与非单一化

aaajiao审核材料排空不等于章节评价、等待不成为进度门以及现场缺席仍保留allocation事实；Codex负责exact owner、
tick join、event order和失败原子性。keyboard、touch、gamepad、weather、reduced motion与flash-off不得改变cleanup
deadline或最终drain tick。本决定不产生score、rank、胜负、好坏结局、玩家画像或telemetry。

## 行为契约

### 1. exact source与owner

- source只能是EXT-023在已flush global `8519`铸造的original material owner；必须绑定同一Run、event bus、
  Misregistration kernel、已退休Context Switch capacity lease、已drain Room Threshold lineage与idle
  `IN_BETWEEN` room。clone、JSON、跨Run、旧owner或替换kernel均无效。
- owner只接受exact-next tick；skip/repeat、并发step、pending event/flush/release、active occurrence或Override edge在
  mutation前拒绝。pause仍由上游不调用step表达，不补跑wall time。

### 2. 每tick join

- 每个accepted tick先完整验证Run/player/Override、room proposal、两个旧lineage和新material pool，再按既有顺序推进
  player timer、旧lineage observation tick、Misregistration residue与idle room，最后只由Run flush一次。
- 旧lineage必须保持drained、0 material、0 live collider且不产生event；新lineage只允许cleanup pair。Run-owned
  player deadline可以按既有V4 transition产生collision/invulnerability/respawn事件，但不能成为hold完成门。
- movement与Focus继续；Override在Local Resistance授权前保持locked。hold不得spawn、arm、恢复collision、消费RNG、
  执行contact/damage/graze、写metric/selection或推进room transition。
- cleanup保持canonical same-tick phase和稳定entity order；remove必须紧邻同identity lifecycle complete，不能倒写到
  `8519`或合并多个deadline。

### 3. full drain与空材料持有

- 正式seed-1 / EASY source在global `8520..8682`只自然清理EXT-023转交的63个residue；global `8682`后
  `materialCount=0`、`residueVisuals=0`、`liveColliders=0`、`activeSlots.micro=0`，RNG仍为126。
- `allocatedSlots.micro`在drain前后都保持80。global `8682`不自动退休lease、不写segment/room event、不改变
  `roomCompletion="withheld"`、`roomHandoff="withheld"`或
  `nextOccurrenceAdmission="withheld-pending-decision"`。
- 同一owner在drain后仍可接受exact-next empty hold tick；该能力只防止Run时钟停摆，不授权无限关卡、第三
  occurrence、room close或handoff。未来consumer必须用独立decision显式接管或退休lease。

### 4. failure与原子性

- mutation前错误保持Run、event、room、player和所有material serialization不变，并允许合法exact-next重试。
- accepted tick后的内部不一致使共享Run fail-stop，不得从半推进lineage恢复。
- 旧EXT-023 step owner、已退休Context Switch owner、伪owner与重复同tick调用均不能推进新material。

## 被拒绝或延后的替代方案

- **在8519清屏**：拒绝；删除63个entity-owned历史。
- **等到8682才允许章节继续**：拒绝；把collisionless材料变成进度门。
- **drain时自动释放80 slots**：拒绝；material count不是lease retirement receipt。
- **8519立即规划第三 occurrence**：延后；V4没有给cardinality/next-consumer policy，且联合池必须看到真实owner。
- **8519或8682关闭room**：延后；room completion、room count和handoff均未获授权。
- **本片顺带接Session/presentation**：延后；本片先建立可被Session消费的exact material step port。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；负空间、材料时间、做减法 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `stg-dev/docs/CONTENT_EXTENSION_ZH.md` | Danmaku / aaajiao + Codex | mandatory gate | V4外owner join与provenance | repository license | `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040` |
| `manifests/v4/package-manifest-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | package identity | repository source | `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | Misregistration residue lifetime与seed | repository source | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | slice segments与required rest | repository source | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | IN_BETWEEN budget与material ledger | repository source | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | collisionless residue、cleanup、pool policy | repository source | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `manifests/runtime/event-schema-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | cleanup与player timer canonical events | repository source | `31c69e627e35e0c8dea828e1564592d6fc71059fa9ce654f92c660114648f0bb` |
| `manifests/runtime/runtime-contract-v4.json` | V4 package / aaajiao | immutable source kit / 4.0.0 | same-tick order与material/gameplay separation | repository source | `29c97a1c3c20b15b90b9d6c70e3c9cb5f41b5ca9fe2a2831c9a961e768d12306` |
| `EXT-2026-023-second-in-between-material-tail-transfer.md` | Danmaku / aaajiao + Codex | accepted ADR / `902e57d` | global8519 exact owner source | repository license | `d01bbd0d5c9dc69d724b9323b4ecd77e81714d141862ac357a31b2a2882b911b` |

## 验证计划

- 延续EXT-023同一seed-1 / EASY真实producer，从original owner推进global `8520..8682`，证明63组cleanup、
  最终drain、RNG不变、room idle和80-slot lease保留；再推进一个empty hold tick证明不自动release或close。
- 同一focused case覆盖skip/repeat、Override edge、伪/旧owner与drain后exact-next；失败前后比较Run/event/material
  serialization。保留一个真实长prefix，不新增重复全套fixture。
- 运行该focused producer、strict typecheck与`git diff --check`。本片不改Session、bundle或player-visible路径，
  因此不运行build、smoke、E2E或全unit；这些留给Session接线里程碑。

## 回滚与迁移

实现前回滚只删除本proposal和索引/路线图引用，EXT-023 owner仍安全停在
`nextOccurrenceAdmission="withheld-pending-decision"`。实现后回滚时移除post-close material step，使owner重新
停在global `8519`；不得清屏、等待drain、自动退休capacity或伪造room completion。未来material-chain通用化使用
successor ADR并保留本首次exact source。

## 决策

PROPOSED。先让已经转交的材料在章节关闭后继续其自身时间，同时让现场缺席和allocation仍被分别记录；第三
occurrence、room completion、Session与handoff继续withheld。
