# Expedita — Panel de Diagnóstico

Panel de uso interno (solo Ignacio) para ver, de un vistazo, el estado de
Staging: salud del sistema (n8n, DB, Meta/WhatsApp, infraestructura) y
negocio/costos. Sin historial — solo snapshot del momento.

Frontend estático (`src/`) que consume vía `fetch()` un webhook JSON
expuesto por n8n.

## ⚠️ El backend no vive acá

El backend (WF5, el workflow de n8n que arma y expone el JSON de
diagnóstico) vive en el repo **`dental-clinic-bot`**, junto a los demás
workflows (WF1-WF4) y su tooling de export/import/validate. Este repo
(`expedita-diagnostico`) contiene **solo** el frontend, su documentación y
la configuración de CI/deploy.

## Documentación

La especificación técnica completa está en [docs/SPEC.md](docs/SPEC.md).
