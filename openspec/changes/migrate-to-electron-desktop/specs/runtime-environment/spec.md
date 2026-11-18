# Spec Delta

## Purpose

Define cómo OpenSpecControl obtiene el entorno de ejecución que necesitan los procesos hijo (`PATH`, proxy y variables propias) y cómo informa de las herramientas externas que faltan.

## ADDED Requirements

### Requirement: PATH del shell de login
WHEN la aplicación se inicia en macOS o Linux,
el sistema SHALL leer el entorno del shell de login del usuario antes de lanzar ningún proceso hijo y fusionar `PATH`, las variables de proxy y las variables de configuración propias que el proceso aún no tenga.

#### Scenario: Aplicación abierta desde el dock
- **GIVEN** `openspec` está instalado con nvm y la aplicación se abre desde el dock
- **WHEN** el usuario selecciona un repositorio
- **THEN** el sistema encuentra `openspec` y lista los cambios del repositorio

#### Scenario: El shell de login no responde
- **GIVEN** el shell de login tarda más de 5 segundos o falla
- **WHEN** la aplicación arranca
- **THEN** el sistema añade rutas conocidas (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `~/.local/bin`)
- **AND** la aplicación arranca igualmente

### Requirement: Entorno heredado en Windows
WHERE la plataforma es Windows,
el sistema SHALL usar el `PATH` que hereda el proceso del usuario sin ejecutar ningún shell de login.

#### Scenario: Arranque en Windows
- **GIVEN** `git` está en el `PATH` del usuario
- **WHEN** la aplicación se inicia desde el menú Inicio
- **THEN** el sistema encuentra `git` sin pasos adicionales

### Requirement: Diagnóstico de dependencias
WHEN el usuario abre Ayuda → Diagnóstico de dependencias o la aplicación consulta su configuración,
el sistema SHALL detectar `node`, `npx`, `openspec` y `git` e indicar para cada uno si se encontró, su versión, su ruta y, si falta, cómo instalarlo.

#### Scenario: Falta openspec
- **GIVEN** el CLI `openspec` no está instalado
- **WHEN** el usuario abre el diagnóstico
- **THEN** la tabla marca `openspec` como no encontrado
- **AND** muestra el comando `npm install -g @fission-ai/openspec`

### Requirement: Aviso de herramientas ausentes
IF falta `openspec` o `node`,
el sistema SHALL mostrar un aviso con el comando de instalación en la pantalla de preparación de OpenSpec y en el panel del agente.

#### Scenario: Pantalla de preparación
- **GIVEN** falta `openspec` y el repositorio seleccionado no está inicializado
- **WHEN** se muestra "Set up OpenSpec"
- **THEN** la pantalla incluye el aviso con el comando de instalación

### Requirement: Variables de entorno propias
WHEN la aplicación lee su configuración del entorno,
el sistema SHALL usar `OSC_DATA`, `OSC_DB` y `OSC_NO_UPDATE_CHECK` junto con `DEFAULT_AGENT`, `OPENSPEC_BIN`, `OPENSPEC_TELEMETRY`, `REPOS_ROOT`, `REPO_SCAN_DEPTH` y `MAX_DOC_BYTES`, y SHALL ignorar `STUDIO_*`, `PORT`, `HOST` y `ALLOWED_HOSTS`.

#### Scenario: Directorio de datos personalizado
- **GIVEN** `OSC_DATA` apunta a un directorio temporal
- **WHEN** la aplicación se inicia
- **THEN** la base, la configuración y el estado de ventana se guardan en ese directorio

#### Scenario: Variable heredada
- **GIVEN** `STUDIO_DATA` está definida y `OSC_DATA` no
- **WHEN** la aplicación se inicia
- **THEN** usa `~/.openspeccontrol` e ignora `STUDIO_DATA`

### Requirement: Proxy para los agentes
WHERE el entorno define `http_proxy`, `https_proxy` o `no_proxy`,
el sistema SHALL pasar esas variables a los agentes también en mayúsculas.

#### Scenario: Proxy corporativo
- **GIVEN** `https_proxy` está definida en minúsculas
- **WHEN** el sistema lanza un agente
- **THEN** el proceso del agente recibe `https_proxy` y `HTTPS_PROXY`
