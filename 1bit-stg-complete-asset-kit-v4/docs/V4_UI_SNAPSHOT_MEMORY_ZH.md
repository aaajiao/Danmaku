# V4 UI、State Snapshot 与跨局记忆

## 1. UI 的职责

V4 UI 不解释玩家是谁，也不评价路线。它只做三件事：显示当前压力、保留已经发现的关系、在运行结束时指出一句话来自哪些事实。

HUD 将旧的 Score 语义彻底替换为：

- `FLOWER / 花`：表达与暴露的同一变量；
- `READ / 读取`：Eye 当前的读取压力；
- `EVIDENCE / 证据`：每颗弹最多贡献一次的擦身事实，可用于局部 Override；
- `MEMORY / 留痕`：下一局仍会存在的材料数量，不是货币；
- `MENTAL STATE / 精神状态`：当前房间；
- 天气状态：默认隐藏，仅在天气发生或音频描述开启时显示。

权威布局和文字分别位于 `manifests/narrative/ui-layouts-v4.json` 与 `ui-copy-v4.json`。

## 2. 四种材料不能混用

`run-memory-v4.schema.json` 明确分开：

| 字段 | 由什么产生 | 下一局怎样出现 |
|---|---|---|
| `overrideScars` | 玩家成功打开定向局部空白 | 规则校正失效、见证者围立 |
| `deathTraces` | 伤害或身体停下 | 按受力方向留下纤维痕迹 |
| `burnIns` | 持续凝视后转身 | 高对比点阵逐像素熄灭 |
| `ghostResidues` | 真实上一局路线播放并烧尽 | 只在路线真实终点留下一小块材料 |

它们不能共享数组、纹理 ID 或衰减时钟。`overrideScar` 表示主动局部中断；`deathTrace` 表示身体遭遇的中断。把两者画成同一种 scar 会抹掉行为差异。

## 3. Ghost 真实路线契约

路线在权威移动结算之后每 120ms 采样。房间进入、seam 穿越、凝视、擦弹、受伤与 Override 是不可删除的事件点。压缩只能删除中间形状点，不能移动事件点。

Ghost：

- 只播放真实采样路线；
- 只播放一次；
- 不碰撞、不发弹、不擦弹、不产生 evidence；
- Full Motion 线性连接样本；Reduced Motion 只显示事件点，但事件时刻不变；
- 播放结束后才写入 `ghostResidue`。

契约在 `manifests/narrative/ghost-replay-contract-v4.json`。

## 4. Witness 的条件优先级

见证者不是人群奖励动画。状态按以下优先级确定：

1. 面向附近 Override scar；
2. Ghost 烧尽后面向其真实终点；
3. Override 后短时、低概率发生反抗姿势传递；
4. Eclipse 时面向 Eye；花足够亮则改为面向玩家；
5. 中段花亮度持续 3.2 秒后共鸣；
6. 花过亮或 Clamp 时低头；
7. 其余时间孤立异步待机。

见证者只读取事实，不改变 evidence、难度或掉落。

## 5. Snapshot 的 64 组观察句

`narrative/snapshot-observations-v4.json` 提供 64 组中英双语句子，分为八类：

- Light；
- Gaze；
- Practice；
- Override；
- Room；
- Route；
- World；
- Ending。

每句都带：

- 唯一 ID；
- 明确的选择条件；
- 来源字段路径 `trace[]`；
- 中英文字；
- 优先级。

每张 Snapshot 最多选择三句，每类最多一句。选择按 specificity 和稳定 ID 排序，平手由 `hash(run.id, observation.id)` 确定，不使用随机数。

UI 中每句话都可以展开“可追溯事实”，例如：

```text
这一路，有很长时间是朝上看的。
来源：metrics.gazeRatio = 0.57
```

它陈述行为，不把行为变成心理诊断。

## 6. Snapshot 页面

页面从上至下为：

1. 运行指纹；
2. 一至三句观察；
3. 对应的事实来源；
4. 四类材料记忆；
5. 运行如何结束的事实。

Pause、Continue、运行中断页和 Snapshot 必须读取同一个 `RunMemoryV4`。不允许各页面分别复制 run state。

## 7. 迁移注意

- `pickup.score` → `pickup.evidence`；
- `hud.score` → `hud.evidence`；
- 删除 High Score、Rank、Grade 与结局等级；
- 旧 `scars[]` 按来源迁移，无法证明来源的项目不要猜，应放进只读 legacy 记录；
- V3 ghost 的预写路线不能迁移为 V4 真实路线；从 V4 开始重新采样；
- Tutorial Behavior Map 不再作为首屏页面。

“没有 Score”不是少一个 HUD 数字，而是拒绝把这些行为压缩成一个可比较的单值。
