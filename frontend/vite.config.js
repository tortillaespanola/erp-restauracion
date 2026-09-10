import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
  },
  // CONTRATO_HARDENING_A1_A4.md, sección 6: primera introducción de Vitest en el proyecto
  // (confirmado con el usuario antes de instalar) -- jsdom porque los tests de A4 montan
  // componentes reales con @testing-library/react, no solo funciones puras.
  test: {
    environment: 'jsdom',
  },
})