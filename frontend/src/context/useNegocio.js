import { createContext, useContext } from 'react'

// Separado de NegocioContext.jsx (el componente) porque un archivo no puede mezclar un export
// de componente con exports de hooks/objetos sin romper el fast refresh de Vite
// (react-refresh/only-export-components).
export const NegocioContext = createContext(null)

export function useNegocio() {
  return useContext(NegocioContext)
}
