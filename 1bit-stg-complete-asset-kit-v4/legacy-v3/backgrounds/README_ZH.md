# 1bit STG v3 玩法背景系统

这套背景不是四张换色壁纸，而是四种会改变判断方式的场域。背景只留下三类信息：房间身份、协议运动、玩家历史。其余装饰被删除。

![四房间总览](overview.png)

## 交付内容

- `layers/<room>/far.png`：房间的低对比物质底层，完全不透明。
- `layers/<room>/mid.png`：协议运动层，可在 Boss、240 弹压力或 Reduced Motion 下被 gameplay veil 压低。
- `layers/<room>/trace.png`：一条示例历史残留；实机应由玩家路径、停顿、折返和上一轮 scar 动态替换。
- `layers/<room>/mask.png`：二值运行时遮罩。RGB 恒为 `SYSTEM_INK`，shader 应主要读取 Alpha。
- `composites/`：360×640 的 gameplay 合成检查图，不是额外 runtime 依赖。
- `previews/`：每个房间的四层拆解图，以及 40／120／240 弹真实尺寸压力图。拆解图把 mask Alpha 用房间色假色显示；runtime mask 仍为 `SYSTEM_INK`。
- `manifest.json`：Three.js 采样、速度、语义、SHA-256 与双螺旋映射。
- `reports/validation-report.json`：逐层尺寸、调色板、Alpha、循环、占比与房间规则验证。
- `reports/validation-report.md`：给人阅读的验证摘要。
- `scripts/build_background_system.py`：固定 seed、可重复生成的唯一源脚本。

所有 runtime layer 为 `360×1280 RGBA PNG`，内部包含两个相同的 640px 周期。可见 RGB 严格来自 v3 八色调色板，Alpha 只有 `0/255`。

## 四个场域

### INFORMATION / 断裂信息束

不同步的纵向束、失败后平移重试的片段、跨场又中断的旧路。中央有活动但没有稳定轴线，因此不会形成默认安全通道。它的数字面是 packet loss / retry / stale route；物质面是被反复压印、发热、又中断的热敏纸带。

### FORCED CHOICE / 同源镜像差异

左右结构来自同一 seed，但右侧在另一条边缘损耗。中央 seam 由交替桥段与切换门主动占用，不可被玩家理解为永久安全线。它的数字面是一份输入被两套治理执行；物质面是同一模具脱出的两块不等量余料。

### IN-BETWEEN / 双系统交错

正交系统 A 和斜向系统 B 使用不同节拍与方向。宽条而非细密纹理避免 moire；少数交集被设计为可学习的稳定段，但不画成徽记或目标。它的物质对应是两张不同纤维方向的板材叠压。

### POLARIZED / 红黑骨白硬切割

只有 `SYSTEM_INK / SELF_PAPER / POLAR_RED`，无 gray、无渐变、无抖动。`far / mid / mask` 精确镜像；只有 `trace` 中的玩家 scar 破坏镜像。这样“不完整”来自玩家历史，而不是装饰性噪点。

## 运行时约束

1. 使用 NearestFilter，禁用 mipmap、Bloom、线性过滤和子像素滚动。
2. 位置与 UV 滚动均应吸附到物理像素；建议在 60fps 下累计浮点位移，只在提交 shader/mesh 前取整。
3. `far → mid → trace` 正常合成；`mask` 读取 Alpha 后执行硬切，不做半透明柔化。
4. Boss 战或弹量达到 120/240 时只压低 `mid`，不要压低 `trace`：玩家历史仍需可读。
5. Reduced Motion 不能停止场域规则；可降低滚动频率，但 packet gate、seam gate、A/B 交集和 hard-threshold 的事件结果必须保持一致。
6. POLARIZED 的镜像规则只适用于系统层。玩家 scar 必须保留非镜像，否则房间失去历史后果。

Three.js 的最小加载示例见 [Three.js 合成说明](docs/THREEJS_INTEGRATION_ZH.md)。

## 重建与验证

在项目根目录运行：

```bash
python work/v3/backgrounds/scripts/build_background_system.py
```

脚本在任一硬门槛失败时返回非零状态。当前门槛包括：16 张图尺寸与循环逐字节一致、固定调色板、硬 Alpha、房间色/高亮占比、Ink/Paper 双轮廓对比、无弹体大小高亮块、FORCED seam 活动、INFO 中央非安全带、IN-BETWEEN 双系统存在、POLARIZED 镜像与 scar 例外，以及 40／120／240 弹逐枚可见像素比例。

## 视觉禁区

本系统未使用同心圆、四角准星、曼陀罗/魔法阵、电路板城市、浏览器窗口墙、Matrix 字符雨、VHS/RGB glitch、渐变、Bloom、柔光或亚像素噪点。任一 authored layer 中都没有 12×12 或更小的高亮连通块；二值 mask 切过长条时产生的瞬时碎片会在报告中单独计数，并留给 40/120/240 弹实机压力图继续审查。
