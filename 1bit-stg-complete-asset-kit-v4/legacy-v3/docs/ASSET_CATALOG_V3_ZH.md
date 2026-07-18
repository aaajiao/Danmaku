# 1bit STG v3 素材总目录

本目录只把“可由 gameplay 调用的差异”计作正式资源。坐标、颜色替换、hover、后坐力、弹体旋转、Laser 长度、背景滚动和 ghost 路径等可由程序完成的变化，不再用重复贴图冒充丰富度。

本文所有路径均相对最终包根目录。完整文件清单以 `manifests/v3/asset-manifest-v3.json` 为准；文件校验以根目录 `checksums-sha256.txt` 为准。

## 1. 规模

| 系统 | 正式内容 |
|---|---:|
| Gameplay Atlas | 4 张 |
| Gameplay 语义帧 | 256 |
| Atlas 别名 | 2 个，不增加纹理文件 |
| 动画 clip | 41 |
| Gameplay 视觉 archetype | 1 玩家 rig、24 弹体、16 敌人、12 弹幕模板 |
| Boss rig | 8 |
| Boss Laser module | 8 |
| 程序视觉 effect | 8 |
| 背景 runtime layer | 16 张：4 房间 × 4 层 |
| UI Atlas | 1 张、64 构件 |
| 完整 UI 页面 | 10 张，另有 1 张总览 |
| 随包字体 | Noto Sans SC Variable + OFL 1.1 |

## 2. 四张 Gameplay Atlas

共同规格：

- `1024×1024 RGBA PNG`
- `8×8` 网格
- 单格 `128×128`
- straight alpha，Alpha 只有 `0/255`
- 普通格至少 `8px` 透明安全边
- 每格使用稳定 `semanticId`，不得以行列坐标作为 gameplay 接口
- 左上原点，`index = row * 8 + column`

逐格 rect、pivot、logical size、collision class、threat role 和 room 见 `manifests/v3/frame-index-v3.json`。

### 2.1 `atlases/core-grammar-v3.png`：64 个常用基元

| 行 | 数量 | 分类 | 语义范围 |
|---:|---:|---|---|
| 0 | 8 | 微型敌弹 | notch、split、dash、thorn、shard、seed、bit；方向缺口是危险读法的一部分 |
| 1 | 8 | 中型敌弹 | blade、droplet、packet、capsule、fork、leaf、bar、diamond void |
| 2 | 8 | 重型 hazard | wall chunk、lance、twin block、blade mass、gate、column、pressure plate |
| 3 | 8 | 玩家系统 | idle core、Focus confirm、左右 option、tap/hold shot、不完整 guard、偏心 hitbox core |
| 4 | 8 | 拾取物 | score、power、life fragment、memory、witness、option、snapshot、polarity |
| 5 | 8 | 普通敌人 A | courier、clamp、comparator、warden、witness drone、cable biter、echo frame、seed carrier |
| 6 | 8 | 普通敌人 B | seam walker、packet moth、fork crab、residue hound、link sentry、asymmetric twin、burn-in ghost、archive leecher |
| 7 | 8 | 通用提示／VFX | spawn、path、warning、hit、graze、delete、residue、offscreen arrow |

别名 `core-projectile-v3` 指向同一张 PNG，供 projectile loader 使用；它不是第五张 Atlas。

### 2.2 `atlases/boss-topologies-v3.png`：8 Boss × 8 状态

每行固定为：

```text
silhouette → idle_a → idle_b → telegraph → attack → break → death → residue
```

| 行 | Boss | 房间 | 不可替代的负空间拓扑 |
|---:|---|---|---|
| 0 | Absent Receiver / 缺席的接收者 | INFORMATION | 偏心空槽；输入从一侧进入后消失 |
| 1 | Unanswering Feed / 无回应之流 | INFORMATION | 纵向流束绕开永不填满的缺口 |
| 2 | One Sun, One Rule / 同一太阳、同一规则 | FORCED CHOICE | 横向阴影尺夹住核心 |
| 3 | Two Claims / 两种主权 | FORCED CHOICE | seam 两侧不等宽双板 |
| 4 | Misreader / 误读器 | IN-BETWEEN | 相差一像素／一拍的矩形读取窗 |
| 5 | Misregistered Twin Moons / 错位双月 | IN-BETWEEN | 两个不闭合新月与错位走廊 |
| 6 | No Dusk / 没有黄昏 | POLARIZED | 开／关两态的矩形时间墙 |
| 7 | Absolute Reader / Sky Eye | POLARIZED | 唯一允许的破损同心眼；scar 打断圆周 |

Boss 不是八个换色徽章。每套 rig 的 node、phase、weakpoint、hitbox 与事件绑定见 `manifests/v3/boss-rigs.json`。

### 2.3 `atlases/combat-causality-v3.png`：8 条战斗因果链

| 行 | 帧数 | 动作 |
|---:|---:|---|
| 0 | 8 | 玩家主动 Focus：收拢、停顿、一像素确认 |
| 1 | 8 | Eye clamp：突然夹紧、冻结、延迟恢复 |
| 2 | 8 | Override：charge、定向撕裂、local Void、碰撞关闭、scar、沉积 |
| 3 | 8 | 玩家受击到残留：hit、core break、digital delete、Void hold、residue |
| 4 | 8 | 非对称重生：读取上局 scar 后重新出现，不是死亡反播 |
| 5 | 8 | 敌人破裂到物质残留 |
| 6 | 8 | 弹体出生、live、travel、impact、afterimage、clear |
| 7 | 8 | Boss Laser 的 off、telegraph、charge、active、decay、residue、cancel |

别名 `combat-projectile-v3` 指向同一张 PNG，供 projectile／Laser loader 使用。

### 2.4 `atlases/narrative-behavior-v3.png`：行为、天气与跨局记忆

| 行 | 帧数 | 动作 |
|---:|---:|---|
| 0 | 8 | witness idle、turn、face player、rebel、exit |
| 1 | 8 | ghost 行走、犹豫、失足、burnout、residue |
| 2 | 8 | cable attach、upload／burn-in 分支、disconnect、residue |
| 3 | 8 | 定向 scar：seed、extend、branch、commit、hold、permanent |
| 4 | 8 | STATIC：calm、noise、burst、tear、dropout、recover、after |
| 5 | 8 | RAIN／ASH 生命周期与混合清除 |
| 6 | 8 | WIND／ECLIPSE 生命周期 |
| 7 | 8 | State Snapshot：collect、compress、store、handoff、next seed、next scar、active |

叙事 sprite 全部无 gameplay 碰撞。它们只有读取真实 run data、路径和保存坐标时才具有叙事意义。

## 3. 动画与程序运动

`manifests/v3/animation-clips.json` 定义 `41` 条 clip：

- `17` 条玩家、系统、战斗、天气与跨局 clip；
- `24` 条 Boss clip：每个 Boss 各 `idle / attack / terminal_material` 三条。

每条 clip 使用逐帧时间、hold、事件与 Reduced Motion 表达，不假设统一 fps。重点链包括：

- `player.focus`
- `system.eye_clamp`
- `system.override.directional`
- `player.causality.damage_to_trace`
- `player.return_with_history`
- `enemy.causality.damage_to_trace`
- `bullet.lifecycle` 与 `bullet.cancel`
- `boss.laser.lifecycle`
- `narrative.witness.rebel`
- `narrative.ghost.burnout`
- `memory.directional_write`
- `state.snapshot_handoff`

`enemy.hover`、`enemy.recoil`、`pickup.drift` 被声明为程序运动，不占额外格位。

`manifests/v3/gameplay-visual-archetypes.json` 把视觉语义接到传统 STG 所需的生产参数：玩家 node／hardpoint、敌人发射锚点与 hitbox、24 种弹体的碰撞形状与速度范围、12 组房间行为弹幕模板，以及对象池起始预算。颜色不参与危险等级判断；碰撞仍由 gameplay timeline 决定。

## 4. Boss Rig

八套 rig 与八行 Boss 一一对应：

```text
root
├── body / topology
├── weakpoint or reading aperture
├── emitter
└── rupture / material residue
```

使用规则：

- body 只在语义状态和 phase 边界换帧；
- weakpoint 是否可受伤由 gameplay state 决定；
- anchor 使用稳定 normalized coordinates，不随每帧 bbox 漂移；
- terminal clip 必须先删除数字壳，再留下物质 residue；
- Absolute Reader 是唯一可使用同心眼的 Boss。

## 5. Laser

`manifests/v3/laser-modules.json` 包含八套 Boss Laser：

| Module | 房间 | 中央图案语法 |
|---|---|---|
| `laser.absent_receiver` | INFORMATION | packet gap |
| `laser.unanswering_feed` | INFORMATION | vertical feed |
| `laser.one_sun_one_rule` | FORCED CHOICE | single rule |
| `laser.two_claims` | FORCED CHOICE | unequal seam |
| `laser.misreader` | IN-BETWEEN | double read |
| `laser.misregistered_twin_moons` | IN-BETWEEN | offset crescents |
| `laser.no_dusk` | POLARIZED | binary wall |
| `laser.absolute_reader` | POLARIZED | scarred eye |

所有 module 复用 `combat-causality-v3` 的 warning、emitter、body 与 end 语义帧，运行时按房间重映射 accent、宽度和中央 pattern。中央 body 使用 `stretch-center` 的窄采样带，不拉伸头尾。

权威状态固定为：

```text
idle → telegraph → charge → grow → live → shutdown → residue → idle
```

只有 `live` 碰撞。进入 `shutdown` 或取消时，`collision.off` 必须是同一模拟时间的第一项。

## 6. 程序视觉 Effect

`manifests/v3/runtime-effects.json` 的八项 effect 全部是 visual subscriber：

1. sprite damage flash
2. bullet cancel ordered dither
3. Laser warning pulse
4. Laser grow
5. Laser body scroll
6. Laser shutdown
7. room transition mask
8. Boss phase swap

它们不能发出或门控 gameplay event。效果完成回调也不能打开碰撞。

## 7. 四房间背景

每个 runtime layer 为 `360×1280 RGBA PNG`，内部含两个相同的 `640px` 周期。

| 层 | 职责 | 运行时处理 |
|---|---|---|
| `far` | 低对比房间身份／物质底层 | opaque；始终保留 |
| `mid` | 协议运动 | 在 Boss 或高弹量时由 gameplay veil 降低 |
| `trace` | 玩家路径、停顿、折返与 scar | 交付图为范例；实机动态替换 |
| `mask` | packet gate、seam、A/B 交集、硬阈值 | 读取二值 Alpha，禁止 smoothstep |

房间：

- `information`：断裂信息束、丢包、重试、旧路烧屏；没有稳定中心。
- `forced_choice`：同一 seed 的左右治理结果；seam 不是安全线。
- `in_between`：正交系统与斜向系统独立运行；稳定交集可学习。
- `polarized`：红／墨／骨白硬切；系统层镜像，只有玩家 scar 破坏镜像。

Runtime：`backgrounds/layers/<room>/{far,mid,trace,mask}.png` 与 `backgrounds/manifest.json`。

非 Runtime：

- `backgrounds/composites/`：四张 360×640 合成检查图；
- `backgrounds/previews/`：分层与 40／120／240 弹压力预览；
- `backgrounds/reports/`：机器与人工验证结果。

## 8. UI、HUD 与 State Snapshot

### UI Atlas

`ui/atlas/ui-atlas.png`：`512×512`、`8×8`、单格 `64×64`，共 `64` 个构件。

| 行 | 分类 |
|---:|---|
| 0 | 断角、开放面板、seam |
| 1 | 分段条、phase tick、阈值、Void gap |
| 2 | signal、Focus、gaze、Override、scar、ghost、witness、snapshot |
| 3 | 四房间与四种状态 |
| 4 | 方向、Z、Shift、X、确认 |
| 5 | divider、cursor、toggle、slider、scroll |
| 6 | 八类行为指纹基元 |
| 7 | scar、ghost、witness 与跨局桥 |

逐格 frame、pivot、分类与 tint 规则见 `manifests/v3/ui-atlas.json`。

### 十个完整页面

1. Gameplay HUD
2. Boss HUD
3. 标题
4. 暂停
5. 设置
6. Continue
7. 失败
8. 教程行为图
9. State Snapshot
10. 跨局衔接

页面布局、数据绑定与焦点顺序见 `manifests/v3/ui-layouts.json`；中英文案见 `manifests/v3/ui-copy.json`；最小 run data 见 `manifests/v3/sample-run-state.json`。

`ui/mockups/` 是设计与验收参考，不应作为一整张截图直接显示在游戏中。

## 9. 字体

- 文件：`fonts/NotoSansSC-Variable.ttf`
- 字体：Noto Sans SC Variable
- 许可：SIL Open Font License 1.1
- 许可文件：`fonts/OFL.txt`
- 来源记录：`fonts/FONT_SOURCE_ZH.md`

运行时可以加载字体，也可以在构建阶段栅格化为 bitmap font。两种方式都要保留许可与来源；禁止 SDF 柔边、subpixel positioning、阴影和 bloom。

## 10. 真实预览与 QA

`tools/qa/render_v3_previews.py` 能生成：

- 单条 clip 的 GIF、APNG 与精确 timeline JSON；
- 按 anchor 组装的 Boss rig 预览；
- 带碰撞开关标记的 Laser 生命周期；
- `360×640` 的背景、玩家、敌人、Boss 与指定弹量压力场景。

`previews/` 保存发布总览及从最终 manifest 生成的运行时预览；`reports/` 保存 QA、时间线与压力测试报告。完整预览应覆盖全部 clip、八个组装 Boss、八条 Laser 生命周期，以及 40／120／240 弹压力场，而不是逐格扫过 Atlas。

## 11. 机器清单的权威顺序

发生文档与文件差异时，按以下顺序处理：

1. `manifests/v3/asset-manifest-v3.json`；
2. 根目录 `checksums-sha256.txt`；
3. `manifests/v3/frame-index-v3.json`、`manifests/v3/gameplay-visual-archetypes.json`、`manifests/v3/animation-clips.json`、`manifests/v3/boss-rigs.json`、`manifests/v3/laser-modules.json`；
4. `backgrounds/manifest.json` 与 `manifests/v3/ui-layouts.json`；
5. 本文。

不能以“图里看起来有”替代 manifest 声明；未命名、未绑定、未验证的图形仍属于 source，而不是游戏资产。
