# Spec Delta

## Purpose

Define cómo se distribuye y se actualiza OpenSpecControl: instaladores firmados por plataforma, contenido mínimo del paquete y actualización automática desde GitHub Releases.

## ADDED Requirements

### Requirement: Instaladores por plataforma
WHEN se publica una versión,
el sistema SHALL ofrecer un instalador NSIS por usuario para Windows (x64 y arm64), un dmg y un zip universales para macOS, y un AppImage y un deb para Linux (x64 y arm64).

#### Scenario: Instalación en Windows sin administrador
- **GIVEN** un usuario sin permisos de administrador
- **WHEN** ejecuta el instalador de Windows
- **THEN** la aplicación se instala para ese usuario sin pedir elevación

#### Scenario: Nombre de los instaladores
- **GIVEN** la versión 0.1.0
- **WHEN** se generan los instaladores de Windows y de macOS
- **THEN** se llaman `OpenSpecControl-0.1.0-setup.exe` y `OpenSpecControl-0.1.0.dmg`

### Requirement: Licencia y atribución
WHEN se empaqueta la aplicación,
el sistema SHALL incluir en el paquete la licencia MIT propia y el aviso de copyright y licencia MIT de OpenSpec Studio, del que deriva el código.

#### Scenario: Aviso de terceros presente
- **GIVEN** un paquete construido con `dist:dir`
- **WHEN** se inspecciona su contenido
- **THEN** contiene `LICENSE` y `NOTICE` con el aviso MIT de OpenSpec Studio

#### Scenario: Falta el aviso
- **GIVEN** el archivo `NOTICE` no existe
- **WHEN** se ejecuta la verificación del paquete
- **THEN** la verificación falla y no se publica el release

### Requirement: Firma y notarización
WHEN se construye una versión para publicar,
el sistema SHALL firmar los instaladores de Windows y de macOS y notarizar el de macOS, de modo que se instalen sin advertencias de firma, salvo la reputación inicial de SmartScreen con certificados no EV.

#### Scenario: Gatekeeper
- **GIVEN** el dmg notarizado descargado de GitHub Releases
- **WHEN** el usuario lo abre en macOS
- **THEN** Gatekeeper lo acepta sin bloquearlo

#### Scenario: Faltan secretos de firma
- **GIVEN** el workflow de release no tiene los secretos de firma configurados
- **WHEN** se ejecuta
- **THEN** falla antes de publicar y no deja artefactos sin firmar en el release

### Requirement: Contenido mínimo del paquete
WHEN se empaqueta la aplicación,
el sistema SHALL incluir solo el código compilado y lo imprescindible para ejecutarlo, e impedir que el ejecutable se use como intérprete de Node.js, acepte opciones de inspección por argumentos o variables de entorno, o cargue código ajeno al paquete.

#### Scenario: Revisión del paquete
- **GIVEN** un paquete construido con `dist:dir`
- **WHEN** se inspecciona su contenido
- **THEN** no contiene `src/`, `test/`, `Docs/`, `openspec/` ni dependencias de desarrollo

#### Scenario: Ejecutable usado como Node.js
- **GIVEN** la aplicación instalada
- **WHEN** se lanza con la variable de entorno `ELECTRON_RUN_AS_NODE=1`
- **THEN** arranca la aplicación normal y no un intérprete de Node.js

### Requirement: Actualización automática
WHILE una versión empaquetada está en ejecución,
el sistema SHALL buscar actualizaciones en GitHub Releases (`ricbalda/openspeccontrol`) al arrancar y cada 24 horas, descargarlas en segundo plano y ofrecer reiniciar para instalarlas.

#### Scenario: Nueva versión disponible
- **GIVEN** la versión 0.1.0 instalada y un release 0.1.1 publicado
- **WHEN** el sistema comprueba actualizaciones
- **THEN** descarga la versión 0.1.1 mostrando el progreso
- **AND** ofrece "Reiniciar para actualizar a 0.1.1"

#### Scenario: Sin conexión
- **GIVEN** no hay conexión a internet
- **WHEN** el sistema comprueba actualizaciones
- **THEN** el estado de actualización pasa a `error` sin afectar al uso de la aplicación

### Requirement: Actualización desactivada
IF la aplicación no está empaquetada o `OSC_NO_UPDATE_CHECK=1`,
el sistema SHALL NOT buscar actualizaciones y SHALL mostrar el estado `disabled`.

#### Scenario: Modo desarrollo
- **GIVEN** la aplicación se ejecuta con `npm run dev`
- **WHEN** arranca
- **THEN** no se realiza ninguna comprobación de actualizaciones

### Requirement: Versiones preliminares
WHEN el release más reciente es una versión preliminar y la instalada es estable,
el sistema SHALL NOT ofrecerla como actualización.

#### Scenario: Versión preliminar
- **GIVEN** instalada la 0.1.0 estable y publicado un release `0.1.1-beta.1`
- **WHEN** el sistema comprueba actualizaciones
- **THEN** no ofrece actualizar

### Requirement: Reinicio seguro para actualizar
WHEN el usuario elige "Reiniciar para actualizar" y hay un agente trabajando o decisiones pendientes,
el sistema SHALL aplicar la misma confirmación de cierre seguro antes de instalar la actualización.

#### Scenario: Agente activo al actualizar
- **GIVEN** un agente está en estado `busy` y hay una actualización descargada
- **WHEN** el usuario pulsa "Reiniciar para actualizar"
- **THEN** aparece la confirmación de cierre antes de reiniciar

### Requirement: Paquete deb
WHERE el sistema se instala desde el paquete deb,
el sistema SHALL actualizarse automáticamente si la plataforma lo permite o, en caso contrario, SHALL mostrar un aviso de nueva versión con enlace al release.

#### Scenario: Deb sin actualización automática
- **GIVEN** el paquete deb no admite actualización automática
- **WHEN** hay una versión nueva
- **THEN** la aplicación muestra el aviso con el enlace al release
