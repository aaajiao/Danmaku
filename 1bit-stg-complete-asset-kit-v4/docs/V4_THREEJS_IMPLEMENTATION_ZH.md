# V4 Three.js 实施指南

## 1. 权威层与表现层

建议分成三个单向层：

```text
固定步长 gameplay / ECS
  └─ 发出 canonical event
      └─ FeedbackRouter 根据 accessibility profile 选择 cue
          └─ Three.js sprite / shader / audio / UI / haptic 被动播放
```

禁止从以下信号回写 gameplay：AnimationMixer 完成、材质 alpha、音频播放头、GPU readback、APNG／GIF 帧、UI transition end。

## 2. 纹理加载

```ts
const texture = new THREE.TextureLoader().load(atlas.file);
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;
texture.generateMipmaps = false;
texture.colorSpace = THREE.SRGBColorSpace;
```

V4 图集为 8×8；某帧 `rect=[x,y,w,h]` 的 UV：

```ts
texture.repeat.set(w / 1024, h / 1024);
texture.offset.set(x / 1024, 1 - (y + h) / 1024);
```

关闭纹理旋转、线性采样和运行时 palette 平滑。碰撞体读取 manifest 的 gameplay 参数，不读取 sprite 的透明边界。

## 3. 固定 gameplay clock

使用 60Hz 或项目既有固定 tick。渲染可插值，但 pattern 的 emitter、warning、collision arm、cancel、residue 与 complete 必须以 gameplay tick 计算。

```ts
while (accumulator >= FIXED_DT) {
  gameplay.step(FIXED_DT);
  accumulator -= FIXED_DT;
}
renderer.render(scene, camera);
```

Full、Reduced Motion、Flash-Off 只改变 FeedbackRouter 输出，不改变 `step()` 次数、事件时间或安全通道。

## 4. 弹幕编译

按固定顺序展开：

```text
pattern seed
→ emitter（manifest 顺序）
→ cadence burst（时间、emitter ID、burst index 排序）
→ geometry spawn
→ speed curve
→ motion stack（声明顺序）
→ safe-gap enforcement
→ exact swept warning
```

随机数使用 manifest 指定的 Mulberry32 v1。不要调用 `Math.random()`。一颗弹进入 flight 后由实体拥有生命周期；只有真实 impact、local-void cancel、越界或 pattern 明确的 teardown 才能结束。

Graze key：

```text
projectileInstanceId : generation : playerId
```

每条玩家生命只可接受一次，写入的是 evidence，不是 score 或 combo。

## 5. Override

Override 激活前检查 evidence；成功后生成一个有方向、半径与角度的局部区域。区域内弹体先关闭碰撞，再播放数字删除；每个真实取消坐标写入 `overrideScar`。玩家本体没有全局无敌标志。

材质 `OVERRIDE_MAGENTA` 只在 charge／tear／scar commit 的视觉订阅中出现，不能把整屏反相当作默认效果。Flash-Off 使用稳定边界帧，事件时刻不变。

## 6. Boss

Boss rig 包含 weakpoint、emitter、三阶段空间法则、激光几何与 resolution metric。HP 可以作为结构压力，但终局读取 `resolution.terminal`；八个 Boss 不共享一个 `death` 结尾。

转相顺序：

```text
旧阶段 collision off
→ phaseChanged event
→ topology rupture / material response
→ 新阶段 exact warning
→ 新阶段 collision arm
```

任何视觉 dissolve 都不能替代这条顺序。

## 7. 房间、天气与跨局

房间切换先取得 player collision blocker lease；新世界完全提交后释放。不要直接写一个共享布尔值，否则受击、切房与 Snapshot 会互相提前恢复碰撞。

天气只偏置视觉、声音和材料，不移动弹体或安全通道。跨局使用 narrative manifest 的同一权威顺序：scar／death trace／burn-in 复水 → ghost 真路径播放一次 → ghost residue → witness turn → input return。

## 8. 生产裁剪

开发包包含 sources、APNG／GIF、报告和 legacy 文档；最终游戏通常只需要：

- `atlases/`；
- `backgrounds/composites/` 与 `backgrounds/reactions/`；
- `audio/assets/`；
- `ui/atlas/`；
- `manifests/v4/`、`gameplay/`、`runtime/`、`narrative/`、`integration/`；
- 项目需要的 TypeScript runtime。

不要把预览 GIF 当运行时 texture；它们是动态 QA 证据。

