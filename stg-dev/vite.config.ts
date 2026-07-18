import {defineConfig} from "vite";
import {VitePWA} from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icons/favicon.ico",
        "icons/favicon-16.png",
        "icons/favicon-32.png",
        "icons/apple-touch-icon.png",
      ],
      manifest: {
        id: "/",
        name: "1bit STG Lab",
        short_name: "1bit STG",
        description: "基于 1bit V4 权威 manifest 的 Three.js 纵向弹幕开发环境。",
        theme_color: "#08090d",
        background_color: "#08090d",
        display: "standalone",
        start_url: ".",
        scope: ".",
        lang: "zh-CN",
        categories: ["games", "entertainment", "developer"],
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
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,png,ico,woff2,ttf,wav,json}"],
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
    // Three.js and the complete 48-pattern manifest intentionally ship as one
    // deterministic offline runtime; the compressed entry remains under 200 KB.
    chunkSizeWarningLimit: 1000,
  },
});
