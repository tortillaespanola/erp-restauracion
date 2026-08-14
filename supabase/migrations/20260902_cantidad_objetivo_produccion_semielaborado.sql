-- Cantidad objetivo con la que se inició una producción de semielaborado -- antes solo vivía en
-- memoria del formulario "Iniciar nueva producción" (cantidadPlan) y se perdía en cuanto se pulsaba
-- "Iniciar". Se persiste para poder mostrarla y ajustarla en la tarjeta de "Producción en curso"
-- (CONTRATO_VISTA_DINAMICA_PRODUCCION.md, addenda "Cantidad objetivo y estimación en Producción en
-- curso"). Es un valor de referencia/planificación -- no afecta a cantidad_producida ni al registro
-- de consumos, por eso no lleva CHECK de positividad a nivel de base de datos: mismo criterio que
-- cantidad_producida, que tampoco lo tiene aquí (la validación de "> 0" vive en el frontend).
alter table producciones_semielaborado add column cantidad_objetivo numeric;
