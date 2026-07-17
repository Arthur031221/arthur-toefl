import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = env.SERVER_PORT || '3001';
  const target = `http://localhost:${serverPort}`;
  const isStatic = mode === 'static';
  return {
    plugins: [react()],
    base: isStatic ? './' : '/',
    build: isStatic ? { outDir: 'dist-static' } : undefined,
    server: {
      port: Number(env.WEB_PORT || 5173),
      watch: {
        // .venv(faster-whisper)與 data(DB/錄音)不屬於前端,避免撞 inotify 上限
        // 注意:glob 的 ** 不匹配點開頭目錄,要用 RegExp
        ignored: [/[\\/]\.venv[\\/]/, /[\\/]data[\\/]/, /[\\/]server[\\/]/, /[\\/]seeds[\\/]/],
      },
      proxy: {
        '/api': target,
        '/recordings': target,
        '/uploads': target,
      },
    },
  };
});
