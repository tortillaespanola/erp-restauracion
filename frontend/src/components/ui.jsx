// Sistema de componentes compartido — restyling "Quiet" (Claude Design, dirección 1a).
// Tokens en frontend/tailwind.config.js y TOKENS.md. Base histórica: mockups/mockup-articulos.html.

import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import DatePicker, { registerLocale } from 'react-datepicker'
import { es } from 'date-fns/locale'
import { IconChevronDown, IconX } from '@tabler/icons-react'
import 'react-datepicker/dist/react-datepicker.css'
import { seleccionarAlEnfocar, evitarColapsoDeSeleccion } from '../lib/seleccionAlEnfocar'
import { mensajeValidacionNativa } from '../lib/validacionNativa'

registerLocale('es', es)

export function PageHeader({ title, subtitle }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <h1 className="text-display text-ink">{title}</h1>
      {subtitle && <p className="text-meta text-ink-muted">{subtitle}</p>}
    </div>
  )
}

export function Card({ children, className = '' }) {
  return <div className={`bg-surface rounded-card border border-border shadow-card ${className}`}>{children}</div>
}

export function CardHeader({ title, action }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
      <h2 className="text-title text-ink">{title}</h2>
      {action}
    </div>
  )
}

export function CardBody({ children, className = '' }) {
  return <div className={`p-4 ${className}`}>{children}</div>
}

export function CardFooter({ children }) {
  return <div className="px-4 py-2.5 text-micro text-ink-subtle border-t border-border-subtle">{children}</div>
}

const buttonSizes = {
  md: 'h-control text-meta px-4',
  sm: 'h-control-sm text-xs px-3',
}

const buttonVariants = {
  primary: 'bg-primary-600 text-white shadow-btn hover:bg-primary-500 active:bg-primary-700',
  secondary: 'border border-border text-ink-body bg-surface hover:bg-surface-hover hover:border-border-strong',
  success: 'bg-success-50 text-success-600 border border-success-600/20 hover:bg-success-50/70',
}

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-control font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonSizes[size]} ${buttonVariants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

const linkTones = {
  blue: 'text-primary-600 hover:text-primary-700',
  red: 'text-danger-600 hover:text-danger-700',
  gray: 'text-ink-muted hover:text-ink-body',
  amber: 'text-warning-600 hover:text-warning-700',
  green: 'text-success-600 hover:text-success-700',
}

export function LinkAction({ children, tone = 'blue', className = '', ...props }) {
  return (
    <button type="button" className={`text-meta font-medium hover:underline ${linkTones[tone]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="text-label text-ink-muted block mb-1">{label}</label>}
      {children}
    </div>
  )
}

const controlClass = 'w-full h-control border border-border rounded-control px-3 text-body bg-surface text-ink-body placeholder:text-ink-subtle transition-colors hover:border-border-strong focus:outline-none focus:border-primary-600 focus:shadow-focus disabled:bg-surface-sunken disabled:text-ink-faint disabled:hover:border-border'

// CONTRATO_HARDENING_A5_A11.md (A6): los popups de validación nativa (required, min/max, tipo
// numérico inválido) salen en el idioma del navegador, no en el de la interfaz. setCustomValidity
// fuerza el mensaje traducido, pero se queda "pegado" hasta que se limpia explícitamente -- por
// eso hay que resetearlo en cada onChange, si no el campo queda inválido para siempre aunque el
// usuario ya haya corregido el valor.
function useValidacionNativaLocalizada(onInvalidProp, onChangeProp) {
  const { t } = useTranslation()

  function onInvalid(e) {
    e.target.setCustomValidity(mensajeValidacionNativa(e.target, t))
    onInvalidProp?.(e)
  }

  function onChange(e) {
    e.target.setCustomValidity('')
    onChangeProp?.(e)
  }

  return { onInvalid, onChange }
}

export function Input({ className = '', type, onInvalid, onChange, ...props }) {
  const validacion = useValidacionNativaLocalizada(onInvalid, onChange)
  if (type === 'number') {
    return <input type={type} className={`${controlClass} ${className}`} onFocus={seleccionarAlEnfocar} onMouseUp={evitarColapsoDeSeleccion} {...validacion} {...props} />
  }
  return <input type={type} className={`${controlClass} ${className}`} {...validacion} {...props} />
}

export function Select({ className = '', onInvalid, onChange, ...props }) {
  const validacion = useValidacionNativaLocalizada(onInvalid, onChange)
  return <select className={`${controlClass} ${className}`} {...validacion} {...props} />
}

export function Textarea({ className = '', onInvalid, onChange, ...props }) {
  const validacion = useValidacionNativaLocalizada(onInvalid, onChange)
  return <textarea className={`${controlClass} ${className}`} {...validacion} {...props} />
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
        <span className={`truncate ${selected.length === 0 ? 'text-ink-subtle' : ''}`}>{etiqueta}</span>
        <IconChevronDown size={16} className="text-ink-faint shrink-0 ml-2" />
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-surface border border-border rounded-control shadow-raised py-1">
          {options.length === 0 ? (
            <p className="text-body text-ink-subtle px-3 py-2">Sin opciones</p>
          ) : (
            <>
              {selected.length > 0 && (
                <button type="button" onClick={() => onChange([])}
                  className="w-full text-left px-3 py-1.5 text-xs text-primary-600 hover:bg-primary-50 border-b border-border-subtle">
                  Limpiar selección
                </button>
              )}
              {options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-body hover:bg-surface-hover cursor-pointer">
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
  gray: 'bg-neutral-50 text-neutral-600',
  blue: 'bg-primary-100 text-primary-700',
  green: 'bg-success-50 text-success-600',
  amber: 'bg-warning-50 text-warning-600',
  red: 'bg-danger-50 text-danger-600',
}

export function Badge({ children, color = 'gray' }) {
  return <span className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-pill whitespace-nowrap ${badgeColors[color]}`}>{children}</span>
}

export function Table({ children, className = '' }) {
  return <table className={`w-full text-body ${className}`}>{children}</table>
}

export function Thead({ children }) {
  return (
    <thead>
      <tr className="text-left text-overline text-ink-subtle border-b border-border bg-surface-sunken">
        {children}
      </tr>
    </thead>
  )
}

export function Th({ children, className = '' }) {
  return <th className={`px-4 h-thead font-medium ${className}`}>{children}</th>
}

export function Td({ children, className = '', ...props }) {
  return <td className={`px-4 py-2.5 ${className}`} {...props}>{children}</td>
}

export function EmptyState({ children }) {
  return <p className="text-body text-ink-subtle py-6 text-center">{children}</p>
}

export function LoadingState({ children = 'Cargando…' }) {
  return <p className="text-body text-ink-subtle py-6 text-center">{children}</p>
}

export function SectionLabel({ children }) {
  return <p className="text-overline text-ink-subtle mb-2">{children}</p>
}

// Panel lateral genérico (backdrop + slide-in desde la derecha) -- primer overlay del proyecto,
// pensado para reutilizarse en cualquier acción contextual futura, no acoplado al ajuste de stock.
// `anchoClase` es opcional (default max-w-md, igual que siempre) -- CONTRATO_UX_ALBARANES_VENTA.md
// lo necesita más ancho por sus formularios con grillas de varias columnas por línea.
export function Drawer({ open, onClose, title, children, anchoClase = 'max-w-md' }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/34 backdrop-blur-[1.5px]" onClick={onClose} />
      <div className={`relative w-full ${anchoClase} h-full bg-surface shadow-drawer flex flex-col`}>
        <div className="flex items-center justify-between px-5 h-topbar shrink-0 border-b border-border-subtle">
          <h2 className="text-title text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="text-ink-subtle hover:text-ink-body">
            <IconX size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
