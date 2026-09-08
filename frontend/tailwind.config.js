/**
 * FlowBase — restyling "Quiet" (dirección 1a, Claude Design).
 * Tailwind v4: el proyecto usa `@import "tailwindcss";` a secas en src/index.css.
 * Este archivo se activa desde ahí vía `@config "../tailwind.config.js";` para poder
 * usar la sintaxis clásica de fontSize (array [tamaño, {lineHeight, letterSpacing}]),
 * que la sintaxis @theme de v4 no soporta igual de cómodo.
 *
 * Todos los colores en oklch. Sustituyen los hex hardcodeados inline:
 *   #0854A0 -> primary-600 · #0A3D62 -> primary-700 (texto) / primary-500 (hover botón)
 *   #4FA3E3 -> primary-300 · #1C2938 -> ink · #F5F6F8 -> canvas
 *   #3B6D11 -> success-600 · #D8402F -> danger-600
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'oklch(0.988 0.002 265)',        // fondo de página
        surface: '#ffffff',                       // cards, drawer, topbar
        'surface-sunken': 'oklch(0.978 0.003 265)', // sidebar, cabecera de tabla, zebra
        'surface-hover': 'oklch(0.972 0.003 265)',
        border: {
          DEFAULT: 'oklch(0.925 0.004 265)',      // bordes de card / input
          subtle: 'oklch(0.965 0.003 265)',       // separadores internos, filas
          strong: 'oklch(0.86 0.006 265)',        // input hover
        },
        ink: {
          DEFAULT: 'oklch(0.24 0.02 265)',        // títulos y texto principal
          body: 'oklch(0.30 0.02 265)',           // cuerpo de tabla
          muted: 'oklch(0.56 0.015 265)',         // descripciones, labels
          subtle: 'oklch(0.66 0.012 265)',        // metadatos, placeholder
          faint: 'oklch(0.74 0.010 265)',         // chevrons, iconos inactivos
          invert: '#ffffff',
        },
        primary: {
          50:  'oklch(0.975 0.012 264)',
          100: 'oklch(0.955 0.025 264)',          // fondo de nav activo / badge azul
          300: 'oklch(0.78 0.09 264)',
          500: 'oklch(0.56 0.17 264)',            // hover de botón primario
          600: 'oklch(0.52 0.18 264)',            // ACENTO principal (botones, links, focus)
          700: 'oklch(0.45 0.16 264)',            // active / texto sobre primary-100
        },
        success: { 50: 'oklch(0.965 0.025 155)', 600: 'oklch(0.44 0.11 155)', 700: 'oklch(0.38 0.10 155)' },
        warning: { 50: 'oklch(0.970 0.040 78)',  600: 'oklch(0.48 0.12 68)',  700: 'oklch(0.42 0.11 62)' },
        danger:  { 50: 'oklch(0.965 0.030 25)',  600: 'oklch(0.52 0.17 25)',  700: 'oklch(0.45 0.16 25)' },
        neutral: { 50: 'oklch(0.960 0.003 265)', 600: 'oklch(0.45 0.015 265)' }, // badge "sin estado"
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // [size, { lineHeight, letterSpacing, fontWeight }]
        'display': ['21px', { lineHeight: '26px', letterSpacing: '-0.02em', fontWeight: '600' }], // título de página
        'title':   ['13.5px', { lineHeight: '18px', letterSpacing: '-0.01em', fontWeight: '600' }], // topbar, CardHeader, Drawer
        'body':    ['13px', { lineHeight: '18px' }],   // celdas de tabla, inputs
        'meta':    ['12.5px', { lineHeight: '17px' }], // descripciones, botones
        'num':     ['12px', { lineHeight: '16px' }],   // cifras (usar con font-mono + tabular-nums)
        'micro':   ['11.5px', { lineHeight: '15px' }], // footers, refs
        'label':   ['11px', { lineHeight: '14px', fontWeight: '500' }],  // labels de Field
        'overline':['10px', { lineHeight: '13px', letterSpacing: '0.09em', fontWeight: '600' }], // Thead, SectionLabel
      },
      spacing: {
        // escala 4px; alias semánticos para densidad de la app
        'row': '38px',      // alto de fila de tabla (densa) — 52px si lleva 2 líneas
        'thead': '36px',
        'control': '34px',  // alto de input / select / botón md
        'control-sm': '30px',
        'topbar': '56px',
        'sidebar': '236px',
      },
      borderRadius: {
        control: '7px',   // inputs, selects, botones, chips
        card: '10px',     // cards, tablas, drawer interno
        modal: '12px',    // card de login
        pill: '5px',      // badges (antes rounded-full)
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04)',
        raised: '0 1px 2px rgba(16,24,40,.06), 0 8px 24px -12px rgba(16,24,40,.18)',
        overlay: '0 1px 2px rgba(16,24,40,.05), 0 16px 32px -20px rgba(16,24,40,.28)',
        drawer: '-24px 0 48px -24px rgba(16,24,40,.35)',
        btn: '0 1px 2px rgba(30,30,120,.25)',
        focus: '0 0 0 3px oklch(0.52 0.18 264 / .14)',
      },
      transitionDuration: { DEFAULT: '120ms' },
    },
  },
  plugins: [],
}
