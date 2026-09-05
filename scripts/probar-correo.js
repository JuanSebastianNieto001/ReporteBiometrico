'use strict';
// Envía un correo de PRUEBA (marcado como tal en el asunto) a los destinatarios de config.json,
// usando los datos del Excel de ejemplo. Sirve para comprobar la contraseña de aplicación de Gmail
// sin tener que pasar por la biométrica ni por la página de confirmación.
//   node scripts/probar-correo.js                      -> a los destinatarios de config.json
//   node scripts/probar-correo.js alguien@correo.com   -> a ese correo
const path = require('path');
const config = require('../src/config');
const { leerRegistros } = require('../src/excel');
const { agruparPorPersona, calcularLlegadasTarde } = require('../src/reporte');
const { construirCorreo, enviarCorreo, verificarConexion } = require('../src/correo');

(async () => {
  const para = process.argv[2] ? [process.argv[2]] : (config.correo.destinatarios || []);
  if (!para.length) throw new Error('No hay destinatarios: pásalo como parámetro o configúralo en config.json');

  console.log(`Verificando acceso SMTP a Gmail como ${config.credenciales.gmail.usuario}...`);
  await verificarConexion(config);
  console.log('Conexión SMTP correcta.');

  const ejemplo = path.join(__dirname, '..', 'ejemplos', 'Busqueda_de_acceso_de_persona_ejemplo.xlsx');
  const registros = await leerRegistros(ejemplo);
  const personas = agruparPorPersona(registros, '2026-09-03');
  const tardes = calcularLlegadasTarde(personas, '09:00');
  const fecha = new Date(2026, 8, 3);
  const correo = construirCorreo({ fecha, tardes, config });
  correo.asunto = `[PRUEBA] ${correo.asunto}`;
  correo.texto = `*** Correo de prueba de la automatización. Datos de ejemplo del 3/09/2026 con hora de entrada 09:00. ***\n\n${correo.texto}`;
  correo.html = `<p style="color:#b00"><b>*** Correo de prueba de la automatización. Datos de ejemplo del 3/09/2026 con hora de entrada 09:00. ***</b></p>${correo.html}`;

  console.log(`Enviando "${correo.asunto}" a ${para.join(', ')} (${tardes.length} llegadas tarde de ejemplo)...`);
  const r = await enviarCorreo({ para, asunto: correo.asunto, texto: correo.texto, html: correo.html, config });
  console.log('Enviado. id:', r.messageId, 'aceptados:', r.aceptados);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
