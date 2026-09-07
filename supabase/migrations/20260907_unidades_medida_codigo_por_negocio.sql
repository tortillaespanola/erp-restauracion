-- CONTRATO_MULTITENANT.md, hallazgo Tarea 7-bis: unidades_medida tenia UNIQUE(codigo) global,
-- no (negocio_id, codigo) -- mismo patron que secuencias_lote (Tarea 7) y la vieja PK de
-- facturas_venta_secuencia (Tarea 4), pero aqui la PK en si (id) ya estaba bien -- el problema
-- era una constraint UNIQUE adicional sobre un codigo de texto elegido por el negocio ('kg',
-- 'l', 'ud'), que todo negocio nuevo quiere reutilizar por diseño. Detectado en la practica al
-- intentar poblar el negocio demo "Demo Catering Basel": el primer INSERT de sus propias
-- unidades ('kg','l','ud') fallo contra las de negocio A.
alter table unidades_medida drop constraint unidades_medida_codigo_key;
alter table unidades_medida add constraint unidades_medida_negocio_id_codigo_key unique (negocio_id, codigo);
