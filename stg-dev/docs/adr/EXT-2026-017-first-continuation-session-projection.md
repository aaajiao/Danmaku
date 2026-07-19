# EXT-2026-017：首个 continuation room 的会话与双材料投影

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置：[EXT-2026-013](EXT-2026-013-first-continuation-room-transition.md)、
  [EXT-2026-015](EXT-2026-015-first-continuation-room-plan-and-pool-admission.md)、
  [EXT-2026-016](EXT-2026-016-first-continuation-terminal-material.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：authority session / projection / application HUD；不修改 V4、asset、audio、canonical event、
  composer、room completion、archive、dependency 或总 Run 结构

## 不可约事实（Metadata）

EXT-013 至 EXT-016 已证明 transition handoff、successor plan、联合池准入和 terminal material owner，
但正式 `CanonicalRunSession` 仍停在 transition；应用只显示旧 transition material，无法让已验证的下一房
成为真实可玩路径。

删除本扩展后，底层 successor 只能被直接测试调用，玩家运行的同一 Run 不会进入它。无形容词机制句：
transition 在 sole flush 后的同 tick 把共享 Run 权交给一个 opaque successor owner；下一 tick 起 Session 只经
该 owner 推进，presentation 同时投影旧 transition residue 与 successor combat/residue。

## 负空间（Behavior > Content）

只把画面 pattern ID 切到下一房，会隐藏前一房尚未消失的材料；继续只显示 transition residue，则会隐藏
新规则已经开始作用。两种做法都把交接伪装成一次页面替换。

本扩展保留重叠：旧材料仍以原 source/occurrence identity 排空，新弹幕按 successor identity 生成。玩家
看到的是两套生命周期在同一 tick 的并存，而不是为“流畅”而清掉痕迹。

## 数字—物质双螺旋

- authoritative state：Session 保存一个 module-branded successor owner；transition chapter 只读保留 lineage，
  转移后不再取得 step 权。
- material state：旧 carryover 与 successor projectile 是两个不相交序列；presentation 逐项验证旧 material
  的 tick、pool 与 projectile identity，再按 `old material → current successor` 顺序投影。
- witness / restore：本切片不创建 archive 或跨 Run witness；既有 closure、metric projection、target、Flower
  与 Gaze snapshot 字节保持不变。

## 做减法结果

- 复用 V4 的 target room background、既有 projectile atlas、room audio 与 successor pattern；新增素材 0 bytes。
- 复用 EXT-015 admission 与 EXT-016 single-step owner；Session 不复制 telegraph/entry/READ/tail 状态机。
- 不新增 enemy target、phase 特效、提示音、房间完成事件、分数、章节总数或胜负文案。
- 新增预算：canonical event 0；asset 0；dependency 0；Session phase 1；只读 snapshot 字段 2。

## 行为契约

1. transition 的 ready tick 已完成唯一 flush 后，Session 在同 tick prepare/commit admission；commit 必须
   `tickAdvance=0`、`canonicalEventWrites=0`。successor 的首个 telegraph step只能发生在下一 accepted tick。
2. Session 对外 phase 为 `first_continuation_room`。transition snapshot继续存在，但 ownership必须为
   `transferred-to-dormant-successor`；successor snapshot必须存在。其他 phase 不得泄漏二者。
3. admission 若 typed withheld，保留 exact reason，继续由 transition material owner推进；不重抽 target、
   不替换 pattern、也不在材料减少后静默重试旧 receipt。
4. successor pre-READ 的顶层 `combat` 必须为 `null`，不能回退到 transition 的终端 combat。READ 后它必须
   与 successor combat 的 pattern、occurrence、difficulty、start tick和当前 tick一致。
5. movement/Focus继续按活体 gate消费；Signal、Gaze、Flower冻结；Override请求进入行为事实，但传给 gameplay
   的 edge恒为 false，Local Resistance仍未获得。
6. slice complete后同一 owner继续 exact-next-tick material hold。它不是 room complete、handoff、胜利或
   计分；应用不得停止或改用通用 idle authority。
7. projection将旧 material projectile与 successor combat projectile连接，不合并 authority state。重复的
   `instanceId:generation`、material lineage漂移或 active pattern不一致都 fail closed。

## 治理与非单一化

这条接线只承认当前 formal selection，不把测试 seed 的结果写成固定关卡，也不因实现能力不足 reroll。
键盘、手柄、reduced motion与flash-off都通过同一 Session/projection端口；表现 profile没有写回 gameplay。
新增的 HUD data attribute用于观察 owner、phase与typed withheld，不构成玩家评价或遥测上传。

## Provenance

| artifact | source/author | tool/model/version | license | SHA-256 |
|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | repository skill baseline | aaajiao skill 1.1.1 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `1bit-stg-complete-asset-kit-v4/manifests/v4/package-manifest-v4.json` | V4 canonical package | immutable source kit | repository source | `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70` |
| `EXT-2026-013-first-continuation-room-transition.md` | predecessor transition contract | repository ADR | repository source | `4a36e7c1537a6594163dcdd528399667fe63594ffb93043163a00a037d7215c0` |
| `EXT-2026-015-first-continuation-room-plan-and-pool-admission.md` | predecessor admission contract | repository ADR | repository source | `489b53e78152cc6606c925cfb613cc4ae74fddb1fa3c5e97e832dbecdc570a18` |
| `EXT-2026-016-first-continuation-terminal-material.md` | predecessor terminal contract | repository ADR | repository source | `0b08e64e31e64b3b038edda6ffb54fc01e9e52dcef99115596473ea90fad03b6` |

## 验证证据

- Session真实producer：首房closure → transition → 同tickadmission → telegraph/entry → READ → spawn →
  occurrence release → exact slice close → residue drain → empty hold；同时验证 Flower/Gaze/closure/metric/target
  冻结、Override不提交、occurrence只claim一次且不新增room completion。
- Presentation真实producer：transition碰撞弹幕 → handoff旧residue → successor pre-READ → 旧material与新combat
  同屏 → terminal successor residue → 空材料；验证双流数量、identity唯一、active pattern与target visibility。
- strict typecheck、production build、production-preview smoke与`git diff --check`作为提交 gate。
- profile parity来自单一renderer DTO且本切片没有profile分支；截图仍不作为collision或lifecycle证据。

## 回滚与迁移

删除 `first_continuation_room` Session phase、successor owner字段和双流projection，回到EXT-016仅可直接调用的
sealed owner。EXT-013至016的target、handoff、plan、reservation和material记录继续只读保留。不得以回滚
为由清除旧 residue、伪造 room complete、回退到transition combat或开放Override。

## 决策

接受。该接线不增加内容表面，只让已经存在的数字权威与材料余留在正式Run中同时可见。尚未决定下一
occurrence、room completion、Local Resistance、Boss、archive/witness或完整游戏终点；这些继续保持缺席。
