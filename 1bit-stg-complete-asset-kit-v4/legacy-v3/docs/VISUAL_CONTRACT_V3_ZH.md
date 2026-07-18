# 1bit STG v3 视觉契约

## 目标

v3 不再把“丰富”理解为更多图标。视觉系统只保留能改变玩家判断、动作或记忆的差异：

`基元 × 房间规则 × 时间后果 × 数字/物质配对 × 玩家历史`

互联网负空间不是窗口、准星或网络符号，而是被系统忽略的行为在场上留下的空缺、停顿、折返、擦边与残留。

## 五类不可混淆的轮廓

1. **玩家 / SELF**：偏心纸白核心；不完整的物质外壳；没有完整圆环与四角准星。
2. **敌弹 / PROHIBITION**：实心危险重量；朝运动方向开一个 Void 缺口；越危险越重，不靠颜色区分。
3. **敌人 / GOVERNOR**：物质余料占主体；协议痕迹只夹住一侧；必须显示发射方向和受力方向。
4. **拾取物 / PERMISSION**：开放轮廓、无攻击朝向、慢节拍；内部孔型区分种类，不只换颜色。
5. **叙事痕迹 / MEMORY**：低亮、无碰撞；形状来自真实路径、停顿、折返或历史坐标，禁止居中徽记。

完整同心圆只允许用于最终 Boss `Absolute Reader / Sky Eye`。其他 Boss 不得使用眼、魔法阵、曼陀罗、完整准星或径向纹章作为主轮廓。

## 固定调色板

| 角色 | 色值 | 规则 |
|---|---|---|
| SYSTEM_INK | `#08090D` | 系统、碰撞外壳、背景暗部 |
| SELF_PAPER | `#EFE9DA` | 玩家核心、危险核心、文字 |
| FRICTION_GRAY | `#7D8087` | 材料磨损与残留 |
| INFO_CYAN | `#17A7CA` | INFO 唯一房间色 |
| FORCED_AMBER | `#D6982B` | FORCED 唯一房间色 |
| BETWEEN_VIOLET | `#7851B7` | IN_BETWEEN 唯一房间色 |
| POLAR_RED | `#B7463C` | POLARIZED 唯一房间色 |
| OVERRIDE_MAGENTA | `#F02A92` | 仅 Override／scar 写入瞬间 |

普通 sprite 每格最多四种可见颜色：ink、paper、gray、当前房间色。POLARIZED 禁用 gray。透明 Alpha 只能是 0 或 255。

## 八个 Boss 的负空间拓扑

| Boss | 不可替代的轮廓 |
|---|---|
| Absent Receiver | 偏心空槽；信息从一侧进入后消失 |
| Unanswering Feed | 纵向流束绕开一个永不填满的缺口 |
| One Sun, One Rule | 单一横向阴影尺与被夹住的核心 |
| Two Claims | seam 两侧不等宽的双板；共享但不相同 |
| Misreader | 两个相差一像素／一帧的矩形读取窗 |
| Misregistered Twin Moons | 两个不闭合的新月与错位走廊 |
| No Dusk | 只有开／关两态的矩形时间墙 |
| Absolute Reader | 唯一允许的巨大破损同心眼；scar 打断圆周 |

## 时间语法

- Focus / 入神：`收拢 180ms → 停 240ms → 一像素确认 130ms`，总长约 550ms。
- Eye clamp / 被规训：120ms 内突然夹紧；恢复必须延迟，不能像 Focus 一样平滑。
- Override：`charge → directional tear → local void → collision-off → scar write → material sediment`。
- 删除：数字壳先消失；物质残留必须多停一拍。普通敌人残留至少 300ms，Boss 模块至少 750ms。
- 出生与重生不得互为简单反播；重生携带上一轮 scar 的轻微偏移。
- 每条 clip 支持逐帧 `durationsMs`，不再只用等速 fps。

## 四房间的行为，而不是换色

- INFO：不同步刷新、丢包、重复尝试、旧路径烧屏；没有稳定中心。
- FORCED：同 seed 左右两种治理；中央 seam 不得看起来像稳定安全通道。
- IN_BETWEEN：A/B 两层独立；视觉与碰撞使用可学习的稳定交集。
- POLARIZED：纯硬切、零渐变、零抖动；scar 是唯一破坏镜像的对象。

## 背景分层

每房间必须拆成：

1. `far`：低对比结构，只负责房间身份。
2. `mid`：协议运动，可被 gameplay veil 压低。
3. `trace`：由玩家历史生成的低亮残留。
4. `mask`：天气、seam、moire、hard-threshold 的运行时遮罩。

任何一层都不得烘焙弹体大小的高亮方块。前景危险物必须在 360×640、240 枚弹体压力下保持可辨。

## 禁用

- 通用同心圆、四角准星、曼陀罗、魔法阵、家纹、符文。
- 电路板城市、浏览器窗口墙、Matrix 字符雨、VHS/RGB glitch。
- 金属高光、渐变、柔光、Bloom、亚像素噪点与 AI 模糊像素。
- 用颜色替代危险等级、阵营或拾取物种类。
- 让不同叙事动词复用完全相同的像素序列。

## 发布门槛

- 所有 runtime atlas 统一 128×128 单格，二值 Alpha，至少 8px 安全边。
- 每格必须具有 `semanticId / kind / room / pivot / logicalSize / collisionClass / threatRole`。
- 玩家、敌弹、拾取物在去色后仍可区分。
- 每条动作可用唯一动词命名；不同动词不得像素完全相同。
- 按真实 clip、hold、event 与 Reduced Motion 生成预览。
- 四房间均通过 40／120／240 枚弹体的 360×640 压力测试。

