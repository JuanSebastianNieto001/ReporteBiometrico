'use strict';
// Servidor local (solo 127.0.0.1) con la página de confirmación.
// Muestra la hora de entrada propuesta y las llegadas tarde calculadas; el usuario
// puede corregir la hora, quitar personas puntuales y recién entonces confirmar el envío.
// NADA se envía hasta que se presione "Confirmar hora y enviar correo".
const http = require('http');

function leerJson(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', c => { datos += c; if (datos.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(datos ? JSON.parse(datos) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function responderJson(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/**
 * estado: { fechaISO, fechaLarga, fechaCorreo, horaPropuesta, origenHora, personas,
 *           destinatarios, cc, asunto, saludo, sinLlegadasTarde, archivoExcel }
 * alEnviar(decision) -> Promise<resultado>  (se llama SOLO cuando el usuario confirma)
 * Devuelve { url, decision: Promise<{enviado, cancelado, ...}>, cerrar() }
 */
function iniciarServidorConfirmacion({ estado, puerto, alEnviar, log = console.log }) {
  let resolverDecision;
  const decision = new Promise(r => { resolverDecision = r; });
  let cerrado = false;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(paginaHtml(estado));
        return;
      }
      if (req.method === 'GET' && req.url === '/estado') { responderJson(res, 200, estado); return; }
      if (req.method === 'POST' && req.url === '/enviar') {
        if (cerrado) { responderJson(res, 409, { ok: false, error: 'El proceso ya terminó.' }); return; }
        const cuerpo = await leerJson(req);
        log(`Confirmación recibida desde la página: hora=${cuerpo.hora} excluidos=${(cuerpo.excluidos || []).length} destinatarios=${(cuerpo.destinatarios || []).join(',')}`);
        try {
          const resultado = await alEnviar(cuerpo);
          cerrado = true;
          responderJson(res, 200, { ok: true, resultado });
          setTimeout(() => { server.close(); resolverDecision({ enviado: true, cancelado: false, ...cuerpo, resultado }); }, 800);
        } catch (e) {
          log('Error al enviar:', e);
          responderJson(res, 500, { ok: false, error: e.message });
        }
        return;
      }
      if (req.method === 'POST' && req.url === '/cancelar') {
        cerrado = true;
        responderJson(res, 200, { ok: true });
        log('El usuario decidió NO enviar el correo hoy.');
        setTimeout(() => { server.close(); resolverDecision({ enviado: false, cancelado: true }); }, 800);
        return;
      }
      res.writeHead(404); res.end('No encontrado');
    } catch (e) {
      responderJson(res, 500, { ok: false, error: e.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(puerto, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${puerto}/`;
      resolve({ url, decision, cerrar: () => { cerrado = true; server.close(); } });
    });
  });
}

function paginaHtml(estado) {
  const json = JSON.stringify(estado).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte biométrico · confirmar envío</title>
<style>
  :root{--bg:#f4f5f7;--card:#fff;--txt:#1c1e21;--muted:#6b7280;--acc:#c62828;--ok:#1b7f3b;--line:#e5e7eb}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.45 "Segoe UI",system-ui,Arial,sans-serif}
  .wrap{max-width:980px;margin:0 auto;padding:24px 16px 60px}
  h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .card h2{font-size:16px;margin:0 0 12px}
  label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}
  input[type=text],input[type=time],textarea{width:100%;padding:9px 10px;border:1px solid #cfd3d8;border-radius:6px;font:inherit}
  input[type=time]{max-width:180px;font-size:22px;font-weight:600;letter-spacing:1px}
  .fila{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end}
  .aviso{background:#fff7e6;border:1px solid #ffd591;color:#7a4b00;border-radius:8px;padding:10px 12px;margin:10px 0 0;font-size:14px}
  .pill{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:2px 10px;font-size:12px;margin-left:6px;vertical-align:middle}
  table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
  tr.excluido td{color:#9ca3af;text-decoration:line-through}
  .hora{font-variant-numeric:tabular-nums;font-weight:600}
  .acciones{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:8px}
  button{font:inherit;border:0;border-radius:8px;padding:12px 20px;cursor:pointer;font-weight:600}
  .btn-enviar{background:var(--acc);color:#fff;font-size:16px}.btn-enviar:disabled{background:#e5a3a3;cursor:not-allowed}
  .btn-sec{background:#e5e7eb;color:#111}
  pre{background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:12px;white-space:pre-wrap;font:13px/1.5 Consolas,monospace;max-height:320px;overflow:auto}
  details summary{cursor:pointer;color:#374151;font-weight:600}
  .estado{margin-top:12px;font-weight:600}.ok{color:var(--ok)}.err{color:var(--acc)}
  .vacio{color:var(--muted);padding:12px 0}
  .small{font-size:12px;color:var(--muted)}
</style></head><body><div class="wrap">
  <h1>Reporte biométrico · <span id="fechaLarga"></span></h1>
  <p class="sub">El correo <strong>no se envía</strong> hasta que confirmes la hora de entrada y presiones el botón rojo. Archivo: <span id="archivo" class="small"></span></p>

  <div class="card">
    <h2>1. Hora de entrada de hoy <span class="pill" id="origenHora"></span></h2>
    <div class="fila">
      <div><label for="hora">Hora de entrada (quien marque a esta hora o después llegó tarde)</label>
        <input type="time" id="hora" step="60"></div>
      <div class="small" id="resumen"></div>
    </div>
    <div class="aviso" id="avisoHora" hidden></div>
  </div>

  <div class="card">
    <h2>2. Llegadas tarde <span class="pill" id="conteo"></span></h2>
    <p class="small">Se toma la <strong>primera</strong> marcación de cada persona. Desmarca a quien no deba ir en el correo.</p>
    <div id="tablaTardes"></div>
    <details style="margin-top:12px"><summary>Ver todas las personas del día (<span id="totalPersonas"></span>)</summary><div id="tablaTodos" style="margin-top:8px"></div></details>
  </div>

  <div class="card">
    <h2>3. Correo</h2>
    <div class="fila">
      <div style="flex:1;min-width:280px"><label for="para">Para (separados por coma)</label><input type="text" id="para" placeholder="correo1@dominio.com, correo2@dominio.com"></div>
      <div style="flex:1;min-width:280px"><label for="cc">CC (opcional)</label><input type="text" id="cc"></div>
    </div>
    <div style="margin-top:12px"><label>Asunto</label><input type="text" id="asunto"></div>
    <div style="margin-top:12px"><label>Vista previa del mensaje</label><pre id="preview"></pre></div>
    <div class="acciones">
      <button class="btn-enviar" id="btnEnviar">Confirmar hora y enviar correo</button>
      <button class="btn-sec" id="btnCancelar">No enviar hoy</button>
    </div>
    <div class="estado" id="estadoEnvio"></div>
  </div>
</div>
<script>
const E = ${json};
const el = id => document.getElementById(id);
const excluidos = new Set();
function seg(h){ const m=String(h||'').trim().match(/^(\\d{1,2})(?::(\\d{1,2}))?(?::(\\d{1,2}))?$/); if(!m) return null; if(+m[1]>23||+(m[2]||0)>59) return null; return (+m[1])*3600+(+(m[2]||0))*60+(+(m[3]||0)); }
function fmt(s, cero){ const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return (cero?String(h).padStart(2,'0'):h)+':'+String(m).padStart(2,'0')+':'+String(x).padStart(2,'0'); }
function esc(t){ return String(t).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function dep(d){ return String(d||'').replace(/^All Departments\\s*>\\s*/,''); }

el('fechaLarga').textContent = E.fechaLarga;
el('archivo').textContent = E.archivoExcel || '(sin archivo)';
el('origenHora').textContent = E.horaPropuesta ? ('propuesta: ' + E.horaPropuesta + ' · ' + E.origenHora) : ('sin propuesta · ' + E.origenHora);
el('hora').value = E.horaPropuesta || '';
el('para').value = (E.destinatarios||[]).join(', ');
el('cc').value = (E.cc||[]).join(', ');
el('asunto').value = E.asunto || '';
el('totalPersonas').textContent = E.personas.length;

function tardesActuales(){
  const s = seg(el('hora').value);
  if (s==null) return null;
  return E.personas.filter(p => p.primeraSeg >= s).sort((a,b)=>b.primeraSeg-a.primeraSeg);
}
function render(){
  const s = seg(el('hora').value);
  const aviso = el('avisoHora');
  if (s==null){
    aviso.hidden=false; aviso.textContent='Escribe una hora de entrada válida (por ejemplo 08:00) para calcular las llegadas tarde.';
    el('tablaTardes').innerHTML=''; el('conteo').textContent='—'; el('btnEnviar').disabled=true; el('preview').textContent=''; el('resumen').textContent=''; return;
  }
  if (!E.horaPropuesta){ aviso.hidden=false; aviso.textContent='Hoy no tiene horario habitual configurado (' + E.origenHora + '). Revisa bien la hora antes de enviar.'; }
  else if (el('hora').value !== E.horaPropuesta){ aviso.hidden=false; aviso.textContent='Cambiaste la hora habitual (' + E.horaPropuesta + '). Se usará ' + el('hora').value + ' solo para este envío.'; }
  else aviso.hidden=true;
  const tardes = tardesActuales();
  const incl = tardes.filter(p=>!excluidos.has(p.nombre));
  el('conteo').textContent = incl.length + ' de ' + E.personas.length;
  el('resumen').innerHTML = 'Marcaciones del día: <b>'+E.personas.length+'</b> personas · llegadas tarde: <b>'+incl.length+'</b>' + (excluidos.size? ' · excluidas: '+excluidos.size:'');
  if (!tardes.length) el('tablaTardes').innerHTML = '<div class="vacio">Nadie marcó a la hora de entrada o después. El correo indicará que no hay llegadas tarde.</div>';
  else el('tablaTardes').innerHTML = '<table><thead><tr><th></th><th>Nombre</th><th>Departamento</th><th>Primera marcación</th><th>Marcaciones</th></tr></thead><tbody>' +
    tardes.map(p => '<tr class="'+(excluidos.has(p.nombre)?'excluido':'')+'"><td><input type="checkbox" data-n="'+esc(p.nombre)+'" '+(excluidos.has(p.nombre)?'':'checked')+'></td><td>'+esc(p.nombre)+'</td><td class="small">'+esc(dep(p.departamento))+'</td><td class="hora">'+fmt(p.primeraSeg,true)+'</td><td class="small">'+p.marcaciones.map(m=>fmt(m,true)).join(', ')+'</td></tr>').join('') + '</tbody></table>';
  el('tablaTardes').querySelectorAll('input[type=checkbox]').forEach(ch => ch.onchange = () => { if (ch.checked) excluidos.delete(ch.dataset.n); else excluidos.add(ch.dataset.n); render(); });
  const lineas = incl.length ? incl.map(p => p.nombre + '\\t' + fmt(p.primeraSeg,false)).join('\\n') : E.sinLlegadasTarde;
  el('preview').textContent = E.saludo + '\\n\\n' + lineas;
  el('btnEnviar').disabled = false;
}
el('tablaTodos').innerHTML = '<table><thead><tr><th>Nombre</th><th>Departamento</th><th>Primera</th><th>Última</th><th>#</th></tr></thead><tbody>' +
  E.personas.map(p=>'<tr><td>'+esc(p.nombre)+'</td><td class="small">'+esc(dep(p.departamento))+'</td><td class="hora">'+fmt(p.primeraSeg,true)+'</td><td class="hora">'+fmt(p.ultimaSeg,true)+'</td><td>'+p.marcaciones.length+'</td></tr>').join('') + '</tbody></table>';
el('hora').addEventListener('input', render);
render();

function listaCorreos(v){ return v.split(/[,;\\s]+/).map(x=>x.trim()).filter(Boolean); }
el('btnEnviar').onclick = async () => {
  const hora = el('hora').value; if (seg(hora)==null) return;
  const para = listaCorreos(el('para').value);
  if (!para.length){ el('estadoEnvio').className='estado err'; el('estadoEnvio').textContent='Escribe al menos un destinatario.'; return; }
  const tardes = tardesActuales().filter(p=>!excluidos.has(p.nombre));
  if (!confirm('¿Confirmas que la hora de entrada de hoy es ' + hora + ' y quieres enviar el correo a ' + para.length + ' destinatario(s) con ' + tardes.length + ' llegada(s) tarde?')) return;
  el('btnEnviar').disabled = true; el('btnCancelar').disabled = true;
  el('estadoEnvio').className='estado'; el('estadoEnvio').textContent='Enviando…';
  try {
    const r = await fetch('/enviar', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ hora, excluidos:[...excluidos], destinatarios: para, cc: listaCorreos(el('cc').value), asunto: el('asunto').value }) });
    const j = await r.json();
    if (j.ok){ el('estadoEnvio').className='estado ok'; el('estadoEnvio').textContent='Correo enviado correctamente. Ya puedes cerrar esta pestaña.'; }
    else { el('estadoEnvio').className='estado err'; el('estadoEnvio').textContent='No se pudo enviar: ' + j.error; el('btnEnviar').disabled=false; el('btnCancelar').disabled=false; }
  } catch(e){ el('estadoEnvio').className='estado err'; el('estadoEnvio').textContent='Error de conexión con el proceso local: ' + e.message; el('btnEnviar').disabled=false; el('btnCancelar').disabled=false; }
};
el('btnCancelar').onclick = async () => {
  if (!confirm('¿Seguro que NO quieres enviar el reporte de hoy? El proceso terminará sin enviar nada.')) return;
  await fetch('/cancelar', { method:'POST' });
  el('estadoEnvio').className='estado'; el('estadoEnvio').textContent='Proceso cancelado. No se envió ningún correo.';
  el('btnEnviar').disabled = true; el('btnCancelar').disabled = true;
};
</script></body></html>`;
}

module.exports = { iniciarServidorConfirmacion };
