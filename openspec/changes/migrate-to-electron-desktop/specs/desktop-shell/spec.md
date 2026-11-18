# Spec Delta

## Purpose

Define el comportamiento de la ventana y del ciclo de vida de OpenSpecControl como aplicación de escritorio: instancia única, estado de ventana, cierre seguro, menú y particularidades de macOS.

## ADDED Requirements

### Requirement: Instancia única por usuario
WHEN el usuario abre la aplicación y ya existe una instancia en ejecución,
el sistema SHALL enfocar y restaurar la ventana de la instancia existente y cerrar el proceso nuevo, sin abrir una segunda base de datos ni una segunda sesión de agente por repositorio.

#### Scenario: Segunda apertura
- **GIVEN** OpenSpecControl está abierto y minimizado
- **WHEN** el usuario lo abre otra vez
- **THEN** la ventana existente se restaura y recibe el foco
- **AND** no queda ningún proceso nuevo de la aplicación

### Requirement: Estado de la ventana
WHEN el usuario cierra la aplicación,
el sistema SHALL guardar el tamaño, la posición y el estado maximizado de la ventana, y al abrirla SHALL restaurarlos solo si quedan dentro de un monitor disponible, con un tamaño mínimo de 1024×640.

#### Scenario: Restauración normal
- **GIVEN** la ventana se cerró en el monitor secundario con un tamaño de 1400×900
- **WHEN** el usuario abre la aplicación y ese monitor sigue conectado
- **THEN** la ventana aparece en la misma posición y con el mismo tamaño

#### Scenario: Monitor desconectado
- **GIVEN** la última posición guardada pertenece a un monitor que ya no existe
- **WHEN** el usuario abre la aplicación
- **THEN** la ventana aparece completa dentro de un monitor disponible

### Requirement: Cierre seguro con agentes activos
WHEN el usuario intenta cerrar la aplicación y algún repositorio tiene un agente trabajando o decisiones pendientes,
el sistema SHALL pedir confirmación antes de cerrar, e indicar qué repositorio tiene el agente trabajando.

#### Scenario: El usuario cancela
- **GIVEN** un agente está en estado `busy`
- **WHEN** el usuario cierra la ventana en Windows y pulsa "Cancelar" en la confirmación
- **THEN** la aplicación sigue abierta
- **AND** el turno del agente continúa sin interrupción

#### Scenario: El usuario confirma
- **GIVEN** un agente está en estado `busy`
- **WHEN** el usuario confirma el cierre
- **THEN** el sistema detiene el proceso del agente con todo su árbol de procesos
- **AND** cierra la base de datos de forma limpia
- **AND** no queda ningún proceso huérfano

#### Scenario: Cierre sin actividad
- **GIVEN** ningún agente está trabajando y no hay decisiones pendientes
- **WHEN** el usuario cierra la ventana
- **THEN** la aplicación se cierra sin pedir confirmación

### Requirement: Ciclo de vida en macOS
WHEN el usuario cierra la última ventana en macOS,
el sistema SHALL mantener la aplicación y las sesiones de agente en ejecución, y SHALL reabrir la ventana al activar la aplicación desde el dock, mostrando el registro de la sesión (`replay`).

#### Scenario: Cerrar y reabrir en macOS
- **GIVEN** un agente está trabajando y el usuario cierra la ventana en macOS
- **WHEN** el usuario hace clic en el icono del dock
- **THEN** la ventana se reabre con el transcript del agente hasta ese momento

### Requirement: Salida en Windows y Linux
WHEN el usuario cierra la última ventana en Windows o Linux,
el sistema SHALL cerrar la aplicación tras aplicar la regla de cierre seguro.

#### Scenario: Cierre en Windows
- **GIVEN** no hay actividad de agentes
- **WHEN** el usuario cierra la ventana en Windows
- **THEN** el proceso de la aplicación termina

### Requirement: Menú de aplicación
WHEN la aplicación se inicia,
el sistema SHALL mostrar un menú nativo con Archivo, Editar, Ver, Ventana y Ayuda, donde Editar incluya deshacer, rehacer, cortar, copiar, pegar y seleccionar todo, y las herramientas de desarrollo estén disponibles solo en versiones no empaquetadas.

#### Scenario: Copiar y pegar en macOS
- **GIVEN** el cursor está en un campo de texto
- **WHEN** el usuario pulsa `Cmd+C` y `Cmd+V`
- **THEN** el texto se copia y se pega

#### Scenario: Versión empaquetada
- **GIVEN** la aplicación está instalada desde un instalador
- **WHEN** el usuario abre el menú Ver
- **THEN** no hay opción para abrir las herramientas de desarrollo

### Requirement: Fallo del renderer
WHEN el proceso del renderer termina de forma inesperada o deja de responder,
el sistema SHALL registrar el motivo y ofrecer recargar la ventana, de modo que la recarga recupere el estado de las sesiones sin pérdida de transcript.

#### Scenario: Renderer caído
- **GIVEN** el renderer termina con un error
- **WHEN** el usuario elige recargar
- **THEN** la interfaz vuelve a mostrar el repositorio seleccionado con su transcript completo
