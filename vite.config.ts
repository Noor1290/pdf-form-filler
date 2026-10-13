import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/pdf-form-filler/',
  plugins: [react(), tailwindcss()],
  // Each app of the payroll system has its own fixed local port, and refuses
  // to start on any other (strictPort). A browser keeps saved data per
  // address INCLUDING the port, so an app that quietly moved to another port
  // would open with none of its templates. The four ports:
  //   5173  PDF form filler (this app)   5174  Payroll
  //   5175  Payslip                      5176  Payroll Hub dashboard
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
