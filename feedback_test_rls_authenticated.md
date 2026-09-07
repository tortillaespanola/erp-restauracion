# feedback_test_rls_authenticated.md

## La lección

`SET LOCAL ROLE authenticated` por sí solo **no simula un usuario autenticado real**. Solo
cambia el rol de Postgres — lo que decide si el `GRANT` de una tabla aplica o no — pero
`auth.uid()`/`auth.role()` (las funciones que leen casi todas las políticas RLS de este
proyecto) no miran el rol de Postgres en absoluto: leen parámetros de sesión (`GUC`) que
PostgREST rellena a partir del JWT en cada request real, y que un `SET LOCAL ROLE` no toca.

Verificado contra la definición real de ambas funciones en esta base (2026-09-07):

```sql
-- auth.uid()
select coalesce(
  nullif(current_setting('request.jwt.claim.sub', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
)::uuid

-- auth.role()
select coalesce(
  nullif(current_setting('request.jwt.claim.role', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
)::text
```

Sin fijar esos `GUC`, `auth.uid()` devuelve `NULL` y `auth.role()` devuelve `NULL` (no
`'authenticated'`) — una prueba así puede dar una policy por buena sin haber evaluado nunca
su condición real, o al revés, hacer fallar código correcto que sí depende de esos valores.
Hacen falta las **tres líneas juntas**, no solo la primera:

```sql
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '<uuid-del-usuario>';
```

**Por qué importa de verdad**: este es exactamente el motivo por el que el bug de `GRANT`
faltante en `previsiones_distribucion_pf` (2026-08-16, ver
`CONTRATO_VISTA_PRODUCCION_PRODUCTOS_FINALES.md`) no se detectó en su momento — esa migración
se probó contra la conexión de superusuario, que ignora tanto RLS como `GRANT`, así que ningún
nivel de exhaustividad en las pruebas lo habría revelado por esa vía.

## El patrón completo de prueba en `BEGIN...ROLLBACK`

```sql
begin;

-- 1) Todo el DDL/fixtures de la prueba, como superusuario, ANTES de bajar de rol --
--    si se hace después, la propia RLS de las tablas nuevas bloquea la inserción
--    de las fixtures de prueba.
--    ... CREATE TABLE / CREATE POLICY / CREATE FUNCTION / INSERT ...

-- 2) Confirmar el estado de partida mientras aún se es superusuario (sin RLS de por medio).
select * from <tabla>;

-- 3) Simular la request real de PostgREST para un usuario concreto:
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '<uuid del usuario a simular>';

-- 4) Caso feliz: verificar que resuelven como se espera ANTES de probar la lógica real.
select auth.uid(), auth.role();
-- esperado: <uuid> | authenticated
-- ... resto del caso feliz (la función/policy que se está probando) ...

-- 5) Caso sin permiso / huérfano -- usar un UUID que no exista en ninguna tabla real
--    (ej. '00000000-0000-0000-0000-000000000000'), NUNCA reutilizar el UUID real por
--    error (daría un falso positivo). Envolver en SAVEPOINT porque un error deja la
--    transacción abortada hasta el ROLLBACK TO SAVEPOINT -- si no, no se puede seguir
--    probando nada más dentro de la misma transacción.
savepoint antes_del_caso_huerfano;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000';
select <función o policy bajo prueba>;
-- esperado: error explícito, nunca NULL ni un valor arbitrario
rollback to savepoint antes_del_caso_huerfano;

-- 6) Para volver a necesitar privilegios de superusuario a mitad de la prueba
--    (ej. insertar más fixtures), `reset role` y repetir el paso 3 después.
reset role;
-- ... más fixtures si hacen falta ...
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '<uuid del usuario a simular>';
-- ... casos adicionales ...

rollback; -- nada de esto queda persistido
```

### Datos reales de este proyecto para pruebas

A 2026-09-07: único usuario en `auth.users` = `8dec2751-aa16-48b3-8c75-d3fcf2b9ba9a`
(`vcompany1@gmail.com`). Único negocio en `negocios` = `a8acb3aa-e8f2-4a04-83f4-e6b0ca4e2d00`
("Negocio principal"). **Verificar que siguen siendo los únicos** antes de reutilizar estos
valores en una prueba futura — dejarán de serlo en cuanto avance `CONTRATO_MULTITENANT.md`.

## Nota al pie: por qué este archivo tiene fecha de hoy pese a llevar semanas citado

Este archivo se reconstruyó el **2026-09-07**, durante la Tarea 1 de
`CONTRATO_MULTITENANT.md` (resolución dinámica del negocio vía `negocio_actual()`), tras
detectar que estaba citado en tres sitios pero no existía en ninguno:

- El comentario de la migración `supabase/migrations/20260927_ajustes_stock_usuario_historial.sql`
  (línea 84), commiteada el **2026-09-01** (commit `100c651`) — la primera mención confirmada
  con fecha real en el historial de git.
- `CONTRATO_MULTITENANT.md` — nunca comiteado (archivo no rastreado por git en el momento de
  este diagnóstico), así que no aporta una fecha de git propia.
- El índice de memoria de las sesiones de Claude Code sobre este proyecto.

Confirmado explícitamente con `git log --all --full-history` (y su variante
`--diff-filter=A`) sobre la ruta `**/feedback_test_rls_authenticated.md`: **ningún commit, en
ninguna rama, creó jamás este archivo.** No se perdió — la intención se documentó por
referencia antes de escribir el contenido real, y nadie volvió a cerrar ese círculo hasta
ahora.
