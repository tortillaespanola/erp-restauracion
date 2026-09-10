Ajuste visual del toast de feedback (introducido en `CONTRATO_HARDENING_A5_A11.md`, `react-hot-toast`).

Tres problemas:

1. **Tipografía inconsistente.** Antes de cambiar nada: inspecciona qué fuente usa el resto de la UI (no los PDFs, esos ya sabemos que llevan Montserrat/Space Mono aparte) — revisa el CSS global/Tailwind config para confirmar la fuente base del proyecto. El toast debe heredar esa misma fuente, no la que trae `react-hot-toast` por defecto.

2. **Icono.** El icono por defecto de `react-hot-toast` no encaja. Sustitúyelo por iconos de `@tabler/icons-react` (la librería ya establecida en el proyecto — no introduzcas una nueva): uno para éxito, uno para error. Que el tamaño/grosor sea coherente con el resto de iconos que ya se ven en la app.

3. **Posición.** Ahora sale en la esquina superior derecha; muévelo a centrado horizontalmente. Salvo que tengas una razón de UX para lo contrario, usa `top-center` (visible al instante sin taparle al usuario lo que está mirando en el centro de la pantalla, que es el patrón habitual en SaaS modernos) en vez de centrado verticalmente en medio de la pantalla.

Aplica el cambio de forma centralizada (configuración del `<Toaster />`, no toast por toast) para que quede consistente en todos los sitios donde ya se usa. Verifica en browser con un éxito y un error reales.
