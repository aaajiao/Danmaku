# 1bit STG 游戏设计基线

状态：`V4 CONTRACT + FOUNDATION WIP`

这不是 score attack，也不是善恶判定系统。玩家留下的是行为与材料事实，而不是等级证明。

## 1. 不可约循环

游戏的 metadata 不是“打倒更多敌人”，而是：

> 读取规则 → 身体移动/凝视/擦弹 → 留下 evidence → 在局部撕开规则 → 世界留下材料痕迹 → 当前 Run 被观察和序列化 → 下一 Run 重新遇见这些事实。

内容只是表面，行为才是记录对象。游戏不统计一个抽象分数来替代行为；它记录玩家停留在哪里、如何移动、何时聚焦、看向什么、何时打断规则、在哪里倒下，以及这些动作如何改变下一次读取。

## 2. V4 Run 契约

Canonical Run 不是线性关卡梯子，而是由 seed 和 behavior ledger 进行的精神房间抽样：

| 阶段 | 玩法事实 | 当前工程状态 |
|---|---|---|
| Quiet Awakening | 6–10 秒，无战斗；narrative exit guard 另要求 6 秒后至少 2 次 meaningful input | 默认 `CanonicalRunSession` 固定选择 8 秒，允许移动并保留位置交接；若 2 次 rising edge 尚未发生则继续保持安静 |
| First Eye | 稀疏 `common.eye_acquisition`；解锁 Focus 与 graze evidence | 默认 RUN 以 occurrence `run:first-eye:0` 使用 shared canonical combat 与 V4 gaze authority；occurrence 排空后 shared timers 继续 idle，combat drain、gaze clamp/release、Flower recovery 是独立 barrier |
| First Clamp Recovery | clamp release 后等待 Flower recovery 完成，两个事实不可合并 | 单元 authority 可到达该状态；V4 未提供 recovery timing，因此 `flowerRecoveryComplete` 保持 `false`、handoff 不 ready |
| Mental Room Sampling | 从 4 房间中按 ledger 加权、不放回抽 2–4 个 | 未接默认 RUN；只有彼此独立的 caller-resolved Left/Right 与 Alternating READ-only 切片可隔离执行，二者都不拥有抽样、telegraph/entry、room completion 或后续房间 |
| Local Override | `evidence >= cost` 时可进入；可选，不阻塞 Run | shared state 已保留 evidence/Override 跨 occurrence continuity；默认 fragment 尚未到 `LOCAL_RESISTANCE_AVAILABLE`。隔离 Misreader laser fragment 则要求 Override idle 并拒绝其 edge，因为 V4 没有为多 capsule Bézier beam 创作唯一 scar 坐标 |
| Dusk / No Dusk | 达到目标时长或 terminal protocol 后停止新战斗生成 | authority/schedule 切片已有；默认 RUN 未接入 |
| State Snapshot | 无战斗、无 judgement；观察当前 Run | recorder/serializer 切片已有；未接 live RUN |
| Cross-run Material Memory | 先材料，再 ghost，再 witness，最后返还输入 | reducer/storage adapter 有契约测试；未完成端到端 hydrate/replay |

完整 V4 Run 的硬约束是至少 240,000ms、至少进入两个不同房间；Boss 每 Run 最多两个，按房间和行为匹配。Boss 的解法可以是 HP、存活、阅读或世界事实，`HP == 0` 不是全局必要条件。当前 canonical 序章未达到这些完整 Run 条件，因此 handoff 保持 not-ready，不得标记为 Run 完成。浏览器默认使用不合格中性 gaze sample，在 combat drain 后仍停留 `first_eye`，这是显式设备映射缺口，不是完成的交接。

4 个 canonical room 是 `INFORMATION`、`FORCED_ALIGNMENT`、`IN_BETWEEN`、`POLARIZED`。它们是被抽样的精神状态，不对应“一关比一关高级”。难度只调弹体数量、速度、cadence 和 safe gap，不给玩家贴技能等级。

精确 QA `RunComposer` 与 atomic room-transition adapter 尚未接入默认 RUN；历史 mixed encounter envelope 已重命名并隔离为 non-live `EncounterEnvelopeFixture`，没有 canonical event bus 写入口，因此不构成房间抽样或完整 Run 已实现的证据。`LiveRunAdmission` 也不是 composer：完整 Run 入口只接受调用方已经解析完毕的 2–4 rooms、14 项 metric snapshot、每个 occurrence 的 difficulty salt/resolved seed、segments、parallel 决策和三段 Boss，当前任一 pattern capability 缺失都会整体拒绝；即使受理，plan 也固定 `canonicalEventBus:false`、`composer:false`、`executionScheduled:false`。独立的 `admitLiveRoomCapability` 验证 isolated caller-resolved room slice；当前 fixtures 除 POLARIZED pair（hash `0659e91c…ba820`）、singleton POLARIZED Alternating（`36da160c…24131`）与 singleton INFORMATION stale occurrence（hash `7915d5ce…72c24`）外，也锁定 Context Switch、Ballot Shift 与 Left/Right execution fixture；Ballot / Left/Right normalized hashes 为 `fea078a4…cdc2a7` / `b6a1eddf…d1c`。Clock Decree 的 structurally complete singleton hash `43bf1afb…007e2` 则只产生 `unsupported-pattern`，让 direct-kernel authority 与 live admission 保持分离。admission artifacts 仍不写 bus、不组合、不排程，不替玩家选择房间，也不证明 520ms 空间安全重叠或 tier runtime budget。pair 仍可作 admission artifact，但 singleton Alternating executor 在 bus 创建前拒绝 pair，不暗自选择 encounter0。`CanonicalLiveRoomExecutionFragment` 与 `CanonicalAlternatingVerdictReadFragment` 各自只重新验收 exact raw candidate；metric tick960 之后先保留 telegraph+entry 的159 tick elapsed authority，只有 caller-established `S>=1119` 才接到各自内部 shared state。它们彼此独立，都不拥有完整房间、Run handoff 或 scheduler authority。

No-dusk Grid 的 structurally complete singleton 同样只产生 `unsupported-pattern`，exact rejection hash 为 `cc6c9636b2dd90d8b289d1d68fe7048ea1025c5cf01dea27e6912b047c7307b8`；exported live-admission registry 保持 20。这个拒绝保留了 private direct-kernel 行为与 live room 选择/组合/执行之间的空白。

这两个 READ-only 切片都刻意保留 pre-READ 的缺席：telegraph 与 entry 不在 fragment 内执行，也不以伪 segment event、warning、UI 或动画补写；520ms handoff 只作为被校验的标量存在。Left/Right 在 `S+1542`、Alternating 在 `S+1692` 只有在 occurrence 已释放且 run timer 静止时才以内部 neutral frame 关闭，顶层 `roomComplete/handoffReady/runHandoff` 永远为 false。这些空白是被记录的 authority 边界，不是等待通用游戏反馈填满的“缺功能提示”。

Alternating 切片只接受 hash `36da160cd1a63e96a71c6c5978c1d3b73398e177c8b447ef08274c6215824131` 的 `POLARIZED/listen/EASY` singleton：raw seed `0x12345678`、metric tick960/14 项行为快照、salt `0x2200`、resolved seed `0xe9f333c4`、parallel-none selection seed `0x1234ba38` 与六段 `520/800/11600/900/1600/520ms` 都由 hash 锁定。相对 `S>=1119` 的 material settle/rest/residue/fixed close 为 `+1392/+1500/+1683/+1692`；1500-event neutral trace hash 为 `21c28e87ea9bdb9fd2a9777fd8f6cc3392209ae5557ede1b766b6d3bcf36bd3c`。stationary-center/unfocused/graze10/damage1 观察的 digital/live/all/residue/allocated 峰值为 `52/52/83/83/83`，spawn/RNG/omission 为 `150/162/12`；composer listen `maxProjectiles=80/maxEmitters=2` 与 director EASY `maxProjectileBudget=120` 并置显示，但 V4 没有给出 concurrent/residue/cumulative 计数解释，因此不执行 budget gate。它不消费 selection RNG，不拥有 composer、scheduler、parallel、incoming safe-gap、transition、room completion/handoff、weather、persistence、default RUN/session/renderer 或 future-tick authority。

## 3. 禁止的评价语义

以下内容不得进入 Run schedule、存档字段、UI、遥测或结局命名：

- score、high score、rank、grade、leaderboard；
- victory/defeat；
- good ending/bad ending；
- 用击杀数、资源量或单一路线定义“正确玩家”；
- 用天气、可访问性选项、设备性能或手柄型号改变玩法结果。

合法的 Run end 是已提交的事实，例如 `BODY_COLLAPSE`、`PROTOCOL_WITHDRAWAL`、`READING_FAILED`、`STABLE_INTERSECTION` 或 `NO_DUSK_WITHDRAWAL`。Snapshot 可以描述“发生了什么”，不能评价“做得好不好”。

## 4. Behavior Ledger 与 Material Ledger

### 4.1 Behavior Ledger

完整 Run 的 Behavior Ledger 预定保留以下维度：

- `roomTimeMs`：各房间的权威停留时间；
- `flower`：表达/信号强度的行为摘要；
- `gaze`：凝视与 clamp 关系；
- `crack`：规则裂缝的发生事实；
- `override`：局部 Override 的使用事实；
- `contextSwitch`：玩家如何在规则上下文之间切换。

Ledger 只用于抽样权重、witness/world response 和跨 Run 重遇。不得把多个维度压成一个“总分”；不得在 UI 中显示优劣排序。所有记录必须带单位、采样窗口、schema version 和来源事件，避免变成无法解释的数字。当前序章不宣称已生成完整 Behavior Ledger。

### 4.2 Material Ledger

数字动作必须有物质对应，形成双螺旋：

| 数字行为 | 材料事实 | 约束 |
|---|---|---|
| Directional Override | `overrideScar` | 有世界坐标/方向/类型；不是全屏清弹 |
| 玩家倒下 | `deathTrace` | 与 scar 类型严格分离 |
| 长时间/重复暴露 | `burnIn` | 是沉积，不是奖励倍率 |
| 实际移动路线 | ghost route → `ghostResidue` | route duration 取最后一个权威点 |
| Scar 与 ghost 的关系 | witness orientation | 发生在 ghost residue 之后 |

Restore 固定顺序为 `overrideScar → deathTrace → burnIn → actual ghost route → ghostResidue → witness → input return`。Ghost 的 collision、reward、emitter class 都不能偷偷恢复成敌人或奖励源。

当前 route-present Snapshot 与 Restore 只接受 recorder-issued、finalize 时冻结的内存 token；克隆、解析、持久化或篡改后的 record 不拥有 route provenance。Snapshot 在 tick `T/T+50/T+98/T+196` 完成 observe→serialize→present→complete，只有 serialize event 成功 append 后才铸造 exact bus/token/payload/tick-bound receipt；它自己不写 cross-run event。In-memory Archive 只接受该 Snapshot-issued receipt，且 persist tick 必须精确等于 serialize tick；每个 run ID 首次 persist 后冻结，duplicate 不覆盖、不重发，并保留原 recorder token 供独立 Restore 消费。Snapshot complete 或 archive acceptance 都不能单独制造 handoff。numeric seed mapping 仍只是 adapter，不声称等于 V4 reference string `SnapshotRecord`。Restore 的共享 ledger 保证 previous-run/route/next-run 唯一性；route960ms 的 ghost 在 tick52 开始，tick166 先完成再写 residue，tick200 才让 witness 转向，tick252 才归还 input。三者都没有 session boot、renderer、durable storage/IndexedDB、null-route 或 app 持久化接线。

## 5. 战斗语法

- V4 有 48 个 executable pattern：16 ROOM、2 COMMON、3 TRANSITION、3 WEATHER_ECHO、24 BOSS。
- 当前生产 `CanonicalCombatKernel` 可直接执行其中 23 个；exported live-admission capability registry 仍为20，Clock Decree、No-dusk Grid 与 Room Threshold 只在 private direct-kernel tuple。FORCED_ALIGNMENT 因 Ballot Shift 达到 4/4 isolated room capabilities，INFORMATION 保持 3/4，IN_BETWEEN 因 Context Switch 为 1/4，POLARIZED 因 No-dusk Grid 为 4/4，weather echo 2/3，TRANSITION 因 Dusk + Override Void + Room Threshold 为 3/3；4/4 或 3/3 都不代表该房间/过渡已被选择、组合或排程。仅有的执行例外是 caller-resolved Left/Right Gate 与 Alternating Verdict 两个彼此独立的固定 READ-through-rest 切片，它们均不构成 room activation/completion/handoff。Absent Receiver 与 One Sun 是 isolated Boss observe patterns，不改变 room-pattern 分母；Unstable Middle 的 room pattern 也不代表 `boss.two_claims.phase2` 已支持。
- Notification Overflow 让同一数据雨同时受到缺席 lane、上升速度、横向漂移与局部脉冲场影响；更多运动不是奖励或“更高效率”，只让共同偏置变得可观察。被省略的 lane 在 RNG/实体身份前保持为空，越界与 pattern end 只留下 `packet_dust` material residue，不增加通用爆炸、分数或成功反馈。EASY 最后一阵雨晚于 `emit.end` marker 但仍在 pattern duration 内；该 source tension 保留为沉默的 cadence fact，不用 cutoff 或额外提示填满。
- Wind Bias 让 pattern 自己拥有一条固定的局部向量场，真实风天气只能作为平行的表现层事实，不能触发 encounter、消费 gameplay RNG、改写弹体、碰撞或安全背风区。E/N/H 分别只保留 `69/86/101` 个 spawn，空缺来自同一个 swept safe-gap compiler；tick1152 结束后只留下不碰撞的 polished grain，tick1530 排空。它不把“顺风”写成优势、奖励或效率，也不以天气动画补写 authority。
- Rain Packets 借用雨的下落语汇，但真实 RAIN event/seed/RNG 不能触发、生成或改写它。`laneX:[]` 不产生 lateral-wall lane lattice；E/N/H 的 `140/195/225` 个 candidate 各消费一次 pattern RNG，完整 local-vector path 对移动 `rain_lee` 走廊 preflight 后省略 `21/29/39` 个，只有 `119/166/186` 个获得实体身份。被省略者没有数字身体或材料 residue；保留者在 OOB 或 tick1128 pattern end 后只留下无碰撞的 `wet_packet_pulp`，tick1584 排空。EASY 最后一 burst `8885.2ms` 晚于 `emit.end=8700ms`，仍作为沉默的 cadence fact 保留。这个空缺不是优势、奖励、效率或天气对玩家的评价。
- Context Switch 不把 A/B 的相反转向统一成第二套语法。pattern-specific `operator_constraint` 在连续 120Hz path 上定位走廊首次进入，先按声明顺序执行 A 的 literal `linear → turn` 与 B 的 `linear envelope → turn → linear`，再以 endpoint edge snap + signed `±8°` 保留矛盾。全部 candidate 都消费 RNG 并获得 entity identity。E/N/H reference 的 `emission/candidate/intervention/hash` 为 `19/122/104/43c0ccdeed148b1608137f2db353d90fb89a53361a86a0bc4f263007eadcc30d`、`20/169/154/eaee02492d1be50f8df214f226ffe8be568b89b35085e25e3a9fa4ec5657846c`、`20/198/273/4cc95eb7f32cce086ddf5ff8cee009f4602664dfdb346a09a32f81c534578577`；production 的 `candidate=RNG=spawn / OOB / end / redirect(L/R) / hash` 为 `122/75/47/93/49/7cb60b23323a16da617297daec9b3ce437cc1246e56b28f629b3288eff163bb0`、`169/120/49/110/50/99a2e087c38cbdd977766c3c3133d3ae8f3c6682ab7ce61f92fce524c0a9a1fb`、`198/166/32/215/121/b5a55f8da9c3a317289c8d871a1ad31c2a91973e5f8f923f3350496c37cb2855`。EASY 末次 cadence `11398ms` 与 complete 共用 tick1368；canonical phase order 先 materialize identity，再以 `pattern_end` 变为无碰撞 `misregistration_flake`，不发 `collision-on`，tick1746 排空。这些是隔离行为与材料事实，不是 live room/session/renderer。
- Unstable Middle 不把两个 claim 合成一个正确中心。双源 `paired_fan` 均按 literal `op.linear > op.turn_once` 执行：跨过 880ms turn 的 tick 先以旧 heading 完成移动/sweep，再零时长转 `±16°`，下一 tick 才以新 heading 移动。report seed `1610616880` 的 E/N/H `candidate=RNG / omission / spawn / OOB / end` 为 `144/6/138/94/44`、`180/12/168/137/31`、`216/12/204/188/16`；full-lifecycle `events/hash` 为 `1380/2ffd9cd25098d60ff8033812580d73fa7de1b3c2abacf8a2eb0b64ad2cdc0ff0`、`1680/175dd9006058b797fc652d666d14a86aaf79b0add900a57523f63652f65ad44b`、`2040/47990c6f57c3492a9a4b03c311137346c12109e5e574fa112db54b7dacbbb052`，tick1392 complete、tick1807 drain。省略的扇面没有数字身体或余波；保留的 claim 只留下 `seam_filament`，不是胜负、裁决或效率评价。三难度均无 `source_withdrawn`/impact/damage，且 `boss.two_claims.phase2` 仍 unsupported。
- Alternating Verdict 不把交替变成最终裁决。A/B 的 literal `op.linear > op.turn_once` 同样在 crossed tick 先以旧 heading sweep，再做零时长 `+32°/-32°` turn，新 heading 从下一 tick 起生效。angular omission 以 source index → 一次 RNG jitter → 完整声明顺序 swept preflight → identity/spawn 执行；被省略的 wedge 没有 event、数字身体或 `binary_chip`，通过 preflight 后的不可能违例会 fail-stop，不用 `source_withdrawn` 伪造材料。report seed `4224146597` 的 E/N/H `RNG / omission / spawn / OOB / end` 为 `162/12/150/99/51`、`198/15/183/147/36`、`234/15/219/201/18`；full-lifecycle `events/hash` 为 `1500/b7f2b9bca9fd76bce42f245cfd4cae302aec8297c19a836e6b38ad4e46e77a7f`、`1830/25a0fdd4617d491a33aa6fa9502af447dc5e6103582844c16ab9a81fddd22969`、`2190/92a7f8055a6703289bae5e570d7e07583cc5c8c7fbf7ade38c5a3e2b7a9c4c87`，tick1392 complete、tick1683 drain，三难度均无 `source_withdrawn`/impact/damage。这些缺席与 chip 余留是 behavior/material 两端，不是正确选择、奖励或效率。
- One Sun, One Rule phase1 不把唯一法令写成正确答案。它保留 literal `op.turn_once > op.linear`：跨过 780ms turn 的 tick 先转 `+30°`，再沿新 heading 完成 linear sweep，最后才由 continuous `operator_constraint` 处理走廊进入。E/N/H 的 `80/104/120` 个 candidate 全部消费 RNG、获得 identity；约束只移动同一 generation，不制造省略或 `source_withdrawn`。不可变 30Hz reference 的 redirect/hash 为 `24/99fa2c6102afb147af480adddc03e3c788ca91d6e0f1c382709a084557a8f525`、`0/0407cdec6ed371ecd4b66bf651c5c79e7fd515b50767f6b6fa83847bd9781d6a`、`70/50c7dbe48fd84ceba68d56a8515326abfadd48be0db998f9f8407ae1bf7657da`；120Hz production redirect 为 `25/24/72`（HARD `22L/50R`），tick1380 hashes 为 `9053899fdb5c5feba0640d0f3b6af3f994e4102449fbdcea5ce16085a342b6ca`、`038426d85d5245616d296102b190d8bb0d6fcea1f21179ea1d75507d354d46ee`、`6cc6bc61700eb53e2be00e6f790d331975a164b088d73f6307bf0ca18fac933c`。不同采样层的 redirect 数量不宣称 parity；tick1680 排空后只证明 isolated occurrence 静止。pattern 的 `laser.single_decree_sweep` 仍是 family association，observe rig 则精确固定 `encounter.begin → one_sun_one_rule.evidence>=1`、`one_open_half` 与 `laserGeometry:null`；没有 evaluator 将它解释成 phase exit，也不发 resolution/terminal，不执行 phase2/3。
- Ballot Shift 把两个不同周期/duty 的时钟并置，不把其合成一个“正确”时钟。pattern-global 整数 `tick120` XOR 关闭时，同 generation 的速度与碰撞同时停留；开启 tick 先只返回碰撞 lease，身体仍静止且不伤害，下一 tick 才恢复移动。lane `phase_gate` 不删除违反走廊的身体：它保留 RNG、identity、linear motion 与可 Override 的数字位置，仅暂时屏蔽碰撞。因此 Python 30Hz 的 `26/33/55` deletion 只是 QA 对照，不是生产生命周期。E/N/H 保留全部 `170/220/260` 个数字身体，production hashes 为 `4ed653e2…548fb`、`7d15af53…97d3b`、`54c5ddce…763f`；tick1440 完成，无碰撞 `seam_filament` 到 tick1750 排空。双时钟停顿、走廊的短暂空白与纤维余留是同一 behavior/material 的两端，不是评分、成功或效率信号。
- Clock Decree 不把四拍的开/关写成正确节奏。单一 shutter 按 literal `dual_clock_gate → linear` 执行，A/B 双钟在 relative integer `tick120` 上只取 XOR；关闭时保留 generation 并冻结速度/碰撞，开启 tick 只恢复 collision lease，下一 tick 才恢复移动/contact。`quantized_step` 开口沿 480-tick 三角路径来回，cusp-segmented continuous phase mask 只暂时拿走碰撞，不删除身体也不冻结 linear motion。E/N/H 的 `153/216/252` 个 candidate 全部消费 RNG、获得 identity；30Hz deletion `22/33/55` 与120Hz reversible lease不是 lifecycle parity。tick1200 hashes 为 `364c95ce…06e`、`bde5e39e…249ba`、`14962808…5911`，tick1493 residue drain hashes 为 `45074fc1…999c`、`4732a149…bd5`、`ea15a504…ad9f`。HARD 的8次 graze只是见证距离，不造成 damage；EASY 的末次 burst 越过 emit/residue markers 后仍在关闭时钟中保持原位，到 pattern end 才留下 `binary_chip`。这些空拍、遮断与余片不是得分、胜负或优化信号。
- No-dusk Grid 不把两套时钟合成正确答案。两个 emitter 各自拥有 XOR clock；`binary_cross` 的 cusp-segmented continuous phase mask 在 phase-off 时保留同一 identity 与运动、只拿走碰撞，clock-off 才冻结速度和碰撞。E/N/H candidate 为 `133/168/203`；不可变 QA deletion/intervention/hash 为 `13/e587211cb50d6e42a0feab07f08d18520188495314743e53cc2f79c189315bcd`、`18/b2c402fd550d19386c096ca39f3bf40e12f63fb64080e3d4660acbbdfc49b3f6`、`22/9871c0383df928b0c2f8594380e9295a31f88e30f6bbce0b440084a3947eba57`。production tick1464 的 `activeResidue/removed/allocated/peakLive/peakResidue/hash` 为 `119/14/124/90/119/3ddd331ca7e8a6da50fbd6e863743c58c21f1aab2c541be0f69b14e765b8987d`、`148/20/159/129/148/c9023f0f7ea2ab512901db451990f41fb9f07b0cb2aa845762d02af906243e61`、`161/42/189/154/161/e465928f2680f83cb53009da3f1b3895bee873f7bad3db33c792ac3282bcdfa5`；tick1781 drain/handoff-ready hashes 为 `88ba6f54861d98819fae1ee0dba79dae9df1b27d4826b67aacd224b0a17bc1c6`、`aa941a85fd21c0c855d9bcb4a2cf1952ea088dc058d5b6e09ef8ec4b9c06a221`、`3d50e7891159a3ab2d5146270796273c48b56cad8929a950db1e383325dbaf61`。EASY authored `11861ms` 的最后 vertical burst 在 `emit.end` tick1380、`residue.commit` tick1414 后于 tick1424 spawn、tick1429 arm；关闭时钟保留同位置/identity，pattern end 才 cancel。`resolutionHook:"no_dusk_clock_ticks"` 精确验证但 inert，不自动完成、发事件或写 metric。这些中断、保留与余留不是分数、胜负、奖励或效率；该 slice 不拥有 composer/scheduler/selection、READ、session、room completion、Boss/laser/resolution、renderer/default RUN。
- Dusk settle 只让自己的 grid 数字身体按 `1 → 0.42 → 0` linear envelope 停驻，再在 tick984 以 pattern-end cancel 转为无碰撞沉积；E/N/H 各有 `63/84/98` 个候选、RNG、spawn 与 residue，tick1395 才全部排空。四个 mental-room context 不改 trace。`snapshot_capture_ready` 只作为被验证且保持沉默的 source hook 存在：它不触发 snapshot、不取消其他 occurrence，也不证明 live Dusk transition。
- Override Void 不是空白奖励或过关门：4 次 full-360 ring 让 E/N/H 的 `48/64/76` 个数字身体都保留 identity，每个 generation 只在首次 inclusive seam crossing 按方向发生一次 signed `±22px` 错位。linear 移动段与瞬时 offset 段都能被 player contact、moving directional gap 和明示 DirectionalOverride 见证。gap 的 visible rule clip 把数字身体先以 `source_withdrawn` 撤回、再留下 collisionless `override_scar`；若同 tick 同时进入玩家 Void，不重复终止，也不把 rule-clip 位置写进 DirectionalOverride scar。`scar_coordinate_commit` 保持 inert，真实 scar 只是另行显式启动的玩家 Override 周期对实际取消坐标的提交。这个 isolated capability 不判断/消费 `evidence>=overrideCost`，不进入 director/session/composer/scheduler、room transition/event、Snapshot/persistence/handoff、renderer 或默认 RUN，也没有添加 asset、event ID、dependency 或第二套 gameplay language。
- Room Threshold 不把门槛变成过关判定。departing line 以 `1→0.55` 速度 envelope 减速，arriving fan 以 `0.55→1` 加速；独立正弦 `threshold_bridge` 只可逆拿走 collision，同一 generation 的运动、RNG 与 identity 继续。E/N/H 的 `61/78/89` 个 candidate 全部成为数字身体；tick936 pattern complete 后只留下 `threshold_sediment`，tick1265 才排空。QA hashes 为 `46f93363…c8e` / `0c483797…c8c` / `7f2600cf…7aff`，production/full hashes 为 `36e3b5c5…a6ae` / `dc6a4490…825b`、`92d7ea69…07d5` / `ebba622f…168b9`、`c48b285b…d9e59` / `f63a5bc9…5e072`。这些速度交接、碰撞缺席与沉积是同一 digital/material behavior，不是正确方向、成功、分数或效率。该 isolated capability 没有 hook/laser，不进入 atomic room-transition、composer/scheduler、session、room completion/handoff、renderer 或默认 RUN。
- Crack fall loop 让所有实体从 seam 出发，在第一个移动 tick 以一次 generation-owned mirror 保留不连续面两侧。安全走廊的连续进入、player/graze 与 Override 共用同一有序 path；oracle-derived edge snap 和 signed `±8°` 只是显式 adapter。E/N/H 分别保留 `90/120/140` 个实体，tick1320 转 filament，tick1782 排空；这不是选中缝隙、奖励或效率评价。
- stale-packet、hard-cut、Absent Receiver、signed lateral wall 与 visible rule clip 的既有行为不变。不可变 Python、30Hz declared 与 120Hz production evidence 分层保存。默认 RUN 只运行 `common.eye_acquisition`；Pattern Lab 的 48-pattern 可见性不等于生产 authority，尚余 25 个未接入。bus-free admission 除既有 caller-resolved POLARIZED pair 与 singleton stale occurrence 外，现在也可验证 singleton Alternating、Rain parallel member、Context Switch/Ballot Shift room capabilities 与 Left/Right fixture；Clock 与 No-dusk Grid singleton 分别以 `43bf1afb…007e2`、`cc6c9636b2dd90d8b289d1d68fe7048ea1025c5cf01dea27e6912b047c7307b8` 保持 exact rejection。Room Threshold 只扩大 private direct transition coverage，不是 room-admission candidate。所有 admission artifact 仍是 no-bus/no-composer/no-execution，exported registry 仍为20。POLARIZED pair/singleton hashes 为 `0659e91c…ba820` / `36da160c…24131`；pair 仍可 admission，但 Alternating singleton executor 在 bus 前拒绝它。Left/Right 与 Alternating 的独立 READ adapters 重新验收后才创建各自的 bus，但都不等于被选择、排程或完成的 room/Run，完整 Run plan 仍被拒绝。
- `CanonicalRunCombatState` 将数字身体与材料余波分开观察：`digitalBodiesDrained` 只表示 collider 排空，`materialResidueDraining` 保留无碰撞 residue，`projectileLifecycleDrained` 才允许 occurrence 请求释放；run-owned player recovery/respawn/Override deadline 另由 `runTimedStateQuiescent` 判断，并可在 released kernel 之后继续。shared identity 是 UTF-8 byte-length-prefixed、一次性 occurrence；当前只允许一个 spawning occurrence，不代表 parallel room execution。
- First Eye 的 gaze 是 device-neutral authority sample，不是画面注视效果。连续 60 `tick120` 合格输入提交 clamp，54 `tick120` 失配延迟提交 release；clamp 把 Flower 强制为 `0.1`。Eye 帧只投影已提交状态：`idle/reveal`、`acquiring/acquire`、`clamped|release-delay/read`。
- 8 个 Boss 各 3 phase：`observe → enforce → fail_to_totalize`；另有 8 种 laser geometry。当前 4/8 rigs、4/24 Boss patterns——`boss.absent_receiver.phase1`、`boss.misreader.phase1`、`boss.one_sun_one_rule.phase1` 与 `boss.unanswering_feed.phase1`——仅因各自 rig 的 `observe` phase 明示 `laserGeometry: null` 才进入生产 pattern kernel；通用/live active-laser phases 仍未接入，`boss.two_claims.phase2` 仍明确 unsupported。Absent Receiver 的 rig exit 写 `absent_receiver.evidence>=1`，pattern hook 写 `absent_receiver.phaseEvidence>=1`；One Sun 的 rig exit 写 `one_sun_one_rule.evidence>=1`，pattern hook 写 `one_sun_one_rule.phaseEvidence>=1`。当前没有 evaluator 消解这些条件，所以 isolated drain 不发 `boss.phase.*`、laser、resolution 或 terminal event。独立 `CanonicalMisreaderEnforceEntryFragment` 只在单测中组合 `observe → enforce` 与一次 manifest-bound laser start：`S+151` collision-on，`S+152` 才允许首个 swept contact，接触每 generation 至多一次且只伤害玩家，不发 `projectile.impact.commit`，beam 继续到 `S+264/+286/+366` 自然 shutdown/residue/cleanup。16 个 capsule 是 adaptive-flattening adapter 结果，不是 V4 创作数量；phase entry 依赖显式 caller assertion，因为尚无 phase-evidence evaluator。该 fragment 不执行 phase-2 projectile emitters，不接 session/room/renderer，因此不计入 23/48 direct-kernel combat coverage。Boss/laser/player proposal 已以 exact draft-group receipt 实现窄范围 append→after-state 绑定，但这不是通用 rollback transaction。
- 弹体必须有显式 `spawn → arm → flight → impact/cancel → residue → cleanup`；flight 属于实体，不按视觉动画固定超时结束。
- Graze 的唯一键是 projectile instance、generation 和 player；同一代弹体对同一玩家最多授予一次 evidence。
- Safe gap 与 exact warning 是玩法契约，不是装饰。视觉关闭、闪烁关闭或降帧不能改变安全路径。
- Directional Override 消耗 evidence，只在玩家前方局部扇区撕开规则；它不提供全局无敌。数字结果是 local-rule-tear，材料结果是带类型和坐标的 scar。若对象像 Misreader Bézier beam 一样没有被创作的单一 scar 坐标，adapter 必须保留这个缺席并拒绝 Override，不能猜坐标。
- Weather/background 可以反馈世界状态，但 presentation 不能反向产生碰撞或 RNG。

## 6. 输入设计

| 行为 | 键盘 | 标准映射手柄 | 设计语义 |
|---|---|---|---|
| 移动 | WASD / 方向键 | 左摇杆 / D-pad | 连续身体事实 |
| 表达/射击 | Z | Button 0（A/Cross） | 不是“确认正确答案” |
| 局部 Override | X | Button 1（B/Circle） | edge-triggered，消耗 evidence |
| Focus | Shift | Button 4/5（LB/RB） | 精细移动与读取 |
| Pause | Space | Button 9（Start/Options） | 冻结 gameplay clock |

实现基线是浏览器原生 Gamepad API、0.18 径向死区、D-pad/摇杆择强、热插拔、断开回退和可用时的 dual-rumble。触觉是反馈 sink：不支持振动、权限拒绝或手柄断开都不能改变事件 trace。浏览器“standard mapping”以外的设备在 P1 通过显式 remap profile 支持，不能靠猜测按钮布局。

触摸/指针按住拖动是平台替代输入。所有来源先归一成同一个按 tick `InputFrame`，回放只保存归一化事实和必要 edge，不保存设备品牌。

## 7. PWA 与离线语义

PWA 不是包装层，而是可复现运行环境：

- manifest 提供 standalone、192/512 `any` 和 512 `maskable` 图标；
- shortcut 显式进入 `?mode=pattern-lab`，默认 `/` 面向 RUN；
- 核心脚本、V4 数据、必要图集/音频必须在发布版本可离线复现；
- service worker 更新只能在安全边界提示/切换，不得在 Run 中途混用 content digest；
- 离线与在线使用同一 seed/输入时必须产生同一 trace；
- IndexedDB 存档必须绑定 content digest，迁移失败时保留可导出的原记录。

现有 PWA 图标、manifest 与预缓存是基础；更新事务、存档迁移和自动离线回归仍是 P1。

## 8. 可访问性

Reduced Motion、Flash-Off 和 Full 是正交投影配置。必须满足：同事件 ID、同 simulation tick、同 payload、同顺序。可采用静态替代帧、轮廓、音频 fallback 或触觉 fallback，但不能改变 Boss timing、弹速、碰撞、RNG 和 input return tick。

教学也遵循信息边界：教程可以说明输入，不得提前揭露尚未由玩家行为发现的因果关系。

任何 V4 外的玩法、素材、文案或图标扩展，先执行 [CONTENT_EXTENSION_ZH.md](./CONTENT_EXTENSION_ZH.md) 的 aaajiao Extension ADR；不得以“内容更多”为理由直接进入产品。
