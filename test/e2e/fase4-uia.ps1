# fase4-uia.ps1 (tarea 4.9): interacción con ventanas nativas de la app por UI
# Automation de Windows (System.Windows.Automation). Los diálogos de
# dialog.showMessageBox (cierre seguro 4.4, recarga tras caída 4.7) no son DOM: se# manejan aquí.
#
#   click-dialog -AppPid X -Title 'Cerrar OpenSpecControl' -Button 'Cerrar igual'
#       espera el diálogo cuyo título contenga -Title entre las ventanas del
#       proceso, lista sus botones y pulsa -Button: foco UIA al botón + Espacio (los
#       CCPushButton del MessageBox no exponen InvokePattern y ignoran el clic
#       sintético). La tecla solo se envía con la app en primer plano.
#   dump-dialog -AppPid X -Title '...'
#       vuelca el árbol UIA del diálogo (depuración).
#   taskbar-appids
#       AppUserModelID de cada botón de la barra de tareas (AutomationId 'Appid: ...').
#   fg -AppPid X
#       quién tiene el primer plano (diagnóstico de la entrada inyectada).
#
# El menú Archivo → Salir NO se maneja por UIA: el desplegable de Chromium no
# expone patrones, el clic sintético se ignora y las teclas dependen de que nadie
# más robe el primer plano. Ese camino (role quit → app.quit() → before-quit) se
# ejerce desde fase4-cierre.mjs por el inspector del proceso principal.
#
# Todas las acciones responden JSON en stdout.

param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$AppPid = 0,
  [string]$Title = '',
  [string]$Button = '',
  [int]$TimeoutSec = 40
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Out-Json($obj) { $obj | ConvertTo-Json -Compress -Depth 6 }

# clic físico en (x, y) de pantalla: los botones del MessageBox de Electron
# (CCPushButton) no exponen InvokePattern, así que se pulsa con el ratón real
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  public const uint LEFTDOWN = 0x02, LEFTUP = 0x04;
  // Un clic "instantáneo" (mover+bajar+subir sin pausas) lo ignora el botón del
  // TaskDialog: necesita ver primero el hover y recibir el foco. Se mueve el
  // cursor, se espera, se baja y se sube el botón con pausas.
  public static void Click(int x, int y) {
    SetCursorPos(x - 3, y);
    System.Threading.Thread.Sleep(120);
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(200);
    mouse_event(LEFTDOWN, x, y, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(120);
    mouse_event(LEFTUP, x, y, 0, UIntPtr.Zero);
  }
}
"@

# SEGURIDAD: SendKeys y el ratón actúan sobre lo que tenga el primer plano, no
# sobre un proceso concreto. Antes de inyectar entrada se exige que la ventana en
# primer plano sea del proceso de la app; si no, se aborta (nunca se teclea sobre
# una ventana ajena del usuario).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Fg32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static int ForegroundPid() {
    int p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p;
  }
  // el "truco" de Alt: pulsar y soltar Alt permite a SetForegroundWindow robar el foco
  public static void Steal(IntPtr h) {
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
  }
}
"@

function Test-AppForeground {
  return ([Fg32]::ForegroundPid() -eq $AppPid)
}

# Intenta dejar la ventana de la app en primer plano; true solo si lo logra.
function Focus-App {
  $p = Get-Process -Id $AppPid -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  # el diálogo modal o la ventana principal: se prueba con la que Windows llame principal
  $h = [IntPtr]$p.MainWindowHandle
  if ($h -eq [IntPtr]::Zero) { return $false }
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-AppForeground) { return $true }
    [Fg32]::Steal($h)
    Start-Sleep -Milliseconds 200
  }
  return (Test-AppForeground)
}

function Send-KeysSafe([string]$keys) {
  if (-not (Test-AppForeground) -and -not (Focus-App)) {
    $fg = [Fg32]::ForegroundPid()
    throw "la ventana en primer plano (pid $fg) no es de la app (pid $AppPid): no se envían teclas"
  }
  [System.Windows.Forms.SendKeys]::SendWait($keys)
}

function Click-Element($el) {
  # 1) InvokePattern si existe; 2) clic físico en el centro del rectángulo
  foreach ($pat in @('InvokePattern')) {
    $supported = $el.GetSupportedPatterns() | Where-Object { $_.ProgrammaticName -eq $pat }
    if ($supported) {
      $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      return 'invoke'
    }
  }
  # 2) el MessageBox de Electron ignora el clic sintético con el ratón, así que se
  #    da el foco al botón por UIA y se pulsa con el teclado (Espacio activa el
  #    botón enfocado); el clic físico queda como último recurso
  try {
    $el.SetFocus()
    Start-Sleep -Milliseconds 250
    Send-KeysSafe ' '
    return 'focus+space'
  } catch {
    $r = $el.Current.BoundingRectangle
    if ($r.Width -le 0 -or $r.Height -le 0) { throw 'elemento sin rectángulo visible' }
    $cx = [int]($r.X + $r.Width / 2)
    $cy = [int]($r.Y + $r.Height / 2)
    # el clic solo se da si lo que hay bajo el cursor es de la app
    $at = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($cx, $cy)))
    if ($at.Current.ProcessId -ne $AppPid) { throw "bajo el cursor hay otro proceso (pid $($at.Current.ProcessId)): no se hace clic" }
    [Mouse32]::Click($cx, $cy)
    return "click@$cx,$cy"
  }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$pidCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppPid)

function Find-Dialog([string]$titlePart) {
  $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCond)
  foreach ($w in $wins) {
    $name = $w.Current.Name
    if ($name -and $name.Contains($titlePart)) { return $w }
  }
  return $null
}

switch ($Action) {

  'dump-dialog' {
    # vuelca el árbol UIA del diálogo (depuración de clic por UIA)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $deadline = $sw.Elapsed.Add([TimeSpan]::FromSeconds($TimeoutSec))
    $dlg = $null
    while ($sw.Elapsed -lt $deadline) {
      $dlg = Find-Dialog $Title
      if ($dlg) { break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $dlg) { Out-Json @{ found = $false }; return }
    $all = $dlg.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $nodes = @()
    foreach ($e in $all) {
      $nodes += @{
        type = $e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
        name = $e.Current.Name
        class = $e.Current.ClassName
        autoId = $e.Current.AutomationId
        patterns = @($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace '^System.Windows.Automation\.', '' })
      }
    }
    Out-Json @{ found = $true; title = $dlg.Current.Name; class = $dlg.Current.ClassName; count = $nodes.Count; nodes = $nodes }
  }

  'click-dialog' {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $deadline = $sw.Elapsed.Add([TimeSpan]::FromSeconds($TimeoutSec))
    $dlg = $null
    while ($sw.Elapsed -lt $deadline) {
      $dlg = Find-Dialog $Title
      if ($dlg) { break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $dlg) { Out-Json @{ found = $false; waitedMs = [int]$sw.ElapsedMilliseconds }; return }
    # botones: elementos con clase CCPushButton o ControlType.Button (el
    # MessageBox de Electron expone Pane/CCPushButton sin InvokePattern)
    $all = $dlg.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $buttons = @()
    foreach ($e in $all) {
      if ($e.Current.ClassName -eq 'CCPushButton' -or
        $e.Current.ControlType.ProgrammaticName -eq 'ControlType.Button') {
        $buttons += $e
      }
    }
    $result = @{
      found = $true; title = $dlg.Current.Name
      buttons = @($buttons | ForEach-Object { $_.Current.Name })
      waitedMs = [int]$sw.ElapsedMilliseconds
    }
    if ($Button -ne '') {
      $target = $null
      foreach ($b in $buttons) { if ($b.Current.Name -eq $Button) { $target = $b; break } }
      if (-not $target) { $result.clicked = $false; $result.error = "botón no encontrado: $Button"; Out-Json $result; return }
      $result.via = Click-Element $target
      $result.clicked = $true
    }
    Out-Json $result
  }

  'taskbar-appids' {
    # AppUserModelID efectivo de cada botón de la barra de tareas: el Shell lo
    # expone como AutomationId "Appid: <AUMID>". Es la lectura externa del
    # AUMID que fija app.setAppUserModelId (que es del PROCESO: la propiedad
    # System.AppUserModel.ID de la ventana sale vacía).
    $tb = $root.FindFirst([System.Windows.Automation.TreeScope]::Children,
      (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Shell_TrayWnd')))
    if (-not $tb) { Out-Json @{ found = $false }; return }
    $all = $tb.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $list = @()
    foreach ($e in $all) {
      $id = $e.Current.AutomationId
      if ($id -like 'Appid:*') { $list += @{ appid = $id.Substring(6).Trim(); name = $e.Current.Name } }
    }
    Out-Json @{ found = $true; buttons = $list }
  }

  'fg' {
    # quién tiene el primer plano ahora (diagnóstico de las inyecciones de entrada)
    $fgPid = [Fg32]::ForegroundPid()
    $pn = (Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName
    Out-Json @{ fgPid = $fgPid; fgProc = $pn; esLaApp = ($fgPid -eq $AppPid) }
  }

  default { throw "acción desconocida: $Action" }
}
