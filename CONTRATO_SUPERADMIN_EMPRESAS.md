# CONTRATO: Super Admin para creación de empresas (multi-tenant)

## Contexto

FlowBase es un ERP multiempresa (React/Vite + Supabase). Hoy existen 2 empresas
y 2 usuarios, creados manualmente "desde código" (scripts / inserts directos en
Supabase) cada vez que hace falta una empresa nueva, incluyendo la empresa de
demo poblada con datos de ejemplo.

Objetivo de este contrato: eliminar esa dependencia de código. Un usuario con
rol **super_admin** debe poder crear una empresa nueva (y su primer usuario
admin) desde dentro del propio ERP, sin tocar Supabase ni scripts.

**No asumas nombres de tablas/columnas.** El primer paso de este contrato es
auditar el esquema real antes de proponer o tocar nada.

## Fase 0 — Auditoría previa (obligatoria, no te saltes esto)

Antes de escribir una sola línea de código, inspecciona y reporta:

1. Esquema actual de Supabase: tabla de empresas (nombre real, columnas),
   tabla de usuarios/perfiles (nombre real, cómo se relaciona con `auth.users`
   y con la empresa — FK `company_id` u otro nombre).
2. Cómo se define hoy el rol de un usuario (columna `role`, tabla aparte,
   enum, etc.) y qué valores existen actualmente (p.ej. `admin`, `employee`).
3. Todas las políticas RLS existentes sobre la tabla de empresas y sobre la
   tabla de usuarios/perfiles — cópialas literalmente en tu reporte.
4. El/los scripts o proceso actual que usaste para crear las 2 empresas y 2
   usuarios existentes (busca en el repo, en `supabase/migrations`, o
   pregunta si no los encuentras) — esa lógica es la que hay que migrar.
5. Si hay ya algún Edge Function desplegado y cómo está configurado el acceso
   a la `service_role key` en este proyecto.

Entrega este reporte de auditoría ANTES de pasar a la Fase 1. Si algo es
ambiguo (p.ej. si "empresa" y "tenant" son el mismo concepto, o si ya existe
algún campo reutilizable para esto), pregúntame en vez de asumir.

## Fase 1 — Modelo de datos y permisos

- Añade el concepto de `super_admin`: un usuario que NO pertenece a ninguna
  empresa en particular y tiene visibilidad/permiso transversal. Decide junto
  conmigo si es un booleano `is_super_admin` en la tabla de perfiles, o un
  valor de rol adicional con `company_id` nullable — justifica la elección
  según lo que encontraste en la Fase 0.
- Escribe la migración SQL correspondiente (columna nueva + constraint si
  aplica). No modifiques el rol de los usuarios existentes salvo que yo lo
  pida explícitamente.
- Actualiza/añade políticas RLS:
  - La tabla de empresas debe permitir INSERT y SELECT de todas las filas
    cuando el usuario autenticado sea `super_admin`.
  - Los usuarios normales deben seguir viendo solo su propia empresa, sin
    cambios de comportamiento para ellos.
  - Escribe las políticas como migraciones versionadas, no como cambios
    manuales en el dashboard.

## Fase 2 — Edge Function segura para crear empresas

Crea una Supabase Edge Function (p.ej. `create-company`) que:

1. Reciba el JWT del caller y verifique server-side que `is_super_admin`
   (o el equivalente que definimos en la Fase 1) es `true`. Si no lo es,
   devuelve 403 y no ejecuta nada más.
2. Solo entonces, usando la `service_role key` (nunca expuesta al cliente),
   ejecute en este orden:
   a. Crear la fila de la nueva empresa.
   b. Crear el usuario admin inicial vía `supabase.auth.admin.createUser`
      (o `inviteUserByEmail` si se prefiere que el propio usuario ponga su
      contraseña — pregúntame cuál prefiero antes de decidir).
   c. Crear su perfil, con `company_id` apuntando a la empresa recién creada
      y rol `admin` dentro de esa empresa.
3. Si cualquier paso falla, deshaga (rollback) lo que ya se haya creado en
   pasos anteriores, para no dejar empresas huérfanas o usuarios sin perfil.
4. Acepte un parámetro opcional `seed_demo_data: boolean` que, si es `true`,
   dispare la misma lógica de poblado que hoy usas manualmente para la
   empresa de demo (la que identificaste en la Fase 0).

Escribe tests para esta función (mínimo: rechazo si no es super_admin, éxito
con rollback simulando un fallo a mitad de proceso).

## Fase 3 — Migración del seed script actual

Toma el script/proceso identificado en la Fase 0 para poblar datos demo y
conviértelo en la lógica reusable que invoca el punto 2.4 de la Fase 2.
Elimina la dependencia de ejecutarlo manualmente desde fuera del ERP.

## Fase 4 — UI de administración global

- Nueva ruta (p.ej. `/admin/empresas`), visible únicamente si
  `is_super_admin` es verdadero (oculta del menú y protegida a nivel de
  ruta, no solo visualmente).
- Formulario: nombre de la empresa, email del admin inicial, toggle
  "poblar con datos demo".
- Al enviar, llama exclusivamente a la Edge Function de la Fase 2 — ningún
  insert directo a Supabase desde el cliente para esta operación.
- Muestra estado de carga y manejo de error legible si la función falla o
  hace rollback.

## Criterios de aceptación

- Un usuario sin `is_super_admin` no puede crear empresas ni por UI ni
  llamando directamente a la función (verificado con test).
- Crear una empresa nueva no requiere tocar Supabase Studio ni ejecutar
  scripts locales.
- Las 2 empresas existentes siguen funcionando exactamente igual tras la
  migración (RLS, roles, acceso de sus usuarios actuales sin cambios).
- La opción de datos demo produce el mismo resultado que el script manual
  actual.

## Fuera de alcance (no lo hagas salvo que lo pida explícitamente)

- Edición o borrado de empresas existentes desde esta pantalla.
- Gestión de múltiples super_admins o de permisos granulares entre ellos.
- Facturación o límites por plan asociados a la empresa nueva.

## Notas de seguridad

- La `service_role key` no debe aparecer nunca en código de cliente ni en
  variables de entorno expuestas al frontend — solo dentro de la Edge
  Function, server-side.
- La verificación de `is_super_admin` debe hacerse siempre server-side
  dentro de la función, nunca confiar en un flag que llegue desde el
  cliente en el body de la request.
