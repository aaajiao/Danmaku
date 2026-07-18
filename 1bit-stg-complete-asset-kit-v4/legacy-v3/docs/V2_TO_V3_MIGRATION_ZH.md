# 从 v2 迁移到 v3

v3 不是在 v2 上继续叠加素材，而是把运行时接口从“文件名 + 格位”改成“语义 + 事件 + 后果”。v2 应完整保留以便回看与溯源，但不再作为 v3 gameplay 的默认素材库。

本文路径均相对最终包根目录。迁移工具应以 `manifests/v3/asset-manifest-v3.json` 构建资源图，并用根目录 `checksums-sha256.txt` 校验文件。

## 1. 为什么需要重做运行时层

v2 已经解决固定网格、硬 Alpha、基础 clip、Boss rig 与初步验证，但全面审查发现它的“结构通过”并不等于“视觉系统成立”。

### 1.1 静态库与动效库使用两套视觉契约

- v1 保留的静态 Atlas 仍包含大量生成色差，单图可见 RGB 颜色达到数万级；`polarized` 原背景审计中约有 `92,907` 种可见 RGB。
- v2 motion Atlas 已接近限色，却与静态 656 格、背景和 UI 不是同一生产规范。
- 文档写“二值／无渐变”时，运行时纹理本身仍可能不满足固定八色与普通格四色综合上限。

结果是：同一场景混用时，角色、弹体、背景和 VFX 的边缘、颜色与视觉重量不一致。

### 1.2 656 格很丰富，但不是可维护接口

- 旧 frame index 主要按文件、行列与序号定位。
- 大量格位没有稳定的 gameplay 语义、threat role、collision class 或 room rule。
- pivot 多为通用中心，不能说明对象的真实 hit point、发射方向和受力方向。
- 开发者只能“看图挑一个”，之后任何重排都会破坏关卡脚本。

因此旧 656 格适合做构图与母型参考，不适合继续作为生产运行时 API。

### 1.3 动效数量不等于动作差异

- v2 的 384 个 motion cell 中只有 309 个像素唯一格。
- 一些语义上不同的 clip 复用了完全相同的序列。
- 多个 Boss 依赖相似圆环、孔径与径向构图，只有名称和房间色不同。
- 等速 fps 难以表达 Focus 的停顿、Eye 的强制冻结、数字删除后的材料延迟。

v3 把不同动词必须具有不同像素或不同时间后果写成发布门槛。

### 1.4 预览没有真实播放运行时结构

v2 的六张 GIF 是 Atlas 总览，不是逐条 clip 的真实预览；它们不会完整暴露：

- variable duration 与 hold；
- crossed-frame event；
- Reduced Motion 事件等价；
- Boss normalized anchor；
- Laser 碰撞开关；
- 360×640 高弹量下的可读性。

v3 预览按 manifest 组装 clip、rig、Laser 与压力场，不再把“每格扫一遍”当作动画验证。

### 1.5 UI 与跨局闭环不完整

v2 有 pickup/UI 图形构件，但没有完整的：

- Gameplay/Boss HUD 布局；
- 标题、暂停、设置、Continue、失败；
- 教程行为因果图；
- State Snapshot 与跨局衔接页面；
- 双语文案、示例 run state 与可分发字体。

这会让世界观只存在于素材说明，无法在一次完整 run 中闭环。

### 1.6 视觉时钟与玩法时钟需要分开

v2 示例播放器仍容易让 frame callback 承担 gameplay 事件。大 delta、循环复位、hold、取消、复活、Laser shutdown 与 Reduced Motion 都可能因此产生不同事件结果。

v3 明确：`EventTimeline` 是权威，`VisualTrack` 只能显示，不能改变碰撞或状态。

## 2. v3 的替代关系

| v2 | v3 | 迁移原则 |
|---|---|---|
| `bullets-core.png`、`heavy-projectiles.png` | `atlases/core-grammar-v3.png` 行 0–2 | 只保留明确的微型、中型、重型 threat role；旋转与位移程序化 |
| `player-system.png`、`player-motion-v2.png` | `atlases/core-grammar-v3.png` 行 3 + `atlases/combat-causality-v3.png` 行 0–4 | 玩家核心、Focus、Eye、受击、死亡、带历史重生分开 |
| `enemy-families.png`、`enemy-motion-v2.png` | `atlases/core-grammar-v3.png` 行 5–6 + 程序 hover/recoil | 母型按行为命名；不为每个敌人复制呼吸帧 |
| `boss-systems.png`、`boss-motion-v2.png` | `atlases/boss-topologies-v3.png` + `manifests/v3/boss-rigs.json` | 八种负空间拓扑，不用换色径向徽章 |
| `modular-lasers.png` | `manifests/v3/laser-modules.json` + combat Laser 行 + 状态机 | 中央段程序伸展，只有 live 碰撞 |
| `behavior-vfx.png`、`combat-vfx-v2.png` | `atlases/combat-causality-v3.png` | VFX 必须显示碰撞关闭、数字删除、物质残留的顺序 |
| `narrative-weather.png`、两张 narrative motion/mask | `atlases/narrative-behavior-v3.png` | witness、ghost、cable、scar、天气与 snapshot 按真实数据触发 |
| `pickups-ui.png` | core 拾取行 + 独立 `ui/atlas/ui-atlas.png` | gameplay 拾取与 UI layout 分离 |
| `backgrounds/original`、`mirror-loop` | 四房间 `far/mid/trace/mask` | 背景从壁纸改为可降噪、可写历史的分层场 |
| `cutins.png` | UI 完整页面 + 运行时组装 Boss | Cut-in 不再承担碰撞或系统状态 |
| 六张 overview GIF | manifest 驱动的 clip/rig/Laser/stress preview | 预览必须和实机读取同一数据 |

旧资源中若存在 v3 尚未覆盖的必要角色，不得直接回接。先按 `docs/PRODUCTION_RULES_ZH.md` 为它建立语义、限色、pivot、collision class、时间后果和 QA，再进入 v3。

## 3. 迁移步骤

### 第 0 步：冻结 v2

1. 保留完整 v2 发布目录与 checksum。
2. 不移动、不覆盖、不批量重命名旧文件。
3. 在新代码中禁止新增 `v2 atlas + numeric index` 引用。
4. 搜索并导出所有旧文件名、frame ref、行列号和动画 ID 使用点。

这一步不是删除 v2，而是停止让历史坐标继续扩散。

### 第 1 步：建立语义适配表

把每个仍在使用的旧引用映射到一个 v3 `semanticId`：

```json
{
  "legacy:bullets-core:0": "bullet.micro.notch_e",
  "legacy:player-system:idle": "player.core.idle",
  "legacy:behavior-vfx:graze": "utility.graze.tick"
}
```

适配表只用于迁移期。关卡脚本最终应直接写语义角色，例如：

```ts
spawnProjectile({
  visual: 'bullet.medium.packet',
  collisionClass: 'enemy_projectile_medium',
  threatRole: 'moving_prohibition',
});
```

不要把新的 `semanticId` 再包装成新的数字枚举。

### 第 2 步：更换资源加载器

加载：

- `manifests/v3/asset-manifest-v3.json`
- `manifests/v3/frame-index-v3.json`
- `manifests/v3/animation-clips.json`

加载器必须：

1. 以 `semanticId` 建 Map；
2. 识别 `aliasOf`，避免 `core-projectile-v3` 与 `core-grammar-v3` 重复加载同一 PNG；
3. 读取 manifest 的 rect 与 pivot，不根据图片猜格位；
4. 对缺失语义立即失败，不静默回退到 frame 0；
5. 使用 NearestFilter、无 mipmap、straight binary alpha。

### 第 3 步：把碰撞从动画播放器移走

旧模式：

```text
frame 4 出现 → 开启 Laser 碰撞
```

新模式：

```text
EventTimeline 到达 live 边界
→ collision.on
→ binding graph 通知 VisualTrack 显示 active 帧
```

受击、取消、重弹、复活与 Laser 均使用相同原则：

- 玩家受击：同一时刻先 `collidable=false`，再提交伤害和无敌。
- 弹体：出生后到 arm 边界才碰撞；取消先关碰撞再播残影。
- 复活：先放置，再在独立 gameplay 边界开启碰撞；淡入不控制碰撞。
- Laser：仅 `live` 碰撞；进入 shutdown 或取消的第一项必须是 collision off。
- 高速弹体：使用 swept circle／shape，不只检测大 delta 后的终点。

参考 `manifests/v3/runtime-contract.json`、`manifests/v3/boss-laser-state-machine.json` 与 `manifests/v3/binding-graph.json`。

### 第 4 步：迁移动画时间

不要把 v3 clip 降级成统一 fps：

1. 逐帧读取 duration；
2. hold 并入视觉时长，但不自动推迟玩法事件；
3. 大 delta 必须穿过所有事件边界；
4. 循环事件 key 必须包含 generation 与 loop index；
5. cancel 立即生效且幂等；
6. Reduced Motion 使用同一 EventTimeline，只替换 VisualTrack。

Focus、Eye、Override、删除与跨局的含义主要在时间差里；统一 8fps 会重新抹平它们。

### 第 5 步：迁移 Boss 与 Laser

1. 按 `manifests/v3/boss-rigs.json` 创建 body、weakpoint、emitter、rupture node。
2. 使用 normalized anchor；不得按每帧 bbox 临时修位置。
3. phase 只切换语义状态，Boss body 不整行盲播。
4. 每个 Boss 绑定自己的 Laser module、宽度、节拍与 pattern。
5. `boss-topologies-v3` 第 7 行以外不得重新加入完整同心眼。

### 第 6 步：迁移背景

每个房间从一张背景改为四层：

```text
far → mid → trace → mask → gameplay
```

- 用 `backgrounds/manifest.json` 加载层文件、速度与 opacity。
- 当 Boss active 或弹量达到 120／240 时只压低 mid。
- trace 由本局行为重画，不把交付范例当成永久纹理。
- mask 读取硬 Alpha，不使用 smoothstep 或 blur。
- POLARIZED 系统层可镜像，scar 不镜像。

### 第 7 步：接入 UI 与 State Snapshot

1. 以 `360×640` 正交 UI 坐标读取 `manifests/v3/ui-layouts.json`。
2. Gameplay HUD 分开显示 Light 与 Gaze。
3. Continue、失败、暂停 mini fingerprint 与 Snapshot 读取同一份 run state。
4. 同一 run data 必须生成同一 fingerprint。
5. 新局按 `scar → ghost once → witness turn → return input` 顺序接入。
6. 保留 Reduced Motion、Reduce Flash、High Contrast 与 Void Notch+ 设置。

### 第 8 步：删除运行时 v2 回退

当所有关卡引用完成语义迁移并通过 QA 后：

- 从 production bundle 排除 v2 静态 Atlas 与 motion Atlas；
- 保留 v2 发布目录作为 source/reference archive；
- 删除适配表的静默 fallback；
- 缺失 v3 语义变为 CI error。

不要删除用户的 v2 文件，也不要用 v3 文件覆盖它们。

## 4. 可以保留的 v2 内容

以下内容可以继续作为研究资料：

- 敌人和环境的造型母型；
- 图像生成原板与提示词记录；
- 旧关卡截图与构图参考；
- v2 的历史 validation report；
- 世界观与早期 Three.js 接入说明。

它们属于 `source/reference`，不属于 `runtime`。在美术讨论中引用旧格位没有问题，在玩法代码中直接加载则不允许。

## 5. 分阶段发布策略

| 阶段 | 可同时存在 | 发布阻断 |
|---|---|---|
| A：语义化 | v2 runtime + v3 manifest adapter | 新代码仍新增数字 frame ref |
| B：战斗切换 | v3 player/bullet/combat；旧背景/UI | 视觉帧仍控制碰撞 |
| C：Boss/房间切换 | v3 Boss/Laser/background | Boss 仍用通用径向图；Laser 非 live 碰撞 |
| D：完整体验 | v3 UI、Snapshot、跨局 | Continue/失败/Snapshot 数据不同源 |
| E：清理 | v3 runtime；v2 reference archive | production bundle 仍隐式加载 v2 |

## 6. 迁移验收

- [ ] Gameplay 代码中没有新增 v2 文件名或 numeric frame index。
- [ ] 所有可见对象能追溯到唯一 `semanticId`。
- [ ] `aliasOf` 不会导致重复纹理上传。
- [ ] Full 与 Reduced Motion 的 gameplay event trace 完全一致。
- [ ] 大 delta 不漏 collision off、damage、spawn、completion 或 cancel。
- [ ] 八个 Boss 去色后仍可按负空间轮廓区分。
- [ ] Laser 只有 live 状态可命中。
- [ ] 四房间去色后仍能从运动与空间规则辨认。
- [ ] 背景在 40／120／240 弹压力下不吞掉危险轮廓。
- [ ] State Snapshot 不评分；scar、ghost、witness 会在下一局真实发生。
- [ ] v2 仍可从历史目录恢复，但不进入 production asset graph。
