# EXT-2026-006：Canonical Run rolling 原始行为事实账本

- 状态：PROPOSED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置记录：[EXT-2026-005](EXT-2026-005-first-forced-room-bootstrap.md)
- aaajiao skill：`1.1.1`；SHA-256 `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256 `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256 `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：authority observation；不修改 V4、gameplay、canonical event、selection、composer、projection、asset、dependency 或 persistence schema

## 不可约事实（Metadata）

V4 要求 mental-room selection 由 behavior ledger 加权，但没有定义 live producer、采样边界或从原始
authority state 到 metric 的归约方法。现有 `V4RunComposer` 只接受 caller-supplied 的 14 项 QA
metric fixture；把 fixture、默认零值或当前画面反推成 live 行为，会把尚未发生与数值零混为一谈。

删除本扩展后无法保留的事实是：默认 `CanonicalRunSession` 成功关闭的 gameplay ticks 中，哪个 owner
消费了多少 tick、调用方请求了什么、authority 实际提交了什么，以及哪些 domain 当时尚不可用。没有这层
机械原始聚合，后续 metric producer 无法证明分母、缺失值、handoff 归属或来源事件。

无形容词机制句：`CanonicalRunSession.step` 成功关闭 tick `T` 后，将 step 前 owner、validated request、
step 后 committed snapshot 与本 tick canonical event delta 折叠进一份 frozen rolling raw-facts snapshot；
拒绝或失败的 step 不更新账本。

## 负空间（Behavior > Content）

当前界面能显示 phase、Flower、Gaze、pattern 与 room，却遮住了两个差异：玩家请求的动作可能没有获得
gameplay authority；返回 snapshot 中新安装的 owner 也未必消费了当前 tick。本扩展不增加图标、行为标签、
玩家画像或评价文案，只让“请求—提交—缺失—owner 边界”的累计事实可检查、可重放。

## 决定

### 1. 每个成功 accepted tick 原子滚动一次

- 账本位于 `CanonicalRunSession` 内，是 renderer-independent 的只读 observation port。它不成为 clock、
  event bus、combat、Gaze、Flower、room 或 player 的新 authority。
- constructor 在 `tick120=0` 建立的 Flower baseline、初始 snapshot 与初始 event cursor 不算玩家采样；
  tick 0 及其 event 明确排除。
- 每次 `step` 先完成 hostile-input validation，再锁存当前 `phase` 为该 tick 的 `ownerPhase`。只有底层
  authority 全部成功、该 tick 已关闭、post-authority snapshot 与 event delta 可取得时，才原子更新 rolling
  aggregates。
- rejected caller input、内部 fail-stop、重复/跳跃 tick 或 accessor/prototype 等 hostile value 不改变
  sample count、aggregate、event cursor 或公开 snapshot。
- 一条 accepted gameplay tick 恰好更新一次。pause 不推进 gameplay tick，因此不采样；wall-clock
  callback、RAF、输入事件和渲染帧均不采样。wall gap 后若 clock 正常补齐多个 accepted gameplay tick，
  每个补齐 tick 各更新一次，不为 wall gap 另造 sample 或 elapsed-time 权重。

### 2. 有界 rolling aggregates，不保存逐 tick history

snapshot 累计机械事实，不提前计算行为指标：

- `sampling`：首末 accepted tick、accepted tick count、按 pre-step owner phase 分组的 tick counts；
- `requested`：non-zero movement ticks、movement vector/magnitude sums、signal-active ticks、focus-requested
  ticks、Gaze sample 的 visible ticks 与数值 sums、Override press/release/direction request counts；
- `committed.player`：input-enabled/focused ticks，以及 post-authority `x/y` sums、minima、maxima；
- `committed.flower`：resolution value sum、按 canonical source 分组的 ticks 与 available sample count；
- `committed.gaze`：按 V4 state 分组的 ticks、clamp-active ticks 与 committed transition event counts；
- `committed.override`：只在 authority available 时按 committed state 分组的 ticks 及 canonical Override
  event counts；请求但未获 authority 的 edge 只留在 `requested`；
- `context`：按 owner phase、available room ID 与 active occurrence ID 分组的 tick counts；
- `events`：自上一个 accepted tick 后新增 canonical event IDs 的累计 counts，并保留总 committed event
  count。它读取现有 bus 的 post-authority delta，不新增、过滤、重排或重发 event。

所有 ID-keyed groups 在 snapshot 中按稳定 code-point 顺序输出。position extrema/sums 仍是原始坐标聚合，
不是 `routeWidth`；state/source tick counts 仍是原始分子/分母，不是 ratio、dwell、density、commitment、
switch、latency、band 或玩家分类。

内存随已观察到的 canonical phase/room/occurrence/event/source/state ID universe 增长，而不随 accepted tick
数量增长。不得在本扩展下加入完整逐 tick 数组、route points、event envelopes、H capture、分段 history、
archive 或 telemetry；这些需要独立 retention/provenance 决定。

### 3. owner 归属先于返回 phase，H 不冻结

- `ownerPhase` 必须在调用 phase-specific step 前锁存，不能从返回 snapshot 的 `phase` 反推。
- quiet awakening 切到 First Eye 的边界 tick 仍归 `quiet_awakening`；First Eye 的输入权限从下一 tick 生效。
- EXT-005 typed handoff tick `H` 由旧 owner 完整关闭。即使 `H` 的返回 snapshot 已包含新安装的
  `roomSampling`，账本仍把 `H` 计入旧 owner，并且不增加 room/room-occurrence context。
- `H+1` 是首个由 `room_sampling` 消费的 tick，也是 `FORCED_ALIGNMENT` room context 的首个 available
  sample。`H` 不计 room dwell、不构成 room enter，也不把 constructor 安装误写为玩家在房间中的行为。
- `H` 不生成 frozen metric snapshot、composer capture 或 rolling-ledger fork。账本在 `H` 后继续滚动；
  未来在哪个 boundary capture 哪些事实必须由 metric/composer successor ADR 决定。
- 本提案不改变 EXT-005：首房仍是 fixed non-composer `FORCED_ALIGNMENT / listen / EASY /
  room.forced.left_right_gate`，selection RNG draw 仍为 0。账本不选择房间，也不 supersede bootstrap。

### 4. requested 与 committed authority 分栏

每次滚动更新使用两个互不回写的域：

1. `requested` 只读取通过 `CanonicalRunSessionStepInput` validation 后的 movement、signal、focus、Gaze
   sample 与 Override edge/direction；它表达 caller 请求，不声称请求已获 gameplay authority。
2. `committed` 只读取同一 tick 关闭后的 canonical snapshots 与 canonical event delta；它表达 player、
   Flower、Gaze、combat/run-state/room owner 实际提交的事实。

例如 `focused=true` 在 player input 不可用时仍增加 requested focus tick，但不增加 committed focused tick；
ROOM_SAMPLING 尚未解锁 Local Resistance 时的 Override press request 不得增加 committed Override event/state。
不以请求推断伤害、graze、Gaze clamp、room presence 或任何 authority result。

### 5. availability 是事实，不以零或 retained snapshot 代替

- 每个可能尚未建立或不属于当前 live slice 的 committed domain 使用显式判别联合：
  `availability: "available"` 时携带 frozen aggregate、first/last available tick 与 available sample count；
  `availability: "missing"` 时携带稳定 reason，且不得同时携带 aggregate。
- 最低 missing reason 语义为：authority 尚未建立、当前 live slice 尚未 author，或没有任何由适格 owner
  消费的 sample。不得把 missing 静默转换为 `0`、`false`、空 group 或 retained value。
- `CanonicalRunSessionSnapshot.combat` 在 handoff 后可能保留 source/room 的最后快照供观察；只有当前
  owner 实际消费该 combat/occurrence context 的 tick 才增加对应 aggregate。retained snapshot 不能冒充
  当期行为。
- common/player domain 在首个 accepted tick 后 available；Gaze 与 Override 只在其 current owner 首次实际
  消费后 available；room domain 在 `H+1` 后才 available。已建立但因 Local Resistance 尚未解锁而保持
  idle 的 Override state 可以按 committed fact 累计，未 author 的 activation/parallel/weather domain 保持
  missing，不创建全零账本。
- 每次公开的 ledger snapshot 与所有嵌套 aggregate 都 deep-freeze；调用方不能取得 mutable authority state、
  event bus、内部 Map/Set 或可修改数组引用。
- snapshot 至少公开 schema/producer version、sampling boundary、rolling aggregates 与各 domain 的
  availability/missing。调用方取得的是当前累计只读值，不是可回写的 producer state。

### 6. 明确不做 metric、composer 或 presentation

- 本扩展不计算或填充 `avgFlower`、`gazeRatio` 等 14 项 room-composer metrics，也不生成 run-memory
  `metrics` 对象中的 ratios/semantic counts、dominant room、weather exposure 或 observation sentence。
- 不决定 metric 的窗口、分母选择、normalization、threshold、missing coercion 或 boundary capture。
- 不调用 `V4RunComposer`、`admitLiveRun` 或 RNG；不改变 room count、tier、difficulty salt、pattern order、
  safe gap、Boss、weather、damage、collision、spawn、evidence、Override 或 handoff。
- 不新增 canonical event ID，不向现有 event bus enqueue，不修改 canonical serialization/hash；不把账本
  投影到 HUD、音频、视觉、haptic、narrative 或 network telemetry。
- 数据只存在当前内存 session。archive、cross-run memory、上传、完整 raw history 与 capture policy 均不在
  本提案内；若需要必须另建 ADR。

## 数字—物质双螺旋

- authoritative input/event/state：validated request、step 前 owner、step 后 player/Flower/Gaze/combat/run-room
  snapshots 与 canonical event delta；没有新增 event 或 gameplay write。
- material record / 坐标 / 生命周期：rolling sums/extrema/counts来自同一 accepted tick 后真实身体坐标、
  Flower/Gaze state 与当前 owner 的实体事实；没有 authority 的域保持 missing，不用代表性图标填满空白。
- restore / witness 关系：本切片没有 persistence、restore 或 witness 写入。未来归约或存档只能读取 frozen
  aggregates，并须绑定 producer/schema version、capture policy 与 V4 content digest。

## 做减法结果

- 已复用 V4：`tick120`、run phases、Flower/Gaze FSM、canonical event bus、combat/run-room snapshots、run
  director 的 behavior-ledger intent，以及 snapshot observation 的 missing-value fail policy。
- 被删除的层/字段/资产：14 项 QA metric fixture、run-memory metric default、逐 tick history、H capture、
  composer 调用、selection RNG、event、UI、copy、asset、network telemetry、archive 与第二套 clock。
- 为什么仍需新增：现有 snapshots 只表达“现在”，没有累计 accepted tick 的 owner/request/commit 与 source
  event counts；V4 没有声明 live producer 或 handoff 采样归属。
- 新增预算：canonical event `0`；gameplay rule `0`；RNG draw `0`；asset `0 bytes`；dependency `0`；
  persistence field `0`；每 accepted tick `1` 次 O(1) rolling update，内存受 canonical ID universe 限制。

## 治理与非单一化

- aaajiao 决定未来哪些原始 facts 允许归约以及在哪个 boundary capture；Codex 实现、验证 schema、
  ownership 与 missing policy。任何 metric producer、composer consumer、上传或保存都必须单独评审。
- 账本不把请求解释为意图、能力、人格、正确路线或成功。不同设备适配后的同一 validated facts 使用同一
  schema；设备原始标识、地域、账号、硬件指纹与 wall-clock 时间不进入记录。
- 固定首房不被解释为行为匹配。没有 score、rank、victory、defeat、good/bad ending 或唯一最优输入。
- rolling aggregation 刻意不保存可逐帧回放的输入史，减少隐私与内存表面；未来若需要 route/history，
  不能在本提案中静默扩张。

## 行为契约与失败方式

- seed / RNG domain：记录沿用 raw Run 与 occurrence identities；账本自身不消费 seed 或 RNG。
- canonical tick：仅 non-negative sequential integer `tick120`；tick 0 排除；同一 accepted tick 只滚动一次。
- same-timestamp phase：原 authority 保持 `collision-off -> state/damage -> collision-on -> entity-spawn ->
  feedback`；账本只在整个 tick 关闭后观察，不能插入或重排 proposal/flush。
- event delta：constructor 后建立 cursor；每次成功 tick 只计新增 canonical events。失败不推进 cursor；
  event total/counts 必须等于 bus 前缀差分，不读取 presentation feedback。
- snapshot：owner 在 step 前锁存，request 在 validation 后捕获，committed facts/event delta 在 step 成功后
  捕获；一个 draft aggregate 完整验证后再原子替换。availability/missing 与 producer/schema version 一起
  deep-freeze。
- failure：owner、tick、event cursor、post snapshot、availability、finite sum 或 atomicity 不一致即使 session
  fail-stop；不得丢计数、补零、读取 renderer 或回退到 QA fixture。
- offline degradation：无服务、permission 或网络；content digest mismatch 继续由现有 content authority
  fail closed。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；metadata、做减法、行为与双螺旋门 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | phase、behavior-ledger selection intent、determinism | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | 14 项 composer metric ID 仅作排除边界 | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/runtime/state-machines-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | committed Gaze/Flower/player state source | repository license | `eb1c62d53b71c0c2bbf0fc91098791b59054be4f5472efbbf112dcd12f0794fd` |
| `manifests/narrative/run-memory-v4.schema.json` | V4 package / aaajiao | JSON Schema / V4 4.0.0 | archive metric universe 仅作排除边界 | repository license | `ef18ce6ca407df5552566239f05946a173d6d034c260cc43c2a69bccabe8bb12` |
| `narrative/snapshot-observations-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | missing 不得静默归零 | repository license | `224cc22ca3dbc9cb4f20dc7e4679aa732d00b8438151277792e029002b20210b` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | 当前 accepted-tick、owner switch 与 snapshot seam | repository license | `0dcaa565e265dfff97be26b3a9a5ed2c5855f68ddc086a501d0dc120ffa6efc8` |
| `src/authority/run-room-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | EXT-005 fixed room boundary；保持不变 | repository license | `c36d27002aa9203c5a8b9f897f76222940905fc272d9a0b998167cf352b31e5e` |
| `src/authority/run-composer.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | QA-only metric fixture/composer；不接入 | repository license | `930295610620fb5e392e251fde91f50f419b6fab6c099b074ff5c29ea1dc3335` |

V4 source tree 保持只读。application hashes 是本提案起草时的输入基线，不是实现证据；实现后由接受记录
补充新文件/新 hash 与提交 provenance。

## 验证证据（待实现）

PROPOSED 阶段不声称任何未运行测试通过。接受前至少需要以下证据：

- tick 0 的 accepted count、owner counts 与 event count 均为 0；连续 accepted ticks 一 tick 一次 rolling
  update；rejected/failed/duplicate/gap input 不改变 aggregate/cursor且保持 mutation atomicity；
- snapshot、ID groups 与所有嵌套 aggregates 均 frozen；不保存逐 tick records，长 tick 序列的内存不随
  tick count 线性增长；
- phase transition tick 使用 pre-step owner；First Eye handoff `H` 归旧 owner、不增加 room context且不产生
  capture，`H+1` 才增加 `FORCED_ALIGNMENT` room tick；pre-read 不伪造 active occurrence，直到 READ
  `H+159` 才开始累计真实 room occurrence tick；
- requested Focus/Override 与 committed Focus/Override 可明确分离；missing 不被转成零、false、空 group
  或 retained combat；
- Flower sums/source ticks、Gaze/Override state ticks、position sums/extrema、phase/room/occurrence ticks 与
  canonical event counts 对人工短 trace 精确；event counts 等于 bus serialization 的 ID multiset；
- pause 与 wall callback 不增加 sample；同 seed/input accepted-tick trace 得到同一 rolling snapshot；
- Full、Reduced Motion、Flash-Off 产生相同 rolling facts；canonical event serialization、gameplay snapshot、
  collision/lifecycle trace 在加入 observer 前后完全相同；
- focused authority tests、strict typecheck、`git diff --check` 通过；本切片不改变 bundled/user-visible path，
  不要求 Playwright 或全量 `test:all`，除非实现扩大范围。

## 回滚与迁移

删除本扩展只移除内存 observation port；gameplay、canonical event trace、EXT-005 fixed room 与现有
snapshot 保持不变。没有 archive migration，也没有逐 tick history/H capture 需要保留。若 schema/producer
version 或 V4 content digest 不匹配，consumer 必须诊断并拒绝，不得补零。

未来把 rolling facts 归约为 composer metrics、在某 boundary capture、选择下一房、持久化或投影观察句时，
必须新增 successor ADR；该 ADR 要明确窗口、分母、threshold、missing policy、capture/retention、consumer
与 EXT-005 supersession 范围。

## 决策

PROPOSED。先累计不可约的 accepted-tick authority facts，再讨论 metric 与 capture。当前仍未决定 14 项
live metric producer、room count、weighted selection、difficulty mapping、parallel/weather、room completion
或下一房 handoff；本记录不授权其中任何一项。
