# v4 音频设计总纲：余白的声音

> 状态：**v4 音频的权威设计与发布验收规范**
>
> 适用范围：项目自有 `packs/v4` 的 13 首 BGM、25 个 SFX（共 38 个音频文件）、菜单听觉体验，以及它们在通用 WebAudio 运行时上的回退

本文回答“v4 应该听起来怎样、何时必须响、怎样才算可以发布”。通用注册、
pack 格式和 WebAudio 行为见 [`audio.md`](./audio.md)；人物、弹幕和场景的
视觉语法见 [`v4-art-direction.md`](./v4-art-direction.md)。三者冲突时，机制
由通用文档决定，v4 的声音身份与验收由本文决定。

本文**不是对当前合成占位符的描写**。运行时合成是保证游戏永不因文件缺失
而失声的 emergency floor；`packs/v4` 中可发布、可审听、可追溯的音频文件
才是 v4 的正式声音。

---

## 1. 核心命题

v4 的声音不是给画面铺满一层“氛围”，而是让玩家听到余白如何被身体切开：
稳定的场被拿走一部分，骨相露出节拍，菌丝沿行为生长，心脏只在真正重要的
时刻发热。声音与 Ghost 身体共用四层语法：

| Ghost 层 | 听觉职责 | 可以使用 | 禁止 |
|---|---|---|---|
| `surface` 外表 | 关卡身份和持续空间 | 低频底色、窄带和声、缓慢呼吸 | 全频 pad、持续轰鸣、把所有空隙填满 |
| `skeleton` 骨相 | 可预测的时间秩序 | 固定网格、干燥脉冲、短促骨节音 | 不断加速的随机打击、伪装成弹点的高频时钟 |
| `mycelium` 菌丝 | 行为留下的连接 | 稀疏分枝尾音、窄带滑移、局部错位 | 白噪声墙、连续 glitch preset、装饰性碎拍 |
| `heart` 心脏 | 唯一温度和叙事重音 | 可记忆动机、低频搏动、Boss/死亡重击 | 每拍都“史诗化”、持续占用最高响度 |

四层不是四条必须同时播放的 stem。任何时刻最多保留 **3 个功能层**；能删一层
仍成立，就删掉它。这是“做减法”的工程约束。

### 方法来源与原创边界

方法论参考池田亮司对声音本体、数学结构与感知边界的长期研究，而不是模仿某一
首录音或装置的听感。其[艺术家官网简介](https://www.ryojiikeda.com/biography/)
强调以数学精度处理声音与光；
[`test pattern`](https://www.ryojiikeda.com/project/testpattern/) 将数据转换为
严格结构并考察设备与人的感知阈值；池田与 Carsten Nicolai 在
[MoMA 访谈](https://www.moma.org/explore/inside_out/2013/10/01/an-interview-with-cyclo-ryoji-ikeda-and-carsten-nicolai/)
中把有限声材描述为可被不同“语法”组织的声音字母；
[`matrix`](https://www.ryojiikeda.com/project/matrix/) 则把纯音、噪声和空间
关系作为作曲材料。v4 从这些来源只取三项原则：**数学精度、玩法数据映射、
由静默产生的负空间**。

最终声音必须是项目原创：不采样池田作品，不复刻其具体动机、频率序列、节奏
排列、波形轨迹或作品结构，也不以“像某一首作品”为验收目标。四关的输入数据
来自 v4 自己的场景、Boss 动作和弹幕语法；相同的基础声材只有在这些原创规则下
才被组织成 v4 的音乐。

### Internet Void：先给行为留位置

音乐必须主动让出 **1.5–3kHz**。这个频段属于擦弹、破卡和菜单导航等玩家行为，
而不是世界观内容。旋律主要落在 **300–1000Hz**；玩家不是在一首完整歌曲上
叠加操作，而是用自己的操作补全音乐故意留下的部分。

### 入神与出神不是强弱档

- **入神 `absorption`**：稳定音高、可预测网格、短包络、可完成的循环。玩家能
  把节拍内化，用它穿过弹幕。
- **出神 `trance`**：保留同一个动机身份，但移除脉冲地板，以离调、宽包络和
  稀疏空位让时间失去抓手。

出神不是“更响、更快、更多层”。若只靠增加密度区分两者，设计失败。

---

## 2. 菜单必须有声音

菜单无 BGM、导航无反馈或首次确认被浏览器解锁吞掉，任何一项都属于
**release blocker**：

- TITLE 与 SELECT 持续播放 `menu`；页面切换不重启同一首曲。
- PAUSE 不切成静音：保留当前关卡/Boss 曲并 duck，同时播放 `ui-pause`；
  RESUME 平滑恢复。
- 结局使用 `adjourn`，不是回到无声 shell。
- 浏览器允许首次输入前保持静音；第一次成功解锁后，触发解锁的语义音不能
  丢失，BGM 必须随即进入。
- 五种 UI 声音缺一不可：`ui-move`（移动）、`ui-confirm`（确认）、
  `ui-cancel`（返回）、`ui-pause`（暂停）、`ui-advance`（对白翻页）。
  它们必须能仅凭声音区分，不能是一份 click 换五个文件名。

听觉方向统一为“冷、短、干、近”：move 是最薄的骨节；confirm 上行并闭合；
cancel 下行并退出；pause 是低位钝点；advance 是一条极短菌丝。UI 可以借用
1.5–3kHz 的负空间，但所有 UI 峰值仍低于 graze。

---

## 3. 13 首曲目的场景与叙事映射

13 个运行名是 v4 的固定叙事曲线。时长是正式循环区域的目标；允许在循环前
加一次性 intro，但不得用 intro 掩盖一个无法自洽的 loop。

| Track | 场景 / 消费者 | 姿态 | Intro | Loop | 叙事与 Ghost 层 |
|---|---|---:|---:|---:|---|
| `menu` | TITLE、SELECT、shell fallback | 入神 | — | 16s | 尚未显影的外表；低场上有一条可记住、会落回静默的菌丝 hook |
| `vigil` | stage-1 / `expanse` | 入神 | — | 16s | 开放余白；surface 最宽，心核以“信标—回答”出现 |
| `descent` | stage-2 / `undertow` | 入神 | — | 12s | 纵向下沉；骨相脉冲明确，旋律留一个下坠空洞 |
| `precedent` | stage-3 / `stratum` | 入神 | — | 16s | 记录与沉积；短骨节逐层累积成不可撤销的 ostinato |
| `ordinance` | stage-4 / `vault` | 入神 | — | 14s | 空间闭合；动机咬住自身尾部，循环不完成终止式 |
| `nemesis` | Sentinel / stage-1 Boss | 入神 | 1.50s | 14s | 首次清楚陈述四音“制度 cell”，心脏身份锚点 |
| `interdict` | Warden / midboss | 入神 | 1.25s | 8s | cell 被截成两音；短、干、像骨闩突然合上 |
| `docket` | Magistrate / stage-2 Boss | 入神 | 1.75s | 16s | cell 倒影下行；裁决由“回答”替代新主题 |
| `sanction` | Chancellor / stage-3 Boss | 入神 | 1.60s | 16s | 降二级使 cell 变暗；surface 被抽走，菌丝开始越界 |
| `interregnum` | Regent / stage-4 final | 入神 | 2.00s | 16s | cell 最完整、心核最热；仍受三层上限约束，不靠堆叠终局化 |
| `zenith` | Sentinel Lunatic 第四符 | 出神 | — | 13s | `nemesis` 的 cell 失去脉冲地板，以离调漂浮 |
| `fiat` | Chancellor / Regent Lunatic 终符 | 出神 | — | 17s | `sanction`/`interregnum` 的身份溶解，不给玩家稳定落脚点 |
| `adjourn` | ending | 出神 / come-down | — | 24s | 全游戏唯一完整终止式；身体退出后，菌丝最后一次回收 |

Boss 曲之间必须听得出同一个 cell 的变形；stage 曲之间必须听得出空间从开放、
下沉、沉积到封闭。不能交付 13 首互不相关的“暗氛围”，也不能只靠换 root
冒充叙事映射。

五首 Boss 曲的 intro 是一次性身份断层：从文件 0 秒播放一次，随后只循环
`[loopStart, loopEnd)`，不能在每轮 loop 重播。五段 intro 分别使用邻频轨道、
不等距四闩、三段下行裁决、记录被双重盖印截断、以及把前四种语法依次回收的
四面板结构。intro 负责登场首秒可辨；intro 结束后的 loop 仍必须独立成立，
禁止用一段显眼开场掩盖五个同质循环。

运行时以 `boss-arriving` 作为同一个听觉起点：它在 Boss 实际生成、飞入开始的
首个可见 tick 同时触发专属入场 cue 和 Boss 曲 intro。Boss 音乐只用 `0.16s`
淡入；若 URL 尚在下载或解码，重试仍保留这次短淡入，不能退回普通 `1s`
crossfade 吞掉开场。`boss-entered` 只表示落位并故意无声，首张卡的
`boss-phase` 独占 `declare`，两者不得再在同一 tick 互相遮蔽。为避免冷缓存
把实际出声拖到画面之后，首次音频解锁会预热这五首 Boss 曲但不启动播放。

每首曲还必须拥有独立的时间/频谱 `architecture`，这比 root、mode 和 motif
更直接地决定“这一关怎样占据余白”：

- 四关依次为 `open-signal`（远距信标与大段呼吸）、
  `descending-corridor`（下行扫描与二进制门控）、
  `accreted-record`（分层累积后清空）和
  `closing-vault`（低频闭合、尾咬式不终止）。
- 五位 Boss 依次为 `sentinel-orbit`（相邻频率拍动与对称守望）、
  `warden-latch`（双闩短句）、`magistrate-scan`（裁决式下行扫描）、
  `chancellor-seal`（盖章重音与硬切）和
  `regent-recapitulation`（回收前四种语法但不堆满）。循环本体分别以
  邻频持续、双击后静默、相位连续的下行滑音、短促倍频印记、宽三音区冠冕
  组织共同 cell；共有 lead 不能再压过这些身份层。

architecture 是单声道内部的包络、密度、频谱、干涉与静默组织，不宣称当前
播放引擎具有位置音频。即使移调到同一个 root，四关和五位 Boss 仍应仅凭结构
被区分；否则仍是同一首曲换参数。

---

## 4. 25 个 SFX 的功能层级

下表的 peak 是将文件、manifest `volume` 和 SFX bus 合并后的 **effective
peak**。范围是目标窗口，不是要求所有声音贴着上限。新增十项的单点值是当前
release spec 的 `targetPeak × volume`，属于 authored target；在解码测量完成前
不得写成实测峰值。

| Sound | 功能 / Ghost 层 | 目标时长 | Effective peak |
|---|---|---:|---:|
| `death` | 玩家死亡；心脏被拿走，全局最高优先级 | 0.50–1.00s | 0.55–0.80 |
| `explosion` | 敌人死亡、Boss 死亡、Bomb 的质量释放 | 0.30–0.70s | 0.35–0.55 |
| `toll` | Sentinel 入场；guest/未映射 Boss 的兼容回退 | 0.35–0.90s | 0.24–0.38 |
| `boss-enter-warden` | Warden 入场；双段闩锁，短、干、突然闭合 | 0.48s | 0.3120 target |
| `boss-enter-magistrate` | Magistrate 入场；扫描、校验、下坠裁决 | 0.70s | 0.3186 target |
| `boss-enter-chancellor` | Chancellor 入场；记录脉冲后落下一枚重印 | 0.76s | 0.3248 target |
| `boss-enter-regent` | Regent 入场；前序规则被回收并最终闭合 | 0.90s | 0.3420 target |
| `break` | 非最终符卡破裂；骨相断开，短而亮 | 0.12–0.30s | 0.17–0.25 |
| `declare` | 符卡声明；骨节闭合，不冒充爆炸 | 0.18–0.45s | 0.17–0.25 |
| `hit` | 命中；最小可重复的接触证据 | 0.04–0.14s | 0.14–0.21 |
| `clear` | 关卡完成；菌丝回收并向上解决 | 0.20–0.60s | 0.13–0.21 |
| `pickup` | 拾取/extend；外表吸收一个小亮点 | 0.08–0.25s | 0.12–0.19 |
| `power-up-1` | 跨入 Tier 1；一次短上行代码，不等于普通拾取 | 0.18s | 0.1824 target |
| `power-up-2` | 跨入 Tier 2；同一家族的二级完成式 | 0.23s | 0.1927 target |
| `power-up-3` | 跨入 Tier 3；同一家族的最高级闭合 | 0.29s | 0.2024 target |
| `shot` | Tier 0 持续射击；干燥骨针，不成为背景 drone | 0.035–0.10s | 0.08–0.15 |
| `shot-tier-1` | Tier 1 持续射击；改变内部脉冲语法，不靠增益升级 | 0.060s | 0.1450 target |
| `shot-tier-2` | Tier 2 持续射击；再增加结构分辨率，保持近似等响 | 0.065s | 0.1456 target |
| `shot-tier-3` | Tier 3 持续射击；最完整声纹，仍不得形成 drone | 0.070s | 0.1458 target |
| `graze` | 玩家占据余白；行为频段的轻擦丝 | 0.06–0.18s | 0.05–0.09 |
| `ui-confirm` | 确认；短上行并闭合 | 0.035–0.09s | 0.04–0.075 |
| `ui-cancel` | 返回；短下行并撤出 | 0.035–0.09s | 0.04–0.075 |
| `ui-move` | 选择移动；最薄骨节 | 0.015–0.05s | 0.035–0.070 |
| `ui-advance` | 对白翻页；极短菌丝 | 0.02–0.07s | 0.035–0.070 |
| `ui-pause` | 暂停；低位钝点 | 0.04–0.12s | 0.035–0.070 |

硬性响度顺序为：

`death > explosion > boss-enter-* / toll > break/declare > power-up-* > hit/clear/pickup > shot-tier-* / shot > graze > ui-*`

同一层内部可以按语义微调，但不能跨层。polyphony 与 throttle 必须跟随事件
频率：death、toll、全部 boss-enter-*、power-up 与 clear 单声部；四档 shot、hit、
graze 有界并发且限频；UI 最多双声部，按住方向不能形成蜂鸣。四档 shot 的
强弱来自 pulse grammar 与 spectrum；正式 WAV 的 effective peak 为
0.1450–0.1500、档间 spread 小于 0.75dB，禁止把等级写成音量阶梯。

---

## 5. 可机测的发布门槛

测量统一在 decode 后进行。`effective sample = decoded sample × manifest
volume × bus master`；dB 值使用 `20 log10(linear)`。测试应从 pack 文件本身
读取，不能只测 fallback synth。

### 5.1 文件与信号

- mono、PCM16 WAV 或可重复编码的 Ogg；采样率只允许 22050、44100 或
  48000Hz。所有浏览器目标必须能 decode。
- 任意 decoded sample 的绝对值 `< 1`；raw peak 在 `0.20–0.80`，不给一个
  几乎无声的文件再靠 manifest 极端增益补救。
- DC offset 的绝对均值 `≤ 0.005`。SFX 首尾必须有 ≥2ms attack/release；
  首末样本绝对值 `≤ 0.01`。
- BGM effective RMS 在 `0.025–0.075`。玩家持续反馈仍在其上：
  `shot effective peak / loudest BGM effective RMS ≥ 7dB`。
- SFX 的 effective peak 必须落在 §4 的窗口并满足完整层级；不得有 NaN、
  Infinity、clipping 或零长度 buffer。

### 5.2 负空间与可听旋律

- 所有入神曲及 `menu` 的 1.5–3kHz 能量占比 `≤ 6%`；出神曲 `≤ 8%`。
- `graze`、`ui-move`、`ui-confirm`、`ui-cancel` 各自至少 `50%` 能量位于
  1.5–3kHz。
- 三个菜单导航音的 effective peak 各自至少高于 `menu` effective RMS
  **3dB**，同时仍低于 `graze`。
- 每首曲 300–1000Hz 的 decoded RMS `≥ 0.025`，且占全带 RMS 的比例
  `≥ 0.34`。入神曲至少一半网格槽实际发声，但结尾必须留出呼吸；出神曲免除
  密度下限，不免除可听性下限。
- 五首 Boss intro 必须各为 `1–2s`，intro 的八段×六频带粗粒度指纹任意两首
  RMS 距离 `≥ 0.35`。五个 loop 去掉 intro 后，任意一对必须在九频带谱相关
  `≤ 0.90` 或十六段时间包络相关 `≤ 0.85` 中至少满足一项；共同 cell 允许，
  共同宏观轮廓不允许。
- Warden、Chancellor、Regent 的入场 cue 以 100ms 窗、120–4000Hz 测量：
  最大 effective RMS 至少高于 `declare` **1.5dB**、高于各自 Boss BGM
  **2dB**；全 cue effective RMS 不低于 `declare` 的 95%，且至少 85% 能量
  位于该普通扬声器可听带。peak 层级仍同时适用，不能用一个孤立尖峰过关。

### 5.3 循环与清单

- 在声明的 `loopStart/loopEnd` 上，首尾样本跳变 `≤ 0.02`；循环五次无新增
  click。loop 区间必须在 decoded duration 内且 `start < end`。
- §3 的 loop 时长允许 ±5%；文件总长为 `intro + loop`，manifest 必须把
  `loopStart` 放在 intro 末端、`loopEnd` 放在文件末端。每个 Boss 入神循环
  应在对应战斗中至少完成一次。
- manifest 恰好覆盖 13 个 BGM 与 25 个 SFX，即 **38 个音频文件**：无缺失
  路径、无孤儿音频、无重复路径偷换语义。生成测试逐个 fetch、hash、decode
  并核对名称。
- 相同生成器、参数和工具版本必须产出相同 bytes；改变 bytes 必须同时改变
  pack manifest hash/版本和测量基线。

---

## 6. 来源与发布资产治理

正式目录为：

```text
packs/v4/audio/music/<track>.wav
packs/v4/audio/sfx/<sound>.wav
```

这些文件和 `pack.json` 都由 `tools/make-v4-pack.ts` 的生成链拥有，不手改生成
输出。每批音频必须能回答：作者/生成器、日期、参数或可编辑工程、许可、源
文件 hash、导出工具版本。项目自制或项目生成资产在生成器与 pack README
记录；任何第三方资产先证明允许再分发，并在同一 commit 更新 `NOTICE`。
来源不明的文件不进入仓库。

### Fallback 与 release asset 的关系

- `src/audio/` 提供通用合成与播放引擎，`src/v4/audio/` 拥有 13 首曲目和
  10 个 edition-specific SFX 的 fallback 定义：冷启动、404、decode 失败
  时仍给玩家可用反馈；它们都不冒充 v4 的最终发布母版。
- `packs/v4/audio/` 是正式 v4：正常启动必须优先使用它，并保留 registry 已
  定义的 volume/polyphony/throttle 与音乐 synth floor。
- 强制 404/decode 失败的测试应证明 fallback 可响；正常 v4 验收若落到
  fallback，仍判发布失败。**“没有静音”不等于“v4 音频已完成”。**

---

## 7. 人工听测门槛

自动测试证明接线、频谱和电平；以下项目只能由听测签字：

1. 冷启动从无权限状态进入 TITLE：第一次确认音不丢，解锁成功后 250ms 内
   `menu` 进入；TITLE/SELECT 往返没有无声页或同曲重启。
2. 不看屏幕随机播放 `ui-move` / `ui-confirm` / `ui-cancel`，10 次至少辨对
   8 次；pause 与 advance 在各自场景不被误认为前三者。
3. 笔记本扬声器与普通耳机各听一次：不改系统音量即可同时听出 `menu` 的
   hook 与导航；PAUSE duck 明显但不是静音。
4. 每首 stage 曲进入实战至少 60 秒；密集弹幕下 shot/graze 仍清楚，音乐
   不盖危险。盲听 15 秒能把 `open-signal`、`descending-corridor`、
   `accreted-record`、`closing-vault` 对应回四关，而不只说出根音不同。
5. 按 §3 顺序走完 Boss cell：不看画面只听五段一次性 intro，应能指出轨道、
   闩锁、裁决、盖印、回收五种动作；各跳过 intro 再盲听 15 秒 loop，仍能
   分辨五位 Boss。随后在 Lunatic 听 `zenith`、`fiat`，听者能指出入神
   “有地板”、出神“地板被抽走”，而不是只听到后者更吵。
6. 不看画面随机播放 `toll` 与四个 `boss-enter-*`，笔记本扬声器与普通耳机
   上都能辨认 Sentinel、Warden、Magistrate、Chancellor、Regent；guest Boss
   仍安全回退到 `toll`。
7. 连续射击四档各听一段，`shot`（Tier 0）与 `shot-tier-1..3` 在近似等响下
   仍可辨；三次实际跨级各只触发对应 `power-up-1..3` 一次，普通 pickup 不
   冒充升级。
8. 每个 loop 连续五次、每次跨场景 cross-fade、PAUSE/RESUME、反复菜单输入
   都无 click、爆音、长于 250ms 的非授权静默或失控叠音。
9. 结束画面确实进入 `adjourn`，且其终止感只在游戏结束出现。

通过条件是：机测全部绿，浏览器实际加载正式 pack 文件，人工听测九项全部
签字。任一菜单无 BGM/无 UI 音、正式文件未加载、或只能听到 fallback，均不
得以“后续补音频”放行。
