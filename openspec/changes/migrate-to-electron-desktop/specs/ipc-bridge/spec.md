# Spec Delta

## Purpose

Define cómo se comunican la interfaz y el núcleo de OpenSpecControl: únicamente mediante una API expuesta por el preload, validada por emisor y por esquema, sin abrir puertos de red.

## ADDED Requirements

### Requirement: Acceso solo mediante la API expuesta
WHEN el renderer necesita una operación del núcleo,
el sistema SHALL ofrecerla únicamente mediante la API `window.osc` del preload, y el renderer SHALL NOT tener acceso a Node.js ni a Electron directamente.

#### Scenario: Operación válida
- **GIVEN** el renderer está cargado
- **WHEN** invoca `window.osc.repos()`
- **THEN** recibe la lista de repositorios

#### Scenario: Sin acceso a Node
- **GIVEN** el renderer está cargado
- **WHEN** el código de la página intenta usar `require` o `process`
- **THEN** esos objetos no están disponibles

### Requirement: Validación del emisor
WHEN llega un mensaje IPC,
el sistema SHALL aceptarlo solo si proviene del frame principal de la ventana de la aplicación y de su origen esperado, y SHALL rechazar cualquier otro sin ejecutar nada.

#### Scenario: Iframe o página externa
- **GIVEN** un iframe o una página externa se carga dentro de la ventana
- **WHEN** intenta ejecutar una acción sobre un repositorio
- **THEN** el mensaje se rechaza
- **AND** no se ejecuta ninguna acción ni se crea ningún proceso

#### Scenario: Otra ventana
- **GIVEN** existe otra ventana o contenido web distinto de la ventana principal de la aplicación
- **WHEN** envía un mensaje IPC
- **THEN** el mensaje se rechaza

### Requirement: Validación de argumentos
WHEN un mensaje IPC trae argumentos,
el sistema SHALL validarlos contra su esquema y, si no cumplen, SHALL rechazar la petición con un error de código `invalid` y sin efectos secundarios.

#### Scenario: Argumentos inválidos
- **GIVEN** una petición con un campo obligatorio ausente
- **WHEN** el sistema la procesa
- **THEN** devuelve un error `invalid`
- **AND** no modifica la base de datos ni los archivos

### Requirement: Errores uniformes
WHEN una operación falla,
el sistema SHALL devolver un error con un código entre `invalid`, `not_found`, `conflict`, `too_large` o `internal` y un mensaje legible, y el renderer SHALL mostrar el mismo texto que mostraría la versión web de Studio.

#### Scenario: Cambio inexistente
- **GIVEN** un comentario dirigido a un cambio que no existe
- **WHEN** el usuario intenta guardarlo
- **THEN** la interfaz muestra el mensaje de error con el código `invalid`

### Requirement: Sin puertos de red
WHILE la aplicación está en ejecución,
el sistema SHALL NOT abrir ningún puerto TCP ni aceptar conexiones de red entrantes.

#### Scenario: Comprobación de puertos
- **GIVEN** la aplicación está abierta con un agente trabajando
- **WHEN** se listan los puertos en escucha del proceso
- **THEN** la aplicación no aparece con ningún puerto abierto

### Requirement: Recuperación del estado al recargar
WHEN el renderer se recarga o se destruye,
el sistema SHALL liberar sus suscripciones y los observadores de archivos asociados, y al volver a suscribirse SHALL reenviar el estado de la sesión y el registro de eventos (`replay`) del repositorio seleccionado.

#### Scenario: Recarga de la ventana
- **GIVEN** un repositorio seleccionado con un transcript de agente en curso
- **WHEN** el usuario recarga la ventana
- **THEN** la interfaz recupera el repositorio y el transcript completo

#### Scenario: Ventana destruida
- **GIVEN** un repositorio sin sesión de agente y con un único suscriptor
- **WHEN** el renderer se destruye
- **THEN** el observador de archivos de ese repositorio se detiene
