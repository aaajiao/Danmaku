# V4 素材目录

## 1. 图集

V4 的图集统一为 1024×1024、8×8 网格、单元 128×128。基础四张沿用 V3，新增三张承担行为而不是重复角色轮廓。

| 图集 | 帧数 | 主要内容 |
|---|---:|---|
| `core-grammar-v3.png` | 64 | 弹体、玩家、pickup、16 个普通敌人、通用标记 |
| `boss-topologies-v3.png` | 64 | 8 个 Boss 的基础拓扑与旧兼容帧 |
| `combat-causality-v3.png` | 64 | Focus、局部 Override、受击、死亡、返回、激光生命周期 |
| `narrative-behavior-v3.png` | 64 | Witness、Ghost、Cable、天气、Snapshot、跨局行为 |
| `player-world-behavior-v4.png` | 64 | Flower、Eye、Evidence、Witness、Ghost、Cable、阈值与记忆 |
| `combat-behavior-cues-v4.png` | 64 | 弹体状态、玩家射击、敌人移动／攻击、Boss 节点、激光、天气 |
| `boss-phase-components-v4.png` | 64 | 8 个 Boss × 8 个三阶段／解决／残留部件 |

权威坐标在 `manifests/v4/frame-index-v4.json`。同名 V3 行为帧会保留为 `legacy.v3.*`，V4 帧取得正式语义；因此物理帧总数与语义 ID 都是 448。

## 2. 弹幕与敌人

`manifests/gameplay/` 提供可直接编译的数据：

- 12 个 motion operator；
- 四精神房间各 4 套 pattern；
- 通用、过渡、天气共 8 套；
- 8 个 Boss 各 3 个阶段；
- 16 个敌人和 8 个机械职责；
- 8 种激光拓扑；
- 四个 room composer、encounter director 与 run director。

`gameplay/animations/patterns/` 有每套 pattern 独立的 GIF、APNG 与 timeline；`boss-sequences/` 有每个 Boss 的三阶段连续预览。预览只检查结构与节拍，不拥有 gameplay authority。

## 3. 房间与天气

`backgrounds/composites/` 是四个精神房间的基础图。`backgrounds/reactions/` 为每个房间提供：

- `threshold.png`：行为阈值被世界承认；
- `dusk.png`：黄昏／No Dusk 前的时间关系；
- `aftermath.png`：天气或战斗的材料余波；
- `memory.png`：下一局仍在场的痕迹。

叠层保持硬透明，程序应根据权威事件开关或替换，而不是靠模糊渐变制造“气氛”。五类天气各自有 frame、音频和材料残留，不能只共享同一粒子系统换方向。

## 4. UI

`ui/atlas/ui-atlas.png` 保留通用图标。V4 九张 360×640 界面定义新语义：

1. Gameplay HUD：Flower、Read、Evidence、Memory、Room、Weather；
2. Boss HUD：Protocol interval、Reading fact、Resolution condition；
3. Progressive discovery：世界先展示，界面后命名；
4. State Snapshot：指纹、观察句、事实来源、跨局材料；
5. Cross-run transition：唯一权威时间线；
6. Accessibility：216 种表现组合；
7. Continue with memory；
8. Route interruption；
9. Feedback channels。

UI 禁止出现 score、rank、perfect、good end／bad end 及中文对应词。Boss 条不是生命值，而是协议尚未闭合的区间。

## 5. 音频与触觉

48 个 WAV 均为 48kHz、16-bit、双声道：

- 4 个 12 秒房间声床；
- 8 个 Boss 协议信号；
- 36 个行为 SFX。

音频 ID、响度、哈希和循环规则在 `manifests/narrative/audio-manifest-v4.json`。触觉是参数配方，不是音频波形；它与画面都只能订阅事件。

## 6. 叙事材料

跨局材料严格分离：

- `overrideScars`：局部规则缺席的坐标与方向；
- `deathTraces`：身体中断的真实路径末端；
- `burnIns`：持续读取或 Cable 上报留下的表面灼痕；
- `ghostResidues`：上一条真实路线播放一次后留下的材料；
- `weatherResidues`：五类天气各自的环境余波。

64 组 Snapshot 文本均含条件、事实路径、中英文；解析语法是声明式 `1bit-rule-v1`，禁止使用 `eval`。

## 7. 源文件与生产文件

- `sources/generated/`：三张 V4 生成源板；
- `sources/scripts/`：确定性像素化和预览脚本；
- `manifests/`：运行时应该读取的数据；
- `reports/`：QA 证据；
- `legacy-v3/`：历史文档和旧预览，不属于 V4 权威入口。

