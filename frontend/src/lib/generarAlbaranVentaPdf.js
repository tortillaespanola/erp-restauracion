import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatFecha } from './formatFecha'
import { formatCantidad, formatMoneda } from './formatCantidad'
import {
  registrarFuentes, cargarEmpresa, cargarDatosBancarios, lineaMixtaDerecha,
  dibujarLogoEmpresa, dibujarVonAn, resolverBemerkungen, dibujarFooterMarca,
} from './pdfDocumentoBase'

// BLOQUE 6 (CONTRATO_UX_ALBARANES_VENTA.md): antes vivían solo en AlbaranesVenta.jsx -- movidas
// aquí (sin cambios) porque ahora las necesitan dos sitios: las acciones del listado (Imprimir/
// Descargar) y el autoPrint del formulario de alta, que se mudó a AlbaranVentaForm.jsx.
export function nombreLineaVenta(linea) {
  return linea.productos_finales?.nombre ?? linea.articulos_compra?.nombre ?? linea.descripcion
}

export function unidadLineaVenta(linea) {
  return linea.productos_finales?.unidades_medida?.codigo ?? linea.articulos_compra?.unidad ?? 'ud'
}

// Traduce una fila de albaranes_venta (con sus relaciones embebidas) al shape plano que espera
// generarAlbaranVentaPdf() -- { numero, fecha, tercero, lineas, total, notas }.
export function prepararDocumentoAlbaranVenta(alb) {
  return {
    numero: alb.numero_albaran || `#${alb.id}`,
    fecha: alb.fecha,
    tercero: {
      nombre: alb.clientes?.nombre,
      direccion: alb.clientes?.direccion,
      cif: alb.clientes?.cif,
    },
    lineas: alb.lineas_albaran_venta.map((l) => ({
      concepto: nombreLineaVenta(l),
      cantidad: l.cantidad,
      unidad: unidadLineaVenta(l),
      precioUnitario: l.precio_unitario,
    })),
    total: alb.lineas_albaran_venta.reduce(
      (sum, l) => sum + (l.precio_unitario ? l.cantidad * l.precio_unitario : 0), 0
    ),
    notas: alb.notas,
  }
}

// documento: { numero, fecha, tercero: {nombre, direccion, cif},
//              lineas: [{concepto, cantidad, unidad, precioUnitario}], total, notas }
export async function generarAlbaranVentaPdf(documento) {
  const [empresa, datosBancarios] = await Promise.all([cargarEmpresa(), cargarDatosBancarios()])
  const doc = new jsPDF()
  await registrarFuentes(doc)

  const xIzq = 15
  const xDer = 195
  let y = 15

  // Logo (idéntico al del generador genérico, mismo recuadro máximo 35x20)
  await dibujarLogoEmpresa(doc, empresa, xIzq, y)

  // Cabecera derecha: "Lieferschein <numero>" / "DATUM: <fecha>"
  lineaMixtaDerecha(doc, [
    { texto: 'Lieferschein ', font: 'Montserrat', style: 'bold', size: 12, color: 20 },
    { texto: documento.numero || '', font: 'SpaceMono', style: 'bold', size: 12, color: 20 },
  ], xDer, y + 4)
  lineaMixtaDerecha(doc, [
    { texto: 'DATUM: ', font: 'Montserrat', style: 'normal', size: 10, color: 80 },
    { texto: formatFecha(documento.fecha), font: 'SpaceMono', style: 'normal', size: 10, color: 80 },
  ], xDer, y + 11)

  y += 30

  // VON / AN a dos columnas
  y = dibujarVonAn(doc, empresa, documento.tercero, xIzq, 110, y)

  // LIEFERDETAILS
  doc.setFont('Montserrat', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(20)
  doc.text('LIEFERDETAILS', xIzq, y)
  y += 4

  autoTable(doc, {
    startY: y,
    head: [['DATUM', 'ARTIKEL / BESCHREIBUNG', 'MENGE', 'PREIS', 'EINHEIT', 'TOTAL']],
    body: documento.lineas.map((l) => [
      formatFecha(documento.fecha),
      l.concepto,
      formatCantidad(l.cantidad, l.unidad),
      l.precioUnitario != null ? formatMoneda(l.precioUnitario, empresa?.moneda) : '-',
      l.unidad || '-',
      l.precioUnitario != null ? formatMoneda(l.cantidad * l.precioUnitario, empresa?.moneda) : '-',
    ]),
    theme: 'plain',
    styles: { font: 'SpaceMono', fontSize: 9, textColor: 60, lineColor: [220, 220, 220], lineWidth: 0.1 },
    headStyles: { font: 'SpaceMono', fontStyle: 'bold', textColor: 20, fillColor: false },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      5: { halign: 'right' },
    },
  })

  let yFinal = doc.lastAutoTable.finalY + 8

  // ZWISCHENSUMME
  lineaMixtaDerecha(doc, [
    { texto: 'ZWISCHENSUMME: ', font: 'Montserrat', style: 'bold', size: 11, color: 20 },
    { texto: documento.total != null ? formatMoneda(documento.total, empresa?.moneda) : '-', font: 'SpaceMono', style: 'bold', size: 11, color: 20 },
  ], xDer, yFinal)
  yFinal += 12

  // BEMERKUNGEN
  const bemerkungen = resolverBemerkungen(documento, datosBancarios)
  if (bemerkungen.length > 0) {
    doc.setFont('Montserrat', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(20)
    doc.text('BEMERKUNGEN:', xIzq, yFinal)
    yFinal += 6

    doc.setFont('SpaceMono', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(60)
    for (const b of bemerkungen) {
      doc.text(`* ${b}`, xIzq, yFinal)
      yFinal += 5
    }
  }

  // Footer -- fijo cerca del pie de página, nunca antes del contenido si este es largo
  const yFooter = Math.max(270, yFinal + 15)
  dibujarFooterMarca(doc, empresa, xIzq, xDer, yFooter)

  return doc
}

export async function descargarAlbaranVentaPdf(documento) {
  const doc = await generarAlbaranVentaPdf(documento)
  doc.save(`Lieferschein-${documento.numero || 'documento'}.pdf`)
}

export async function imprimirAlbaranVentaPdf(documento) {
  const doc = await generarAlbaranVentaPdf(documento)
  doc.autoPrint()
  window.open(doc.output('bloburl'), '_blank')
}
