'use strict';
// Utilidades de fecha/hora. Todo se trabaja en hora local del equipo (Colombia, UTC-5).

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const DIAS_BONITO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function aISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function desdeISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function claveDia(d) { return DIAS[d.getDay()]; }
function nombreDia(d) { return DIAS_BONITO[d.getDay()]; }

// Formato usado en el asunto del correo, igual al ejemplo del procedimiento: 3/09/2026
function fechaCorreo(d) {
  return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function fechaLarga(d) {
  return `${nombreDia(d)} ${d.getDate()} de ${['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][d.getMonth()]} de ${d.getFullYear()}`;
}

// "8", "8:00", "08:00", "8:05:30" -> segundos desde medianoche. null si no es válida.
function horaASegundos(texto) {
  if (texto == null) return null;
  const m = String(texto).trim().match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] || 0), s = Number(m[3] || 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}

function segundosAHora(seg, { conSegundos = true, ceroInicial = true } = {}) {
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  const hh = ceroInicial ? String(h).padStart(2, '0') : String(h);
  const base = `${hh}:${String(m).padStart(2, '0')}`;
  return conSegundos ? `${base}:${String(s).padStart(2, '0')}` : base;
}

// Normaliza cualquier hora de entrada a "HH:MM" (o null si es inválida).
function normalizarHoraEntrada(texto) {
  const seg = horaASegundos(texto);
  if (seg == null) return null;
  return segundosAHora(seg, { conSegundos: false });
}

function marcaTiempoArchivo(d = new Date()) {
  return `${aISO(d)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

module.exports = {
  DIAS, DIAS_BONITO, aISO, desdeISO, claveDia, nombreDia, fechaCorreo, fechaLarga,
  horaASegundos, segundosAHora, normalizarHoraEntrada, marcaTiempoArchivo,
};
