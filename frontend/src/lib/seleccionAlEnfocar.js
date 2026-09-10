// CONTRATO_HARDENING_A5_A11.md (A7): al enfocar un input numérico con valor prellenado, seleccionar
// todo el contenido para que escribir reemplace en vez de insertarse en la posición del cursor
// (ej. querer poner "20" sobre "3.2320" y acabar con un valor mezclado). Verificado contra
// Chromium real que .select() no lanza en <input type="number"> y sí reemplaza el valor al
// escribir, aunque selectionStart/selectionEnd reporten null para ese tipo de input (spec).
//
// El onMouseUp con preventDefault solo se aplica al primer click que da el foco (vía este
// WeakSet, no un useRef -- así estas funciones planas sirven también dentro de un .map() de
// líneas) -- si no, el propio mouseup del navegador colapsaría la selección al punto de click
// justo después del focus. Clicks posteriores con el campo ya enfocado no se tocan, así que
// corregir un solo dígito sigue funcionando con normalidad.
const elementosReciénEnfocados = new WeakSet()

export function seleccionarAlEnfocar(e) {
  elementosReciénEnfocados.add(e.target)
  e.target.select()
}

export function evitarColapsoDeSeleccion(e) {
  if (elementosReciénEnfocados.has(e.target)) {
    elementosReciénEnfocados.delete(e.target)
    e.preventDefault()
  }
}
