'use strict';
// Construcción y envío del correo por Gmail: SMTP con contraseña de aplicación (GMAIL_CLAVE_APP en .env)
// o, si existe gmail-oauth-token.json (generado por scripts/autorizar-gmail.js), OAuth2.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { fechaCorreo, segundosAHora } = require('./fechas');

function escaparHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// tardes: [{ nombre, primeraSeg }]
function construirCorreo({ fecha, tardes, config }) {
  const c = config.correo;
  const asunto = (c.asunto || 'Reporte Biométrico - {fecha}').replace('{fecha}', fechaCorreo(fecha));
  const saludo = c.saludo || 'Buen día,\n\nSe envía reporte de biometría.';
  const filas = tardes.map(p => ({ nombre: p.nombre, hora: segundosAHora(p.primeraSeg, { ceroInicial: false }) }));

  const lineas = filas.length
    ? filas.map(f => `${f.nombre}\t${f.hora}`).join('\n')
    : (c.sinLlegadasTarde || 'No se registran llegadas tarde para el día de hoy.');

  const texto = [saludo, '', lineas, c.despedida ? `\n${c.despedida}` : ''].join('\n').trimEnd() + '\n';

  const tabla = filas.length
    ? `<table cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
${filas.map(f => `  <tr><td style="padding:2px 40px 2px 0">${escaparHtml(f.nombre)}</td><td style="padding:2px 0">${f.hora}</td></tr>`).join('\n')}
</table>`
    : `<p>${escaparHtml(c.sinLlegadasTarde || 'No se registran llegadas tarde para el día de hoy.')}</p>`;

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
${saludo.split('\n').map(l => (l.trim() ? `<p style="margin:0 0 4px">${escaparHtml(l)}</p>` : '<br>')).join('\n')}
<br>
${tabla}
${c.despedida ? `<br><p>${escaparHtml(c.despedida)}</p>` : ''}
${c.firmaHtml ? `<br>${c.firmaHtml}` : ''}
</div>`;

  return { asunto, texto, html, filas };
}

function crearTransporte(config) {
  const { usuario, clave } = config.credenciales.gmail;
  if (!usuario) throw new Error('Falta GMAIL_USUARIO en el archivo .env');
  const rutaToken = path.join(config.rutas.raiz, 'gmail-oauth-token.json');
  if (fs.existsSync(rutaToken)) {
    const t = JSON.parse(fs.readFileSync(rutaToken, 'utf8'));
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { type: 'OAuth2', user: usuario, clientId: t.client_id, clientSecret: t.client_secret, refreshToken: t.refresh_token },
    });
  }
  if (!clave) {
    throw new Error('Falta GMAIL_CLAVE_APP en .env (contraseña de aplicación de Google) o la autorización OAuth (node scripts/autorizar-gmail.js).');
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: usuario, pass: clave },
  });
}

async function enviarCorreo({ para, cc = [], asunto, texto, html, adjuntos = [], config }) {
  if (!para || !para.length) throw new Error('No hay destinatarios para el correo.');
  const transporte = crearTransporte(config);
  const remitente = config.credenciales.gmail.usuario;
  const nombre = config.correo.nombreRemitente || remitente;
  const info = await transporte.sendMail({
    from: `"${nombre}" <${remitente}>`,
    to: para.join(', '),
    cc: cc.length ? cc.join(', ') : undefined,
    subject: asunto,
    text: texto,
    html,
    attachments: (adjuntos || []).filter(Boolean).map(p => ({ path: p })),
  });
  return { messageId: info.messageId, aceptados: info.accepted, rechazados: info.rejected };
}

async function verificarConexion(config) {
  const transporte = crearTransporte(config);
  await transporte.verify();
  return true;
}

module.exports = { construirCorreo, enviarCorreo, verificarConexion };
