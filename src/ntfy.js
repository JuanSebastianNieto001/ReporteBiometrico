'use strict';
// Notificaciones push por ntfy (https://ntfy.sh), gratis y sin abrir puertos en el equipo.
// - publicar(): envía la pregunta/aviso al celular (con botones opcionales).
// - esperarRespuesta(): se queda escuchando el MISMO tema y devuelve lo que el usuario responda
//   (los botones publican "si"/"no"; también puede escribir una hora o "cancelar" desde la app).
// Nuestros mensajes llevan título; las respuestas del usuario/botones no, así se distinguen.

function servidorDe(cfg) { return (cfg.servidor || 'https://ntfy.sh').replace(/\/$/, ''); }
function urlTema(cfg) { return `${servidorDe(cfg)}/${cfg.tema}`; }
function cabecerasAuth(cfg) { return cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}; }
const esperar = ms => new Promise(r => setTimeout(r, ms));

function validar(cfg) {
  if (!cfg || !cfg.tema || /X{4,}/.test(cfg.tema)) throw new Error('Configura config.json > ntfy.tema (nombre del tema al que está suscrito el celular).');
}

async function publicar(cfg, { titulo, mensaje, prioridad = 4, etiquetas = [], acciones = [] }) {
  validar(cfg);
  const cuerpo = { topic: cfg.tema, title: titulo, message: mensaje, priority: prioridad, tags: etiquetas };
  if (acciones.length) cuerpo.actions = acciones;
  const r = await fetch(servidorDe(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecerasAuth(cfg) },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`ntfy respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Botón que, al tocarlo en el celular, publica `texto` en el mismo tema (la respuesta).
function botonRespuesta(cfg, etiqueta, texto) {
  const accion = { action: 'http', label: etiqueta, url: urlTema(cfg), method: 'POST', body: texto, clear: true };
  if (cfg.token) accion.headers = cabecerasAuth(cfg);
  return accion;
}

/**
 * Escucha el tema hasta recibir una respuesta (mensaje sin título) que cumpla `filtro`.
 * desdeUnix: solo se consideran mensajes posteriores a ese instante (segundos Unix).
 * Devuelve { texto, evento } o null si se agota el tiempo.
 */
async function esperarRespuesta(cfg, { desdeUnix, filtro = () => true, timeoutMs, alDescartar, log = () => {} }) {
  validar(cfg);
  const fin = Date.now() + timeoutMs;
  let since = String(desdeUnix);
  while (Date.now() < fin) {
    const ctrl = new AbortController();
    const restante = fin - Date.now();
    const temporizador = setTimeout(() => ctrl.abort(), Math.min(restante, 10 * 60 * 1000)); // reconecta cada 10 min
    try {
      const r = await fetch(`${urlTema(cfg)}/json?since=${encodeURIComponent(since)}`, { signal: ctrl.signal, headers: cabecerasAuth(cfg) });
      if (!r.ok) throw new Error(`ntfy respondió ${r.status}`);
      const lector = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const linea = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!linea) continue;
          let ev;
          try { ev = JSON.parse(linea); } catch (_) { continue; }
          if (ev.event !== 'message') continue;
          since = ev.id;
          if (ev.time < desdeUnix) continue;
          if (ev.title) continue; // mensaje nuestro
          const texto = String(ev.message || '').trim();
          if (filtro(texto, ev)) { clearTimeout(temporizador); ctrl.abort(); return { texto, evento: ev }; }
          if (alDescartar) await alDescartar(texto, ev);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') { log(`ntfy: conexión interrumpida (${e.message}); se reintenta en 10 s`); await esperar(10000); }
    } finally {
      clearTimeout(temporizador);
    }
  }
  return null;
}

module.exports = { publicar, botonRespuesta, esperarRespuesta, urlTema };
