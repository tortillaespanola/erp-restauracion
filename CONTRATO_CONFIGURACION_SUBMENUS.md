# CONTRATO_CONFIGURACION_SUBMENUS.md

## 1. Contexto

Hoy `Configuracion.jsx` es un único componente que renderiza, en cascada dentro de la misma página:

1. Formulario General (`empresa_config`: logo, nombre, razón fiscal, CIF, dirección, teléfono, email).
2. `CategoriasArticulo` (tabla `categorias_articulo`).
3. `UnidadesMedida` (tabla `unidades_medida`).

No hay sub-rutas de Configuración en el router; todo cuelga de una única entrada de sidebar.

## 2. Objetivo

Reorganizar la pantalla de Configuración en tres submenús independientes:

- **General** — lo que ya existe hoy (formulario de `empresa_config`), sin cambios funcionales.
- **Configuración ERP** — Categorías, Unidades de medida (ambas ya existentes, solo se mueven) + nuevo selector de idioma por defecto de documentos.
- **Datos bancarios** — nuevo formulario con los campos: Beneficiario, Dirección del beneficiario, IBAN, BIC, Referencia de Pago, Banco, Condiciones generales de pago, Observaciones, Enlace de Pago Online.

## 3. Decisión de navegación

Tabs internas dentro de la misma ruta `/configuracion`, con estado local (`activeTab`), **sin crear sub-rutas nuevas en el router**. Motivo: es una pantalla de administración de baja frecuencia de uso, no necesita ser enlazable por URL, y evita tocar el router para algo que no lo requiere. Si en el futuro se quiere deep-linking a una pestaña concreta, se puede añadir un query param (`?tab=bancario`) sin cambiar esta decisión de fondo.

## 4. Reestructuración de archivos

```
src/pages/Configuracion.jsx          → contenedor: tabs + render de la pestaña activa
src/pages/configuracion/
  ConfiguracionGeneral.jsx           → formulario actual de empresa_config, extraído tal cual
  ConfiguracionErp.jsx               → CategoriasArticulo + UnidadesMedida (extraídos tal cual) + nuevo selector de idioma
  ConfiguracionBancaria.jsx          → nuevo formulario de datos bancarios
```

`CategoriasArticulo` y `UnidadesMedida` se mueven de componentes internos de `Configuracion.jsx` a exports propios dentro de `ConfiguracionErp.jsx` (o a sus propios archivos si el revisor de código prefiere un archivo por componente — decisión libre de implementación, no cambia el contrato). Su lógica interna (duplicados, GRANT delete ausente en `unidades_medida`, etc.) no se toca.

## 5. Submenú "General"

Sin cambios funcionales. Es un corta-pega de la lógica actual (`cargar`, `handleChange`, `handleSubmit`, `handleLogoChange`) a `ConfiguracionGeneral.jsx`.

## 6. Submenú "Configuración ERP"

- Se mueven `CategoriasArticulo` y `UnidadesMedida` sin cambios de lógica.
- Se añade un selector de **idioma por defecto de documentos** (por ahora afecta solo a facturas y albaranes).
- **Verificación previa obligatoria para Claude Code**: comprobar si `empresa_config` ya tiene una columna de idioma de negocio derivada de `CONTRATO_I18N.md`. Si existe, este selector reutiliza esa misma columna (no se duplica el dato). Si no existe todavía, este contrato añade la columna `empresa_config.idioma_documentos` (texto, valores `es` / `en` / `de`, default `es`) vía migración `BEGIN...ROLLBACK` primero.
- Este contrato **no** implementa el uso real de ese idioma en la generación de PDFs — solo lo guarda. La aplicación efectiva queda para el contrato de configuración de facturas que viene después.

## 7. Submenú "Datos bancarios" (nuevo)

### 7.1 Modelo de datos

Nueva tabla dedicada, una fila por negocio:

```sql
create table datos_bancarios (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) unique,
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
```

- `negocio_id` con `UNIQUE` → garantiza una fila por negocio, mismo patrón que `empresa_config`.
- Todos los campos nullable: una empresa puede no tener aún datos bancarios cargados.
- RLS con el mismo patrón `negocio_actual()` ya activado en el resto de tablas multi-tenant.
- Se aplica primero en `BEGIN...ROLLBACK`, commit local, y push solo tras verificación en navegador — mismo flujo que el resto del proyecto.

### 7.2 UI

Formulario simple tipo `ConfiguracionGeneral` (Field + Input), sin tabla ni listado (es una única fila por negocio, no una colección). Guarda con upsert sobre `negocio_id`.

### 7.3 Fuera de alcance en este contrato

- Mostrar estos datos en el pie de página de facturas/albaranes en PDF — queda para el contrato de configuración de facturas.
- Validación de formato de IBAN/BIC (checksum, longitud por país) — se guardan como texto libre por ahora.
- Enlace de Pago Online no se valida como URL ni se renderiza como link clicable en esta fase.

## 8. i18n

Nuevas claves bajo el namespace `configuracion`:

- `configuracion:tabs.general`, `configuracion:tabs.erp`, `configuracion:tabs.bancario`
- `configuracion:erp.idioma_documentos` (label del selector)
- `configuracion:bancario.titulo`, `configuracion:bancario.campos.*` (uno por campo), `configuracion:bancario.alertas.*` (guardado / error, mismo patrón que el resto de formularios)

## 9. Fuera de alcance general del contrato

- Router / sub-rutas de Configuración.
- Uso real del idioma de documentos en generación de PDF.
- Renderizado de datos bancarios en PDF.
- Cambios de lógica en Categorías o Unidades de medida más allá de su reubicación de archivo.

## 10. Metodología

Igual que el resto del proyecto: migración SQL probada en `BEGIN...ROLLBACK`, commit local, verificación visual en navegador de las tres pestañas y del guardado de cada formulario, push solo después de esa verificación.
