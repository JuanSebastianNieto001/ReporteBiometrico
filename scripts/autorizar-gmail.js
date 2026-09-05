'use strict';
// Autoriza el envío por Gmail con OAuth2. Es la alternativa a la "contraseña de aplicación" cuando Google
// no permite crearla (no requiere verificación en 2 pasos).
//
// Pasos previos (una sola vez, con la cuenta tucuenta@tudominio.com):
//   1. https://console.cloud.google.com/  -> crear un proyecto (ej. "Reporte Biometrico")
//   2. APIs y servicios > Biblioteca > buscar "Gmail API" > Habilitar
//   3. APIs y servicios > Pantalla de consentimiento de OAuth > Tipo de usuario: Interno > Crear (nombre y correo de contacto)
//   4. APIs y servicios > Credenciales > Crear credenciales > ID de cliente de OAuth > Tipo: "Aplicación de escritorio"
//   5. Descargar el JSON del cliente y guardarlo en la carpeta del proyecto como  gmail-oauth-cliente.json
//   6. node scripts/autorizar-gmail.js  -> abre el navegador; inicia sesión con tucuenta@tudominio.com y acepta
//
// Resultado: gmail-oauth-token.json (con el refresh token). Desde ese momento src/correo.js usa OAuth2
// automáticamente y ya no hace falta GMAIL_CLAVE_APP. Ambos archivos están en .gitignore.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });
const rutaCliente = path.join(RAIZ, 'gmail-oauth-cliente.json');
const rutaToken = path.join(RAIZ, 'gmail-oauth-token.json');

if (!fs.existsSync(rutaCliente)) {
  console.error(`Falta ${rutaCliente}\nDescarga el JSON del "ID de cliente de OAuth" (tipo Aplicación de escritorio) desde Google Cloud Console y guárdalo con ese nombre.`);
  process.exit(1);
}
const cliente = JSON.parse(fs.readFileSync(rutaCliente, 'utf8'));
const c = cliente.installed || cliente.web;
if (!c || !c.client_id || !c.client_secret) { console.error('El JSON del cliente no tiene client_id / client_secret.'); process.exit(1); }

const PUERTO = 53682;
const redirect = `http://127.0.0.1:${PUERTO}/`;
const params = new URLSearchParams({
  client_id: c.client_id,
  redirect_uri: redirect,
  response_type: 'code',
  scope: 'https://mail.google.com/',
  access_type: 'offline',
  prompt: 'consent',
  login_hint: process.env.GMAIL_USUARIO || '',
});
const urlAuth = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Autorización rechazada: ${error || 'sin código'}</h2>`);
    console.error('Autorización rechazada:', error || 'sin código');
    setTimeout(() => process.exit(1), 500);
    return;
  }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const tok = await r.json();
    if (!tok.refresh_token) throw new Error(`Google no devolvió refresh_token: ${JSON.stringify(tok).slice(0, 300)}`);
    fs.writeFileSync(rutaToken, JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: tok.refresh_token, cuenta: process.env.GMAIL_USUARIO || '', obtenido: new Date().toISOString() }, null, 2));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Listo: Gmail autorizado para el reporte biométrico. Puedes cerrar esta pestaña.</h2>');
    console.log(`Token guardado en ${rutaToken}. Prueba con: node scripts/probar-correo.js`);
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Error: ${e.message}</h2>`);
    console.error('Error:', e.message);
    setTimeout(() => process.exit(1), 500);
  }
});

server.listen(PUERTO, '127.0.0.1', () => {
  console.log('Se abrirá el navegador para autorizar. Si no se abre, copia esta URL:\n' + urlAuth + '\n');
  execFile('cmd.exe', ['/c', 'start', '', urlAuth], () => {});
});
