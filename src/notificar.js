'use strict';
// Notificación de Windows (toast) y apertura del navegador. Sin dependencias externas.
const { execFile } = require('child_process');

function ps(texto) { return String(texto).replace(/'/g, "''"); }

function toastWindows(titulo, mensaje) {
  return new Promise(resolve => {
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$plantilla = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$nodos = $plantilla.GetElementsByTagName('text')
$nodos.Item(0).AppendChild($plantilla.CreateTextNode('${ps(titulo)}')) | Out-Null
$nodos.Item(1).AppendChild($plantilla.CreateTextNode('${ps(mensaje)}')) | Out-Null
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
$toast = [Windows.UI.Notifications.ToastNotification]::new($plantilla)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;
    const codificado = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', codificado],
      { windowsHide: true, timeout: 20000 },
      (err) => resolve(!err));
  });
}

function abrirNavegador(url) {
  return new Promise(resolve => {
    execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, (err) => resolve(!err));
  });
}

module.exports = { toastWindows, abrirNavegador };
