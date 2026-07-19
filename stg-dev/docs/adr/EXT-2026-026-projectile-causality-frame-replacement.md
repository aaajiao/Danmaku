# EXT-2026-026：弹幕因果 frame 原位替换

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 分支 / PR：`agent/canonical-run-integration` / 未创建
- aaajiao skill：`1.1.1`；SHA-256
  `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`；完整读取于 2026-07-19
- 内容扩展门：`CONTENT_EXTENSION_ZH.md`；SHA-256
  `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040`；完整读取于 2026-07-19
- V4 package：schema `4.0.0`；package-manifest SHA-256
  `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`；content digest SHA-256
  `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：chapter asset selection / read-only projectile presentation / accessibility
- 不修改：V4、projectile authority、event、tick、collision、lifecycle、RNG、音频、触觉、素材或依赖

## 不可约事实（Metadata）

V4把`projectile.arm.begin`绑定到`cue.projectile.dormant`，把`projectile.collision.on`绑定到
`cue.projectile.armed`，并为Reduced Motion提供`enemy_attack.warning_strip`。它没有定义这些frame与弹体
archetype是叠层还是替换，也没有定义表现持有时间。当前renderer只用archetype和透明度，因此玩家看见弹体，
却看不见“这个身体尚未碰撞 / 这个身体已经取得碰撞权”的区别。

无形容词机制句：同一个authority-owned projectile sprite按其当前lifecycle/collision snapshot原位替换为
V4 causality frame；表现不保存计时器，也不写回authority。

## 负空间（Behavior > Content）

被遮住的不是一种弹型，而是碰撞权从缺席到出现的行为。扩展不增加图标、粒子、闪烁、文本或第二个身体；
它只让已有身体的collision边界可见。collision-off后的缺席同样保留：因果cue立即撤回，不用动画结束补写事实。

## 数字—物质双螺旋

- digital track：`lifecycleState`与`collisionEnabled`来自projectile authority的只读snapshot。
- material track：同一sprite、同一位置、速度方向、尺寸和entity identity上的全不透明frame替换。
- join：`arm + collisionEnabled=false`显示telegraph；`flight + collisionEnabled=true`显示live notch；其余状态
  显示原archetype。renderer frame不成为collision或lifecycle authority。
- restore / witness：不新增记录；重放相同snapshot得到相同frame。

## 做减法结果

- 复用`projectile-arm-visual`、`projectile-live-visual`、`cue.projectile.dormant`、
  `cue.projectile.armed`与Reduced Motion的`enemy_attack.warning_strip`。
- 采用**原位replacement**，拒绝overlay；因此不复制位置、transform、sprite、material lifetime或identity。
- 不使用V4 preview timeline作为运行时playhead，不增加持续时间、循环、crossfade、声音、触觉或generic FX。
- legacy Lab没有canonical lifecycle字段时保持原archetype，不伪造因果状态。
- 新增预算：canonical event 0；gameplay state 0；asset 0 bytes；dependency 0；presentation composition rule 1。

## 治理与非单一化

规则由本ADR治理；V4 binding、state machine或accessibility resolver改变时fail closed并重新评审。Reduced Motion
不是删掉警告，而是使用正式steady fallback。不同archetype在因果cue撤回后恢复自身差异，不把所有弹幕永久
压成同一外观。本扩展不增加score、rank、胜负、唯一最优输入或玩家评价。

## 行为契约

1. canonical `arm`只在`collisionEnabled=false`时选择arm binding的frame；Full使用
   `cue.projectile.dormant`，Reduced Motion使用`enemy_attack.warning_strip`。
2. canonical `flight`只在`collisionEnabled=true`时选择live binding的`cue.projectile.armed`。
3. `flight + collisionEnabled=false`、`residue`以及没有canonical lifecycle的legacy projectile使用原archetype；
   不从`bornAtMs`、`armedAtMs`、opacity或render cadence推断状态。
4. causality frame固定`opacity=1`，不fade、blink或tween；replacement继承原sprite的position、rotation、
   scale与z。frame切换时只替换该entity独立material并释放旧material，不能修改共享atlas texture/material。
   cue撤回后archetype恢复既有lifecycle opacity。
5. 未知lifecycle、`arm + collisionEnabled!=false`或`residue + collisionEnabled!=false`是投影错误，fail closed。
6. 同tick ordering仍由authority保证；renderer只消费提交后的snapshot。pause保持当前snapshot/frame，无表现计时。

## 被拒绝或延后的替代方案

- **在archetype上叠加cue**：拒绝；制造第二个视觉身体并增加层级、同步和回收规则。
- **按`armedAtMs`切图**：拒绝；把派生毫秒和renderer cadence变成authority。
- **所有flight都显示armed**：拒绝；会遮住collision-off这一事实。
- **播放V4 preview clip**：延后；preview没有授权runtime playhead、loop或completion语义。
- **顺带接projectile audio/haptic/cancel/impact**：延后；属于不同binding与生命周期责任。

## Provenance

| artifact | role | SHA-256 |
|---|---|---|
| `.agents/skills/aaajiao/SKILL.md` | 做减法、负空间、数字—物质双螺旋 | `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4` |
| `stg-dev/docs/CONTENT_EXTENSION_ZH.md` | mandatory extension gate | `f09775a99f6e71b2fe646418b786b516e7d4c4a76655e0b261bdeb6db6970040` |
| `manifests/v4/package-manifest-v4.json` | immutable package identity | `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70` |
| `manifests/runtime/feedback-bindings-v4.json` | arm/live event与accessibility binding | `3cd10504c84e9d331b158d73012674c3a1c07d0b5353365fa86a28a6a5809a51` |
| `manifests/integration/asset-bindings-v4.json` | arm/live resolver | `22f5f04cc5ea66251b0709901e7bdfd7f5741f2a3b1c4b3bfa0a636243b82afe` |
| `manifests/runtime/state-machines-v4.json` | entity-owned projectile lifecycle | `eb1c62d53b71c0c2bbf0fc91098791b59054be4f5472efbbf112dcd12f0794fd` |
| `manifests/v4/frame-index-v4.json` | exact frame universe | `7b9c11c2bb6f8f62f6e3dc711f04b56890befbe31ed7b64a99609c1b033d12b4` |
| `manifests/v4/animation-clips-v4.json` | preview clip存在但不授予runtime playhead | `d53f7541fd1de4b0796bd6d24370ef612f37b3fd09cfb6c5bda57ab73800049b` |
| `manifests/gameplay/projectile-lifecycle-v4.json` | collision与residue不变量 | `e4a5d11f6c36831f055a0398a6098324cd6f039f274797814fd50086cb572d78` |
| `manifests/runtime/event-schema-v4.json` | canonical projectile event identity | `31c69e627e35e0c8dea828e1564592d6fc71059fa9ce654f92c660114648f0bb` |
| `manifests/gameplay/executable-patterns-v4.json` | First Eye真实producer | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `atlases/combat-behavior-cues-v4.png` | reused causality pixels | `2288cb1d2fd71f5c201cf6fbef4f837abd43e5c611c1026e1a67d31f2e3fdf4b` |
| `checksums-sha256.txt` | V4 physical file universe | `ff833ceef5c9821ca2f76feeb6ae6afb4be84facba8f61f22d114e6efd057b99` |
| `runtime/feedback.ts` | reference feedback subscriber | `5312a0a2fd72fabc4c55bb53e47f96478693898a3df3008a063f97c5f922292f` |
| `runtime/projectile.ts` | reference entity lifecycle | `b61b5c78760bae221b75f0518fd8af5e2404f3e293ea1180e5d31a2541780b60` |

未生成或导入新artifact；所有可见像素均来自上述V4 frame。

## 验证计划

- focused registry test验证两个binding、事件、frame和Reduced Motion fallback都来自V4且fail closed。
- renderer pure test覆盖arm Full/Reduced、live、collision-off、residue、legacy与非法canonical组合。
- 复用现有seed-1 controlled production-preview，在真实`projectile.arm.begin`与
  `projectile.collision.on`提交tick断言玩家可见frame；不新建第二条长producer。
- strict typecheck、`git diff --check`；production-preview自动执行content check、build与preview。
- gameplay snapshot/event trace不变；本切片不跑smoke、全unit或全E2E，留到完整玩家路径里程碑。

## 回滚与迁移

删除章节binding选择与renderer frame helper即可恢复原archetype表现；无存档、event、asset或content migration。
若V4 binding、resolver、frame universe或lifecycle契约漂移，应用启动时失败并报告具体binding，不静默回退。

## 决策

ACCEPTED。使用一个原位替换规则揭示collision权的出现和撤回；没有第二个身体，也没有表现对玩法的反向治理。
