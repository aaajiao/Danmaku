# 1bit STG Complete Asset Kit V4

这是《1bit》的独立 V4 游戏资源包，也是可直接接入 Three.js／ECS 的视觉、弹幕、叙事与反馈契约。它不是一批互不相关的像素图：所有素材都服从同一条关系——玩家的表达、凝视、擦弹与局部 Override 先成为玩法事实，世界再以数字反应和物质残留回答。

V4 保留 V3 的 256 个基础像素帧，新增 192 个行为帧，并补完可执行弹幕、三阶段 Boss、跨局材料、声音、UI、房间反应和权威运行时。V3 的旧文档与预览已收进 `legacy-v3/`，不会与 V4 权威入口混在一起。

## 交付规模

| 系统 | V4 内容 |
|---|---:|
| 像素图集 | 7 张 1024×1024；448 个物理帧 |
| 弹幕运动算子 | 12 |
| 可执行弹幕 | 48；48 个结构签名 |
| 普通敌人 | 16；8 个机械职责 |
| Boss | 8；24 个阶段；8 种非击杀式解决 |
| 激光拓扑 | 8 种真实几何 |
| 弹幕动效预览 | 48 GIF + 48 APNG |
| Boss 三阶段预览 | 8 GIF + 8 APNG |
| 房间 | 4 张基础场景 + 16 张反应叠层 |
| 天气 | 5 类；各自有前兆、爆发、余波 |
| 叙事 | 16 状态、13 反应节点、64 组双语观察句 |
| 反馈 | 37 条叙事 cue、34 条运行时绑定 |
| 音频 | 48 个 48kHz 双声道 WAV |
| UI | 1 张 UI atlas + 9 张 V4 语义界面 |
| 无障碍 | 6 个正交轴、216 种组合，同一玩法时间线 |

## 从这里开始

1. 读取 `manifests/v4/package-manifest-v4.json`。这是整包唯一入口。
2. 读取 `manifests/runtime/runtime-manifest-v4.json`，建立事件与状态机。
3. 读取 `manifests/gameplay/gameplay-index-v4.json`，编译运动算子、弹幕、敌人与 Boss。
4. 读取 `manifests/integration/asset-bindings-v4.json`，把事件接到视觉、UI、音频和触觉。
5. 最后加载 `manifests/v4/frame-index-v4.json`、图集、房间和音频。

推荐先看：

- `docs/V4_ASSET_CATALOG_ZH.md`：素材地图和数量；
- `docs/V4_THREEJS_IMPLEMENTATION_ZH.md`：Three.js 接入顺序；
- `docs/V4_NARRATIVE_WORLD_SYSTEM_ZH.md`：世界如何回应玩家；
- `gameplay/README_ZH.md`：48 套弹幕的编译规则；
- `runtime/README_ZH.md`：72 个事件与 12 个状态系统；
- `reports/FINAL_VALIDATION_V4_ZH.md`：最终验证结果。

## V4 的四条硬规则

1. **玩法先于表现。** 碰撞、伤害、输入归还、Boss 转相只由固定 gameplay clock 和权威状态机决定。
2. **弹幕是论证。** 图样的差异来自运动、空间、时间和安全通道，不能只换图标或颜色。
3. **反抗是局部缺席。** Override 消耗 evidence，只在指定方向裁出局部 Void，并留下 `overrideScar`；它不是 Bomb 或全局无敌。
4. **结尾是观察。** Snapshot 给出可追溯事实和材料，不给分数、排名、人格标签或“好／坏结局”。

## 视觉使用约束

- 像素图集只使用八色合同；透明度只能是 0 或 255。
- 纹理采样使用 `NearestFilter`，关闭 mipmap 与颜色插值。
- 普通单元最多四种可见颜色；`OVERRIDE_MAGENTA` 只用于 scar／tear 写入。
- “日式”来自间、留白、状态的不完全闭合和克制的节拍，不使用鸟居、神社、纹章、伪文字等符号捷径。
- Eye 可以使用读取环；其他系统不得泛化成同心曼荼罗。

## 兼容与迁移

V3 原始资产仍可作为基础 sprite 使用，但 V4 会替换三组旧语义：

| V3 | V4 |
|---|---|
| `pickup.score.open_bit` | `pickup.evidence.open_bit` |
| `pickup.power.fork` | `pickup.expression.fork` |
| `pickup.life.fragment` | `pickup.continuity.fragment` |

V3 的完整教程图、Boss HP 唯一终止、固定 270ms 弹体命中与全局 Override 均不得继续作为权威逻辑。完整迁移见 `docs/V3_TO_V4_MIGRATION_ZH.md`。

## 复建与验证

整包保留了源板、像素化脚本、弹幕编译器、模拟器和验证器。开发时可以只加载 runtime 资源；源板、预览和报告不应进入发布包。

所有最终文件列在根目录 `checksums-sha256.txt`。重新验证运行：

```sh
python3 -B tools/qa/validate_v4_integration.py
```

当前基线：所有静态检查、TypeScript strict、12/12 运行时测试、48/48 确定性弹幕、Normal／Focus 安全通道、56/56 叙事检查与音频重复生成一致性均通过。
