'use strict';
// Lógica pura del reporte: hora de entrada del día y cálculo de llegadas tarde.
// Regla (según el procedimiento):
//  - Se toma la hora de entrada del día. Quien marque ANTES de esa hora está OK.
//  - Quien marque a la hora de entrada o después (>=) llegó tarde.
//  - Si una persona aparece varias veces, se toma su PRIMERA marcación del día:
//    si esa primera marcación fue temprano, no se reporta (salió y volvió a entrar).

const { aISO, claveDia, horaASegundos, normalizarHoraEntrada } = require('./fechas');

function horaEntradaHabitual(fecha, config) {
  const iso = aISO(fecha);
  const excepciones = config.excepcionesPorFecha || {};
  if (excepciones[iso]) {
    return { hora: normalizarHoraEntrada(excepciones[iso]), origen: `excepción configurada para el ${iso}` };
  }
  const dia = claveDia(fecha);
  const habitual = (config.horarioHabitual || {})[dia];
  if (habitual) {
    return { hora: normalizarHoraEntrada(habitual), origen: `horario habitual (${dia})` };
  }
  return { hora: null, origen: `no hay horario habitual configurado para el día ${dia}` };
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

// Devuelve las personas cuya PRIMERA marcación fue >= hora de entrada.
function calcularLlegadasTarde(personas, horaEntrada, excluidos = []) {
  const segEntrada = horaASegundos(horaEntrada);
  if (segEntrada == null) throw new Error(`Hora de entrada inválida: "${horaEntrada}"`);
  const setExcluidos = new Set(excluidos.map(claveNombre));
  return personas
    .filter(p => p.primeraSeg >= segEntrada)
    .filter(p => !setExcluidos.has(claveNombre(p.nombre)))
    .sort((a, b) => b.primeraSeg - a.primeraSeg);
}

module.exports = { horaEntradaHabitual, agruparPorPersona, calcularLlegadasTarde, claveNombre };
