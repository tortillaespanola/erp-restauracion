-- CONTRATO_PIE_DOCUMENTO.md, sección 3: marca de negocio configurable para el footer del PDF de
-- albarán (y, más adelante, factura) -- eslogan, comentario del eslogan y página web. Los tres
-- nullable, un negocio puede no tener marca definida todavía.
alter table empresa_config
  add column eslogan text,
  add column comentario_eslogan text,
  add column pagina_web text;
