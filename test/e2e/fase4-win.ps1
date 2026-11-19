# fase4-win.ps1 (tarea 4.9): helper de ventanas y procesos para la verificación
# manual de la Fase 4 en Windows. Un solo archivo con "acciones" invocables desde
# los scripts .mjs; todas responden JSON en stdout para poder afirmar sobre el
# resultado sin ojos humanos:
#
#   info -AppPid X            estado de la ventana principal (visible/minimizada/
#                             maximizada, rectángulo físico, primer plano)
#   wait-visible -AppPid X    espera a que la ventana sea visible (show:false +
#                             ready-to-show); captura el PRIMER fotograma y
#                             muestrea su color (-Out archivo.png)
#   wait-foreground -AppPid X espera a que la ventana esté restaurada y en primer
#                             plano (tras second-instance)
#   show -AppPid X -State minimize|maximize|restore
#   move -AppPid X -Left -Top -W -H    SetWindowPos (píxeles físicos)
#   close -AppPid X           PostMessage WM_CLOSE (lo mismo que pulsar la X)
#   aumid -AppPid X           AppUserModel.ID real de la ventana (Shell32)
#   tree -AppPid X            árbol de procesos descendiente (CIM)
#   procs-by-exe -ExePath P   PIDs cuyo ejecutable es exactamente P
#   wait-exit -AppPid X       espera a que el proceso desaparezca
#
# Requiere Windows PowerShell 5.1+ (STA por defecto para UIA no se usa aquí).

param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$AppPid = 0,
  [int]$TimeoutSec = 30,
  [int]$Left = 0, [int]$Top = 0, [int]$W = 0, [int]$H = 0,
  [string]$State = '',
  [string]$Out = '',
  [string]$ExePath = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
}
"@

function Out-Json($obj) { $obj | ConvertTo-Json -Compress -Depth 6 }

function Get-Hwnd([int]$pid_) {
  $p = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
  if (-not $p) { return [IntPtr]::Zero }
  return [IntPtr]$p.MainWindowHandle
}

function Get-WinInfo([int]$pid_) {
  $p = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
  if (-not $p) { return @{ exists = $false } }
  $h = [IntPtr]$p.MainWindowHandle
  $info = @{ exists = $true; pid = $pid_; name = $p.ProcessName; path = $p.Path; title = $p.MainWindowTitle }
  if ($h -ne [IntPtr]::Zero) {
    $r = New-Object Win32+RECT
    [Win32]::GetWindowRect($h, [ref]$r) | Out-Null
    $info.hwnd = $h.ToInt64()
    $info.visible = [Win32]::IsWindowVisible($h)
    $info.iconic = [Win32]::IsIconic($h)
    $info.zoomed = [Win32]::IsZoomed($h)
    $info.foreground = ([Win32]::GetForegroundWindow() -eq $h)
    $info.rect = @{ left = $r.L; top = $r.T; width = $r.R - $r.L; height = $r.B - $r.T }
  } else {
    $info.hwnd = 0; $info.visible = $false; $info.iconic = $false; $info.zoomed = $false
    $info.foreground = $false; $info.rect = $null
  }
  return $info
}

# ---- acciones ----------------------------------------------------------------

switch ($Action) {

  'info' {
    Out-Json (Get-WinInfo $AppPid)
  }

  'wait-visible' {
    # show:false + ready-to-show: la ventana solo debe asomar cuando ya hay algo
    # pintado. Al detectarla captura el primer fotograma y muestrea su color.
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $deadline = $sw.Elapsed.Add([TimeSpan]::FromSeconds($TimeoutSec))
    while ($sw.Elapsed -lt $deadline) {
      $info = Get-WinInfo $AppPid
      if ($info.visible) {
        $result = @{ visible = $true; elapsedMs = [int]$sw.ElapsedMilliseconds; rect = $info.rect }
        if ($Out -ne '') {
          Add-Type -AssemblyName System.Drawing
          $r = $info.rect
          # PrintWindow (PW_RENDERFULLCONTENT = 2) pinta SOLO esta ventana, aunque
          # otra (una notificación, otra app) la tape: CopyFromScreen filtraba
          # contenido ajeno al encuadre.
          $bmp = New-Object System.Drawing.Bitmap($r.width, $r.height)
          $g = [System.Drawing.Graphics]::FromImage($bmp)
          $hdc = $g.GetHdc()
          $pw = [Win32]::PrintWindow([IntPtr]$info.hwnd, $hdc, 2)
          $g.ReleaseHdc($hdc)
          $g.Dispose()
          $result.printWindow = $pw
          $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
          # muestreo: media de una rejilla + esquinas del área capturada
          $rs = 0; $gs = 0; $bs = 0; $n = 0
          for ($x = 5; $x -lt $bmp.Width; $x += [Math]::Max(1, [int]($bmp.Width / 24))) {
            for ($y = 5; $y -lt $bmp.Height; $y += [Math]::Max(1, [int]($bmp.Height / 16))) {
              $c = $bmp.GetPixel($x, $y); $rs += $c.R; $gs += $c.G; $bs += $c.B; $n++
            }
          }
          $tl = $bmp.GetPixel(2, 2)
          $result.avgRgb = @([int]($rs / $n), [int]($gs / $n), [int]($bs / $n))
          $result.topLeftRgb = @($tl.R, $tl.G, $tl.B)
          $result.capture = $Out
          $bmp.Dispose()
        }
        Out-Json $result
        return
      }
      Start-Sleep -Milliseconds 25
    }
    Out-Json @{ visible = $false; timeoutMs = [int]$sw.ElapsedMilliseconds }
  }

  'wait-foreground' {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $deadline = $sw.Elapsed.Add([TimeSpan]::FromSeconds($TimeoutSec))
    while ($sw.Elapsed -lt $deadline) {
      $info = Get-WinInfo $AppPid
      if ($info.visible -and -not $info.iconic -and $info.foreground) {
        Out-Json @{ ok = $true; elapsedMs = [int]$sw.ElapsedMilliseconds; rect = $info.rect }
        return
      }
      Start-Sleep -Milliseconds 50
    }
    Out-Json @{ ok = $false; timeoutMs = [int]$sw.ElapsedMilliseconds; last = $info }
  }

  'show' {
    $h = Get-Hwnd $AppPid
    if ($h -eq [IntPtr]::Zero) { throw "sin ventana para pid $AppPid" }
    $cmd = switch ($State) { 'minimize' { 6 } 'maximize' { 3 } 'restore' { 9 } default { throw "estado desconocido: $State" } }
    Out-Json @{ called = [Win32]::ShowWindow($h, $cmd) }
  }

  'move' {
    $h = Get-Hwnd $AppPid
    if ($h -eq [IntPtr]::Zero) { throw "sin ventana para pid $AppPid" }
    # SWP_NOZORDER (0x4) | SWP_NOACTIVATE (0x10) | SWP_NOSIZE si falta tamaño
    $flags = [uint32]0x14
    if ($W -gt 0 -and $H -gt 0) { } else { $flags = $flags -bor 0x1 }
    $ok = [Win32]::SetWindowPos($h, [IntPtr]::Zero, $Left, $Top, $W, $H, $flags)
    Start-Sleep -Milliseconds 150
    Out-Json (Get-WinInfo $AppPid)
  }

  'close' {
    $h = Get-Hwnd $AppPid
    if ($h -eq [IntPtr]::Zero) { throw "sin ventana para pid $AppPid" }
    # WM_CLOSE = 0x10: idéntico a pulsar la X
    Out-Json @{ posted = [Win32]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
  }

  'aumid' {
    # AppUserModel.ID real de la ventana viva (la propiedad que agrupa la barra
    # de tareas y las notificaciones): SHGetPropertyStoreForWindow + PKEY 5.
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class AumidReader {
  [StructLayout(LayoutKind.Sequential)]
  public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROPVARIANT {
    public ushort vt; public ushort r1, r2, r3;
    public IntPtr p1; public IntPtr p2;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    uint GetCount(out uint c);
    uint GetAt(uint i, out PROPERTYKEY k);
    uint GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out IPropertyStore ps);
  public static string Read(IntPtr hwnd) {
    var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    IPropertyStore ps;
    int hr = SHGetPropertyStoreForWindow(hwnd, ref iid, out ps);
    if (hr != 0) return "hr=0x" + hr.ToString("X8");
    var key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    PROPVARIANT v;
    ps.GetValue(ref key, out v);
    if (v.vt == 31) { string s = Marshal.PtrToStringUni(v.p1); return s; }
    return "vt=" + v.vt;
  }
}
"@
    $p = Get-Process -Id $AppPid -ErrorAction Stop
    $h = [IntPtr]$p.MainWindowHandle
    if ($h -eq [IntPtr]::Zero) { throw "sin ventana para pid $AppPid" }
    Out-Json @{ aumid = [AumidReader]::Read($h); title = $p.MainWindowTitle; exe = $p.ProcessName }
  }

  'tree' {
    # descendientes de -AppPid en un solo volcado CIM (pid/ppid/name/exe/cmdline)
    $all = Get-CimInstance Win32_Process |
      Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine
    $map = @{}
    foreach ($p in $all) { $map[[int]$p.ParentProcessId] = @() }
    foreach ($p in $all) { $map[[int]$p.ParentProcessId] += $p }
    $treeOut = New-Object System.Collections.ArrayList
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($AppPid)
    $seen = @{}
    while ($queue.Count -gt 0) {
      $cur = [int]$queue.Dequeue()
      if ($seen.ContainsKey($cur)) { continue }
      $seen[$cur] = $true
      foreach ($c in @($map[$cur])) {
        if ($null -eq $c) { continue }
        [void]$treeOut.Add(@{
          pid = [int]$c.ProcessId; ppid = [int]$c.ParentProcessId; name = $c.Name
          exe = $c.ExecutablePath
          cmd = if ($c.CommandLine) { $c.CommandLine.Substring(0, [Math]::Min(220, $c.CommandLine.Length)) } else { $null }
        })
        $queue.Enqueue([int]$c.ProcessId)
      }
    }
    Out-Json @($treeOut)
  }

  'procs-by-exe' {
    # WQL escapa la contrabarra en los literales: C:\...\electron.exe → C:\\...\\electron.exe
    $wqlExe = $ExePath.Replace('\', '\\').Replace("'", "''")
    $list = @(Get-CimInstance Win32_Process -Filter "ExecutablePath = '$wqlExe'" |
      Select-Object -ExpandProperty ProcessId)
    Out-Json @{ pids = @($list | ForEach-Object { [int]$_ }) }
  }

  'wait-exit' {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $deadline = $sw.Elapsed.Add([TimeSpan]::FromSeconds($TimeoutSec))
    while ($sw.Elapsed -lt $deadline) {
      $p = Get-Process -Id $AppPid -ErrorAction SilentlyContinue
      if (-not $p) { Out-Json @{ gone = $true; elapsedMs = [int]$sw.ElapsedMilliseconds }; return }
      Start-Sleep -Milliseconds 100
    }
    Out-Json @{ gone = $false; timeoutMs = [int]$sw.ElapsedMilliseconds }
  }

  default { throw "acción desconocida: $Action" }
}
