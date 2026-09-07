-- CONTRATO_MULTITENANT.md, Tarea 3: empresa_config tenia PRIMARY KEY (id) con id integer
-- default 1 y una constraint solo_una_fila CHECK (id = 1) -- el mecanismo real que imponia
-- "una sola fila para toda la aplicacion", sin importar el negocio. Con un segundo negocio,
-- ningun INSERT de configuracion podria existir jamas: la propia constraint lo bloquea.
--
-- Se movio la PK directamente a negocio_id (no se añadio UNIQUE(negocio_id) manteniendo id)
-- porque mantener id como PK exigiria ademas cambiar su DEFAULT de 1 a un identity
-- autoincremental -- si no, el INSERT de cualquier segundo negocio tambien intentaria id=1 por
-- defecto y chocaria con la fila de negocio A en la propia PK, antes de llegar siquiera a
-- comprobar negocio_id. Con solo 1 fila real hoy y una relacion 1:1 negocio<->config,
-- negocio_id ya es una clave natural -- no hace falta ningun sustituto artificial.
--
-- Confirmado antes de este cambio (no asumido): 0 triggers y 0 funciones en toda la base de
-- datos escriben en empresa_config fuera del CRUD normal del frontend. La RLS de esta tabla ya
-- usaba negocio_actual() correctamente desde antes de la Tarea 2 -- no era una excepcion como
-- facturas_venta_secuencia o negocios.
--
-- Dependencia real de frontend en id=1, confirmada por grep, no asumida: 4 sitios
-- (generarAlbaranVentaPdf.js, generarPdf.js, Configuracion.jsx x2) con .eq('id', 1) hardcodeado
-- -- corregidos en el mismo commit que esta migracion, quitando el filtro (la RLS ya garantiza
-- que solo es visible la fila del negocio de la sesion actual, y la nueva PK garantiza que solo
-- hay una).
alter table empresa_config drop constraint solo_una_fila;
alter table empresa_config drop constraint empresa_config_pkey;
alter table empresa_config drop column id;
alter table empresa_config add primary key (negocio_id);
