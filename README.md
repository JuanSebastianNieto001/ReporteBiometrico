# Reporte Biométrico automatizado

Automatiza el procedimiento diario documentado en `1.Procedimiento_Reporte_Biometrico.docx`:

1. Entra a **HikCentral Access Control** (`http://192.168.153.4`) con Playwright y hace los mismos clics del procedimiento:
   Control de acceso → Buscar → Búsqueda de acceso de persona → Biometria 1 y 2 → Seleccionar persona →
   Personal Claro Colombia → Seleccionar todos → Añadir → Buscar.
   El botón *Exportar* de HikCentral solo funciona con el plugin local de Hikvision ("componente web") y no envía ninguna
   petición al servidor, así que el programa lee la **misma tabla de resultados** que muestra la página (todas sus páginas)
   y genera el Excel con el formato exacto de la exportación en `descargas\`.
2. Lee ese Excel, agrupa las marcaciones por persona y calcula quién llegó tarde: primera marcación **mayor o igual** a la
   hora de entrada del día. Quien marcó temprano y volvió a marcar después **no** se reporta.
3. Confirma la hora de entrada según el **modo** configurado (ver abajo) y envía el correo por Gmail.

Todo corre en este computador, sin servicios pagos. Verificado contra el sistema real y contra el correo del 3/09/2026
del procedimiento (mismas 11 personas, mismo orden, misma hora del que aparecía repetido).

## Modos de confirmación (`config.json` → `confirmacion.modo`)

| Modo | Qué hace | Para qué |
| --- | --- | --- |
| `inmediato` | Calcula con la hora habitual (o `--hora`) y envía de una vez. | Pruebas (estado actual). |
| `ntfy` | Manda una notificación al celular (app **ntfy**): *"¿La hora de entrada de hoy fue 08:00?"* con botones **Sí, enviar** / **No, otra hora**. Con Sí envía. Con No pregunta la hora real; al escribirla recalcula y envía (si aún no han pasado 45 min desde esa hora, espera y vuelve a consultar la biométrica). También acepta escribir directamente una hora o `cancelar`. | Operación diaria desde el lunes. |
| `pagina` | Aviso de Windows y página local `http://127.0.0.1:4545` con la hora propuesta editable, la lista de llegadas tarde (con casillas para excluir) y vista previa. Envía solo al presionar *Confirmar hora y enviar correo*. | Cuando estás frente al computador. |

## Configuración

### 1. Credenciales: archivo `.env` (no se sube al repositorio)

```
BIO_USUARIO=admin
BIO_CLAVE=tu-clave-de-la-biometrica
GMAIL_USUARIO=tucuenta@tudominio.com
GMAIL_CLAVE_APP=
GMAIL_WEB_USER=tucuenta@tudominio.com
GMAIL_WEB_PASS=tu-clave-de-gmail
```

`GMAIL_WEB_USER` / `GMAIL_WEB_PASS` son la cuenta y la contraseña normal de Gmail; solo se usan con el método `navegador`.
Copia `.env.example` a `.env` y rellena los valores reales. El archivo `.env` no se sube al repositorio.

### Método de envío (`config.json` → `correo.metodo`)

- `navegador` (el que se usa hoy): Playwright maneja la interfaz web de Gmail y envía como si lo hicieras a mano. Inicia sesión con
  `GMAIL_WEB_USER` / `GMAIL_WEB_PASS` (la contraseña normal de la cuenta) y guarda la sesión en `.perfil-gmail\` para no repetir el login
  cada día. La primera vez Google manda una "Alerta de seguridad" por el nuevo acceso; es normal. No requiere verificación en 2 pasos ni SMTP.
- `smtp`: envío directo por SMTP; necesita contraseña de aplicación u OAuth (abajo). Más robusto para tareas programadas, pero requiere configuración de Google.

**Gmail no acepta la contraseña normal de la cuenta para enviar por SMTP** (responde `535-5.7.8 Username and Password not accepted`).
Por eso, para el método `smtp` hay dos opciones, cualquiera sirve:

- **Contraseña de aplicación** (la más simple). Solo aparece con la *Verificación en 2 pasos* activa; si la página
  <https://myaccount.google.com/apppasswords> dice "no está disponible para tu cuenta" es porque la verificación en 2 pasos está apagada.
  1. Activa la verificación en 2 pasos en <https://myaccount.google.com/signinoptions/two-step-verification> (con el celular).
  2. Vuelve a <https://myaccount.google.com/apppasswords>, crea una llamada "Reporte Biometrico" y pega los 16 caracteres en `GMAIL_CLAVE_APP`.
  3. Si sigue sin aparecer, el administrador de Google Workspace debe permitirla (Consola de administración → Seguridad → Autenticación → Verificación en 2 pasos).
- **OAuth2** (sin verificación en 2 pasos): crea un ID de cliente OAuth de tipo *Aplicación de escritorio* en Google Cloud Console,
  guarda su JSON como `gmail-oauth-cliente.json` y ejecuta `npm run gmail:autorizar`. Los pasos detallados están al inicio de
  [scripts/autorizar-gmail.js](scripts/autorizar-gmail.js). Si existe `gmail-oauth-token.json`, el programa usa OAuth automáticamente.

Prueba el envío en segundos con `npm run correo:prueba` (manda un correo marcado `[PRUEBA]` con los datos de ejemplo).

### 2. `config.json`

```json
"horarioHabitual": { "lunes": "08:00", "martes": "08:00", "miercoles": "09:00", "jueves": "08:00", "viernes": "09:00", "sabado": null, "domingo": null },
"excepcionesPorFecha": { "2026-09-12": "09:00" },
"programacion": { "minutosDespuesDeEntrada": 45 },
"correo": { "destinatarios": ["correo1@empresa.com", "correo2@empresa.com"], "cc": [], "asunto": "Reporte Biométrico {fecha}" },
"confirmacion": { "modo": "inmediato", "esperaRespuestaHoras": 8 },
"ntfy": { "servidor": "https://ntfy.sh", "tema": "reporte-biometrico-voz360-...", "incluirNombres": false, "avisarEnvios": true }
```

- `horarioHabitual`: hora de entrada que se propone cada día; `null` = sin horario fijo (se pide la hora).
- `excepcionesPorFecha`: cambios puntuales ya conocidos; tienen prioridad sobre el habitual.
- `programacion.minutosDespuesDeEntrada`: el reporte se ejecuta 45 min después de la hora de entrada (tarea programada) y es el tiempo que espera si por ntfy se indica una hora posterior.
- `correo.destinatarios`: hoy está el correo de prueba; cámbialo por los reales antes del lunes. `{fecha}` en el asunto se reemplaza por la fecha (ej. `3/09/2026`).
  `saludo`, `sinLlegadasTarde`, `despedida` y `firmaHtml` completan el mensaje.
- `correo.adjuntarExcel`: `true` (por defecto) adjunta al correo el Excel exportado desde `descargas\`. Ponlo en `false` para enviar solo el texto.
- `ntfy.tema`: nombre del tema (largo y aleatorio, funciona como contraseña). `incluirNombres: true` agrega la lista de llegadas tarde a la notificación (por defecto solo va la cantidad, porque los temas de ntfy.sh son públicos para quien conozca el nombre).
- `biometrica.headless`: `true` oculta el navegador (recomendado para la tarea programada). Con `npm run explorar` siempre se ve.

## ntfy en el celular (para el modo `ntfy`)

1. Instala la app **ntfy** (Android: Play Store / F-Droid; iPhone: App Store).
2. Suscríbete al tema que está en `config.json` → `ntfy.tema` (botón **+**, escribe el nombre exacto).
3. Cuando llegue la pregunta, toca **Sí, enviar** o **No, otra hora**. Si respondes No, escribe la hora en ese mismo tema
   (ícono de mensaje dentro del tema), por ejemplo `8:30`. También puedes escribir `cancelar`.
4. Tus propias respuestas aparecen como mensajes en el tema; es normal.

## Uso

| Comando | Qué hace |
| --- | --- |
| `npm start` | Flujo completo con el modo de `config.json`. |
| `node src\index.js --modo inmediato --hora 08:00` | Fuerza modo y hora (útil un sábado, que no tiene hora habitual). |
| `node src\index.js --modo ntfy` | Prueba el modo ntfy hoy mismo. |
| `npm run probar -- ejemplos\Busqueda_de_acceso_de_persona_ejemplo.xlsx --fecha 2026-09-03 --hora 09:00 --sin-enviar` | Sin navegador ni correo: muestra exactamente qué enviaría con los datos del 3/09/2026. |
| `npm run correo:prueba` | Envía un correo `[PRUEBA]` a los destinatarios (o a uno pasado como parámetro). |
| `npm run explorar` | Solo la biométrica, con el navegador visible y en cámara lenta; capturas en `logs\capturas\`. |
| `npm run tarea` | Registra la tarea programada de Windows (ver abajo). |

Parámetros de `node src\index.js`: `--modo`, `--hora HH:MM`, `--excel <ruta>`, `--fecha AAAA-MM-DD`, `--sin-enviar` (simula), `--sin-abrir`, `--sin-notificar`.

## Programar la ejecución diaria (45 min después de la hora de entrada)

```powershell
npm run tarea                                 # 08:45 lunes/martes/jueves y 09:45 miércoles/viernes, según config.json
.\scripts\registrar-tarea.ps1 -Mostrar        # solo muestra el horario calculado
.\scripts\registrar-tarea.ps1 -Eliminar       # quita la tarea
```

El equipo debe estar encendido y con la sesión iniciada (puede estar bloqueado). Si estaba apagado a esa hora, la tarea corre al
encenderlo. Con `confirmacion.modo = "ntfy"` la tarea consulta la biométrica, manda la pregunta al celular y espera la respuesta
hasta `esperaRespuestaHoras`.

## Estructura

```
src/index.js        orquestador y los tres modos de confirmación
src/biometrica.js   Playwright: login, filtros, búsqueda y lectura de la tabla en HikCentral -> Excel
src/excel.js        lectura del Excel (detecta la fila de encabezado Nombre/Departamento/Hora)
src/reporte.js      hora de entrada del día y cálculo de llegadas tarde
src/ntfy.js         notificaciones y respuestas por ntfy
src/confirmar.js    página local de confirmación (modo pagina)
src/correo.js       armado del correo y envío por SMTP (contraseña de aplicación u OAuth2)
src/correo-navegador.js  envío manejando Gmail web con Playwright (método "navegador")
src/notificar.js    aviso de Windows y apertura del navegador
scripts/            explorar.js, probar-correo.js, autorizar-gmail.js, registrar-tarea.ps1, crear-excel-ejemplo.js
ejemplos/           Excel de ejemplo con el formato real de exportación (datos del 3/09/2026)
descargas/  logs/   Excel generados y registro diario de cada ejecución (no se suben al repositorio)
```

## Solución de problemas

- **"La biométrica no aceptó el inicio de sesión"**: revisa `BIO_USUARIO` y `BIO_CLAVE` en `.env`. El programa hace **un solo intento**
  por ejecución porque HikCentral **bloquea la IP después de 4 intentos fallidos**.
- **Falló un paso de la biométrica**: mira `logs\capturas\<fecha>_error_<paso>.png` (y el `.html` del mismo nombre) y el log del día.
  Si cambió un texto de la página (nombre de un punto de acceso o del departamento), ajústalo en `config.json` (`puntosAcceso`, `departamento`).
- **Aviso "El servicio de componente web no está disponible" (Pista)**: es el plugin de Hikvision; el programa lo cierra solo. No hace falta instalarlo.
- **"Se leyeron N filas pero la página indica un total de M"**: la paginación no avanzó; revisa la captura `07_resultados`.
- **Error al enviar el correo (método `smtp`)**: `535-5.7.8` = Gmail rechazó la credencial (ver sección de Gmail). Con OAuth, vuelve a ejecutar `npm run gmail:autorizar`.
- **Error al enviar el correo (método `navegador`)**: mira las capturas `logs\capturas\<fecha>_gmail_*.png`. Si Google pidió "Verifica que eres tú" o dice
  que el navegador no es seguro, borra la carpeta `.perfil-gmail\`, ejecuta una vez el envío y completa el inicio de sesión a mano en la ventana que abre;
  la sesión queda guardada y las siguientes veces no la vuelve a pedir. Si cambiaste la contraseña de la cuenta, actualiza `GMAIL_WEB_PASS` en `.env`.
- **No llega la notificación ntfy**: comprueba que el celular esté suscrito exactamente al tema de `config.json` y que el equipo tenga internet.
- **El puerto 4545 está ocupado** (modo pagina): cambia `confirmacion.puerto`.
