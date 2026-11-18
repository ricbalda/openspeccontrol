# Spec Delta

## Purpose

Define cómo OpenSpecControl usa las capacidades nativas del sistema operativo en lugar de las del navegador: diálogo de carpetas, notificaciones, contador de pendientes, enlaces externos, tema y repositorio de demostración.

## ADDED Requirements

### Requirement: Selector de carpetas nativo
WHEN el usuario pulsa "Add folder" o elige Archivo → Añadir carpeta,
el sistema SHALL abrir el diálogo nativo de selección de carpetas y añadir la carpeta elegida conservando la validación vigente: ruta absoluta existente que no sea la raíz de un disco.

#### Scenario: Carpeta válida
- **GIVEN** el diálogo está abierto
- **WHEN** el usuario elige una carpeta existente
- **THEN** la carpeta se añade y sus repositorios aparecen en el rail

#### Scenario: Diálogo cancelado
- **GIVEN** el diálogo está abierto
- **WHEN** el usuario lo cancela
- **THEN** no se añade nada y no se muestra ningún error

#### Scenario: Raíz de disco
- **GIVEN** el usuario selecciona la raíz de un disco
- **WHEN** el sistema valida la ruta
- **THEN** rechaza la carpeta y muestra el error de validación

### Requirement: Ruta escrita a mano
WHERE la carpeta está en una ruta de red o en WSL,
el sistema SHALL permitir escribir o pegar la ruta (incluido `~`) como alternativa al diálogo, con la misma validación.

#### Scenario: Ruta con tilde
- **GIVEN** el usuario escribe `~/proyectos`
- **WHEN** confirma
- **THEN** el sistema resuelve la ruta al directorio del usuario y la valida

### Requirement: Notificaciones nativas
WHEN un turno del agente termina o el agente pide una decisión y la ventana no tiene el foco,
el sistema SHALL mostrar una notificación nativa del sistema, y al hacer clic en ella SHALL restaurar y enfocar la ventana.

#### Scenario: Ventana en segundo plano
- **GIVEN** la ventana está en segundo plano y un agente pide un permiso
- **WHEN** llega la petición
- **THEN** aparece una notificación nativa
- **AND** la ventana parpadea en la barra de tareas

#### Scenario: Ventana con foco
- **GIVEN** la ventana tiene el foco
- **WHEN** termina un turno del agente
- **THEN** no se muestra ninguna notificación del sistema

### Requirement: Contador de pendientes
WHEN cambia el número de interacciones pendientes sumando todos los repositorios,
el sistema SHALL reflejar ese número como contador en el icono de la aplicación (dock en macOS y Linux, icono superpuesto en Windows) y SHALL quitarlo cuando llegue a cero.

#### Scenario: Decisiones pendientes
- **GIVEN** dos repositorios tienen una decisión pendiente cada uno
- **WHEN** el sistema actualiza el contador
- **THEN** el icono muestra el número 2

### Requirement: Enlaces externos
WHEN el usuario hace clic en un enlace dentro de un documento o del panel del agente,
el sistema SHALL abrir en el navegador del sistema solo los enlaces `http:`, `https:` y `mailto:`, y la ventana de la aplicación SHALL NOT navegar fuera de la interfaz.

#### Scenario: Enlace https
- **GIVEN** un documento contiene un enlace a `https://example.com`
- **WHEN** el usuario lo pulsa
- **THEN** se abre en el navegador del sistema
- **AND** la ventana de la aplicación no cambia de página

#### Scenario: Esquema no permitido
- **GIVEN** un enlace con el esquema `file:` o `javascript:`
- **WHEN** el usuario lo pulsa
- **THEN** no se abre nada y la ventana no navega

### Requirement: Tema nativo
WHEN el usuario cambia el tema entre sistema, claro y oscuro,
el sistema SHALL aplicarlo también a los elementos nativos, como la barra de título y los menús.

#### Scenario: Cambio a oscuro
- **GIVEN** el tema del sistema es claro
- **WHEN** el usuario elige el tema oscuro
- **THEN** la interfaz y la barra de título pasan a oscuro

### Requirement: Repositorio de demostración
WHEN el usuario elige Ayuda → Crear repositorio de demostración,
el sistema SHALL pedir una carpeta y un agente, crear el repositorio de demostración sin bloquear la interfaz, añadir la carpeta y seleccionar el repositorio creado.

#### Scenario: Creación correcta
- **GIVEN** el usuario elige una carpeta vacía y un agente
- **WHEN** termina la creación
- **THEN** el repositorio aparece seleccionado con el cambio `add-hello-endpoint`

#### Scenario: Carpeta no escribible
- **GIVEN** el usuario elige una carpeta sin permisos de escritura
- **WHEN** el sistema intenta crear el repositorio
- **THEN** muestra un error y no añade ninguna carpeta
