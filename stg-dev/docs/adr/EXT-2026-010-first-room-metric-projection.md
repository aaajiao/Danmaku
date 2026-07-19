# EXT-2026-010：首房 closure 的 typed metric projection

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 实施 commit：`01e5b6b`（已推送）
- 前置记录：[EXT-2026-009](EXT-2026-009-first-fixed-room-closure.md)
- 后续顺序更新：[EXT-2026-012](EXT-2026-012-first-continuation-room-target.md)接受partial available bias消费，
  不再要求14项全部available后才选择ordinal 1 target；本ADR的projection artifact与typed missing不变
- aaajiao skill：`1.1.1`；SHA-256 `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256 `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256 `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：bounded projection / source authenticity / typed missing；不修改 V4、room count、composer、selection、RNG、transition、narrative、asset、dependency 或 persistence

## 不可约事实（Metadata）

V4 room composers权威定义14个metric ID与权重，但没有定义live producer、window、denominator、
threshold、range或missing policy。Python `sim_core.py`接收caller fixture；其缺项补0与强度默认值只属于QA，
不能成为玩家行为。

EXT-2026-009已冻结exact `[1,H+1702]` first-room closure source。删除本扩展后，系统仍无法区分“由该
source可机械归约的值”和“机制未开放或原始事实不足”；任意完整numeric record都会把absence伪装成0。

无形容词机制句：Run以module-issued opaque receipt绑定真实H+1702 closure，只投影两个可验证ratio，
其余12项输出typed missing；partial snapshot不铸造composer-ready record或selection authority。

## 负空间（Behavior > Content）

首房结束时屏幕已经安静，但安静不表示Override、No-Dusk、intersection或response行为的数值为0。
projection保存“没有适格观察窗口”本身，不用默认数、标签、进度条或画像填满空白。

## 决定

### 1. source window与真实性

- source只能是EXT-2026-009在`H+1702`生成的first-room closure；H、H+1701、live rolling H+1703或
  caller-supplied facts均不接受。
- closure factory在module-private registry中登记exact capture，并为metric consumer签发opaque receipt。
  projector只接receipt，不接plain capture、metrics、window、threshold、weather、profile或RNG参数；
  JSON clone、结构相同的frozen object与caller伪造receipt均fail-stop。
- receipt绑定一个immutable closure，可在该in-memory source生命周期内重复读取；H+1703及更晚tick不让它
  失效或换源。receipt不可序列化、restore或重新绑定到另一session/source；JSON round-trip只得到无authority
  的plain data，原receipt始终只导出原seed/boundary的projection。
- 同一模块内的pure derivation core可读取exact-schema test fixture并返回unbranded payload，用于公式、missing
  与failure测试；只有receipt wrapper能把该payload封装成正式projection。fixture不能证明source真实性、
  tick lifecycle或closure atomicity，也不能进入production consumer。
- projection发生在room closure capture成功之后、公开Run snapshot之前；它不回写EXT-006 rolling facts、
  EXT-008 observation或EXT-009 closure bytes。

### 2. 14项逐项政策

所有数值均为未round、未clamp的finite ratio；source aggregate越界直接失败，不以clamp隐藏authority drift。
projection本身没有离散threshold，V4 consumer weight也不是threshold。

| metric | H+1702状态 | producer / numerator / denominator，或missing原因 |
|---|---|---|
| `avgFlower` | available | committed Flower `targetIntensitySum / sampleCount`；window为Flower在`[1,H+1702]`的closed samples；target是authority，renderer interpolation不是 |
| `gazeRatio` | available | committed Gaze `stateTickCounts[clamped] / sampleCount`；window从Gaze authority首个available tick到H+1702；acquiring与release-delay不进入分子，未开放的quiet prefix不进入分母 |
| `recentInputDensity` | missing | `recent-window-not-recorded`；缺trailing window长度、同tick多通道union与active tick aggregate |
| `unansweredActions` | missing | `action-response-contract-not-authored`；缺action opportunity、response identity、pairing与deadline |
| `sideCommitment` | missing | `side-band-samples-not-recorded`；缺left/right/neutral geometry、dwell counts与zero-denominator policy |
| `crackRatio` | missing | `crack-band-samples-not-recorded`；position sum/min/max不能反演crack dwell，旧`abs(x)<5`示例不是V4 contract |
| `sideSwitches` | missing | `side-transition-sequence-not-recorded`；aggregate sums不能反演ordered side edges |
| `contextSwitches` | missing | `context-transition-sequence-not-recorded`；room tick totals不定义context，也不保存transition count |
| `intersectionHold` | missing | `intersection-authority-not-observed`；pattern hook/archive dwell不等于composer metric |
| `correctionLatency` | missing | `correction-pairs-not-recorded`；缺stimulus、corrective response、pair occurrence与latency cap |
| `overrideRatio` | missing | `override-not-eligible-in-source-window`；idle run-state存在不表示玩家取得Override authority |
| `binarySwitches` | missing | `binary-authority-not-observed`；signal rising edge不等于two-sided binary transition |
| `highLightRatio` | missing | `high-light-threshold-samples-not-recorded`；intensity sum不能反演threshold dwell，threshold尚未author |
| `noDuskTicks` | missing | `no-dusk-authority-not-observed`；首房prefix尚未进入Dusk/No-Dusk authority，event absence不是0 |

`avgFlower`与`gazeRatio`的分子必须在`[0,denominator]`；denominator必须为positive safe integer，source
availability boundary、sample count与closure tick必须自洽。Gaze `stateTickCounts`之和必须等于sample
count，sample count必须等于`last-first+1`，last必须为H+1702；缺少`clamped` row表示已观察的0 ticks，
不是missing。不得用requested Gaze、`clampActiveTickCount`、non-idle FSM time、accepted full-prefix或QA
`0.28` fixture替换上述Gaze公式。

### 3. partial projection契约

- H+1702前公开exact missing sentinel：
  `{availability:"missing", reason:"first-room-metric-source-not-closed", ready:false,
  selectionAllowed:false}`。
- available root字段恰好为：`availability`、`authority`、`schemaVersion`、`producerId`、
  `producerVersion`、`extensionPolicy`、`sourceEpoch`、`capturedAtTick120`、`rawRunSeed`、
  `contentIdentity`、`sourceBoundary`、`projectionStatus`、`availableMetricCount`、
  `missingMetricCount`、`metricEntries`、`ready`、`selectionAllowed`、`selectionRngDraws`、
  `canonicalEventWrites`、`targetRoom`、`transitionAllowed`。artifact identity为
  `canonical-run-first-room-metric-projection-v1`；`sourceBoundary` exact字段为
  `preRoomTick120/firstOccurrenceObservationTick120/roomClosureTick120/roomId/roomOrdinal/patternId/
  occurrenceId/encounterOrdinal/resolvedSeed`，值与EXT-009 closure相同并再次冻结。
- `metricEntries`恰好14项，ID从V4 manifest-derived universe取得并按stable code-point排序。available entry
  exact字段为`id/availability/value/unit/formulaId/numerator/denominator/sampleWindow`：`unit`固定
  `ratio-0-1`；numerator/denominator均为`{sourcePath,value}`；sampleWindow为
  `{firstTick120,lastTick120}`。两个formula/source path固定为：
  - `committed-flower-target-mean-v1`：
    `behaviorFacts.committed.flower.aggregate.targetIntensitySum` /
    `behaviorFacts.committed.flower.sampleCount`；
  - `committed-gaze-clamped-state-ratio-v1`：
    `behaviorFacts.committed.gaze.aggregate.stateTickCounts[clamped].ticks120` /
    `behaviorFacts.committed.gaze.sampleCount`。
- missing entry exact字段仅为`id/availability/reason`；reason恰好使用上表12个versioned kebab-case ID，
  不附默认值、undefined、NaN、threshold或caller message。
- 当前exact cardinality为`availableMetricCount=2 / missingMetricCount=12`，整体
  `projectionStatus=partial`、`ready=false`、`selectionAllowed=false`、`selectionRngDraws=0`、
  `canonicalEventWrites=0`、`targetRoom=null`、`transitionAllowed=false`。partial artifact没有
  `metrics`、`V4RunComposerMetrics`、ready receipt、room candidates、difficulty、tier或RNG cursor。
- EXT-009 closure内既有`metricProjection=false`保持原字节与原责任，不被追写；新artifact只用
  `projectionStatus`，不引入另一个含义冲突的`metricProjection` boolean。
- H+1703及更晚rolling facts不得改写projection；同seed/input/content得到byte-identical result。

### 4. 后续责任

后续producer ADR按真实mechanism补missing raw facts，而不是一次新建12个猜测字段。只有14项全部
available且exact `[0,1]` validation通过后，successor才能铸造opaque composer-ready receipt；room count、
missing consumption、weighted selection、difficulty与transition仍分别后置。

## 被拒绝或延后的替代方案

- **照抄QA 14个fixture或missing→0**：拒绝；fixture只证明deterministic schedule。
- **从sum/min/max反演dwell/switch/latency**：拒绝；不同tick序列可有同一aggregate。
- **把Override idle当0 usage**：拒绝；玩家尚未取得输入权限。
- **现在扩展12组raw aggregates**：延后；其中多项对应mechanism尚未进入live Run，先保留absence更小。
- **直接调用QA composer**：拒绝；它标记`liveIntegration=false`，且difficulty salt、room count与missing
  consumption仍未author。

## 数字—物质双螺旋

- authoritative input/state：committed Flower target、committed Gaze `clamped` state与EXT-009 frozen closure；
  requested input、renderer state与presentation profile不能替换。
- material record：两个ratio只描述已发生的光强提交与Eye relation dwell；12个missing保留尚未出现的
  crack/intersection/Override/No-Dusk材料关系，不生成替身反馈。
- restore / witness：本切片不持久化、不生成观察句；future consumer必须校验schema/content/source receipt。

## 做减法结果

- 已复用：V4 14-ID/weight universe、EXT-006 bounded aggregates、EXT-009 exact closure与content identity。
- 删除：12个默认数、QA fixture、完整metrics record、composer、RNG、target、UI、telemetry与archive。
- 为什么仍需新增：V4没有live projection/missing contract；closure plain object也没有downstream authenticity。
- 新增预算：projection policy 1；available metric 2；typed missing 12；canonical event 0；RNG draw 0；
  asset 0 bytes；dependency 0；persistence field 0。

## 治理与非单一化

- aaajiao审核两个公式与12个absence；Codex实现receipt、validation与bounded projection。
- metric不是分数、能力、阵营、好坏、路线优劣或玩家画像；partial snapshot不能排序玩家。
- Gaze denominator只含authority available samples，避免把尚未开放的阶段解释为回避；accessibility profile
  只能改变表现，不得改变committed Gaze trace。

## 行为契约与失败方式

- time：只在accepted H+1702 closure之后生成一次；pause/wall time不采样。
- seed/RNG/event：保留raw Run seed；不draw RNG、不写canonical event。
- failure：fake receipt、wrong content/seed/boundary、non-frozen source、metric ID drift、zero denominator、
  numerator越界、extra field、NaN/Infinity/-0均fail-stop，不公开半份projection。
- offline/profile：无network/service；full/reduced-motion/flash-off同gameplay source与projection bytes。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；absence、双螺旋、非单一化门 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | behavior-ledger selection intent；无projection | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | 14 metric ID与weights | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `gameplay/schemas/composers-v4.schema.json` | V4 package / aaajiao | JSON Schema / 2020-12 | 不定义metric key/range/source | repository license | `815b781de0b7dcc16dd381353e0a26e21e4560c66e921a4de4ade2be49c1edad` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / 4.0.0 | caller fixture、missing fallback；非live producer | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `docs/WORLD_REFERENCE_ORIGINAL_ZH.md` | V4 package / aaajiao | historical design reference | run-end avg/gaze/crack/override示例；非canonical H+1702 policy | repository license | `1c486c831fc95e0d4c8edff5ee5e2f5423c1b627370901f4e4a52520f00dc6b6` |
| `src/authority/run-behavior-facts.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | bounded raw facts baseline | repository license | `079ba851f7b353adea2421d9fc6ab28fb6fe76f86918903148d4e6f628f37f90` |
| `src/authority/run-behavior-capture.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | exact closure登记与opaque metric-source receipt | repository license | `6810f9b96a9f0b3c0e16cd58bff5c788186ac8bfd1bd2c234047dee1365ecbcd` |
| `src/authority/run-metric-projection.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | receipt-only formal factory、2项ratio、12项typed missing | repository license | `a2080c019c56a95936257e2d2a8e3f4858c50c652ded43e29f713938cb70ecc1` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | H+1702 closure与projection原子公开 | repository license | `f0d849921d785bb7823033625a0cea04277b6479abab3387d45e64c6d85815d2` |
| `src/authority/run-composer.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | QA-only exact metric universe；保持隔离 | repository license | `930295610620fb5e392e251fde91f50f419b6fab6c099b074ff5c29ea1dc3335` |
| `src/authority/test-fixtures/first-room-closure-capture-v1.json` | Danmaku / Codex | canonical Run producer capture | pretty test-only source；canonical JSON 5686 bytes / SHA-256 `d15ddcef736728ab86eedcf2e061771c6e615b0db4731f45c5fb2165ef388389` | repository license | `72d6aa379fcda2059a68ba93a1e43f32579a0d495fbd09c30f993842eb379ae6` |

## 验证证据

- pure derivation：15 tests通过，断言7ms；覆盖14项stable order、两个公式、12个exact missing、deep freeze、
  byte determinism、wrong boundary/content、zero denominator与fake receipt。
- real Run integration：H+1701 missing，H+1702 closure与projection同一snapshot原子available，H+1703两者
  bytes不变；`avgFlower=1190.5999999999124/4024`，`gazeRatio=1/3064`。test-only closure fixture的
  canonical JSON为5686 bytes，SHA-256
  `d15ddcef736728ab86eedcf2e061771c6e615b0db4731f45c5fb2165ef388389`，与真实producer byte-identical。
- focused projection/capture/Run regression：4 files / 42 tests通过，wall 21.32秒；真实integration约2.79秒。
  fake/plain receipt拒绝，selection/RNG/target/transition/event-write firewall保持关闭。
- strict typecheck、`bun run content:check`、`bun run build`与`git diff --check`通过；778个V4 checksum row
  未变化。实现diff只读审查无阻断。无UI、selection、transition或handoff可见变化，未跑browser/E2E。

## 回滚与迁移

删除本扩展移除in-memory partial projection与source receipt；EXT-006 facts、EXT-008 observation、EXT-009
closure及canonical trace保持不变。无archive migration。

任何raw-facts扩展、composer-ready receipt、missing consumption、room count、selection、difficulty、transition
或persistence必须新增successor ADR。

## 决策

ACCEPTED。H+1702只投影`avgFlower`与committed `clamped` state `gazeRatio`；其余12项保留typed missing，所有
composer/selection权限继续withheld。
