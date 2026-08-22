import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { formatFecha } from './formatFecha'
import { formatCantidad, formatPrecio } from './formatCantidad'

import montserratRegularUrl from '../assets/fonts/Montserrat-Regular.ttf'
import montserratBoldUrl from '../assets/fonts/Montserrat-Bold.ttf'
import spaceMonoRegularUrl from '../assets/fonts/SpaceMono-Regular.ttf'
import spaceMonoBoldUrl from '../assets/fonts/SpaceMono-Bold.ttf'
import spaceMonoItalicUrl from '../assets/fonts/SpaceMono-Italic.ttf'

// Footer fijo de marca -- copy de "Española", no dato de negocio, no viene de BD.
const FOOTER = {
  titulo: 'SPANISCHI STUURHAIT',
  tagline: 'Basel’s local stuff, Spanish liquid gold, and a lot of Spanish stubbornness.',
  cita: 'You can’t rush a masterpiece and you can’t mass-produce a soul.',
  web: 'ESPANOLA.CH',
}

// Bullets de BEMERKUNGEN por defecto -- solo se usan si el albarán no tiene notas propias.
// El campo `notas` del albarán (editable en el formulario) es el sitio real y parametrizable:
// varias líneas separadas por ";" se muestran como bullets independientes.
const BEMERKUNGEN_POR_DEFECTO = [
  'Lokale handwerkliche Produktion in Basel.',
  'Nicht Mehrwertsteuerpflichtig aufgrund der Umsatzgrenze (Art. 10 MWSTG).',
]

function urlToBase64Imagen(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d').drawImage(img, 0, 0)
      resolve({ base64: canvas.toDataURL('image/png'), width: img.width, height: img.height })
    }
    img.onerror = reject
    img.src = url
  })
}

async function urlToBase64Binario(url) {
  const res = await fetch(url)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let binario = ''
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i])
  return btoa(binario)
}

// Las descargas/conversión de fuentes se cachean a nivel de módulo: cada jsPDF nuevo necesita
// su propio addFileToVFS/addFont, pero el fetch+base64 solo hace falta una vez por sesión.
let fuentesBase64Promise = null

async function registrarFuentes(doc) {
  if (!fuentesBase64Promise) {
    fuentesBase64Promise = Promise.all([
      urlToBase64Binario(montserratRegularUrl),
      urlToBase64Binario(montserratBoldUrl),
      urlToBase64Binario(spaceMonoRegularUrl),
      urlToBase64Binario(spaceMonoBoldUrl),
      urlToBase64Binario(spaceMonoItalicUrl),
    ])
  }
  const [mRegular, mBold, smRegular, smBold, smItalic] = await fuentesBase64Promise

  doc.addFileToVFS('Montserrat-Regular.ttf', mRegular)
  doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal')
  doc.addFileToVFS('Montserrat-Bold.ttf', mBold)
  doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold')

  doc.addFileToVFS('SpaceMono-Regular.ttf', smRegular)
  doc.addFont('SpaceMono-Regular.ttf', 'SpaceMono', 'normal')
  doc.addFileToVFS('SpaceMono-Bold.ttf', smBold)
  doc.addFont('SpaceMono-Bold.ttf', 'SpaceMono', 'bold')
  doc.addFileToVFS('SpaceMono-Italic.ttf', smItalic)
  doc.addFont('SpaceMono-Italic.ttf', 'SpaceMono', 'italic')
}

async function cargarEmpresa() {
  const { data } = await supabase.from('empresa_config').select('*').eq('id', 1).single()
  return data
}

// Dibuja una línea de segmentos con fuentes distintas, terminando en xDerecha (todo alineado
// a la derecha como bloque). Se recorre de derecha a izquierda acumulando el ancho de cada
// segmento con getTextWidth(), ya que jsPDF no soporta estilos mixtos dentro de un mismo texto.
function lineaMixtaDerecha(doc, segmentos, xDerecha, y) {
  let x = xDerecha
  for (let i = segmentos.length - 1; i >= 0; i--) {
    const s = segmentos[i]
    doc.setFont(s.font, s.style || 'normal')
    doc.setFontSize(s.size || 10)
    doc.setTextColor(s.color ?? 40)
    const ancho = doc.getTextWidth(s.texto)
    doc.text(s.texto, x - ancho, y)
    x -= ancho
  }
}

// documento: { numero, fecha, tercero: {nombre, direccion, cif},
//              lineas: [{concepto, cantidad, unidad, precioUnitario}], total, notas }
export async function generarAlbaranVentaPdf(documento) {
  const empresa = await cargarEmpresa()
  const doc = new jsPDF()
  await registrarFuentes(doc)

  const xIzq = 15
  const xDer = 195
  let y = 15

  // Logo (idéntico al del generador genérico, mismo recuadro máximo 35x20)
  if (empresa?.logo_url) {
    try {
      const { base64, width, height } = await urlToBase64Imagen(empresa.logo_url)
      const maxAncho = 35
      const maxAlto = 20
      const ratio = Math.min(maxAncho / width, maxAlto / height)
      doc.addImage(base64, 'PNG', xIzq, y, width * ratio, height * ratio, undefined, 'FAST')
    } catch (e) {
      console.error('No se pudo cargar el logo', e)
    }
  }

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
  const xCol2 = 110
  doc.setFont('Montserrat', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(20)
  doc.text('VON:', xIzq, y)
  doc.text('AN:', xCol2, y)
  y += 6

  doc.setFont('SpaceMono', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(60)

  const von = [empresa?.nombre, empresa?.direccion, empresa?.cif ? `CIF: ${empresa.cif}` : null].filter(Boolean)
  const an = [documento.tercero?.nombre, documento.tercero?.direccion, documento.tercero?.cif ? `CIF: ${documento.tercero.cif}` : null].filter(Boolean)

  const filas = Math.max(von.length, an.length)
  for (let i = 0; i < filas; i++) {
    if (von[i]) doc.text(von[i], xIzq, y + i * 5)
    if (an[i]) doc.text(an[i], xCol2, y + i * 5)
  }
  y += filas * 5 + 10

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
      l.precioUnitario != null ? `${formatPrecio(l.precioUnitario)} €` : '-',
      l.unidad || '-',
      l.precioUnitario != null ? `${formatPrecio(l.cantidad * l.precioUnitario)} €` : '-',
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
    { texto: documento.total != null ? `${formatPrecio(documento.total)} €` : '-', font: 'SpaceMono', style: 'bold', size: 11, color: 20 },
  ], xDer, yFinal)
  yFinal += 12

  // BEMERKUNGEN
  const bullets = (documento.notas ? documento.notas.split(';').map((n) => n.trim()).filter(Boolean) : [])
  const bemerkungen = bullets.length > 0 ? bullets : BEMERKUNGEN_POR_DEFECTO

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

  // Footer -- fijo cerca del pie de página, nunca antes del contenido si este es largo
  const yFooter = Math.max(270, yFinal + 15)

  doc.setFont('Montserrat', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(20)
  doc.text(FOOTER.titulo, xIzq, yFooter)
  doc.text(FOOTER.web, xDer, yFooter, { align: 'right' })

  doc.setFont('SpaceMono', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(90)
  doc.text(FOOTER.tagline, xIzq, yFooter + 5)
  doc.text(`“${FOOTER.cita}”`, xIzq, yFooter + 10)

  const contacto = [empresa?.email ? `E: ${empresa.email}` : null, empresa?.telefono ? `T: ${empresa.telefono}` : null]
    .filter(Boolean)
    .join(' | ')
  if (contacto) {
    doc.setFont('SpaceMono', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(90)
    doc.text(contacto, xDer, yFooter + 10, { align: 'right' })
  }

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
