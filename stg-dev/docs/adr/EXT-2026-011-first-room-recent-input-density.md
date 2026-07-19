# EXT-2026-011：首房 recent input union

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 实施 commit：`448d525`（已推送）
- 前置记录：[EXT-2026-006](EXT-2026-006-canonical-run-behavior-facts.md)、
  [EXT-2026-010](EXT-2026-010-first-room-metric-projection.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：private bounded input supplement / first-room metric projection；不修改V4、公开EXT-006 facts、
  EXT-009 closure bytes、room count、composer、selection、RNG、transition、event、asset或persistence

## 不可约事实

V4声明`recentInputDensity` ID与INFORMATION权重，但没有定义recent window、active channel union、
denominator或missing policy。EXT-010因此保留`recent-window-not-recorded`。现有EXT-006只保存全前缀逐通道
累计；movement与signal可在同tick重叠，也可分布在两个tick，旧aggregate相同而input density不同。

无形容词机制句：ledger在首房closed ticks上按各通道实际consumption gate计数validated logical input同tick并集；
H+1702 projector以opaque receipt读取该有界计数，输出`activeUnionTicks / roomTicks`。

## 决定

### 1. exact recent window

- `recent`只表示刚关闭的首个authored room：room owner accepted ticks `[H+1,H+1702]`；不是任意N秒、
  wall time、render frame或整个`[1,H+1702]`前缀。
- denominator是完整1702个room-owner tick。V4 Gaze authority每个ROOM_SAMPLING tick都消费sample；
  `skyEyeVisible=false`是有效的qualification-lost/inactive事实，不是authority unavailable，因此也留在分母。
- Run在authority step前只构造不可变的per-channel consumption proposal，不修改ledger；authority成功关闭后，
  proposal才随`recordAcceptedTick`一次提交。不得从step后的`committed.player.inputEnabled`反推。同tick致死前
  已被消费的request仍属于该tick；authority或ledger validation失败不留下可签发的半份supplement。

### 2. 同tick active union

在一个room-owner tick内，以下任一validated logical condition为true，`activeUnionTicks`恰好加1：

- movement channel被本tickroom/player authority消费时，movement向量的Euclidean magnitude `>0`；这里读取
  设备适配后的logical vector，不使用raw axis，也不复用awakening的`0.15` meaningful-edge threshold。
  H+1700/H+1701 neutral tail明确关闭movement channel，caller movement不得计入；
- signal channel被本tickFlower authority消费时，`signalActive=true`；持续hold逐tick计入，不只算rising edge；
- Focus channel被本tickFlower/player authority消费时，`focused=true`；读取request，不从Flower source反推；
- 与body gate独立，Gaze sample同时满足V4 `skyEyeVisible`、pitch threshold与alignment threshold；不可见sample
  仍在分母，但不是active。

多通道重叠仍为1；inactive signal、zero movement、unqualified Gaze与未请求Focus为0。Override不在该union中：
首房尚未开放LOCAL_RESISTANCE，未授权edge/direction不能冒充近期输入。input设备类型、UI、renderer、weather与
accessibility profile不进入事实。

### 3. private supplement与原子边界

- EXT-006 ledger在既有atomic state replacement内维护O(1) private supplement：first/last room tick、room tick
  count与active-union count；不保存逐tick history，不改变公开`snapshot()`/serialization字段或bytes。
- 每个ledger实例持有不序列化的opaque lineage identity；behavior-facts receipt、由它生成的closure metric-source
  receipt与supplement receipt都在module-private registry绑定同一identity。projector除验证seed/tick/window外，
  还要求两个receipt的identity对象相同；plain object、公开snapshot clone、H+1701/H+1703 receipt或同seed的
  跨session splice均fail-stop。
- closure、supplement与projection全部成功后才由Run公开projection；任一步失败不暴露半份新状态。

### 4. metric projection successor

- `recentInputDensity = activeUnionTicks / roomTickCount`，finite、未round、未clamp，范围`[0,1]`；formal
  H+1702 source要求denominator恰好1702，zero/other count直接fail-stop。
- entry沿用EXT-010 exact available shape；formula ID为`first-room-active-input-union-ratio-v1`，numerator path为
  `metricSupplement.activeUnionTickCount`，denominator path为`metricSupplement.roomTickCount`，sampleWindow为
  `[H+1,H+1702]`。
- projection保持authority `canonical-run-first-room-metric-projection-v1`，但schema升为
  `1.1.0-ext-2026-011`、`producerVersion="1.1.0"`、`extensionPolicy="EXT-2026-011"`；root字段集合、
  sourceBoundary与stable code-point order不变。
- available从2增至3、missing从12减至11，只有`recentInputDensity`从missing变available；其他entry不变。
- projection仍是`partial`、`ready=false`、`selectionAllowed=false`、`selectionRngDraws=0`、
  `canonicalEventWrites=0`、`targetRoom=null`、`transitionAllowed=false`。不把11个missing当0或bias term。

## 被拒绝或延后的替代方案

- **逐通道计数相加**：拒绝；同tick多设备/动作会重复计数并可超过1。
- **全Run累计或任意trailing秒数**：拒绝；前者不是recent，后者没有V4或mechanism边界。
- **只算movement/signal edge**：拒绝；会丢失hold、Focus与qualified Gaze的实际驻留。
- **把Override request计入**：拒绝；首房没有该输入authority。
- **同时补unansweredActions/binarySwitches**：延后；前者缺action-response pairing/deadline，后者缺POLARIZED
  A/B committed authority，signal rising edge不是binary switch。
- **用typed missing直接解锁composer**：延后；当前各room metric覆盖不均，skip missing会产生coverage bias，
  partial-consumption/normalization必须另立ADR。

## 双螺旋、负空间与治理

- requested logical input是行为事实；玩家位置、Flower结果、动画、音频或设备来源不能替换它。
- 同tick union保留多种动作共同发生，不把动作数量变成分数；body/room consumption gate与独立Gaze authority
  分别记录，身体被关闭不合成Gaze release或删除其inactive sample。
- metric不评价活跃/消极，不生成标签、提示、奖励、telemetry或玩家画像。
- aaajiao审核recent window、四通道union与input-enabled denominator；Codex实现bounded supplement与projection。

## Provenance

| artifact | source/author | parameters | SHA-256 |
|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | absence、双螺旋、非单一化门 | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | ID与weight；无producer/window | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | caller metrics consumer；非live producer | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `src/authority/run-behavior-facts.ts` | Danmaku / aaajiao + Codex | private 1702-tick union、supplement receipt与ledger lineage | `5c289ccb5a4d1e281b051be136eea86f95dea625582cc964ac3182a2d3763d58` |
| `src/authority/run-behavior-capture.ts` | Danmaku / aaajiao + Codex | closure metric-source lineage传播 | `4b962765c0daf0a107c314cacc58f8e22c4743ebb4d2ccc02199bef86311ea78` |
| `src/authority/run-metric-projection.ts` | Danmaku / aaajiao + Codex | same-lineage双receipt、3 available / 11 missing | `623c1c68075d4efb3b97402b0494ce00dc24a65af31d5e53a83df062c50afc4e` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | pre-step consumption proposal与H+1702原子公开 | `c3fc44a446c8a4e77e0785d70bd1aada845bde6b7ff2aabab4a21b297539af80` |

## 验证证据

- 5个focused authority/Run文件共65项测试通过，wall 21.82秒；覆盖同tickunion、hold、hidden/unqualified
  Gaze、body gate、致死tick pre-step gate、late failure原子性、H+1700/H+1701 neutral tail与同seed跨session
  lineage splice拒绝。
- 真实H+1702路径保持closure canonical 5686 bytes / SHA-256
  `d15ddcef736728ab86eedcf2e061771c6e615b0db4731f45c5fb2165ef388389`；默认fixture得到
  `recentInputDensity=1/1702`，neutral-tail-only路径为`0/1702`，H+1703 projection与closure bytes不变。
- strict typecheck、content authority 778 checksum rows、production build与`git diff --check`通过；只读复核无
  blocker。没有可见路径变化，未跑browser/E2E/full suite。

## 回滚与后续

删除private supplement与第三项available projection即可回到EXT-010；公开EXT-006/009 source bytes、event trace、
RNG与persistence无需迁移。unanswered/binary、其他missing producer、partial composer consumption、room selection与
transition分别使用successor ADR。

## 决策

ACCEPTED。只增加首房per-channel-consumed同tickactive union与`recentInputDensity`，projection保持partial，所有
composer/selection权限继续withheld。
