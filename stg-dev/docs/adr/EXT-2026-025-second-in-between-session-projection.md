# EXT-2026-025：IN_BETWEEN 第二个 occurrence 的 Session 与只读投影

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置：EXT-2026-017、EXT-2026-019—024
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- 内容扩展门：`CONTENT_EXTENSION_ZH.md`；SHA-256
  `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：chapter progression owner / Canonical Run Session / read-only presentation / production-preview
- 不修改：V4、第三 occurrence、room completion/handoff、80-slot retirement、Local Resistance、Boss、archive、素材或依赖

## 不可约事实（Metadata）

EXT-017只把首个Context Switch successor接入Session；该owner在global `6788`关闭slice后会永久走
complete hold。EXT-019—024已在同一个direct authority链完成Context Switch material转交、Misregistration
计划/准入、READ/release/tail、global `8519` material转交及global `8682`自然drain，但每份决定都明确保留
Session/presentation withheld。V4没有定义这些application owner如何进入玩家路径，也没有因此授权第三
occurrence或room close。

无形容词机制句：同一Canonical Run Session只消费EXT-019—024的original opaque owner，在两个已flush
slice-close tick完成零tick换手；accepted gameplay tick由当前child owner唯一推进，presentation只读投影现有
material与combat，global `8683`后仍停在同一room/session phase和同一80-slot material lease。

## 负空间（Behavior > Content）

当前玩家在Context Switch结束后只能看见空的complete hold，已经存在的Misregistration authority被应用接线
遮蔽。修复不是补一个“下一关”提示，而是让既有数字身体与材料时间进入同一可观察Run。两次换手不得清屏、
复制projectile、等待drain或插入解释性图标、音效、倒计时和评价文案。

排空仍不是进度门。`8682`只是seed-1验收事实；现场从有到无，Session phase不因此变化，capacity也不因此
释放。第三occurrence与room completion继续以缺席形式存在。

## 数字—物质双螺旋

- digital track：Session exact tick、唯一chapter progression owner、两次零tick handoff、shared player与Run
  sole-flush。
- material track：Room Threshold、Context Switch、Misregistration三条entity-owned lineage按各自阶段并列，
  只由当前exact owner推进；retired owner永远不能恢复。
- join：第二occurrence pre-READ显示Context Switch residue；READ/tail按稳定顺序合并旧material与当前combat；
  global `8519`后只保留Misregistration material，`combatEnabled=false`。
- presentation只构造renderer DTO和只读diagnostic attributes，不向Session、collider、pool或lifecycle写回。

## 做减法结果

- 复用EXT-019—024全部transfer、admission、step与material-hold port；不复制规则到Session。
- 章节目录新增一个判别式progression coordinator；`run-session.ts`只持有并step该owner，不拼装direct API。
- 不新增canonical event、RNG draw、projectile、segment、room FSM、内容、素材或依赖。
- 不重置顶层`first_continuation_room` phase或`segmentTick120`，不增加故事阶段。

## 行为契约

### 1. 单一判别式owner

- Session公开一个判别式chapter progress，内部状态只能是`first-occurrence`、
  `first-material-withheld`、`second-occurrence`或`second-material`之一；不得用多个独立nullable owner形成非法组合。
- progress从EXT-015 original首owner铸造；clone、JSON、跨Run、旧owner或替换child均无效。每个accepted tick只调用
  当前child一次，skip/repeat、并发step与错过零tick换手均fail closed。
- 顶层phase始终为`first_continuation_room`；behavior ledger继续把requested input记为room sampling事实。
  movement/Focus进入child；Signal/Gaze/Flower保持冻结；Override request只记事实，gameplay edge恒为false。

### 2. global 6788零tick换手

- 首occurrence exact slice close完成sole-flush后，在同一个`Session.step`内依次提交EXT-019 transfer与EXT-020
  plan/admission；整个换手不推进tick、不写event、不额外消费RNG或claim occurrence。
- admissible时只留下Misregistration dormant owner；下一accepted tick才推进telegraph。公开active pattern切换为
  已准入Misregistration，但`combat=null`，Context Switch residue继续显示。
- typed withheld时保留exact reason与EXT-019 material owner；后续只推进其material hold，不重试、不reroll、
  不替换pattern，也不把未准入plan显示为active pattern。

### 3. 第二occurrence与global 8519换手

- dormant、pre-READ、READ、release、tail与close只经现有EXT-021—023 owner router推进；共享Run每tick仍sole-flush。
- global `8519` close已经flush后，在同一个Session step立即提交EXT-023 material transfer；旧第二owner永久失效，
  顶层`combat=null`，当次仍在场的residue保留原`instanceId:generation`、位置、deadline与terminal cause；
  EXT-024 formal fixture中的63个是该固定输入轨迹证据，不是对其他玩家输入强制出的数量。
- global `8520`起只由EXT-024 owner exact-next推进。`8682` drain与`8683` empty hold都不切phase、不释放
  80-slot allocation、不选择下一consumer。

### 4. 只读投影

- 稳定投影顺序为transition material → 当前progress material → 当前combat；重复identity、lineage tick、pattern、
  occurrence、difficulty或room漂移一律fail closed。
- second pre-READ使用已准入Misregistration identity且`combatEnabled=false`；READ/tail只在真实combat未complete时
  启用combat；post-close只投影Misregistration residue，drain后为空场。
- main/HUD可公开stage、owner、pattern、material count与withheld reason等只读data attribute；不得增加提示、
  telemetry或从presentation反推gameplay完成。

### 5. failure与负授权

- mutation前拒绝保持Session、Run、event与material serialization不变并允许合法重试。accepted tick后的内部
  owner switch或投影一致性失败使Session fail-stop；typed withheld不是错误。
- 本决定不授权encounter ordinal 2、composer draw 3、第三salt/seed、room withdraw/completion/handoff、
  Local Resistance、Boss、archive/witness或Run终点。

## 被拒绝或延后的替代方案

- **让Session继续首owner complete hold**：拒绝；正式玩家永远看不到已完成authority。
- **在run-session内直接拼全部API**：拒绝；章节规则污染共享Session并重复owner router。
- **用多个nullable owner字段表示进度**：拒绝；可形成同时active或全部缺席的非法状态。
- **等待材料drain再准入/换手**：拒绝；把collisionless材料变成玩法门。
- **顺带规划第三occurrence或关房**：延后；没有V4或extension授权。
- **为浏览器测试新建第二条长producer**：拒绝；复用现有controlled-clock真实路径。

## Provenance

| artifact | role | SHA-256 |
|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | 负空间、材料时间、做减法 | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `stg-dev/docs/CONTENT_EXTENSION_ZH.md` | mandatory extension gate | `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040` |
| `manifests/v4/package-manifest-v4.json` | immutable package identity | `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70` |
| `EXT-2026-017-first-continuation-session-projection.md` | existing first-owner Session boundary | `4ec9dd3e431a8c19bbaa2b8b73146dd573a31a4cda9bcdcdb48f9172634bc853` |
| `EXT-2026-019-first-continuation-successor-material-transfer.md` | first material transfer | `c96a5865185c8b8b7dce102f9c6a4aaf7a3660d140d23b2a3b5b9ead3d8cda02` |
| `EXT-2026-020-second-in-between-occurrence-plan.md` | next plan/admission/withheld | `75677d6eac4b5eb10c115cc3264df789b959e62162a6e7582181f4cba843b9cf` |
| `EXT-2026-021-second-in-between-pre-read-and-read-start.md` | second pre-READ/start | `180bfb62a04769af89f0b4b3104202cc8a03ae66015510814dbdf9c5b84bba34` |
| `EXT-2026-022-second-in-between-read-release.md` | second READ/release | `c6a78842ecfefe1606ff2c2617f50ad3c6fb31fe144f094687842a7ed975f548` |
| `EXT-2026-023-second-in-between-material-tail-transfer.md` | second tail/transfer | `d01bbd0d5c9dc69d724b9323b4ecd77e81714d141862ac357a31b2a2882b911b` |
| `EXT-2026-024-second-in-between-post-close-material-hold.md` | post-close material hold | `ef5abe7bbad2506116e35d803e7833cb45b9202f17178b003151e9688619a6f3` |
| `stg-dev/src/authority/run-session.ts` | accepted Session consumer | `8044986d44e4b1dc20c3762ff0dcc295d13777172cf9ec20caef3fd26d2eb65f` |
| `stg-dev/src/authority/run/chapters/first-continuation-room-progression.ts` | discriminated chapter owner | `dfb86bbf87bf73967feb61bc02d7a70bad26095eaa56a970d255792d37608e2c` |
| `stg-dev/src/game/presentation.ts` | accepted read-only projection | `7f3f6e5c6301933fbcf90cef1b2e367462c5b18158db15f55a5e23cd69c8f050` |
| `stg-dev/src/main.ts` | production diagnostic projection | `8dcc95cbb00f3fc55287e11fd9d6023fa7524e9cff2c58e01a7a18d5b51d05d1` |
| `stg-dev/e2e/causal-input-clock.spec.ts` | controlled production-preview acceptance | `15871d4e18673e323aa30530ca6f4849b917d66c06f4b289c3fe72d019fa23b0` |

## 验证计划

- 只延长现有seed-1 Session真实producer，覆盖global `6788 → 6947 → 8219 → 8519 → 8682 → 8683`、
  两次零tick换手、typed stage、两次claim、RNG126、80-slot保留及无第三occurrence/room handoff。
- 在同一producer关键snapshot调用只读projection，证明Context Switch material与Misregistration combat重叠、
  `8519`换手无闪断/复制、`8683`空场；不再新增第二条长presentation fixture。
- strict typecheck与`git diff --check`。玩家可见路径只跑现有controlled-clock production-preview用例；该用例
  自动完成content check、typecheck、build与preview，因此不重复跑build，不跑smoke、全unit或全E2E。

## 实现与证据

- 实现提交：`0c54b9a`。新增一个章节级判别式progression owner；Session只持有、step并投影这一owner，
  second-occurrence端新增单一路由，不把EXT-019—024的既有transfer/admission/lifecycle规则复制进Session。
- seed-1真实Session producer通过：1 passed，约16秒；覆盖global
  `6788 → 6947 → 8219 → 8519 → 8682 → 8683`、两次original owner零tick换手、两次唯一claim、
  RNG126、素材identity连续、empty hold仍保留80-slot allocation，以及第三occurrence/room handoff缺席。
- production-preview Playwright通过：1 passed，约10秒（其中浏览器路径约8秒）；自动完成content check、
  strict typecheck、build与preview，并证明两次换手前后projectile数量连续、active pattern切换正确、
  second-material HUD时间不归零、8683仍为同一Session phase。
- `git diff --check`通过；一次定向只读复审修复了material-hold HUD时间归零与stage-aware material lineage校验，
  最终没有剩余P0/P1。按风险计划未运行smoke、全unit、全E2E或`test:all`。

## 回滚与迁移

实现前回滚只删除本proposal及索引/路线图引用，Session继续安全停在Context Switch complete hold。实现后回滚
移除progression coordinator与新投影，恢复EXT-017边界；不得保留半接线nullable owner、清屏、自动release或
伪造room completion。未来第三occurrence/room决定使用独立ADR。

## 决策

ACCEPTED。同一Session只消费已经被EXT-019—024授权的owner与材料时间；可见性扩大到Misregistration及其
post-close residue，但玩法边界仍停在下一consumer之前。
