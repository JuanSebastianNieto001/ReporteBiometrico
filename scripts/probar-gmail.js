'use strict';
// Comprueba que el inicio de sesión en Gmail web (método "navegador") funcione.
// NO redacta ni envía ningún correo: solo entra a la bandeja y guarda la sesión en .perfil-gmail
// para que los envíos diarios no vuelvan a pedir el login.
//
//   npm run gmail:probar

const config = require('../src/config');
const { verificarAccesoGmail } = require('../src/correo-navegador');

verificarAccesoGmail({ config, log: (...a) => console.log(...a) })
  .then(r => { console.log(`\nOK: acceso a Gmail verificado para ${r.usuario}. Sesión guardada en ${r.perfil}`); process.exit(0); })
  .catch(e => { console.error('\nFALLÓ:', e.message); process.exit(1); });
