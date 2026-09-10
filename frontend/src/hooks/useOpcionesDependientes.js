import { useEffect, useRef, useState } from 'react'

// CONTRATO_HARDENING_A1_A4.md (A4): patrón único para "select depende de select" (ej. Proveedor ->
// Artículo en PedidoCompraForm/AlbaranCompraForm) -- auditoría previa confirmó que cada formulario
// reimplementaba esto a mano con huecos distintos: ninguno cancelaba una petición obsoleta (dos
// cambios rápidos del padre podían dejar ganar la respuesta más vieja sobre la más nueva), y la
// mayoría no exponía ningún estado de carga (flash de "sin resultados" mientras llega el catálogo
// nuevo, justo el síntoma descrito en el contrato).
//
// Sigue el idioma de cancelación ya usado en Producciones.jsx (`let cancelado = false` + cleanup en
// el return del efecto) en vez de AbortController, para no introducir un segundo estilo de
// cancelación en el proyecto -- las llamadas van todas contra supabase-js, no fetch crudo.
//
// Deliberadamente NO decide nada sobre resetear la selección ya hecha en el hijo (ej. limpiar las
// líneas de un pedido al cambiar de proveedor): esa regla varía por formulario (con confirm(), sin
// él, o nunca en la primera carga de un modo edición con datos precargados). `onClaveCambia`, si se
// pasa, se invoca cuando `clave` cambia respecto al valor
// anterior (nunca en el montaje inicial, mismo criterio que el `proveedorAnteriorRef` de
// FacturaCompraForm.jsx para sobrevivir el doble-efecto de StrictMode sin romper un precargado de
// edición) -- pero es solo un aviso, no bloquea ni condiciona la carga en sí; el propio formulario
// decide qué hacer con ese aviso (confirmar, resetear, o ignorarlo).
export function useOpcionesDependientes(clave, cargar, { valorInicial = [], onClaveCambia } = {}) {
  const [opciones, setOpciones] = useState(valorInicial)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const claveAnteriorRef = useRef(clave)
  const cargarRef = useRef(cargar)

  // Ref "siempre la última versión" actualizada en un efecto sin dependencias (no durante el
  // render, que dispara la regla react-hooks/refs) -- se lee dentro del efecto de más abajo para no
  // tener que declarar `cargar` como dependencia (ver comentario de esa regla ahí).
  useEffect(() => {
    cargarRef.current = cargar
  })

  useEffect(() => {
    if (claveAnteriorRef.current !== clave) {
      onClaveCambia?.(clave, claveAnteriorRef.current)
      claveAnteriorRef.current = clave
    }

    let cancelado = false

    if (clave == null || clave === '') {
      setOpciones(valorInicial)
      setCargando(false)
      setError(null)
      return
    }

    setOpciones(valorInicial)
    setError(null)
    setCargando(true)

    async function ejecutar() {
      try {
        const resultado = await cargarRef.current(clave)
        if (cancelado) return
        setOpciones(resultado ?? valorInicial)
      } catch (err) {
        if (cancelado) return
        console.error(err)
        setError(err)
        setOpciones(valorInicial)
      } finally {
        if (!cancelado) setCargando(false)
      }
    }
    ejecutar()

    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cargar` se lee via cargarRef a propósito: si fuera dependencia, un callback recreado en cada render (el caso normal, closures inline) dispararía una recarga en cada tecleo de un campo hermano ajeno a `clave`.
  }, [clave])

  return { opciones, cargando, error }
}
