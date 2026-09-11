import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatFecha } from './formatFecha'
import { formatCantidad, formatMoneda } from './formatCantidad'
import {
  registrarFuentes, cargarEmpresa, cargarDatosBancarios, lineaMixtaDerecha,
  dibujarLogoEmpresa, dibujarVonAn, resolverBemerkungen, dibujarFooterMarca,
} from './pdfDocumentoBase'

// CONTRATO_FACTURA_PDF.md: traduce una factura (con sus relaciones embebidas, mismo shape que ya
// arma FacturasVenta.jsx) al shape plano que espera generarFacturaVentaPdf() -- { numero, fecha,
// tercero, lineas (con fecha propia del albarán de origen, no la de la factura), fechaMin,
// fechaMax, total, avisoPeriodo }.
export function prepararDocumentoFacturaVenta(f) {
  const albaranes = (f.factura_venta_albaran || [])
    .map((rel) => rel.albaranes_venta)
    .filter(Boolean)
  const fechasAlbaranes = albaranes.map((a) => a.fecha).filter(Boolean)
  const fechaMinima = fechasAlbaranes.length > 0 ? fechasAlbaranes.reduce((a, b) => (a < b ? a : b)) : f.fecha
  const fechaMaxima = fechasAlbaranes.length > 0 ? fechasAlbaranes.reduce((a, b) => (a > b ? a : b)) : f.fecha
  const fechaPorAlbaran = new Map(albaranes.map((a) => [a.id, a.fecha]))

  return {
    numero: f.numero_factura || `#${f.id}`,
    fecha: f.fecha,
    fechaMin: fechaMinima,
    fechaMax: fechaMaxima,
    tercero: {
      nombre: f.clientes?.nombre,
      direccion: f.clientes?.direccion,
      cif: f.clientes?.cif,
    },
    lineas: (f.lineas || []).map((l) => ({
      concepto: l.concepto,
      cantidad: l.cantidad,
      unidad: l.unidad,
      precioUnitario: l.precioUnitario,
      fecha: fechaPorAlbaran.get(l.albaranVentaId) ?? f.fecha,
    })),
    total: f.total,
    avisoPeriodo: f.aviso_periodo,
  }
}

// documento: { numero, fecha, fechaMin, fechaMax, tercero: {nombre, direccion, cif},
//              lineas: [{concepto, cantidad, unidad, precioUnitario, fecha}], total, avisoPeriodo }
export async function generarFacturaVentaPdf(documento) {
  const [empresa, datosBancarios] = await Promise.all([cargarEmpresa(), cargarDatosBancarios()])
  const doc = new jsPDF()
  await registrarFuentes(doc)

  const xIzq = 15
  const xDer = 195
  let y = 15

  // Logo (mismo recuadro máximo que el albarán, helper compartido)
  await dibujarLogoEmpresa(doc, empresa, xIzq, y)

  // Cabecera derecha: "Rechnung <numero>" / "Datum: <fecha>" / "Abrechnungsperiode: <min> - <max>"
  lineaMixtaDerecha(doc, [
    { texto: 'Rechnung ', font: 'Montserrat', style: 'bold', size: 12, color: 20 },
    { texto: documento.numero || '', font: 'SpaceMono', style: 'bold', size: 12, color: 20 },
  ], xDer, y + 4)
  lineaMixtaDerecha(doc, [
    { texto: 'Datum: ', font: 'Montserrat', style: 'normal', size: 10, color: 80 },
    { texto: formatFecha(documento.fecha), font: 'SpaceMono', style: 'normal', size: 10, color: 80 },
  ], xDer, y + 11)
  lineaMixtaDerecha(doc, [
    { texto: 'Abrechnungsperiode: ', font: 'Montserrat', style: 'normal', size: 10, color: 80 },
    { texto: `${formatFecha(documento.fechaMin)} - ${formatFecha(documento.fechaMax)}`, font: 'SpaceMono', style: 'normal', size: 10, color: 80 },
  ], xDer, y + 18)

  y += 37

  // VON / AN a dos columnas (helper compartido, idéntico al albarán)
  y = dibujarVonAn(doc, empresa, documento.tercero, xIzq, 110, y)

  // RECHNUNGSPOSITIONEN -- misma estructura que LIEFERDETAILS del albarán, pero DATUM es la fecha
  // del albarán de origen de cada línea (pueden ser varias fechas distintas), no la de la factura.
  doc.setFont('Montserrat', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(20)
  doc.text('RECHNUNGSPOSITIONEN', xIzq, y)
  y += 4

  autoTable(doc, {
    startY: y,
    head: [['DATUM', 'ARTIKEL / BESCHREIBUNG', 'MENGE', 'PREIS', 'EINHEIT', 'TOTAL']],
    body: documento.lineas.map((l) => [
      formatFecha(l.fecha),
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

  // ZWISCHENSUMME / MWST (0%, hardcodeado -- IVA dinámico fuera de alcance) / TOTAL
  const subtotal = documento.total
  lineaMixtaDerecha(doc, [
    { texto: 'ZWISCHENSUMME: ', font: 'Montserrat', style: 'normal', size: 10, color: 60 },
    { texto: subtotal != null ? formatMoneda(subtotal, empresa?.moneda) : '-', font: 'SpaceMono', style: 'normal', size: 10, color: 60 },
  ], xDer, yFinal)
  yFinal += 6
  lineaMixtaDerecha(doc, [
    { texto: 'MWST (0%): ', font: 'Montserrat', style: 'normal', size: 10, color: 60 },
    { texto: formatMoneda(0, empresa?.moneda), font: 'SpaceMono', style: 'normal', size: 10, color: 60 },
  ], xDer, yFinal)
  yFinal += 8
  lineaMixtaDerecha(doc, [
    { texto: 'TOTAL: ', font: 'Montserrat', style: 'bold', size: 11, color: 20 },
    { texto: subtotal != null ? formatMoneda(subtotal, empresa?.moneda) : '-', font: 'SpaceMono', style: 'bold', size: 11, color: 20 },
  ], xDer, yFinal)
  yFinal += 12

  // BEMERKUNGEN -- helper compartido (notas propias > datos_bancarios.observaciones), más el
  // aviso de periodo incompleto SIEMPRE al final si existe, aunque no haya otras Bemerkungen
  // (CONTRATO_FACTURA_PDF.md, sección 4.7).
  const bemerkungenBase = resolverBemerkungen(documento, datosBancarios)
  const bemerkungen = documento.avisoPeriodo ? [...bemerkungenBase, documento.avisoPeriodo] : bemerkungenBase

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
    yFinal += 3
  }

  // ZAHLUNGSKONDITIONEN -- nueva, solo en factura, desde datos_bancarios del negocio. Cada campo
  // se omite sin dejar hueco si está vacío (CONTRATO_FACTURA_PDF.md, sección 4.8).
  const lineasCondiciones = []
  if (datosBancarios?.condiciones_pago) {
    for (const linea of datosBancarios.condiciones_pago.split('\n')) lineasCondiciones.push({ texto: linea })
  }
  if (datosBancarios?.enlace_pago_online) {
    lineasCondiciones.push({ texto: 'Bezahlen mit: ', enlace: datosBancarios.enlace_pago_online })
  }
  if (datosBancarios?.beneficiario) lineasCondiciones.push({ texto: `Begünstigter: ${datosBancarios.beneficiario}` })
  if (datosBancarios?.direccion_beneficiario) lineasCondiciones.push({ texto: `Adresse: ${datosBancarios.direccion_beneficiario}` })
  if (datosBancarios?.iban) lineasCondiciones.push({ texto: `IBAN: ${datosBancarios.iban}` })
  if (datosBancarios?.bic) lineasCondiciones.push({ texto: `BIC: ${datosBancarios.bic}` })
  if (datosBancarios?.referencia_pago) lineasCondiciones.push({ texto: `Referenz: ${datosBancarios.referencia_pago}` })
  if (datosBancarios?.banco) lineasCondiciones.push({ texto: `Bank: ${datosBancarios.banco}` })

  if (lineasCondiciones.length > 0) {
    doc.setFont('Montserrat', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(20)
    doc.text('ZAHLUNGSKONDITIONEN:', xIzq, yFinal)
    yFinal += 6

    doc.setFont('SpaceMono', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(60)
    for (const { texto, enlace } of lineasCondiciones) {
      if (enlace) {
        doc.text(texto, xIzq, yFinal)
        const anchoEtiqueta = doc.getTextWidth(texto)
        doc.setTextColor(37, 99, 235)
        doc.textWithLink(enlace, xIzq + anchoEtiqueta, yFinal, { url: enlace })
        doc.setTextColor(60)
      } else {
        doc.text(texto, xIzq, yFinal)
      }
      yFinal += 5
    }
  }

  // Footer de marca (helper compartido, idéntico al albarán)
  const yFooter = Math.max(270, yFinal + 15)
  dibujarFooterMarca(doc, empresa, xIzq, xDer, yFooter)

  return doc
}

export async function descargarFacturaVentaPdf(documento) {
  const doc = await generarFacturaVentaPdf(documento)
  doc.save(`Rechnung-${documento.numero || 'documento'}.pdf`)
}

export async function imprimirFacturaVentaPdf(documento) {
  const doc = await generarFacturaVentaPdf(documento)
  doc.autoPrint()
  window.open(doc.output('bloburl'), '_blank')
}
