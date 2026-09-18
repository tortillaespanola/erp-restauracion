// CONTRATO_DEMO.md, decisión de diseño #1: credenciales fijas embebidas en el código a
// propósito -- el usuario final nunca las ve ni las teclea, y la barrera de acceso real no es
// el secreto de estas credenciales sino el guard server-side de iniciar_demo()/revertir_demo()
// (solo pueden operar sobre el tenant marcado negocios.es_demo, nunca sobre uno arbitrario) y
// el revert automático a los 15 minutos.
export const DEMO_EMAIL = 'demo@alpenwerk.demo'
export const DEMO_PASSWORD = 'madera'
