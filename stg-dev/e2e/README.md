# Playwright E2E 与 Smoke Runbook

这一层验证 production-preview 的用户路径，不复制 Vitest authority tests，也不向 gameplay
注入时间或改写状态。默认 `/` 是玩家 Run；`/?mode=pattern-lab` 是显式 QA 控制面。

测试选择与发布门禁见[测试与验收](../docs/TESTING_ZH.md)。

## 安装

从 `stg-dev/` 运行：

```sh
bun install --frozen-lockfile
bun --bun playwright install chromium
```

## 运行

最短启动门禁：

```sh
bun run test:smoke
```

完整 Chromium 契约：

```sh
bun run test:e2e
```

只跑受影响 spec：

```sh
bun --bun playwright test <spec-file> --project=chromium
```

配置默认先 production build，再在 `127.0.0.1:4173` 启动不可复用的 Vite preview。
并行环境用 `STG_E2E_PORT`；验证已有 preview/部署地址时用
`STG_E2E_BASE_URL=https://…` 跳过本地 build/server。

## 输出位置

失败 trace、截图与视频写入 `test-results/playwright/`，HTML 报告写入
`playwright-report/`。证据边界、worker 选择、artifact 保留和 CI 策略统一见
[测试与验收](../docs/TESTING_ZH.md)。
