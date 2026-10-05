import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    server: {
      // 默认监听 localhost，避免把开发服务器暴露到局域网。
      // 需要从其他机器访问时用 `npm run dev -- --host` 显式开启。
      host: 'localhost',
      port: 3000,
      strictPort: true,
    },
    build: {
      // KaTeX 字体文件本身就有几百 KB，整体超过默认 500kB 阈值属正常。
      chunkSizeWarningLimit: 900,
    },
  };
});
