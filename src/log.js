'use strict';
const fs = require('fs');
const path = require('path');

let archivo = null;

function iniciar(dirLogs) {
  fs.mkdirSync(dirLogs, { recursive: true });
  const d = new Date();
  const nombre = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.log`;
  archivo = path.join(dirLogs, nombre);
  return archivo;
}

function marca() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function log(...partes) {
  const linea = `[${marca()}] ${partes.map(p => (p instanceof Error ? (p.stack || p.message) : typeof p === 'object' ? JSON.stringify(p) : String(p))).join(' ')}`;
  console.log(linea);
  if (archivo) { try { fs.appendFileSync(archivo, linea + '\n'); } catch (_) { /* ignorar */ } }
}

module.exports = { iniciar, log };
