# V4 跨子系统严格集成 QA 报告

结果：**PASS** — 40 项检查，40 PASS，0 errors，0 warnings。

## 核心覆盖

| 系统 | 已验证数量 |
|---|---:|
| 运动算子 / 可执行弹幕 | 12 / 48 |
| 普通敌人 / 机械角色 | 16 / 8 |
| Boss / 阶段 / 激光拓扑 | 8 / 24 / 8 |
| Runtime events / machines / bindings | 72 / 12 / 34 |
| 无障碍组合 | 216 |
| 叙事状态 / 反应节点 / 观察句 | 16 / 13 / 64 |
| Pattern 动画 / Boss 动画 | 48 / 8 |
| 音频 / atlas frames / 背景反应层 / UI screens | 48 / 192 / 16 / 9 |
| 最终组合包 atlas / physical frames | 7 / 448 |

## 跨系统结论

- 房间枚举、Boss 世界观解决条件、真实 Ghost routeDuration 时钟与四类跨局材料均以单一权威事实接线。
- 叙事天气不拥有弹体、碰撞体或安全通道；同名弹幕只作为独立 encounter echo。
- 48 个 pattern 和 8 个 Boss 均拥有独立 GIF、APNG、timeline，且媒体帧数与 timeline identity 可复验。
- UI 实际 copy 不含 Score、Rank、Perfect 或道德化结局禁词；关键反馈由 visual / audio / haptic / UI 绑定桥接。

## 检查项

| 状态 | 子系统 | 检查 | 说明 |
|---|---|---|---|
| PASS | package | `json.syntax.all` | 230 个 JSON 全部可解析 |
| PASS | package | `json.local-schema-references` | 9 个本地 schema 引用全部存在 |
| PASS | gameplay | `gameplay.required-counts` | 12 operators / 48 patterns / 16 enemies（8 roles）/ 8 Boss × 3 phases / 8 unique lasers |
| PASS | gameplay | `gameplay.definition-id-uniqueness` | 玩法权威定义 ID 全部唯一 |
| PASS | gameplay | `gameplay.cross-manifest-references` | operator / pattern / enemy / boss / laser / director 引用闭合 |
| PASS | gameplay | `gameplay.canonical-index-checksums` | gameplay index 的 9 个文件尺寸与 SHA-256 一致 |
| PASS | runtime | `runtime.required-counts` | 72 events / 12 machines / 34 feedback bindings / 216 accessibility combinations |
| PASS | runtime | `runtime.definition-id-uniqueness` | runtime event / machine / binding ID 全部唯一 |
| PASS | runtime | `runtime.event-graph-closure` | 72 个事件全部由状态机定义使用；binding 引用与 critical coverage 完整 |
| PASS | runtime | `runtime.accessibility-orthogonality` | 6 个轴正交组合；full / reducedMotion / flashOff 强制事件轨迹一致 |
| PASS | runtime | `runtime.declared-file-references` | runtime manifest 的 17 个可部署文件引用全部存在 |
| PASS | narrative | `narrative.required-counts` | 16 states / 13 reaction nodes / 16 thresholds / 5 weather / 8 Boss resolutions / 64 observations / 7 witness / 37 cues |
| PASS | narrative | `narrative.semantic-id-uniqueness` | 叙事状态、观察、Witness、反馈 cue 与阈值语义 ID 全部唯一 |
| PASS | narrative | `narrative.reaction-graph-closure` | 世界反应图的 source / reaction node / edge 引用闭合 |
| PASS | narrative | `narrative.canonical-file-references` | 14 个 narrative canonical file 引用全部存在 |
| PASS | ui | `ui.forbidden-copy-tokens` | 实际 UI copy 不含 Score / Rank / Perfect / 道德化结局禁词 |
| PASS | ui | `ui.layout-copy-references` | UI layout 的 9 个 copy key 全部可解析 |
| PASS | audio | `audio.required-counts` | 48 WAV：4 room beds / 8 Boss signals / 36 SFX |
| PASS | audio | `audio.asset-id-uniqueness` | 48 个音频 asset ID 全部唯一 |
| PASS | audio | `audio.files-hashes-wave-format` | 48 个 WAV 的文件、尺寸、SHA-256、48kHz / stereo / 16-bit / duration 全部一致 |
| PASS | audio | `audio.feedback-cue-references` | 37 个 narrative feedback cue 的音频引用全部可解析 |
| PASS | art | `art.required-counts` | 3 个 V4 atlas / 192 semantic frames / exact 8-color palette |
| PASS | art | `art.semantic-id-uniqueness` | 192 个 atlas semanticId 全部唯一 |
| PASS | art | `art.atlas-palette-alpha-rects-hashes` | 3 个 atlas 通过 SHA-256、尺寸、hard alpha、8 色、每格≤4色、64 rect 与 source 检查 |
| PASS | ui | `ui.mockup-files-palette-alpha` | 9 个 360×640 UI screen + 1 overview；文件唯一、声明 8 色语义系统、hard alpha |
| PASS | backgrounds | `background.reaction-overlay-matrix` | 4 rooms × 4 states = 16 overlays；ID、文件、SHA-256、8 色、hard alpha 完整 |
| PASS | animations | `animations.pattern-and-boss-completeness` | 48 pattern × (GIF/APNG/timeline) + 8 Boss × (GIF/APNG/timeline)；一对一、帧数、identity、内容哈希完整 |
| PASS | integration | `integration.room-identity` | 三套系统统一写入 INFORMATION / FORCED_ALIGNMENT / IN_BETWEEN / POLARIZED；INFO_OVERFLOW 仅为迁移读别名 |
| PASS | integration | `integration.cross-run-dynamic-timeline` | narrative UI / ghost contract / runtime contract / restore machine 统一使用真实 routeDuration：0, 420, +420, +421, +700, +1140 |
| PASS | integration | `integration.disjoint-material-memory` | overrideScar / deathTrace / burnIn / ghostResidue 四类材料独立定义并按序恢复 |
| PASS | integration | `integration.boss-resolution-worldview` | 8 个 Boss 的 ID / resolutionId / condition / terminalEvent / materialRemainder 与世界观权威表一致 |
| PASS | integration | `integration.weather-gameplay-decoupling` | 5 类叙事天气仅属 world-presentation；3 个 WEATHER_ECHO 弹幕由 encounter director 独立调度，不读写天气 phase/seed |
| PASS | integration | `integration.asset-bindings` | 37 narrative cues / 34 runtime bindings 已绑定到 48 audio 与完整 frame universe |
| PASS | package | `package.v4-entrypoints` | V4 package manifest 的 13 个入口全部存在 |
| PASS | package | `package.v4-composite-counts` | 组合包为 7 atlases / 448 physical frames，且所有 V4 汇总数量与权威 manifests 一致 |
| PASS | package | `package.v4-atlas-files` | 7 个 atlas 的 ID、文件、尺寸与 SHA-256 全部一致 |
| PASS | package | `package.v4-frame-atlas-closure` | 448 个 physical frame 的 semanticId 唯一；每个 atlas 恰有 64 格且 atlas ID 全部闭合 |
| PASS | package | `package.v4-semantic-aliases` | 旧 Score / Power / Life 语义仅作读别名；所有 alias target 都是 448-frame canonical semanticId |
| PASS | package | `subsystem.reports-strict-pass` | 8 份子系统报告全部 PASS，且各自 0 errors / 0 warnings |
| PASS | package | `package.no-junk-artifacts` | 无 .DS_Store / __pycache__ / .pyc / .pyo |

## 严格性

本报告把 warning 视为失败条件；最终可交付门槛为 **0 errors / 0 warnings**。
