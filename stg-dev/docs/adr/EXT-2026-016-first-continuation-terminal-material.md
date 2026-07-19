# EXT-2026-016：首个 continuation occurrence 终端材料归属

- 状态：ACCEPTED
- 日期：2026-07-19
- 前置：[EXT-2026-015](EXT-2026-015-first-continuation-room-plan-and-pool-admission.md)
- 范围：ordinal 1 首 occurrence 的 pattern end、occurrence release、material-settle/rest 与 slice close

## 背景

EXT-015 已冻结首个 successor occurrence 的 plan、联合池 reservation 与 READ 安装边界，但没有定义
pattern end 之后的 residue 由谁推进。V4 的 collisionless residue 生命周期可以长于 composer 的
`materialSettle + rest`。当前正式 fixture 选择 `room.in_between.context_switch`：residue lifetime 为
`3150ms`，而 EASY 的 `materialSettle 900ms + rest 1600ms` 只有 `2500ms`。

因此以下做法都不成立：延长 composer segment、在 slice close 删除 residue、让已无 collider 的 occurrence
继续占用 gameplay claim，或把 renderer 消失当作 lifecycle 完成。

## 决定

1. READ 仍按 plan 的精确 `tick120` 推进。pattern complete 同 tick先执行 V4 pattern-end cancellation；只有
   `patternComplete=true`、`digitalBodiesDrained=true`、`liveColliders=0` 且剩余 entity 全为
   collisionless residue 时，才请求释放 occurrence。
2. sole Run flush 成功后，`activeOccurrenceId` 变为 `null`。原 kernel 不再拥有 gameplay step；一个 sealed
   material-only port 只能推进已经存在的 residue lifetime，并同步只读 player/Override snapshot。它不能
   spawn、消费 RNG、移动数字身体、恢复 collision、执行 contact/damage/graze、写 metric 或改变 room FSM。
3. EXT-013 的旧 material carryover 与 successor residue 保持两个不相交 identity 流，联合 allocated/residue
   使用量始终受 EXT-015 已提交 reservation 约束；不得把二者复制或合并成新 projectile。
4. `material-settle`、`rest` 与 `sliceCompleteTick120` 保持 plan 原值。slice close 要求旧 EXT-013 carryover
   已排空、Override 仍为 locked/idle、successor residue 仍无 gameplay 能力；不要求 successor residue 在该
   边界消失。player recovery/respawn timer 是 Run-owned state，可以跨 slice 继续，不把 slice close 冒充
   handoff-ready。未排空 residue 保留在 sealed complete snapshot；在未来明确的 material handoff 建立前，
   同一 sealed owner 继续接受 exact-next-tick，只推进 residue lifetime、player timer 与 idle room FSM，
   `phase="complete"` 不回退，也不重新取得 gameplay claim。
5. slice complete 不是 room complete、room handoff、胜利或计分。没有新增 canonical event ID，也不伪造
   `room.transition.complete`、`material.settle` 或 `segment.*` 事件。
6. movement 与 Focus 继续由身体权消费；Signal/Gaze/Flower 继续遵循 EXT-014/015 的冻结边界。
   Local Resistance 尚未获得，Override press/release 在 READ、material-settle 与 rest 全部拒绝，不能因
   room entry 自动解锁。

## 呈现边界

- presentation 可以同时读取旧 material 与 successor residue，但两者仍保留各自 occurrence/source identity；
- `targetVisible=false` 不妨碍 collisionless residue 可见；它只表示没有获得 enemy target lifecycle；
- alpha、atlas frame、音频、reduced motion 与截图都不能提前释放 occurrence 或删除 residue。

## 拒绝的替代方案

- **等待 residue 全排空再 close**：会把 V4 composer 的精确 segment 静默延长至少 `650ms`；拒绝。
- **slice close 强制清空 residue**：破坏 entity-owned lifecycle 与材料因果；拒绝。
- **保持 active occurrence 到 residue 消失**：把无 gameplay 能力的材料错误升级为 gameplay gate；拒绝。
- **room entry 自动开放 Override**：EXT-015 明确未授予 Local Resistance；拒绝。

## 验证

- 一条真实 producer 流从 Handoff 推进到 H+159 READ、首个真实 projectile、pattern end、occurrence release、
  material-only tail、exact slice close、post-close residue drain 与空材料 hold；
- 断言 active/pending occurrence 均为空、所有 retained successor projectile 都是 collisionless residue、
  combined reservation 未超额、Override edge fail-closed，且没有伪造 room completion；
- focused test、strict typecheck 与 `git diff --check` 作为本切片提交证据；V4 source tree 不修改。

## Provenance

| 来源 | 用途 | SHA-256 |
|---|---|---|
| `1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json` | pattern duration、pattern-end cancellation 与 residue lifetime | `38224009f8ddb3ccd1b4a3d05351d4a37429188cb72da939fb340ea897b56614` |
| `1bit-stg-complete-asset-kit-v4/manifests/gameplay/room-composers-v4.json` | target room tier 的 rest budget | `5fb7a8ffa7a77553682f0644f2857fbd4e5f135e55ed5a9dc749640b5fa0e7e9` |
| `stg-dev/docs/adr/EXT-2026-015-first-continuation-room-plan-and-pool-admission.md` | predecessor plan、reservation 与输入边界 | `489b53e78152cc6606c925cfb613cc4ae74fddb1fa3c5e97e832dbecdc570a18` |

实现位于 `src/authority/combat-kernel.ts` 与
`src/authority/run/chapters/first-continuation-room-successor.ts`；接受证据位于
`src/authority/run/chapters/first-continuation-transition.test.ts`。

## 回滚

删除 EXT-016 sealed terminal/material port 与对应 owner API，恢复到 EXT-015 已完成 READ 安装但 terminal
ownership withheld 的边界。不得以回滚为由延长 segment、清空 residue、开放 Override 或签发 room completion。
