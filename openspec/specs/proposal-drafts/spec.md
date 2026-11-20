# proposal-drafts Specification

## Purpose

Permite redactar con calma borradores de proposal para OpenSpec en cada repositorio, guardarlos localmente con su historial consultable y enviarlos al agente como Explore o como Propose cuando estén listos.

## Requirements

### Requirement: Crear un borrador

WHEN el usuario pulsa «New draft» en la sección Drafts de un repositorio, el sistema SHALL crear un borrador vacío asociado a ese repositorio, con fecha de creación y fecha de modificación iguales al momento de creación, y SHALL abrirlo en el editor.

#### Scenario: Nuevo borrador

- **GIVEN** el repositorio A está abierto en el rail
- **WHEN** el usuario pulsa «New draft» en la sección Drafts de A
- **THEN** el editor muestra un borrador nuevo de A con título y contenido vacíos
- **AND** el historial de A lo lista con su fecha de creación

#### Scenario: Borrador de un repo en segundo plano

- **GIVEN** A es el repositorio activo y B está abierto
- **WHEN** el usuario pulsa «New draft» en la sección Drafts de B
- **THEN** B pasa a ser el repositorio activo
- **AND** el borrador nuevo pertenece a B

### Requirement: Contenido de un borrador

Cada borrador SHALL tener un título de texto libre y un contenido en markdown. IF el título está vacío, el sistema SHALL mostrarlo en el historial como «Untitled draft» sin guardar ese texto como título.

#### Scenario: Borrador sin título

- **GIVEN** un borrador con título vacío y contenido «Añadir exportación a CSV»
- **WHEN** el usuario mira el historial
- **THEN** el borrador aparece como «Untitled draft»
- **AND** su título guardado sigue vacío

#### Scenario: Vista previa del markdown

- **GIVEN** un borrador cuyo contenido tiene un título markdown y una lista
- **WHEN** el usuario activa la vista previa
- **THEN** el editor muestra el markdown renderizado

### Requirement: Persistencia local de los borradores

El sistema SHALL guardar los borradores en la base de datos local de la aplicación y SHALL NOT escribirlos en el repositorio del usuario. Los borradores SHALL conservarse al reiniciar la aplicación y al cerrar o quitar el repositorio del rail.

#### Scenario: Reinicio

- **GIVEN** el repositorio A tiene dos borradores
- **WHEN** el usuario cierra y vuelve a abrir la aplicación
- **THEN** la sección Drafts de A muestra los dos borradores con su contenido

#### Scenario: El repositorio queda intacto

- **GIVEN** el usuario creó y editó un borrador en A
- **WHEN** consulta `git status` en A
- **THEN** no aparece ningún archivo nuevo ni modificado por el borrador

#### Scenario: Repo quitado y vuelto a añadir

- **GIVEN** A tiene un borrador y el usuario quita su carpeta del espacio de trabajo
- **WHEN** vuelve a añadir la misma carpeta
- **THEN** la sección Drafts de A vuelve a mostrar el borrador

### Requirement: Autoguardado

WHILE el usuario edita un borrador no enviado, el sistema SHALL guardar el título y el contenido automáticamente aproximadamente un segundo después de la última pulsación, SHALL actualizar su fecha de modificación y SHALL indicar en el editor si los cambios están guardados.

#### Scenario: Guardado tras dejar de escribir

- **GIVEN** un borrador abierto en el editor
- **WHEN** el usuario escribe y deja de teclear durante un segundo
- **THEN** el editor indica «Saved»
- **AND** la fecha de modificación del borrador es posterior a la anterior

#### Scenario: Cambiar de vista con cambios pendientes

- **GIVEN** el usuario acaba de escribir en un borrador y aún no pasó un segundo
- **WHEN** abre otro borrador, otro cambio u otro repositorio
- **THEN** el sistema guarda antes el texto pendiente
- **AND** al volver al borrador el texto está completo

#### Scenario: Fallo al guardar

- **GIVEN** el guardado del borrador falla
- **WHEN** el editor recibe el error
- **THEN** el editor indica que los cambios no se guardaron y muestra el motivo
- **AND** el texto escrito sigue en el editor

### Requirement: Historial de borradores

El sistema SHALL listar en la sección Drafts de cada repositorio sus borradores ordenados por fecha de modificación descendente, mostrando para cada uno el título, la fecha de modificación y su estado (borrador o enviado, con el modo de envío).

#### Scenario: Orden del historial

- **GIVEN** A tiene los borradores X (modificado ayer) e Y (modificado hoy)
- **WHEN** el usuario despliega la sección Drafts de A
- **THEN** Y aparece antes que X

#### Scenario: Repositorio sin borradores

- **GIVEN** A no tiene borradores
- **WHEN** el usuario despliega la sección Drafts de A
- **THEN** la sección muestra solo la acción «New draft» y un texto que indica que no hay borradores

### Requirement: Búsqueda en el historial

WHEN el usuario escribe un texto en el buscador de la sección Drafts, el sistema SHALL mostrar solo los borradores de ese repositorio cuyo título o contenido contengan el texto, sin distinguir mayúsculas ni acentos y aceptando coincidencias parciales de palabra.

#### Scenario: Búsqueda por contenido sin acentos

- **GIVEN** A tiene un borrador titulado «Informe» cuyo contenido dice «Añadir búsqueda por cliente»
- **WHEN** el usuario busca «busqueda»
- **THEN** el historial muestra ese borrador

#### Scenario: Búsqueda por título parcial

- **GIVEN** A tiene un borrador titulado «Exportación CSV»
- **WHEN** el usuario busca «export»
- **THEN** el historial muestra ese borrador

#### Scenario: Término de uno o dos caracteres

- **GIVEN** A tiene un borrador titulado «UI de pagos»
- **WHEN** el usuario busca «ui»
- **THEN** el historial muestra ese borrador

#### Scenario: Sin resultados

- **GIVEN** ningún borrador de A contiene «kubernetes»
- **WHEN** el usuario busca «kubernetes»
- **THEN** el historial indica que no hay coincidencias y ofrece limpiar la búsqueda

#### Scenario: La búsqueda no cruza repositorios

- **GIVEN** solo el repositorio B tiene un borrador con «facturación»
- **WHEN** el usuario busca «facturación» en la sección Drafts de A
- **THEN** el historial de A no muestra resultados

### Requirement: Enviar un borrador a OpenSpec

WHEN el usuario pulsa «Explore» o «Propose» en un borrador no enviado, el sistema SHALL enviar el contenido del borrador al agente del repositorio con el comando OpenSpec de ese modo, conectando el agente si no lo está, igual que el diálogo «New change».

#### Scenario: Enviar como proposal

- **GIVEN** un borrador de A con contenido «Añadir exportación a CSV del informe mensual»
- **AND** el agente de A está conectado y libre
- **WHEN** el usuario pulsa «Propose»
- **THEN** el agente recibe el comando de proposal de OpenSpec con ese contenido
- **AND** el panel del agente muestra el turno en curso

#### Scenario: Enviar como explore con el agente desconectado

- **GIVEN** un borrador de A y el agente de A desconectado
- **WHEN** el usuario pulsa «Explore»
- **THEN** el sistema conecta el agente de A
- **AND** le envía el comando de explore de OpenSpec con el contenido del borrador

#### Scenario: Proposal sin contenido

- **GIVEN** un borrador con el contenido vacío
- **WHEN** el usuario mira los botones de envío
- **THEN** «Propose» está deshabilitado
- **AND** «Explore» sigue disponible

### Requirement: Límite de caracteres para enviar

IF el contenido de un borrador supera 4000 caracteres, THEN el sistema SHALL mostrar una advertencia con el número de caracteres y el límite, SHALL deshabilitar «Explore» y «Propose» y SHALL seguir permitiendo editar y guardar el borrador.

#### Scenario: Contador dentro del límite

- **GIVEN** un borrador con 3200 caracteres
- **WHEN** el usuario lo edita
- **THEN** el editor muestra «3200 / 4000» sin advertencia
- **AND** los botones de envío están habilitados

#### Scenario: Borrador demasiado largo

- **GIVEN** un borrador con 4210 caracteres
- **WHEN** el usuario lo edita
- **THEN** el editor muestra una advertencia «4210 / 4000: shorten the draft to send it»
- **AND** «Explore» y «Propose» están deshabilitados
- **AND** el borrador se sigue guardando

#### Scenario: El núcleo rechaza un envío demasiado largo

- **GIVEN** un borrador con más de 4000 caracteres
- **WHEN** llega al núcleo una petición de envío de ese borrador
- **THEN** el núcleo la rechaza sin enviar nada al agente
- **AND** el borrador sigue sin enviar

### Requirement: Borrador enviado

WHEN el agente acepta el envío de un borrador, el sistema SHALL marcarlo como enviado con el modo (Explore o Propose) y la fecha de envío, y SHALL mostrarlo en solo lectura. IF el envío falla, THEN el sistema SHALL dejar el borrador sin enviar y SHALL mostrar el motivo.

#### Scenario: Envío aceptado

- **GIVEN** un borrador de A sin enviar
- **WHEN** el usuario pulsa «Propose» y el agente acepta el comando
- **THEN** el historial muestra el borrador como «Sent as proposal» con la fecha de envío
- **AND** el editor lo muestra en solo lectura, sin botones de envío

#### Scenario: Agente ocupado

- **GIVEN** el agente de A está trabajando en otro turno
- **WHEN** el usuario pulsa «Explore» en un borrador de A
- **THEN** el sistema muestra que el agente sigue trabajando
- **AND** el borrador sigue editable y sin enviar

#### Scenario: Editar un borrador enviado

- **GIVEN** un borrador enviado
- **WHEN** llega al núcleo una petición para guardar cambios en ese borrador
- **THEN** el núcleo la rechaza
- **AND** el contenido enviado queda como estaba

### Requirement: Duplicar un borrador

WHEN el usuario pulsa «Duplicate» en un borrador, el sistema SHALL crear un borrador nuevo sin enviar en el mismo repositorio, con el mismo contenido, el título original seguido de « (copy)» y fechas de creación y modificación nuevas, y SHALL abrirlo en el editor.

#### Scenario: Duplicar un enviado

- **GIVEN** un borrador enviado titulado «Exportación CSV»
- **WHEN** el usuario pulsa «Duplicate»
- **THEN** el editor abre un borrador nuevo editable titulado «Exportación CSV (copy)» con el mismo contenido
- **AND** el borrador original sigue enviado y sin cambios

### Requirement: Borrar un borrador

WHEN el usuario pide borrar un borrador y confirma, el sistema SHALL eliminarlo del historial y de la base de datos. WHEN el usuario cancela la confirmación, el sistema SHALL conservarlo.

#### Scenario: Borrar con confirmación

- **GIVEN** un borrador abierto en el editor
- **WHEN** el usuario pulsa «Delete» y confirma
- **THEN** el borrador desaparece del historial y de la búsqueda
- **AND** el editor se cierra

#### Scenario: Cancelar el borrado

- **GIVEN** un borrador en el historial
- **WHEN** el usuario pulsa «Delete» y cancela
- **THEN** el borrador sigue en el historial sin cambios
