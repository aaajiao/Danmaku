# 1bit STG 游戏设计基线

状态：`V4 DESIGN CONTRACT`

本文是设计 bible，只描述玩家可感知规则、体验结构、行为/材料语义和禁止项。
当前工程完成度见[制作路线图](ROADMAP_ZH.md)，实现边界见[技术架构](ARCHITECTURE_ZH.md)，
测试证据见[测试与验收](TESTING_ZH.md)。

这不是 score attack，也不是善恶判定系统。玩家留下的是行为与材料事实，不是等级证明。

## 1. 不可约循环

> 读取规则 → 身体移动、凝视与擦弹 → 留下 evidence → 在局部撕开规则 → 世界留下材料痕迹
> → 当前 Run 被观察和序列化 → 下一 Run 重新遇见这些事实。

内容是表面，行为是记录对象。系统记录玩家在哪里停留、如何移动、何时 Focus、看向什么、
何时局部 Override、在哪里倒下，以及这些事实如何在下一次读取中留下痕迹。它不把这些维度
压成一个总分。

## 2. 设计支柱

- **行为先于内容**：pattern、房间、Boss 和叙事都必须公开可观察的行为关系。
- **数字—物质双螺旋**：数字事实可以投影为图像、声音、触觉、UI、叙事和记忆；表现不能
  反写玩法 authority。
- **局部而非全局控制**：Override 撕开局部规则，不是全屏清除、万能答案或资源最优解。
- **缺席也是创作**：省略、停顿、中断、无反馈、残留、见证和交接与命中同等重要。
- **结束是观察**：Run 在记录、余波与 handoff 中结束，不以 victory/defeat 总结。

## 3. Canonical Run 结构

Canonical Run 不是线性关卡梯子，而是由 seed 与 behavior ledger 驱动的精神房间抽样。

| 阶段 | 玩法契约 |
|---|---|
| Quiet Awakening | 6–10 秒无战斗；narrative guard 要求至少 6 秒后出现 2 次 meaningful-input rising edge |
| First Eye | 稀疏 `common.eye_acquisition`；玩家读取 gaze/clamp，并获得 Focus 与 graze evidence 的关系 |
| First Clamp Recovery | gaze release 与 Flower recovery 是两个不同事实；缺一不可进入下一阶段 |
| Mental Room Sampling | 从四种 canonical mental rooms 中按 ledger 加权、不放回抽取 2–4 个 |
| Local Override | 达到显式 evidence/cost 条件后可选进入；不使用也不能阻塞 Run |
| Dusk / No Dusk | 达到 authored duration 或 terminal protocol 后停止新战斗生成，保留已存在的身体与余波 |
| State Snapshot | 在无战斗、无 judgement 的状态下观察与序列化当前 Run |
| Cross-run Material Memory | 先恢复材料记录，再投影 ghost/residue/witness，最后归还玩家输入 |

完整 V4 Run 至少持续 240,000ms，并至少进入两个不同房间。每个 Run 最多出现两个 Boss，
由房间和行为匹配；Boss 的 phase resolution 可以来自 HP、存活、阅读或世界事实，`HP == 0`
不是全局必要条件。

四个 canonical room 是 `INFORMATION`、`FORCED_ALIGNMENT`、`IN_BETWEEN` 与
`POLARIZED`。它们是被抽样的精神状态，不是从低到高的关卡，也不表达玩家等级。

## 4. 禁止的评价语义

以下内容不得进入 schedule、存档字段、UI、遥测、成就或结局命名：

- score、high score、rank、grade、leaderboard；
- victory/defeat、good ending/bad ending；
- 用击杀数、资源量或单一路线定义“正确玩家”；
- 用天气、可访问性配置、设备性能或手柄型号改变玩法结果；
- 把 Boss、房间或 pattern 的完成解释为道德、效率或技能评价。

合法的 Run end 是已提交的事实，例如身体倒下、协议撤回、读取失败、稳定交点或无黄昏撤回。
Snapshot 可以描述发生了什么，不能评价做得好不好。

## 5. Behavior Ledger

完整 Run 的 Behavior Ledger 保留可解释、可追溯的维度：

- `roomTimeMs`：各房间的权威停留时间；
- `flower`：表达/信号强度的行为摘要；
- `gaze`：凝视、读取与 clamp 的关系；
- `crack`：规则裂缝的发生事实；
- `override`：局部 Override 的使用事实；
- `contextSwitch`：玩家如何在规则上下文之间切换。

Ledger 只用于抽样权重、world response、witness 与跨 Run 重遇。每个记录必须保留单位、采样
窗口、schema version 和来源事件；不得合并成总分或优劣排序。

## 6. Material Ledger

| 数字行为 | 材料事实 | 设计约束 |
|---|---|---|
| Directional Override | `overrideScar` | 保留世界坐标、方向与类型；不是全屏清弹 |
| 玩家倒下 | `deathTrace` | 与 scar 类型严格分离，不写成失败徽章 |
| 长时间或重复暴露 | `burnIn` | 是沉积，不是奖励倍率 |
| 实际移动路线 | ghost route → `ghostResidue` | route duration 来自最后一个权威点 |
| Scar 与 ghost 的关系 | witness orientation | 发生在 ghost residue 之后，不反向改变旧 Run |

Restore 的 authored 顺序是：

`overrideScar → deathTrace → burnIn → actual ghost route → ghostResidue → witness → input return`

Ghost 的 collision、reward 与 emitter class 必须为 `NONE`；它是材料见证，不是敌人、奖励源或
隐藏玩法状态。

## 7. 战斗语法

V4 的 gameplay universe 包含 16 ROOM、2 COMMON、3 TRANSITION、3 WEATHER_ECHO 与
24 BOSS patterns。分类是创作语汇，不代表生产实现进度。

- warning、arm、collision、movement、cancel 与 residue 是不同阶段；动画帧、alpha、声音或
  reduced motion 不能替代它们。
- 同一 generation 的 RNG、identity、运动与材料生命周期必须保持可追溯；省略的 candidate
  没有数字身体，也不能凭空生成 residue。
- motion operators 按 manifest 声明顺序执行。转向、seam、clock、phase gate 与 envelope 的
  次序本身就是 pattern 行为，不能为了统一代码而重排。
- safe gap 是几何与时间约束，不是善意护盾。被 phase mask 暂时撤回碰撞的身体仍可继续运动；
  被 clock 关闭的身体保留 identity，并按该 clock 的规则停留。
- authored late burst、空 lane、silent cadence、inert hook、未就绪 handoff 与排空中的 residue
  都必须保留；不要用 cutoff、爆炸、提示、奖励或通用“成功反馈”填满。
- 难度只调节 manifest 授权的数量、速度、cadence 与 safe gap，不给玩家贴等级标签。
- WEATHER_ECHO 可以借用天气语汇，但真实 weather event、seed、动画和 accessibility profile
  都不能触发或改写 gameplay RNG、弹体、碰撞或选择。
- Boss pattern 的 family laser association 不自动启动 laser；只有 phase contract 明示的 geometry
  和 authored phase facts 可以产生 active laser。

## 8. Input 与身体语义

| 行为 | 设计意图 |
|---|---|
| Move | 身体位置与路线事实；不是摇杆强度分数 |
| Express / Shoot | 表达信号与射击输入共享设备入口，但各自由 authority 解释 |
| Focus | 改变读取/移动姿态；不能改变 seeded schedule |
| Local Override | 在授权阶段对局部方向/区域形成一次行为边沿 |
| Pause | 冻结 gameplay time，并丢弃暂停期间观察到的 wall time |

Meaningful input 按 rising edge 记录；同一设备动作不能重复计数。键盘、pointer、touch 与 gamepad
只是设备投影，必须汇入同一 gameplay input 语义。手柄标签、haptics 可用性和设备品牌都不能
改变 trace。

## 9. 负空间与反馈

- 生成停止不等于现有实体消失；先观察 projectile/residue drain，再讨论 handoff。
- collision-off、source withdrawal、pattern end、Override 与 out-of-bounds 保留不同的材料原因。
- 缺少 resolution policy 时 hook 保持 inert；缺少 recovery timing 时 handoff 保持 not-ready。
- 沉默区不补通用音效，空 lane 不补视觉粒子，中断不补“失败”文案。
- UI 只显示当前可被玩家使用的事实，不把开发缺口、hash、测试数或系统状态暴露成玩法。

## 10. PWA、离线与可访问性

PWA 更新使用 waiting-worker 语义：运行中的 gameplay 不被新 worker 接管；版本切换只发生在
安全 boot/Run 边界。离线缓存和安装状态不能改写 seed、clock、input 或 gameplay trace。

`full`、`reduced-motion` 与 `flash-off` 是表现配置：

- reduced motion 可减少抖动、拖尾、转场和视觉采样，不减少 gameplay tick 或 collider；
- flash-off 可替换闪烁，不改变 warning/collision timing；
- 音频缺席、haptics 拒绝、低帧率与设备断开都必须保持同一 authority trace；
- 可访问性不是 easier/harder mode，也不进入 ledger 评价。

任何 V4 外的新机制、文案、视觉/音频语言或材料资产必须先通过
[内容扩展治理](CONTENT_EXTENSION_ZH.md)与 focused ADR，不能建立第二套 gameplay language。
