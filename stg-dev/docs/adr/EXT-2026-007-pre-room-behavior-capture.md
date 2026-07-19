# EXT-2026-007：Canonical Run pre-room 行为事实冻结

- 状态：PROPOSED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置记录：[EXT-2026-006](EXT-2026-006-canonical-run-behavior-facts.md)
- aaajiao skill：`1.1.1`；SHA-256 `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256 `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256 `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：authority observation / narrative boundary / build validation；不修改 V4、gameplay、canonical event、metric、composer、selection、RNG、asset、dependency 或 persistence schema

## 不可约事实（Metadata）

EXT-2026-006 的 raw-facts ledger 在整个 Run 中持续滚动。进入 `ROOM_SAMPLING` 后，它会开始混入 fixed
Forced Alignment 的 room/occurrence facts；若没有在边界保存 aggregate snapshot，未来不能从一个更晚的
累计值恢复 H 当时的 owner/availability boundaries、extrema 与 grouped counts。

删除本扩展后无法保留的事实是：typed handoff tick `H` 由旧 owner 完整关闭并写入 ledger 后，EXT-006
对 current-run accepted ticks `[1,H]` 形成的 exact frozen aggregate snapshot。它不包含 EXT-006 从未记录的
逐 tick、distribution、latency 或 trailing-window facts，也不声称是未来 composer 的完备或唯一来源。

无形容词机制句：`CanonicalRunSession` 在 `H` 的 EXT-006 rolling update 成功后，将该 frozen raw-facts
snapshot 连同 producer/schema、raw seed、capture policy、event cursor 与 build-verified V4 content digest
pin 原子锁存一次；之后 rolling ledger 继续推进，capture 不再改变。

## 负空间（Behavior > Content）

返回 snapshot 在 `H` 已显示 `room_sampling` 和 fixed room plan，但这些新安装内容没有消费 `H`。若直接
capture 整个 session snapshot，未来 selector 会看到一个先验安装的房间，并可能反向把它解释为玩家行为。
本扩展不增加 UI、图标、标签、画像或观察句，只保留旧 owner 已经关闭的机械 aggregate，并让 room plan
保持在 capture 之外。

## 决定

### 1. 只在 H 之后冻结一次 `[1,H]`

- `H` 仍由 `first_clamp_recovery` owner 关闭。执行顺序固定为：phase-specific authority 完成并关闭 tick →
  EXT-006 记录 `H` → validate capture boundary → 安装 frozen capture → 返回公开 snapshot。
- capture window 两端包含，`firstAcceptedTick120=1`、`lastAcceptedTick120=H`、
  `acceptedTickCount=H`；constructor tick 0 与其 Flower baseline event 明确排除。
- capture 内 `context.room` 必须仍为 missing，`room_sampling` owner tick count 必须为 0；Gaze、Override 与
  run-combat 保留 EXT-006 已有 availability window，不补齐其建立前的 tick。
- `H+1` 是首个 room-owned tick，已经混入 `FORCED_ALIGNMENT` context，因此不能替代 H。`H+159` 只是首个
  room occurrence READ local tick 0；`H+1701` 只是 `first_room_slice_complete`，明确不是 room complete，
  也都不能替代 H。
- capture 恰好一次。之后的 current rolling facts 继续增长；H+1、READ、slice complete 或未来 room facts
  不得改写、fork 或重新归一化这份 capture。

### 2. capture 只含 raw facts，不含 session/room plan

公开 discriminated union：

- `availability:"missing"`：handoff 尚未关闭，reason 固定为
  `pre-room-boundary-not-closed`，并明确 `metricProjection=false / selectionAllowed=false`；
- `availability:"available"`：携带 capture authority/schema/producer/policy version、
  `sourceEpoch:"current-run-pre-room-prefix"`、`capturedAtTick120=H`、raw Run seed、V4 schema/content digest，
  以及一份 recursively frozen `CanonicalRunBehaviorFactsSnapshot`。

capture 不包含 `CanonicalRunSessionSnapshot`、`roomSampling`、fixed room ID、pattern/plan、difficulty、tier、
room count、candidate set 或 renderer state。source facts 自身已有 owner/request/committed/missing、event prefix
与 composer-withheld 状态；不复制第二套字段或 ID 清单。

V4 content digest 在 browser-safe capture policy 中作为静态 provenance pin，由 focused test 与
`content:check` 对实际 `ContentAuthoritySnapshot` 校验。`CanonicalRunSession` 不在浏览器同步加载 Node-only
Content Authority，也不声称运行时能重新计算 digest；build gate 在漂移时 fail closed。未来 persistence 或
external consumer 必须在自己的输入边界比较 digest，不得把新 content 与旧 capture 混用。

实现必须把 pin 放在 capture 与 content validator 共用的 browser-safe identity module；`content:check` 必须
导入同一个常量并与实际 snapshot exact-compare。只在 unit test 复制期望 hash 不满足本 gate。

### 3. 不产 metric，不选择房间

- 14 项 composer metric 继续全部 unresolved。`metricProjection=false`、`selectionAllowed=false`，不生成
  `metrics` record，不调用 `validateV4RunComposerMetrics`、`composeV4RunComposerPlan`、`admitLiveRun` 或 RNG。
- V4 只定义 metric ID/权重，没有 live source、window、denominator、threshold、range、missing 或
  cold-start policy。Python `compose_run` 的 caller fixture、缺 key 默认 0、room count 默认 3 与 tier formula
  只属于 QA oracle，不进入本 capture。
- `avgFlower` 虽可在后续决定为 committed target sum/sample，但本扩展不决定 target/actual、全窗/分段或
  empty policy。`gazeRatio` 与 `overrideRatio` 仍有多种合法 numerator/denominator；其余 11 项还缺不可逆
  raw facts。本扩展不先计算一个稀疏 metric record。
- 旧 `WORLD_REFERENCE_ORIGINAL_ZH.md` 的 2 秒 wall-time/camera sampling 与 run-end normalization 只作概念
  provenance；它会读取未来事实且使用旧坐标/评价标签，不能成为 live authority。legacy
  `src/game/run-director.ts` 的默认 ledger、room count 与 schedule 同样不接入。

### 4. future selection 仍须另行决定

本 capture 只保留 `current-run-pre-room-prefix` aggregate 候选，不决定未来 composer 最终读取当前前缀、上一 Run
material memory、fixed bootstrap 后的 completed-room window，还是逐房重采样。后续 selection ADR 必须明确：

1. 首局 cold-start 与后续 Run 的 source epoch；
2. 14 项逐项 source/numerator/denominator/window/threshold/range/missing；
3. fixed first room 是否保留、计入总 room count、从 remaining candidates 排除，或由 H 后首个 weighted draw
   supersede；
4. 一次性完整 schedule 或逐房 dynamic selection、单一 RNG stream 与 draw order；
5. room count、difficulty/tier、difficulty salt、room completion 与 handoff。

任何路径都必须先关闭 source window，再冻结 facts/metrics，再锁定 candidates 并消费 RNG，最后才安装新
owner。禁止读取 `H+1` 后的 Forced facts再声称首房由这些 facts 选出。

## 数字—物质双螺旋

- authoritative input/event/state：accepted tick `[1,H]` 的 pre-step owner、validated request、post-authority
  committed snapshot 与 canonical event prefix；capture 自身不写 gameplay。
- material record / 坐标 / 生命周期：捕获的是玩家身体、Flower/Gaze、run-combat 与事件已经留下的累计事实；
  fixed room 的 telegraph、pattern、projectile、collider 和 residue 尚未被 room owner消费，因此不进入。
- restore / witness 关系：本切片不持久化、不恢复、不上传。capture 只是内存 observation；未来 archive 或
  cross-run consumer 必须新增版本迁移与 content-digest 规则。

## 做减法结果

- 已复用 V4/现有 authority：`tick120`、typed `ROOM_SAMPLING` handoff、EXT-006 frozen raw facts、raw seed、
  canonical event cursor 与 content authority digest。
- 被删除的层/字段/资产：14 metrics、sparse/default-zero record、QA composer、room count、RNG draw、fixed
  plan copy、whole-session capture、UI/copy、telemetry、archive、history、H+1/H+1701 substitute。
- 为什么仍需新增：rolling aggregate 一旦进入 room owner 就不能无损反演 H prefix；V4 没有给 capture
  boundary，EXT-006 也明确不在 H 自动 fork。
- 新增预算：canonical event `0`；gameplay rule `0`；metric `0`；RNG draw `0`；asset `0 bytes`；dependency
  `0`；persistence field `0`；每 Run 最多 `1` 份 bounded aggregate capture。

## 治理与非单一化

- aaajiao 决定未来 capture 是否被 selection 消费以及 metric 语义；Codex 实现 source isolation、版本、
  atomicity 与验证。删除/迁移权仍由 successor ADR 管理。
- capture 不把输入解释为意图、能力、人格、立场、成功或正确路线；没有 score、rank、victory、defeat、
  good/bad ending 或唯一最优输入。
- 不记录设备 ID、账号、地域、wall clock、camera frame、RAF 或 renderer state；不同设备只在 validated
  gameplay facts 相同时共享同一 capture bytes。
- 显式保留 missing，避免尚未解锁 Override、尚未发生 Dusk 或无 room context 被错误解释为零行为。

## 行为契约与失败方式

- seed / RNG：记录既有 raw Run seed；capture 不解析 occurrence seed、不消费 RNG。
- time / owner：integer `tick120`；pause/wall gap 规则沿用 Run Session；H 由旧 owner且必须是 facts 的最后
  accepted tick，H+1 不得进入。
- event：不新增或 enqueue canonical event；source event observed count/last sequence 必须与 H bus prefix一致。
- atomicity：rejected caller input、H 前内部 failure或 capture validation failure不能公开半份 capture；后者使
  composite fail-stop。available capture 与所有嵌套值 deep-freeze。
- determinism：同 raw seed、accepted input与content digest产生相同 canonical JSON bytes；排序不依赖 locale、
  insertion order、render cadence 或 wall time。
- offline：无 network/service/permission；build/content gate 校验静态 digest pin，浏览器 Run 不加载 Node-only
  validator，也不降级到 QA fixture或旧 director。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；metadata、做减法、双螺旋与非单一化门 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | pre-room narrative boundary、2..4 与 selection intent | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | 14 metric ID/weight universe；不推断 producer | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / V4 4.0.0 | caller metric fixture、一次性 schedule；不作 live policy | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `docs/WORLD_REFERENCE_ORIGINAL_ZH.md` | V4 package / aaajiao | original concept reference | run-end/2s formulas仅作历史对照，不接入 | repository license | `1c486c831fc95e0d4c8edff5ee5e2f5423c1b627370901f4e4a52520f00dc6b6` |
| `src/authority/run-behavior-facts.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | EXT-006 rolling source snapshot | repository license | `7a7deccdfd155bbb61557576ddad653aca4d9629071e0812bb69affecd061955` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | typed H boundary 与 owner switch | repository license | `f3f57f0f573e74cda1dc7827112716b66cfd2e9312dc27650c03480cdbfe4bcb` |
| `src/authority/run-composer.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | QA-only exact fixture/composer；保持隔离 | repository license | `930295610620fb5e392e251fde91f50f419b6fab6c099b074ff5c29ea1dc3335` |
| `src/authority/live-run-admission.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | caller plan admission；composer=false | repository license | `51885d411e518e072e9402cb44ab5fabe15a7631e634b623f22c0cf07eba7757` |

V4 source tree 保持只读。application hashes 是提案起草时输入基线；接受时补充 capture implementation、
tests、最终 Run Session hash 与实现提交。

## 验证证据（待实现）

PROPOSED 阶段不声称未运行测试通过。接受前至少需要：

- H−1 capture missing；H 在 EXT-006 记录后恰好 available；source facts last tick/count 为 H、room owner 0、
  room context missing；H+1、H+159、H+1701 后 capture canonical bytes 不变；
- capture 不含 `roomSampling`/room plan/pattern/difficulty，metric universe仍全部 unresolved，selection false；
- capture source event count/last sequence/ID multiset等于 H bus prefix，且加入 capture 不改变 event serialization；
- rejected/gap/duplicate input 不创建或更新 capture；cross-authority failure 与 capture invariant failure保持
  fail-stop/atomicity；snapshot与nested facts全部 frozen；
- 同 seed/input replay得到同一 capture serialization；Full/Reduced Motion/Flash-Off 不进入 capture source；
- V4 schema/content digest pin与实际 Content Authority一致，漂移使 focused/build content gate失败；
- focused authority tests、strict typecheck、`bun run build` 与 `git diff --check` 通过；无 user-visible path，
  不要求 Playwright或全量 `test:all`。

## 回滚与迁移

删除本扩展只移除一次性内存 capture port；EXT-006 rolling facts、gameplay、canonical event trace、fixed first
room与presentation不变。没有 archive migration。若 producer/schema/policy/content digest不匹配，future
consumer必须在自己的输入边界拒绝，不得重算、补零或读取 current rolling facts冒充旧 H capture。

任何 metric projection、selection、persistence 或 fixed bootstrap supersession必须新增 successor ADR，并
明确引用或拒绝本 current-run prefix source。

## 决策

PROPOSED。先保存进入 room owner 前最后一个可无损取得的 EXT-006 aggregate snapshot，不提前决定其
selection 意义，也不把它冒充 EXT-006 未记录的完备 metric source。14 项 metric、cold-start source、room
count、weighted selection、tier/difficulty/salt、room completion、下一 handoff、Boss、weather与cross-run
consumer继续未决。
