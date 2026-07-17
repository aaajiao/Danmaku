# v3 运行时接入说明

这套运行时把“什么时候造成伤害”和“屏幕上播到哪一帧”彻底分开。`runtime-contract.json` 是时间与碰撞契约，`boss-laser-state-machine.json` 是 Boss 激光生命周期，`binding-graph.json` 是玩法事件到视觉资源的单向绑定，`runtime.ts` 是可直接移植的参考实现。

最终打包时这些运行时 JSON 与 v3 art manifests 同处 `manifests/v3/`。因此 `sourceManifests` 使用同目录文件名 `animation-clips.json`、`boss-rigs.json`、`laser-modules.json`、`runtime-effects.json`；当前 staging 验证器会只读映射到 `work/v3/art/manifests/`，契约本身不携带 staging 路径。

## 1. 双时间轴

每个需要动画的玩法动作同时拥有两条轨道：

- `EventTimeline` 是权威玩法轨道。它只读模拟时钟，负责碰撞开关、伤害提交、生成、完成和取消事件。
- `VisualTrack` 是视觉轨道。它可以丢帧、冻结、使用代表帧或 reduced-motion，但只返回 `VisualSignal`，无法返回 `RuntimeEvent`。
- `DualTimeline` 只是同时推进两者。不要把视觉帧索引、透明度、shader 状态或动画回调写回玩法状态。

`gameplayTimelines` 有三种权威来源：`fixed` 使用模拟时间边界；`event-adapter` 使用 HP 阈值、场景事务等权威事件；`state-machine-adapter` 只转发 `BossLaserMachine` 的状态进入事件。后两者没有视觉 `atMs`，因此 clip 改帧或 reduced-motion 都不能改变玩法时序。

启动时先调用 `start(simulationTimeMs)`，它会发出 `t=0` 的玩法事件。之后每次调用 `advance(deltaMs)`，玩法轨道严格发出 `(previousTime, nextTime]` 里的全部事件。相同时间戳按 `priority` 升序，再按声明顺序执行：碰撞关闭 `0`、伤害/状态提交 `10`、碰撞开启 `20`、生成 `30`、音频 `80`、视觉 `100`。

建议固定步长推进玩法；渲染帧只消费最新快照。追帧时可以一次传入较大的 delta，参考实现会穿过所有边界而不漏事件。若超过安全上限则抛错并保留推进前状态，绝不静默丢弃权威事件。

## 2. 循环、hold、完成与取消

- 循环事件的唯一键是 `instanceId:generation:loopIndex:eventIndex`。进入下一轮后 `loopIndex` 改变，因此同一事件会重新触发；同一轮内不会误重置。
- hold 直接并入 `VisualFrameSpec.durationMs`。它只延长视觉帧，除非玩法时间轴也显式声明同样的等待，否则不会推迟碰撞或伤害。
- 有限时间轴只在最后一轮发出一次 `completionEvent`。`completionPriority` 默认 `90`，确保同一边界上的碰撞开启、清理或持久化提交先完成。视觉完成后保留最后一帧。
- `cancel()` 立即生效且只发一次。取消后不会再发完成事件。必须先处理碰撞关闭，再播放取消 clip/effect。
- 重新 `start()` 会增加 `generation`，上一代的去重记录不会吞掉新一代事件。

## 3. reduced-motion 等价

reduced-motion 只改变 `VisualTrack` 的显示帧：使用 `reducedMotionFrame`，关闭时间抖动和 shader flash。玩法仍由同一个 `EventTimeline` 产生，所以完整模式与 reduced-motion 必须具有完全相同的事件 ID、模拟时间与顺序。

不要为 reduced-motion 复制第二份玩法时间表。测试应分别以 `full` 和 `reduced-motion` 创建相同动作，比较两份 gameplay trace；`runtime.test.ts` 已包含此回归测试。

## 4. 即时碰撞时序

玩家受击时，在同一模拟时间先把 `collidable=false`，再提交伤害和无敌状态。大 delta 跨过无敌结束时，事件仍记录在准确的结束时间，而不是当前渲染时间。复活必须先放置角色，再按独立的玩法边界开启碰撞；视觉淡入不能控制碰撞。

弹体出生后由 arm 时间控制碰撞。`projectile.normal-arm`、`projectile.heavy-arm`、`projectile.lifecycle` 是互斥权威，只能选择一条，默认使用与 v3 art 对齐的 `projectile.lifecycle`。重弹可以先 telegraph，直到 `projectile.collision.on` 才能命中。取消时立即关闭碰撞，再提交 cancel；残影永不参与碰撞。高速移动使用 `sweptCircleHit` 或等价的 swept-shape 检测，不能只检测大 delta 之后的终点。

最终 `bullet.cancel` 只有 `bullet.impact_0 → bullet.impact_1` 两帧，共 120ms。它完成时 gameplay cancel 仍继续到 340ms；`projectile.cancel.residue.begin` 只让视觉层采样 `bullet.lifecycle` 的 `bullet.afterimage → bullet.clear` 段，绝不重新打开碰撞，也不由短 clip 的完成回调结束清理。

Boss 激光只在 `live` 状态碰撞。完整顺序固定为：

`idle → telegraph → charge → grow → live → shutdown → residue → idle`

进入 `live` 时先发 `laser.collision.on`，再发 live 玩法/视觉事件。进入 `shutdown` 或在 live 中取消时，`laser.collision.off` 必须是同一时间戳的第一项。telegraph、charge、grow、shutdown、residue 都不可碰撞。状态机支持一次大 delta 穿越多个状态、零时长阶段、主动 stop 和幂等 cancel。每个 v3 laser module 的 `warningMs / chargeMs / growMs / minimumLiveMs / shutdownMs / residueMs` 显式映射到状态机参数；`boss.laser.lifecycle` clip 只按状态选帧，不提供时长权威。

## 5. IN_BETWEEN 稳定交集

IN_BETWEEN 的权威碰撞谓词是：

```text
primary.contains(point) && secondary.contains(point)
```

`StableIntersectionCollider` 在显式 `updateGameplayPose()` 时量化并冻结两套形状。宽相位只检查两者 AABB 的交集，窄相位仍同时调用两个 `contains`。渲染抖动通过 `visualPoses()` 取得副本，不会修改冻结的玩法形状。若 AABB 没有交集，碰撞立即关闭，并为这一代 pose 发出一次诊断事件。

## 6. 绑定图与幂等

`binding-graph.json` 是单向 DAG：`gameplay-event → clip/effect`。clip 和 effect 是终点，没有回到 gameplay-event 的边，也不能继续分发。这样动画完成、特效回调或资源热重载都无法改变权威状态。

每条边必须声明一个去重作用域：

- `perEvent`：一次事件 occurrence 只执行一次。
- `perLoop`：每一轮循环可执行一次。
- `perStateEntry`：每个激光 cycle 的某次状态进入只执行一次。
- `perInstance`：一个对象生命周期只执行一次。

`BindingGraph.dispatch()` 先向 `IdempotencyLedger` 申请 key，成功后才调用视觉 sink。资源加载器、音频或渲染层即使重复投递同一事件，也不会重复生成 effect。构造图时会检查缺失节点、重复 ID、视觉回写玩法与所有环。

绑定边可附带只读 `segment`，例如弹体取消余痕只采样 `bullet.lifecycle` 的 afterimage/clear。segment 仍是视觉参数；碰撞关闭与 residue 移除时间完全来自 gameplay timeline。视觉 sink 失败时去重 claim 会回滚，允许安全重试。

## 7. v3 权威动作覆盖

- Focus：`player.focus` 时间轴在固定模拟步提交 focus hitbox，不读取 `player.focus` clip 的事件回调。
- Override：`player.override.directional` 先关闭碰撞再 commit，并由 `cross_run.scar.write.commit` 单向播放 `memory.directional_write`。
- Boss phase：HP 阈值系统发出 `boss.phase.swap`；`boss.phase_swap` effect 与各 rig 的 attack clip 只是订阅者。
- Cross-run snapshot：序列化、下一轮 seed、scar restore 都是 gameplay commit；`state.snapshot_handoff` 只展示结果。
- Enemy causality 的最终 clip ID 是 `enemy.causality.damage_to_trace`；旧的 `enemy.causality.rupture_to_trace` 不再允许进入 v3 包。

## 8. 最小接入顺序

1. 在固定模拟步中推进 `EventTimeline` 和 `BossLaserMachine`。
2. 按时间、priority、声明顺序消费 gameplay 事件并立即更新碰撞世界。
3. 把同一批事件交给 `BindingGraph`，由视觉 sink 播放最终 v3 clip/effect。
4. 独立推进 `VisualTrack`，只更新显示帧；掉帧时可直接跳到当前视觉状态。
5. 渲染最新玩法快照。任何视觉值都不回写第 1、2 步。

## 9. 自测

在项目根目录运行：

```sh
python3 work/v3/runtime/validate_runtime_config.py
tsc -p work/v3/runtime/tsconfig.json
mkdir -p /tmp/onebit-v3-runtime-test
tsc -p work/v3/runtime/tsconfig.json --noEmit false --outDir /tmp/onebit-v3-runtime-test
node /tmp/onebit-v3-runtime-test/runtime.test.js
```

配置验证器只读交叉检查四份最终 v3 art manifest、真实 clip/effect/rig/module 引用、两帧 bullet cancel、enemy causality 新 ID、激光参数映射、状态完整性、碰撞不变量、绑定环与幂等作用域。TypeScript 测试还覆盖大 delta、循环重置、hold、完成/取消、reduced-motion 等价、override 与 cross-run 提交、短 cancel clip 和长 gameplay cleanup 的分离、swept collision、稳定交集及重复绑定。
