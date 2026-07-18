# V3 → V4 迁移

## 必须替换的权威逻辑

| V3 风险 | V4 替代 |
|---|---|
| 弹体 arming 后 270ms 自动当作碰撞完成 | 实体拥有的无限 flight；真实 impact／cancel／出界结束 |
| 非致命受击与致命受击竞争 | `PlayerDamageMachine` 在发事件前原子选择一条分支 |
| 多模块直接写 collision boolean | blocker lease；最后一张租约释放才恢复 |
| Override 等于全局无敌／清屏 | evidence 驱动的定向 local void + 世界坐标 scar |
| 12 套弹幕只是描述 | 48 套完整 emitter／operator／warning／gap／seed 数据 |
| 24 个 Boss clip 共用同一时间结构 | 8 Boss × 3 阶段，24 个独立结构签名 |
| 激光都是一条 segment 换色 | 8 种实际拓扑与 exact swept warning |
| Snapshot、Archive、下一局恢复混用时钟 | 三个职责分离；跨局只有一条 gameplay clock |
| Flash-Off 缺少运行时路径 | 与 Full／Reduced Motion 相同事件轨迹，稳定 cue 替代闪烁 |
| Boss HP 是唯一终止条件 | 8 个协议／行为条件；HP 只可成为结构破裂 |
| Score／Power／Life 的街机语义 | Evidence／Expression／Continuity／Memory |

## 资源 ID 迁移

先加载 `manifests/v4/semantic-aliases-v4.json`。三项 V3 pickup 会在组合 frame index 中取得 V4 名称；旧名称只作为读取旧存档的输入别名，不应继续写出。

V3 与 V4 都有 `cable.idle`、`cable.attach`、`witness.rebel_exit`。组合索引把 V3 行改名为 `legacy.v3.*`，V4 版本成为正式语义，避免运行时随机取得旧帧。

## UI 迁移

- 删除 `tutorial_behavior_map`；按 `discovery_prompts` 的守卫条件显示局部提示。
- `hud.score` 改为 `hud.evidence`；只统计唯一近失事实。
- Boss bar 改名为 protocol interval；不得显示为生命百分比。
- Failure 改为 route interruption，并显示 death trace 与 Snapshot 入口。
- Continue 提供“带材料继续”与“无留痕条件开始”，不是简单重试。

## 存档迁移

旧的通用 `scars[]` 不可直接塞进 V4。迁移时按来源分流：

- Override 取消记录 → `overrideScars`；
- 玩家身体中断位置 → `deathTraces`；
- 读取／Cable 表面记录 → `burnIns`；
- 旧 ghost 路径只保存为 route；首次 V4 播放完成后才写 `ghostResidues`。

无法辨认来源的旧 scar 应放在只读 `legacyUnknown` 审计区，不参与 V4 世界反应。

## 推荐迁移顺序

1. 冻结 V3 存档并做副本；
2. 替换 runtime contract 和事件目录；
3. 替换 projectile 与 player damage；
4. 接 48 patterns、enemy、Boss、laser；
5. 接 run-memory schema 与 narrative state machine；
6. 接 asset bindings、UI、音频、触觉；
7. 运行整包验证，再开放旧存档导入。

