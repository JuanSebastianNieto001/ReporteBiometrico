# Registra (o actualiza) las tareas programadas de Windows que ejecutan el reporte biométrico.
# Por defecto hay UNA TAREA POR HORA DE ENTRADA de config.json > horarioHabitual (un día puede tener
# varias: "lunes": ["08:00", "09:00"]). Cada tarea corre programacion.minutosDespuesDeEntrada (45)
# después de su hora, y también al iniciar sesión por si el equipo estaba apagado, y ejecuta
# "node src\index.js --hora HH:MM --programada" para esa hora. Ej.:
#   ReporteBiometrico-0800  08:45  lunes a viernes
#   ReporteBiometrico-0900  09:45  lunes a viernes
#   ReporteBiometrico-1000  10:45  jueves y viernes
# Van en tareas separadas (y no en una con varios disparadores) porque una tarea no arranca otra vez
# mientras sigue corriendo, y el reporte de las 8:00 puede seguir esperando la respuesta de ntfy a las 9:30.
#
# Uso (PowerShell, en la carpeta del proyecto):
#   .\scripts\registrar-tarea.ps1                     -> según config.json
#   .\scripts\registrar-tarea.ps1 -Mostrar            -> solo muestra qué registraría
#   .\scripts\registrar-tarea.ps1 -Hora 10:00 -Dias Monday,Tuesday   -> una sola tarea manual, sin --hora
#   .\scripts\registrar-tarea.ps1 -Eliminar           -> quita todas las tareas del reporte
#
# Las tareas corren con la sesión del usuario actual (el equipo debe estar encendido y con la sesión iniciada;
# puede estar bloqueado). Lo que ocurre al ejecutarse depende de config.json > confirmacion.modo.
param(
  [string]$Hora,
  [string[]]$Dias = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"),
  [int]$MinutosDespues = 0,
  [switch]$Eliminar,
  [switch]$Mostrar
)

$Prefijo = "ReporteBiometrico"
$Raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Get-TareasReporte { Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -eq $Prefijo -or $_.TaskName -like "$Prefijo-*" } }

if ($Eliminar) {
  foreach ($t in Get-TareasReporte) {
    Unregister-ScheduledTask -TaskName $t.TaskName -Confirm:$false
    Write-Host "Tarea '$($t.TaskName)' eliminada."
  }
  exit 0
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $Node)) { Write-Error "No se encontró node.exe. Instala Node.js primero."; exit 1 }

# Tareas a registrar: nombre -> @{ Disparo = "HH:mm"; Dias = @(...); Argumentos = "..." }
$tareas = [ordered]@{}
if ($Hora) {
  $tareas[$Prefijo] = @{ Disparo = $Hora; Dias = $Dias; Argumentos = "src\index.js" }
} else {
  $cfg = Get-Content (Join-Path $Raiz "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($MinutosDespues -le 0) {
    $MinutosDespues = 45
    if ($cfg.programacion -and $cfg.programacion.minutosDespuesDeEntrada) { $MinutosDespues = [int]$cfg.programacion.minutosDespuesDeEntrada }
  }
  $mapa = [ordered]@{ lunes = "Monday"; martes = "Tuesday"; miercoles = "Wednesday"; jueves = "Thursday"; viernes = "Friday"; sabado = "Saturday"; domingo = "Sunday" }
  $porHora = @{}
  foreach ($dia in $mapa.Keys) {
    foreach ($h in @($cfg.horarioHabitual.$dia)) {
      if (-not $h) { continue }
      $entrada = [datetime]::ParseExact([string]$h, "H:mm", $null).ToString("HH:mm")
      if (-not $porHora.ContainsKey($entrada)) { $porHora[$entrada] = @() }
      $porHora[$entrada] += $mapa[$dia]
    }
  }
  if ($porHora.Count -eq 0) { Write-Error "config.json > horarioHabitual no tiene ninguna hora configurada."; exit 1 }
  foreach ($entrada in ($porHora.Keys | Sort-Object)) {
    $disparo = [datetime]::ParseExact($entrada, "HH:mm", $null).AddMinutes($MinutosDespues).ToString("HH:mm")
    $tareas["$Prefijo-" + $entrada.Replace(":", "")] = @{ Disparo = $disparo; Dias = $porHora[$entrada]; Argumentos = "src\index.js --hora $entrada --programada"; AlIniciarSesion = $true }
  }
}

Write-Host "Node: $Node (carpeta $Raiz)"
foreach ($n in $tareas.Keys) { Write-Host ("  {0,-24} {1}  {2,-32} {3}" -f $n, $tareas[$n].Disparo, ($tareas[$n].Dias -join ", "), $tareas[$n].Argumentos) }
$sobran = @(Get-TareasReporte | Where-Object { -not $tareas.Contains($_.TaskName) })
foreach ($t in $sobran) { Write-Host "  (se elimina la tarea anterior '$($t.TaskName)')" }
if ($Mostrar) { exit 0 }

foreach ($t in $sobran) { Unregister-ScheduledTask -TaskName $t.TaskName -Confirm:$false }

# -StartWhenAvailable: si el equipo estaba apagado a la hora del disparador, corre al encenderlo.
# -WakeToRun: despierta el equipo si alguien vuelve a activar la suspension (deberia estar en 'Nunca').
# -ExecutionTimeLimit 12 h: cubre la espera de la respuesta por ntfy (confirmacion.esperaRespuestaHoras).
# Las opciones de bateria evitan que Windows se niegue a arrancar o corte la tarea si el equipo
# queda alimentado por un UPS que se reporta como bateria.
# A PROPOSITO no se configura reintento automatico: cada reintento repetiria el inicio de sesion en
# HikCentral, que bloquea la IP tras 4 intentos fallidos. Si falla, se revisa el log y se corre a mano.
$Config = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 12) -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

foreach ($n in $tareas.Keys) {
  $t = $tareas[$n]
  $Accion = New-ScheduledTaskAction -Execute $Node -Argument $t.Argumentos -WorkingDirectory $Raiz
  $Disparadores = @(New-ScheduledTaskTrigger -Weekly -DaysOfWeek $t.Dias -At $t.Disparo)
  # Segundo disparador al iniciar sesión: si el equipo estaba apagado a la hora del reporte, corre
  # apenas se entra. Con --programada el programa decide si toca (día con esa hora, ya pasó la hora
  # de envío, no se envió/canceló antes), así que iniciar sesión otras veces no duplica nada.
  if ($t.AlIniciarSesion) { $Disparadores += New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME" }
  Register-ScheduledTask -TaskName $n -Action $Accion -Trigger $Disparadores -Settings $Config -Principal $Principal -Force | Out-Null
  Write-Host "Tarea '$n' registrada."
}
Write-Host "Para probar una ahora:  Start-ScheduledTask -TaskName <nombre>"
