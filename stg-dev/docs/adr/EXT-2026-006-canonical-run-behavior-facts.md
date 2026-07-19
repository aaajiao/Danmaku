# EXT-2026-006：Canonical Run rolling 原始行为事实账本

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 设计提交：`77664cf9f5a1fce8079d0fc33c8b5b81d3e7a889`
- event read port 提交：`20eee2c40e50737374f53383babbc5c8d29ff0f0`
- 实现提交：`7760a810b405cabc8290dea6b4411ddbd0b7fb23`
- 有界分组修正提交：`8e817c7823a290fd71561bb2a510372d842ae009`
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
  ticks、Gaze sample 的 visible ticks、pitch min/max 与 alignment sum、Override press/release/direction
  request counts；
- `committed.player`：input-enabled/focused ticks，以及 post-authority `x/y` sums、minima、maxima；
- `committed.flower`：resolution value sum、按 canonical source 分组的 ticks 与 available sample count；
- `committed.gaze`：按 V4 state 分组的 ticks 与 clamp-active ticks；committed transition event 只进入下述
  全局 canonical event counts；
- `committed.override`：只在 authority available 时按 committed state 分组的 ticks，并保留 cycle/scar
  maxima；canonical Override event 只进入全局 event counts，请求但未获 authority 的 edge 只留在
  `requested`；
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
ROOM_SAMPLING 尚未解锁 Local Resistance 时的 Override press request 不得产生 committed Override event 或
state transition；若当前 owner 已实际消费 Override authority，idle snapshot 仍按 committed fact 累计。不以
请求推断伤害、graze、Gaze clamp、room presence 或任何 authority result。

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
  persistence field `0`；每 accepted tick `1` 次 O(`U + Δevents`) draft-and-replace update，其中 `U` 是已见
  canonical ID universe，内存不随 tick 数增长。

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
| `src/authority/events.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | O(1) committed cursor 与 O(delta) readonly suffix port | repository license | `014cfc458c56141e97487e53b7b0874beb36dfdf1dd010df37cfa64a3df32c22` |
| `src/authority/events.test.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / Vitest | cursor/suffix defensive boundary 与 shadow protection | repository license | `d149b67cfa123a0b5ffee861417449fd2ecb989510b5259f956790d1cddd81f9` |
| `src/authority/run-behavior-facts.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | run-owned accepted-tick raw-facts producer `1.0.0` | repository license | `7a7deccdfd155bbb61557576ddad653aca4d9629071e0812bb69affecd061955` |
| `src/authority/run-behavior-facts.test.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / Vitest | owner、missing、atomicity、event multiset、bounded cardinality | repository license | `c37233fe18411377b0f1daee6f0440d6fd0ee7a393e1262c6a617e162354677c` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | accepted-tick owner/request/commit capture seam | repository license | `f3f57f0f573e74cda1dc7827112716b66cfd2e9312dc27650c03480cdbfe4bcb` |
| `src/authority/run-session.test.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / Vitest | composite fail-stop observation port evidence | repository license | `7b03390e9e224f9e90a9eab2080cade307411645bf2cb489766dbbe88c61b1f9` |
| `src/authority/run-room-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | EXT-005 fixed room boundary；保持不变 | repository license | `c36d27002aa9203c5a8b9f897f76222940905fc272d9a0b998167cf352b31e5e` |
| `src/authority/run-composer.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | QA-only metric fixture/composer；不接入 | repository license | `930295610620fb5e392e251fde91f50f419b6fab6c099b074ff5c29ea1dc3335` |

V4 source tree 保持只读。event read port hashes 对应提交 `20eee2c`，Run integration hash 对应实现提交
`7760a81`，最终行为事实 producer/test hashes 包含有界分组修正提交 `8e817c7`。

## 验证证据

- focused Vitest 4 文件共 49 条通过：event cursor 17、行为事实 7、Run Session 17、presentation 8；总耗时
  约 3 秒，不以全量测试阻塞本 authority-only 切片；
- tick 0 baseline 明确排除；短 trace 精确校验 requested/committed Focus 与 Override、Flower source/value、
  player position、Gaze/Override state、phase/room/occurrence 和 frozen/missing unions；
- 账本 late event-cursor failure 在最后一项校验失败后 serialization 不变，随后合法 tick 仍可接受；Run
  rejected input 不变更账本，cross-authority failure 后 snapshot/event/behavior ports 一并 fail-stop；
- First Eye transition 使用 pre-step owner；`H` 明确归 `first_clamp_recovery`，room owner/context 均为 0/
  missing；`H+1` 才累计首个 `FORCED_ALIGNMENT` tick，READ `H+159` 才出现真实 room occurrence；
- canonical event observed count、last sequence 与按 code-point 排序的 ID multiset 等于 bus tick-0 suffix；
  ledger 每 tick 只读取 delta，32-tick spy 证明未调用 retained full-history port；
- 同 seed/input 的两份 session 得到相同 serialization；相同 ID universe 下 tick 180 与 tick 900 的所有
  公开数组 cardinality 相同；两个合法 `Number.MAX_VALUE` gaze pitch 只更新 min/max，不使 Run fault；
- `bun run typecheck` 通过；`bun run build` 内含 `content:check`、strict TypeScript 与 production PWA build，
  V4 778 个 checksum row 和 content digest 保持通过；`git diff --check` 通过；
- profile/weather/pause/wall-clock 不进入 `CanonicalRunSessionStepInput` 或 ledger producer；现有 presentation
  只读测试保持通过。本切片无用户可见路径变化，因此未运行 Playwright；按风险分层策略未运行
  `test:all`。

## 回滚与迁移

删除本扩展只移除内存 observation port；gameplay、canonical event trace、EXT-005 fixed room 与现有
snapshot 保持不变。没有 archive migration，也没有逐 tick history/H capture 需要保留。若 schema/producer
version 或 V4 content digest 不匹配，consumer 必须诊断并拒绝，不得补零。

未来把 rolling facts 归约为 composer metrics、在某 boundary capture、选择下一房、持久化或投影观察句时，
必须新增 successor ADR；该 ADR 要明确窗口、分母、threshold、missing policy、capture/retention、consumer
与 EXT-005 supersession 范围。

## 决策

ACCEPTED。Canonical Run 现在以 producer `canonical-run-session.accepted-tick-observer@1.0.0` 累计不可约的
accepted-tick authority facts，并显式拒绝 metric/composer 权限。当前仍未决定 14 项 live metric projection、
capture boundary、room count、weighted selection、difficulty mapping、parallel/weather、room completion 或
下一房 handoff；本记录不授权其中任何一项。
