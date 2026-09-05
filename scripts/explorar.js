'use strict';
// Ejecuta SOLO la parte de la biométrica (login -> búsqueda -> exportar) con el navegador visible
// y en cámara lenta, dejando capturas en logs/capturas/. Útil para ver dónde falla si la página cambia.
//   node scripts/explorar.js            (navegador visible, 400 ms entre acciones, queda abierto 20 s al final)
const config = require('../src/config');
const { iniciar, log } = require('../src/log');
const { exportarExcel } = require('../src/biometrica');

iniciar(config.rutas.logs);
config.biometrica.headless = false;
config.biometrica.slowMo = config.biometrica.slowMo || 400;
config.biometrica.mantenerAbierto = config.biometrica.mantenerAbierto || 20;

exportarExcel({ config, log })
  .then(ruta => { log('Exploración terminada. Excel:', ruta); process.exit(0); })
  .catch(e => { log('Exploración con error:', e.message); process.exit(1); });
