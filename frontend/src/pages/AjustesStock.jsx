import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, CardHeader, CardBody, Button, LinkAction, Field, Input, Select, Table, Thead, Th, Td, EmptyState, LoadingState } from '../components/ui'

function AjustesStock() {
  const [tipo, setTipo] = useState('articulo')
  const [articulos, setArticulos] = useState([])
  const [semielaborados, setSemielaborados] = useState([])
  const [itemId, setItemId] = useState('')
  const [lotes, setLotes] = useState([])
  const [loteId, setLoteId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(true)

  async function cargarBase() {
    setCargando(true)
    const [resArt, resSemi, resAjArt, resAjSemi] = await Promise.all([
      supabase.from('articulos_compra').select('id, nombre, unidad').order('nombre'),
      supabase.from('semielaborados').select('id, nombre, unidad').order('nombre'),
      supabase.from('ajustes_articulo').select('*, articulos_compra(nombre, unidad)').order('fecha', { ascending: false }),
      supabase.from('ajustes_semielaborado').select('*, semielaborados(nombre, unidad)').order('fecha', { ascending: false }),
    ])

    if (resArt.error) console.error(resArt.error)
    else setArticulos(resArt.data)

    if (resSemi.error) console.error(resSemi.error)
    else setSemielaborados(resSemi.data)

    const historialArt = (resAjArt.data || []).map((a) => ({
      ...a, tipo: 'articulo', nombre: a.articulos_compra?.nombre, unidad: a.articulos_compra?.unidad,
    }))
    const historialSemi = (resAjSemi.data || []).map((a) => ({
      ...a, tipo: 'semielaborado', nombre: a.semielaborados?.nombre, unidad: a.semielaborados?.unidad,
    }))
    const combinado = [...historialArt, ...historialSemi].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    setHistorial(combinado)

    setCargando(false)
  }

  useEffect(() => {
    cargarBase()
  }, [])

  useEffect(() => {
    async function cargarLotes() {
      setLoteId('')
      if (!itemId) {
        setLotes([])
        return
      }
      if (tipo === 'articulo') {
        const { data } = await supabase
          .from('stock_lotes_articulo')
          .select('*')
          .eq('articulo_id', itemId)
          .order('fecha_recepcion', { ascending: true })
        setLotes(data || [])
      } else {
        const { data } = await supabase
          .from('stock_lotes_semielaborado')
          .select('*')
          .eq('semielaborado_id', itemId)
          .order('fecha', { ascending: true })
        setLotes(data || [])
      }
    }
    cargarLotes()
  }, [tipo, itemId])

  function resetForm() {
    setItemId('')
    setLoteId('')
    setCantidad('')
    setMotivo('')
    setFecha(new Date().toISOString().slice(0, 10))
    setLotes([])
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!itemId || !loteId || !cantidad || !motivo) {
      alert('Selecciona el ítem, el lote, la cantidad y el motivo')
      return
    }

    const cant = parseFloat(cantidad)

    if (tipo === 'articulo') {
      const { error } = await supabase.from('ajustes_articulo').insert({
        articulo_id: parseInt(itemId),
        entrada_material_id: parseInt(loteId),
        cantidad: cant,
        motivo,
        fecha,
      })
      if (error) {
        alert('Error al guardar el ajuste: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('ajustes_semielaborado').insert({
        semielaborado_id: parseInt(itemId),
        produccion_id: parseInt(loteId),
        cantidad: cant,
        motivo,
        fecha,
      })
      if (error) {
        alert('Error al guardar el ajuste: ' + error.message)
        return
      }
    }

    resetForm()
    cargarBase()
  }

  async function handleBorrar(a) {
    if (!confirm('¿Seguro que quieres eliminar este ajuste? El stock volverá a su valor anterior.')) return

    const tabla = a.tipo === 'articulo' ? 'ajustes_articulo' : 'ajustes_semielaborado'
    const { error } = await supabase.from(tabla).delete().eq('id', a.id)
    if (error) {
      alert('Error al borrar: ' + error.message)
      return
    }
    cargarBase()
  }

  const items = tipo === 'articulo' ? articulos : semielaborados

  return (
    <div>
      <PageHeader title="Ajustes de stock" subtitle="Corrige el stock de un lote concreto por mermas, caducidad, roturas o errores de pesaje. Usa cantidades negativas para restar y positivas para sumar." />

      <Card className="mb-6">
        <CardHeader title="Nuevo ajuste" />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={tipo === 'articulo'}
                  onChange={() => { setTipo('articulo'); setItemId('') }} />
                Artículo de compra
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={tipo === 'semielaborado'}
                  onChange={() => { setTipo('semielaborado'); setItemId('') }} />
                Semielaborado
              </label>
            </div>

            <Select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
              <option value="">Selecciona {tipo === 'articulo' ? 'artículo' : 'semielaborado'}</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>
              ))}
            </Select>

            {itemId && (
              <Select value={loteId} onChange={(e) => setLoteId(e.target.value)} required>
                <option value="">
                  {lotes.length === 0 ? 'Este ítem no tiene lotes con stock' : 'Selecciona el lote a ajustar'}
                </option>
                {lotes.map((l, index) => {
                  const id = tipo === 'articulo' ? l.entrada_material_id : l.produccion_id
                  const esMasAntiguo = index === 0
                  const label = tipo === 'articulo'
                    ? `${esMasAntiguo ? '✓ Más antiguo · ' : ''}Albarán ${l.numero_albaran || '(s/n)'} · ${l.fecha_recepcion} · stock actual: ${Number(l.stock_disponible).toFixed(3)}`
                    : `${esMasAntiguo ? '✓ Más antiguo · ' : ''}Producción ${l.fecha} · stock actual: ${Number(l.stock_disponible).toFixed(3)}`
                  return <option key={id} value={id}>{label}</option>
                })}
              </Select>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Cantidad (+ suma, - resta)">
                <Input type="number" step="0.001" value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  required title="Se redondeará a 3 decimales" />
              </Field>
              <Field label="Fecha">
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
              </Field>
              <Field label="Motivo">
                <Input type="text" placeholder="Caducidad, rotura, error pesaje..." value={motivo}
                  onChange={(e) => setMotivo(e.target.value)} required />
              </Field>
            </div>

            <Button type="submit" className="self-start">Registrar ajuste</Button>
          </form>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-[#1C2938] mb-3">Historial de ajustes</h2>
      {cargando ? (
        <LoadingState />
      ) : historial.length === 0 ? (
        <Card><EmptyState>Todavía no hay ajustes registrados.</EmptyState></Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <Thead>
              <Th>Fecha</Th>
              <Th>Ítem</Th>
              <Th>Cantidad</Th>
              <Th>Motivo</Th>
              <Th></Th>
            </Thead>
            <tbody className="divide-y divide-gray-100">
              {historial.map((a) => (
                <tr key={`${a.tipo}-${a.id}`} className="hover:bg-blue-50/40">
                  <Td className="text-gray-500">{a.fecha}</Td>
                  <Td className="font-medium">{a.nombre} <span className="text-gray-400 text-xs font-normal">({a.tipo})</span></Td>
                  <Td className={`font-medium ${a.cantidad >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {a.cantidad >= 0 ? '+' : ''}{a.cantidad} {a.unidad}
                  </Td>
                  <Td className="text-gray-500">{a.motivo}</Td>
                  <Td className="text-right">
                    <LinkAction tone="red" onClick={() => handleBorrar(a)} className="text-xs">Borrar</LinkAction>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}

export default AjustesStock
