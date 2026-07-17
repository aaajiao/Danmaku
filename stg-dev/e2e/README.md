# Playwright E2E 与 Smoke

这一层验证浏览器中的行为契约，不复制 `GameSimulation` 的单元测试。默认 `/` 是玩家面对的
RUN DIRECTOR；`/?mode=pattern-lab` 是可显式进入的开发控制面。测试只读取 UI 与网络输出，不向
gameplay 注入时间或改写状态。

## 覆盖范围

- 默认启动页、RUN 标记与锁定的 pattern 控制；
- 点击进入后 gameplay clock 推进；
- V4 manifest 的 48 个可执行 pattern 与首尾循环切换；
- 暂停期间 gameplay clock 不吸收 wall-clock 时间；
- EASY / NORMAL / HARD 切换与 pattern clock 重置；
- PWA manifest，以及 `any` / `maskable` 图标可访问性；
- 独立 `smoke` 项目用于最短的默认 RUN 启动门禁。

## 安装与运行

Playwright 是 E2E 开发依赖。Bun 安装依赖和 Chromium 后运行：

```sh
bun install
bunx --bun playwright install chromium
bun run test:smoke
bun run test:e2e
```

只运行快速门禁：

```sh
bun run test:smoke
```

只运行完整 Chromium 契约：

```sh
bun run test:e2e
```

配置默认先执行 production build，再在 `127.0.0.1:4173` 启动 Vite preview；它不会复用同端口
的开发服务器，确保 PWA 断言针对最终 `dist`。并行环境可用 `STG_E2E_PORT` 更换端口；验证已经
运行的 preview 或部署环境时，用 `STG_E2E_BASE_URL=https://…` 跳过本地 build 与 server 启动。

默认只使用一个 worker。多个 headless Three.js / SwiftShader 上下文同时编译 shader 时会把 GPU
资源压力误报成应用渲染失败；有独立 GPU 预算的环境仍可显式传入 `--workers=N`。

失败时保留 trace、截图与视频；HTML 报告输出到 `playwright-report/`，运行产物输出到
`test-results/playwright/`。这些目录应保持在 Git 之外。
