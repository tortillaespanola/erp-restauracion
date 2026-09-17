# NOTAS.md

Notas de trabajo del proyecto **FlowBase**. Última actualización: 2026-07-31.

---

## 1. Estado del proyecto

Stack: React + Vite + TailwindCSS (`frontend/`) hablando directamente con **Supabase**
(auth + base de datos + lógica vía vistas/triggers SQL, gestionados fuera de este repo).

### Módulos implementados (`frontend/src/pages/`)

- **Compras**: Proveedores, Artículos (multi-proveedor con precio propio y preferente),
  Albaranes de compra, Facturas de compra
- **Producción**: Semielaborados, Productos finales (receta de artículos + semielaborados),
  Producciones / Producción de productos finales
- **Ventas**: Clientes, Albaranes de venta, Facturas de venta
- **Stock**: Ajustes de stock por lote (mermas, caducidad, errores de pesaje) — sin ajustes
  generales, para mantener FIFO estricto
- **Otros**: Configuración, AuthGate (login con Supabase Auth)

### Funcionalidades recientes (último commit `d299a35`)

- Control de temperatura de recepción con rangos aceptables
- Edición de albaranes de compra con bloqueo de líneas ya consumidas
- Edición de precio/referencia por proveedor
- Corrección: la vista de stock de semielaborados no restaba el consumo de productos finales
- Precisión de cantidades ampliada a 3 decimales en todo el sistema
- Sistema de códigos de lote automáticos (RM/AUX/TRD/WIP/FG) y numeración interna de
  documentos (GR/PI/DN/SI)
- Generación de PDFs (albaranes y facturas) con membrete configurable
- Avisos antes de borrar registros con dependencias

### Pendiente / sin cubrir

- No hay tests ni CI configurados
- No hay documentación de arquitectura ni del esquema SQL (vive en Supabase)
- Sin `.env.example` en el repo (solo `.env` local, ignorado por git)

---

## 2. Checklist de problemas de conexión (Supabase / entorno de desarrollo)

Basada en cómo está montada la conexión en `frontend/src/lib/supabase.js` y
`frontend/src/components/AuthGate.jsx`. Revisar en este orden:

1. **Variables de entorno**
   - Comprobar que existe `frontend/.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_KEY`
     definidos (el `.env` está en `.gitignore`, no se versiona — si es un entorno nuevo,
     hay que crearlo a mano).
   - Reiniciar `npm run dev` tras tocar el `.env`: Vite no recarga variables de entorno en caliente.

2. **Sesión / autenticación (AuthGate)**
   - Si la app se queda en "Cargando..." indefinidamente: revisar la consola del navegador,
     suele ser `VITE_SUPABASE_URL`/`KEY` mal puestos o vacíos.
   - Si el login da "Email o contraseña incorrectos" siendo correctos: comprobar que el
     usuario existe en Supabase Auth (no en una tabla propia) y que el proyecto de Supabase
     es el correcto (fácil confundir entre proyecto de desarrollo y producción).

3. **Peticiones a la base de datos fallan tras login correcto**
   - Revisar políticas RLS (Row Level Security) de la tabla implicada en Supabase — un login
     válido no implica permisos de lectura/escritura si la política no cubre al usuario/rol.
   - Revisar la pestaña Network del navegador: un 401/403 apunta a RLS o API key incorrecta;
     un error de CORS apunta a la URL del proyecto Supabase mal configurada.

4. **Entorno de Codespaces**
   - Este proyecto se ha trabajado desde GitHub Codespaces (ver commit `38a7576`,
     "Guardar cambios pendientes antes de recrear Codespace"). Al recrear un Codespace se
     pierde todo lo no commiteado y el `.env` local (no versionado) — hay que:
     - Commitear/pushear cambios en curso antes de recrear.
     - Volver a crear `frontend/.env` a mano tras la recreación.

5. **Después de `npm install` o cambios de dependencias**
   - Si `@supabase/supabase-js` deja de conectar tras un update de dependencias, revisar el
     changelog del paquete: cambios de versión mayor pueden alterar la firma de `createClient`
     o el manejo de sesión.

---

## 3. Comandos git habituales

```bash
# Estado y contexto
git status
git log --oneline -20
git diff

# Trabajo diario
git add <archivos>          # evitar "git add -A" salvo revisión previa de git status
git commit -m "mensaje"
git push

# Sincronizar con remoto
git pull
git fetch origin

# Ramas (si se usan en el flujo de trabajo)
git checkout -b nombre-rama
git checkout main
git merge nombre-rama

# Deshacer cambios locales no commiteados (con cuidado)
git restore <archivo>
git stash        # guardar cambios en curso sin commitear
git stash pop    # recuperarlos
```

> Nota: el historial de este proyecto muestra commits grandes y descriptivos en español,
> agrupando varias funcionalidades relacionadas por commit (no un commit por archivo).
