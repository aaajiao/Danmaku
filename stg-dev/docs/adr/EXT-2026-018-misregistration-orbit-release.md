# EXT-2026-018：Misregistration Corridor 的 orbit/release 生产语义

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- 前置：[EXT-2026-015](EXT-2026-015-first-continuation-room-plan-and-pool-admission.md)
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：shared pattern authority / simulation / live capability registry；不修改 V4、canonical event、asset、
  audio、dependency、composer抽签、session排程、room completion或archive

## 不可约事实（Metadata）

V4 `room.in_between.misregistration_corridor` 已存在于composer pool，合法抽签可以选中它；production kernel
此前却拒绝该ID。只把ID加入白名单会把`op.orbit_release`错误执行成直线，并让完整轨道足迹绕过safe-gap。

V4 motion manifest要求轨道相位来自spawn ordinal与seed、释放继承切线与`releaseHeadingDeg`，但30Hz QA
oracle只使用`uid × 0.61803398875`相位，并在释放时把heading直接设为`releaseHeadingDeg`。两处都没有完整
production公式。无形容词机制句：每个候选只消费一个既有Mulberry32 draw；该draw同时生成jitter与
`phase = draw × 2π`，候选完整orbit/release/linear足迹通过preflight后才获得entity identity。

## 负空间（Behavior > Content）

屏幕只会显示成功生成的弹体，容易把被safe-gap拒绝的候选误认为“没有发生”。本扩展保留不可见行为的
边界：候选按declaration order消费RNG并接受完整未来足迹审查；被省略者没有entity、event或residue。
不能先生成再以`source_withdrawn`删除，因为那会虚构一段材料历史。

## 数字—物质双螺旋

- digital authority：resolved occurrence seed、全局候选draw ordinal、同一draw、120Hz分段路径与
  `spawn_omission`判定。
- material authority：只有取得entity identity的弹体可在impact/OOB/pattern end后变成3851ms
  `misregistration_flake`；省略候选不留下材料。
- witness / restore：本切片不新增archive或跨Run记录；canonical event serialization保留确定性证据。

## 做减法结果

- 复用V4 ID `room.in_between.misregistration_corridor`、`op.orbit_release`、`op.linear`、
  `bullet.micro.notch_e`、`offset_corridor`和现有projectile/material lifecycle。
- 不新增operator、pattern、事件、提示、图像、声音、依赖、分数、Boss或room completion。
- 不修改Python/TS reference-v4 trace来伪造production parity；差异显式留在adapter policy。
- 新增预算：canonical event 0；asset 0 bytes；dependency 0；production motion adapter 1；focused ADR 1。

## 治理与非单一化

相位公式由本ADR治理，V4若以后给出seed/ordinal混合与tangent组合公式，应以successor ADR替换，不静默
改写历史trace。EASY/NORMAL/HARD都使用同一机制与各自V4 profile，不因某个seed难实现而重抽或替换
pattern。键盘、手柄、weather、reduced motion与flash-off没有写入该authority的端口。

## 行为契约

1. schedule按`atMs → emitter id → burst index → source index`稳定排序。每个候选在preflight前恰好消费
   一次Mulberry32 draw；`jitter = (draw - 0.5) × authored range`，`phase = draw × 2π`，不增加第二draw。
2. 该phase公式同时依赖resolved seed和候选在单一stream中的ordinal，解决manifest未给出的混合规则。
   QA oracle的golden-ratio uid相位继续只作为reference-v4证据，不冒充production trajectory。
3. arm前沿用共享kernel契约保持anchor静止且collision off。首个可移动tick保留anchor到当时orbit位置的
   radial sweep；之后轨道弧以确定性chord细分，最大sagitta为`0.0001px`。
4. 一个120Hz tick跨过`releaseAtMs`时，先扫到精确orbit release位置，再以独立component按authoritative
   `releaseHeadingDeg`完成该tick剩余linear距离。这里采用QA的absolute heading解释，不发明tangent加法。
5. `spawn_omission`从arm后的第一段一直预演到OOB或pattern end。任一swept circle侵入移动safe-gap即在
   entity分配前拒绝；RNG draw保留，但没有spawn/cancel/residue事件。
6. 已准入弹体若运行时再次侵入同一safe-gap，authority fail-stop；不得以`source_withdrawn`把preflight
   缺陷改写成可见材料。
7. Override与player contact使用同一ordered movement segments；release前后的component不自动补connector。
   warning的完整swept-area声明在本切片exact-validate，但player-visible footprint仍由后续projection负责。
   pattern end先collision-off，再cancel成V4 residue并按entity-owned lifetime排空。
8. 该ID进入exported live capability registry，只证明contract完整的caller-resolved occurrence可准入。
   它不自行选择下一occurrence、取得session owner、完成room或触发handoff。

## Provenance

| artifact | source/author | tool/model/version | license | SHA-256 |
|---|---|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | repository skill baseline | aaajiao skill 1.1.1 | MIT | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `manifests/gameplay/executable-patterns-v4.json` | V4 canonical package | immutable source kit | repository source | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `manifests/gameplay/motion-operators-v4.json` | V4 canonical package | immutable source kit | repository source | `858799a51a433d26cab91ff999a2d7d664a7fae2189659e050e645107bccc43f` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | V4 canonical package | immutable source kit | repository source | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `gameplay/tools/sim_core.py` | V4 QA oracle | immutable source kit | repository source | `d947d3c4c3e0645bb09172a178a883446aee121697e27267ebf2064f88bab277` |

## 验证证据

- exact descriptor validator覆盖完整pattern与hostile accessor/sparse/drift fail-closed。
- 一个NORMAL真实producer覆盖首burst全省略、跨release tick、完整176候选/identity差、pattern end、
  collisionless residue和最终drain，并固定canonical event trace。
- capability registry测试从不可执行改为确定性production能力；continuation plan测试证明选中后不filter、
  不reroll，只进入原有combined-pool admission边界。
- strict typecheck与`git diff --check`作为提交gate。当前未接player-visible第二occurrence，因此不把browser
  screenshot、smoke或E2E列为本切片证据。

## 回滚与迁移

从exported registry移除该ID并删除专属orbit adapter/validator，即恢复typed unsupported；不修改V4、
reference-v4 trace或既有archive。已经保存的canonical trace仍按其content/extension digest只读解释。
V4未来补全公式时新增successor ADR，保留EXT-018作为旧trace provenance。

## 决策

接受。选择单draw相位是对manifest“seed + ordinal”最小的production补全；选择absolute release heading来自
现有QA可执行行为。两者均公开为adapter而非伪称V4原文已完整定义。该能力让合法抽签结果可被执行，同时
让被省略的数字候选不伪造材料残留。
