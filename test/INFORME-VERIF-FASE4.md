# Informe de verificación — Fase 4 (shell de escritorio), tarea 4.9

Cambio OpenSpec `migrate-to-electron-desktop`. Verificación con evidencia sobre la app real en
**Windows 11 Pro (10.0.26300), monitor 1920×1080 al 125 % de escala**, Electron 45.3.4. No se
tocó nada de `src/**`: no se encontró ningún bug en la app (ver «Bugs encontrados»).

## Resultado por punto

| # | Punto | Estado | Resumen |
|---|-------|--------|---------|
| 1 | Instancia única (4.1) | **Cumplido** | La segunda instancia con el mismo `--user-data-dir` sale sola (código 0, 0,4–0,6 s); la primera, minimizada, vuelve a estar restaurada y visible (y en primer plano); los PIDs del `.exe` antes y después son idénticos. Repetido sobre el binario empaquetado y con la segunda instancia llegando durante el arranque (0/60/150/300 ms). |
| 2 | Persistencia de ventana (4.2) | **Cumplido** (con un matiz de ±4 DIP, ver hallazgos) | `window-state.json` se escribe al cerrar y se restaura; maximizado persiste y des‑maximizar vuelve a los bounds; coordenadas fuera de pantalla → la ventana reaparece visible y centrada; 500×300 guardado → 1026×640 (mínimo 1024×640). El «monitor ausente» es *simulado* editando el JSON, no desenchufando un monitor. |
| 3 | Sin destello (4.3) | **Parcial** | Lectura de código (`show:false` + `ready-to-show` + `backgroundColor` por tema) y comprobación observable (primer fotograma con la UI ya pintada, oscuro, sin blanco). Un destello de uno o dos fotogramas no se puede descartar sin ojos humanos / vídeo. |
| 4 | Cierre seguro con agente `busy` (4.4) | **Cumplido** | Diálogo nativo en la X y en Archivo → Salir; «Cancelar» mantiene app, ventana y agente; «Cerrar igual» sale con 0, 0 huérfanos y el `-wal` desaparece (checkpoint). Matiz: el desplegable del menú se disparó vía `app.quit()` (inspector del main), no pulsando el menú (ver técnica). |
| 5 | Caída del renderer (4.7) | **Cumplido** | `Page.crash` → motivo en el log del main, diálogo «Recargar», tras recargar el replay devuelve 85 eventos y la sesión sigue `busy` con la decisión pendiente; comprobado además en la UI con `agent-browser`. |
| 6 | Identidad (4.8) | **Cumplido** (con matiz de atribución) | `app.getName()` = `OpenSpecControl`, título de ventana, `ProductName` del `.exe` empaquetado y AUMID `io.github.ricbalda.openspeccontrol` visible como `Appid:` del botón de la barra de tareas, en dev y en `dist:dir`. |
| 7 | macOS (4.5) y Linux | **No verificable aquí** | Máquina Windows. Dock/`activate` y el ciclo de vida de macOS, y todo lo propio de Linux, siguen sin comprobar manualmente. |

## Cómo reproducirlo

```bash
npx electron-vite build            # una vez
npm run dist:dir                   # solo para fase4-identidad (release/0.1.0/win-unpacked)
node test/e2e/fase4-ventana.mjs    # 4.1, 4.2, 4.3
node test/e2e/fase4-cierre.mjs     # 4.4 y 4.7 (agente falso, UIA, árbol de procesos)
node test/e2e/fase4-identidad.mjs  # 4.8 (+ 4.1 sobre el binario empaquetado)
node test/e2e/fase4-ui.mjs         # UI de 4.7 con agent-browser (sesión fase4v)
node test/e2e/fase4-carrera.mjs    # segunda instancia durante el arranque
```

Todos usan CDP **9302**, y cada instancia lleva su `--user-data-dir`, `OSC_DATA`, `HOME` y
`USERPROFILE` temporales (se borran al terminar). Helpers: `fase4-lib.mjs` (arranque, CDP,
inspector del main, `startApp`/`busyAgent`), `fase4-win.ps1` (user32/CIM: estado de ventana,
mover, cerrar, árbol de procesos) y `fase4-uia.ps1` (UI Automation de los diálogos nativos y
barra de tareas). Evidencia bruta en `test/e2e/captures/fase4-*-evidencia.json`.

## Evidencia

### 4.1 Instancia única (`fase4-ventana.mjs`, `fase4-identidad.mjs`, `fase4-carrera.mjs`)

- Ventana minimizada (`IsIconic`) → segunda instancia, mismo `--user-data-dir`: `exitCode: 0`,
  `duracionMs: 468` (otra ejecución: 620).
- La primera: `viva: true`, `visible: true`, `minimizada: false`, `primerPlano: true`
  (`wait-foreground` 75–133 ms). El primer plano lo concede Windows y depende de lo que haga la
  persona en ese instante: se registra, no se exige (en una ejecución intermedia con la app
  empaquetada salió `false` mientras la ventana sí estaba restaurada y visible; en la final, `true`).
- Procesos: árbol de la app 3 → 3; PIDs con el `.exe` `[69488, 60056, 67928, 63088]` antes y
  después (idénticos). En la app empaquetada (`openspeccontrol.exe`, fuses volteados):
  `[46276, 24300, 13064, 47976]` antes y después; tras cerrarla no queda ninguno.
- Carrera: segunda instancia a 0, 60, 150 y 300 ms del arranque de la primera → en los cuatro casos
  la segunda sale con 0 y la primera queda viva y visible (Electron encola `second-instance`).

### 4.2 Persistencia (`fase4-ventana.mjs`)

Escala 1,25 (1600×1000 px físicos ↔ 1280×800 DIP). Se coloca con `window.moveTo/resizeTo` (Electron
45 no implementa `Browser.setWindowBounds`; plan B `SetWindowPos`) y se cierra con `WM_CLOSE` (la X):

| Paso | `window-state.json` / medida |
|------|------------------------------|
| Arranque inicial | `{"width":1280,"height":800,"x":128,"y":8,"maximized":false}` |
| Tras mover/redimensionar y cerrar | `{"width":1100,"height":700,"x":120,"y":16,"maximized":false}` (exit 0) |
| Reabrir | x=120, y=16, 1103,2×703,2 DIP (mismos números ±borde, ver hallazgos) |
| Maximizar y cerrar | `{"width":1104,"height":704,"x":120,"y":16,"maximized":true}` |
| Reabrir | `IsZoomed = true`; al restaurar: 120, 16, 1104×704 (bounds normales) |
| JSON con `x:-5000, y:-4000` | visible, en 218,4/58,4 DIP (centrada), 1100,8×700,8 |
| JSON con 500×300 | 1026,4×640 DIP → mínimo 1024×640 respetado |

### 4.3 Sin destello

- Código: `src/main/index.ts` crea la ventana con `show: false` y `backgroundColor:
  nativeTheme.shouldUseDarkColors ? '#111114' : '#f7f7f8'`; la muestra solo en `ready-to-show`.
- Observable: en cuanto la ventana pasa a visible (sondeo cada 25 ms, 90–134 ms tras tener CDP) se
  captura *solo esa ventana* con `PrintWindow` (`test/e2e/captures/fase4-ventana-primer-fotograma.png`):
  la UI ya está pintada, en oscuro, RGB medio `[23,23,25]` (fondo del tema `#111114` = `[17,17,20]`
  + contenido), sin blanco. Si se hubiera llamado a `show()` antes de `ready-to-show` el primer
  fotograma sería el fondo vacío.
- **No verificable aquí:** un destello de 1–2 fotogramas entre `show()` y el primer pintado, o el
  parpadeo del marco nativo; haría falta grabar vídeo a la frecuencia del monitor o verlo a ojo.

### 4.4 Cierre seguro (`fase4-cierre.mjs`)

Agente falso `fake-acp-agent.mjs` dado de alta en `agents.json` (comando `node.exe` del sistema);
turno `pide permiso: permission` → `status: busy`, `pendingInteractions: 1`.

- **Árbol antes del cierre** (app PID 11572): `15884, 47476, 9584 electron.exe` (GPU/renderer/utility),
  `15540 node.exe` (agente falso), `68096 conhost.exe`. Base: `openspeccontrol.db` 4096 B,
  `-wal` 98 912 B, `-shm` 32 768 B.
- **X → diálogo** («Cerrar OpenSpecControl», botones `Cancelar` / `Cerrar igual`); la app NO sale
  mientras está abierto.
- **Cancelar:** el diálogo desaparece (comprobado por UIA), la ventana principal sigue visible con
  su título, el árbol sigue en 5 procesos y el proceso del agente vive.
- **Cerrar igual:** exit 0; de los 6 PIDs (app + 5 descendientes) no queda ninguno (`huérfanos: []`);
  `openspeccontrol.db` 45 056 B y **sin `-wal` ni `-shm`** → checkpoint completado y base cerrada.
- **Archivo → Salir:** mismo diálogo y misma salida limpia (exit 0, 0 huérfanos, sin `-wal`).
  Es el camino `role: 'quit'` → `app.quit()` → `before-quit`, distinto del de la X (`close`).
- Cierre final de la rama 4.7 con el agente aún `busy`: también diálogo + 0 huérfanos.

**Técnica de interacción con el diálogo nativo.** UI Automation (`System.Windows.Automation`):
se busca entre las ventanas del PID la de título «Cerrar OpenSpecControl», se listan sus botones
(clase `CCPushButton`, sin `InvokePattern`) y se activa el botón dando el foco por UIA
(`SetFocus`) + tecla Espacio. El clic de ratón sintético (`mouse_event`) **no** cierra el
`MessageBox` de Electron. La tecla solo se envía si la ventana en primer plano es del proceso de la
app (ver incidente más abajo). El desplegable del menú de Chromium no expone patrones UIA y las
teclas dependen de que nadie robe el primer plano, por lo que Archivo → Salir se ejerce llamando a
`app.quit()` en el proceso principal por el inspector de Node (`--inspect=0`, solo build sin
empaquetar): es exactamente lo que ejecuta el `role: 'quit'` del menú, sin tocar teclado ni ratón.
Se vio el menú abierto (Archivo: «Añadir carpeta…», «Volver a escanear repos», «Salir») pero no se
pulsó «Salir» con el ratón.

### 4.7 Caída del renderer (`fase4-cierre.mjs`, `fase4-ui.mjs`)

- `Page.crash` por CDP → log del main: `El proceso de la interfaz terminó (crashed, código
  -2147483645).` y diálogo «Recargar OpenSpecControl» (`Recargar` / `Cerrar`).
- Tras «Recargar»: `subscribe` → `replay` con 85 entradas (`notice 1, user 2, update 80, turn_end 1,
  permission 1`) y la sesión sigue `busy` con `pendingInteractions: 1`.
- UI (`agent-browser`, sesión `fase4v`, CDP 9302): abierto `hello-app` desde el selector, la UI
  muestra el turno «turno de prueba events=80», los fragmentos y «NEEDS YOUR DECISION»; tras
  la caída y la recarga lo vuelve a mostrar igual (capturas
  `fase4-ui-1-antes-de-la-caida.png`, `fase4-ui-2-tras-recargar.png`; el repo abierto persiste en
  `localStorage`). No se probó `unresponsive` ni el botón «Cerrar» del diálogo de recarga.

### 4.8 Identidad (`fase4-identidad.mjs`, build `npm run dist:dir`)

- `app.getName()` = `OpenSpecControl`, `app.getVersion()` = `0.1.0` (inspector, solo dev); título de
  ventana `OpenSpecControl` en dev y empaquetada.
- `.exe` empaquetado `release/0.1.0/win-unpacked/openspeccontrol.exe`: `ProductName` y
  `FileDescription` = `OpenSpecControl`, `InternalName` = `openspeccontrol`, versión `0.1.0.0`.
- **AUMID.** `app.setAppUserModelId` fija el ID del *proceso*; `System.AppUserModel.ID` de la
  *ventana* (`SHGetPropertyStoreForWindow`) sale vacío (`VT_EMPTY`) y `GetApplicationUserModelId`
  da `APPMODEL_ERROR_NO_APPLICATION` (solo para apps empaquetadas MSIX). La lectura externa
  válida es la barra de tareas: UIA sobre `Shell_TrayWnd` expone cada botón con `AutomationId =
  "Appid: <AUMID>"`, y aparece `Appid: io.github.ricbalda.openspeccontrol` al lanzar la app (dev y
  empaquetada), con el contador de ventanas del grupo subiendo.
- **Matiz de atribución:** otros workers abren la misma app en paralelo (el botón ya existía con
  1–2 ventanas antes y llegó a 3), así que el grupo no se atribuye en exclusiva a nuestra
  instancia; es una prueba de que el proceso lanza con ese AUMID y de que se agrupa bajo él, no de
  que *solo* nuestra ventana lo hizo. Los toasts reales de Windows y el acceso directo del
  instalador NSIS no se comprobaron (solo `dist:dir`).

## Hallazgos y bugs encontrados

**En la app (`src/**`): ninguno que justifique cambio.** Observaciones:

1. **±4 DIP al reabrir (menor, no acumulativo).** Con 125 % de escala, abrir con `width:1100`
   deja la ventana en 1103,2 DIP (1379 px en vez de 1375); al cerrar se guarda 1104×704. En cinco
   ciclos abrir/cerrar consecutivos se estabiliza en 1104×704 desde el primer ciclo (no crece más).
   Es del reparto DIP↔píxeles/borde DWM de Electron/Windows; no se corrigió porque no hay arreglo
   mínimo claro y el efecto es de 3–4 px una sola vez.
2. **Windows no tiene atajo de teclado para salir.** `role: 'quit'` solo trae `Ctrl+Q` en
   macOS/Linux; en Windows salir es por Archivo → Salir o `Alt+F4`. Es comportamiento de Electron,
   no un bug; se anota por si se quiere un acelerador explícito.
3. `Page.crash` no responde (el renderer muere antes) y los códigos de salida de la caída
   simulada son `0x80000003`; solo afecta al script (ya no espera la respuesta).

**En el arnés heredado (corregido):** el trabajo previo daba por buena la rama «Cancelar» sin que
fuera cierto. El clic de ratón sintético no cerraba el diálogo; la comprobación «la ventana sigue
visible» pasaba porque `MainWindowHandle` apuntaba al propio diálogo abierto, y la siguiente espera
fallaba por timeout. Ahora se activa el botón por UIA + teclado y se **asserta que el diálogo
desaparece** y que la ventana principal es la de título `OpenSpecControl`. Además: el primer
fotograma se capturaba con `CopyFromScreen` y se coló una notificación de WhatsApp de otra app en
el PNG (ahora `PrintWindow`, solo la ventana); el campo «orden visible→pinta» comparaba relojes
distintos y se eliminó; el plan B Ctrl+Q del menú no existe en Windows y se eliminó.

**Incidente durante la depuración.** Al depurar la navegación por teclado del menú, `SendKeys`
(F10, Abajo, Fin, Intro) se envió a la ventana en primer plano, que no era la app sino el
navegador del usuario (Firefox Developer Edition). Tras comprobarlo no se observó ningún efecto
(la ventana y la pestaña seguían igual), pero es una pulsación no deseada sobre una ventana ajena.
Mitigación: `fase4-uia.ps1` solo inyecta teclas si la ventana en primer plano es del PID de la app
(si no, intenta traer la app y, si no puede, aborta), y el menú se dejó de manejar por teclado.
Las ejecuciones finales de los scripts no vuelven a inyectar teclas fuera de los diálogos de la app.
Los PNG de depuración con contenido de otras ventanas se borraron.

## Cambios fuera del alcance

Ninguno. Solo se añadieron archivos en `test/e2e/` y este informe.

## No verificado / límites

- macOS (4.5: dock, `activate`, `window-all-closed`) y Linux: no verificable en esta máquina.
- Destello de 1–2 fotogramas (4.3) y tema claro: sin vídeo ni ojos humanos; solo tema oscuro.
- Monitor realmente ausente: simulado editando `window-state.json`; otras escalas/monitores múltiples
  no probados.
- 4.8: notificaciones toast e icono del acceso directo del instalador NSIS (solo `dist:dir`);
  atribución exclusiva del AUMID a nuestra instancia (otros workers corren la misma app).
- 4.7: solo `render-process-gone` simulado con `Page.crash`; `unresponsive` y el botón «Cerrar» del
  diálogo de recarga no probados.
- Archivo → Salir pulsado «de verdad» con el ratón: no; se invocó `app.quit()` (mismo código) por
  el inspector del main, disponible solo en la build sin empaquetar.
- El subagente `test-browser` (OpenCode) no existe en este entorno: la parte de UI web la ejecuté
  yo con `agent-browser` (`fase4-ui.mjs`).
