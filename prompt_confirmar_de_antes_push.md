Antes de hacer push de los 8 commits de `CONTRATO_HARDENING_A5_A11.md`, una confirmación pendiente:

Dijiste que verificaste los mensajes de validación nativa (A6) en ES y EN. Confirma también en DE:

1. Revisa que las claves de `validacionNativa.js` (y cualquier i18n que uses para los mensajes) existan y estén traducidas en el archivo DE, no solo ES/EN.
2. Verifica en browser, con el idioma de la interfaz en alemán, que un campo `required` vacío y un numérico inválido muestran el mensaje en alemán (no el nativo del navegador en inglés, no un fallback a ES/EN).

Si falta algo en DE: corrígelo, añade el caso a `validacionNativa.test.js`, y súmalo como commit 9 antes de pushear.

Si DE ya estaba cubierto y solo faltó mencionarlo en el informe: confírmamelo explícitamente y haz push de los 8 commits tal cual.
