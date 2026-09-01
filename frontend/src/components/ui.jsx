// Sistema de componentes compartido — lenguaje visual SAP Fiori
// Referencia: mockups/mockup-articulos.html

import { useState, useRef, useEffect } from 'react'
import DatePicker, { registerLocale } from 'react-datepicker'
import { es } from 'date-fns/locale'
import { IconChevronDown, IconX } from '@tabler/icons-react'
import 'react-datepicker/dist/react-datepicker.css'

registerLocale('es', es)

export function PageHeader({ title, subtitle }) {
  return (
    <div className="mb-6">
      <h1 className="text-lg font-semibold text-[#1C2938]">{title}</h1>
      {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
    </div>
  )
}

export function Card({ children, className = '' }) {
  return <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>{children}</div>
}

export function CardHeader({ title, action }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
      <h2 className="text-sm font-semibold text-[#1C2938]">{title}</h2>
      {action}
    </div>
  )
}

export function CardBody({ children, className = '' }) {
  return <div className={`p-4 ${className}`}>{children}</div>
}

export function CardFooter({ children }) {
  return <div className="px-4 py-2.5 text-xs text-gray-400 border-t border-gray-100">{children}</div>
}

const buttonSizes = {
  md: 'text-sm px-4 py-2',
  sm: 'text-xs px-3 py-1.5',
}

const buttonVariants = {
  primary: 'bg-[#0854A0] text-white hover:bg-[#0A3D62]',
  secondary: 'border border-gray-200 text-gray-600 hover:bg-gray-50 bg-white',
  success: 'bg-[#3B6D11] text-white hover:bg-[#2f5a0d]',
}

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonSizes[size]} ${buttonVariants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

const linkTones = {
  blue: 'text-[#0854A0]',
  red: 'text-red-600',
  gray: 'text-gray-500',
  amber: 'text-amber-600',
  green: 'text-green-700',
}

export function LinkAction({ children, tone = 'blue', className = '', ...props }) {
  return (
    <button type="button" className={`text-sm font-medium hover:underline ${linkTones[tone]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="text-[11px] font-medium text-gray-500 block mb-1">{label}</label>}
      {children}
    </div>
  )
}

const controlClass = 'w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-white text-[#1C2938] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 disabled:bg-gray-100 disabled:text-gray-400'

export function Input({ className = '', ...props }) {
  return <input className={`${controlClass} ${className}`} {...props} />
}

export function Select({ className = '', ...props }) {
  return <select className={`${controlClass} ${className}`} {...props} />
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={`${controlClass} ${className}`} {...props} />
}

// Checkbox-dropdown genérico de selección múltiple, mismo estilo visual que <Select> --
// pensado para reutilizarse en cualquier filtro multi-select futuro (Inventario,
// Expediciones, Facturación...), no acoplado a un caso concreto.
// `options`: [{ value, label }]. `selected`: array de `value` seleccionados.
// `onChange(nuevoArraySeleccionado)`.
export function MultiSelect({ options, selected, onChange, placeholder = 'Todos', className = '' }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClickFuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('mousedown', handleClickFuera)
    return () => document.removeEventListener('mousedown', handleClickFuera)
  }, [])

  function toggle(value) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const etiqueta = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? placeholder)
      : `${selected.length} seleccionados`

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className={`${controlClass} flex items-center justify-between text-left`}
      >
        <span className={`truncate ${selected.length === 0 ? 'text-gray-400' : ''}`}>{etiqueta}</span>
        <IconChevronDown size={16} className="text-gray-400 shrink-0 ml-2" />
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg py-1">
          {options.length === 0 ? (
            <p className="text-sm text-gray-400 px-3 py-2">Sin opciones</p>
          ) : (
            <>
              {selected.length > 0 && (
                <button type="button" onClick={() => onChange([])}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#0854A0] hover:bg-blue-50 border-b border-gray-100">
                  Limpiar selección
                </button>
              )}
              {options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                  {o.label}
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function isoToDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function dateToIso(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// value/onChange trabajan con fecha ISO ('yyyy-mm-dd', igual que <input type="date">)
// para no cambiar el estado de cada pantalla — solo cambia el control de entrada.
export function DateInput({ value, onChange, className = '', ...props }) {
  return (
    <DatePicker
      selected={isoToDate(value)}
      onChange={(date) => onChange(dateToIso(date))}
      dateFormat="dd/MM/yyyy"
      locale="es"
      className={`${controlClass} ${className}`}
      wrapperClassName="w-full"
      {...props}
    />
  )
}

const badgeColors = {
  gray: 'bg-gray-100 text-gray-600',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
}

export function Badge({ children, color = 'gray' }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${badgeColors[color]}`}>{children}</span>
}

export function Table({ children, className = '' }) {
  return <table className={`w-full text-sm ${className}`}>{children}</table>
}

export function Thead({ children }) {
  return (
    <thead>
      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
        {children}
      </tr>
    </thead>
  )
}

export function Th({ children, className = '' }) {
  return <th className={`px-4 py-2 font-medium ${className}`}>{children}</th>
}

export function Td({ children, className = '', ...props }) {
  return <td className={`px-4 py-2.5 ${className}`} {...props}>{children}</td>
}

export function EmptyState({ children }) {
  return <p className="text-sm text-gray-400 py-6 text-center">{children}</p>
}

export function LoadingState({ children = 'Cargando…' }) {
  return <p className="text-sm text-gray-400 py-6 text-center">{children}</p>
}

export function SectionLabel({ children }) {
  return <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{children}</p>
}

// Panel lateral genérico (backdrop + slide-in desde la derecha) -- primer overlay del proyecto,
// pensado para reutilizarse en cualquier acción contextual futura, no acoplado al ajuste de stock.
export function Drawer({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-[#1C2938]">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <IconX size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
