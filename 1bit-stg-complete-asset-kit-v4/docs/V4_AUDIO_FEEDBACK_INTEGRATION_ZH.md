# V4 音频与反馈系统接入说明

V4 音频不是背景配乐包，而是世界读取行为时产生的信号。所有声音由项目内脚本程序化生成，没有使用外部采样。

## 1. 资源清单

`manifests/narrative/audio-manifest-v4.json` 是权威清单，共 48 个 48kHz / 16-bit / Stereo PCM WAV：

- 4 个十二秒无缝房间声床；
- 8 个独立 Boss 信号；
- 36 个战斗、叙事、天气与 UI 事件音效。

生成命令：

```text
python -B audio/generate_audio_v4.py
```

脚本使用固定 seed，并为每个文件写入 SHA-256、时长、峰值和 RMS。重复生成应得到相同文件。

## 2. 四房间声床

| 房间 | 声音结构 | 运行时参数 |
|---|---|---|
| INFORMATION | 60Hz 身体、无回答的 chirp、周期性颗粒漏失 | 花亮度增加 chirp；凝视移除高频 |
| FORCED_ALIGNMENT | 左右声道相差 20Hz 的两种主张 | X 位置调整主张增益；靠近 seam 提高干涉 |
| IN_BETWEEN | 两套不锁相时钟与共享五度 | A/B claim 分别调制声道；交集提高共享音 |
| POLARIZED | 干燥 440/880 开关时钟 | Gaze 增加密度；No Dusk 硬切相位 |

房间之间用 500ms 交叉淡入淡出。碰撞与房间权威交接仍由 `thresholdCommit` 决定，不能等待音频淡入完成。

## 3. 八个 Boss 信号

Boss 信号不是同一声音换调：

- Absent Receiver：三次呼叫，确认位置保持空白；
- Unanswering Feed：包列不断加快，然后没有返回声；
- One Sun One Rule：单一基频与对齐谐波尺；
- Two Claims：左右两个主张同时存在、不合并；
- Misreader：读取 chirp 得到错误音程回应；
- Twin Moons：两条近似周期在左右声道漂移；
- No Dusk：二值开关覆盖在连续下降声之上；
- Absolute Reader：扫描上升，中间有一个有意保留的空白区间。

它们应在 phase 变化或 resolution commit 时使用，不要持续循环覆盖房间声床。

## 4. 正式 feedback-cues

`manifests/narrative/feedback-cues-v4.json` 有 37 条单向绑定：

```text
gameplay event
→ visual
→ UI
→ audio
→ haptic
```

所有订阅者同时读取一个事件 ID。音效播放结束不能触发碰撞、阶段切换、Snapshot 或输入归还。

关键差异：

- Focus 与 Gaze Clamp 使用不同声音包络；
- 擦弹一次只播放一次 evidence 音，不建立 combo 音高阶梯；
- Override Tear 是带限的局部撕裂，不用全带宽冲击音；
- Boss resolution 使用 protocol withdrawal，不播放胜利 fanfare；
- Death 的数字删除与 material trace 有两个连续但不同的声部；
- Ghost replay 和 burnout 分开，后者完成后才允许写 residue。

## 5. 混音图

推荐总线：

```text
room ──────┐
boss ──────┤
events ────┼→ master → gaze low-pass → limiter → destination
weather ───┤
ui ────────┘
```

- 预留至少 6dB headroom；
- Eye Clamp 将 low-pass 从 20kHz 推向 400Hz；
- Release 先打开滤波器，Flower Recover 后发生；
- Weather 使用独立总线，避免遮蔽危险预警；
- UI 不穿过强 Gaze low-pass 时，应只保留关键可访问性提示，不应让普通菜单音绕过世界状态。

## 6. 无障碍

- 关闭 Binaural 时，将两个 claim 下混成 mono，并保留不超过 8% 的幅度拍频；
- 所有关键音频都有视觉或 UI 对应；
- Weather 与房间状态可以通过 Audio Descriptions 显示短文本；
- Haptics Off 直接省略震动，不补偿等待；
- Reduced Motion、Flash-Off 不改变声音事件时刻；
- No Dusk 的 Flash-Off 模式用 400ms 非闪烁阈值爬升，但连续下降声完全保留。

## 7. 验证标准

统一验证会检查：

- 4 个房间声床、8 个 Boss 信号、至少 30 个 SFX；
- 所有 feedback cue 的音频引用存在；
- WAV 为 48kHz / 16-bit / Stereo；
- 文件非空、不过载、SHA-256 匹配；
- 声床首尾没有明显采样跳变；
- 生成不依赖第三方库或外部素材。
