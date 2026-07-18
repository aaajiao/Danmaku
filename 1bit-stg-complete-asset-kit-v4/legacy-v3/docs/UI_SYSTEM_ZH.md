# 1BIT STG v3 — UI / HUD 系统说明

## 1. 界面不是外壳

这套 UI 的核心不是“像素风控件”，而是把游戏中的治理过程压成可读的元数据：

`光强 → 被看见 → 被压暗 → 擦边成为证据 → 局部改写 → scar → 下一局条件`

因此，界面只显示会改变判断、动作或记忆的东西。Gameplay HUD 不显示分数、连击、传统生命数；结算不显示 Rank；失败不使用 “GAME OVER”。状态快照是一份非评判性行为记录。

所谓“抽象的日式”也不靠鸟居、家纹、日文假名或像素 RPG 怀旧符号。它来自：

- 掌机式 `360 × 640` 小画幅与 4 px 节拍；
- 中文主信息、英文小注的克制双语层级；
- 非对称构图、局部框线与大块留白；
- 菜单动作前后的短停顿；
- 冷静、略带温度但不解释过量的文案；
- 以“这一动作会带来什么”代替“这个图标代表什么”。

## 2. 固定生产规格

| 项目 | 规格 |
|---|---|
| 逻辑画布 | `360 × 640` |
| 排版网格 | 4 px；细线可落在奇数像素保持 1 px 清晰度 |
| 安全区 | `x=12, y=8, w=336, h=620` |
| 运行缩放 | 只允许整数倍 nearest；其余空间 letterbox |
| UI 图集 | `512 × 512`，`8 × 8`，单格 `64 × 64` |
| Alpha | 仅 `0 / 255` |
| 字体 | Noto Sans SC Variable，OFL 1.1 |
| 普通 HUD | `ink + paper + gray + 当前房间色` |
| Magenta | 只用于 Override 阈值、scar 与跨局交接瞬间 |

UI atlas 与 gameplay 的 `128 × 128` cell atlas 分开。界面线段、按钮、指示器需要更小的 `64 × 64` cell，强行混用会浪费纹理并放大布局误差。

## 3. HUD

### 3.1 Gameplay HUD

四个读数分别贴近四个边缘，中间保持空：

- 左上：`光 / LIGHT`，8 段，绑定 `player.lightIntensity`。
- 右上：`凝视 / GAZE`，6 段纵向，绑定 `player.gazePressure`。
- 左下：当前房间英文 ID 与中文名称。
- 右下：`改写 / OVERRIDE`，8 段，绑定 `player.overrideCharge`。

光强和凝视不能合并成一个“能量条”。Focus 是主动、缓慢、可逆的收拢；Eye clamp 是突然、强迫、有恢复延迟的压暗。即便两者最终都降低亮度，HUD 也必须保留两个来源。

HUD 不使用完整黑底面板。它靠空缺和边缘定位工作；在 240 枚弹体压力下，中部仍全部留给判断。

### 3.2 Boss HUD

Boss 完整度使用一把断开的横向尺，而不是血条容器。断口承担两层意义：Boss 的负空间拓扑，以及可被 scar 破坏的系统连续性。

- 名称：左中文、右英文。
- 完整度：`x=18..342, y=72`；当前值为房间色，剩余为灰；中间保留 18 px Void。
- 阶段：四个离散 tick；不用圆形 phase icon。
- Boss UI 不增加头像、徽章、金属边或放射纹。

## 4. 完整页面

| 页面 | 文件 | 功能 |
|---|---|---|
| Gameplay HUD | `01-gameplay-hud.png` | 四个边缘状态，中央无面板 |
| Boss HUD | `02-boss-hud.png` | 名称、断尺、阶段与真实压力场 |
| 标题 | `03-title.png` | 偏心花核／空缺，不用完整标志圆 |
| 暂停 | `04-pause.png` | 二值 veil；场仍存在，只停止输入 |
| 设置 | `05-settings.png` | 可读性、声音、输入；方形开关 |
| 继续 | `06-continue.png` | 先展示上一局会带来什么，再确认 |
| 失败 | `07-failure.png` | 数字体消失，物质残留多停一拍 |
| 教程行为图 | `08-tutorial-behavior-map.png` | 由输入到后果的因果链 |
| 状态快照 | `09-state-snapshot.png` | 指纹、指标、观察与事实标签 |
| 跨局衔接 | `10-cross-run-transition.png` | scar、ghost、witness、交还输入 |

### 4.1 标题

标题 mark 是偏心 SELF 的放大版：四块不完整材料围住一个偏移核心，右上缺口不闭合。四种房间色以互不连接的短线进入页面，不组成阵营徽章。

菜单只有三项。默认选择只用一根竖线、一段下划线和一个小方孔确认，不使用发光按钮。

### 4.2 暂停

暂停遮罩是硬阈值棋盘 veil，不是半透明毛玻璃。背景仍然可被读到，支持文案“画面没有停止。只有输入停下。”右上 mini fingerprint 让暂停页与本局行为保持联系。

### 4.3 设置

所有开关使用矩形轨道和实心方块；音量为离散 8 段。可读性设置必须在进入游戏前可见：

- Reduce Flash：Override 不做高频反转，改为一次局部切换。
- Reduced Motion：跨局动画收束成一个最终合成帧。
- High Contrast：危险外轮廓增加 1 px paper 边。
- Void Notch +：弹体方向缺口从 2 px 放大到 3–4 px，不改变 hitbox。

### 4.4 Continue 与失败

Continue 的首要问题不是“是否读取存档”，而是“上一局会以什么形式进入下一局”。页面必须列出 scar 坐标、ghost 是否只播放一次、witness 记住了什么。

失败页先显示物质沉积，再给出一条观察。观察只能描述发生过的行为，不得推断玩家人格：

- 可以：“你在完全被看见之前改写了规则。”
- 不可以：“你是一个勇敢的反抗者。”

## 5. 教程是行为图

教程页面的六个节点是一个不可跳步的因果链：

```text
Z 发出信号
  → 光强上升 / 系统刷新加快
SHIFT Focus
  → 主动压暗 / 路径变窄 / 表达也变小
被 Eye 凝视
  → 强制压暗 / 恢复延迟
擦边
  → 危险成为证据 / Override 充能
X Override
  → 局部 Void / 局部碰撞关闭 / scar 写入
下一局
  → scar 复水 / ghost 播放一次 / witness 转向
```

教程不把 Focus 标成“更安全的正确玩法”，也不把高光强标成“攻击模式”。两者是不同暴露／表达协议。

## 6. State Snapshot

### 6.1 指纹

指纹是由本局真实指标确定性生成的 1-bit 位图，不是随机背景。建议将以下量映射到图案参数：

- `meanLight` → 像素密度；
- `gazePressure` → 横向压缩／带状间隔；
- `routeWidth` → 图案开放区域宽度；
- `seamDwell` → 斜向空缺停留；
- `overrideCount + scars` → 固定坐标断裂。

同一份 run data 必须生成同一张 fingerprint。导出 PNG、Continue mini preview、暂停 mini preview 都读取同一生成结果。

### 6.2 指标与标签

页面默认指标：平均光强、凝视压力、seam 停留、路径宽度、改写次数。条形图显示事实值，不设绿色优秀区、红色失败区或基准平均线。

行为标签是查询标签，不是勋章，例如 `MEDIUM_LIGHT / HIGH_GAZE / CRACK_WALKER / RESISTER`。它们可以被下一局世界规则读取，但不可排序成更高或更低等级。

### 6.3 观察生成

观察文案从事件组合生成，优先使用可证实的时序：

```text
if overrideCount > 0 and maxGazeBeforeOverride > 0.75:
    “你在被完全看见之前改写了规则。”
elif focusDwell > 0.55 and meanLight < 0.25:
    “你把自己压得很暗，系统因此更晚注意到你。”
elif seamCrossings >= 4:
    “你反复跨过 seam；两边都留下了你的路径。”
```

绝不从数据生成心理诊断、道德结论或能力等级。

## 7. 跨局衔接

`sample-run-state.json` 是最小可运行数据示例。新局进入时：

| 时间 | 事件 | 画面 | 碰撞／输入 |
|---|---|---|---|
| `0 ms` | `scarRehydrate` | 在保存的归一化房间坐标恢复 scar | 无碰撞；输入锁定 |
| `420 ms` | `ghostReplayOnce` | 沿记录路径播放上一局 ghost | 无碰撞、无拾取、无奖励 |
| `980 ms` | `witnessTurn` | 见证者朝 scar／ghost 终点／出生点转向 | AI 尚未开始攻击 |
| `1420 ms` | `returnInput` | HUD 从历史色切到当前房间色 | 交还输入；房间时钟开始 |

scar 使用归一化房间坐标，不使用屏幕坐标。ghost path 可以按 120 ms 或固定距离采样；只保存足以辨认停顿、折返与擦边的点，避免变成完整录像。

Reduced Motion 模式跳过移动过程，显示 `scar + ghost 最终点 + witness 最终朝向` 的单帧合成并保持 900 ms，再交还输入。

## 8. 图集

`ui-atlas.png` 共 8 行：

1. 断角、开放面板、seam；
2. 分段条、阶段 tick、阈值、Void gap；
3. signal、focus、gaze、override、scar、ghost、witness、snapshot；
4. 四房间与四种状态；
5. 方向、Z、Shift、X、确认；
6. 分隔、cursor、toggle、slider、scroll；
7. 八类行为指纹基元；
8. scar、ghost、witness、跨局桥。

frame rect、pivot、分类与是否可 runtime tint 见 `ui-atlas.json`。切勿对整张 atlas 做房间色 multiply：behavior、room、fingerprint、memory 四行已经包含语义色。

## 9. 运行时建议

Three.js：

```js
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;
texture.generateMipmaps = false;
texture.colorSpace = THREE.SRGBColorSpace;
```

以 `360 × 640` 建立正交 UI 坐标，最终只做整数倍 scale。若窗口比例不匹配，保持画布比例并把剩余区域填为 `SYSTEM_INK`。

文字可选择：

1. 运行时使用随包 Noto Sans SC；或
2. 构建时把需要字形栅格成 bitmap font atlas。

任何方案都不应开启 SDF 柔边、subpixel positioning、drop shadow 或 bloom。1 px 线必须对齐物理像素。

## 10. 验收清单

- [ ] Gameplay 中央 70% 区域没有 UI 面板遮挡。
- [ ] 光强与凝视是两个独立来源，不被合并。
- [ ] Boss integrity 中存在真实断口。
- [ ] 失败、快照与 Continue 使用同一份 run state。
- [ ] 同一 run data 每次生成相同 fingerprint。
- [ ] scar 在下一局真实保存坐标复水。
- [ ] ghost 无碰撞、无奖励，只播放一次。
- [ ] witness 的朝向来自数据，不是预烘焙装饰。
- [ ] Reduced Motion 仍保留因果顺序信息。
- [ ] 所有普通页面没有完整同心圆、四角准星、魔法阵、电路板与霓虹赛博 HUD。
- [ ] 所有 PNG 按 nearest 显示；atlas Alpha 仅 `0 / 255`。
- [ ] 字体分发保留 `OFL.txt` 与来源记录。

