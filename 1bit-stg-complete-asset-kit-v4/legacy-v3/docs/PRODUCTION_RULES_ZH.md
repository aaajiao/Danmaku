# 1bit STG v3 生产与贡献规则

这份文件是新增、修改和审核素材的发布门槛。目标不是让所有图“看起来一样”，而是保证每个差异都能改变玩家的判断、动作或记忆，并能被 Three.js 稳定加载。

本文路径均相对最终包根目录。`manifests/v3/asset-manifest-v3.json` 是 canonical inventory；根目录 `checksums-sha256.txt` 是文件完整性校验。

## 1. 先写行为，再画图

一个新资源进入生产前必须先回答：

1. 它属于玩家、敌弹、敌人、拾取物、memory、UI 还是背景？
2. 它的唯一动词是什么：收拢、夹紧、撕裂、删除、残留、误读、转向、复水……？
3. 它改变哪一个玩家判断或 gameplay state？
4. 数字规则先发生什么？材料随后留下什么？
5. 已有 frame、runtime transform 或 shader 能否完成？

第五项若答案为“能”，不要新增贴图。位移、旋转、hover、后坐力、颜色替换、Laser 长度、背景滚动、ghost path、伤害闪、透明淡出和百分比填充应由程序完成。

## 2. 固定调色板

| 角色 | 色值 | 使用范围 |
|---|---|---|
| `SYSTEM_INK` | `#08090D` | 系统、碰撞外壳、背景暗部 |
| `SELF_PAPER` | `#EFE9DA` | 玩家核心、危险核心、文字 |
| `FRICTION_GRAY` | `#7D8087` | 材料磨损与 residue |
| `INFO_CYAN` | `#17A7CA` | INFORMATION 房间色 |
| `FORCED_AMBER` | `#D6982B` | FORCED CHOICE 房间色 |
| `BETWEEN_VIOLET` | `#7851B7` | IN-BETWEEN 房间色 |
| `POLAR_RED` | `#B7463C` | POLARIZED 房间色 |
| `OVERRIDE_MAGENTA` | `#F02A92` | Override／scar 写入瞬间 |

硬规则：

- 可见 RGB 必须来自上表。
- 普通单格最多四种可见颜色：ink、paper、gray、当前房间色。
- `POLARIZED` 禁止 gray。
- Magenta 不是房间色，只能出现在 Override 阈值或 scar commit。
- 危险等级、阵营与拾取物种类不能只靠颜色区分。
- 同一普通 sprite 不得混用多个房间 accent。

## 3. PNG 与 Atlas

### Gameplay Atlas

| 项目 | 规格 |
|---|---|
| Atlas | `1024×1024` |
| 网格 | `8×8` |
| 单格 | `128×128` |
| 格式 | PNG、RGBA、8-bit/channel |
| Alpha | straight binary，只允许 `0/255` |
| 安全边 | 普通格四边至少 `8px` 透明 |
| 原点 | 左上 |
| 采样 | nearest，无 mipmap |

透明像素 RGB 应清零。可见像素和透明边缘都不得残留绿幕。普通 sprite 不能触碰单元边缘；需要重复的长条也应优先在 runtime 生成中央段，而不是让整格 bleed。

### UI Atlas

- `512×512`、`8×8`、单格 `64×64`。
- 与 gameplay Atlas 分开打包。
- UI 元件不得被当成碰撞 sprite；gameplay frame 也不得用于界面布局。

### 背景

- 每层 `360×1280`，含两个完全相同的 `640px` 周期。
- `far` opaque；`mid/trace/mask` 使用二值 Alpha。
- mask 的 RGB 固定为 Ink，运行时主要读取 Alpha。
- authored layer 不得烘焙弹体大小的高亮块。

## 4. 五类轮廓

在去色后仍必须可区分：

1. **玩家 / SELF**：偏心 Paper 核；不完整物质壳；无完整圆环和四角准星。
2. **敌弹 / PROHIBITION**：实心危险重量；运动方向有 Void notch；越危险越重。
3. **敌人 / GOVERNOR**：物质余料为主体；协议痕迹只夹住一侧；显示发射和受力方向。
4. **拾取物 / PERMISSION**：开放轮廓、无攻击朝向、慢节拍；用内部孔型区分。
5. **叙事痕迹 / MEMORY**：低亮、无碰撞；来自真实路径、停顿、折返与历史坐标。

完整同心圆只允许 `Absolute Reader / Sky Eye` 使用。前七个 Boss 和普通对象禁止使用眼、完整准星、魔法阵、曼陀罗或径向徽章作为主轮廓。

## 5. 语义与 Manifest

每个 gameplay frame 至少必须声明：

```json
{
  "semanticId": "bullet.micro.notch_e",
  "kind": "enemyBullet",
  "room": "ANY",
  "paletteRole": "INFO_CYAN",
  "pivot": [0.5, 0.5],
  "logicalSize": 16,
  "collisionClass": "enemy_projectile_small",
  "threatRole": "moving_prohibition"
}
```

规则：

- `semanticId` 描述行为或 gameplay 角色，不描述坐标。
- 禁止 `atlas_03_07`、`frame42`、`icon_blue` 等 ID。
- ID 使用小写点分层；重命名属于 breaking change。
- pivot 是稳定逻辑锚点，不是每帧 Alpha 质心。
- collision class 只是查找键；真实 hitbox、伤害和难度参数属于 gameplay 数据。
- 同一像素帧若服务于多个 loader，可用 `aliasOf`；不得复制 PNG 制造两个版本。
- 未进入 frame index、未被引用、未通过 QA 的图形仍是 source。

## 6. 动画时间语法

动画必须能用一个动词描述。不同动词不得使用完全相同的像素序列与完全相同的时间结构。

最低时间要求：

- Focus：约 `180ms` 收拢 → `240ms` 停顿 → `130ms` 一像素确认。
- Eye clamp：约 `120ms` 内突然夹紧；恢复延迟，禁止把 Focus 反播冒充。
- Override：`charge → directional tear → local void → collision off → scar write → material sediment`。
- 普通敌人 material residue 至少 `300ms`；Boss 模块至少 `750ms`。
- 重生不是死亡反播，必须读取上一轮 scar 的轻微偏移。

每条 clip 应声明：

- frame 顺序；
- 每帧 `durationMs` 或等价时间；
- loop／once；
- hold；
- gameplay event 的权威引用；
- Reduced Motion 代表帧或视觉序列；
- validation profile。

等速 fps 只能用于真正等速的 ambient loop，不能用来简化因果链。

## 7. 事件与碰撞

### 双时间轴

- `EventTimeline`：固定模拟时钟；唯一 gameplay 权威。
- `VisualTrack`：可掉帧、冻结、跳代表帧；不能产生 gameplay event。
- `BindingGraph`：单向 `gameplay-event → clip/effect`；visual terminal 不得回写 gameplay。

同一时间戳的推荐顺序：

```text
collision off
→ damage / state commit
→ collision on
→ spawn
→ audio
→ visual
```

### 必须通过的时序

- 大 delta 穿过多个边界时，所有事件按准确模拟时间补发。
- 循环事件 key 包含 instance、generation、loop index 与 event index。
- `cancel()` 立即生效且只发一次；取消后不再 completion。
- hold 只延长视觉，除非 gameplay timeline 显式等待。
- 玩家受击时先 `collidable=false`，再提交伤害。
- 复活先放置，再按独立边界开碰撞。
- 重弹 telegraph 不碰撞，arm 后才 live。
- 高速弹使用 swept shape 检测。
- IN-BETWEEN 的 gameplay pose 量化并冻结；渲染抖动不能改碰撞体。

### Laser

状态固定为：

```text
idle → telegraph → charge → grow → live → shutdown → residue → idle
```

只有 `live` 碰撞。进入 shutdown 或在 live 中 cancel 时，collision off 必须是该模拟时间第一项。telegraph、charge、grow、shutdown 与 residue 都不能命中。

### Reduced Motion

Reduced Motion 只能改变 VisualTrack。Full 与 Reduced Motion 必须输出完全相同的 gameplay event ID、时间和顺序；禁止维护第二份简化玩法时间表。

## 8. 背景生产规则

每个房间必须同时具备四层和独立行为：

| 房间 | 必须出现 | 禁止退化为 |
|---|---|---|
| INFORMATION | 异步刷新、丢包、重试、旧路径烧屏、无中心 | 蓝色数据雨壁纸 |
| FORCED CHOICE | 同 seed 左右差异、seam 活动、无永久中线安全区 | 左右换色镜像 |
| IN-BETWEEN | A/B 独立方向与节拍、稳定交集 | 紫色莫尔装饰 |
| POLARIZED | Ink/Paper/Red 硬切、系统镜像、scar 例外 | 红色渐变赛博背景 |

Gameplay veil 只降低 `mid`：

- 常态 `0.72`
- 120 弹或 Boss active 建议 `0.42`
- 240 弹建议 `0.32`

`far` 保留房间身份，`trace` 保留玩家历史，`mask` 保留机制结果。

发布前必须在 `360×640` 下检查 40／120／240 弹三档。危险弹的 Ink/Paper 双轮廓不能被背景中位亮度吞掉。

## 9. UI 与 State Snapshot

- 逻辑画布 `360×640`，4px 排版节拍，安全区 `x=12,y=8,w=336,h=620`。
- Gameplay HUD 中央 70% 不放面板。
- Light 与 Gaze 必须是两个来源。
- Boss integrity 使用真实断口，不使用完整血条容器。
- 设置页必须提供 Reduce Flash、Reduced Motion、High Contrast、Void Notch+。
- Continue 先说明上一局会以 scar、ghost、witness 的哪种形式回来。
- 失败页先显示材料沉积，不显示 `GAME OVER`。
- State Snapshot 的 fingerprint 由真实 run data 确定性生成。
- 行为标签是查询标签，不是奖章；观察句只陈述可证实时序。
- 同一 run state 必须供失败、Continue、暂停 mini preview 与 Snapshot 共用。
- runtime font 或 bitmap font 均禁止 SDF 柔边、subpixel positioning、投影和 bloom。

## 10. 视觉禁区

- 樱花、鸟居、家纹、日轮、浮世绘波、锦鲤、和服、假名、书法；
- 可识别的 Mother、Touhou 或其他游戏角色、UI、PSI 图标与原配色；
- 魔法阵、曼陀罗、纹章、符文、宝石、药水、Loot 图标；
- 生物眼球、脸、吉祥物、可爱怪物、恶魔、龙、机甲、飞船；
- 电路板城市、浏览器窗口墙、Matrix 字符雨、VHS/RGB split、扫描线；
- 金属高光、玻璃、倒角、渐变、Bloom、柔光、投影与半透明烟雾；
- AI 模糊像素、抗锯齿边缘、亚像素纹理和随机细碎噪点。

“抽象日式”只能来自像素经济、非对称、停顿、留白、克制双语层级和 deadpan warmth，不能来自文化纪念品。

## 11. 从 Source 到 Runtime

### A. 设计声明

提交一段不超过五行的说明：semantic ID、唯一动词、gameplay 后果、数字／物质配对、为什么程序运动无法替代。

### B. 生成／绘制源板

- 一个单元一个对象；稳定 origin；不重叠、不裁切。
- 若使用绿幕，背景必须均匀且素材内部禁用绿色。
- 源板放入 `sources/generated/`，不直接进入 runtime。

### C. 确定性后处理

- 切成固定网格；
- 最近邻缩放；
- 映射固定调色板；
- Alpha 阈值为 0／255；
- 清除透明 RGB 与绿边；
- 保证安全边与稳定 pivot；
- 生成 checksum 与 manifest。

手工修图必须能被记录或重现；不要只留下一个无法追溯的最终 PNG。

### D. 结构 QA

- 尺寸、网格、Alpha、palette、每格色数；
- semantic ID 唯一；
- pivot 合法；
- 无空格、串格与 green spill；
- 无重复 frame／clip；
- spawn/delete/residue 方向正确；
- manifest 交叉引用完整。

### E. 真实预览

- 逐条 clip，按真实 duration、hold 与 event；
- 组装 Boss rig，不是平铺格位；
- Laser 全生命周期并标出碰撞；
- 360×640 压力场；
- Full 与 Reduced Motion 对照。

### F. 人工审查

- 去色后五类轮廓可分；
- 四房间去色后行为可分；
- 动画能用唯一动词描述；
- 没有禁用图腾；
- 数字删除与材料 residue 存在时间差；
- 文字不评判玩家。

### G. 打包

只有通过以上步骤的文件才进入 runtime graph。`manifests/v3/asset-manifest-v3.json` 必须列出 canonical path、SHA-256、类型、是否 runtime、来源与验证状态；根目录 `checksums-sha256.txt` 必须覆盖除自身之外的最终包文件。源板、mockup、preview 和 report 分别进入 `sources/`、`ui/mockups/`、`previews/` 与 `reports/`，不得混入 runtime 依赖。

## 12. CI 与发布门槛

可在项目根目录执行只读总 QA：

```bash
python3 tools/qa/qa_v3.py \
  --kit-root . \
  --report reports/v3-release-report.json \
  --strict-warnings
```

生成完整预览：

```bash
python3 tools/qa/render_v3_previews.py \
  --kit-root . \
  --out previews/runtime \
  --format both \
  --all-clips \
  --boss all \
  --laser all \
  --stress
```

发布条件：

- 结构错误 `0`；严格模式警告 `0`。
- 256/256 gameplay frame 有唯一语义并被正确引用。
- 固定八色、普通格 ≤4 色、二值 Alpha、≥8px 安全边。
- 不同动词无完全相同序列。
- 事件图无环，visual 无回写 gameplay。
- Full／Reduced Motion gameplay trace 等价。
- 八个 Boss 和八套 Laser 可独立辨认与组装。
- 四房间通过 40／120／240 弹压力测试。
- UI、字体许可、State Snapshot 与跨局数据链完整。
- `checksums-sha256.txt` 与 `manifests/v3/asset-manifest-v3.json` 对最终包的记录一致。

任一项失败都不能用“原图看起来没问题”豁免。
