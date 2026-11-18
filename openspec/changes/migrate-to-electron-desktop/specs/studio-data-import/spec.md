# Spec Delta

## Purpose

Define cómo OpenSpecControl recupera los datos de quienes ya usan OpenSpec Studio: importación única y no destructiva del directorio de datos, y lectura de respaldo del archivo de revisión antiguo.

## ADDED Requirements

### Requirement: Importación única en el primer arranque
WHEN la aplicación se inicia, no existe la base de OpenSpecControl y existe `~/.openspec-studio/studio.db`,
el sistema SHALL importar la base, `config.json` y `agents.json` al directorio de datos de OpenSpecControl antes de abrir la base.

#### Scenario: Usuario de Studio 0.3.1
- **GIVEN** `~/.openspec-studio` contiene carpetas, comentarios y rondas de revisión
- **WHEN** el usuario abre OpenSpecControl por primera vez
- **THEN** ve sus carpetas, comentarios y rondas de revisión
- **AND** el sistema crea el archivo de marca de la importación con el origen, la fecha y los archivos copiados

#### Scenario: Instalación sin Studio
- **GIVEN** no existe `~/.openspec-studio`
- **WHEN** el usuario abre la aplicación por primera vez
- **THEN** arranca con datos vacíos sin mostrar ningún error

### Requirement: Importación no repetida
WHEN ya existe la base de OpenSpecControl,
el sistema SHALL NOT repetir la importación ni sobrescribir ningún dato existente.

#### Scenario: Segundo arranque
- **GIVEN** la importación ya se realizó y el usuario añadió un comentario nuevo
- **WHEN** reinicia la aplicación
- **THEN** el comentario nuevo sigue presente y no se importa nada de Studio

### Requirement: Origen intacto
WHILE se importan los datos,
el sistema SHALL NOT modificar ni borrar ningún archivo de `~/.openspec-studio` y SHALL NOT copiar `update-check.json`.

#### Scenario: Comparación del origen
- **GIVEN** `~/.openspec-studio` con una huella conocida de sus archivos
- **WHEN** termina la importación
- **THEN** la huella del origen es idéntica a la anterior

### Requirement: Copia consistente y tolerante a fallos
WHEN el origen está en uso por Studio o está dañado,
el sistema SHALL copiar la base de forma consistente desde una conexión de solo lectura o, si no puede, registrar el motivo y arrancar con datos vacíos sin impedir el inicio.

#### Scenario: Studio abierto
- **GIVEN** OpenSpec Studio está abierto escribiendo en su base
- **WHEN** OpenSpecControl se inicia por primera vez
- **THEN** importa una copia consistente de la base

#### Scenario: Base dañada
- **GIVEN** `studio.db` está corrupta
- **WHEN** OpenSpecControl se inicia por primera vez
- **THEN** registra el motivo del fallo y arranca con datos vacíos
- **AND** una nueva importación es posible borrando `~/.openspeccontrol`

### Requirement: Archivo de revisión heredado
WHEN un cambio no tiene `.openspeccontrol-review.json` pero sí `.studio-review.json`,
el sistema SHALL leer este último, y las exportaciones SHALL escribir solo `.openspeccontrol-review.json` sin borrar ni reescribir el archivo antiguo.

#### Scenario: Lectura de respaldo
- **GIVEN** un cambio solo tiene `.studio-review.json` con formato `openspec-studio-review`
- **WHEN** el usuario abre la revisión de ese cambio
- **THEN** los comentarios del archivo antiguo aparecen en la interfaz

#### Scenario: Exportación
- **GIVEN** el modo "revisión en el repositorio" está activo
- **WHEN** el sistema exporta la revisión
- **THEN** escribe `.openspeccontrol-review.json`
- **AND** el archivo `.studio-review.json` queda sin cambios

### Requirement: Archivos de revisión fuera de la firma de artefactos
WHEN el sistema calcula si los artefactos de un cambio están desactualizados,
el sistema SHALL ignorar tanto `.openspeccontrol-review.json` como `.studio-review.json`.

#### Scenario: Solo cambia el archivo de revisión
- **GIVEN** los artefactos de un cambio están al día
- **WHEN** se exporta o se modifica solo un archivo de revisión
- **THEN** los artefactos no se marcan como desactualizados
