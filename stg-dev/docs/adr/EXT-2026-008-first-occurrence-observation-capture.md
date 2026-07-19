# EXT-2026-008：首个 room occurrence 观察闭合冻结

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration`（已 push 至 `origin/agent/canonical-run-integration`）/ 未创建
- 实现提交：`9273488d2240cd07078351ab5645f8dbda7a2520`（`feat: freeze first occurrence observation`）
- 前置记录：[EXT-2026-007](EXT-2026-007-pre-room-behavior-capture.md)
- aaajiao skill：`1.1.1`；SHA-256 `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256 `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256 `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：authority observation / source-window boundary；不修改 V4、room completion、distinct-visited、canonical event、metric、composer、selection、transition、RNG、asset、dependency 或 persistence schema

## 不可约事实（Metadata）

EXT-2026-005 的 fixed 首 occurrence 在 `H+1699` 证明 projectile/residue 与 run timers 已 drain，在
`H+1701` 关闭 telegraph、entry、READ、material-settle 与 required rest 的完整 fixed slice。EXT-2026-006
rolling facts 随后会继续混入同一 room 的 idle 或未来 continuation；若不在 `H+1701` 保存 snapshot，后续
不能无损恢复该 occurrence slice 刚关闭时的 owner、availability、event prefix 与 grouped aggregates。

删除本扩展后无法保留的事实是：H 的 pre-room prefix 之后，首个 fixed Forced Alignment occurrence 及其
完整 material/rest tail 已被 room owner 消费时，EXT-006 对 accepted ticks `[1,H+1701]` 形成的 exact frozen
aggregate snapshot。它仍不是 room-only delta，也不补回 EXT-006 未记录的逐 tick、threshold、switch、latency
或 trailing-window facts。

无形容词机制句：`CanonicalRunSession` 在 `H+1701` 的 fixed slice 与 EXT-006 rolling update 均成功关闭后，
验证 source occurrence、entity drain、event cursor 与 H provenance，并原子锁存一次 frozen observation capture；
capture 不改变 room lifecycle 或下一步权限。

## 负空间（Behavior > Content）

屏幕在 `H+1701` 已无 live projectile/collider/residue，但“画面安静”不能证明整间 room 已完成。V4 没有定义
每 room 的 live occurrence count、room completion guard 或 selection-ready event；QA oracle 的每房三 pattern
也只是 fixture。该 capture 只保存一次实际发生过的观察闭合，不把它命名成征服、通关、正确选择或下一房。

## 决定

### 1. H+1701 同 tick 冻结，不消费 H+1702

- `H+1699` 只证明 occurrence lifecycle drain；`H+1700` 与 `H+1701` 是 EXT-005 的 neutral terminal tail。
- `H+1701` 仍由 `room_sampling` owner 消费。顺序固定为：room authority 关闭 fixed slice → EXT-006 记录
  `H+1701` → validate post-occurrence boundary → 安装 frozen capture → 返回公开 snapshot。
- capture window 为 accepted ticks `[1,H+1701]`、两端包含；H pre-room capture 仍保持 `[1,H]`。新 capture
  是第二个独立 boundary snapshot，不改写、扩展或重新解释 EXT-2026-007。
- 不引入 `H+1702` completion tick。额外 neutral tick 既不来自 V4，也会污染要保存的 exact slice boundary。
  `H+1702` 及更晚 tick 可继续由现有 idle owner 消费，但不得改写 capture。

### 2. 只复制显式 source facts 与最小 occurrence provenance

公开 discriminated union：

- `availability:"missing"`：fixed occurrence slice 尚未关闭，reason 固定为
  `first-occurrence-slice-not-closed`；
- `availability:"available"`：携带 capture authority/schema/producer/policy version、
  `sourceEpoch:"current-run-through-first-occurrence-slice"`、`capturedAtTick120=H+1701`、raw Run seed、共享
  V4 content identity、source boundary provenance 与一份 recursively frozen
  `CanonicalRunBehaviorFactsSnapshot`。

source boundary 只记录既有 identity 与 tick：pre-room H、`FORCED_ALIGNMENT` room ordinal 0、
`room.forced.left_right_gate` occurrence/encounter ordinal 0、READ start `H+159`、drain `H+1699`、slice close
`H+1701`。不得复制整个 `CanonicalRunSessionSnapshot`、renderer、pool handle 或 mutable authority。

验证至少要求：source room snapshot 已 `fixedSliceComplete=true`，仍 `roomComplete=false / handoffReady=false`；
entity counts 全零；retained combat 已 pattern complete、projectile lifecycle drained、run timers quiescent、
occurrence handoff-ready；shared run state 的 active occurrence 与 pending flush 均为空；H capture 仍 available、
content identity/raw seed一致且 capture bytes未改。

### 3. continuation、room completion 与 transition 全部保持 unavailable

capture 显式携带：

- `roomComplete=false`、`distinctVisitedDelta=0`；
- `continuationPolicyAvailable=false`；
- `metricProjection=false`、`selectionAllowed=false`；
- `transitionAllowed=false`、`targetRoom=null`、`selectionRngDraws=0`；
- `canonicalEventWrites=0`。

不 enqueue `room.transition.begin`、不调用 `RoomTransitionAuthority`、不运行
`transition.room_threshold`。V4 的 7800ms transition gameplay occurrence 与 240/500/650ms atomic world-swap
FSM 是独立 authority，尚无 authored join；`room.threshold.commit` 是 read-only narrative cue，不是 canonical
room identity event。

### 4. 后续责任顺序

successor ADR 必须依次明确：

1. fixed 首 room 还需多少 occurrence、pattern slot/cooldown/rest 与何时关闭 room；
2. 关闭哪一个 source window，并决定 14 项 metric 的逐项 producer/missing policy；
3. 冻结 metric snapshot、room count、difficulty/tier/salt 与 remaining candidates；
4. 消耗单一 RNG stream 选 target；
5. 定义 transition gameplay occurrence 与 atomic room FSM 的 join，再允许
   `room.transition.begin → world_swap.commit → room_ready → complete`。

禁止以本 capture、QA `room.withdraw` label、无实体画面或 presentation cue跳过任何一步。

## 数字—物质双螺旋

- authoritative input/event/state：`room_sampling` owner 已关闭的 accepted ticks、EXT-006 request/commit/missing
  aggregates、canonical event prefix 与 occurrence lifecycle drain；capture 自身不写 gameplay。
- material record / 坐标 / 生命周期：首 occurrence 的 projectile、collider 与 seam filament 已真实 drain；其
  absence 被记录为 source evidence，不被解释为成功或 room completion。
- presentation：可继续表现安静、残留或等待，但不能由帧、alpha、audio 或 visual transition推进 continuation。
- restore / witness：本切片不持久化、不恢复、不生成 witness；future consumer须比较 producer/schema/content
  identity，不得用 current rolling facts冒充旧 capture。

## 做减法结果

- 已复用：EXT-005 fixed boundaries、共享 run state/bus、EXT-006 rolling facts、EXT-007 H capture 与共享 V4
  content identity gate。
- 删除：H+1702 新 tick、roomComplete、distinctVisited、next target、14 metrics、composer、RNG draw、transition
  pattern/FSM、canonical event、UI/copy、telemetry 与 archive。
- 为什么仍需新增：rolling aggregate 跨过 H+1701 后不能反演 exact slice-close snapshot；现有 room snapshot
  只保存当前状态，不保存此 boundary 的 facts prefix。
- 新增预算：canonical event `0`；gameplay rule `0`；RNG draw `0`；asset `0 bytes`；dependency `0`；
  persistence field `0`；每 Run 最多 `1` 份 bounded post-occurrence aggregate capture。

## 治理与非单一化

- aaajiao 决定后续 continuation、room closure 与 metric source；Codex 只实现本 boundary isolation、版本、
  exact schema 与验证。successor可采用 current prefix、room-local producer、上一 Run memory 或拒绝本 capture。
- capture 不把 position、Flower、Gaze、Override 或 absence解释为能力、人格、阵营、好坏或最优路线。
- 没有 score、rank、victory、defeat、achievement、good/bad ending 或隐藏评价；固定首 occurrence仍不是行为
  selection 的结果。

## 行为契约与失败方式

- time / owner：integer `tick120`；H+1701 属 `room_sampling`；pause/wall time不采样。
- seed / RNG：只记录既有 raw Run 与 resolved source identity；capture不消费 RNG。
- event：source baseline + observed count、last sequence与ID multiset必须等于 H+1701 bus prefix；写入 0。
- atomicity：rejected/faulted step、incomplete slice、live entity/residue、active occurrence、event divergence、H
  provenance drift、extra field或非 frozen source均不得公开半份 capture；internal failure使 composite fail-stop。
- determinism / boundedness：同 seed/input/content identity得到相同 canonical JSON bytes；stable code-point
  ordering，不保存 per-tick history，数组 cardinality不随 H+1701 后 idle tick增长。
- offline：无 network/service/permission；browser不加载 Node-only content validator，build gate fail closed。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；metadata、做减法、双螺旋与非单一化门 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | 2..4 rooms、behavior selection；无 room completion | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | Forced pool/tier/rest；无 occurrence count | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `manifests/gameplay/encounter-director-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | segment、1..3 pattern slots、safe gap | repository license | `af12493701eef1c21d845ad460ddb89eba23b9c33109b985c10891303f1b3c0c` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | fixed occurrence 与独立 transition pattern | repository license | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `manifests/runtime/event-schema-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | 四个 transition events；无 room-complete event | repository license | `31c69e627e35e0c8dea828e1564592d6fc71059fa9ce654f92c660114648f0bb` |
| `manifests/runtime/state-machines-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | atomic room swap 240/500/650ms | repository license | `eb1c62d53b71c0c2bbf0fc91098791b59054be4f5472efbbf112dcd12f0794fd` |
| `narrative/narrative-state-machine-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | ROOM_SAMPLING exits on distinct rooms/time，不是 occurrence | repository license | `1b8d80a930c5338603f63620d40fc1b2dc44f37643d9f9cc73006185b5db6daf` |
| `narrative/room-thresholds-v4.json` | V4 package / aaajiao | authored JSON / V4 4.0.0 | thresholdCommit wording；无 canonical identity event | repository license | `6215dd680b318e2a23362b10781677054248066f42ea756ea7c7785e2f0bbaf2` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / V4 4.0.0 | 每房三 pattern fixture仅作反证，不采用为 live policy | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `src/authority/run-room-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | H+1699 drain、H+1701 fixed slice source | repository license | `c36d27002aa9203c5a8b9f897f76222940905fc272d9a0b998167cf352b31e5e` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | parent owner/facts/capture ordering seam | repository license | `36c1685cb5b2e7a24e97cc507f6dfeb31d1cceb755406b03e1b23a92b494ebc6` |
| `src/authority/run-behavior-capture.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | H+1701 exact-schema capture、source identity与lifecycle/accounting gate | repository license | `6b90f68b3a19aeadf9a5dbd7b6a932cee59e7698dfae99e5b038921eeb999524` |
| `src/authority/run-behavior-capture.test.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / Vitest | boundary、immutability、hostile source、event/RNG与firewall contracts | repository license | `10704f04436d8d9db005ce31e31baa15df9714e2f298b119dda018bdcdcda8d7` |

V4 source tree保持只读；以上 application hashes对应接受提交 `9273488d2240cd07078351ab5645f8dbda7a2520`。

## 验证证据（接受）

- focused Vitest：6 个直接相关文件、56 个测试全部通过，耗时 `13.54s`；覆盖 H+1700 missing、H+1701
  原子冻结、H+1702 后 bytes不变、source identity/lifecycle/accounting、hostile extra fields与全部 firewall。
- `bun run typecheck`、`bun run build` 与 `bun run content:check`通过；content check确认 `778` 个 SHA-256，
  package/content digest保持不变。
- `git diff --check`通过；review无 P0/P1。该切片无用户可见路径，因此未运行 Playwright。

## 回滚与迁移

删除本扩展只移除一次性内存 observation capture；EXT-005 fixed occurrence、EXT-006 rolling facts、EXT-007 H
capture、gameplay与canonical event trace不变。无archive migration。

任何 continuation、room closure、metric projection、selection、transition join或persistence必须新增 successor
ADR；不得读取 H+1702 后 current rolling facts冒充 H+1701 capture。

## 决策

ACCEPTED at `9273488d2240cd07078351ab5645f8dbda7a2520`。保存首 fixed occurrence完整闭合时不可逆的
observation prefix，但拒绝把单 occurrence、无实体画面、QA schedule或presentation cue冒充 room
completion/selection/transition 权限。
