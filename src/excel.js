'use strict';
// Lee el Excel exportado por HikCentral ("Búsqueda de acceso de persona_...xlsx").
// El archivo trae 7 filas de información básica, luego el encabezado
// (Nombre | Departamento | Hora) y después los registros. La fila de encabezado se
// busca automáticamente, así que también funciona si ya le borraron las filas 1-7.

const ExcelJS = require('exceljs');

function texto(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('').trim();
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    return '';
  }
  return String(v).trim();
}

// Acepta Date (exceljs entrega fechas en UTC) o textos "2026-09-03 09:08:38" / "03/09/2026 9:08:38".
function separarFechaHora(v) {
  if (v instanceof Date) {
    const f = `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
    const h = `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}:${String(v.getUTCSeconds()).padStart(2, '0')}`;
    return { fecha: f, hora: h };
  }
  const t = texto(v);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return { fecha: `${m[1]}-${m[2]}-${m[3]}`, hora: `${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}` };
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return { fecha: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, hora: `${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}` };
  m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return { fecha: null, hora: `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}` };
  return null;
}

async function leerRegistros(ruta) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`El archivo ${ruta} no tiene hojas`);

  let filaEncabezado = null;
  const col = {};
  ws.eachRow((row, n) => {
    if (filaEncabezado) return;
    const valores = row.values.map(v => texto(v).toLowerCase());
    if (valores.some(v => v === 'nombre') && valores.some(v => v.startsWith('hora'))) {
      filaEncabezado = n;
      valores.forEach((v, idx) => { if (v) col[v] = idx; });
    }
  });
  if (!filaEncabezado) {
    throw new Error(`No se encontró la fila de encabezado (Nombre / Departamento / Hora) en ${ruta}`);
  }
  const cNombre = col['nombre'];
  const cDep = col['departamento'];
  const cHora = Object.keys(col).find(k => k.startsWith('hora')) ? col[Object.keys(col).find(k => k.startsWith('hora'))] : null;

  const registros = [];
  ws.eachRow((row, n) => {
    if (n <= filaEncabezado) return;
    const nombre = texto(row.getCell(cNombre).value);
    const fh = separarFechaHora(row.getCell(cHora).value);
    if (!nombre || !fh) return;
    registros.push({
      nombre,
      departamento: cDep ? texto(row.getCell(cDep).value) : '',
      fecha: fh.fecha,
      hora: fh.hora,
    });
  });
  return registros;
}

module.exports = { leerRegistros, separarFechaHora };
