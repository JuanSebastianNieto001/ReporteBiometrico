'use strict';
// Genera ejemplos/Busqueda_de_acceso_de_persona_ejemplo.xlsx con el MISMO formato que exporta HikCentral
// (7 filas de información básica, encabezado en la fila 8 y luego los registros).
// Los NOMBRES son FICTICIOS (datos de ejemplo). La fecha es 2026-09-03 y la hora de entrada de prueba es 09:00.
// Casos incluidos: una persona con dos marcaciones seguidas, y una persona que marcó temprano y volvió a
// marcar después (para probar que NO se reporta como tarde).
const path = require('path');
const ExcelJS = require('exceljs');

const DEP = 'All Departments > Personal Ejemplo';

const registros = [
  ['EMPLEADO EJEMPLO 01', DEP + ' > Formación', '2026-09-03 09:08:38'],
  ['EMPLEADO EJEMPLO 02', DEP + ' > Asesores', '2026-09-03 09:08:34'],
  ['EMPLEADO DUPLICADO EJEMPLO', DEP + ' > Formación', '2026-09-03 09:07:45'],
  ['EMPLEADO DUPLICADO EJEMPLO', DEP + ' > Formación', '2026-09-03 09:07:41'],
  ['EMPLEADO EJEMPLO 03', DEP, '2026-09-03 09:07:02'],
  ['EMPLEADO EJEMPLO 04', DEP + ' > Asesores', '2026-09-03 09:06:26'],
  ['EMPLEADO EJEMPLO 05', DEP + ' > Formación', '2026-09-03 09:04:35'],
  ['EMPLEADO EJEMPLO 06', DEP + ' > Formación', '2026-09-03 09:04:08'],
  ['EMPLEADO EJEMPLO 07', DEP + ' > Asesores', '2026-09-03 09:02:59'],
  ['EMPLEADO EJEMPLO 08', DEP + ' > Formación', '2026-09-03 09:01:56'],
  ['EMPLEADO EJEMPLO 09', DEP + ' > Asesores', '2026-09-03 09:00:32'],
  ['EMPLEADO EJEMPLO 10', DEP + ' > Asesores', '2026-09-03 09:00:15'],
  ['EMPLEADO TEMPRANO EJEMPLO', DEP + ' > Estructura', '2026-09-03 09:00:11'],
  ['EMPLEADO EJEMPLO 11', DEP + ' > Formación', '2026-09-03 08:59:31'],
  ['EMPLEADO EJEMPLO 12', DEP + ' > Asesores', '2026-09-03 08:59:28'],
  ['EMPLEADO EJEMPLO 13', DEP + ' > Formación', '2026-09-03 08:59:06'],
  ['EMPLEADO EJEMPLO 14', DEP + ' > Formación', '2026-09-03 08:58:53'],
  ['EMPLEADO EJEMPLO 15', DEP + ' > Estructura', '2026-09-03 08:58:51'],
  ['EMPLEADO EJEMPLO 16', DEP + ' > Formación', '2026-09-03 08:58:50'],
  ['EMPLEADO EJEMPLO 17', DEP + ' > Formación', '2026-09-03 08:58:30'],
  ['EMPLEADO EJEMPLO 18', DEP + ' > Asesores', '2026-09-03 08:58:00'],
  ['EMPLEADO EJEMPLO 19', DEP + ' > Asesores', '2026-09-03 08:58:00'],
  ['EMPLEADO EJEMPLO 20', DEP + ' > Asesores', '2026-09-03 08:57:54'],
  ['EMPLEADO EJEMPLO 21', DEP + ' > Asesores', '2026-09-03 08:57:53'],
  ['EMPLEADO EJEMPLO 22', DEP + ' > Asesores', '2026-09-03 08:57:33'],
  ['EMPLEADO EJEMPLO 23', DEP + ' > Asesores', '2026-09-03 08:57:12'],
  ['EMPLEADO EJEMPLO 24', DEP + ' > Asesores', '2026-09-03 08:57:05'],
  ['EMPLEADO EJEMPLO 25', DEP + ' > Asesores', '2026-09-03 08:57:02'],
  ['EMPLEADO EJEMPLO 26', DEP + ' > Asesores', '2026-09-03 08:56:59'],
  ['EMPLEADO EJEMPLO 27', DEP + ' > Formación', '2026-09-03 08:56:29'],
  ['EMPLEADO EJEMPLO 28', DEP + ' > Formación', '2026-09-03 08:56:07'],
  ['EMPLEADO EJEMPLO 29', DEP + ' > Asesores', '2026-09-03 08:55:10'],
  ['EMPLEADO EJEMPLO 30', DEP + ' > Formación', '2026-09-03 08:55:08'],
  ['EMPLEADO EJEMPLO 31', DEP + ' > Estructura', '2026-09-03 08:55:03'],
  // Caso: llegó temprano, salió y volvió a marcar después de la hora -> NO va en el reporte de tarde
  ['EMPLEADO TEMPRANO EJEMPLO', DEP + ' > Estructura', '2026-09-03 07:52:10'],
];

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Búsqueda de acceso de persona_20260903093453']);
  ws.addRow(['Información básica']);
  ws.addRow(['Hora del informe:2026-09-03 09:34:53']);
  ws.addRow(['Operador:admin']);
  ws.addRow(['Exportar contenido:Nombre,Departamento,Hora']);
  ws.addRow(['Hora del informe:2026-09-03 00:00:00-2026-09-03 23:59:59']);
  ws.addRow([]);
  ws.addRow(['Nombre', 'Departamento', 'Hora']);
  for (const r of registros) ws.addRow(r);
  const salida = path.join(__dirname, '..', 'ejemplos', 'Busqueda_de_acceso_de_persona_ejemplo.xlsx');
  await wb.xlsx.writeFile(salida);
  console.log('Creado', salida, 'con', registros.length, 'registros (nombres ficticios)');
})();
