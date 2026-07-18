# V4 程序化音频资源

本目录包含 48 个项目自制 WAV：4 个房间声床、8 个 Boss 信号与 36 个反馈音效。

- 生成：`python -B generate_audio_v4.py`
- 清单：`../manifests/narrative/audio-manifest-v4.json`
- 统一验证：`python -B ../narrative/validate_narrative_v4.py`

音频文件全部为 48kHz、16-bit、Stereo PCM。没有外部采样，生成结果由固定 seed 决定。
