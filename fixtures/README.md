# Fixtures

JSON con la forma completa del contrato `4.0` (post 2026-10-02: reglas por
mensaje de Meta, cupo de service). Sin tokens ni datos personales. Sirven para
desarrollar y probar el panel sin pegarle a ningún ambiente: en localhost,
`?mock=<nombre>` los carga (allowlist fija en `src/app.js`).

| `?mock=` | Archivo | Qué cubre |
|---|---|---|
| `staging` | `diagnostico-staging.json` | Bloque real de `negocio.costos` de staging (2026-10-02). Fuente de verdad, se edita a mano. |
| `cupo-agotado` | `diagnostico-cupo-agotado.json` | `consumidos_mes` 1025, `restantes` 0, `agotado_observado` true. |
| `cupo-se-agota` | `diagnostico-cupo-se-agota.json` | `se_agota_este_mes` true con `fecha_agotamiento_estimada`. |
| `cupo-null` | `diagnostico-cupo-null.json` | `cupo_service: null`. |
| `estimado-null` | `diagnostico-estimado-null.json` | `meta_estimado_*` y proyecciones en null (< 7 días). |
| `legacy` | `diagnostico-legacy.json` | Payload viejo: sin ningún campo nuevo (ambiente no actualizado). |

Las variantes se generan con `python3 fixtures/generar-variantes.py` a partir
de `diagnostico-staging.json`.

⚠️ El texto de `costos.nota` de estos fixtures es una **reconstrucción** a
partir de la descripción del cambio del backend, no el texto real de WF5.
