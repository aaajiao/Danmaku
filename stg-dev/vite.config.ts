import {defineConfig} from "vite";
import {VitePWA} from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      // A waiting worker may only be promoted before gameplay starts. Runtime
      // code owns that boundary; Workbox must never replace a controller in the
      // middle of a deterministic Run.
      registerType: "prompt",
      includeAssets: [
        "icons/favicon.ico",
        "icons/favicon-16.png",
        "icons/favicon-32.png",
        "icons/apple-touch-icon.png",
      ],
      manifest: {
        id: "/",
        name: "1bit STG Run",
        short_name: "1bit STG",
        description: "从不可变 V4 权威包投影的确定性 1bit 纵向 STG Run。",
        theme_color: "#08090d",
        background_color: "#08090d",
        display: "standalone",
        start_url: ".",
        scope: ".",
        lang: "zh-CN",
        categories: ["games", "entertainment"],
        icons: [
          {
            src: "icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "弹幕试验台",
            short_name: "Pattern Lab",
            description: "直接打开可执行弹幕开发环境",
            url: "./?mode=pattern-lab",
            icons: [{src: "icons/shortcut-96.png", sizes: "96x96"}],
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The V4 UI typeface (NotoSansSC-Variable.ttf) is deliberately NOT
        // precached: it is a 17.8 MB CJK variable font, and forcing it into the
        // offline install would cost every first visit an 18 MB download before
        // the game boots. It loads on demand through @font-face with
        // font-display: swap, so the shell renders in the fallback stack and
        // upgrades when the authored face arrives. Offline boot does not depend
        // on it. Subsetting the face to the copy actually used is P1 hardening.
        globPatterns: ["**/*.{js,css,html,png,ico,woff2,wav,json}"],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    fs: {
      allow: [".."],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/").split("?", 1)[0] ?? id;
          if (moduleId.includes("/node_modules/three/")) return "render-three";
          if (moduleId.endsWith(
            "/1bit-stg-complete-asset-kit-v4/manifests/v4/frame-index-v4.json",
          )) return "v4-frame-index";
          if (moduleId.endsWith(
            "/1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json",
          )) return "v4-executable-patterns";
          return undefined;
        },
      },
    },
  },
});
