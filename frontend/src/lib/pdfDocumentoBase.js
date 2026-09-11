import { supabase } from './supabase'

// CONTRATO_FACTURA_PDF.md, sección 3: helpers extraídos de generarAlbaranVentaPdf.js para que
// generarFacturaVentaPdf.js los reutilice sin duplicar -- fuentes, línea mixta, logo, VON/AN,
// BEMERKUNGEN y footer de marca. Extracción pura: ningún comportamiento cambia respecto al
// albarán (verificado comparando el PDF generado antes/después del refactor).
import montserratRegularUrl from '../assets/fonts/Montserrat-Regular.ttf'
import montserratBoldUrl from '../assets/fonts/Montserrat-Bold.ttf'
import spaceMonoRegularUrl from '../assets/fonts/SpaceMono-Regular.ttf'
import spaceMonoBoldUrl from '../assets/fonts/SpaceMono-Bold.ttf'
import spaceMonoItalicUrl from '../assets/fonts/SpaceMono-Italic.ttf'

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

export async function registrarFuentes(doc) {
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

export async function cargarEmpresa() {
  const { data } = await supabase.from('empresa_config').select('*').single()
  return data
}

// select('*') -- factura necesita también condiciones_pago/enlace_pago_online/beneficiario/etc.
// (ZAHLUNGSKONDITIONEN, CONTRATO_FACTURA_PDF.md sección 4.8), no solo observaciones.
export async function cargarDatosBancarios() {
  const { data } = await supabase.from('datos_bancarios').select('*').maybeSingle()
  return data
}

// Dibuja una línea de segmentos con fuentes distintas, terminando en xDerecha (todo alineado
// a la derecha como bloque). Se recorre de derecha a izquierda acumulando el ancho de cada
// segmento con getTextWidth(), ya que jsPDF no soporta estilos mixtos dentro de un mismo texto.
export function lineaMixtaDerecha(doc, segmentos, xDerecha, y) {
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

// Logo -- recuadro máximo 35x20, esquina superior izquierda. No-op si el negocio no tiene logo.
export async function dibujarLogoEmpresa(doc, empresa, x, y) {
  if (!empresa?.logo_url) return
  try {
    const { base64, width, height } = await urlToBase64Imagen(empresa.logo_url)
    const maxAncho = 35
    const maxAlto = 20
    const ratio = Math.min(maxAncho / width, maxAlto / height)
    doc.addImage(base64, 'PNG', x, y, width * ratio, height * ratio, undefined, 'FAST')
  } catch (e) {
    console.error('No se pudo cargar el logo', e)
  }
}

// VON/AN a dos columnas. Devuelve la y siguiente tras el bloque (mismo cálculo que antes:
// filas * 5 + 10 de margen).
export function dibujarVonAn(doc, empresa, tercero, xIzq, xCol2, y) {
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
  const an = [tercero?.nombre, tercero?.direccion, tercero?.cif ? `CIF: ${tercero.cif}` : null].filter(Boolean)

  const filas = Math.max(von.length, an.length)
  for (let i = 0; i < filas; i++) {
    if (von[i]) doc.text(von[i], xIzq, y + i * 5)
    if (an[i]) doc.text(an[i], xCol2, y + i * 5)
  }
  return y + filas * 5 + 10
}

// BEMERKUNGEN -- prioridad: notas propias del documento > empresa.observaciones (datos_bancarios)
// > nada (CONTRATO_PIE_DOCUMENTO.md, sección 5: sin fallback hardcodeado). Solo resuelve la lista
// de bullets; dibujarla es cosa de cada generador (factura añade una línea de aviso propia al
// final, CONTRATO_FACTURA_PDF.md sección 4.7).
export function resolverBemerkungen(documento, datosBancarios) {
  const bulletsNotas = documento.notas ? documento.notas.split(';').map((n) => n.trim()).filter(Boolean) : []
  if (bulletsNotas.length > 0) return bulletsNotas
  return datosBancarios?.observaciones
    ? datosBancarios.observaciones.split(';').map((n) => n.trim()).filter(Boolean)
    : []
}

// Footer de marca -- cada línea viene de empresa_config (todas nullable) y se omite sin dejar
// hueco si no está configurada, en vez de un placeholder (CONTRATO_PIE_DOCUMENTO.md, sección 3).
export function dibujarFooterMarca(doc, empresa, xIzq, xDer, yFooter) {
  let yPie = yFooter

  if (empresa?.nombre) {
    doc.setFont('Montserrat', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(20)
    doc.text(empresa.nombre, xIzq, yPie)
  }
  if (empresa?.pagina_web) {
    doc.setFont('Montserrat', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(20)
    doc.text(empresa.pagina_web, xDer, yPie, { align: 'right' })
  }
  if (empresa?.nombre || empresa?.pagina_web) yPie += 5

  if (empresa?.eslogan) {
    doc.setFont('SpaceMono', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(90)
    doc.text(empresa.eslogan, xIzq, yPie)
    yPie += 5
  }
  if (empresa?.comentario_eslogan) {
    doc.setFont('SpaceMono', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(90)
    doc.text(`“${empresa.comentario_eslogan}”`, xIzq, yPie)
    yPie += 5
  }

  const contacto = [empresa?.email ? `E: ${empresa.email}` : null, empresa?.telefono ? `T: ${empresa.telefono}` : null]
    .filter(Boolean)
    .join(' | ')
  if (contacto) {
    doc.setFont('SpaceMono', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(90)
    doc.text(contacto, xDer, yPie, { align: 'right' })
  }
}
