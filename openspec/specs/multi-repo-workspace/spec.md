# multi-repo-workspace Specification

## Purpose

Permite trabajar con varios repositorios abiertos a la vez en el rail izquierdo, manteniendo un único repositorio activo en el documento y en el panel del agente, con estado independiente por repo y avisos de lo que ocurre en los repos en segundo plano.

## Requirements

### Requirement: Lista de repositorios abiertos

The system SHALL keep a list of open repositories shown in the repository rail, and WHEN the user picks a repository in the repository picker THEN the system SHALL add it to the list (if absent) and make it the active repository without closing the others.

#### Scenario: Abrir un segundo repo
- **GIVEN** el repo A está abierto y activo
- **WHEN** el usuario elige el repo B en el selector
- **THEN** el rail muestra las secciones de A y de B
- **AND** B es el repo activo y A sigue abierto

#### Scenario: Elegir un repo ya abierto
- **GIVEN** A y B están abiertos y A es el activo
- **WHEN** el usuario elige B en el selector
- **THEN** B pasa a ser el activo y no se duplica en la lista

### Requirement: Un único repo activo

The system SHALL show in the document pane and in the agent panel only the active repository, and WHEN the user activates another open repository THEN the system SHALL show that repository's last known state immediately and refresh it in the background.

#### Scenario: Cambiar de repo conserva el contexto
- **GIVEN** A y B abiertos, y en A el cambio `x` abierto en la pestaña `design`
- **WHEN** el usuario activa B y vuelve a activar A
- **THEN** A muestra de inmediato el cambio `x` en la pestaña `design`
- **AND** los datos se actualizan al terminar la recarga

#### Scenario: Una respuesta tardía no cambia de repo
- **GIVEN** una petición de cambios de A en curso
- **WHEN** el usuario activa B antes de que responda
- **THEN** la respuesta se guarda en el estado de A
- **AND** el repo activo B no muestra los cambios de A

### Requirement: Sección por repositorio abierto

The system SHALL render one collapsible section per open repository in the rail, showing its name, current branch, agent status and number of pending decisions, followed by its changes grouped by stage, its specs and its archived changes.

#### Scenario: Cabecera de sección
- **GIVEN** el agente del repo A está trabajando y pide un permiso
- **WHEN** el usuario mira el rail
- **THEN** la sección de A muestra el estado del agente y una marca con 1 decisión pendiente

#### Scenario: Plegar una sección
- **WHEN** el usuario pliega la sección de un repo
- **THEN** se ocultan sus cambios, specs y archivados y se mantiene la cabecera
- **AND** al reiniciar la app la sección sigue plegada

### Requirement: Abrir un cambio de otro repositorio

WHEN the user opens a change from the section of a repository that is not active THEN the system SHALL activate that repository and open the change in the document pane.

#### Scenario: Clic en un cambio de un repo en segundo plano
- **GIVEN** A es el activo y B está abierto con el cambio `y`
- **WHEN** el usuario pulsa la tarjeta del cambio `y` en la sección de B
- **THEN** B pasa a ser el activo
- **AND** el documento muestra el cambio `y`

#### Scenario: Acción de la tarjeta en otro repo
- **WHEN** el usuario elige una acción del menú de una tarjeta de un repo no activo
- **THEN** la acción se ejecuta sobre ese repo y no sobre el activo

### Requirement: Estado de los repos en segundo plano

WHILE a repository is open but not active, the system SHALL keep its section up to date from the messages of that repository: agent status, pending decisions, and changes after artifact or review files change.

#### Scenario: Cambia un archivo en un repo en segundo plano
- **GIVEN** B está abierto y no es el activo
- **WHEN** un archivo de `openspec/` de B cambia en disco
- **THEN** la sección de B actualiza sus cambios sin que el usuario la active

#### Scenario: Termina un turno en segundo plano
- **GIVEN** el agente de B trabaja y B no es el activo
- **WHEN** el agente de B termina su turno
- **THEN** la sección de B pasa a mostrar el agente en espera

### Requirement: Avisos de repos en segundo plano

WHEN the agent of a repository that is not active requests a decision or finishes a turn, the system SHALL notify the user with a notification that names the repository.

#### Scenario: Permiso pedido en segundo plano
- **GIVEN** A es el activo y la ventana está sin foco
- **WHEN** el agente de B pide un permiso
- **THEN** se muestra una notificación del sistema que indica el repo B

#### Scenario: Ventana con foco
- **GIVEN** la ventana tiene el foco
- **WHEN** el agente de B pide un permiso
- **THEN** la sección de B muestra la marca de decisión pendiente sin notificación del sistema

### Requirement: Cerrar un repositorio abierto

WHEN the user closes an open repository THEN the system SHALL remove it from the rail and stop watching it; IF its agent session is live THEN the system SHALL ask for confirmation first and, once confirmed, disconnect the agent.

#### Scenario: Cerrar un repo sin agente
- **GIVEN** B está abierto sin sesión de agente
- **WHEN** el usuario cierra B
- **THEN** B desaparece del rail y deja de vigilarse

#### Scenario: Cerrar un repo con agente
- **GIVEN** el agente de B está conectado
- **WHEN** el usuario cierra B
- **THEN** se pide confirmación indicando que el agente se desconectará
- **AND** si el usuario cancela, B sigue abierto con su sesión intacta

#### Scenario: Cerrar el repo activo
- **GIVEN** A es el activo y B está abierto
- **WHEN** el usuario cierra A
- **THEN** B pasa a ser el activo
- **AND** si no queda ningún repo abierto, el centro muestra «Pick a repository»

### Requirement: Persistencia de la sesión de trabajo

The system SHALL remember the open repositories, the active repository and the collapsed sections across restarts, and WHEN the app starts THEN the system SHALL restore them, skipping repositories that no longer exist in the workspace.

#### Scenario: Reinicio con dos repos
- **GIVEN** A (activo) y B abiertos al cerrar la app
- **WHEN** el usuario vuelve a abrirla
- **THEN** el rail muestra A y B con A activo

#### Scenario: Un repo desapareció
- **GIVEN** B estaba abierto y su carpeta se quitó del workspace
- **WHEN** la app arranca o se rescanean las carpetas
- **THEN** B se elimina de la lista de abiertos sin mostrar error

### Requirement: Límite de repositorios abiertos

The system SHALL allow at most 8 repositories open at the same time, and IF the user tries to open another THEN the system SHALL not open it and SHALL tell the user to close one first.

#### Scenario: Noveno repo
- **GIVEN** hay 8 repos abiertos
- **WHEN** el usuario elige un noveno repo en el selector
- **THEN** no se abre y aparece un aviso que pide cerrar alguno

### Requirement: Aislamiento de fallos entre secciones

IF rendering one repository's section fails THEN the system SHALL show an error only in that section and keep the other sections, the document pane and the agent panel working.

#### Scenario: Una sección falla
- **GIVEN** la sección de B lanza un error al renderizarse
- **WHEN** el usuario mira el rail
- **THEN** la sección de B muestra «Try again»
- **AND** la sección de A y el resto de la app siguen funcionando
