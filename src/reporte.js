'use strict';
// Lógica pura del reporte: hora de entrada del día y cálculo de llegadas tarde.
// Regla (según el procedimiento):
//  - Se toma la hora de entrada del día. Quien marque ANTES de esa hora está OK.
//  - Quien marque a la hora de entrada o después (>=) llegó tarde.
//  - Si una persona aparece varias veces, se toma su PRIMERA marcación del día:
//    si esa primera marcación fue temprano, no se reporta (salió y volvió a entrar).

const { aISO, claveDia, horaASegundos, normalizarHoraEntrada } = require('./fechas');

// Cada día puede tener varias horas de entrada (un reporte por cada una): en config.json el valor
// de horarioHabitual / excepcionesPorFecha puede ser "08:00" o ["08:00", "09:00", "10:00"].
function listaHoras(valor) {
  const lista = Array.isArray(valor) ? valor : (valor ? [valor] : []);
  return [...new Set(lista.map(normalizarHoraEntrada).filter(Boolean))].sort();
}

function horasEntradaDelDia(fecha, config) {
  const iso = aISO(fecha);
  const excepciones = config.excepcionesPorFecha || {};
  if (excepciones[iso]) return { horas: listaHoras(excepciones[iso]), origen: `excepción configurada para el ${iso}` };
  const dia = claveDia(fecha);
  const horas = listaHoras((config.horarioHabitual || {})[dia]);
  if (horas.length) return { horas, origen: `horario habitual (${dia})` };
  return { horas: [], origen: `no hay horario habitual configurado para el día ${dia}` };
}

// Hora a usar cuando no se indica --hora (la tarea programada siempre la indica). Si el día tiene
// varias, se toma la última cuyo reporte ya tocaba (hora + minutosDespues <= ahora); si ninguna, la primera.
function horaEntradaHabitual(fecha, config, ahora = new Date()) {
  const { horas, origen } = horasEntradaDelDia(fecha, config);
  if (!horas.length) return { hora: null, origen, horas };
  if (horas.length === 1 || aISO(ahora) !== aISO(fecha)) return { hora: horas[0], origen, horas };
  const minutos = (config.programacion && config.programacion.minutosDespuesDeEntrada) || 45;
  const ahoraSeg = ahora.getHours() * 3600 + ahora.getMinutes() * 60;
  const vencidas = horas.filter(h => horaASegundos(h) + minutos * 60 <= ahoraSeg);
  const hora = vencidas.length ? vencidas[vencidas.length - 1] : horas[0];
  return { hora, origen: `${origen}, una de ${horas.join(' / ')} según la hora actual`, horas };
}

// Clave para agrupar: mayúsculas, sin espacios dobles, sin acentos.
function claveNombre(nombre) {
  return String(nombre)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

// registros: [{ nombre, departamento, fecha:'YYYY-MM-DD', hora:'HH:MM:SS' }]
// Devuelve una fila por persona con su primera y última marcación del día indicado.
function agruparPorPersona(registros, fechaISO) {
  const mapa = new Map();
  for (const r of registros) {
    if (fechaISO && r.fecha && r.fecha !== fechaISO) continue;
    const seg = horaASegundos(r.hora);
    if (seg == null || !r.nombre) continue;
    const clave = claveNombre(r.nombre);
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        nombre: String(r.nombre).replace(/\s+/g, ' ').trim(),
        departamento: r.departamento || '',
        marcaciones: [],
      });
    }
    mapa.get(clave).marcaciones.push(seg);
  }
  const personas = [];
  for (const p of mapa.values()) {
    p.marcaciones.sort((a, b) => a - b);
    p.primeraSeg = p.marcaciones[0];
    p.ultimaSeg = p.marcaciones[p.marcaciones.length - 1];
    personas.push(p);
  }
  // Orden: de la marcación más tardía a la más temprana (igual que el correo de ejemplo).
  personas.sort((a, b) => b.primeraSeg - a.primeraSeg);
  return personas;
}

// Turno (franja) al que pertenece una persona según su PRIMERA marcación, cuando el día tiene varias
// horas de entrada. Quien marca en los `margenMin` minutos previos a una hora es de ese turno; quien
// marca antes es del turno anterior. Con 8:00/9:00/10:00 y 10 min:
//   hasta 8:49 -> 8:00 (tarde desde 8:00) | 8:50-9:49 -> 9:00 (tarde desde 9:00) | 9:50 en adelante -> 10:00
// Así nadie sale en dos reportes y quien entra a las 9:00 no sale tarde en el de las 8:00.
// Límite conocido: uno del turno 8:00 que marque a las 8:55 cuenta como del turno 9:00 a tiempo.
function turnoDe(primeraSeg, horas, margenMin) {
  let turno = horas[0];
  for (const h of horas.slice(1)) if (primeraSeg >= horaASegundos(h) - margenMin * 60) turno = h;
  return turno;
}

// Devuelve las personas cuya PRIMERA marcación fue >= hora de entrada.
// turnos: { horas: [...horas de entrada del día], margenMin } -> solo cuenta a las personas de ese turno.
function calcularLlegadasTarde(personas, horaEntrada, excluidos = [], turnos = null) {
  const h = normalizarHoraEntrada(horaEntrada);
  const segEntrada = horaASegundos(h);
  if (segEntrada == null) throw new Error(`Hora de entrada inválida: "${horaEntrada}"`);
  const setExcluidos = new Set(excluidos.map(claveNombre));
  const horas = turnos && turnos.horas && turnos.horas.length > 1 ? turnos.horas : null;
  return personas
    .filter(p => p.primeraSeg >= segEntrada)
    .filter(p => !horas || turnoDe(p.primeraSeg, horas, turnos.margenMin) === h)
    .filter(p => !setExcluidos.has(claveNombre(p.nombre)))
    .sort((a, b) => b.primeraSeg - a.primeraSeg);
}

module.exports = { horaEntradaHabitual, horasEntradaDelDia, turnoDe, agruparPorPersona, calcularLlegadasTarde, claveNombre };
