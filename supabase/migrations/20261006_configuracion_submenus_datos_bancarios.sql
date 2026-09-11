-- CONTRATO_CONFIGURACION_SUBMENUS.md, sección 7: nueva tabla para el submenú "Datos bancarios"
-- de Configuración -- una fila por negocio (mismo patrón 1:1 que empresa_config), todos los
-- campos nullable porque una empresa puede no tener aún datos bancarios cargados.
--
-- Verificación previa hecha para la sección 6 del contrato (selector de idioma de documentos):
-- empresa_config YA tiene columna `idioma` (text, check es/en/de, default 'es'), añadida en
-- 20260907_i18n_idioma_moneda.sql para CONTRATO_I18N.md -- este contrato reutiliza esa misma
-- columna desde el frontend (ConfiguracionErp.jsx), sin migración adicional para eso.
--
-- negocio_id: mismo patrón ya vigente en las 42 tablas multi-tenant (ver
-- 20260907_default_negocio_id_dinamico.sql y 20260907_reescribir_42_policies_negocio_actual.sql)
-- -- default negocio_actual() (para que un INSERT sin negocio_id explícito caiga en el negocio
-- real de la sesión) + UNIQUE (una fila por negocio, upsert desde el frontend sobre esta columna).
create table datos_bancarios (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default negocio_actual() references negocios(id) unique,
  beneficiario text,
  direccion_beneficiario text,
  iban text,
  bic text,
  referencia_pago text,
  banco text,
  condiciones_pago text,
  observaciones text,
  enlace_pago_online text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table datos_bancarios enable row level security;

create policy "Acceso total temporal" on datos_bancarios
  for all
  using ((select auth.role()) = 'authenticated' and negocio_id = (select negocio_actual()))
  with check ((select auth.role()) = 'authenticated' and negocio_id = (select negocio_actual()));

grant select, insert, update, delete on datos_bancarios to authenticated;
