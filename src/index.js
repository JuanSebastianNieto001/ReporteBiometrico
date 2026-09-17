'use strict';
// Orquestador del reporte biométrico.
//
//   node src/index.js                       flujo completo según config.json > confirmacion.modo
//   --modo inmediato|pagina|ntfy            fuerza el modo de confirmación
//   --hora HH:MM                            hora de entrada a usar en vez de la habitual
//   --excel <ruta.xlsx>                     usa un Excel ya exportado (pruebas, sin navegador)
//   --fecha AAAA-MM-DD                      fecha del reporte (solo tiene sentido con --excel)
//   --sin-enviar                            no envía el correo: solo muestra lo que enviaría
//   --solo-redactar                         abre Gmail y deja el correo redactado y adjuntado, pero NO pulsa Enviar
//   --sin-abrir / --sin-notificar           (modo pagina) no abre el navegador / sin aviso de Windows
//
// Modos:
//   inmediato  calcula con la hora habitual (o --hora) y envía de una vez. Pensado para pruebas.
//   pagina     abre una página local (http://127.0.0.1:4545) para confirmar la hora antes de enviar.
//   ntfy       pregunta al celular (app ntfy) si la hora de entrada fue la habitual: "Sí" envía;
//              "No" pide la hora real, recalcula (volviendo a consultar la biométrica si hace falta) y envía.

const path = require('path');
const fs = require('fs');
const config = require('./config');
const { iniciar: iniciarLog, log } = require('./log');
const { leerRegistros } = require('./excel');
const { horaEntradaHabitual, agruparPorPersona, calcularLlegadasTarde } = require('./reporte');
const { construirCorreo, enviarCorreo } = require('./correo');
const { enviarCorreoNavegador } = require('./correo-navegador');
const { iniciarServidorConfirmacion } = require('./confirmar');
const { toastWindows, abrirNavegador } = require('./notificar');
const ntfy = require('./ntfy');
const { aISO, desdeISO, fechaLarga, fechaCorreo, nombreDia, normalizarHoraEntrada, horaASegundos, segundosAHora } = require('./fechas');

function argumentos() {
  const a = process.argv.slice(2);
  const obtener = (nombre) => { const i = a.indexOf(nombre); return i >= 0 ? a[i + 1] : undefined; };
  return {
    excel: obtener('--excel'),
    fecha: obtener('--fecha'),
    hora: obtener('--hora'),
    modo: obtener('--modo'),
    sinEnviar: a.includes('--sin-enviar'),
    soloRedactar: a.includes('--solo-redactar'),
    sinAbrir: a.includes('--sin-abrir'),
    sinNotificar: a.includes('--sin-notificar'),
  };
}

const dormir = ms => new Promise(r => setTimeout(r, ms));
const ntfyConfigurado = () => !!(config.ntfy && config.ntfy.tema && !/X{4,}/.test(config.ntfy.tema));

async function avisoNtfy(titulo, mensaje, extra = {}) {
  if (!ntfyConfigurado()) return;
  try { await ntfy.publicar(config.ntfy, { titulo, mensaje, ...extra }); } catch (e) { log('No se pudo publicar en ntfy:', e.message); }
}

async function main() {
  const archivoLog = iniciarLog(config.rutas.logs);
  const args = argumentos();
  const fecha = args.fecha ? desdeISO(args.fecha) : new Date();
  const fechaISO = aISO(fecha);
  const modo = (args.modo || (config.confirmacion && config.confirmacion.modo) || 'pagina').toLowerCase();
  if (!['inmediato', 'pagina', 'ntfy'].includes(modo)) throw new Error(`Modo desconocido "${modo}" (usa inmediato, pagina o ntfy)`);
  if (args.hora && !normalizarHoraEntrada(args.hora)) throw new Error(`--hora inválida: ${args.hora}`);

  log('================================================================');
  log(`Inicio del reporte biométrico para ${fechaLarga(fecha)} | modo: ${modo}${args.sinEnviar ? ' | --sin-enviar' : ''} | log: ${archivoLog}`);

  // ---- Datos: Excel de la biométrica (o uno dado por parámetro) -> personas con su primera marcación ----
  // Momento (segundos del dia) en que se consulto la biometrica. Sirve para saber si los datos
  // son anteriores a la hora de entrada y por tanto inservibles para calcular llegadas tarde.
  let momentoConsultaSeg = null;
  async function obtenerPersonas() {
    let rutaExcel = args.excel;
    if (rutaExcel) {
      rutaExcel = path.resolve(rutaExcel);
      log(`Usando Excel existente: ${rutaExcel}`);
    } else {
      const { exportarExcel } = require('./biometrica');
      rutaExcel = await exportarExcel({ config, log, fecha });
      const ahoraConsulta = new Date();
      momentoConsultaSeg = ahoraConsulta.getHours() * 3600 + ahoraConsulta.getMinutes() * 60 + ahoraConsulta.getSeconds();
    }
    const registros = await leerRegistros(rutaExcel);
    let personas = agruparPorPersona(registros, fechaISO);
    if (!personas.length && registros.length) {
      const fechas = [...new Set(registros.map(r => r.fecha).filter(Boolean))];
      log(`ADVERTENCIA: ningún registro corresponde a ${fechaISO}. Fechas en el archivo: ${fechas.join(', ')}. Se usarán todos los registros.`);
      personas = agruparPorPersona(registros, null);
    }
    log(`Registros leídos: ${registros.length} | personas con marcación: ${personas.length}`);
    return { rutaExcel, personas };
  }

  let { rutaExcel, personas } = await obtenerPersonas();

  // ---- Hora de entrada propuesta ----
  const propuesta = args.hora
    ? { hora: normalizarHoraEntrada(args.hora), origen: 'indicada con --hora' }
    : horaEntradaHabitual(fecha, config);
  const tardesPropuestas = propuesta.hora ? calcularLlegadasTarde(personas, propuesta.hora) : [];
  log(`Hora de entrada propuesta: ${propuesta.hora || '(ninguna)'} — ${propuesta.origen}. Llegadas tarde con esa hora: ${tardesPropuestas.length}`);

  // ---- Envío (único punto por donde sale el correo) ----
  async function enviarReporte({ hora, excluidos = [], destinatarios, cc = [], asunto } = {}) {
    const h = normalizarHoraEntrada(hora);
    if (!h) throw new Error(`Hora de entrada inválida: "${hora}"`);
    const tardes = calcularLlegadasTarde(personas, h, excluidos);
    const correo = construirCorreo({ fecha, tardes, config });
    if (asunto && asunto.trim()) correo.asunto = asunto.trim();
    const para = destinatarios && destinatarios.length ? destinatarios : (config.correo.destinatarios || []);
    if (!para.length) throw new Error('No hay destinatarios (config.json > correo.destinatarios)');
    const adjuntos = (config.correo.adjuntarExcel !== false && rutaExcel && fs.existsSync(rutaExcel)) ? [rutaExcel] : [];
    log(`Correo "${correo.asunto}" para ${para.join(', ')} | hora de entrada ${h} | ${tardes.length} llegada(s) tarde: ${tardes.map(t => t.nombre).join('; ') || '(ninguna)'}${adjuntos.length ? ` | adjunto: ${path.basename(adjuntos[0])}` : ' | sin adjunto'}`);
    if (args.sinEnviar && !args.soloRedactar) {
      log('--sin-enviar: NO se envía. Contenido del correo:\n' + correo.texto);
      return { hora: h, tardes, correo, para, adjuntos, simulado: true };
    }
    const metodo = (config.correo.metodo || 'smtp').toLowerCase();
    if (args.soloRedactar && metodo !== 'navegador') throw new Error(`--solo-redactar solo funciona con correo.metodo = "navegador" (ahora es "${metodo}"), porque necesita la interfaz web de Gmail.`);
    let r;
    if (metodo === 'navegador') {
      r = await enviarCorreoNavegador({ config, para, cc, asunto: correo.asunto, texto: correo.texto, html: correo.html, adjuntos, log, enviar: !args.soloRedactar });
      if (args.soloRedactar) {
        log('--solo-redactar: el correo quedó REDACTADO en Gmail pero NO se envió. Revísalo en Borradores y bórralo cuando termines.');
        return { hora: h, tardes, correo, para, adjuntos, resultado: r, simulado: true };
      }
      log('Correo enviado por Gmail web (navegador).');
    } else {
      r = await enviarCorreo({ para, cc, asunto: correo.asunto, texto: correo.texto, html: correo.html, adjuntos, config });
      log(`Correo enviado por SMTP. id=${r.messageId} aceptados=${(r.aceptados || []).join(',')}`);
    }
    return { hora: h, tardes, correo, para, adjuntos, resultado: r };
  }

  const textoTardes = (tardes) => tardes.length
    ? tardes.map(p => `• ${p.nombre}  ${segundosAHora(p.primeraSeg, { ceroInicial: false })}`).join('\n')
    : '(sin llegadas tarde)';

  async function avisarEnviado(r) {
    const titulo = `Reporte biométrico ${fechaCorreo(fecha)}`;
    const msg = `${r.simulado ? 'SIMULADO (no enviado)' : 'Correo enviado'} a ${r.para.join(', ')} | hora de entrada ${r.hora} | ${r.tardes.length} llegada(s) tarde`;
    if (config.confirmacion.notificacionWindows !== false && !args.sinNotificar) await toastWindows(titulo, msg);
    if (config.ntfy && config.ntfy.avisarEnvios && !r.simulado) {
      await avisoNtfy(titulo, `${msg}${config.ntfy.incluirNombres ? '\n' + textoTardes(r.tardes) : ''}`, { prioridad: 3, etiquetas: ['white_check_mark'] });
    }
  }

  // ================= MODO INMEDIATO =================
  if (modo === 'inmediato') {
    if (!propuesta.hora) throw new Error(`Hoy (${nombreDia(fecha)}) no tiene hora de entrada habitual. Usa --hora HH:MM o configura horarioHabitual / excepcionesPorFecha en config.json.`);
    const r = await enviarReporte({ hora: propuesta.hora });
    await avisarEnviado(r);
    log(`FIN: ${r.simulado ? 'simulación terminada' : 'correo enviado'} con hora de entrada ${r.hora}.`);
    return;
  }

  // ================= MODO NTFY (celular) =================
  if (modo === 'ntfy') {
    if (!ntfyConfigurado()) throw new Error('Modo ntfy: configura config.json > ntfy.tema y suscribe la app ntfy del celular a ese tema.');
    const cfgN = config.ntfy;
    const horasEspera = config.confirmacion.esperaRespuestaHoras || 8;
    const fin = Date.now() + horasEspera * 3600 * 1000;
    const titulo = `Reporte biométrico ${fechaCorreo(fecha)}`;
    let desde = Math.floor(Date.now() / 1000) - 2;
    let hora = propuesta.hora;
    const resumenCon = (h) => { const t = calcularLlegadasTarde(personas, h); return `${t.length} llegada(s) tarde de ${personas.length} persona(s) con marcación` + (cfgN.incluirNombres && t.length ? ':\n' + textoTardes(t) : ''); };

    if (hora) {
      await ntfy.publicar(cfgN, {
        titulo,
        mensaje: `¿La hora de entrada del ${nombreDia(fecha)} ${fechaCorreo(fecha)} fue ${hora}?\n${resumenCon(hora)}\n\nToca un botón, o escribe otra hora (ej. 8:30) o "cancelar".`,
        prioridad: 4, etiquetas: ['clipboard'],
        acciones: [ntfy.botonRespuesta(cfgN, `Sí, enviar con ${hora}`, 'si'), ntfy.botonRespuesta(cfgN, 'No, otra hora', 'no')],
      });
      log(`ntfy: pregunta enviada al tema "${cfgN.tema}" con hora propuesta ${hora}. Esperando respuesta hasta ${horasEspera} h...`);
    } else {
      await ntfy.publicar(cfgN, {
        titulo,
        mensaje: `El ${nombreDia(fecha)} ${fechaCorreo(fecha)} no tiene hora de entrada habitual configurada. Hay ${personas.length} persona(s) con marcación.\nEscribe la hora de entrada (ej. 8:00) o "cancelar".`,
        prioridad: 4, etiquetas: ['question'],
      });
      log(`ntfy: se pidió la hora de entrada al tema "${cfgN.tema}" (sin horario habitual).`);
    }

    const limpiarHora = t => t.replace(/\s*(a\.?\s?m\.?|h|hrs?)\.?$/i, '').trim();
    const esSi = t => /^(si|sí|s|yes|ok|dale|listo)\b/i.test(t);
    const esNo = t => /^no\b/i.test(t);
    const esCancelar = t => /^cancel/i.test(t);
    const esHora = t => normalizarHoraEntrada(limpiarHora(t)) != null;

    async function enviarYAvisar(h) {
      try {
        const r = await enviarReporte({ hora: h });
        await avisarEnviado(r);
        if (!(cfgN.avisarEnvios && !r.simulado)) {
          await avisoNtfy(titulo, `${r.simulado ? 'SIMULADO: ' : ''}Correo enviado a ${r.para.join(', ')} con hora de entrada ${r.hora}: ${r.tardes.length} llegada(s) tarde.${cfgN.incluirNombres ? '\n' + textoTardes(r.tardes) : ''}`, { prioridad: 3, etiquetas: ['white_check_mark'] });
        }
        log(`FIN: ${r.simulado ? 'simulación terminada' : 'correo enviado'} con hora de entrada ${r.hora}.`);
      } catch (e) {
        await avisoNtfy(titulo, `ERROR al enviar el correo: ${e.message}. Revisa el equipo.`, { prioridad: 5, etiquetas: ['x'] });
        throw e;
      }
    }

    for (;;) {
      const resp = await ntfy.esperarRespuesta(cfgN, {
        desdeUnix: desde,
        timeoutMs: Math.max(1000, fin - Date.now()),
        filtro: t => esSi(t) || esNo(t) || esCancelar(t) || esHora(t),
        alDescartar: async (t) => {
          log(`ntfy: respuesta no reconocida "${t}"`);
          await avisoNtfy(titulo, `No entendí "${t}". Responde "si", "no", una hora (ej. 8:30) o "cancelar".`, { prioridad: 3 });
        },
        log,
      });
      if (!resp) {
        await avisoNtfy(titulo, `No recibí confirmación en ${horasEspera} h. NO se envió el reporte de hoy. Puedes ejecutarlo manualmente con "npm start".`, { prioridad: 4, etiquetas: ['warning'] });
        log('FIN: sin respuesta por ntfy; no se envió el correo.');
        return;
      }
      const t = resp.texto;
      desde = resp.evento.time;
      log(`ntfy: respuesta recibida "${t}"`);

      if (esCancelar(t)) {
        await avisoNtfy(titulo, 'Cancelado. No se envió el reporte de hoy.', { prioridad: 3 });
        log('FIN: cancelado desde ntfy; no se envió el correo.');
        return;
      }
      if (esSi(t)) {
        if (!hora) { await avisoNtfy(titulo, 'Aún no tengo la hora de entrada. Escríbela (ej. 8:00).', { prioridad: 3 }); continue; }
        return enviarYAvisar(hora);
      }
      if (esNo(t)) {
        await avisoNtfy(titulo, '¿Cuál fue la hora de entrada de hoy? Escríbela en este tema (ejemplo: 8:30).', { prioridad: 4, etiquetas: ['question'] });
        continue;
      }
      // Hora escrita por el usuario
      const nueva = normalizarHoraEntrada(limpiarHora(t));
      hora = nueva;
      const minutos = (config.programacion && config.programacion.minutosDespuesDeEntrada) || 45;
      const limiteSeg = horaASegundos(nueva) + minutos * 60;
      const ahora = new Date();
      const ahoraSeg = ahora.getHours() * 3600 + ahora.getMinutes() * 60 + ahora.getSeconds();
      // Si la hora de entrada se cambia desde ntfy SIEMPRE se vuelve a consultar la biometrica antes
      // de enviar, sin excepciones: los datos que hay se pidieron pensando en otra hora de entrada y
      // pueden ser anteriores a la real, con lo que quien llego tarde todavia no habia marcado.
      // El 17/09/2026 se respondio "9:00" a las 9:32 y salio un reporte de 0 llegadas tarde calculado
      // con datos de las 8:31; las reales eran 14. Una consulta de mas cuesta un minuto, un reporte
      // incompleto va a gerencia y hay que corregirlo.
      // Solo se omite con --excel (no hay biometrica que consultar) o si el reporte no es de hoy.
      if (!args.excel && aISO(ahora) === fechaISO) {
        if (ahoraSeg < limiteSeg) {
          const esperaMs = (limiteSeg - ahoraSeg) * 1000;
          await avisoNtfy(titulo, `Entendido: hora de entrada ${nueva}. Volveré a consultar la biométrica a las ${segundosAHora(limiteSeg, { conSegundos: false })} (${minutos} min después) y enviaré el reporte.`, { prioridad: 3 });
          log(`Hora ${nueva} recibida. Esperando ${Math.ceil(esperaMs / 60000)} min para volver a consultar la biométrica...`);
          await dormir(esperaMs);
        } else {
          const consultadoA = momentoConsultaSeg === null ? '(desconocido)' : segundosAHora(momentoConsultaSeg, { conSegundos: false });
          await avisoNtfy(titulo, `Entendido: hora de entrada ${nueva}. Vuelvo a consultar la biométrica (los datos actuales son de las ${consultadoA}) y enseguida envío el reporte.`, { prioridad: 3 });
          log(`Hora ${nueva} recibida (los datos actuales son de las ${consultadoA}). Se vuelve a consultar la biométrica antes de enviar, porque la hora de entrada cambió.`);
        }
        ({ rutaExcel, personas } = await obtenerPersonas());
      } else {
        await avisoNtfy(titulo, `Entendido: hora de entrada ${nueva}. ${resumenCon(nueva)}. Enviando el correo...`, { prioridad: 3 });
      }
      return enviarYAvisar(nueva);
    }
  }

  // ================= MODO PÁGINA (confirmación local en el navegador) =================
  const estado = {
    fechaISO,
    fechaLarga: fechaLarga(fecha),
    fechaCorreo: fechaCorreo(fecha),
    horaPropuesta: propuesta.hora,
    origenHora: propuesta.origen,
    personas,
    destinatarios: config.correo.destinatarios || [],
    cc: config.correo.cc || [],
    asunto: (config.correo.asunto || 'Reporte Biométrico {fecha}').replace('{fecha}', fechaCorreo(fecha)),
    saludo: config.correo.saludo,
    sinLlegadasTarde: config.correo.sinLlegadasTarde,
    archivoExcel: path.basename(rutaExcel),
  };
  const alEnviar = async (decision) => {
    const r = await enviarReporte({ hora: decision.hora, excluidos: decision.excluidos || [], destinatarios: decision.destinatarios, cc: decision.cc || [], asunto: decision.asunto });
    await avisarEnviado(r);
    return { ...(r.resultado || { simulado: true }), hora: r.hora, llegadasTarde: r.tardes.map(t => t.nombre) };
  };
  const { url, decision } = await iniciarServidorConfirmacion({ estado, puerto: config.confirmacion.puerto || 4545, alEnviar, log });
  log(`Página de confirmación lista en ${url}`);
  const titulo = 'Reporte biométrico listo para revisar';
  const mensaje = propuesta.hora
    ? `Hora de entrada de hoy: ${propuesta.hora}. ${tardesPropuestas.length} llegada(s) tarde. Confirma la hora en el navegador para enviar.`
    : 'Hoy no hay horario habitual configurado. Define la hora de entrada en el navegador para enviar.';
  if (config.confirmacion.notificacionWindows !== false && !args.sinNotificar) await toastWindows(titulo, mensaje);
  if (config.confirmacion.abrirNavegador !== false && !args.sinAbrir) await abrirNavegador(url);
  const resultado = await decision;
  if (resultado.enviado) log(`FIN: correo enviado con hora de entrada ${resultado.resultado.hora}.`);
  else log('FIN: no se envió correo (cancelado por el usuario).');
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    log('ERROR FATAL:', err);
    try { await toastWindows('Reporte biométrico: error', String(err.message || err).slice(0, 200)); } catch (_) { /* ignorar */ }
    if (config.ntfy && config.ntfy.avisarEnvios) await avisoNtfy('Reporte biométrico: error', String(err.message || err).slice(0, 500), { prioridad: 5, etiquetas: ['x'] });
    process.exit(1);
  });
