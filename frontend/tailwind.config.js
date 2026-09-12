/**
 * FlowBase — paleta verde (Supabase-style) sobre el sistema "Quiet".
 * Drop-in: sustituye tu tailwind.config.js actual. NO cambian nombres de tokens,
 * escala tipográfica, espaciados, radios ni la estructura de sombras — solo los valores
 * de color. Ningún componente necesita tocarse: siguen consumiendo bg-primary-600,
 * text-ink-muted, border-border, etc.
 *
 * Recoloreado azul -> verde, manteniendo la MISMA luminosidad por escalón:
 *   primary  h264 -> h166 (verde Supabase)   canvas/surface/border/ink  h265 -> h160
 *   success  h155 -> h145 (se aleja del primary para no confundirse con él)
 *   warning / danger  sin cambios
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'oklch(0.988 0.002 160)',           // fondo de página
        surface: '#ffffff',                          // cards, drawer, topbar
        'surface-sunken': 'oklch(0.978 0.004 160)',  // sidebar, cabecera de tabla, zebra
        'surface-hover': 'oklch(0.972 0.004 160)',
        border: {
          DEFAULT: 'oklch(0.925 0.006 160)',
          subtle: 'oklch(0.965 0.004 160)',
          strong: 'oklch(0.86 0.008 160)',
        },
        ink: {
          DEFAULT: 'oklch(0.24 0.02 160)',
          body: 'oklch(0.30 0.02 160)',
          muted: 'oklch(0.56 0.015 160)',
          subtle: 'oklch(0.66 0.012 160)',
          faint: 'oklch(0.74 0.010 160)',
          invert: '#ffffff',
        },
        primary: {
          50:  'oklch(0.975 0.015 166)',  // fondo de fila expandida
          100: 'oklch(0.950 0.035 166)',  // fondo de nav activo / badge / avatar
          300: 'oklch(0.78 0.14 166)',    // = #3ECF8E, verde de marca: logo, gráficos, dark mode
          500: 'oklch(0.58 0.12 166)',    // hover de botón primario (~#1F9D63)
          600: 'oklch(0.52 0.11 166)',    // ACENTO principal: botones, links, focus (~#0D8A5F oscurecido)
          700: 'oklch(0.45 0.10 166)',    // active / texto sobre primary-100
        },
        success: { 50: 'oklch(0.965 0.030 145)', 600: 'oklch(0.46 0.12 145)', 700: 'oklch(0.40 0.11 145)' },
        warning: { 50: 'oklch(0.970 0.040 78)',  600: 'oklch(0.48 0.12 68)',  700: 'oklch(0.42 0.11 62)' },
        danger:  { 50: 'oklch(0.965 0.030 25)',  600: 'oklch(0.52 0.17 25)',  700: 'oklch(0.45 0.16 25)' },
        neutral: { 50: 'oklch(0.960 0.004 160)', 600: 'oklch(0.45 0.015 160)' },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['"Outfit"', '"Instrument Sans"', 'system-ui', 'sans-serif'], // solo wordmark del logo
      },
      fontSize: {
        'display': ['21px', { lineHeight: '26px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'title':   ['13.5px', { lineHeight: '18px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body':    ['13px', { lineHeight: '18px' }],
        'meta':    ['12.5px', { lineHeight: '17px' }],
        'num':     ['12px', { lineHeight: '16px' }],
        'micro':   ['11.5px', { lineHeight: '15px' }],
        'label':   ['11px', { lineHeight: '14px', fontWeight: '500' }],
        'overline':['10px', { lineHeight: '13px', letterSpacing: '0.09em', fontWeight: '600' }],
      },
      spacing: {
        'row': '38px',
        'thead': '36px',
        'control': '34px',
        'control-sm': '30px',
        'topbar': '56px',
        'sidebar': '236px',
      },
      borderRadius: {
        control: '7px',
        card: '10px',
        modal: '12px',
        pill: '5px',
      },
      boxShadow: {
        // sombras con deriva verde en vez de azul (antes rgba(16,24,40,…) / rgba(30,30,120,…))
        card: '0 1px 2px rgba(16,40,30,.04)',
        raised: '0 1px 2px rgba(16,40,30,.06), 0 8px 24px -12px rgba(16,40,30,.18)',
        overlay: '0 1px 2px rgba(16,40,30,.05), 0 16px 32px -20px rgba(16,40,30,.28)',
        drawer: '-24px 0 48px -24px rgba(16,40,30,.35)',
        btn: '0 1px 2px rgba(13,80,60,.28)',
        focus: '0 0 0 3px oklch(0.52 0.11 166 / .14)',
      },
      transitionDuration: { DEFAULT: '120ms' },
    },
  },
  plugins: [],
}
