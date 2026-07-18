# Three.js 合成说明

## 纹理设置

```js
import * as THREE from 'three';

function configureBackgroundTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  return texture;
}
```

文件为 360×1280，包含两个相同的 640px 周期。使用整张纹理时，`repeat.y = 0.5` 正好显示一个 360×640 玩法窗口；随后以整像素步进改变 `offset.y`。

```js
texture.repeat.set(1, 0.5);

// accumulatedScrollPx 可以是浮点；提交给纹理前量化。
const snappedPx = Math.round(accumulatedScrollPx);
texture.offset.y = (snappedPx % 640) / 1280;
```

如果 mesh UV 的 y 方向与画面滚动相反，只需取负号；不要切换到线性采样补偿方向。

## 层顺序

```text
far       normal, opacity 1.00, room identity
mid       normal, opacity 0.72, protocol movement
trace     normal, opacity 0.48, player-history residue
mask      read alpha, hard overwrite/gate
gameplay  bullets / actors / collision debug
```

`mask.png` 的 RGB 是 `SYSTEM_INK`，Alpha 是二值场。最简单的做法是作为普通透明平面放在 trace 上方；更完整的做法是在背景 shader 中读取 Alpha，选择 `far/mid` 是否被 SYSTEM_INK 硬切。禁止 smoothstep、blur 或淡入。

## 滚动与 Reduced Motion

各层建议速度在 `manifest.json` 的 `scrollPxPerSec`。默认值分别为 far 4、mid 13、trace 7、mask 21 px/s。为了保持硬像素：

- 内部时钟可连续累计；渲染坐标只能提交整数像素。
- Reduced Motion 可把视觉提交频率降到 8Hz 或把速度降低到 25%，但协议事件时钟仍按原时间运行。
- 暂停菜单冻结所有层；恢复时从同一整数坐标继续，不能按 wall clock 跳帧。

## Gameplay veil

veil 不是全屏灰滤镜，而是对 `mid` 一层的定量削弱：

```js
const midOpacity = bulletCount >= 240 ? 0.32
  : bulletCount >= 120 || bossActive ? 0.42
  : 0.72;
```

`far` 保持房间身份，`trace` 保持玩家历史，`mask` 保持机制结果。这样压力升高时减少协议噪声，却不会删除世界观信息。

## trace 的运行时替换

交付的 trace 是可验证的范例。实际运行应将最近一段玩家行为写入同尺寸 CanvasTexture：

1. 将路径点量化到整数像素。
2. 只画水平/垂直硬线或房间允许的斜向硬板。
3. 停顿写成长度至少 14px 的横向 ledge；折返保留，不平滑。
4. 只使用该房间允许的 `FRICTION_GRAY / roomColor`；POLARIZED 只用 `SELF_PAPER` scar。
5. 不写入碰撞，不生成居中徽记，不把轨迹闭合为圆。
6. 跨周目时把 scar 的坐标偏移存入 State Snapshot，并在下一轮从该偏移继续。

## 房间 mask 解释

- INFORMATION：遮掉整段 packet，制造旧路烧屏与当前路中断的差异。
- FORCED CHOICE：交替控制 seam 左/右，中央永远是治理切换区而非安全线。
- IN-BETWEEN：遮掉 A/B 不一致的区域，保留可学习的稳定交集。
- POLARIZED：镜像的硬阈值切片；只有 trace 的 scar 可以不镜像。

## 调试建议

开发模式一次只显示一层，并在屏幕上标注 `room/layer/scrollPx`。不要用颜色给碰撞层着色；碰撞权威仍由 gameplay runtime 管理，背景 mask 只提供视觉与房间事件的索引。发布前对 40/120/240 弹三档分别截图，确认弹体的 Ink/Paper 轮廓不被背景吞掉。

