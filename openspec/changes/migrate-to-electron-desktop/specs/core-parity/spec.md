# Spec Delta

## Purpose

Garantiza que OpenSpecControl conserva, sin cambios de comportamiento, toda la funcionalidad de OpenSpec Studio 0.3.1 y sus defensas del núcleo, verificada con la matriz manual por sistema operativo y agente.

## ADDED Requirements

### Requirement: Paridad funcional con Studio 0.3.1
WHEN el usuario recorre el flujo completo de trabajo con OpenSpec,
el sistema SHALL ofrecer el tablero por etapas, la revisión con anclaje de comentarios, las rondas con veredictos y diff, el panel del agente, la validación, los artefactos desactualizados, el soporte de git, el historial en el repositorio, las specs principales y los archivados, con el mismo comportamiento que Studio 0.3.1.

#### Scenario: Recorrido completo
- **GIVEN** un repositorio de demostración y un agente conectado
- **WHEN** el usuario propone, revisa con comentarios, envía una ronda, construye, hace commit y archiva
- **THEN** cada paso produce el mismo resultado que en Studio 0.3.1

#### Scenario: Comentario anclado tras recargar
- **GIVEN** un comentario anclado a un texto seleccionado
- **WHEN** el usuario recarga la ventana
- **THEN** el comentario sigue anclado al mismo texto

### Requirement: Agentes soportados
WHEN el usuario conecta un agente,
el sistema SHALL soportar CodeBuddy, Claude Code, Codex y opencode, la reanudación de sesiones, los permisos y la elicitation, y los agentes personalizados de `agents.json` con recarga en caliente.

#### Scenario: Agente personalizado
- **GIVEN** un agente definido en `agents.json`
- **WHEN** el usuario edita ese archivo con la aplicación abierta
- **THEN** el cambio se refleja sin reiniciar

#### Scenario: Reanudar sesión
- **GIVEN** una sesión de agente previa guardada en la base
- **WHEN** el usuario selecciona el repositorio
- **THEN** puede reanudar la sesión con su historial

### Requirement: Defensas del núcleo
WHEN el sistema accede a archivos o ejecuta acciones sobre un repositorio,
el sistema SHALL operar solo sobre carpetas añadidas por el usuario, leer archivos solo dentro de `<repo>/openspec`, restringir la E/S de archivos de los agentes a su sandbox y respetar el límite `MAX_DOC_BYTES`.

#### Scenario: Ruta fuera de las carpetas
- **GIVEN** una acción dirigida a un repositorio que no está en las carpetas añadidas
- **WHEN** el sistema la procesa
- **THEN** devuelve el error `not_found` y no ejecuta nada

#### Scenario: Escape de directorio
- **GIVEN** una petición de archivo con una ruta que sale de `<repo>/openspec`
- **WHEN** el sistema la procesa
- **THEN** la rechaza sin leer ningún archivo

#### Scenario: Documento demasiado grande
- **GIVEN** un documento mayor que `MAX_DOC_BYTES`
- **WHEN** el usuario intenta abrirlo
- **THEN** el sistema devuelve el error `too_large`

### Requirement: Rendimiento de la interfaz
WHEN un agente emite un gran volumen de eventos o se abre una base grande,
el sistema SHALL mantener la interfaz receptiva con sesiones de más de 2000 eventos y SHALL mostrar el rail de repositorios en menos de 2 segundos con una base grande.

#### Scenario: Sesión larga
- **GIVEN** una sesión de agente que emite más de 2000 eventos
- **WHEN** el usuario interactúa con la interfaz durante la sesión
- **THEN** la interfaz no se bloquea

#### Scenario: Base grande
- **GIVEN** un `openspeccontrol.db` grande
- **WHEN** el usuario abre la ventana
- **THEN** el rail de repositorios aparece en menos de 2 segundos
