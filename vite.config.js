import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // 💡 이 줄을 추가하면 상대 경로로 빌드됩니다.
  build: {
    chunkSizeWarningLimit: 1000,
  },
})