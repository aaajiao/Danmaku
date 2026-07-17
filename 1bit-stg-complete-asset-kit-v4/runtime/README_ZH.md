# 1bit V4 权威运行时

这套参考实现把 V4 的世界观关系变成单向、可复现的 gameplay 事件。视觉、声音、触觉和 UI 都只能读取这些事件，不能反过来决定碰撞、伤害、弹道或输入归还时刻。

## 权威入口

- `../manifests/runtime/runtime-manifest-v4.json`：唯一运行时清单。
- `index.ts`：TypeScript 导出入口。
- `event-schema-v4.json`：72 个权威事件及必需 payload。
- `state-machines-v4.json`：12 个状态机／解析器的声明版本。
- `feedback-bindings-v4.json`：gameplay event → visual/audio/haptic/UI 的单向绑定。
- `accessibility-profiles-v4.json`：六条互不耦合的无障碍轴。

## 已修复的 P0

1. 玩家不再同时启动普通受击与死亡时间线。`PlayerDamageMachine.takeDamage()` 在发出任何事件前，原子选择 ignored、non-fatal 或 fatal 中的一条。
2. 碰撞开关不再由多个模块互相覆盖。每个模块只能取得并释放自己的 blocker lease；最后一张租约释放后才能恢复碰撞。
3. 弹体不再在 270ms 自动“命中”。arming 结束后进入无期限、实体自主管理的 flight；只有真实碰撞、局部取消或出界逻辑才能调用 `impact()`／`cancel()`。
4. Graze 以 `projectileInstanceId:generation:playerId` 去重，同一颗弹只生成一次 evidence。
5. 花的冲突统一按 `Override > Gaze > Focus > Signal` 解析。
6. Override 不再是全局无敌。它消耗 evidence，在玩家前方生成有限半径、有限夹角的 local void；关闭后在真实世界坐标留下独立的 `overrideScar`。
7. Snapshot 只观察和呈现当前一局；Archive 只持久化；CrossRunRestore 只复水下一局。三者不再共享一条含混时间线。
8. 跨局顺序固定为 `overrideScar`／`deathTrace`／`burnIn` 分别复水 → 真实 ghost route → `ghostResidue` → witness → input；四种材料没有共用数组、事件或衰减时钟。
9. Full、Reduced Motion、Flash-Off 使用同一 gameplay trace；配置只进入 `FeedbackRouter`。
10. 房间权威 ID 使用 `INFORMATION`；旧 `INFO_OVERFLOW` 只允许在读入旧存档时映射，运行时事件永远不会将旧名写出。

## Three.js 接入规则

每局创建一个 `EventTrace`，并把同一个 trace 注入玩法状态机。固定步长更新状态机；渲染帧只消费 `trace.canonicalEvents()` 中尚未分发的事件。

弹体移动属于实体本身：

```ts
projectile.spawn(simulationTimeMs, archetypeId);
projectile.advance(simulationTimeMs); // 只负责 arm / residue 边界

// Three.js / ECS 的真实 swept collision 决定结果：
projectile.impact(simulationTimeMs, targetId);
// 或 projectile.cancel(simulationTimeMs, "local-void");
```

玩家碰撞只能通过租约管理：

```ts
const lease = player.acquireCollisionBlocker("room", "atomic-world-swap", now);
// ...世界交换...
player.releaseCollisionBlocker(lease.token, now);
```

不要把 accessibility profile、动画完成回调、shader alpha、GPU readback 或音频时间传进任何 gameplay 状态机。它们只能传给 `FeedbackRouter.route(event, profile)`。

## Snapshot／跨局交接

- 当前局 410ms：Snapshot 形成不可变 record。
- 调用者在同一权威时刻显式交给 `CrossRunArchive.persist()`。
- Snapshot 810ms 开始呈现，1630ms 完成；它不复水下一局。
- 下一局另起 restore clock，并从 `ghostRoute.points` 最后一个权威 `tMs` 得到真实 `routeDuration`，不读取 GIF/APNG 或动画 clip 时长。
- 0ms：`overrideScar.rehydrate`、`deathTrace.rehydrate`、`burnIn.rehydrate` 分别提交。
- 420ms：`ghost.replay.begin`，Full 线性播放真实点，Reduced 只显示事件点；两者 gameplay 时刻相同。
- `routeDuration + 420ms`：`ghost.replay.complete`。
- `routeDuration + 421ms`：只在真实终点写入独立的 `ghostResidue`。
- `routeDuration + 700ms`：`witness.turn`。
- `routeDuration + 1140ms`：`returnInput`；此前输入保持关闭。

动态基准来自真实路线，但同一条路线的这些时刻不因动画模式、闪烁设置或设备性能而改变。

## 验证

在 V4 根目录运行：

```sh
python3 -B runtime/validate_v4_runtime.py --run-code --strict-warnings
```

验证器会交叉检查 JSON、TypeScript 事件目录、状态机事件引用、反馈方向、无障碍笛卡尔组合、权威时刻，并运行 `tsc` strict 与全部测试。

当前结果：72 个事件、12 个状态系统、34 条反馈绑定、216 种正交无障碍组合；12/12 测试通过，0 error，0 warning。
