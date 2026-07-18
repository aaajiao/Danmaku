# 1bit STG v3 最终验证

日期：2026-07-17  
结论：**PASS — 0 error / 0 warning**

## 视觉与图集

- 4 张 `1024×1024` gameplay Atlas，256 个语义帧。
- 256/256 帧均只使用固定八色；普通格最多 4 种可见颜色。
- 256/256 `semanticId` 唯一；pivot 合法且 clip 内无漂移。
- Alpha 仅 `0/255`；所有帧可读取，终端 ghost residue 不再为空。
- 0 组逐像素重复帧、0 组归一化重复帧、0 组重复 clip。
- witness、玩家系统暗体和 cable material 经过暗场可读性复查。

## 动效与运行时

- 41 条 variable-duration clip；Full／Reduced Motion 使用同一 gameplay timeline。
- 34 个绑定节点、20 条单向幂等边；0 反向 authority 边、0 环。
- 12 条 gameplay timeline、7 阶段 Boss Laser 状态机。
- TypeScript strict 编译通过；运行时 10/10 测试通过。
- 大 delta、loop reset、hold、completion/cancel、即时 collision-off、swept collision、IN-BETWEEN 稳定交集全部覆盖。
- `bullet.cancel` 的两帧视觉与 340ms gameplay cleanup 分离；余痕来自完整 bullet lifecycle。

## 背景与压力场景

- 4 房间 × 4 层，共 16 张 `360×1280` runtime texture。
- 背景验证 131/131 PASS；0 error / 0 warning。
- 固定调色板、硬 Alpha、640px 周期无缝、0 个烘焙弹体尺寸高亮。
- 四房间 40／120／240 发逐弹可见性通过。
- 最终 240 发预览按 76% micro／19% medium／5% heavy 的真实池比例渲染，不再把重型 hazard 当普通弹等概率堆叠。

## Boss、Laser、UI 与世界

- 8 个 Boss 使用 8 种不同负空间拓扑；只有 Absolute Reader 允许破损同心眼。
- 8 套 Laser 执行各自的房间调色、宽度、中央 pattern 与生命周期。
- UI Atlas 512×512、64 构件、二值 Alpha；10 张 360×640 页面全部通过尺寸与文件验证。
- Noto Sans SC Variable 与 OFL 许可随包提供。
- 玩家 rig、24 弹体 archetype、16 敌人 archetype、12 弹幕行为模板已机器化声明。

## 真实预览

- 41 条 clip：GIF + APNG + timeline JSON。
- 8 个 assembled Boss：GIF + APNG + PNG。
- 8 套 Laser lifecycle：GIF + APNG + contact sheet + timeline JSON。
- 1 组 360×640／240 发动态压力场景。
- 2 张 combat／narrative variable-duration 动效总览。

## 完整性

- 权威素材清单：`manifests/v3/asset-manifest-v3.json`。
- 权威文件校验：根目录 `checksums-sha256.txt`。
- v2 保留为历史参考，v3 不依赖旧 656 格运行时图集。

