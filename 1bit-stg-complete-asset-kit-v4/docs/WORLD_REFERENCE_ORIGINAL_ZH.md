# 🏛 1bit - 设计哲学与路线图

## 🏛 哲学核心

### 1. 1-Bit 美学作为“存在与虚无”

在《1bit》中，1-bit 不仅仅是一个复古的风格选择；它是一个形而上学的声明。
- **黑色 (#000000) 代表系统**：绝对、僵化、虚无。
- **白色 (#FFFFFF) 代表自我**：信号、转瞬即逝、观察者。
- **抖动 (Dithering) 代表噪声**：系统与自我之间的摩擦。

> 实现注：运行时每个房间使用一组贴近黑白的双色调墨/纸色（见 RoomConfig 的 ink/paperColor——INFO 青、FORCED_ALIGNMENT 琥珀、IN_BETWEEN 紫、POLARIZED 暖红/骨白）；纯黑白 #000/#FFF 是概念基准与隐喻锚点。

### 2. 叙事弧线：“压抑与欲望”（李安式手法）

我们不将交互视为一场游戏，而是一个心理压力锅。
- **天空之眼 (Sky Eye) (权威)**：一个沉默、巨大的存在，要求臣服。
- **花 (The Flower) (欲望)**：一束脆弱的、内在的光。它美丽但危险；把它调得太亮会吸引眼睛的注视。
- **凝视 (The Gaze) (规训)**：注视权威会调暗你自己的光。反抗是可能的，但会导致“系统溢出”（故障）。

---

## 🎭 叙事与心理基础

### 1. 压抑作为应对机制
在这个世界里，生存等同于压抑。为了在天空之眼下安全存在，人们必须调暗内心的“花”——他们的欲望、身份和光芒。游戏不是关于通过力量“获胜”，而是关于在顺从或表达的代价之间导航。

### 2. 反应的原型
- **顺从的倾听者**：保持花朵昏暗并避免眼睛注视的玩家。他们体验到一个稳定虽然沉闷的世界。
- **边界测试者**：在亮与暗之间摇摆的玩家，看系统在反应之前能忍受多少“噪声”。
- **反抗者**：面对权威强行将光调至最高强度的玩家，选择“故障”（系统崩溃）而非安全。

---

## 🚶 玩家旅程

### 第一阶段：觉醒（安静的循环）
- 玩家在极简的 1-bit 环境中醒来。
- **初始感觉**：孤独、沉默。“花”很暗。
- **目标**：通过行走和调整光线强度进行学习。

### 第二阶段：第一眼（直面权威）
- 天空之眼出现在地平线/天空中。
- **初始感觉**：脆弱。
- **系统响应**：如果玩家看向眼睛，屏幕对比度会变硬，音频进入闷响的低通状态。

### 第三阶段：堕入精神状态
- 世界开始生成不同的“房间”（精神状态）。
- **INFO_OVERFLOW**：被过多的信号淹没的感觉。
- **FORCED_ALIGNMENT**：被迫选择“一边”（左或右）的压力。

### 第四阶段：解决（状态快照）
- 运行结束后，玩家会收到一份“状态快照”。
- 这是对他们在运行期间心理选择的非评判性总结。

---

## ⚙️ 技术交互闭环

描述玩家做什么（输入）以及系统响应（反馈）。

### 1. 凝视机制（视角输入）

- **玩家动作**  
  仰望天空之眼（俯仰角 > 45°）。
- **系统反馈（视觉）**  
  `FlowerProp` 强度被强制设定为低值（例如 0.1）。  
  `DitherShader` 将 `uContrast` 从 1.0 偏移至 1.8（使图像更刺眼）。
- **系统反馈（音频）**  
  `AudioSystem` 在 0.5 秒内触发 `LowPassFilter` 转换。环境音变得沉闷。
- **心理效果**  
  玩家感到被“规训”。他们的主观光被权威的客观凝视所抑制。

### 2. 溢出机制（强度输入）

- **玩家动作**  
  在高噪声区域（`INFO_OVERFLOW`）将花的强度增加到 1.0。
- **系统反馈（视觉）**  
  `DitherShader.uTemporalJitter` 从 0.2 增加到 0.9。场景开始“振动”。
- **系统反馈（音频）**  
  高频数字啁啾声（数据噪声）音量增加。
- **心理效果**  
  感官过载。玩家意识到“更多的光”并不意味着“更多的清晰度”；它只会增加噪声。

### 3. 分裂机制（位置输入）

- **玩家动作**  
  在 `FORCED_ALIGNMENT` 中沿着“裂缝”行走。
- **系统反馈（视觉）**  
  `VertexShader` 对裂缝附近的建筑网格应用微妙的“摆动”（正弦波）。
- **系统反馈（音频）**  
  播放双耳节拍，左耳与右耳音调略有失谐（~20Hz 差异）。
- **心理效果**  
  感到“处于中间”。不选边站队产生的不适感。

### 4. 迷失机制（下坠输入）

- **玩家动作**  
  在 `FORCED_ALIGNMENT` 中跳入裂缝深渊。
- **系统反馈（物理/视觉）**  
  重力系数瞬间降低（模拟月球重力），创造漫长、失重且加速的下坠感。周围雾气高速掠过。下坠至 -150m 时被强制重置回边缘。
- **心理效果**  
  尝试逃离二元对立的后果是陷入虚无的循环。坠落不是解脱，而是另一种被困。

### 5. 反抗（覆盖键）

- **玩家动作**  
  在 `POLARIZED` 房间中注视天空之眼时按下“覆盖”键（例如 Space 或 Shift）。
- **系统反馈（视觉）**  
  `Flower.intensity` 被强制设定为 1.0。`PostProcessing` 触发“颜色反转”闪烁。`DitherShader` “崩溃”（显示原始三角形 0.1 秒）。
- **系统反馈（音频）**  
  播放响亮的数字“撕裂”声（白噪声爆发）。
- **心理效果**  
  挑衅。打破模拟规则，哪怕只有一秒。

### 6. 状态快照（运行结束）

- **系统动作**  
  根据采样指标计算总结。
- **系统反馈（视觉）**  
  生成独特的程序化 1-bit 噪声图案作为运行的“指纹”。
- **系统反馈（文本）**  
  出现一段简短的、观察性的文本（杨德昌风格）：*“你试图看清一切，结果却什么也没看清。”*

---

## 📊 状态快照：运行时指标与日志

为了生成运行结束的“状态快照”，我们以非侵入方式跟踪玩家行为。

### 7. 数据收集模型

```typescript
interface RunStats {
  duration: number;        // 总秒数
  samples: number;         // 记录的数据点数量
  
  // 花/光
  flowerIntensitySum: number;
  
  // 凝视（天空之眼）
  gazeEvents: number;      // 注视眼睛的次数
  gazeTimeTotal: number;   // 注视的总秒数
  gazeDepthMax: number;    // 达到的最大俯仰角
  
  // 位置/房间
  roomTime: Record<string, number>; // 在每个精神状态房间花费的时间
  onCrackTime: number;     // 在“中立区”（FORCED_ALIGNMENT）花费的时间
  xPositionMin: number;
  xPositionMax: number;
  
  // 反抗
  overrideAttempts: number;
  overrideSuccesses: number;
  overrideTimeTotal: number;
}
```

#### 7.1 记录策略

我们每 **2.0 秒** 采样一次，以避免性能开销。

```typescript
function updateRunStats(deltaTime) {
  runStats.duration += deltaTime;
  
  const isCurrentlyGazing = player.camera.rotation.x > Math.PI / 4;
  const isOverrideActive = player.input.isDown('OVERRIDE');
  
  // 采样周期性数据
  sampleTimer += deltaTime;
  if (sampleTimer > 2.0) {
    runStats.samples++;
    runStats.flowerIntensitySum += flower.intensity;
    sampleTimer = 0;
  }
  
  // 基于事件的跟踪
  if (isCurrentlyGazing && !wasGazingLastFrame) {
    runStats.gazeEvents++;
  }
  if (isCurrentlyGazing) {
    runStats.gazeTimeTotal += deltaTime;
    runStats.gazeDepthMax = Math.max(runStats.gazeDepthMax, camera.rotation.x);
  }
  
  // 跟踪房间类型
  const currentRoom = chunkManager.getCurrentRoomType();
  if (currentRoom !== runStats.currentRoom) {
    runStats.currentRoom = currentRoom;
  }
  runStats.roomTime[currentRoom] = (runStats.roomTime[currentRoom] || 0) + deltaTime;
  
  // 跟踪位置
  runStats.xPositionSum += player.position.x;
  runStats.xPositionMin = Math.min(runStats.xPositionMin, player.position.x);
  runStats.xPositionMax = Math.max(runStats.xPositionMax, player.position.x);
  if (Math.abs(player.position.x) < 5.0) {
    runStats.onCrackTime += deltaTime;
  }
  
  // 跟踪覆盖
  if (isOverrideActive && !wasOverrideActiveLastFrame) {
    runStats.overrideAttempts++;
  }
  if (isOverrideActive) {
    runStats.overrideTimeTotal += deltaTime;
    if (isGlitchingFromOverride) {
      runStats.overrideSuccesses++;
    }
  }
  
  wasGazingLastFrame = isCurrentlyGazing;
  wasOverrideActiveLastFrame = isOverrideActive;
}
```

#### 7.2 归一化阶段

当运行结束时，原始统计被转换为归一化的 0–1 指标：

```typescript
function normalizeRunStats(rawStats: RunStats): NormalizedMetrics {
  const avgFlower = rawStats.flowerIntensitySum / rawStats.samples;
  const gazeRatio = rawStats.gazeTimeTotal / rawStats.duration;
  const overrideRatio = rawStats.overrideTimeTotal / rawStats.duration;
  
  // 玩家在哪个房间待的时间最长？
  const roomRatios = {};
  for (const [room, time] of Object.entries(rawStats.roomTime)) {
    roomRatios[room] = time / rawStats.duration;
  }
  
  // 玩家向左还是向右走得更远？
  const centerX = (rawStats.xPositionMax + rawStats.xPositionMin) / 2;
  const spreadX = (rawStats.xPositionMax - rawStats.xPositionMin) / 2;
  const crackRatio = rawStats.onCrackTime / rawStats.duration;
  
  return {
    avgFlower,      // 0–1
    gazeRatio,      // 0–1
    overrideRatio,  // 0–1
    roomRatios,     // { INFO: 0–1, FORCED: 0–1, IN_BETWEEN: 0–1, POLARIZED: 0–1 }
    crackRatio,     // 0–1
    spreadX,        // 0–? (绝对距离)
  };
}
```

#### 7.3 标签生成

归一化指标被转换为离散的、人类可读的标签：

```typescript
function generateRunTags(metrics: NormalizedMetrics): string[] {
  const tags = [];
  
  // 光强标签
  if (metrics.avgFlower < 0.25) {
    tags.push('QUIET_LIGHT');
  } else if (metrics.avgFlower < 0.6) {
    tags.push('MEDIUM_LIGHT');
  } else {
    tags.push('LOUD_LIGHT');
  }
  
  // 凝视关系标签
  if (metrics.gazeRatio > 0.5) {
    tags.push('HIGH_GAZE');
  } else if (metrics.gazeRatio < 0.15) {
    tags.push('LOW_GAZE');
  }
  
  // 房间主导地位标签
  const dominantRoom = Object.entries(metrics.roomRatios)
    .reduce((a, b) => a[1] > b[1] ? a : b)[0];
  
  const roomTagMap = {
    'INFO_OVERFLOW': 'INFO_MAZE',
    'FORCED_ALIGNMENT': 'CRACK_WALKER',
    'IN_BETWEEN': 'INBETWEENER',
    'POLARIZED': 'BINARY_EDGE',
  };
  
  tags.push(roomTagMap[dominantRoom]);
  
  // 位置标签
  if (metrics.crackRatio > 0.3) {
    tags.push('NEUTRAL_SEEKER');
  }
  
  // 反抗标签
  if (metrics.overrideRatio > 0.05) {
    tags.push('RESISTER');
  }
  
  return tags;
}
```

**标签语义：**

- `QUIET_LIGHT`：玩家大多保持花朵变暗。
- `LOUD_LIGHT`：玩家偏好明亮的花朵。
- `MEDIUM_LIGHT`：玩家使用中等光强。
- `HIGH_GAZE`：玩家经常注视眼睛。
- `LOW_GAZE`：玩家避免注视眼睛。
- `INFO_MAZE`：大部分时间在 INFO_OVERFLOW 中。
- `CRACK_WALKER`：大部分时间在 FORCED_ALIGNMENT 中（特别是在裂缝上）。
- `INBETWEENER`：大部分时间在 IN_BETWEEN 中。
- `BINARY_EDGE`：大部分时间在 POLARIZED 中。
- `NEUTRAL_SEEKER`：在裂缝上花费了大量时间（FORCED_ALIGNMENT）。
- `RESISTER`：使用了覆盖机制（至少一次）。

#### 7.4 视觉图案生成

标签驱动一个程序化 1-bit 纹理，在运行结束时短暂显示。

**图案选择逻辑：**

```glsl
// 在 StateSnapshot.frag (Fragment Shader) 中

uniform int uPatternMode;  // 0: noise, 1: stripes, 2: checker, 3: radial
uniform float uDensity;    // 填充密度 (0–1)
uniform float uFrequency;  // 图案频率
uniform float uPhase;      // 偏移/旋转

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float pattern = 0.0;
  
  if (uPatternMode == 0) {
    // 噪声：基于 Perlin/simplex
    pattern = noise(uv * uFrequency);
  } else if (uPatternMode == 1) {
    // 条纹：带角度的平行线
    pattern = sin((uv.x + uv.y * tan(uPhase)) * uFrequency) * 0.5 + 0.5;
  } else if (uPatternMode == 2) {
    // 棋盘格
    pattern = mod(floor(uv.x * uFrequency) + floor(uv.y * uFrequency), 2.0);
  } else if (uPatternMode == 3) {
    // 径向：同心圆或螺旋
    pattern = sin(length(uv - 0.5) * uFrequency + uPhase) * 0.5 + 0.5;
  }
  
  // 应用密度：通过阈值获得 1-bit 输出
  if (pattern > (1.0 - uDensity)) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); // 白色
  } else {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // 黑色
  }
}
```

**标签到图案的映射：**

```typescript
function getPatternFromTags(tags: string[]): ShaderUniforms {
  let patternMode = 0;
  let density = 0.5;
  let frequency = 8.0;
  let phase = 0.0;
  
  // 主要环境标签决定基础图案
  if (tags.includes('INFO_MAZE')) {
    patternMode = 0;  // 噪声
    frequency = 16.0; // 高频以获得“混乱”感
    density = 0.7;
  } else if (tags.includes('CRACK_WALKER')) {
    patternMode = 1;  // 条纹
    frequency = 12.0;
    phase = Math.PI / 2; // 垂直条纹
  } else if (tags.includes('INBETWEENER')) {
    patternMode = 2;  // 棋盘格
    frequency = 10.0;
    density = 0.6;
  } else if (tags.includes('BINARY_EDGE')) {
    patternMode = 3;  // 径向
    frequency = 10.0;
    phase = Math.random() * Math.PI * 2;
  }
  
  // 次要光强标签修改密度
  if (tags.includes('QUIET_LIGHT')) {
    density -= 0.2; // 稀疏图案
  } else if (tags.includes('LOUD_LIGHT')) {
    density += 0.2; // 稠密图案
  }
  
  // 反抗标签增加混乱度
  if (tags.includes('RESISTER')) {
    frequency *= 1.5;
    density += 0.1;
  }
  
  return {
    uPatternMode: patternMode,
    uDensity: Math.clamp(density, 0.1, 0.9),
    uFrequency: frequency,
    uPhase: phase,
  };
}
```

**显示机制：**

图案被渲染到一个小四边形（例如 256×256 或 512×512）并显示在屏幕右下角，或在玩家下方的地面上短暂覆盖。它在 0.5 秒内淡入，保留 2 秒，然后在 1 秒内淡出。图案无缝循环/平铺以填充四边形。

#### 7.5 文本选择与组成

使用相同的标签，通过预先写好的句子的组合创建文本快照。

**文本库（杨德昌风格）：**

> 运行时文本为中英双语对（zh 主 + en 次），见 StateSnapshotGenerator.TEXT_TABLE。

语气是观察性的、非评判性的、略带忧郁的，并且特定于每位玩家所表现出的原型。

```typescript
const textTable = {
  QUIET_LIGHT: [
    {
      zh: "你把自己调暗一点，世界就安静了一点。"
    },
    {
      zh: "你让光保持很低，这似乎有帮助。"
    }
  ],
  
  LOUD_LIGHT: [
    {
      zh: "就算没人开口，你还是把光开得很亮。"
    },
    {
      zh: "你把它开得越亮，看着就越疼。"
    }
  ],
  
  MEDIUM_LIGHT: [
    {
      zh: "你找到了一个折中方案，虽然它从来没感觉过完全对。"
    }
  ],
  
  HIGH_GAZE: [
    {
      zh: "这一趟，你大部分时间都在抬头看。"
    },
    {
      zh: "那只眼睛总在那儿，你停不下来确认。"
    }
  ],
  
  LOW_GAZE: [
    {
      zh: "你很少去确认，那只眼睛还在不在。"
    },
    {
      zh: "你大多把视线放在地上。"
    }
  ],
  
  INFO_MAZE: [
    {
      zh: "你走过很多信号，却没遇到多少回答。"
    },
    {
      zh: "你试图看得越多，理解得越少。"
    }
  ],
  
  CRACK_WALKER: [
    {
      zh: "你在裂缝上待的时间，比大多数人久一点。"
    },
    {
      zh: "中间总是最难站的地方。"
    }
  ],
  
  NEUTRAL_SEEKER: [
    {
      zh: "你更喜欢没什么确定的地方。"
    }
  ],
  
  INBETWEENER: [
    {
      zh: "你总是走进一些，不太算是谁的地方。"
    },
    {
      zh: "不管你去哪儿，你总是被误读。"
    }
  ],
  
  BINARY_EDGE: [
    {
      zh: "你一直走到一个地方，那里所有事都只能是这样或那样。"
    },
    {
      zh: "在纯黑白中，没有呼吸的空间。"
    }
  ],
  
  RESISTER: [
    {
      zh: "你有一次把画面弄坏了，它后来恢复了，但已经不太一样。"
    },
    {
      zh: "你试着说不，一瞬间，世界听了。"
    }
  ]
};
```

---

## 🧠 关卡设计：精神状态空间

### 核心设计理念

我们实现的是**精神状态空间**，而不是线性关卡。

- 我们**不**通过“通关”房间来限制进度。房间在每次游玩（session）中被抽样并重组（就像情绪天气一样），而不是线性解锁。
- 我们**不**为“赢”房间提供显式奖励。
- 我们**确实**提供了理解玩家自身反应模式的隐性奖励。

---

### 1. INFO_OVERFLOW（高噪声，无响应）

**概念框架**

过度连接的焦虑：你向虚空呐喊，虚空以静电噪音回应。这个房间反映了无休止滚动社交媒体的体验，看到如山般的信息却收不到任何反馈、任何对话、任何被倾听的感觉。

**视觉语言**

- 高频抖动图案（0.8–1.0 密度），创造视觉“噪声”。
- 远处的建筑根据花的强度每 2–6 秒闪烁并交换几何形状。
- 数字雨：以不同速度下降的垂直线，像下落的数据包。
- 无明确焦点；眼睛无法在任何地方停留。
- 地平线未明确定义；世界在 30 米内淡入纯噪声。

**音频语言**

- 基础层：持续的低频嗡嗡声（~60 Hz），几乎难以察觉但会产生潜意识的不安。
- 第二层：以不同频率（2–10 kHz）发出随机的哔哔声和啁啾声，产生“错过消息”或“读不出的通知”的感觉。
- 哔哔声的频率和强度随花朵亮度增加而增加。
- 无节奏或模式；声音不可预测，防止听者通过重复产生预期或寻求慰藉。

**交互机制**

```typescript
// INFO_OVERFLOW 特定系统
const noiseDensityMap = {
  0.1: 0.75,  // 调暗光线
  0.3: 0.82,
  0.5: 0.88,
  0.7: 0.95,
  1.0: 1.0    // 全亮度 = 最大噪声
};

const buildingRefreshIntervalMap = {
  0.1: 6.0,   // 变暗：建筑保持稳定
  0.3: 5.0,
  0.5: 3.5,
  0.7: 2.5,
  1.0: 1.5    // 变亮：混乱
};
```

**在 INFO_OVERFLOW 中的玩家旅程**

1. **初始进入**：玩家的本能是调亮光线以“看得更清”。
2. **负反馈**：光线越亮，世界变得越混乱；他们意识到增加光线会适得其反。
3. **适应**：玩家学会将光强度保持在 0.3–0.4 左右（低-中等），找到一种“可忍受”的噪声水平。
4. **挥之不去的怀疑**：即使在最佳设置下，也没有进步感或理解感。信息流不断，却没有任何问题得到解决。
5. **退出选项**：玩家可以穿过房间并退出（没有“陷阱”），但在没有得到答案的情况下离开会产生心理压力。

**设计意图**

这个房间告诉玩家 **更多的输入 ≠ 更多的理解**。这是对当代信息过载现象的冥想，即持续的刺激反而荒谬地导致了麻木和消极。

---

### 2. FORCED_ALIGNMENT（分裂的世界）

**概念框架**

被迫选边站队的压力。不准存在真正的中立。这个房间体现了当代社会/政治话语的极化，即细微差别被折叠成二元对立，而中立被视为背叛。

**视觉语言**

- 一条巨大的垂直裂口将空间分为左、右两半。
- 左侧：整洁、几何化且光照充足的结构（低抖动密度 ~0.4）。美学上洁净但有序得令人压抑。
- 右侧：破碎、有机且部分坍塌的结构（高抖动密度 ~0.7）。混乱但视觉上更“诚实”。
- 裂缝本身：一个纯黑的深渊，物理上允许无限下坠。
- 像意识形态横幅一样跨越裂口、紧绷且颤抖的线缆。

**音频语言**

- 左侧：轻柔播放的单一、持续和谐音（大三度，~330 Hz 和 ~550 Hz），唤起稳定与秩序感。
- 右侧：以同样音量播放的不和谐音（三全音或 sus-2 和弦），产生轻微的不安感。
- 裂缝处：两种音调同时播放，产生干涉拍频（~20 Hz），产生令人极度不适的脉动不和谐音，无法长时间忍受。
- 双耳节拍频率根据玩家的 X 位置而变化，形成映射到空间位置的动态音频景观。

**在 FORCED_ALIGNMENT 中的玩家旅程**

1. **初始遭遇**：玩家看到分裂，最初被吸引去探索两侧。
2. **发现舒适区**：完全移向一侧会使世界感觉更“连贯”（抖动更少，地面稳定，音频悦耳）。
3. **心理成本**：但待在一侧意味着接受另一侧的扭曲（它变得嘈杂且不稳定）。玩家成为“抹除”另一种视角的共犯。
4. **中立选项**：玩家可以回到裂缝处，忍受处于两者之间的不适感。这是“觉醒”的选择，但它充满痛苦。
5. **重复选择**：玩家可能会在两侧和裂缝之间摇摆，反复测试边界和代价。

**设计意图**

这个房间将政治/意识形态立场的内部冲突具象化。它不提供“正确”的答案：两边同样有效但也同样局促。裂缝在原则上是“正确”的，但在心理上是难以为继的。游戏对所有三种策略均予以肯定，不做排名。

---

### 3. IN_BETWEEN（故障）

**概念框架**

同时被两个系统误读：在一个语境中被视为噪声而排斥，在另一个语境中仅由于被视为信号而勉强被接受。这个房间是为那些无法整齐地归入既定类别的人准备的——少数族裔、混合体、那些被夹在文化或身份之间的人。

**视觉语言**

- 两个重叠的建筑系统，具有互不兼容的视觉语言：一个是直线的、整洁的，另一个是破碎的、有机的。
- 边界处于发生深度冲突（Z-fighting，纹理争抢），在系统交汇处产生视觉噪声。
- 几何体具有歧义性：部分以一种系统的风格渲染，部分以另一种风格渲染。
- 表面会根据那一刻被哪个系统“宣称主权”而以不同方式反射光线，产生闪烁的外观。
- 地面：双层网格，一层相对于另一层旋转约 30°，产生莫尔纹（moiré）图案。

**音频语言**

- 系统 A：以低音量播放的和谐和弦（纯五度，协和）。
- 系统 B：以同样音量播放的不和谐和弦（三全音或音团）。
- 边界处：两个和弦重叠，产生复杂的声学干涉。
- 玩家的光会在每个系统中触发不同的共鸣（系统 A：确认音；系统 B：警报音）。

**在 IN_BETWEEN 中的玩家旅程**

1. **发现**：玩家遇到不兼容的系统，并意识到他们的反应会随语境而变化。
2. **挫败感**：在系统 A 中奏效的行为会在系统 B 中引发问题，反之亦然。玩家无法“始终保持正确”。
3. **适应**：玩家学会通过在每个系统的领地内遵循该系统的规则来进行导航。
4. **更深层的领悟**：即使是这种适应性的策略在边界处也会失效；玩家发现没有放之四海而皆准的解决方案。
5. **应对**：玩家要么选择心理隔离（分别对待每个系统），要么拥抱歧义（接受矛盾）。

**设计意图**

这个房间反映了人们在多个互不兼容的社会系统中穿梭的亲身经历。这里没有“解决方案”；只有日常的语境切换实践及其产生的心理损耗。游戏肯定了心理隔离和拥抱歧义这两种策略。

---

### 4. POLARIZED（纯粹二元）

**概念框架**

完全臣服于 1-bit 逻辑：没有灰色，没有抖动，只有生硬的决定。在这个房间里，世界已经坍缩成纯粹的二元对立，细微差别被彻底抹除，每一次选择都是一个二元开关。

**视觉语言**

- **零抖动**：纯 1-bit 渲染。世界完全由纯黑和纯白组成（实现为暖红/骨白双色调），边界极其锐利。
- **无渐变或阴影**：所有表面要么被完全照亮（白色），要么完全处于阴影中（黑色）。
- **几何精度**：所有几何体均由长方形、立方体和线组成。没有曲线，没有有机形状。
- **棋盘格地面**：最标志性的 1-bit 图案，强调黑白二元性。
- **作为边界的电缆**：所有电缆和线条都追踪精确的黑白边界，构成了世界的骨架。
- **天空之眼**：主宰视觉场，巨大到不可议，以 1-bit 同心圆的形式呈现。

**音频语言**

- **二元哔哔声**：唯一的声音是两个频率（例如 440 Hz 和 880 Hz）的清脆数字声，代表“开”和“关”。
- **音调毫无歧义**：没有延音，没有淡入淡出，只有突然的开启和关闭。
- **节奏**：哔哔声遵循一种简单且无情的 4/4 拍节拍，像数字脉冲或时钟滴答声一样，无法逃避且充满机械感。
- **注视强化**：盯着眼睛看时，哔哔声会略微加快，产生一种压力增加的感觉。

**设计意图**

这个房间是游戏的哲学高潮。它代表了二元逻辑的权威终点：在这个世界里，细微差别、妥协和歧义不仅不被鼓励，而且在技术上是不可能的。“覆盖”并非一种“超能力”，而是一种挑衅性的姿态——因其徒劳而显得美丽。

---

## 🎛 参数参考

### 着色器 Uniforms

```glsl
// 所有房间的全局参数
uniform float uNoiseDensity;    // 0–1，控制抖动图案密度
uniform float uThresholdBias;   // -0.5 到 0.5，偏移黑白平衡
uniform float uTemporalJitter;  // 0–1，控制抖动的时间轴动画
uniform float uContrast;        // 1.0+ 控制整体对比度
uniform float uCRTCurvature;    // 0–0.1，CRT 监视器曲线畸变
uniform float uScanlineIntensity; // 0–1，水平扫描线效果

// 顶点位移（故障）
uniform float uGlitchAmount;    // 0–1，顶点位移幅度
uniform float uGlitchSpeed;     // Hz，故障动画频率

// 颜色效果
uniform float uColorInversion;  // 0–1，0=正常，1=完全反转
uniform float uSaturation;      // 0–1，0=灰度，1=全彩
```

---


---

## 📍 现状评估

在实施路线图之前，以下是对现有代码库的评估：

### 现有模块

> 注：本表为开发前快照。所列模块现已全部实现并接线。

| 模块 | 状态 | 备注 |
|--------|--------|-------|
| `DitherShader.ts` | **部分完成** | 拥有基本的 Bayer 抖动、边缘检测、天气效果。缺失：`uNoiseDensity`、`uThresholdBias`、`uTemporalJitter`、`uContrast` 等每个房间的 uniform 变量。拥有用于昼夜交替的 `invertColors`。 |
| `ChunkManager.ts` | **需扩展** | 生成带有建筑/线缆的程序化分块。没有 `roomType` 枚举或精神状态房间配置。 |
| `FlowerProp.ts` | **需扩展** | 拥有花瓣/花萼/尘埃动画的视觉花朵。没有 `setIntensity()` 方法或强度控制。 |
| `AudioSystem.ts` | **部分完成** | 带有脚步声、环境嗡嗡声、线缆脉冲、眨眼声、昼夜声音的 Web Audio API。缺失：用于注视的低通滤波器、每个房间的音频层、双耳节拍。 |
| `Controls.ts` | **需扩展** | 基本的 FPS 控制（WASD + 鼠标观看）。没有注视检测（俯仰角 > 45°），没有覆盖键处理。 |
| `SkyEye.ts` | **存在** | 天空之眼视觉效果已存在。需与注视机制集成。 |
| `RunStats` | **未开始** | 没有运行时指标收集基础架构。 |
| `StateSnapshot` | **未开始** | 没有运行结束总结生成。 |

### 需新增模块

- `RunStatsCollector.ts` - 运行时行为采样
- `StateSnapshotGenerator.ts` - 标签生成与图案渲染
- `RoomConfig.ts` - 每个房间的着色器/音频配置
- `GazeMechanic.ts` - 注视检测与响应系统

---

## 🎓 玩家探索设计

机制必须是在没有显式教程的情况下可被发现的。以下环境提示将引导玩家学习：

### 1. 花朵强度发现

**环境提示：**
- 首次加载时，花朵在 0.3–0.5 强度之间轻微脉冲 10 秒
- 强度增加时播放微妙的音频提示（升调）
- 世界的抖动密度会对花朵亮度做出可见的反应

**控制映射：**
```typescript
// 滚轮控制花朵强度
window.addEventListener('wheel', (e) => {
  const delta = -Math.sign(e.deltaY) * 0.1;
  flower.setIntensity(flower.intensity + delta);
});
```

**兜底方案：** 60 秒无交互后，出现极简文本提示：`[scroll]`

### 2. 注视机制发现

**环境提示：**
- 天空之眼在首次出生时位于地平线上，无法忽视
- 当玩家自然环顾四周，越过 45° 俯仰角阈值时，立即触发视觉/音频反馈
- 反馈具有戏剧性，足以被注意到但并非惩罚性的

**视觉线索：**
- 屏幕边缘在 45° 俯仰角处出现一条细白线（类似地平线标记）
- 当玩家首次越过阈值时，此线短暂脉冲

### 3. 覆盖键发现

**环境提示：**
- 在 POLARIZED 房间中，仅在以下情况后出现覆盖提示：
  1. 玩家注视眼睛累计 > 5 秒
  2. 玩家的花朵强度至少被强制降低（< 0.2）两次
- 提示是叙事性的（diegetic）：附近的建筑表面出现闪烁的文本：`[HOLD TO RESIST]`

**时机：**
- 首次游玩：条件满足后提示出现
- 后续运行：提示时机随机化（30s–120s）以保持惊喜感

### 4. 房间过渡感知

**环境提示：**
- 房间边界通过微妙的视觉变化标记：
  - INFO_OVERFLOW：远处的建筑在进入前开始闪烁
  - FORCED_ALIGNMENT：在到达前 20 米可见裂缝
  - IN_BETWEEN：边界边缘出现 Z-fighting 伪影
  - POLARIZED：进入时抖动突然消失

**音频线索：**
- 房间音频特征之间 0.5 秒的交叉淡入淡出
- 过渡平滑但这可被感知

---

## 🔊 音频系统技术规范

音频系统使用 Web Audio API，架构如下：

### 音频图结构

```
┌─────────────────────────────────────────────────────────────┐
│                      AudioContext                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐    │
│  │   环境音    │    │  房间层     │    │   事件层     │    │
│  │   Drone     │    │ (每个房间)  │    │  (One-shots) │    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬───────┘    │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    MasterGain                        │   │
│  └───────────────────────────┬─────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              GazeLowPassFilter                       │   │
│  │         (BiquadFilter, 动态控制)                     │   │
│  └───────────────────────────┬─────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Destination                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 注视低通滤波器实现

```typescript
class GazeAudioController {
  private lowPassFilter: BiquadFilterNode;
  private targetFrequency: number = 20000; // 未注视时全频段
  private currentFrequency: number = 20000;

  constructor(audioContext: AudioContext) {
    this.lowPassFilter = audioContext.createBiquadFilter();
    this.lowPassFilter.type = 'lowpass';
    this.lowPassFilter.frequency.value = 20000;
    this.lowPassFilter.Q.value = 0.7;
  }

  /**
   * 基于注视状态更新滤波器
   * @param isGazing - 玩家是否正在看天空之眼
   * @param gazeIntensity - 0–1，玩家看的直接程度（基于 pitch）
   */
  updateGaze(isGazing: boolean, gazeIntensity: number): void {
    // 目标：20000Hz (几乎开) → 400Hz (完全注视)
    this.targetFrequency = isGazing
      ? 400 + (1 - gazeIntensity) * 19600
      : 20000;
  }

  /**
   * 平滑插值（在动画循环中调用）
   */
  tick(deltaTime: number): void {
    const lerpSpeed = 3.0; // 过渡速度
    this.currentFrequency += (this.targetFrequency - this.currentFrequency) * lerpSpeed * deltaTime;
    this.lowPassFilter.frequency.setValueAtTime(
      this.currentFrequency,
      this.lowPassFilter.context.currentTime
    );
  }
}
```

### 每个房间的音频配置

```typescript
interface RoomAudioConfig {
  baseFrequency: number;      // 环境 Drone 基础频率 (Hz)
  harmonic: 'consonant' | 'dissonant' | 'binaural'; // 协和 | 不协和 | 双耳
  noiseLayer: boolean;        // 是否添加高频噪声
  noiseGain: number;          // 0–1
  beatFrequency?: number;     // 用于双耳节拍 (L/R Hz 差异)
}

const ROOM_AUDIO_CONFIGS: Record<string, RoomAudioConfig> = {
  INFO_OVERFLOW: {
    baseFrequency: 60,
    harmonic: 'dissonant',
    noiseLayer: true,
    noiseGain: 0.15,
  },
  FORCED_ALIGNMENT: {
    baseFrequency: 55,
    harmonic: 'binaural',
    noiseLayer: false,
    noiseGain: 0,
    beatFrequency: 20, // 20Hz 双耳节拍
  },
  IN_BETWEEN: {
    baseFrequency: 50,
    harmonic: 'dissonant',
    noiseLayer: true,
    noiseGain: 0.08,
  },
  POLARIZED: {
    baseFrequency: 40,
    harmonic: 'consonant', // 具有讽刺意味的“干净”声音，用于压抑的房间
    noiseLayer: false,
    noiseGain: 0,
  },
};
```

### 双耳节拍实现 (FORCED_ALIGNMENT)

```typescript
class BinauralBeatGenerator {
  private leftOsc: OscillatorNode;
  private rightOsc: OscillatorNode;
  private merger: ChannelMergerNode;

  constructor(audioContext: AudioContext, baseFreq: number, beatFreq: number) {
    // 创建立体声合并器
    this.merger = audioContext.createChannelMerger(2);

    // 左耳振荡器
    this.leftOsc = audioContext.createOscillator();
    this.leftOsc.type = 'sine';
    this.leftOsc.frequency.value = baseFreq;

    // 右耳振荡器 (失谐)
    this.rightOsc = audioContext.createOscillator();
    this.rightOsc.type = 'sine';
    this.rightOsc.frequency.value = baseFreq + beatFreq;

    // 路由到分离的声道
    const leftGain = audioContext.createGain();
    const rightGain = audioContext.createGain();
    leftGain.gain.value = 0.1;
    rightGain.gain.value = 0.1;

    this.leftOsc.connect(leftGain);
    this.rightOsc.connect(rightGain);
    leftGain.connect(this.merger, 0, 0);  // 左声道
    rightGain.connect(this.merger, 0, 1); // 右声道
  }

  /**
   * 基于玩家 X 位置调整节拍强度 (裂缝接近度)
   * @param xPosition - 玩家 X 坐标
   * @param crackWidth - 中立区宽度
   */
  updatePosition(xPosition: number, crackWidth: number): void {
    const distanceFromCrack = Math.abs(xPosition);
    const intensity = Math.max(0, 1 - distanceFromCrack / crackWidth);

    // 越接近裂缝 = 双耳效应越强
    // ... 
  }

  connect(destination: AudioNode): void {
    this.merger.connect(destination);
  }

  start(): void {
    this.leftOsc.start();
    this.rightOsc.start();
  }

  stop(): void {
    this.leftOsc.stop();
    this.rightOsc.stop();
  }
}
```

### 覆盖音效

```typescript
/**
 * 激活覆盖时播放“撕裂”声
 * 带有戏剧性包络的白噪声爆发
 */
function playOverrideTear(audioContext: AudioContext, masterGain: GainNode): void {
  const now = audioContext.currentTime;

  // 白噪声缓冲区
  const bufferSize = audioContext.sampleRate * 0.3;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = audioContext.createBufferSource();
  noise.buffer = buffer;

  // 带通滤波器用于“数字撕裂”特征
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2000;
  filter.Q.value = 1.5;

  // 戏剧性包络
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.4, now + 0.01); // 快速起音
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25); // 快速衰减

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  noise.start(now);
  noise.stop(now + 0.3);
}
```

---

## ♿ 无障碍考量

### 视觉无障碍

| 关注点 | 缓解措施 |
|---------|------------|
| 光敏性癫痫 | 添加 `reducedMotion` 设置：禁用时间抖动，将故障效果减慢至 < 3Hz，移除覆盖闪烁 |
| 高对比度问题 | 1-bit 美学本质上是高对比度的；无需额外措施 |
| 晕动症 | 添加 `reducedMotion` 设置：减少头部晃动，减慢房间过渡 |

**实现：**

```typescript
interface AccessibilitySettings {
  reducedMotion: boolean;
  audioDescriptions: boolean; // 未来：叙述房间过渡
  disableFlashing: boolean;
}

// 在 DitherShader 中，遵循 reducedMotion：
if (settings.reducedMotion) {
  uniforms.uTemporalJitter.value = 0;
  uniforms.uGlitchSpeed.value = Math.min(uniforms.uGlitchSpeed.value, 2.0);
}

// 覆盖视觉效果：跳过颜色反转闪烁
if (settings.disableFlashing) {
  // 跳过 0.1s “破坏”效果，直接进入强度提升
}
```

### 音频无障碍

| 关注点 | 缓解措施 |
|---------|------------|
| 听力障碍 | 所有音频提示都有视觉对应物（注视 = 对比度变化，覆盖 = 屏幕闪烁） |
| 双耳节拍不适 | 添加 `disableBinauralBeats` 设置：替换为单声道声像效果 |
| 音量敏感度 | 独立的音量滑块：主音量、环境音、事件音 |

### 控制无障碍

| 关注点 | 缓解措施 |
|---------|------------|
| 行动受限 | 可配置的键位绑定；纯鼠标模式（自动行走切换） |
| 覆盖按住持续时间 | 可调节的按住时间（默认 1s，范围 0.3s–3s） |

---

## 🛠 技术路线图

### 第一阶段：地基（着色器与状态）

> 状态：已实现（v1.0）

**目标：**

- 重构 `ChunkManager` 以支持 `roomType` 枚举及每个房间的单独配置。
- 升级 `DitherShader`，添加所有必需的 uniform 以及时间轴动画支持。
- 实现基本的“花朵”强度控制（手动控制及通过“注视”自动控制）。
- 建立 `RunStats` 数据收集基础架构（非侵入式后台记录）。

**交付物：**

- `ChunkManager.ts` 能够生成并管理分配了 `roomType` 的分块（chunk）。
- `DitherShader.ts` 公开 `uNoiseDensity`、`uThresholdBias`、`uTemporalJitter`、`uContrast` 作为动态更新的 uniform。
- `FlowerProp.ts` 支持平滑插值的 `setIntensity(0–1)`。
- `RunStats` 对象在整个会话（session）中保持并积累数据。

**验收标准：**

- 在 INFO_OVERFLOW 和 POLARIZED 房间之间切换会产生可见的着色器变化。
- 花朵强度可以被手动控制并显示平滑的视觉反馈。
- 无性能退化；帧率保持稳定。

---

### 第二阶段：规训（机制）

> 状态：已实现（v1.0）

**目标：**

- 实现“注视”机制：凝视天空之眼时自动降低光照强度。
- 集成音频滤波（注视时启用低通滤波）。
- 添加触觉反馈（若平台支持）。
- 实现摄像机俯仰检测及平滑的状态切换。

**交付物：**

- `Controls.ts` 检测“注视”状态（俯仰角 > 45°）并广播事件。
- “花朵”通过自动插值强度来响应“注视”。
- `AudioSystem` 在注视时平滑地应用低通滤波器。
- 触觉脉冲模式实现（注视开始时单次脉冲，注视过程中周期性脉冲）。

**验收标准：**

- 抬头注视明显带有“惩罚感”（光线变暗、声音变闷、震动）。
- 效果平滑，不突兀。
- 玩家在游戏开始的前 30 秒内自然习得“注视”规则。

---

### 第三阶段：精神状态空间（房间）

> 状态：已实现（v1.0）

**目标：**

- 实现四个精神状态房间：`INFO_OVERFLOW`、`FORCED_ALIGNMENT`、`IN_BETWEEN`、`POLARIZED`。
- 为每个房间配置独立的着色器参数和音频配置。
- 实现房间之间的平滑过渡（视觉与音频交叉淡入淡出）。
- 添加房间边界的环境提示。

**交付物：**

- `RoomConfig.ts` 定义每个房间的着色器/音频参数。
- `ChunkManager.ts` 根据位置分配 `roomType`。
- `DitherShader.ts` 根据当前房间动态调整 uniform 值。
- `AudioSystem.ts` 支持每房间音频层及双耳节拍（FORCED_ALIGNMENT）。
- 房间边界视觉提示（闪烁、Z-fighting 伪影、抖动变化）。

**验收标准：**

- 进入不同房间产生明显且独特的视觉/音频变化。
- 房间过渡平滑（0.5 秒交叉淡入淡出）。
- FORCED_ALIGNMENT 中双耳节拍根据玩家 X 位置变化。
- POLARIZED 房间呈现纯粹的零抖动 1-bit 渲染。

---

### 第四阶段：反抗（覆盖机制）

> 状态：已实现（v1.0）

**目标：**

- 实现"覆盖"键（Override）机制：在 POLARIZED 房间中按住特定键可强制花朵强度为 1.0。
- 添加覆盖的视觉效果："颜色反转"闪烁、着色器短暂"崩溃"。
- 添加覆盖的音频效果：白噪声"撕裂"声。
- 实现覆盖提示的条件触发逻辑。

**交付物：**

- `Controls.ts` 处理覆盖键（Space 或 Shift）的按住检测。
- `OverrideMechanic.ts` 管理覆盖状态、计时与效果触发。
- `DitherShader.ts` 支持颜色反转与故障效果。
- `AudioSystem.ts` 添加 `playOverrideTear()` 方法。
- 覆盖提示逻辑：仅在满足条件（注视累计 > 5 秒、花朵被压低 2+ 次）后显示 `[HOLD TO RESIST]`。

**验收标准：**

- 在 POLARIZED 房间中按住覆盖键会产生明显的视觉/音频反馈。
- 覆盖效果持续时间与按住时间相关（可配置，默认 1 秒触发）。
- 覆盖提示在合适的时机以叙事性方式（diegetic）出现。
- 无障碍设置可禁用闪烁效果。

---

### 第五阶段：状态快照（运行结束总结）

> 状态：已实现（v1.0）

**目标：**

- 实现运行时指标收集系统（`RunStats`）。
- 实现运行结束时的标签生成算法。
- 实现程序化 1-bit 图案生成（基于标签）。
- 实现观察性文本选择与显示（杨德昌风格）。

**交付物：**

- `RunStatsCollector.ts` 实现每 2 秒采样玩家行为（光强、注视、位置、覆盖）。
- `TagGenerator.ts` 根据归一化指标生成行为标签。
- `StateSnapshotGenerator.ts` 根据标签生成 1-bit 图案与组合文本。
- `StateSnapshot.frag` 着色器渲染最终图案（噪声/条纹/棋盘格/径向）。
- 运行结束 UI：显示图案与文本快照。

**验收标准：**

- 运行结束时正确生成反映玩家行为的标签。
- 每次运行生成独特的 1-bit 图案"指纹"。
- 显示的观察性文本与玩家行为标签匹配。
- 运行时指标收集对性能无明显影响。

---

### 后续优化阶段

**潜在目标：**

- 移动端适配（触控控制、性能优化）。
- 无障碍功能完善（`reducedMotion`、`disableBinauralBeats`、可配置键位）。
- 多语言支持优化（简体中文/英文文本库完善）。
- 运行数据持久化与历史记录查看。
- 音频描述功能（为视障玩家叙述房间过渡）。

---

## 已发布（超出原路线图）

以下系统不在最初的五阶段路线图中，但已实现并发布：

- **逐房间签名天气**（`WeatherSystem`）：按当前房间加权选 STATIC/RAIN/GLITCH，每房间有自己的冷却/时长/强度；GLITCH 已进入常规轮换。
- **行为驱动房间归属**（`RoomLedger`）：会话内 cluster 房间一经生成即锁定，从未到访的 cluster 由玩家行为画像温和偏置。
- **跨局疤痕**（`ScarField` + `ScarStorage`）：你反抗过的真实坐标会在后续 run 留下疤痕，锚定那个地点。
- **剪影人物**（`FigureSystem`）：废墟里远处散落的 1-bit 人形。
- **上一局幽灵**（`GhostSystem`）：上一局的行走轨迹化作幽灵重现，阅后即焚。
- **可分享快照卡**（`SnapshotCard`）：日落快照可导出为 1080×1350 的 PNG；快照观察文字为中英双语（中文主、英文次）。
- **花的中段共鸣**（`FigureSystem`）：把花保持在中等亮度数秒，近处剪影的胸口光渐渐与你同频呼吸——太暗孤独、太亮低头，只有中间那条窄带有共鸣。
- **反抗传染**（`FigureSystem`）：成功 override 后的几分钟里，远处剪影的 rebel 爆发显著更频繁——你的反抗给了他者许可。
- **疤痕见证者**（`ScarField` + `FigureSystem` + `FloorTile`）：剪影会围立在疤痕周围面向它；INFO 房间的字符地板在疤痕处被系统涂抹——系统抹去记录，人群仍站在那里。
- **电缆上报**（`CableSystem`）：花亮过阈值时，附近电缆浮现流向天眼方向的 1-bit 虚线脉冲——你的光顺着电线被上报给权威。
- **快照回声**（`SnapshotEcho`）：每隔几分钟，附近某栋建筑立面硬闪烁出本局快照指纹的低清草稿——世界一直在为你画像，日落只是交稿。
- **seam 互换**（POLARIZED）：站进 seam 线 ±数米内，近缝建筑以硬闪烁借用对侧阵营的渲染语言——us/them 由你站的位置定义。
- **每房间的天空**（`RoomSky`）：纯色背景升级为四种天穹——INFO 闪烁微点、FA 水平账本线、IN_BETWEEN 错位双月、POLARIZED 沿 seam 对半分的墨与纸；随昼夜硬互换、随天气逐相位响应。
- **理想化阴影**（`ShadowCorrection`）：FA 每栋建筑一块轴对齐、栅格量化的硬黑阴影，全世界同一个方位角（one sun, one rule）；疤痕处修正失效。
- **数据瀑布**（`DataWaterfall`）：INFO 立面上的字符流，花越亮滚得越快——地板的二进制语言爬上了墙。
- **视模型重影**（`ViewmodelEcho`）：只在 IN_BETWEEN，你的手与花有一个错位的第二像——两套系统各读了你一次。
- **镜像双城**（POLARIZED 生成）：seam 两侧由同一批 hash 抽签镜像生成——内容相同、渲染相反；疤痕在镜像之后施加，是唯一打破对称的东西。
- **天气 2.0**（`WeatherSystem` + `Precipitation` + `WeatherReactions`）：天气获得生命周期（前兆→爆发→余波）与世界空间的身体——雨的短竖线落在你和建筑之间，灰烬沉降并留下会溶解的痕迹，风吹动电缆/旗幡/剪影/字符流；余波留痕（字符水洼、被打歪又摆正的阴影、残留翻转的建筑）。新增三种天气：灰烬、风、以及极罕见的蚀——墨盘横穿天穹、白昼塌向黑夜、剪影抬头，你的花够亮时他们转向你。天气频率与类型被玩家行为温和偏置（±30% 内）。

- **烧屏残影**（`BurnInPass` + DitherShader）：INFO 房间里，凝视静止片刻后再转头，刚才注视的高对比画面以硬墨点残留在屏幕上、逐像素熄灭——看过的东西无法不看见。
- **没有黄昏**（`DuskSnap`）：POLARIZED 的日落预兆渐变被硬切为二值——连时间的灰色地带都不存在；但音频的预兆下沉保留原样，时间拒绝被看见，却仍然听得见。

---

*文档版本：1.5（中文）*

**更新日志：**
- v1.5：已发布列表补充烧屏残影与"没有黄昏"（原路线图外的两条搁置项收尾）。
- v1.4：已发布列表补充视觉风格批（天空/阴影/瀑布/重影/镜像）与天气 2.0（生命周期、灰烬/风/蚀、世界降水、行为偏置）。
- v1.3：已发布列表补充场景丰富度批（中段共鸣、反抗传染、疤痕见证者、电缆上报、快照回声、seam 互换）。
- v1.2：完善技术路线图，添加第三阶段（精神状态空间）、第四阶段（覆盖机制）、第五阶段（状态快照）及后续优化阶段。
- v1.1：添加了现状评估、玩家探索设计、音频系统技术规范、无障碍考量。删除了技术路线图中的持续时间估算。

