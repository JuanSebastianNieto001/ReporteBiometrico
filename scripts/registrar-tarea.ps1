# Registra (o actualiza) la tarea programada de Windows que ejecuta el reporte biométrico.
# Por defecto calcula las horas a partir de config.json: hora de entrada habitual de cada día
# + programacion.minutosDespuesDeEntrada (45). Ej.: lunes/martes/jueves 08:45, miércoles/viernes 09:45.
#
# Uso (PowerShell, en la carpeta del proyecto):
#   .\scripts\registrar-tarea.ps1                     -> según config.json
#   .\scripts\registrar-tarea.ps1 -Mostrar            -> solo muestra qué registraría
#   .\scripts\registrar-tarea.ps1 -Hora 10:00 -Dias Monday,Tuesday   -> horario manual
#   .\scripts\registrar-tarea.ps1 -Eliminar           -> quita la tarea
#
# La tarea corre con la sesión del usuario actual (el equipo debe estar encendido y con la sesión iniciada;
# puede estar bloqueado). Lo que ocurre al ejecutarse depende de config.json > confirmacion.modo.
param(
  [string]$Hora,
  [string[]]$Dias = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"),
  [int]$MinutosDespues = 0,
  [switch]$Eliminar,
  [switch]$Mostrar
)

$Nombre = "ReporteBiometrico"
$Raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if ($Eliminar) {
  Unregister-ScheduledTask -TaskName $Nombre -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarea '$Nombre' eliminada."
  exit 0
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $Node)) { Write-Error "No se encontró node.exe. Instala Node.js primero."; exit 1 }

# Horarios: manual (-Hora) o calculados desde config.json
$grupos = @{}
if ($Hora) {
  $grupos[$Hora] = $Dias
} else {
  $cfg = Get-Content (Join-Path $Raiz "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($MinutosDespues -le 0) {
    $MinutosDespues = 45
    if ($cfg.programacion -and $cfg.programacion.minutosDespuesDeEntrada) { $MinutosDespues = [int]$cfg.programacion.minutosDespuesDeEntrada }
  }
  $mapa = @{ lunes = "Monday"; martes = "Tuesday"; miercoles = "Wednesday"; jueves = "Thursday"; viernes = "Friday"; sabado = "Saturday"; domingo = "Sunday" }
  foreach ($p in $cfg.horarioHabitual.PSObject.Properties) {
    if (-not $p.Value) { continue }
    $entrada = [datetime]::ParseExact([string]$p.Value, "H:mm", $null)
    $t = $entrada.AddMinutes($MinutosDespues).ToString("HH:mm")
    if (-not $grupos.ContainsKey($t)) { $grupos[$t] = @() }
    $grupos[$t] += $mapa[$p.Name]
  }
  if ($grupos.Count -eq 0) { Write-Error "config.json > horarioHabitual no tiene ninguna hora configurada."; exit 1 }
}

Write-Host "Tarea '$Nombre' -> $Node src\index.js (carpeta $Raiz)"
foreach ($k in ($grupos.Keys | Sort-Object)) { Write-Host ("  {0}  {1}" -f $k, ($grupos[$k] -join ", ")) }
if ($Mostrar) { exit 0 }

$triggers = @()
foreach ($k in ($grupos.Keys | Sort-Object)) {
  $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek $grupos[$k] -At $k
}
$Accion = New-ScheduledTaskAction -Execute $Node -Argument "src\index.js" -WorkingDirectory $Raiz
$Config = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 12) -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $Nombre -Action $Accion -Trigger $triggers -Settings $Config -Principal $Principal -Force | Out-Null
Write-Host "Tarea '$Nombre' registrada."
Write-Host "Para probarla ahora:  Start-ScheduledTask -TaskName $Nombre"
