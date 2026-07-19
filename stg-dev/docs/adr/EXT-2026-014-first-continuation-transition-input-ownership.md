# EXT-2026-014：首个 continuation transition 的输入归属

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：Codex / aaajiao
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置记录：[EXT-2026-006](EXT-2026-006-canonical-run-behavior-facts.md)、
  [EXT-2026-011](EXT-2026-011-first-room-recent-input-density.md)、
  [EXT-2026-013](EXT-2026-013-first-continuation-room-transition.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f4cb97c3a8c24bc2b2`
- 影响层：authority composition / session input ownership / behavior projection；不修改 V4、事件 ID、
  EXT-006 对外 snapshot schema、首房 metric bytes、素材、依赖或目标房规则

## 不可约事实（Metadata）

EXT-013 要求从 `H+1703` 到 material/target-room idle 的每个 accepted tick 由 sealed Run owner 独占
shared event bus 和唯一 flush。现有 Gaze 与 Flower authority 是即时 mutation：合法的
`gaze.observe` 或 `flower.resolve` 可能先写 canonical event，因而无法在不破坏 EXT-013 原子性的情况下
与 transition coordinator 并列调用。

删除本提案后，Run 只能在以下错误行为中选择：让合法 Gaze/Flower event 使 transition fail-stop，或重复
H+1702 snapshot 并把未运行的 authority 冒充成本 tick committed fact。无形容词机制句：transition owner
继续消费身体输入，记录全部输入请求，但在后继 room owner 接手前不消费 Signal/Gaze，也不推进 Flower/Gaze。

## 负空间（Behavior > Content）

转场已经同时承载 world identity、碰撞 blocker、safe-gap 行为和材料余留。再为 Signal/Gaze 增加一套并行
反馈会扩大本段的权威面；静默沿用旧 snapshot 则会隐藏“输入没有被当前 owner 接收”这一事实。

本提案不新增提示、图标或补偿反馈。玩家请求仍被记录，authority commit 的缺席也被记录；这段缺席本身就是
转场所有权的边界。

## 行为契约

- 适用窗口从 EXT-013 的 `H+1703` start tick 开始，覆盖 transition gameplay、material carryover 和
  successor admission 仍 withheld 的 target-room idle；由后继 room handoff consumer 明确结束。
- narrative/behavior owner 继续投影为 V4 `ROOM_SAMPLING`；accepted tick 的 committed `roomId=null`，
  transition gameplay 期间 `activeOccurrenceId` 为
  `run:room:0-to-1:transition:transition.room_threshold`，detach 后为 `null`。
- `requested` 完整记录 movement、Focus、Signal、Gaze 与 Override edge，不删除玩家的尝试。
- movement 与 Focus 按 step 前 shared player 的 body-input eligibility 消费，并由 Run combat/player
  authority 产生本 tick committed body fact。它们不沿用首房 neutral-tail policy。
- Signal 与 Gaze 的 `inputConsumption` 固定为 `false`。本窗口不调用 `GazeAuthority.observe` 或
  `FlowerIntensityAuthority.resolve`，也不在之后补跑跳过的 tick。
- accepted-tick observer 的 `committed.flower` 与 `committed.gaze` 为 `null`，表示本 tick 未消费；不得
  填入 H+1702 retained snapshot。对外 Run snapshot 可以继续展示冻结的 H+1702 Flower/Gaze 读值，但其
  authority tick 不得伪装成当前 tick。
- requested aggregate 继续增长；Flower、Gaze 与 room committed aggregate 的 sample count 和
  `lastAvailableTick120` 停在 H+1702。Run combat、event、player 和 owner-phase aggregate 正常推进。
- EXT-011 的 exact first-room input window 仍只包含 `[H+1,H+1702]` 的 1702 个非空
  `FORCED_ALIGNMENT` room ticks；roomless transition tick 不改变分母或冻结 bytes。
- EXT-006 对外 snapshot 字段、schemaVersion 与 canonical serialization 形状不变。nullable committed
  Flower/Gaze 只存在于 ledger 的 accepted-tick producer port，用于区分“未消费”与“重复旧事实”。
- sealed bus 仍必须在每 tick 开始为空；本提案不放宽 EXT-013 的 exact pending-event count、same-tick order
  或唯一 Run flush。

## 做减法结果

- 已复用：EXT-013 sealed Run owner、既有 requested/consumption 记录、typed `roomId=null`、冻结的公开
  snapshot 与 EXT-011 已关闭的首房 window。
- 删除：Gaze/Flower prepared mutation 新接口、额外 event、补偿 UI、旧 snapshot 假提交、目标房提前计数。
- 为什么仍需新增：V4 与 EXT-013 都没有指定 sealed transition 期间 Signal/Gaze/Flower 的消费归属；两种
  合法实现会产生不同可观察结果，不能由文件重构猜出。
- 新增预算：composition policy 1；canonical event 0；公开 state/schema 0；asset 0 bytes；dependency 0。

## 被拒绝或延后的替代方案

- **给 Gaze/Flower 增加 prepared mutation 并加入每 tick composite**：本阶段拒绝。它会扩大两个 authority
  的 rollback、batch receipt 和 hostile-input 表面，只为在已经高密度的转场继续一条非必要反馈轨。若后续
  章节证明这条轨不可删除，必须由 successor 重新提出并证明原子 join。
- **先即时运行 Gaze/Flower，再启动 transition**：拒绝；合法 pending event 会破坏 sealed start/tick，
  失败时也无法回滚已提交状态。
- **重复 H+1702 Flower/Gaze snapshot**：拒绝；retained presentation fact 不是本 tick commit。
- **丢弃 requested Signal/Gaze**：拒绝；玩家尝试仍是观察事实，只是没有被本 owner 消费。
- **把 transition 计入 target room behavior window**：拒绝；room identity stable 不等于后继 room owner 已接手，
  且会倒改 EXT-013 的 `roomId=null` 边界。

## 数字—物质双螺旋与治理

- digital track：完整 input request → per-channel consumption → body commit 或 Flower/Gaze typed absence。
- material track：身体仍穿过 safe gap；Flower/Gaze 读值停在首房最后一次 commit，不新增代表“冻结”的装饰。
- restore/witness：本扩展不新增 persistence；行为 ledger 保留 requested aggregate 与最后一次真实 committed
  sample 的边界。
- aaajiao 审核输入缺席是否符合转场；Codex 实现 nullable producer port、session routing 与验证。无 score、
  rank、好坏路线、telemetry、语言、网络或设备门槛。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；做减法、行为优先、双螺旋 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `docs/adr/EXT-2026-013-first-continuation-room-transition.md` | Danmaku / aaajiao + Codex | accepted ADR | sealed bus、roomless transition、material handoff | repository license | `4a36e7c1537a6594163dcdd528399667fe63594ffb93043163a00a037d7215c0` |
| `src/authority/run-behavior-facts.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | requested/committed/consumption producer port | repository license | `bff2a8679529e6474563e1bde8a0413bce88fe5447b37bf7dc7aa769ddcd2294` |
| `src/authority/gaze.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | immediate Gaze commit/event authority | repository license | `d405c0e98a394f125cd1aabc7b28ff64e7a302f255f082099f5b10524c9a0f35` |
| `src/authority/flower.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | immediate Flower commit/event authority | repository license | `a09c7e7f8e8cca73112198a69e83425c4d6df6b89b0e93537b404dcd1238c1aa` |

## 验证计划

- producer：roomless transition tick 必须接受完整 requested input，但只允许 body consumption；伪造
  Signal/Gaze consumption、retained Flower/Gaze commit 或非空 roomId 原子拒绝。
- aggregate：requested 增长；Flower/Gaze/room committed counts 停在 H+1702；run-combat occurrence/event
  counts继续推进；first-room supplement bytes不变。
- session：同一真实 Run 在 H+1703 以 movement + Focus + Signal + qualified Gaze 输入，transition 正常启动，
  Gaze/Flower 对外 bytes 冻结，bus 仅含 EXT-013 canonical suffix。
- material/idle：detach 后继续遵守相同归属，handoff receipt 不把未消费通道改写为 target-room behavior。
- strict typecheck、focused ledger/session tests、`content:check`、build 和 `git diff --check`；presentation E2E
  沿用 EXT-013 的唯一 canonical-run journey。

## 回滚与迁移

删除 nullable producer port 和 transition input routing，即回到 EXT-013 的未决组合缺口；V4、首房 closure、
metric projection、target selection 与历史 snapshot 无需迁移。任何让 Gaze/Flower 在此窗口恢复消费的实现都
必须以 successor 明确 batch/rollback/flush ownership，不能静默改成即时调用。

## 决策

ACCEPTED（2026-07-19，aaajiao 明确确认）。“身体输入继续，Signal/Gaze/Flower 冻结”：保留玩家请求、
删除额外反馈轨、维持 sealed Run 原子性，并用 typed absence 代替旧 snapshot 假提交。该决定现为 session
接入与后继 room owner 接手前的有效工程约束。
