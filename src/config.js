'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });

const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));

config.rutas = {
  raiz: RAIZ,
  descargas: path.join(RAIZ, 'descargas'),
  logs: path.join(RAIZ, 'logs'),
  capturas: path.join(RAIZ, 'logs', 'capturas'),
};
for (const r of Object.values(config.rutas)) fs.mkdirSync(r, { recursive: true });

config.credenciales = {
  biometrica: { usuario: process.env.BIO_USUARIO || '', clave: process.env.BIO_CLAVE || '' },
  gmail: {
    usuario: process.env.GMAIL_USUARIO || '',
    clave: (process.env.GMAIL_CLAVE_APP || '').replace(/\s+/g, ''),
    webUsuario: process.env.GMAIL_WEB_USER || process.env.GMAIL_USUARIO || '',
    webClave: process.env.GMAIL_WEB_PASS || '',
  },
};

module.exports = config;
