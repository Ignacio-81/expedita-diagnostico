# expedita-diagnostico

Panel de diagnóstico de uso interno (solo Ignacio): un vistazo al estado de
Staging — salud del sistema (n8n, DB, Meta/WhatsApp, infraestructura) y
negocio/costos. Una sola página, sin routing, sin historial — solo snapshot
del momento vía `fetch()` a un webhook que devuelve JSON. Ver
[docs/SPEC.md](docs/SPEC.md) para la especificación completa.

## El backend NO vive acá

WF5 — el workflow de n8n que arma y expone el JSON de diagnóstico — vive en
el repo **`dental-clinic-bot`**, junto a WF1-WF4 y su tooling de
export/import/validate. Este repo (`expedita-diagnostico`) es **solo
frontend + docs + CI**: no hay nada de n8n, Postgres ni Meta API acá
directamente, solo el consumo del contrato JSON que expone `staging`.

El contrato JSON completo está en
[docs/CONTRATO_JSON.md](docs/CONTRATO_JSON.md), con un ejemplo real en
[docs/mock-response.json](docs/mock-response.json) para desarrollar el
frontend sin depender de que WF5 esté desplegado.

## Restricción dura: User-Agent contra staging.expedita.com.ar

Cloudflare está delante de `staging.expedita.com.ar` y filtra requests por
User-Agent **antes** de que lleguen a n8n. Cualquier UA que contenga la
subcadena `"bot"` recibe un `204` con body vacío — indistinguible de una
respuesta válida, rompe clientes en silencio. El `fetch()` del navegador no
tiene este problema (usa el UA real del browser), pero **cualquier script**
(verificación post-deploy, testing, curl en una terminal) que hable con el
webhook de WF5 debe setear un User-Agent explícito sin `"bot"` — usar
`expedita-diagnostico/1.0`, mismo patrón que `scripts/verify-deploy.py` en
`dental-clinic-bot`.

## Nunca hardcodear el token

`DIAG_TOKEN` no se commitea ni se hardcodea en `src/app.js` (ese archivo es
público: cualquiera que vea el código fuente de la página lo leería). Se
pide con `prompt()` si no está en `sessionStorage`, y se limpia ante un
401/403. Detalle completo en §8 de `docs/SPEC.md`.

## Ramas y commits

```
feature/<descripcion> → main
```

Convención de commits: `feat: | fix: | docs: | chore: | style:`

## Antes de commitear

Ver `.claude/skills/diagnostico-qa/SKILL.md`.
