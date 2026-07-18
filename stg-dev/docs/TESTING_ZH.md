# 1bit STG 测试与验收基线

状态：`FOUNDATION / GATES IN PROGRESS`

原则：测试权威事实，不用截图替代玩法证明；视觉 QA 也不能反向决定碰撞。

## 1. 当前可执行命令

CI 从仓库根目录运行；`bun.lock` 必须已提交且不能在安装阶段漂移：

```sh
cd stg-dev
bun install --frozen-lockfile
bun run content:check
bun run typecheck
bun run test:unit
bun run build
bun run test:all
```

本地首次安装仍使用冻结 lockfile；只有显式更新依赖时才允许不带 `--frozen-lockfile`。Playwright 浏览器安装与分层运行命令是：

```sh
cd stg-dev
bun install --frozen-lockfile
bunx --bun playwright install chromium
bunx --bun playwright test
bun run test:smoke
bun run test:e2e
```

`playwright.config.ts` 默认先做 production build，再在 `127.0.0.1:4173` 启动不会被复用的 Vite preview。并行任务用 `STG_E2E_PORT`；针对已启动 preview/部署地址用 `STG_E2E_BASE_URL`。失败产物在 `test-results/playwright/` 和 `playwright-report/`。

V4 自身的四组契约验证必须从仓库根目录执行：

```sh
python3 -B 1bit-stg-complete-asset-kit-v4/tools/qa/validate_v4_integration.py
python3 -B 1bit-stg-complete-asset-kit-v4/runtime/validate_v4_runtime.py --run-code --strict-warnings
python3 -B 1bit-stg-complete-asset-kit-v4/gameplay/tools/validate_gameplay_v4.py
python3 -B 1bit-stg-complete-asset-kit-v4/narrative/validate_narrative_v4.py
```

`test:e2e` 运行完整 Chromium 契约，`test:smoke` 运行最短默认 RUN 门禁；`test:all` 串行执行 typecheck、unit、build、smoke 与 E2E。CI 与文档只使用 Bun 1.3.14，不保留第二套包管理入口。

## 2. 分层测试矩阵

| 层 | 验证对象 | 现有证据 | 工业验收缺口 |
|---|---|---|---|
| Type/Build | strict TS、Vite/PWA 构建 | `typecheck`、`build`；生产输出显示 Three/frame-index/pattern-manifest 稳定分 chunk 且 Workbox 纳入 precache | 构建 metadata/content digest；当前未验证按 RUN/Lab 延迟求值 |
| Unit | clock、event、content、pattern、projectile、player、laser、encounter/Boss、narrative、23-pattern direct-kernel combat family（exported live-admission registry 仍为20；含 One Sun、Clock Decree、No-dusk Grid 与 Room Threshold 各7-case focused matrices）、recorder provenance/route-present snapshot/in-memory archive/restore、shared run combat state/occurrence identity、17-case exact Left/Right 与14-case exact Alternating READ execution、隔离 Misreader enforce-entry laser/receipt-bound prepared seams、V4 gaze adapter、canonical run session、QA RunComposer、atomic room-transition、28-case LiveRunAdmission、presentation 与 legacy Lab | 当前完整 gates 已通过：29/29 files、577/577 tests、combat 169/169；层级契约不依赖 renderer | Misreader/Ballot/Crack/Context/Dusk/Override/Room Threshold/Rain/One Sun/Clock/No-dusk 的 session/renderer/browser path、其余25 patterns、通用/composed room-chain execution、parallel/multi-pool、完整 Run、accessibility/perf |
| Content contract | schema、ID、引用、hash、预算 | `content:check` + V4 validator；digest `f5ad0e32…c24bc2b2` | release metadata/冻结流程 |
| Runtime contract | 72 canonical events、state ordering | authority bus + V4 runtime validator；First Eye 持有 irreversible exact-next-tick lease，安静 tick 也关闭一次 | Pattern Lab legacy trace 与其余 Run 尚未全量同构；lease 不等于 rollback transaction |
| Oracle parity | 同 fixture 对 V4 reference runtime | NORMAL 48/48 trace hash；96/96 safe-gap path；23-pattern direct-kernel production family 覆盖 EASY/NORMAL/HARD，exported live registry 仍为20；Clock Decree 与 No-dusk Grid 的 immutable 30Hz deletion/hash 都和 identity-retaining 120Hz collision-lease/hash 分层锁定且不声称 lifecycle parity；Room Threshold 另锁 immutable QA hash 与 continuous 120Hz speed-envelope/phase-mask/lifecycle hash；One Sun、Unstable/Alternating、Ballot、Context、Rain、Crack、Dusk、Override Void、Wind Bias、Notification Overflow 与既有 families 保持分层 declared/application 语义；gaze 对 V4 state/deadline trace | 其余25 patterns 的 EASY/HARD 与增量120Hz adapter |
| Integration | current-run snapshot；in-memory archive；route-present restore | authority fixture 已覆盖 snapshot begin/serialize/present/complete、exact-bus/exact-serialize-tick archive persist、原 token retrieval，以及 16-state material/ghost/residue/witness/input 顺序；同 tick 排序固定 serialize 在 persist 前，但没有 live boot/handoff 接线 | 真实 Run producers、durable archive、next-run boot、app/IndexedDB E2E |
| Browser E2E | canonical RUN 序章、LAB、clock、pause、backlog、accessibility profile、PWA manifest | production preview 验证 exact V4 boot、seed fail-closed、guarded 觉醒、保留 backlog 的旧输入样本、Full/Reduced/Flash-Off 序章同 trace、live collider、source drain 后在 neutral gaze 下继续 `first_eye` | Misreader fragment 的默认/session/room/render 执行路径、设备→gaze 映射、完整 Run、N→N+1 升级事务 |
| Smoke | 默认 RUN 可启动；page/console/request failure 为空；V4 atlas/web manifest 返回 200；安装后 warm-offline reload 可用 | `bun run test:smoke` | 发布包、弱网、离线冷启动、缓存升级 |
| Visual | atlas、safe gap、warning、player 稳定代表帧、overlay parity | renderer 纯函数验证 committed gaze state 的 V4 `reveal/acquire/read`、life 代表帧和 gaze cone；人工 QA | event/tick-bound player causal clips、自动像素契约/实机矩阵 |
| Performance | tick budget、pool、GPU/内存 | 尚无基准 | 固定设备基线与回归阈值 |

## 3. Unit 与确定性契约

必须覆盖：

- 同 seed、初始状态与按 tick 输入得到完全相同 snapshot digest 与 event trace；
- 不同 render cadence（30/60/120/144Hz）不改变 gameplay trace；
- pause 期间 gameplay tick 不增长，恢复时不吸收 wall-clock；
- large delta 遍历所有 crossed boundary，且 1024 边界保护可诊断；
- 120Hz master 与 60Hz runtime due-time 长时间无漂移；
- 同 timestamp 严格遵循 collision-off → state/damage commit → collision-on → spawn → feedback；
- 同一 timestamp 多命中最多提交一个合法伤害；fatal/non-fatal 分支互斥；
- graze 唯一键含 instance/generation/player，最多一次；
- Override 证据不足拒绝，足够时只清除前方局部扇区，并写 typed scar；
- shared occurrence ID 一次性、UTF-8 byte-length-prefixed；并发 claim/复用拒绝，release 只能在 final lifecycle tick 成功 close 后生效；
- leased bus 只接受 exact next tick，安静 tick 同样推进 closed-through watermark；ambient flush、第二 owner、future/stale draft、accessor/reentrant/virtual-array 输入都在 commit 前拒绝；
- prepared after-state 必须消费 exact bus 为同一 draft group 签发的 one-use receipt；wrong-bus、wrong-group、same-revision sibling、stale/replay、无 append 均不能改状态；
- Misreader entry 只启动一次 laser，相对 `S` 的 arm/collision-on/first-contact/natural shutdown/residue/cleanup 必须是 `+104/+151/+152/+264/+286/+366`；contact 每 generation 至多一次、只伤害玩家、不发 impact，Override edge 被拒绝，16 capsule 只能标记为 adaptive adapter；
- Snapshot 必须只接受 recorder-issued exact in-memory token，在偶数 `T` 的 `T/T+50/T+98/T+196` 提交 begin/serialize/present/complete；raw/clone/parse/persist/tamper、deadline/bus 冲突在 mutation 前拒绝，只有 accepted serialize append 后才铸造 exact bus/token/payload/tick-bound receipt，且 complete 不发 cross-run event、不授权 handoff；
- in-memory archive 只接受该 receipt 与同一 serialize tick；错 bus、提前/延后 tick、duplicate run、伪造 receipt、occupied occurrence key 都必须在 archive state mutation 前拒绝，成功时 payload 恰有六个 V4 字段并返回原 recorder token；
- Crack 的 inclusive generation-owned seam mirror、pre-mirror linear segment、zero-time discontinuity、连续 corridor entry 与曲率界 boundary chord 必须共用 ordered path；prepared Override port 只接受 exact pool-owned/current-tick/active-generation path，且 scar 坐标是实际 first hit；
- Rain 的 `laneX:[]` 不能被补成 lateral wall；每个 grid 候选必须按 source-index 消费一次 RNG，再让完整 fixed-tick local-vector path 做 swept preflight，通过后才获得 entity identity，省略项不得产生 residue；
- Clock Decree 必须在 pattern-relative 整数 `tick120` 上区分 dual-clock XOR 与 quantized-triangle `phase_gate`；clock-off 冻结速度/碰撞，phase-off 只屏蔽碰撞且保留位移/RNG/identity，两者必须以可逆 entity-owned lease 复用同一 generation；exact singleton 必须继续被 exported 20-pattern admission registry 以 `unsupported-pattern` 拒绝；
- No-dusk Grid 的两个 emitter 必须各自拥有 XOR clock；`binary_cross` 必须使用 cusp-segmented continuous phase mask，phase-off 保留 motion/identity、clock-off 冻结 speed/collision；tick1464 不得提前宣布 lifecycle drain，tick1780 仍 draining、tick1781 才 handoff-ready；`resolutionHook:"no_dusk_clock_ticks"` 必须保持 inert，exact singleton `cc6c9636…7307b8` 必须继续被 exported 20-pattern registry 拒绝；
- Room Threshold 必须锁定 7800ms/timeline、departing/arriving 反向 speed envelopes、continuous sine `threshold_bridge` collision-only mask、全 candidate RNG/identity 保留、tick936 pattern end 与 tick1265 sediment drain；不得添加 hook/laser、atomic transition、composer/session/handoff，TRANSITION 3/3 不得当作 live transition-chain 证据；
- accessibility profile、音频/触觉失败和 devicePixelRatio 不影响核心。

当前完整 `bun run test:all` 已通过：`typecheck`；unit 29/29 files、577/577 tests，其中 `combat-kernel.test.ts` 169/169；content 8/8；build 69 modules；smoke 1/1；Chromium E2E 14/14。Room Threshold 新增7项 focused direct-kernel cases；No-dusk Grid、One Sun 与 Clock Decree 各7项 focused evidence 保持；`live-run-admission.test.ts` 仍为28项，No-dusk exact singleton `cc6c9636b2dd90d8b289d1d68fe7048ea1025c5cf01dea27e6912b047c7307b8` 仍锁为 `unsupported-pattern`。direct-kernel capability 因而是23/48，exported admission registry 仍是20。既有 Unstable/Alternating、Override 7项、Ballot 9项、Context 8项和其它 authority evidence 保持。另有17项 `live-room-session.test.ts` 与14项 `alternating-verdict-read.test.ts`，分别只覆盖一个 exact caller-resolved READ slice；它们不扩大 direct-kernel capability count，也不证明 room selection 或 full-Run execution。

Notification 专项锁定完整 manifest/timeline、hostile grid/local-vector records、E/N/H spawn/arm ticks、curve-key 积分与每个 120Hz master-tick endpoint 的 pattern-relative pulse 位移、非零 occurrence start 的等相位 projectile/event trace、pre-RNG lane omission、RNG/preflight/spawn/OOB/end 计数、render-cadence parity、tick1344 pattern end 与 tick1635 packet-dust drain。EASY `10634.8ms` final burst 晚于 `10500ms emit.end` 的 source tension 同样被显式锁定。stale 与 Absent Receiver 的既有 crossing/contact/lifecycle/Boss-no-handoff 断言不变。

不可变 Python `sim_core.py` 对 Notification 冻结 age-zero speed、忽略 arm、lateral drift 与 lane omission；30Hz declared compiler 虽执行 lane/drift，也不构成 120Hz production proof。随包 NORMAL report、应用计算的 E/H reference-v4、30Hz declared-v4 checksums 与 120Hz application evidence 因而分层记录。其余契约覆盖单 RNG stream、历史/外推 aim lead、移动玩家/弹体与 local void swept contact、同 tick damage、跨 render cadence parity 和 owned-FSM handoff gate。

shared-state 专项另证明：两个严格串行 kernel 继承 health/lives、evidence/graze registry 与未到期 Override；并发/复用 occurrence 在 mutation 前拒绝；ASCII 与 `猫:🙂/first` 的 UTF-8 长度前缀不会碰撞；HARD seed 99 在 tick1361 仍保留 19 个 residue，tick1362 的 remove/complete facts 未 close 前 occurrence 仍 active，close 后才释放。`advanceTick()` 可让 coordinator 在同 tick 加入 canonical fact，但另一个 tick 不能偷渡。First Eye 使用 `run:first-eye:0`，release 后不再 step 旧 kernel；shared idle tick 继续 player/Override deadline，并用当前 run timers 与 retained projectile-drain facts 决定 handoff。session/kernel/state 的 descriptor-trap reentry 都 fail-before-mutation。

这些测试证明串行 continuity 与 tick ownership，不证明 room selection/scheduling、parallel execution、multi-pool Override fanout、aggregate tier budget 或 transactional rollback。Misreader entry 的 Boss phase-exit + laser-start 已是窄范围 receipt-bound composite，player damage 也有 prepared after-state；两者均不是通用 rollback。通用 player-damage→projectile-impact 仍缺失，而本 laser contact 刻意不 impact/terminate beam。

hard-cut 专项使用 report seed `3982869609`。step keys 为 `{0ms:1, 420ms:0, 680ms:1}`；exact key 左连续，跨越 key 后才切换 snapshot speed，且同一 120Hz tick 内将 projectile displacement、按时间比例插值的 player displacement、contact 与 safe-gap preflight 分为 temporal sub-sweeps。速度为 0 的 flight 仍保持 collision enabled。EASY/NORMAL/HARD 的 `candidate/lane-omission/RNG/preflight-omission/spawn/out-of-bounds/pattern-end` 分别是 `121/11/110/25/85/33/52`、`168/12/156/35/121/63/58`、`204/24/180/40/140/100/40`；lane omission 发生在 RNG 与 entity identity 之前。Python QA 的 intervention/hash 分别为 `30 / 848e6b01d2d5a9d6ab0165aa70af5182827e5e190dcff1a4d12b85a824b5a9c8`、`42 / a297e3d11a7331787c529af3d65c010ce67f64fa43a78219959bc40c6b9a8729`、`54 / 56f76982854abad3f9e9d988ed5736ab29f202a1a3089300bf16d4ef02da285e`；declared-V4 application checksum 则为 `24 / 468cc841f604d29760c6c905bdadc869a9dcd44f550c80a03e41066b44a8783e`、`34 / c7f2416c57102c67b05bd2d217adcedba47e353d1e4346ad19062bde7bcffdf4`、`39 / ec66a47e3d1eb778a13674dec36adb2865d2a8bd749d2aae2d511a6d7505df99`。pattern 在 tick1296 结束，312-tick non-collision residue 到 tick1608 才排空。该能力只改应用 adapter/tests；V4 source 保持不变。

stale-packet 专项使用 report seed `2259046056`。reference-v4 的 EASY/NORMAL/HARD intervention/hash 分别是 `10 / db61c29f5b16f78984f56a3590a23b271eb1ab48a86594cc2bd125d26f9562b1`、`12 / 68ea9d2c2c42ae459dc689dc0d8c4f08901317050611be8d6a3c26ec9e1dc14f`、`15 / 9852e037849cfcfd3862c64d7218ca95846803c11790d5e12bf82f82c4495b87`；其中只有 NORMAL `68ea…c14f` 是 V4 随包 determinism report，E/H 是应用调用 reference-v4 compiler 得到的 QA baseline。30Hz declared-v4 intervention/hash 分别是 `10 / def2f8c722466a5350fa95b769ed08f89f670eef80a6379d013efa2f533e1f6d`、`13 / 36e6c1492e0d82d762ab0d99ec8540ee62211cf89f80cbbdcdc2f771e6de3c97`、`15 / 6d95b031c7a60f9a5a6c80824771ccb9636ec615f7a85c14b5e2702c68aeaf5b`。120Hz production 的 `candidate/RNG/preflight/spawn/out-of-bounds/pattern-end` 是 EASY `90/90/10/80/45/35`、NORMAL `110/110/13/97/67/30`、HARD `130/130/15/115/104/11`。这三层都不是彼此的替代证明；production 另锁 arm tick、key 内 moving-player contact、collision-off ordering、tick1176 pattern end 与 478-tick packet-dust 到 tick1654 的 drain。

Absent Receiver query 专项使用 report seed `3098160946`。reference-v4 与 declared-v4 在各难度相同：EASY `9 / 15b0510c803449ef73076397dc2456da892106713590651c2e0087c55146199e`、NORMAL `10 / 1d20801ad3c3cd807ed0c143a3b1735cac679beea3e457f82738f06378a46c42`、HARD `3 / 94b04fee2420e57ee6ed9f1bd453e42fba4f8fa171a3ff37fa36cda90a24d771`；只有 NORMAL 是随包 determinism row，E/H 是应用计算 baseline。120Hz `candidate/RNG/preflight/spawn/out-of-bounds/pattern-end` 为 EASY `60/60/9/51/28/23`、NORMAL `84/84/10/74/53/21`、HARD `96/96/3/93/79/14`。测试钉住 12 个 cadence 的 spawn/arm/760ms pause/1240ms retry crossing、同一 envelope integrator 的 numeric motion 与 safe-gap preflight、render-cadence parity、tick1296 pattern end 与 287-tick residue 在 tick1583 排空。rig observe 的 `exitCondition=absent_receiver.evidence>=1` 与 pattern hook 的 `phaseEvidence>=1` 保持两个未解释的 source facts；即使 snapshot 最终 `handoffReady:true`，也没有 `boss.phase.*`、laser 或 terminal event，因此不构成 Boss phase handoff。

One Sun phase1 的7项 focused tests 使用 report seed `2689482836`。exact whole-pattern validator 锁定 `fan/single-decree`、8 bursts、`op.turn_once(at780,+30) > op.linear`、alternating-wedge/operator-constraint、2495ms material trace、difficulty/seed/family laser/resolution hook；exact observe-rig validator另锁 `encounter.begin → one_sun_one_rule.evidence>=1`、`one_open_half` 与 `laserGeometry:null`。extra key、motion-order、pattern/observe accessor、laser/exit drift都在执行前拒绝。NORMAL first burst 从 tick81 spawn、tick86 arm、tick87 move；tick174 先转向，再让整 tick linear sweep 使用新 heading。continuous constraint 在 motion 后 edge-snap，同一 generation 继续存活且可在后续 tick 再次 redirect；E/N/H 全部 `80/104/120` candidate 均消费 RNG、获得 identity，`source_withdrawn=0`。不可变30Hz `emission/candidate/redirect/hash` 为 `8/80/24/99fa2c6102afb147af480adddc03e3c788ca91d6e0f1c382709a084557a8f525`、`8/104/0/0407cdec6ed371ecd4b66bf651c5c79e7fd515b50767f6b6fa83847bd9781d6a`、`8/120/70/50c7dbe48fd84ceba68d56a8515326abfadd48be0db998f9f8407ae1bf7657da`；120Hz `OOB/end/redirect` 为 `57/23/25`、`88/16/24`、`111/9/72`（HARD `22L/50R`），tick1380 hashes 为 `9053899fdb5c5feba0640d0f3b6af3f994e4102449fbdcea5ce16085a342b6ca`、`038426d85d5245616d296102b190d8bb0d6fcea1f21179ea1d75507d354d46ee`、`6cc6bc61700eb53e2be00e6f790d331975a164b088d73f6307bf0ca18fac933c`，tick1680 full hashes 为 `69bbfde0de194f312a95b5afbc1815823de255f8f4846fb207ce7d375c29a14e`、`25c9537a69207463340e4b217fc04ab70607ddfcb15b8e9eaf4a808ecc57c96e`、`467642eb04139d0aaafb8c87f790a1c4b7a06aefed75f3db5656a60f92134a3e`。30Hz endpoint oracle 与120Hz continuous production 不声称 redirect parity。safe-gap-following E/N/H hash fixture 的 event whitelist 只有 canonical projectile lifecycle；专项还另以 canonical graze 让 evidence 跨过 `>=1`，再证明仍没有 Boss phase、`laser.single_decree_sweep` start、resolution/terminal 或 phase2/3。nonzero start、30/60/144Hz、retained backlog 与 presentation/accessibility profile trace parity 均在 focused matrix 内；One Sun 落地时的历史基线为 `combat-kernel.test.ts` 155/155 与 aggregate 563/563，当前 Room Threshold 增量后的完整基线已复核为 combat 169/169 与 aggregate 577/577。

Notification Overflow 专项使用 report seed `1205726097`。reference-v4 EASY/NORMAL/HARD intervention/hash 是 `32 / 228260d84b23305c34c67f49d1da7d758aa3669676338a1e2afa60a08e948c06`、`42 / c4c0c449f2b4a3c337f33078d5f3bc8aadb5e8faebc420b97ea3c151039bb2a3`、`54 / bdbe90817bcba6a90fce23fc828622cfc06548c9c8d32661145cf6b703158cea`；只有 NORMAL 是随包 determinism row。30Hz declared-v4 是 `28 / 5ca61c5698e664a115f043235f13b2d1118edfa686e8060d14df8aac662691d9`、`39 / 16813e42231a1431a2fc0344a0da096e04d56705a5a5c62e57407302a056d4ad`、`45 / 48b686a6105de1314c70e710d2b0f1c2515c9ca47f9100ce1557c16ac9644a8f`。120Hz `candidate/lane/RNG/preflight/spawn/out-of-bounds/pattern-end` 为 EASY `180/0/180/28/152/75/77`、NORMAL `240/16/224/39/185/106/79`、HARD `288/32/256/46/210/148/62`。测试另锁 `grid/staggered-rain`、112→154px/s curve、11px/s lateral drift、`[12,18]`/1800ms/0.45 fixed-120Hz endpoint pulse sample、lane-before-RNG、完整 spawn/arm arrays、render-cadence parity、tick1344 pattern end 与 291-tick residue 在 tick1635 排空。

Wind Bias 专项使用 report seed `1709394890`。reference-v4 与 declared-v4 E/N/H hashes 分别为 `a08967082126112d23763302b1e83ca9b31c008a1a42cf31be80ef3a43fc7fd1`、`f71f171fd5d61e01cc11d9b4ff4b4610ad9fbce02ceab035fcf5e1965efe8d72`、`92a38086e744944ce814da54e36febf78cbd01a274addfe9bbb91552db45c012`，intervention 为 `3/4/7`。120Hz `candidate/RNG/spawn/preflight` 为 `72/72/69/3`、`90/90/86/4`、`108/108/101/7`；production event hashes 为 `20ef8b0405aca18abe447409d3452d3ea22bcd29d045f034abbd9691b9545f19`、`c69bb312fa1da427f4980334369f98a7e8c86f39d3757cd00f4153cb896970c3`、`b36d107625c6c1f9f45792108cd6a21293304e708404f8e08200df35d158640b`。测试另锁 `WEATHER_ECHO / COMMON` exact contract、`bullet.micro.seed → micro`、pattern-relative `[34,4]`/1600ms/0.6 field、非零 occurrence phase、四 room/30/60/144Hz/backlog/presentation weather parity、tick1152 complete 与 tick1530 residue drain；真实 weather 没有 gameplay adapter 入口。

Rain Packets 专项使用 report seed `1771193663`（manifest base `1771200059`）。reference-v4 与 declared-v4 E/N/H hashes 分别为 `6667fc66a702c25d1fbb56d8d3ba55d307695ce6b70c934b81c40b4b047776eb`、`68480085b6a1542700ad86eceb4e37aaede7e3a23b8854de82d61f64e7bdbbc2`、`aa8c029c73588e4488e93b1d02adf7f5c7ce6ab7334c0ed6d2527a23b16832f2`，30Hz intervention 为 `20/28/35`。120Hz `candidate/RNG/preflight/spawn/OOB/end` 为 `140/140/21/119/46/73`、`195/195/29/166/71/95`、`225/225/39/186/107/79`；production event hashes 为 `869d1ee119a4a772698c27a769386cf02fcca1a06b09521e085e1b2f306a308d`、`afd1dde61a6bc1b076571813e2b065bed8ca536b2d8d947e43cf66f0ff8038c7`、`1829f3539e67f76b8013d73ef10242369f59909d58b7f1b439772db013aca8d9`。测试锁定 exact hostile contract、`grid/uneven-droplets`、`[8,30]`/2100ms/0.35 fixed-tick endpoint field、spawn/arm arrays、RNG-before-preflight-before-identity、无 omitted residue、非零 occurrence start、四 room/30/60/144Hz/backlog/presentation weather parity、graze522 与 ordered nonfatal impact533、tick1128 complete/tick1584 drain。EASY 最后一次 burst 在 `8885.2ms/tick1067`，晚于 `emit.end=8700ms` 但仍在 duration 内，cadence authority 保留。Python 的点样本 intervention 不能证明 continuous 120Hz swept omission；真实 weather event/seed/RNG 没有 gameplay adapter 入口。

Context Switch 专项使用 report seed `2740011774`（manifest base `2740017633`）。exact hostile-contract tests 固定 A 的 literal `op.linear > op.turn_once` 与 B 的 linear `{0:0.72,520:1.28}` `op.speed_envelope > op.turn_once > op.linear`；`operator_constraint` 只在两条声明轨迹之后作为 safe-gap enforcement 执行，不加入通用 operator registry。连续 adapter 以相对正弦导数极值和固定 52 次二分找到每 tick 首次进入，接触轨迹使用 safe prefix + curvature-bound boundary chord；Python 只授权 endpoint edge snap 与 signed `±8°`，production 允许同一 generation 后续重复 redirect。reference-v4 与 declared-v4 E/N/H 的 `emission/candidate/intervention/hash` 分别为 `19/122/104/43c0ccdeed148b1608137f2db353d90fb89a53361a86a0bc4f263007eadcc30d`、`20/169/154/eaee02492d1be50f8df214f226ffe8be568b89b35085e25e3a9fa4ec5657846c`、`20/198/273/4cc95eb7f32cce086ddf5ff8cee009f4602664dfdb346a09a32f81c534578577`。120Hz `candidate/RNG/spawn/source-withdrawn/OOB/end/residue/redirect-left/redirect-right` 为 `122/122/122/0/75/47/82/93/49`、`169/169/169/0/120/49/99/110/50`、`198/198/198/0/166/32/103/215/121`；production event hashes 为 `7cb60b23323a16da617297daec9b3ce437cc1246e56b28f629b3288eff163bb0`、`99a2e087c38cbdd977766c3c3133d3ae8f3c6682ab7ce61f92fce524c0a9a1fb`、`b5a55f8da9c3a317289c8d871a1ad31c2a91973e5f8f923f3350496c37cb2855`。所有 scheduled candidates 保留 RNG/identity，不做 preflight omission 或 `source_withdrawn`。EASY final A burst `11398ms` 与 complete 同投影 tick1368；测试锁定 late 6 先获得 spawn identity、再按同 tick canonical ordering 直接进入 `pattern_end` residue且无 collision-on，tick1746 才 drain。其余测试锁定 nonzero start、tick93 graze/contact ordering、redirect 后的 Override ordered path、30/60/144Hz、单次 backlog 与 presentation profile trace parity。上述仍是隔离 kernel evidence，不是 live room/session/renderer 证据。

Unstable Middle 专项使用 report seed `1610616880`。测试先锁定两个 `op.linear > op.turn_once` stacks 的 literal order：A/B crossed turn tick 分别沿旧 heading sweep，再做零时长 `±16°` turn，下一 tick 才沿新 heading 位移；spawn preflight 使用同一 pre/post-turn path。E/N/H 的 `candidate=RNG / omitted / spawn / OOB / pattern-end` 为 `144/6/138/94/44`、`180/12/168/137/31`、`216/12/204/188/16`；pattern-end event/hash 为 `1208/1254d8341e630677096392855d1f683854c38056bb128a904e947d674158ced9`、`1504/0463a2a5fc3ce212d6cdf551f8c20127a2dbee2e7ccb5ca66ba36272e79eaf26`、`1866/f2f0ce3506a8fdfadf32888b76f59365fe92c4ef26614d84a1d73cf7a3243fe0`；完整 lifecycle 为 `1380/2ffd9cd25098d60ff8033812580d73fa7de1b3c2abacf8a2eb0b64ad2cdc0ff0`、`1680/175dd9006058b797fc652d666d14a86aaf79b0add900a57523f63652f65ad44b`、`2040/47990c6f57c3492a9a4b03c311137346c12109e5e574fa112db54b7dacbbb052`。tick1392 complete、tick1807 drain，三难度无 `source_withdrawn`/impact/damage。测试另明确 `boss.two_claims.phase2` 不在23-pattern direct-kernel capability（也不在 exported 20-pattern admission registry），不能由本修正推导出 dual-clock/turn 或 Boss phase-2 支持。

Alternating Verdict 专项使用 report seed `4224146597`。exact whole-pattern hostile validator 固定 V4 timeline、两 emitter、arc geometry、`op.linear > op.turn_once` stacks、angular omission、安全走廊、residue、difficulty 与 seed；descriptor/accessor/sparse/order drift 均 fail closed。preflight 与 runtime 逐 tick执行旧 heading sweep → 零时长 `±32°` turn → next-tick new heading；candidate 顺序为 source index → 一次 RNG jitter → complete swept preflight → entity/spawn，omitted candidate 没有 event/residue。E/N/H 的 `RNG / omitted / spawn / OOB / pattern-end` 为 `162/12/150/99/51`、`198/15/183/147/36`、`234/15/219/201/18`；完整 lifecycle event/hash 为 `1500/b7f2b9bca9fd76bce42f245cfd4cae302aec8297c19a836e6b38ad4e46e77a7f`、`1830/25a0fdd4617d491a33aa6fa9502af447dc5e6103582844c16ab9a81fddd22969`、`2190/92a7f8055a6703289bae5e570d7e07583cc5c8c7fbf7ade38c5a3e2b7a9c4c87`。tick1392 complete、tick1683 drain，均无 withdrawal/impact/damage；若一个已通过完整 preflight 的 body 被内部不可能状态强迫侵入，authority fail-stop 且不合成 `source_withdrawn` residue。测试另锁 contact ordering、shared release、nonzero start、30/60/144Hz/backlog 与 presentation parity。

Ballot Shift 专项使用 report seed `1912173942`。hostile-contract tests 锁定两个 `op.dual_clock_gate > op.linear` stacks、pattern-relative integer-tick XOR、时钟关闭的 speed/collision freeze、collision-on 开启 tick 仍静止/contact-ineligible，以及保留 identity 和 linear motion 的 continuous lane phase mask。projectile tests 用 occupied occurrence key 证明整批 gate transition 在 mutation 前预验，并在 accepted append 后用 finally 完成全部 after-state。Python E/N/H deletion `26/33/55` 与 production all-identity `170/220/260` 分层保存；120Hz hashes 为 `4ed653e2f043eddd47c3488bae6428c7ddcd3d9c0a6015cda2f7bfca692548fb`、`7d15af539bf24e1da5174ac29abbd4f81f2adbd018b9017b776a17921f097d3b`、`54c5ddcebe8adb79e603478ee1fa20a9cf03b744297bb04e01cc797b2b3d763f`。测试另锁 masked body Override scar、same-generation re-enable contact hole、tick1440 complete-before-arm、tick1750 drain、nonzero start 与 30/60/144Hz/backlog/profile parity。singleton admission hash `fea078a46315927d2f145be380ad7f38e6cbfef154e95337fd1ac9c90dcdc2a7` 仅证明 no-bus/no-composer/no-execution capability boundary。

Clock Decree 专项 7/7 使用 report seed `1517218079`。exact whole-contract/adapter tests 锁定 ROOM/POLARIZED、10000ms timeline、`binary-clock`/`shutter`、18-burst cadence、`op.dual_clock_gate > op.linear`、1000/2000ms duty-0.5 XOR、`quantized_step` center180/amplitude54/4000ms triangle phase gate，并拒绝 descriptor/accessor/sparse/order/seed drift；structure hash 为 `6ee303ef957c6f47f9d5d36e88ca3b7673950335c9f0715c9a5a18e8fcb8b343`，safe-gap hash 为 `e13842be6833dd18b4316868539e1334dd8579b9d091f46c438a452bee4576b4`。immutable 30Hz E/N/H `emission/candidate/intervention/hash` 是 `17/153/22/ddbfbf02011fc16e53117e66702bdd8b544f8124bb67e93e8bb1aad4300c0411`、`18/216/33/895b02be0bf75752221ae54ec4ac2d1ef4bf8637f744b32d760e35bbec06f450`、`18/252/55/6a4a588f6f2f7ef6efe55c24b26d9400b318691de1cc6be4fc44fbb7d0358ed0`，只是 placeholder deletion QA，不冒充 production phase-off/cancel。production 在 tick1200 锁定 E/N/H `candidate=RNG=spawn=armed` 为 `153/216/252`，dual/phase/OOB/end 为 `379/20/9/144`、`537/31/48/168`、`654/49/84/168`，event hashes 为 `364c95cebf91b115de2238b7bbaefa647b88a07892dc8242dcf25cefe70fe06e`、`bde5e39ebc67f11c95a675792af154e219ba44b7efc35e62865d4e7cc74249ba`、`14962808bf7d5003ade192815addd6e1bfce394c6d05a33ac6562371bc7e5911`；tick1493 full-drain hashes 是 `45074fc107311af97af8c7f7c478ff0a985af0cf40121cf5f9392a28a9f5999c`、`4732a1497d743ab9cf896c4a6774762fcad84fe6bcfd99198c527ed3ac6f2bd5`、`ea15a504c83f6755324beb1930db3e59c3d0875b77c84b5d55f666d9bd34ad9f`。测试还锁定 triangle cusps/XOR windows、same-generation clock/phase lease 恢复、EASY 9856ms 晚 burst 仍在 tick1183 spawn/tick1188 arm、HARD 8 graze/evidence 且无 damage、nonzero start、30/60/144Hz/backlog/weather/accessibility parity。`room.polarized.clock_decree` 是 direct-kernel 第21项；exported registry 仍为20，exact singleton gameplay hash `43bf1afb9a26ccbe5430a013e66feabf63d481b55d303aee328a237c192007e2` 在 `live-run-admission.test.ts` 第28项以 `unsupported-pattern` 拒绝。这些证据不表示 composer/scheduler/selection、READ/session/room completion、Boss/laser/resolution、renderer 或默认 RUN。

No-dusk Grid 专项新增7项 focused cases。两个 emitter-owned XOR clocks 与 `binary_cross` cusp-segmented continuous phase mask 分开断言：phase-off 保留 motion/identity，clock-off 冻结 speed/collision。E/N/H candidate 为 `133/168/203`；immutable QA deletion/intervention/hash 为 `13/e587211cb50d6e42a0feab07f08d18520188495314743e53cc2f79c189315bcd`、`18/b2c402fd550d19386c096ca39f3bf40e12f63fb64080e3d4660acbbdfc49b3f6`、`22/9871c0383df928b0c2f8594380e9295a31f88e30f6bbce0b440084a3947eba57`。production tick1464 的 `activeResidue/removed/allocated/peakLive/peakResidue/hash` 为 `119/14/124/90/119/3ddd331ca7e8a6da50fbd6e863743c58c21f1aab2c541be0f69b14e765b8987d`、`148/20/159/129/148/c9023f0f7ea2ab512901db451990f41fb9f07b0cb2aa845762d02af906243e61`、`161/42/189/154/161/e465928f2680f83cb53009da3f1b3895bee873f7bad3db33c792ac3282bcdfa5`；tick1780 仍 draining，tick1781 才 lifecycle drained/handoff-ready，hashes 为 `88ba6f54861d98819fae1ee0dba79dae9df1b27d4826b67aacd224b0a17bc1c6`、`aa941a85fd21c0c855d9bcb4a2cf1952ea088dc058d5b6e09ef8ec4b9c06a221`、`3d50e7891159a3ab2d5146270796273c48b56cad8929a950db1e383325dbaf61`。EASY authored `11861ms` late vertical burst 在 `emit.end` tick1380、`residue.commit` tick1414 后于 tick1424 spawn、tick1429 arm；测试锁定关闭时钟下 same-position identity、无 collision-on 与 pattern-end cancel。`resolutionHook:"no_dusk_clock_ticks"` 精确存在但不得自动完成、发事件或写 metric。exact live-room singleton hash `cc6c9636b2dd90d8b289d1d68fe7048ea1025c5cf01dea27e6912b047c7307b8` 在保持28项的 `live-run-admission.test.ts` 中以 `unsupported-pattern` 拒绝。证据不表示 composer/scheduler/selection、READ/session/room completion、Boss/laser/resolution、renderer/default RUN。

Room Threshold 专项新增7项 focused cases。exact hostile validator 锁定 7800ms timeline ticks `[0,89,89,468,852,886,936]`、departing `line`/arriving `fan`、`1→0.55` / `0.55→1` speed envelopes、continuous sine `threshold_bridge/phase_gate`、2741ms material trace、difficulty/seed，并拒绝 extra key、descriptor/accessor、sparse/order/geometry drift；private registry 边界不因 TRANSITION 3/3 改变。E/N/H candidate/RNG/identity 均为 `61/78/89`，QA hashes 为 `46f93363fad94f5e8df59e793844758737cbbe0887e63a95d4228fd9692b4c8e`、`0c483797777dc1fcdb1102982ad58d618422f0acd25729f892e2d93f45b42c8c`、`7f2600cfa4ca0a2cceb26dcdcb7759c032290e7bd0e878b8d9759270a2d77aff`；structure/gap hashes 为 `de88365e1c85d565eec9997191f184ecfc057a3d2744e3185aa44b8e685529a5` / `6bf60e85111ae26498923360c571fbc438a6b45eceeca0325b825645d9f08665`。测试在 phase boundary 前后锁定 collision-only mask 与持续 envelope motion；tick936 E/N/H hashes 为 `36e3b5c511d7a42d46dfef94c54a0cced93d9392800351e0cc3228ecf378a6ae`、`92d7ea69574d22a1cfe8c1b2fd3fdd07a28293028358d221140ed163dfdb07d5`、`c48b285bdb2fe89b4fe593c73f45d8921784d43d6ff0899ef5b7c091ec7d9e59`；tick1265 full hashes 为 `dc6a4490094f45d876b10535843dbb3734548fd19fa0d6125b4878ab2da7825b`、`ebba622fef62ef1b1568552d903134159ec1a4558e13478b90b131b96e9168b9`、`f63a5bc9a19083154b1b69fb95a47ce0186c124e3e496f4646fd6d9cc5e5c072`。nonzero start、30/60/144Hz、retained backlog、weather/accessibility parity 均锁定；证据不表示 atomic transition、composer/scheduler/selection、session、room completion/handoff、renderer/default RUN。

Dusk Settle 专项使用 report seed `924053617`。reference-v4 E/N/H hashes 为 `216fcd54ba5b35eb60786f245a17fdc9445695f064e77cda8bce69739bc2469a`、`18e63cdf2b880d71a5dd3f84680464d2d047e14bf7a144357e5024925a846298`、`5c88aa2503048653ded017733a829f94deb3516165cb0a202101602808824988`；120Hz production event hashes 为 `9867ff2413c15077d0ad7b5d487a65384de3f47be2d11de791f26b8bfe35776a`、`cbc7a1f93f73a9e6a68fa59fd34b4a91923bbcaa4db1c0b4d22ee1b2339797df`、`97dc90a77e51700d393f90d72ef4988964d4c1a7e89dc8342a876186f5b6289f`。E/N/H `candidate/RNG/spawn/pattern-end` 为 `63/63/63/63`、`84/84/84/84`、`98/98/98/98`；测试锁定 linear `{0ms:1,1200ms:0.42,2100ms:0}` envelope、spawn/arm ticks、startTick401 相对运动/完整 lifecycle/normalized event parity，并将四 room 与 30/60/144Hz/backlog 两个轴分别比较。tick984 complete、411-tick sediment 在 tick1395 排空，`snapshot_capture_ready` 保持 inert。没有 sourceWithdrawn、OOB、impact 或 damage，也没有 live transition/snapshot 接线。

Override Void 专项 7/7 使用 report seed `1930559651`。exact hostile-contract 锁定 full-360 `ring/directional-void`、4 次 cadence、E/N/H 每次 `12/16/19` body 与总计 `48/64/76` RNG/entity identity，并拒绝 hook、geometry、offset topology、seed、descriptor 或 sparse-array drift。运动测试锁定每 generation 的 inclusive first crossing、heading-preserving signed `±22px` one-time offset，以及 linear sweep 后的 zero-time offset-discontinuity sweep；contact、visible rule clip 与 explicit DirectionalOverride 都使用这两段。safe-gap follower 的 E/N/H `source_withdrawn/OOB/pattern-end` 为 `2/31/15`、`3/42/19`、`4/66/6`，无 impact/damage；tick912 complete hashes 为 `193dbe2b90324ea80cef276e003262e6f805fd169fb21a0b0a20e717208d769b`、`0222f436df16b75e04792e9cf9c5000ab5e31ffe6716a390a33994928ddcce43`、`6cbfe5b2fbd821b78ef746b536aab27bddb04852c604519dd7bd0f2c496d7e51`；tick1258 drained hashes 为 `f00bd4fedcb6aae210bf6a04a8c19db2179442dbffb59d6671da2323569303f8`、`5c62bd0bca3d7ce1da8f969de9fe8354c68ae83a0c6754a592cfea74fdb0c251`、`6709ae5aa9dcaa970aef8a25e85c05556a7de05cf6fea6cae5f56c6cdd38057d`。测试另锁定显式 DirectionalOverride 在真实终止坐标写 scar，以及同 tick corridor clip 先提交 `collision.off(source_withdrawn) → cancel(source_withdrawn) → residue.begin`、不重复 Override terminal、不写 linked cancellation scar。`scar_coordinate_commit` 保持 validated/inert；30/60/144Hz、backlog、weather/accessibility、startTick401 保持相对 parity，shared-run state 在 mutation 前 fail closed。这些证据不表示 `evidence>=overrideCost` phase admission、director/session/composer/scheduler、room transition/event、automatic hook completion/persistence/Snapshot/handoff、renderer 或默认 RUN；没有新 asset、event ID、dependency 或 gameplay language。

Crack Fall Loop 专项使用 report seed `3074674485`（manifest base `3074675749`）。E/N/H Python reference hash/intervention 为 `18563a10dcc0b197fcb8574c9272beb3af9f80252c8491b346176b3d0d88618f / 72`、`def23749655a5c2244e89d33436e9ba144a4a5fd06124f2a30aea608e563fc14 / 49`、`4a621d2078a9614f6a6f7bfcb7406d02f82f232693ed50936e824809d609377c / 71`；declared TS hashes 为 `394149b3177cd773d085209d6289012c2c762eb7944e8e3fdad4885bff5f0e63`、`248c2faf51fd9d8eb1485286d3478a18c432bb93dccf62c3772e2291e7736911`、`975c6bd18fa42d6c44571616182d65db36fb23d11b33f8423d690e5c08a7458c`；120Hz production event hashes 为 `7b3e9adcc1b71329e5df851949d376a3f02cc19b51613e9648429af61d6496b8`、`22af3f70c7f67589db56e98ac7fc4a3f4e2f1d4c0d1dd212fbf4b73ad4d1ac48`、`2ca79d498e7b0a53a51993ec23974a652f726d50f137011695fd0c807289a2f4`。测试锁定 `90/120/140` candidate/RNG/spawn、inclusive first seam transform、正弦 corridor 的 analytic-extrema + 52-step bisection、曲率上界 boundary chord、moving-player contact/graze/Override 同 ordered path、tick627 nonterminal redirect、tick1320 complete 与 tick1782 drain，以及 startTick401 的 normalized motion/event/lifecycle parity。Python 只为 endpoint edge snap 与 signed `±8°` redirect 提供来源，不证明连续 120Hz path；production 的 redirect/OOB/end 计数另独立锁定。

`snapshot.test.ts`、`cross-run-archive.test.ts`、`cross-run-restore.test.ts` 与 `run-memory.test.ts` 锁定 recorder-issued provenance、finalize 深冻结、raw/clone/parse/persist/tamper/accessor/forged-token 拒绝，以及 method-shadow-safe intrinsic event-bus append。Snapshot 只在偶数 `T` 的 tick `T/T+50/T+98/T+196` 写四个 current-run event，chunked/large-delta 相同，batch rejection 不留下部分 state；module-local draft 与 runtime-private result capture 也拒绝 own-property shadow 伪造 event/返回值。serialize append 成功后才可捕获 exact bus/token/payload/tick-bound receipt；in-memory archive 拒绝错 bus、提前或延后 tick、duplicate run、伪造 receipt 与 append 冲突，在同一 serialize tick 成功时才保存原 token 并写一次 canonical persist event。occupied occurrence key 的 append rejection 会让 archive 保持 absent；因为 key 已被 bus 永久占用，该 bus 上的同 key retry 也会永久失败，文档不把它称为 retry-safe。payload 使用应用 numeric `RunMemory.run.seed`，明确不冒充 V4 reference string `SnapshotRecord`。Narrative 在任何 reaction/state mutation 前预检 begin→serialize→present→complete 与独立 archive phase，hash/seed/route/duration/四类 material counts 必须全同；out-of-order、fresh-key duplicate 与 forged payload 都不留 projection/state residue。Snapshot 不写 cross-run/session/renderer/input-return；archive 不拥有 durable storage/session/restore/handoff；直接消费只选择 category-unique observations，保持 `BOOT_REHYDRATE` 与 `handoffReady:false`，两个布尔事实也不能绕过 authored terminal narrative path。Restore 的共享 ledger 在 append 成功后一次性提交 previousRunId→routeDigest、route→nextRunId、nextRunId→route 三个 index；重复 route、重复 next run、同 previous run 的冲突 digest 与 bus rejection 都不产生部分 state。route960ms 的 11 个 events 落在 tick `0/52/166/200/252`，tick166 的 `ghost.replay.complete` 先于 `ghost.residue.write`；chunked 与最大 delta serialization 相同，input 在 tick252 前保持 withheld，ghost collision/reward/emitter 为 `NONE`。直接送入 `NarrativeAuthority` 后 restore 只到 `AWAKENING`；gaze release 加 room swaps 仍停在 `FIRST_CLAMP_RECOVERY`，不伪造 recovery-complete。

`lasers.test.ts` 与 `encounters.test.ts` 继续用 occupied occurrence key 验证 laser/Boss prepared paths 不留半个 canonical fact；Misreader 专项锁定 spawn/damage conflict、manifest drift、method shadow 与 cadence/profile parity，但这不构成通用 rollback。Crack 专项把 ordered paths 绑定到 exact pool owner/current tick/active generation；Ballot 专项则把同 tick 全部 collision transitions 绑成 prepared retained-bus batch，拒绝前无部分 mutation，append 受理后的 after-state 即使遇到后续 contact fault 也会完成。保持28项的 `live-run-admission.test.ts` 继续穷举显式字段、seed domain、segments/parallel/Boss binding 与 hostile shapes，并锁定 POLARIZED pair、singleton stale INFORMATION、singleton Context IN_BETWEEN、singleton Ballot FORCED_ALIGNMENT 与 Left/Right fixture 的 exact membership/seed/segment/hash，以及 exact Clock Decree / No-dusk Grid singleton 在 exported 20-pattern registry 的 `unsupported-pattern` 拒绝；No-dusk hash 为 `cc6c9636b2dd90d8b289d1d68fe7048ea1025c5cf01dea27e6912b047c7307b8`。`alternating-verdict-read.test.ts` 另在构造 executor 前通过同一 admission 边界锁定 singleton Alternating。所有 admission 都不选择/组合、不发 bus event，也不 schedule/execute kernel。`live-room-session.test.ts` 与 `alternating-verdict-read.test.ts` 是彼此独立的下一层：各自重新验收 exact raw singleton candidate 后才创建内部 bus，Alternating executor 还在 bus 分配前明确拒绝 pair。Room Threshold 不是 room admission fixture，仅在 combat-kernel focused matrix 内验证。`gaze.test.ts`、`run-session.test.ts` 与 browser tests 的序章 evidence 保持不变。这些证据不等于其余25 patterns、通用/composed room chain 或完整 Run 已端到端完成。

room-capability fixtures 通过 `admitLiveRoomCapability` 验收 schema `1.0.0-live-room-capability`、authority `caller-resolved-live-room`。POLARIZED exact pair hash 是 `0659e91c3a0cabbf17a5a5961189d47f13f1a27e341360ad92aca34a674ba820`；singleton Alternating 是 `36da160cd1a63e96a71c6c5978c1d3b73398e177c8b447ef08274c6215824131`；singleton stale 是 `7915d5ce98233f1e7f6a2f643b94b84a67b27dee71079d5833bc4c1aa5672c24`；singleton Context 是 `28c2b7463bb32f3d43e572fc23520464f1a5f0c680c239f6fd6d6ed0c7c987fe`；singleton Ballot 在 raw seed `0x12345678`、salt `0x2200`、EASY、`readMs:12000` 下是 `fea078a46315927d2f145be380ad7f38e6cbfef154e95337fd1ac9c90dcdc2a7`；Left/Right fixture 是 `b6a1eddf043960a43a3b2af99cadb355932b6ae26fafb9da1563232a642d2d1c`。full/room contracts 与 plans 都固定 `canonicalEventBus:false`、`composer:false`、`executionScheduled:false`，且 recursively frozen。既有 full-Run structural hash 仍为 `61b57932e31d521380219cb1b27357c7198da41ece34aca162423ac56b36b75b`，完整 Run 仍被 capability rejection。这只验证 caller-resolved data boundary，不是 selection/composition、kernel execution/event emission、spatial overlap/projectile budget 或 continuity。

Left/Right execution tests 固定 metric capture tick960、telegraph+entry 的159 tick elapsed authority与因果 start `S>=1119`，并拒绝 `S=1118`、错误 READ-boundary literal 与伪造 incoming safe-gap claim。相对 `S` 的 material settle/rest/residue/fixed close 是 `+1224/+1350/+1540/+1542`；telegraph/entry 保持未执行，520ms handoff 不追加为 serial window。terminal boundary 拒绝 gameplay frame；`closeSlice()` 只在 occurrence 已释放、run timer 静止时提交一个无事件 internal neutral tick，并将 nested kernel ready 改名为 occurrence-local evidence，顶层 room/run handoff 始终 false。测试另锁 hostile shape/accessor/reentry/fail-stop、相邻奇偶 nonzero-start normalized lifecycle、wrapper-level collision-off→impact→damage ordering、30/60/144Hz/backlog、stepped revoked projection opacity、最早因果起点的860-event hash `0dceca99986974893345ce2d80e7aff31640e3bd551f98835223be2403016695`、86 spawn / 99 RNG。观察到 digital/live/all-authority/residue/allocated-micro 峰值 `56/56/77/74/77`，但执行不使用这些数值作 tier budget gate；累计 spawn86 也不被解释为 concurrent budget。

Alternating execution 的14项 tests 固定 raw seed `0x12345678`、14 metrics at tick960、salt `0x2200`、resolved seed `0xe9f333c4`、parallel-none selection seed `0x1234ba38`、六段 `520/800/11600/900/1600/520ms` 与 singleton hash `36da…24131`；pair `0659…ba820`、parallel member、错误 hash/seed/segment/tier/pool、hostile accessor、早于 `S=1119` 和 cumulative overflow 均在 bus 创建前拒绝。相对 `S` 的 material settle/rest/release/neutral close 是 `+1392/+1500/+1683/+1692`，最后一 tick 只允许 quiescent internal close；顶层 room/run handoff 恒 false。stationary-center neutral trace 仅含10种 canonical projectile event、1500 events，hash `21c28e87ea9bdb9fd2a9777fd8f6cc3392209ae5557ede1b766b6d3bcf36bd3c`，并锁定 phase order、unique occurrence keys、30/60/144Hz/backlog、opaque projection、nonzero start、timer/reentry/fail-stop。`stationary-center-unfocused-graze10-damage1` observation 的 digital/live/all/residue/allocated 峰值为 `52/52/83/83/83`，spawn/RNG/omission/emitter 为 `150/162/12/2`；composer listen `80/2` 与 director EASY `120` 的 concurrent/cumulative/residue-inclusive 语义未定义，因此没有 budget enforcement branch。

`run-composer.test.ts` 直接 deep-compare `director-determinism-report-v4.json` 的 `0x1B17` 完整 33-event 样例与 16 个 seed row，并锁定 manifest 声明顺序、tier 边界、`0.15` 结构签名 penalty、QA/live seed 分离、transition/Boss/Dusk 与不自动激活 weather pool。该产物不写 72-event bus，不能作为 live Run 证据。历史 mixed encounter envelope 已重命名并隔离成 non-live `EncounterEnvelopeFixture`，测试同时锁住它没有 canonical event bus 写入口。`room-transition.test.ts` 则直接钉住 V4 240/500/650ms FSM，在偶数 runtime60 master boundary 提交世界交换、ready 与 complete，验证 large advance 保留 due tick、跨 generation 同 tick 顺序和失败原子性；它与 7800ms `transition.room_threshold` 是两层 authority。

## 4. Content 与 oracle parity

P0 Content Authority 已建立 canonical content index，并断言：

- 48 pattern 分类数量为 BOSS 24、COMMON 2、ROOM 16、TRANSITION 3、WEATHER_ECHO 3；
- 12 motion operator 均有可执行 fixture，不允许“未知 operator 静默忽略”；
- 8 Boss 各正好 3 phase，phase pattern 和 resolution event 均可解析；
- 8 laser geometry、4 room composer、72 event ID 全部可达且无孤儿引用；
- 7 atlas、448 frame、16 reaction overlay、48 WAV 的文件 hash/尺寸/引用有效；
- canonical room 只写 4 个新 ID；`INFO_OVERFLOW` 只允许 migration read；
- schema warning、runtime failure、feedback→gameplay edge、fixed projectile timeout 均为 0。

当前 oracle 已对 NORMAL 完成 48/48 最终 trace SHA-256、emission/gap/split counters 和 96/96 normal/focus safe-gap path 的逐项精确同构，并另测 12 operator、13 geometry 与 swept warning primitive。生产 kernel 直接支持的23个 pattern 已有 EASY/NORMAL/HARD 确定性 focused evidence；Clock Decree、No-dusk Grid 与 Room Threshold 仅在私有 isolated 列表，exported live-admission registry 仍为20。Clock/No-dusk 的30Hz placeholder deletion 不替代120Hz identity-retaining clock/phase leases；Room Threshold 的 immutable QA hashes 不替代120Hz continuous speed-envelope/phase-mask/lifecycle hashes；One Sun、Unstable/Alternating、Ballot、Context、Rain、Crack、Dusk 与其它已接 pattern 的 Python/declared/application evidence 也继续分层，不声称未证明的 adapter parity。其余25 patterns 的 EASY/HARD 和增量120Hz adapter 仍须比较 due-time、identity、spawn order、operator state 与 lifecycle events；`boss.two_claims.phase2` 仍在这25个之中。事件 ID/tick/order 必须精确相等；Room Threshold 增量后的完整 `test:all` 已通过 unit 577/577、combat 169/169 及全部 content/build/smoke/Chromium E2E gates。

## 5. E2E 与 Smoke

现有浏览器测试职责：

Misreader enforce-entry fragment 当前没有 browser 路径；将来必须另行验证它的 session/room 可达性、warning/beam/residue 投影、Override 缺席与全 profile trace parity。现有 unit/cadence 证据不能替代这些 E2E/visual 门禁。

- 默认 `/`：面向玩家的 canonical 序章，Lab 面板/文案不可见，boot 只使用 V4 `continue.withoutMemory`，固定 seed 下从 `quiet_awakening` 进入 First Eye；
- 显式 seed：只接受十进制 uint32，空值、越界或非数字必须 fail closed，不选择 entropy；
- 序章 guard：只有 fixed 8 秒边界与 2 次 meaningful input 同时成立才进入 First Eye；同 tick movement+signal rise 只记一个 fact，触控不获得双倍权重；默认 RUN 隐藏全量控制说明，60 秒无 signal 时只显示 V4 `prompt.signal`；
- 序章交接：生成停止后来源 combat 明确报告 pattern complete、entity/residue drain 与 live entity 归零；浏览器默认继续提供不合格中性 gaze sample，因此 phase 保持 `first_eye`、handoff 保持 not-ready，没有中断文案或 legacy fallback；
- `/?mode=pattern-lab`：legacy `GameSimulation` 的 48 pattern 检查面，可选、首尾循环、难度切换、pattern 重置；
- Space pause：clock 精确冻结并恢复；
- accessibility profile：`full` / `reduced-motion` / `flash-off` 使用同一序章 authority trace；
- PWA manifest：standalone、192/512 any、512 maskable，图标可访问，安装后 warm-offline reload 可启动；
- page error 必须为空。

P0/P1 还要增加：

- 固定 seed 的完整 Run 至 snapshot/archive，校验 route digest 与 end fact；
- reload 后 next-run restore 顺序及 input return tick；
- production `bun run preview` 的离线冷/热启动、未知 URL fallback；
- service worker N→N+1 更新在 Run 边界生效，禁止混合 digest；
- IndexedDB migration、quota、损坏记录隔离与导出；
- 完整 Run（不只是序章）的 reducedMotion/flashOff/full trace parity；
- 390px 移动视口无阻塞操作、focus 顺序和文本可读性。

Smoke 必须保持短：启动、进入、clock 前进、无未捕获错误、关键资产/manifest 200。完整 Run、离线升级和视觉回归不塞进 smoke。

## 6. 性能门禁

性能阈值在固定硬件/浏览器/场景上记录，不能用开发者主观“感觉流畅”替代。P1 建立以下基线：

- 120Hz 核心单 tick 的 P95 小于 8.33ms，且不得靠跳过 gameplay tick 达标；推荐工程目标 P95 ≤ 4ms，为渲染和系统抖动留余量；
- room tier 的 `maxProjectiles` / `maxEmitters` 必须在后续获得 V4 授权的 concurrent/cumulative/residue-inclusive 计数 policy 后成为 contract gate；在该 policy 缺席时只记录各口径 observation，不把任一口径越界伪装成 runtime failure；
- projectile/shot/sprite 使用有上限的 pool，10 分钟 soak 后 heap 和 GPU resource 不持续增长；
- Desktop Chrome 目标稳定 60fps presentation；中端移动设备允许降 presentation 质量/帧率，但权威 trace 不变；
- atlas/material/texture 数量、draw calls、JS heap、GC pause 和 shader compile stall 写入 benchmark artifact；
- Worker 迁移只能在 profile 证明主线程瓶颈后进入 P2，不能预先增加并发复杂度。

建议固定场景：最高 manifest projectile budget、三段 Boss laser、room transition、snapshot/ghost replay，以及 10 分钟 mixed Run soak。

## 7. 实机游戏手柄验收矩阵

浏览器自动化无法代替实机 Gamepad API 验收。每个发布候选至少记录：OS/版本、浏览器/版本、连接方式、手柄固件、mapping 字符串、结果和已知降级。

| 设备族 | 连接 | 平台最低覆盖 | 必测 |
|---|---|---|---|
| Xbox Wireless / XInput | USB、Bluetooth | Windows Chrome、macOS Chrome | standard mapping、摇杆/D-pad、A/B、LB/RB、Start、热插拔 |
| DualShock 4 / DualSense | USB、Bluetooth | macOS Chrome、Windows Chrome | Cross/Circle 映射、dead zone、断线回退、可选振动 |
| Switch Pro | USB、Bluetooth | macOS/Windows Chrome | mapping 差异识别，不猜测标签；必要时 remap |
| 通用标准手柄 | USB | Chrome | 无品牌 ID、轴漂移、按钮 edge、无 haptics 降级 |
| Mobile controller | Bluetooth | Android Chrome；iOS Safari 记录能力 | PWA standalone、重连、系统手势冲突 |

每台设备执行：

1. 冷启动前已连接与运行中热插拔；
2. 0.18 区间内无漂移，满幅保持方向并 clamp；
3. 摇杆和 D-pad 同时输入时择强一致；
4. Override/Pause 每次实体按压只产生一个 edge；
5. Focus 可持续按住，Shoot 可持续输入；
6. 断开后键盘/指针仍可操作，重连不残留按键；
7. haptics 拒绝/不存在时无异常且 trace 不变；
8. Full/Reduced Motion/Flash-Off trace hash 相同。

## 8. 发布验收单

发布候选只有在以下证据均归档后可标记：

- typecheck、unit、build、4 个 V4 validator、E2E、smoke 全绿；
- 0 manifest warning、0 orphan ID、0 unknown operator；
- canonical trace parity 与 accessibility parity 全绿；
- 固定性能/soak artifact 无预算越界或泄漏；
- 实机手柄矩阵有记录，未覆盖项明确列为风险；
- PWA 在线/离线/升级/存档迁移通过；
- 每个 V4 外扩展均有通过的 Extension ADR 与 provenance；
- 版本、Git commit、content digest、extension digest 可从发布包诊断页读取。
