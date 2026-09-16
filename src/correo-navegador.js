'use strict';
// Envío del correo manejando la interfaz web de Gmail con Playwright (Chrome real).
// Se usa porque la cuenta tucuenta@tudominio.com no puede enviar por SMTP (Gmail rechaza la contraseña y no
// hay contraseña de aplicación). Reutiliza un perfil de navegador persistente y dedicado en .perfil-gmail/
// para no repetir el inicio de sesión (ni la alerta de seguridad de Google) en cada ejecución.
//
// Requiere en .env:  GMAIL_WEB_USER (por defecto GMAIL_USUARIO)  y  GMAIL_WEB_PASS (contraseña de la cuenta).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { marcaTiempoArchivo } = require('./fechas');

const RE_INBOX = /mail\.google\.com\/mail\/u\/\d+/;
const SEL_COMPOSE = 'div[gh="cm"], div[role="button"]:has-text("Redactar"), div[role="button"]:has-text("Compose")';
const SEL_EMAIL = '#identifierId, input[name="identifier"], input[autocomplete="username"], input[type="email"]';

// Espera hasta que se defina el estado de Gmail: 'bandeja' (aparece Redactar) o 'login' (aparece el campo de correo).
async function esperarBandejaOLogin(page, maxSeg = 25) {
  const compose = page.locator(SEL_COMPOSE).first();
  const email = page.locator(SEL_EMAIL).first();
  for (let i = 0; i < maxSeg; i++) {
    if (await compose.isVisible().catch(() => false)) return 'bandeja';
    if (await email.isVisible().catch(() => false)) return 'login';
    await page.waitForTimeout(1000);
  }
  return 'desconocido';
}

async function cerrarPopups(page) {
  // "Pausa las notificaciones móviles..." u otros diálogos no críticos.
  const botones = ['No, gracias', 'No thanks', 'Descartar', 'Omitir', 'Ahora no'];
  for (const nombre of botones) {
    const b = page.getByRole('button', { name: new RegExp(`^\\s*${nombre}\\s*$`, 'i') }).first();
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
  }
}

async function textoCuerpo(page, max = 400) {
  return (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, max);
}

async function iniciarSesionSiHaceFalta(page, usuario, clave, log, captura) {
  // URL de inicio de sesión directa: si hay sesión redirige a la bandeja; si no, muestra el formulario
  // (evita la página promocional de gmail.com que aparece al ir a mail.google.com sin sesión).
  const urlLogin = 'https://accounts.google.com/ServiceLogin?service=mail&passive=true&continue=' + encodeURIComponent('https://mail.google.com/mail/u/0/#inbox');
  await page.goto(urlLogin, { waitUntil: 'domcontentloaded' });
  let estado = await esperarBandejaOLogin(page);
  if (estado === 'bandeja') { log('  Sesión de Gmail ya activa (perfil persistente).'); return; }

  if (estado === 'desconocido') {
    await captura('gmail_00_estado_desconocido');
    // Página promocional ("Acceder") o selector de cuenta: intentar avanzar hacia el login.
    const acceder = page.getByRole('link', { name: /Acceder|Iniciar sesión|Sign in/i }).or(page.getByRole('button', { name: /Acceder|Iniciar sesión|Sign in/i })).first();
    const tile = page.locator(`[data-identifier="${usuario}"]`).first();
    if (await tile.isVisible().catch(() => false)) { await tile.click().catch(() => {}); }
    else if (await acceder.isVisible().catch(() => false)) { await acceder.click().catch(() => {}); }
    else { await page.goto(urlLogin, { waitUntil: 'domcontentloaded' }); }
    estado = await esperarBandejaOLogin(page);
    if (estado === 'bandeja') { log('  Sesión de Gmail ya activa.'); return; }
  }

  log('  Iniciando sesión en Gmail...');
  // Puede aparecer un mosaico con la cuenta ya conocida (sin campo de correo): se hace clic en él.
  const tileCuenta = page.locator(`[data-identifier="${usuario}"]`).first();
  const email = page.locator(SEL_EMAIL).first();
  if (!(await email.isVisible().catch(() => false)) && await tileCuenta.isVisible().catch(() => false)) {
    await tileCuenta.click();
    await page.waitForTimeout(3000);
  } else {
    await email.waitFor({ state: 'visible', timeout: 30000 });
    await email.click(); await email.fill(usuario);
    await captura('gmail_01_email');
    await page.getByRole('button', { name: /^Siguiente$|^Next$/ }).first().click();
    await page.waitForTimeout(3500);
  }

  const pass = page.locator('input[name="Passwd"], input[type="password"]:not([aria-hidden="true"])').first();
  await pass.waitFor({ state: 'visible', timeout: 30000 });
  await pass.click(); await pass.fill(clave);
  await captura('gmail_02_pass');
  await page.getByRole('button', { name: /^Siguiente$|^Next$/ }).first().click();
  await page.waitForTimeout(5000);
  await captura('gmail_03_postlogin');

  for (let i = 0; i < 6; i++) {
    if (await page.locator(SEL_COMPOSE).first().isVisible().catch(() => false)) return;
    const cuerpo = await textoCuerpo(page, 500);
    if (/no sean seguros|no es seguro|browser or app may not be secure/i.test(cuerpo)) {
      await captura('gmail_90_navegador_no_seguro');
      throw new Error('Google bloqueó el inicio de sesión por navegador automatizado ("este navegador o app puede que no sean seguros").');
    }
    if (/Verifica que eres tú|Verify it.?s you|Protege tu cuenta|Confirma que/i.test(cuerpo)) {
      const btn = page.getByRole('button', { name: /No, gracias|Omitir|Continuar|Confirmar|Listo/i }).first();
      if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); await page.waitForTimeout(3000); continue; }
      await captura('gmail_91_desafio');
      throw new Error('Google pidió una verificación adicional ("Verifica que eres tú") que no se puede resolver automáticamente. Inicia sesión una vez a mano en el perfil .perfil-gmail para dejar la sesión guardada. Detalle: ' + cuerpo.slice(0, 200));
    }
    await page.waitForTimeout(3000);
  }
  if (!(await page.locator(SEL_COMPOSE).first().isVisible().catch(() => false)) && !RE_INBOX.test(page.url())) {
    await captura('gmail_92_no_inbox');
    throw new Error('No se llegó a la bandeja de Gmail. URL: ' + page.url());
  }
}

async function verificarCuenta(page, usuarioEsperado, log) {
  const html = await page.content();
  const correos = [...new Set((html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []))];
  const activa = correos.find(c => c.toLowerCase() === usuarioEsperado.toLowerCase());
  if (activa) { log(`  Cuenta activa confirmada: ${usuarioEsperado}`); return; }
  // No abortamos por no encontrarlo (Gmail ofusca), pero avisamos si aparece otra cuenta del mismo tipo.
  log(`  AVISO: no se pudo confirmar en el DOM que la cuenta activa sea ${usuarioEsperado}. Se continúa; verifica el remitente en Enviados.`);
}

async function adjuntarArchivos(page, adjuntos, log, captura) {
  if (!adjuntos || !adjuntos.length) return;
  const existentes = adjuntos.filter(a => { try { return fs.statSync(a).isFile(); } catch (_) { return false; } });
  if (!existentes.length) { log('  AVISO: no se encontró ningún archivo para adjuntar.'); return; }
  log(`  Adjuntando ${existentes.length} archivo(s): ${existentes.map(a => path.basename(a)).join(', ')}`);

  let adjuntado = false;
  const clip = page.locator('div[role="button"][aria-label*="Adjuntar archivos" i], div[command="Files"], div[data-tooltip*="Adjuntar archivos" i], div[role="button"][aria-label*="Attach files" i]').first();
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15000 }),
      clip.click({ timeout: 8000 }),
    ]);
    await chooser.setFiles(existentes);
    adjuntado = true;
  } catch (e) {
    const inp = page.locator('div[role="dialog"] input[type="file"], input[type="file"]').first();
    if (await inp.count()) { await inp.setInputFiles(existentes); adjuntado = true; }
  }
  if (!adjuntado) throw new Error('No se pudo adjuntar el archivo (no se encontró el botón ni el input de adjuntos).');

  // Esperar a que termine la subida: aparece el nombre del archivo en el borrador.
  const prefijo = path.basename(existentes[0]).slice(0, 18);
  await page.locator(`text=${prefijo}`).first().waitFor({ timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await captura('gmail_05b_adjunto');
}

async function redactarYEnviar(page, { para, cc = [], asunto, texto, html, adjuntos = [], enviar = true }, log, captura) {
  // Abrir UNA sola ventana de redacción. Si ya hay un compose abierto (de un intento previo), se reutiliza;
  // si no, se hace un clic en "Redactar" y se espera; solo se reintenta una vez para no apilar ventanas.
  const subjectField = page.locator('input[name="subjectbox"]').first();
  let abierto = await subjectField.isVisible().catch(() => false);
  for (let intento = 1; intento <= 2 && !abierto; intento++) {
    await cerrarPopups(page);
    const redactar = page.getByRole('button', { name: /^\s*Redactar\s*$/ }).or(page.locator('div[gh="cm"]')).first();
    await redactar.waitFor({ timeout: 30000 });
    await redactar.click().catch(() => {});
    abierto = await subjectField.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!abierto) log(`  La ventana de redacción no abrió (intento ${intento}); se reintenta una vez.`);
  }
  if (!abierto) throw new Error('No se abrió la ventana de redacción de Gmail.');
  await captura('gmail_04_compose');

  const dialog = page.locator('div[role="dialog"]').filter({ has: page.locator('input[name="subjectbox"]') }).first();
  const to = dialog.locator('input[aria-label="Para"], input[aria-label^="Para"], input[aria-label*="Destinatarios" i], input[aria-label^="To" i], input[peoplekit-id], textarea[name="to"]')
    .or(page.locator('input[aria-label="Para"], input[aria-label^="Para"], input[aria-label*="Destinatarios" i], input[aria-label^="To" i], input[peoplekit-id], textarea[name="to"]')).first();
  await to.waitFor({ state: 'visible', timeout: 20000 });
  await to.click();
  await to.type(para, { delay: 20 });
  await page.keyboard.press('Enter');
  for (const c of cc) { await to.type(c, { delay: 20 }); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(400);

  const subj = page.locator('input[name="subjectbox"]').first();
  await subj.click();
  await subj.fill(asunto);

  const body = page.locator('div[aria-label="Cuerpo del mensaje"], div[role="textbox"][aria-label*="Cuerpo" i], div[role="textbox"][aria-label*="Message Body" i]').first();
  await body.click();
  // Colocar el cursor al inicio para que el texto quede ARRIBA de la firma automática de Gmail.
  await page.keyboard.press('Control+Home');

  // El cuerpo se pega como HTML para que la tabla de nombres y horas quede alineada:
  // escribiendolo como texto, la fuente proporcional de Gmail dejaba la columna despareja.
  // Se hace con un evento 'paste' sintetico y no con execCommand('insertHTML'), porque Gmail
  // aplica Trusted Types y lo rechaza ('This document requires TrustedHTML assignment').
  // Tampoco se usa el portapapeles real para no pisar lo que el usuario tenga copiado.
  // El DataTransfer lleva tambien el texto plano, por si Gmail prefiriera esa version.
  // Si el pegado no prospera se escribe el texto plano, que siempre funciona.
  let cuerpoHtml = false;
  if (html) {
    const largoAntes = (await body.innerText().catch(() => '')).length;
    const insertado = await page.evaluate(({ h, t }) => {
      const el = document.activeElement;
      if (!el || !el.isContentEditable) return false;
      try {
        const dt = new DataTransfer();
        dt.setData('text/html', h);
        dt.setData('text/plain', t);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        return true;
      } catch (_) { return false; }
    }, { h: html, t: texto }).catch(() => false);
    await page.waitForTimeout(800);   // Gmail procesa el pegado de forma asincrona
    const largoDespues = (await body.innerText().catch(() => '')).length;
    cuerpoHtml = !!insertado && largoDespues > largoAntes;
    if (cuerpoHtml) log('  Cuerpo insertado como tabla HTML: la columna de horas queda alineada.');
    else log('  Gmail no acepto el cuerpo como HTML; se escribe como texto plano (columna menos pareja).');
  }
  if (!cuerpoHtml) {
    const lineas = texto.split('\n');
    for (let i = 0; i < lineas.length; i++) {
      if (lineas[i]) await body.type(lineas[i], { delay: 3 });
      if (i < lineas.length - 1) await page.keyboard.press('Enter');
    }
  }
  // Separar el mensaje de la firma con una línea en blanco.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await captura('gmail_05_redactado');

  // Adjuntar archivos (p. ej. el Excel exportado) antes de enviar.
  await adjuntarArchivos(page, adjuntos, log, captura);

  // Modo borrador: queda todo escrito y adjuntado, pero NO se pulsa Enviar.
  // Gmail guarda el borrador solo, asi que se puede revisar despues en la carpeta Borradores.
  if (!enviar) {
    await captura('gmail_06_borrador_sin_enviar');
    log('  Borrador listo en Gmail: destinatarios, asunto, cuerpo y adjunto escritos. NO se pulso Enviar.');
    return;
  }

  const botonEnviar = page.locator('div[role="button"][aria-label^="Enviar"], div[role="button"][data-tooltip^="Enviar"]').first();
  await botonEnviar.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await botonEnviar.count()) await botonEnviar.click().catch(() => {});
  else await page.keyboard.press('Control+Enter');

  // Confirmar por el aviso "Se envió el mensaje" (Gmail lo muestra aunque los adjuntos terminen de subir después).
  const toast = page.locator('text=/Se envió el mensaje|Mensaje enviado|Se ha enviado|Message sent/i').first();
  const enviado = await toast.waitFor({ state: 'visible', timeout: 40000 }).then(() => true).catch(() => false);
  await captura('gmail_06_enviado');
  if (!enviado) { await captura('gmail_07_sin_confirmar'); throw new Error('No se confirmó el envío en la interfaz de Gmail (no apareció "Se envió el mensaje"). Revisa las capturas gmail_05/06/07.'); }
  log('  Gmail confirmó el envío del mensaje ("Se envió el mensaje").');
}

async function enviarCorreoNavegador({ config, para, cc = [], asunto, texto, html, adjuntos = [], log = console.log, enviar = true }) {
  const usuario = config.credenciales.gmail.webUsuario || config.credenciales.gmail.usuario;
  const clave = config.credenciales.gmail.webClave;
  if (!usuario) throw new Error('Falta GMAIL_WEB_USER (o GMAIL_USUARIO) en .env');
  if (!clave) throw new Error('Falta GMAIL_WEB_PASS en .env (contraseña de la cuenta para el envío por navegador).');
  if (!para || !para.length) throw new Error('No hay destinatarios.');

  const opciones = (config.correo && config.correo.navegador) || {};
  const perfil = path.join(config.rutas.raiz, '.perfil-gmail');
  fs.mkdirSync(perfil, { recursive: true });
  const marca = marcaTiempoArchivo();
  const captura = async (n) => { try { await page.screenshot({ path: path.join(config.rutas.capturas, `${marca}_${n}.png`) }); } catch (_) {} };

  log(`${enviar ? 'Enviando el correo' : 'Redactando el correo SIN enviarlo'} por Gmail web (Playwright) como ${usuario} -> ${para.join(', ')}`);
  const context = await chromium.launchPersistentContext(perfil, {
    channel: opciones.navegador || 'chrome',
    headless: opciones.headless === true,
    viewport: { width: 1360, height: 900 },
    locale: 'es-CO',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(config.correo.navegador && config.correo.navegador.tiempoEsperaMs || 45000);
  try {
    await iniciarSesionSiHaceFalta(page, usuario, clave, log, captura);
    await cerrarPopups(page);
    await verificarCuenta(page, usuario, log);
    await redactarYEnviar(page, { para: para[0], cc: [...para.slice(1), ...cc], asunto, texto, html, adjuntos, enviar }, log, captura);
    return { enviado: enviar, borrador: !enviar, metodo: 'navegador', para, adjuntos };
  } catch (e) {
    await captura('gmail_99_error');
    e.message = `${enviar ? 'Envío' : 'Redacción'} por Gmail web falló: ${e.message} | Capturas en ${config.rutas.capturas}`;
    throw e;
  } finally {
    await context.close().catch(() => {});
  }
}

// Verifica que el inicio de sesión en Gmail web funcione, SIN redactar ni enviar ningún correo.
// Deja la sesión guardada en .perfil-gmail para que los envíos siguientes no vuelvan a pedir el login.
async function verificarAccesoGmail({ config, log = console.log }) {
  const usuario = config.credenciales.gmail.webUsuario || config.credenciales.gmail.usuario;
  const clave = config.credenciales.gmail.webClave;
  if (!usuario) throw new Error('Falta GMAIL_WEB_USER (o GMAIL_USUARIO) en .env');
  if (!clave) throw new Error('Falta GMAIL_WEB_PASS en .env (contraseña de la cuenta para el envío por navegador).');

  const opciones = (config.correo && config.correo.navegador) || {};
  const perfil = path.join(config.rutas.raiz, '.perfil-gmail');
  fs.mkdirSync(perfil, { recursive: true });
  const marca = marcaTiempoArchivo();
  const captura = async (n) => { try { await page.screenshot({ path: path.join(config.rutas.capturas, `${marca}_${n}.png`) }); } catch (_) {} };

  log(`Verificando acceso a Gmail web como ${usuario} (no se enviará ningún correo)`);
  const context = await chromium.launchPersistentContext(perfil, {
    channel: opciones.navegador || 'chrome',
    headless: opciones.headless === true,
    viewport: { width: 1360, height: 900 },
    locale: 'es-CO',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout((config.correo.navegador && config.correo.navegador.tiempoEsperaMs) || 45000);
  try {
    await iniciarSesionSiHaceFalta(page, usuario, clave, log, captura);
    await cerrarPopups(page);
    await verificarCuenta(page, usuario, log);
    await captura('gmail_00_acceso_ok');
    log('  Acceso correcto: se llegó a la bandeja de Gmail y la sesión quedó guardada en .perfil-gmail');
    return { acceso: true, usuario, perfil };
  } catch (e) {
    await captura('gmail_98_acceso_error');
    e.message = `No se pudo entrar a Gmail web: ${e.message} | Capturas en ${config.rutas.capturas}`;
    throw e;
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { enviarCorreoNavegador, verificarAccesoGmail };
