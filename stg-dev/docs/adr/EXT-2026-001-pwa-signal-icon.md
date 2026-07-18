# EXT-2026-001：PWA signal icon

- 状态：ACCEPTED
- 日期：2026-07-18
- 负责人 / 审核人：aaajiao / Codex
- 关联提交：`bac106d`
- aaajiao skill：`1.1.0`；SHA-256 `198092d95e05dd07431f0251e10074be91ad98342228ffd7630d347f32f9acf9`
- V4 package manifest：SHA-256 `d4810598bdb1795cb44b937eb219d4d86f8eeaf3b32c5789a1e9c642bf1dbe70`
- 影响层：projection / platform；不影响 authority、simulation、RNG 或存档

## 不可约事实（Metadata）

安装到设备后的 PWA 需要一个在 launcher、窗口切换器与离线入口中可识别的本地身份。V4 包提供游戏内 UI 和图集，但没有 Web App Manifest 所需的 favicon、Apple Touch、`any` 与 `maskable` 尺寸族。

删除本扩展后，游戏仍能在浏览器运行，但安装后的入口会退回浏览器默认图标，无法确认启动的是哪一个离线内容版本。机制描述：`manifest icon purpose/size → installed application surface`。

## 负空间（Behavior > Content）

图标不代表分数、Boss、房间路线或“最佳玩家”。中心的缺口保持为空，不用完整徽章掩盖应用仍处于工业化基础阶段；青色 registration offset 与洋红 scar 是定位痕迹，不产生玩法含义。

该扩展只让“这是一个可安装、可离线再次进入的本地运行入口”可见。它不新增敌人、奖励、结局、事件或行为指标。

## 数字—物质双螺旋

- 数字侧：Web App Manifest 的 `icons[].src/sizes/purpose` 与浏览器安装状态；
- 材料侧：设备 launcher 上的固定像素表面、中心缺口、registration offset 与 scar；
- authoritative event/state：无；
- restore/witness：无。图标不得被写入 RunMemory，也不得改变 content sampling。

## 做减法结果

- 已检索 V4：游戏内 7 atlases、UI atlas 与 mockups 都有其他语义，复用其中 frame 会把 gameplay identity 错接到平台入口；
- 删除项：文字、角色、Boss、房间图景、渐变、阴影、动画与额外颜色；
- 最小表面：一个 source、一个四合同色 master、8 个运行时派生文件；
- 新增预算：0 event；0 state；0 dependency；849,588 bytes（含未压缩生成来源与全部派生文件）。

## 治理与非单一化

图标由项目维护者审核；后续覆盖任何 PNG 都必须新增或 supersede 本 ADR，并保留 source、prompt、hash 和旧版只读记录。图标不评价玩家，不因设备、输入方式或 Run 路线变化。maskable 与 Apple Touch 版本覆盖不同平台裁切，避免只为单一 launcher 设计。

## 行为契约

- gameplay seed / RNG domain：无；
- canonical tick / event：无；
- collision / safe-gap / warning：无；
- PWA：Manifest 必须提供 192×192 `any`、512×512 `any`、512×512 `maskable`；所有引用返回 PNG；
- failure：图标失败只影响安装表面，不得阻止 RUN 启动或改变离线 gameplay trace。

## Provenance

生成工具：OpenAI image generation tool。运行时没有暴露具体模型 ID 与 seed，这一点作为 provenance 缺口保留，不用猜测值。后处理使用 Pillow `12.1.0`：缩放为 1024×1024、映射到四合同色 palette，并从 master 派生各尺寸。

完整生成提示词：

> Create a square PWA application icon for a 1-bit STG. Center an incomplete white four-petal signal flower around a black square void. Add one tiny cyan registration offset to the right and one magenta scar below-left. Use background #08090D and only the V4 palette #08090D, #EFE9DA, #17A7CA, #F02A92 in the final master. Hard pixel edges, centered composition, generous maskable safe area. No text, numbers, character, weapon, trophy, score symbol, gradient, shadow, glow, antialiasing, transparency, or decorative border.

| artifact | 尺寸 / bytes | SHA-256 |
|---|---:|---|
| `artwork/icon-source-imagegen.png` | 1254² / 828882 | `c0fe1ffe74bbead3d15cf4c0539e22b312b48ba1a70ef07bf7cf7ebb24a994f9` |
| `artwork/icon-master-1024.png` | 1024² / 5294 | `bef71c3501a4b990a9497aa36bf1d89669e829d403c8fea9a18ea385225968a1` |
| `public/icons/apple-touch-icon.png` | 180² / 650 | `c5c44b39569579cd2f0501f4a72d3d9b788d0e6526edd13ff22636dd7e711ec5` |
| `public/icons/favicon-16.png` | 16² / 150 | `c6afff7a76a387559126b631ca097ac29b322f8e018e6eca979b18a4cf7064b5` |
| `public/icons/favicon-32.png` | 32² / 216 | `9611ddf261c09ce098f340e2b6cb9bbc806f5eabb998ef8e7c841b8897acc41f` |
| `public/icons/favicon.ico` | 6 embedded sizes / 9622 | `38abc95d9b59a7ded232e640d358ece0ea60c739569984ffd8e873c6f28c091a` |
| `public/icons/maskable-512x512.png` | 512² / 1901 | `845afbca135b1621d6d3813cd4b567d77f30e9c07e00103d04ee52b7494117b2` |
| `public/icons/pwa-192x192.png` | 192² / 620 | `2e16559965024cb6571955ee1a5cccdd52413ce1e211f7865e54969e92557e1e` |
| `public/icons/pwa-512x512.png` | 512² / 1901 | `845afbca135b1621d6d3813cd4b567d77f30e9c07e00103d04ee52b7494117b2` |
| `public/icons/shortcut-96.png` | 96² / 352 | `d32671abfece148f0a765477c5a6b7fb2e43d866d640848f5cdf3f59de4fd540` |

## 验证证据

- master 像素集合严格等于/属于 `#08090D #EFE9DA #17A7CA #F02A92`；
- Playwright production PWA 测试验证 manifest、purpose、尺寸与每个图标 URL；
- 390px mobile、desktop、离线 production preview 已留 `artwork/qa/` 截图；
- gameplay trace 不读取图标，Full/Reduced Motion/Flash-Off 共用同一文件。

## 回滚与迁移

回滚只修改 manifest/icon projection，不迁移 RunMemory。旧 service worker 可继续缓存旧 hash；新 service worker 在安全更新边界切换，不在当前 Run 中混用内容包。

## 决策

接受。V4 缺少平台安装图标，扩展范围被限制在 PWA projection，并留下 source、prompt、palette、hash 与测试；它没有引入评价体系或第二套 gameplay authority。
