'use strict';
// Obtención de los registros de acceso desde HikCentral Access Control con Playwright.
// Sigue los pasos del documento "Procedimiento Reporte Biométrico":
//   1. Login                                  4. Puntos de acceso Biometria 1 y 2, "Seleccionar persona" e icono de personas
//   2. Menú superior "Control de acceso"      5. Departamento "Personal Claro Colombia" > Seleccionar todos > Añadir
//   3. Buscar > "Búsqueda de acceso de persona"   6. BUSCAR
//   7. Excel: el botón "Exportar" de HikCentral solo funciona con el "componente web" (plugin local de Hikvision)
//      y no hace ninguna petición al servidor que se pueda capturar. Por eso se lee la MISMA tabla de resultados
//      que muestra la página (todas sus páginas) y se escribe un Excel con el formato exacto de la exportación.
//
// Guarda una captura por paso en logs/capturas/ para diagnosticar cambios en la página.
// IMPORTANTE: solo se hace UN intento de inicio de sesión por ejecución; HikCentral bloquea la IP
// después de 4 intentos fallidos.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const { marcaTiempoArchivo, aISO } = require('./fechas');

const RE_ERROR_LOGIN = /Nombre de usuario o contraseña incorrectos|Código de error|bloquear/i;
const RE_PISTA = /componente web|control web|plugin/i;
const RE_CLAVE_CADUCA = /caducará|caducar|cambie su contraseña/i;
const RE_RESPUESTA_BUSQUEDA = /CardSwipeRecords\?MT=GET/;

function urlBase(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/`;
}

// Etiqueta del filtro "Tiempo" de HikCentral según la fecha objetivo (solo Hoy y Ayer de forma automática).
function etiquetaTiempo(fecha) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const f = new Date(fecha); f.setHours(0, 0, 0, 0);
  const dif = Math.round((hoy - f) / 86400000);
  if (dif === 0) return 'Hoy';
  if (dif === 1) return 'Ayer';
  return null;
}

async function lanzarNavegador(bio, log) {
  const opciones = { headless: !!bio.headless, slowMo: bio.slowMo || 0 };
  const canal = bio.navegador || 'chrome';
  if (canal && canal !== 'chromium') {
    try {
      return await chromium.launch({ ...opciones, channel: canal });
    } catch (e) {
      log(`No se pudo abrir el navegador "${canal}" (${e.message.split('\n')[0]}). Se intenta con Chromium de Playwright.`);
    }
  }
  return chromium.launch(opciones);
}

async function textoDialogos(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.el-dialog, .el-message-box, .el-message')]
      .filter(e => e.getBoundingClientRect().width > 0)
      .map(e => e.innerText.replace(/\s+/g, ' ').trim())
      .join(' || ')
  ).catch(() => '');
}

// Cierra el modal "Pista" del componente web (Instálelo / Iniciar / Cancelar) y el aviso de "actualizar los datos".
async function cerrarAvisos(page, log) {
  const r = { pista: false, tip: false };
  const modal = page.locator('.el-dialog:visible, .el-message-box:visible').filter({ hasText: RE_PISTA }).first();
  if (await modal.isVisible().catch(() => false)) {
    const cancelar = modal.locator('button').filter({ hasText: /^\s*Cancelar\s*$/ }).first();
    if (await cancelar.isVisible().catch(() => false)) {
      await cancelar.click();
      log('  Aviso del componente web de Hikvision cerrado (no es necesario para el reporte).');
      r.pista = true;
      await page.waitForTimeout(400);
    }
  }
  const tip = page.locator('.el-popover:visible').filter({ hasText: /actualizar los datos de esta página/i }).first();
  if (await tip.isVisible().catch(() => false)) {
    const ok = tip.locator('button').filter({ hasText: /^\s*OK\s*$/ }).first();
    if (await ok.isVisible().catch(() => false)) { await ok.click(); r.tip = true; await page.waitForTimeout(300); }
  }
  return r;
}

// Espera a que termine "Detectando estado de control web..." y cierra el modal "Pista" si aparece.
async function esperarDeteccionComponenteWeb(page, log, maxMs = 20000) {
  const detectando = page.locator('text=/Detectando estado de control web/i').filter({ visible: true }).first();
  const inicio = Date.now();
  let sinDetectar = 0;
  while (Date.now() - inicio < maxMs) {
    await page.waitForTimeout(1000);
    const r = await cerrarAvisos(page, log);
    if (r.pista) return;
    const visible = await detectando.isVisible().catch(() => false);
    sinDetectar = visible ? 0 : sinDetectar + 1;
    if (sinDetectar >= 3) return; // 3 s seguidos sin "Detectando..." y sin Pista: no hay nada que cerrar
  }
}

// Primer elemento visible con ese texto exacto cuyo cuadro cumpla el filtro (para menús).
async function elementoPorTexto(page, texto, filtro = () => true) {
  const escapado = texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidatos = await page.locator(`text=/^\\s*${escapado}\\s*$/`).filter({ visible: true }).all();
  for (const c of candidatos) {
    const b = await c.boundingBox();
    if (b && filtro(b)) return c;
  }
  return null;
}

// ---- Árbol zTree (puntos de acceso) ----
function chkZtree(page, nombre) {
  return page.locator(`ul.ztree li[treenode] > div:has(> a[title="${nombre}"]) > span.chk`).filter({ visible: true }).first();
}
async function estadoChk(loc) {
  return ((await loc.getAttribute('class').catch(() => '')) || '').replace('button ', '');
}

// Lee la tabla de resultados (cabeceras Nombre / Departamento / Tiempo) de la página actual del paginador.
async function leerTablaResultados(page) {
  return page.evaluate(() => {
    const vis = e => e.getBoundingClientRect().width > 0;
    for (const t of [...document.querySelectorAll('.el-table')].filter(vis)) {
      const cab = [...t.querySelectorAll('.el-table__header-wrapper th .cell')].map(c => c.innerText.trim());
      const iN = cab.findIndex(c => /^Nombre$/i.test(c));
      const iD = cab.findIndex(c => /^Departamento$/i.test(c));
      const iT = cab.findIndex(c => /^(Tiempo|Hora)$/i.test(c));
      if (iN < 0 || iT < 0) continue;
      const filas = [...t.querySelectorAll('.el-table__body-wrapper tr.el-table__row')].map(tr => {
        const tds = [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim());
        return { nombre: tds[iN] || '', departamento: iD >= 0 ? (tds[iD] || '') : '', tiempo: tds[iT] || '' };
      });
      const totalTxt = (document.querySelector('.el-pagination:has(.el-pagination__total) .el-pagination__total') || {}).innerText || '';
      const sinDatos = !!t.querySelector('.el-table__empty-block') && vis(t.querySelector('.el-table__empty-block'));
      return { filas, total: parseInt((totalTxt.match(/\d+/) || ['-1'])[0], 10), cabeceras: cab, sinDatos };
    }
    return null;
  });
}

// Fija el tamaño de página de la tabla de resultados al menor valor que cubra el total (para que quepan en una página).
async function seleccionarTamanoPagina(page, total, log) {
  const opciones = [50, 100, 200, 300, 500];
  const objetivo = opciones.find(o => o >= total) || 500;
  const input = page.locator('.el-pagination__sizes input').first();
  if (!(await input.count())) return null;
  const actual = ((await input.getAttribute('title')) || '').trim();
  if (actual.startsWith(String(objetivo))) return objetivo;
  await input.click();
  await page.waitForTimeout(500);
  await page.locator('.el-select-dropdown:not([style*="display: none"]) .el-select-dropdown__item')
    .filter({ hasText: new RegExp(`^\\s*${objetivo}\\s*/`) }).first().click();
  await page.waitForTimeout(2500);
  return objetivo;
}

// La tabla de HikCentral es virtual: solo mantiene ~15 filas en el DOM y desliza una ventana al hacer scroll.
// Se recorre con la rueda del mouse recolectando las filas que van apareciendo, con dos pasadas para no perder ninguna.
async function leerFilasVirtual(page, log) {
  const totalTxt = await page.locator('.el-pagination__total').first().innerText().catch(() => '');
  const total = parseInt((totalTxt.match(/\d+/) || ['-1'])[0], 10);
  const tam = await seleccionarTamanoPagina(page, total > 0 ? total : 500, log);
  if (tam) log(`  Tamaño de página fijado en ${tam} (total que reporta la biométrica: ${total >= 0 ? total : '?'})`);

  const rect = await page.evaluate(() => {
    const vis = e => e.getBoundingClientRect().width > 0;
    const t = [...document.querySelectorAll('.el-table')].filter(vis).find(x => { const c = [...x.querySelectorAll('.el-table__header-wrapper th .cell')].map(y => y.innerText.trim()); return c.some(z => /^Nombre$/i.test(z)); });
    if (!t) return null;
    const bw = [...t.querySelectorAll('.el-table__body-wrapper')].find(vis) || t;
    const r = bw.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!rect) throw new Error('No se encontró la tabla de resultados (cabeceras Nombre / Departamento / Tiempo)');

  await page.evaluate(() => { window.__filas = new Map(); });
  const recolectar = () => page.evaluate(() => {
    const vis = e => e.getBoundingClientRect().width > 0;
    const t = [...document.querySelectorAll('.el-table')].filter(vis).find(x => { const c = [...x.querySelectorAll('.el-table__header-wrapper th .cell')].map(y => y.innerText.trim()); return c.some(z => /^Nombre$/i.test(z)); });
    if (!t) return 0;
    const cab = [...t.querySelectorAll('.el-table__header-wrapper th .cell')].map(c => c.innerText.trim());
    const iN = cab.findIndex(c => /^Nombre$/i.test(c));
    const iD = cab.findIndex(c => /^Departamento$/i.test(c));
    const iT = cab.findIndex(c => /^(Tiempo|Hora)$/i.test(c));
    for (const tr of t.querySelectorAll('.el-table__body-wrapper tr.el-table__row')) {
      const tds = [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim());
      const nombre = iN >= 0 ? (tds[iN] || '') : (tds[0] || '');
      const tiempo = iT >= 0 ? (tds[iT] || '') : (tds[tds.length - 2] || '');
      const dep = iD >= 0 ? (tds[iD] || '') : '';
      if (!nombre && !tiempo) continue;
      window.__filas.set(nombre + '|' + tiempo, { nombre, departamento: dep, tiempo });
    }
    return window.__filas.size;
  });

  await page.mouse.move(rect.x + rect.w / 2, rect.y + rect.h / 2);
  const subirTodo = async () => { for (let i = 0; i < 60; i++) await page.mouse.wheel(0, -700); await page.waitForTimeout(250); };
  await subirTodo();
  let size = await recolectar();
  for (let pase = 0; pase < 2; pase++) {
    let sinCambio = 0;
    for (let i = 0; i < 600 && sinCambio < 30; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(80);
      const s = await recolectar();
      if (s > size) { size = s; sinCambio = 0; } else sinCambio++;
    }
    await subirTodo();
    await recolectar();
  }
  const filas = await page.evaluate(() => [...window.__filas.values()]);
  return { filas, total };
}

async function escribirExcel(ruta, filas, { fechaISO, operador, marca }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  const ahora = new Date();
  const hh = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}:${String(ahora.getSeconds()).padStart(2, '0')}`;
  ws.addRow([`Búsqueda de acceso de persona_${marca.replace(/[-_]/g, '')}`]);
  ws.addRow(['Información básica']);
  ws.addRow([`Hora del informe:${fechaISO} ${hh}`]);
  ws.addRow([`Operador:${operador}`]);
  ws.addRow(['Exportar contenido:Nombre,Departamento,Hora']);
  ws.addRow([`Hora del informe:${fechaISO} 00:00:00-${fechaISO} 23:59:59`]);
  ws.addRow([]);
  ws.addRow(['Nombre', 'Departamento', 'Hora']);
  for (const f of filas) ws.addRow([f.nombre, f.departamento, f.tiempo]);
  ws.getColumn(1).width = 38; ws.getColumn(2).width = 62; ws.getColumn(3).width = 22;
  await wb.xlsx.writeFile(ruta);
}

async function exportarExcel({ config, log, fecha }) {
  const bio = config.biometrica;
  const cred = config.credenciales.biometrica;
  if (!cred.usuario || !cred.clave) throw new Error('Faltan BIO_USUARIO o BIO_CLAVE en el archivo .env');
  const marca = marcaTiempoArchivo();
  const fechaObjetivo = fecha ? new Date(fecha) : new Date();
  const fechaISO = aISO(fechaObjetivo);
  const objetivoTiempo = etiquetaTiempo(fechaObjetivo);
  if (!objetivoTiempo) throw new Error(`Solo se puede exportar automáticamente el día de hoy o el de ayer. Fecha solicitada: ${fechaISO}. Para días anteriores, exporta el Excel a mano y usa "node src/index.js --excel <ruta> --fecha ${fechaISO}".`);
  const capturas = config.rutas.capturas;
  const espera = bio.tiempoEsperaMs || 45000;

  const browser = await lanzarNavegador(bio, log);
  const context = await browser.newContext({ locale: 'es-CO', viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(espera);

  let paso = 'inicio';
  const captura = async (nombre) => {
    try { await page.screenshot({ path: path.join(capturas, `${marca}_${nombre}.png`) }); } catch (_) { /* ignorar */ }
  };

  try {
    // ---------- 1. Login ----------
    paso = '1-login';
    log(`Paso 1: abriendo ${urlBase(bio.url)} e iniciando sesión como "${cred.usuario}"`);
    await page.goto(urlBase(bio.url), { waitUntil: 'domcontentloaded' });
    const campoUsuario = page.getByPlaceholder('Nombre de usuario');
    const campoClave = page.getByPlaceholder('Contraseña');
    await campoUsuario.waitFor();

    // El formulario de HikCentral (Vue) a veces borra lo escrito en "Nombre de usuario" justo después de
    // escribirlo, cuando aparece el aviso del usuario de dominio; entonces se enviaba vacío y la página
    // respondía "No puede estar vacío". Por eso se comprueba que AMBOS campos conservaron su valor ANTES
    // de pulsar "Iniciar sesión": volver a escribir no cuenta como intento, enviar el formulario sí.
    let camposListos = false;
    for (let intento = 1; intento <= 4 && !camposListos; intento++) {
      await campoUsuario.click();
      await campoUsuario.fill('');
      await campoUsuario.type(cred.usuario, { delay: 30 });
      await campoClave.click();
      await campoClave.fill('');
      await campoClave.type(cred.clave, { delay: 30 });
      await page.waitForTimeout(400);
      const usuarioEscrito = await campoUsuario.inputValue().catch(() => '');
      const largoClave = (await campoClave.inputValue().catch(() => '')).length;
      camposListos = usuarioEscrito === cred.usuario && largoClave === cred.clave.length;
      if (!camposListos) log(`  El formulario no conservó lo escrito (intento ${intento} de 4); se vuelve a escribir. Esto NO consume un intento de inicio de sesión.`);
    }
    if (!camposListos) {
      await captura('01_login_campos_vacios');
      throw new Error('No se pudieron escribir usuario y contraseña en el formulario de HikCentral: el campo se limpia solo. NO se envió ningún intento de inicio de sesión, así que no hay riesgo de bloqueo de IP. Revisa la captura 01_login_campos_vacios.');
    }
    await page.locator('button.login-btn').click();
    // HikCentral avisa "Su contraseña de acceso caducará en N día/s" con botones Cambiar contraseña / Ignorar.
    // No es un fallo de inicio de sesión (su texto "se bloqueará" coincide con RE_ERROR_LOGIN): se ignora y se continúa.
    const ignorarAvisoCaducidad = async () => {
      const aviso = page.locator('.el-dialog:visible, .el-message-box:visible').filter({ hasText: RE_CLAVE_CADUCA }).first();
      if (!(await aviso.isVisible().catch(() => false))) return false;
      const ignorar = aviso.locator('button').filter({ hasText: /Ignorar/i }).first();
      if (!(await ignorar.isVisible().catch(() => false))) return false;
      const texto = ((await aviso.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      await ignorar.click();
      log(`  Aviso de caducidad de la contraseña ignorado: ${texto.slice(0, 140)}`);
      await page.waitForTimeout(500);
      return true;
    };
    const esperarLogin = () => Promise.race([
      page.locator('.el-dialog:visible, .el-message-box:visible').filter({ hasText: RE_ERROR_LOGIN }).first().waitFor().then(() => 'error').catch(() => 'timeout'),
      page.locator('text=/^\\s*Control de acceso\\s*$/').filter({ visible: true }).first().waitFor().then(() => 'ok').catch(() => 'timeout'),
    ]);
    let resultadoLogin = await esperarLogin();
    if (resultadoLogin !== 'ok' && await ignorarAvisoCaducidad()) resultadoLogin = await esperarLogin();
    if (resultadoLogin !== 'ok') {
      await captura('01_login_error');
      const detalle = (await textoDialogos(page)) || 'sin detalle (no cargó el menú principal)';
      throw new Error(`La biométrica no aceptó el inicio de sesión: ${detalle}. NO se reintenta automáticamente porque la IP se bloquea tras 4 intentos fallidos. Verifica BIO_USUARIO y BIO_CLAVE en .env.`);
    }
    log('Sesión iniciada correctamente.');
    await page.waitForTimeout(1500);
    await cerrarAvisos(page, log);
    await captura('01_inicio');

    // ---------- 2. Control de acceso ----------
    paso = '2-control-acceso';
    log('Paso 2: entrando al módulo "Control de acceso"');
    const nav = await elementoPorTexto(page, 'Control de acceso', b => b.y < 80);
    if (!nav) throw new Error('No se encontró "Control de acceso" en el menú superior');
    await nav.click();
    await page.locator('text=/^\\s*Buscar\\s*$/').filter({ visible: true }).first().waitFor();
    await page.waitForTimeout(1000);
    await captura('02_control_acceso');

    // ---------- 3. Buscar > Búsqueda de acceso de persona ----------
    paso = '3-busqueda-persona';
    log('Paso 3: abriendo "Buscar > Búsqueda de acceso de persona"');
    let itemBusqueda = await elementoPorTexto(page, 'Búsqueda de acceso de persona', b => b.x < 320);
    if (!itemBusqueda) {
      const buscar = await elementoPorTexto(page, 'Buscar', b => b.x < 320);
      if (!buscar) throw new Error('No se encontró la sección "Buscar" del menú izquierdo');
      await buscar.click();
      await page.waitForTimeout(800);
      itemBusqueda = await elementoPorTexto(page, 'Búsqueda de acceso de persona', b => b.x < 320);
    }
    if (!itemBusqueda) throw new Error('No se encontró "Búsqueda de acceso de persona" en el menú izquierdo');
    await itemBusqueda.click();
    await page.locator('text=/^\\s*Punto de acceso\\s*$/').filter({ visible: true }).first().waitFor();
    // Esperar a que termine la detección del componente web y cerrar sus avisos.
    await esperarDeteccionComponenteWeb(page, log);
    await captura('03_formulario');

    // ---------- 4. Filtros ----------
    paso = '4-filtros';
    log('Paso 4: configurando filtros (Tiempo = Hoy, puntos de acceso, Seleccionar persona)');
    // Selector "Tiempo": el input del el-select que está dentro del mismo grupo que la etiqueta "Tiempo".
    log(`  Fecha del reporte: ${fechaISO} -> filtro "Tiempo" = "${objetivoTiempo}"`);
    const selectTiempo = page.locator('span[title="Tiempo"]').filter({ visible: true }).first().locator('xpath=../..').locator('.el-select input.el-input__inner').first();
    if (await selectTiempo.count()) {
      const valorTiempo = ((await selectTiempo.getAttribute('title').catch(() => '')) || (await selectTiempo.inputValue().catch(() => '')) || '').trim();
      if (valorTiempo !== objetivoTiempo) {
        log(`  El filtro "Tiempo" estaba en "${valorTiempo || '?'}", se cambia a "${objetivoTiempo}"`);
        await cerrarAvisos(page, log);
        await selectTiempo.click();
        await page.waitForTimeout(500);
        await page.locator('.el-select-dropdown:not([style*="display: none"]) .el-select-dropdown__item').filter({ hasText: new RegExp(`^\\s*${objetivoTiempo}\\s*$`) }).first().click();
        await page.waitForTimeout(700);
      } else {
        log(`  Filtro "Tiempo" ya estaba en "${objetivoTiempo}"`);
      }
    } else {
      throw new Error('No se ubicó el selector "Tiempo" del formulario');
    }
    await cerrarAvisos(page, log);

    // Árbol de puntos de acceso (zTree). Aparece solo al cargar; si no, se pulsa el icono "Añadir" de la sección.
    const puntos = bio.puntosAcceso || [];
    if (!puntos.length) throw new Error('config.biometrica.puntosAcceso está vacío');
    const primerNodo = page.locator(`ul.ztree li[treenode] a[title="${puntos[0]}"]`).filter({ visible: true }).first();
    try {
      await primerNodo.waitFor({ timeout: 20000 });
    } catch (_) {
      log('  El árbol de puntos de acceso no apareció solo; se pulsa el icono "Añadir" de la sección.');
      await page.locator('header:has(span[title="Punto de acceso"]) i.add-icon').first().dispatchEvent('click');
      await primerNodo.waitFor({ timeout: 15000 });
    }
    // Dejar todo desmarcado (marcar "Todos" y volver a desmarcar) y marcar solo los puntos configurados.
    const chkTodos = chkZtree(page, 'Todos');
    if (await chkTodos.isVisible().catch(() => false)) {
      for (let i = 0; i < 3; i++) {
        const e = await estadoChk(chkTodos);
        if (e.includes('checkbox_true_full')) break;
        await chkTodos.click(); await page.waitForTimeout(400);
      }
      await chkTodos.click(); await page.waitForTimeout(400);
    }
    for (const p of puntos) {
      const chk = chkZtree(page, p);
      if (!(await chk.isVisible().catch(() => false))) throw new Error(`No se encontró el punto de acceso "${p}" en el árbol`);
      if (!(await estadoChk(chk)).includes('checkbox_true')) { await chk.click(); await page.waitForTimeout(400); }
      const ok = (await estadoChk(chk)).includes('checkbox_true');
      log(`  Punto de acceso "${p}": ${ok ? 'seleccionado' : 'NO se pudo seleccionar'}`);
      if (!ok) throw new Error(`No se pudo seleccionar el punto de acceso "${p}"`);
    }

    // "Buscar en" -> Seleccionar persona
    await page.locator('label.el-radio[title="Seleccionar persona"]').click();
    await page.waitForTimeout(1200);
    await captura('04_filtros');

    // Icono de personas a la derecha del título "Seleccionar persona" (primero por estructura, luego por posición).
    paso = '4-icono-personas';
    let botonPersonas = page.locator('.person-list .btn-list button[title="Añadir"], .person-list button.is-icon').filter({ visible: true }).first();
    if (!(await botonPersonas.count())) {
      let caja = null;
      for (const t of await page.locator('text=/^\\s*Seleccionar persona\\s*$/').filter({ visible: true }).all()) {
        if (await t.evaluate(e => !!e.closest('.el-radio'))) continue;
        const b = await t.boundingBox();
        if (b && (!caja || b.y > caja.y)) caja = b;
      }
      if (!caja) throw new Error('No se encontró el título "Seleccionar persona" del formulario');
      const h = await page.evaluateHandle((caja) => {
        const cy = caja.y + caja.height / 2;
        const c = [...document.querySelectorAll('i, button')].map(e => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.width < 60 && r.height < 60 && Math.abs((r.y + r.height / 2) - cy) < 16 && r.x > caja.x + caja.width - 4)
          .sort((a, b) => a.r.x - b.r.x);
        return c.length ? c[0].e : null;
      }, caja);
      botonPersonas = h.asElement();
      if (!botonPersonas) throw new Error('No se encontró el icono de personas al lado de "Seleccionar persona"');
    }
    await botonPersonas.click();
    const panel = page.locator('.el-popover:visible, .el-dialog:visible').filter({ hasText: /Seleccionar todos|Incluir departamento/ }).first();
    await panel.waitFor();
    await page.waitForTimeout(1000);
    await captura('05_panel_personas');

    // ---------- 5. Departamento > Seleccionar todos > Añadir ----------
    paso = '5-seleccionar-personal';
    log(`Paso 5: seleccionando el departamento "${bio.departamento}" con todas sus personas`);
    const incluirSub = panel.locator('.el-checkbox').filter({ hasText: /Incluir departamento/ }).first();
    if (await incluirSub.isVisible().catch(() => false) && !((await incluirSub.getAttribute('class')) || '').includes('is-checked')) {
      await incluirSub.click(); await page.waitForTimeout(400);
    }
    const nodoDep = panel.locator(`ul.ztree a[title="${bio.departamento}"] span.node_name`).filter({ visible: true }).first();
    if (!(await nodoDep.count())) throw new Error(`No se encontró el departamento "${bio.departamento}" en el árbol de departamentos`);
    await nodoDep.click();
    await page.waitForTimeout(2500);
    const chkTodosPersonas = panel.locator('.el-checkbox').filter({ hasText: /Seleccionar todos/ }).first();
    await chkTodosPersonas.waitFor();
    if (!((await chkTodosPersonas.getAttribute('class')) || '').includes('is-checked')) await chkTodosPersonas.click();
    await page.waitForTimeout(1200);
    await captura('06_personas_seleccionadas');
    await panel.locator('button').filter({ hasText: /^\s*Añadir\s*$/ }).first().click();
    await page.waitForTimeout(1500);
    const hint = await page.locator('.hint').filter({ hasText: /persona\/s seleccionada/ }).first().innerText().catch(() => '');
    const nPersonas = parseInt((hint.match(/\d+/) || ['0'])[0], 10);
    log(`  ${hint || 'Sin resumen de personas seleccionadas'}`);
    if (!nPersonas) throw new Error(`No quedó ninguna persona seleccionada (${hint || 'sin resumen'})`);
    await cerrarAvisos(page, log);

    // ---------- 6. BUSCAR y lectura de resultados ----------
    paso = '6-buscar';
    log('Paso 6: ejecutando la búsqueda');
    const btnBuscar = page.locator('button.el-button--primary:visible').filter({ hasText: /^\s*Buscar\s*$/ }).last();
    const esRespuesta = r => r.request().method() === 'POST' && RE_RESPUESTA_BUSQUEDA.test(r.url());
    await Promise.all([
      page.waitForResponse(esRespuesta, { timeout: espera }).catch(() => null),
      btnBuscar.click(),
    ]);
    await page.waitForTimeout(2500);
    await cerrarAvisos(page, log);
    await captura('07_resultados');

    const { filas, total } = await leerFilasVirtual(page, log);
    if (total > 500) log(`  ADVERTENCIA: la biométrica reporta ${total} registros y solo se leyó la página de 500. Puede faltar información.`);
    if (!filas.length) log(`  ADVERTENCIA: la búsqueda no devolvió registros para ${objetivoTiempo} (${fechaISO}).`);
    const fechasEnFilas = [...new Set(filas.map(f => (f.tiempo || '').slice(0, 10)).filter(Boolean))];
    if (fechasEnFilas.length) log(`  Fechas en los resultados: ${fechasEnFilas.join(', ')}`);
    if (fechasEnFilas.length && !fechasEnFilas.includes(fechaISO)) {
      log(`  ADVERTENCIA: se esperaban registros del ${fechaISO} pero los resultados son de ${fechasEnFilas.join(', ')}.`);
    }
    const personas = new Set(filas.map(f => f.nombre)).size;
    log(`  Eventos únicos leídos: ${filas.length} (personas distintas: ${personas}). La biométrica reporta ${total >= 0 ? total : '?'} registros (la diferencia son marcaciones repetidas en el mismo segundo).`);

    // ---------- 7. Excel con el formato de la exportación de HikCentral ----------
    paso = '7-excel';
    const rutaFinal = path.join(config.rutas.descargas, `Busqueda_de_acceso_de_persona_${marca}.xlsx`);
    await escribirExcel(rutaFinal, filas, { fechaISO, operador: cred.usuario, marca });
    log(`Excel guardado en ${rutaFinal}`);
    await captura('08_fin');
    return rutaFinal;
  } catch (e) {
    await captura(`error_${paso}`);
    try { fs.writeFileSync(path.join(capturas, `${marca}_error_${paso}.html`), await page.content()); } catch (_) { /* ignorar */ }
    const dialogos = await textoDialogos(page);
    e.message = `Falló el paso "${paso}": ${e.message}${dialogos ? ` | Diálogos en pantalla: ${dialogos.slice(0, 200)}` : ''} | Capturas en ${capturas}`;
    throw e;
  } finally {
    if (bio.mantenerAbierto) {
      log(`Navegador abierto ${bio.mantenerAbierto} s para revisión (config.biometrica.mantenerAbierto)`);
      await page.waitForTimeout(bio.mantenerAbierto * 1000).catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}

module.exports = { exportarExcel };
