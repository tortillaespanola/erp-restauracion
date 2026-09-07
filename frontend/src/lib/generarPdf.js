import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { formatFecha } from './formatFecha'

// Convierte una URL de imagen en base64 y devuelve también sus proporciones reales
function urlToBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      resolve({
        base64: canvas.toDataURL('image/png'),
        width: img.width,
        height: img.height,
      })
    }
    img.onerror = reject
    img.src = url
  })
}

async function cargarEmpresa() {
  const { data } = await supabase.from('empresa_config').select('*').single()
  return data
}

// tipo: 'Albarán' o 'Factura'
// documento: { numero, fecha, tercero: {nombre, direccion, cif}, lineas: [{concepto, cantidad, precioUnitario}], total }
export async function generarDocumentoPdf(tipo, documento) {
  const empresa = await cargarEmpresa()
  const doc = new jsPDF()

  let y = 15

 // Logo (si existe) — respetando su proporción real dentro de un recuadro máximo
  if (empresa?.logo_url) {
    try {
      const { base64, width, height } = await urlToBase64(empresa.logo_url)
      const maxAncho = 35
      const maxAlto = 20
      const ratio = Math.min(maxAncho / width, maxAlto / height)
      const anchoFinal = width * ratio
      const altoFinal = height * ratio
      doc.addImage(base64, 'PNG', 15, y, anchoFinal, altoFinal, undefined, 'FAST')
    } catch (e) {
      console.error('No se pudo cargar el logo', e)
    }
  }

  // Datos de la empresa (columna derecha)
  doc.setFontSize(10)
  doc.setTextColor(80)
  let yEmpresa = y
  doc.text(empresa?.nombre || '', 195, yEmpresa, { align: 'right' })
  yEmpresa += 5
  if (empresa?.razon_fiscal) { doc.text(empresa.razon_fiscal, 195, yEmpresa, { align: 'right' }); yEmpresa += 5 }
  if (empresa?.cif) { doc.text(`CIF: ${empresa.cif}`, 195, yEmpresa, { align: 'right' }); yEmpresa += 5 }
  if (empresa?.direccion) { doc.text(empresa.direccion, 195, yEmpresa, { align: 'right' }); yEmpresa += 5 }
  if (empresa?.telefono) { doc.text(empresa.telefono, 195, yEmpresa, { align: 'right' }); yEmpresa += 5 }
  if (empresa?.email) { doc.text(empresa.email, 195, yEmpresa, { align: 'right' }); yEmpresa += 5 }

  y = Math.max(y + 30, yEmpresa) + 10

  // Título del documento
  doc.setFontSize(18)
  doc.setTextColor(20)
  doc.text(`${tipo} ${documento.numero || ''}`, 15, y)
  y += 7
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Fecha: ${formatFecha(documento.fecha)}`, 15, y)
  y += 10

  // Datos del cliente/proveedor
  doc.setFontSize(11)
  doc.setTextColor(20)
  doc.text('Datos del cliente', 15, y)
  y += 6
  doc.setFontSize(10)
  doc.setTextColor(60)
  doc.text(documento.tercero.nombre || '', 15, y)
  y += 5
  if (documento.tercero.direccion) { doc.text(documento.tercero.direccion, 15, y); y += 5 }
  if (documento.tercero.cif) { doc.text(`CIF: ${documento.tercero.cif}`, 15, y); y += 5 }
  y += 5

  // Tabla de líneas
  autoTable(doc, {
    startY: y,
    head: [['Concepto', 'Cantidad', 'Precio unit.', 'Importe']],
    body: documento.lineas.map((l) => [
      l.concepto,
      l.cantidad,
      l.precioUnitario != null ? `${l.precioUnitario.toFixed(2)} CHF` : '-',
      l.precioUnitario != null ? `${(l.cantidad * l.precioUnitario).toFixed(2)} CHF` : '-',
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 9 },
  })

  let yFinal = doc.lastAutoTable.finalY + 10

  // Total
  if (documento.total != null) {
    doc.setFontSize(12)
    doc.setTextColor(20)
    doc.text(`Total: ${Number(documento.total).toFixed(2)} CHF`, 195, yFinal, { align: 'right' })
  }

  return doc
}

export async function descargarPdf(tipo, documento) {
  const doc = await generarDocumentoPdf(tipo, documento)
  doc.save(`${tipo}-${documento.numero || 'documento'}.pdf`)
}

export async function imprimirPdf(tipo, documento) {
  const doc = await generarDocumentoPdf(tipo, documento)
  doc.autoPrint()
  window.open(doc.output('bloburl'), '_blank')
}