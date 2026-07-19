# EXT-2026-012：首房 partial facts 的下一房 target

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 实施 commit：`279e32e`（已推送）
- 前置记录：[EXT-2026-005](EXT-2026-005-first-forced-room-bootstrap.md)、
  [EXT-2026-009](EXT-2026-009-first-fixed-room-closure.md)、
  [EXT-2026-011](EXT-2026-011-first-room-recent-input-density.md)
- 取代：EXT-010“14项全部available后才允许selection”的后续顺序，以及EXT-009“先解析完整room
  count再选择target”的后续顺序；不改写两个已接受artifact的历史字节或职责
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：partial metric consumption / first continuation room target / one RNG draw；不修改 V4、首房
  closure/projection字节、总room count、difficulty、pattern selection、transition、event、asset、dependency或
  persistence

## 不可约事实（Metadata）

当前规则要求14项metric全部available后才选择下一房，但`unansweredActions`、IN_BETWEEN三项、
POLARIZED四项、Override与No-Dusk等事实需要先进入后续room或phase才可能观察。等待它们全部出现会让Run永远
停在已经关闭的首房。

V4要求一次Run采样2–4个不重复room，首房已由EXT-005固定为`FORCED_ALIGNMENT`，因此第二个room必然存在；
选择它不需要先决定Run最终是2、3还是4个room。删除本扩展后，真实Run没有合法的下一房target。

无形容词机制句：Run在H+1702从正式partial projection读取三项available value，以V4权重计算剩余三房的
base-plus-available-bias，消耗一个Mulberry32 draw并冻结room ordinal 1的target；missing保持absence。

## 负空间（Behavior > Content）

三个已观察ratio只改变与它们有V4 binding的增量；未观察行为不产生假数字，也不让对应room消失。
`POLARIZED`当前没有available term，仍保留base weight 1；空白是一条可达路线，不是最低评价。

## 决定

### 1. 打破循环但不制造完整composer

- source只能是EXT-011在真实H+1702 closure上生成的正式projection。projection本身继续保持
  `partial/ready=false/selectionAllowed=false`；EXT-012通过新的module-issued opaque receipt取得一次窄
  target authority，不回写或升级旧artifact。
- selector只接受原in-memory formal projection。公开snapshot clone、JSON round-trip、unbranded fixture、
  caller numeric record与伪造receipt均无authority；pure derivation core可接受exact frozen test fixture，但不能
  铸造正式target。
- 首房completed visit必须精确为`FORCED_ALIGNMENT / ordinal 0`，source boundary、raw Run seed、content
  identity、3 available / 11 missing与EXT-011契约完全一致。失败时closure、projection、selection均不发生
  部分公开。
- 输出只冻结`targetRoom / targetRoomOrdinal=1`、候选权重证据、source identity与RNG证据。它不是完整
  `V4RunComposerMetrics`、room order、room count、difficulty、tier、pattern plan、handoff或transition receipt。

### 2. remaining candidates与partial消费

- room universe和顺序只从V4 `roomSampling.rooms`与composer declaration order取得。移除已完成的
  `FORCED_ALIGNMENT`后，exact candidate order为`INFORMATION, IN_BETWEEN, POLARIZED`；禁止caller排序、
  locale sort或重新加入已访问room。
- 每个候选的live weight为：

  ```text
  1 + Σ(projection中available metric value × 该room的V4 authored metric weight)
  ```

- 只枚举available且该room实际引用的term，并按metric ID stable code-point order从`behaviorBias=0`累加；
  完成全部term后才计算`totalWeight=1+behaviorBias`，与V4 oracle的浮点运算顺序一致。不得从base 1开始逐项
  累加，不按available数量或authored weight总和归一化，不clamp、不round。值、权重、乘积、bias与total
  必须为finite且total至少为1，否则fail-stop。
- missing entry继续是`{id, availability:"missing", reason}`，不创建numeric 0、neutral sample、默认history或
  完整metrics object。数学上没有增量的候选只使用base 1；这复用`sim_core.py`的base-plus-bias结果，但不把
  QA `metrics.get(..., 0)`升级为live producer事实。
- candidate evidence逐项公开base weight、实际available terms、与该room相关的missing IDs及total weight，
  使“未观察”与“观察到0”保持可区分。

### 3. first-continuation RNG domain

- 只有`mulberry32-v1` primitive与raw-seed QA依据来自V4；“fixed bootstrap之后、在remaining candidates上使用
  raw Run seed draw 0”是EXT-012新增policy。domain tag固定为
  `ext-012-first-continuation-room-selection`，只作identity metadata，不是salt；numeric seed精确为source
  `rawRunSeed`，不使用occurrence resolved seed、difficulty salt、wall time、profile、frame cadence或caller salt。
- EXT-005/009/010/011已证明此前selection RNG draws为0，本切片只消费draw ordinal 0；cursor为
  `randomValue × candidateTotalWeight`，按run-director与composer一致的manifest room order逐项减weight，首个
  `cursor <= 0`者入选，浮点尾差fallback最后一项。
- output记录seed domain/value、draw ordinal、draw value、draws consumed `1`及draw后的uint32 state。该draw
  不得被重放给另一个target。完整room-order、pattern与Boss RNG顺序仍未授权；successor必须显式继续或
  supersede本窄domain，不能暗中把它冒充QA full-composer cursor。
- 同seed、同source projection与同content得到byte-identical target；full/reduced-motion/flash-off使用同一
  gameplay source与结果。

### 4. H+1702原子边界与输出防火墙

- selector在closure、recent-input supplement和metric projection全部成功后、公开同一个H+1702 Run snapshot
  前执行。它不推进tick、不读取H+1703 facts、不写canonical event。
- H+1701及更早公开missing sentinel。H+1702成功后输出`selectionComplete=true`、
  `selectionRngDraws=1`、`canonicalEventWrites=0`、`targetRoomOrdinal=1`、`roomCount=null`、
  `difficulty=null`、`transitionAllowed=false`、`handoffReady=false`。H+1703以后不得改写。
- Run保留原formal target对象供后续receipt使用；公开deep-frozen clone不能自行启动transition。

## 被拒绝或延后的替代方案

- **继续先补首房side/crack metric**：延后；它们只给已访问且已排除的`FORCED_ALIGNMENT`增加bias，不能
  改变剩余三房选择；且V4尚未给出live聚合公式。
- **等14项全部available**：拒绝；后续room/phase事实形成循环依赖。
- **missing→0完整record**：拒绝；把未观察伪装成已观察的零。
- **按available weight归一化**：拒绝；会放大覆盖少的room并偏离V4 base-plus-bias公式。
- **先决定2–4的总room count**：延后；V4最小值2已经足以证明ordinal 1存在，总数policy不应阻塞它。
- **直接调用`composeV4RunComposerPlan`**：拒绝；该adapter要求caller exact 14 metrics、默认QA 3 rooms并明确
  `liveIntegration=false`，还会越权选择pattern、Boss与schedule。
- **同片接room transition**：延后；target事实与world swap/transition lifecycle分别验收。

## 数字—物质双螺旋与治理

- digital track：committed Flower、Gaze与consumed input union只在V4已声明的room term上形成bias。
- material track：target只指向既有V4 room材料系统；本切片不提前播放其背景、音床、warning或弹幕。
- missing保留后，三个remaining room都持续可达；selection不生成score、rank、阵营、好坏路线、玩家画像、
  telemetry或提示文案。
- aaajiao审核partial消费、base weight与absence；Codex实现receipt、权重、RNG和原子公开。无新增素材劳动、
  网络、语言、地域、设备或依赖偏差；presentation profile没有选择权。

## 做减法结果与失败方式

- 已复用：V4 room universe/order、metric weights、Mulberry32、QA base-plus-bias公式、EXT-011 exact projection。
- 删除：8个猜测metric producer、完整numeric record、normalization、room-count policy、difficulty、pattern plan、
  transition、event、UI、archive与asset。
- 新增预算：partial-consumption policy 1；formal target 1；RNG draw 1；canonical event 0；asset 0 bytes；
  dependency 0；persistence field 0。
- hostile projection、extra field、wrong content/seed/boundary/cardinality/order、duplicate/unknown candidate、
  non-finite/-0/out-of-range value、non-positive weight、fake receipt或重复选择均fail-stop。
- offline无降级；pause/wall time不参与；选择不接触collision、safe gap、player state、renderer或audio。

## Provenance

| artifact | source/author | tool/model/version | parameters | license | SHA-256 |
|---|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | Danmaku / aaajiao | authored Markdown / 1.1.1 | 完整读取；absence、做减法、非单一化 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/run-director-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | 2–4 rooms、no-repeat、behavior-ledger selection、Mulberry32 | repository license | `2dd2529478c11ac214ca4046fac93f40c479e9357b30f9be8d44a44bd09422b6` |
| `manifests/gameplay/room-composers-v4.json` | V4 package / aaajiao | authored JSON / 4.0.0 | room declaration order与metric weights | repository license | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `gameplay/tools/sim_core.py` | V4 package / aaajiao | Python QA oracle / 4.0.0 | Mulberry32、base 1、weighted cursor；非live source policy | repository license | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |
| `src/authority/run-metric-projection.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | formal projection登记与单一opaque receipt | repository license | `925aa79ea3bbe727c07fb3b76ce110b54d8b0478f75603bb98cb33c2b7728999` |
| `src/authority/run-composer.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | QA-only exact-14/full-plan isolation | repository license | `930295610620fb5e392e251fde91f50f419b6fab6c099b074ff5c29ea1dc3335` |
| `src/authority/run-first-continuation-room-target.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | manifest-derived remaining candidates、partial terms、one-draw target与firewall | repository license | `b85116bbec43763de8ffdd3e245a415b50d12952bfda6bc4407890f280ac3057` |
| `src/authority/run-first-continuation-room-target.test.ts` | Danmaku / Codex | Vitest / Bun 1.3.14 | pure exact/hostile/three-room reachability contract | repository license | `0bb98c68c94bbeaa4b5ec1d13a2e835d9ab639b1051d685b728cc2bd52c77d42` |
| `src/authority/run-session.ts` | Danmaku / aaajiao + Codex | Bun 1.3.14 / TypeScript | H+1702 closure→projection→target原子公开 | repository license | `7ebde846c5353527e33e9fbb237975def833650338e05ae32c0187ded3983c11` |
| `src/authority/run-metric-projection.integration.test.ts` | Danmaku / Codex | Vitest / Bun 1.3.14 | 单一真实长producer、receipt isolation与H+1703 freeze | repository license | `eade05f0fd2c13a9e689d99953d992e6fefd79dcce9d1fc8df9aead953af6ca0` |

## 验证证据

- pure selector 14项通过：exact schema、code-point metric sum、manifest room order、typed missing、hostile source与
  seed `0/1/2`分别覆盖`INFORMATION/IN_BETWEEN/POLARIZED`。
- 唯一真实H+1702 producer的2项集成通过：当前Run seed选择`POLARIZED`，closure canonical仍为5686 bytes /
  SHA-256 `d15ddcef736728ab86eedcf2e061771c6e615b0db4731f45c5fb2165ef388389`；公开clone不能签发receipt，
  同formal projection不能第二次选择，H+1703 target bytes不变，event与transition写入为0。
- 直接受影响的projection、Run与closure共5个文件69项通过；长producer/closure分别单独运行，未并发重压。
  strict typecheck、778-row content authority、production build与`git diff --check`通过；只读复核关闭proposal
  状态与浮点累加顺序两个blocker后未发现新P0/P1。
- 本切片不改变presentation、input、PWA route或可见room，未运行browser/E2E/full suite。

## 回滚与迁移

删除formal projection receipt、first-continuation selector及Run snapshot字段即可回到EXT-011。canonical events、
首房closure/projection bytes、RNG之外的state与persistence都无需迁移。已公开target只作当前in-memory Run事实，
不写archive。后续transition、next-room live admission、总room count、完整room order与RNG continuation分别使用
successor ADR。

## 决策

ACCEPTED。partial facts只形成V4-authored bias增量，missing保留absence；使用raw Run seed draw 0遍历
post-bootstrap remaining candidates明确属于EXT-012窄domain，不冒充V4 full-composer cursor。实现证据已闭合；
总room count、difficulty、pattern/Boss RNG、transition与handoff继续未决。
