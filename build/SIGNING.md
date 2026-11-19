# Empaquetado, firma y notarización (Fase 8)

Todo se configura en `electron-builder.yml`; **ningún secreto vive en el repositorio**: la firma y la
notarización se activan solo cuando existen las variables de entorno de abajo (en local o como
secretos de CI en la Fase 10). Sin ellas, los builds funcionan y quedan **sin firmar**.

## Scripts

| Script               | Qué hace                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dist`       | typecheck + build + empaqueta para el SO actual                                          |
| `npm run dist:win`   | NSIS por usuario, x64 + arm64 → `release/<version>/OpenSpecControl-<v>-<arch>-setup.exe` |
| `npm run dist:mac`   | dmg + zip universales (solo se puede ejecutar en macOS)                                  |
| `npm run dist:linux` | AppImage + deb, x64 + arm64                                                              |
| `npm run dist:dir`   | carpeta sin instalador en `release/<version>/win-unpacked` (o equivalente)               |

`scripts/dist.mjs` es un envoltorio fino de `electron-builder` que solo añade la configuración de
Azure Trusted Signing cuando están las variables `AZURE_SIGN_*` (ver abajo). El hook `afterPack`
(`scripts/electron-fuses.mjs`, Fase 7) sigue activo en todos los targets.

## Windows (8.3)

Elige **una** de las dos vías:

- **Certificado** (p. ej. OV/EV): `CSC_LINK` (ruta o base64 del `.pfx`) y `CSC_KEY_PASSWORD`
  (también valen `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`).
- **Azure Trusted Signing**: credenciales `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
  más los datos de la cuenta `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE` y
  `AZURE_SIGN_PUBLISHER`. Deben estar las cuatro `AZURE_SIGN_*`; si falta alguna se ignoran.

El instalador es por usuario (`perMachine: false`, `oneClick: true`) y no pide administrador. Se
genera **un instalador por arquitectura** (`buildUniversalInstaller: false`, ~120 MB cada uno): el
combinado x64+arm64 pesa ~240 MB y rompe la horquilla de 90–120 MB de la tarea 8.7.

## macOS (8.4)

- `hardenedRuntime: true` y `build/entitlements.mac.plist` (solo JIT y memoria ejecutable sin firmar,
  lo que necesita V8; sin cámara, micrófono, Documentos ni Descargas).
- Identidad Developer ID: `CSC_LINK` + `CSC_KEY_PASSWORD` (certificado `.p12`) o el llavero.
- Notarización (`notarize: true`, la hace `@electron/notarize`): `APPLE_API_KEY` +
  `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`, o `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` +
  `APPLE_TEAM_ID`. Sin credenciales electron-builder avisa y omite la notarización.

## Linux (8.5)

AppImage + deb para x64 y arm64, categoría `Development`, sin snap. El `maintainer` usa la dirección
`noreply` de GitHub: cámbiala por un correo real si el deb debe poder contactar con el responsable.

## Estado de verificación (Fase 8)

| Tarea | Estado                                                                                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1   | Hecha: iconos 1024×1024 (`build/icon.png`, `resources/icon.png`); electron-builder deriva `.ico` en Windows sin errores. El `.icns` se deriva al ejecutar `dist:mac`: **no verificado** (requiere macOS).       |
| 8.2   | Hecha y verificada en Windows (`dist:dir`, `dist:win`).                                                                                                                                                         |
| 8.3   | Instalador y configuración hechos; instalación silenciosa/desinstalación verificadas sin elevación. **Firma real no verificada** (sin certificado ni cuenta Azure): `Get-AuthenticodeSignature` da `NotSigned`. |
| 8.4   | Configurado. **No verificado**: requiere macOS, Developer ID y credenciales de notarización (`spctl`, `stapler`).                                                                                               |
| 8.5   | Configurado. **No verificado**: la generación y la instalación en una distro de prueba requieren Linux.                                                                                                         |
| 8.6   | Hecha y verificada.                                                                                                                                                                                             |
| 8.7   | Hecha y verificada sobre `app.asar` y los instaladores de Windows.                                                                                                                                              |
| 8.8   | **No verificable aquí**: depende de instaladores firmados y del recorrido de la Fase 3 sobre la app instalada.                                                                                                  |

Riesgo conocido a vigilar en macOS: el fuse `EnableEmbeddedAsarIntegrityValidation` (Fase 7) junto a
un build `universal` (`@electron/universal` fusiona dos `app.asar`); no se ha podido probar sin macOS.
