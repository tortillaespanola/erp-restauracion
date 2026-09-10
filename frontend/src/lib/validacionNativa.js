// CONTRATO_HARDENING_A5_A11.md (A6): los mensajes de validación HTML nativa (required, min/max,
// tipo numérico inválido) salían en inglés del navegador aunque la interfaz esté en ES/EN/DE.
// CONTRATO_I18N.md no cubre este caso (solo interfaz/enums/PDFs) -- ver claves nuevas en
// common.json (validacion.*), namespace compartido ya usado para textos genéricos de la topbar.
//
// `target` es el elemento del DOM que disparó el evento invalid (o cualquier objeto con la misma
// forma de `validity`/atributos, para poder testear sin montar un <input> real).
export function mensajeValidacionNativa(target, t) {
  const v = target.validity
  if (!v || v.valid) return ''
  if (v.valueMissing) return t('common:validacion.obligatorio')
  if (v.rangeUnderflow) return t('common:validacion.minimo', { min: target.min })
  if (v.rangeOverflow) return t('common:validacion.maximo', { max: target.max })
  if (v.stepMismatch) return t('common:validacion.paso_invalido')
  if (v.tooShort) return t('common:validacion.longitud_minima', { min: target.minLength })
  if (v.tooLong) return t('common:validacion.longitud_maxima', { max: target.maxLength })
  if (v.patternMismatch) return t('common:validacion.formato_invalido')
  if (v.typeMismatch || v.badInput) return t('common:validacion.tipo_invalido')
  return target.validationMessage
}
