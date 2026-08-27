# Expedita — Panel de Diagnóstico
## Especificación técnica (v2 — solo Staging)

**Versión:** 2.0 — 2026-08-27
**Cambio respecto a v1:** se elimina todo alcance para Develop/Docker local
(no tiene sentido diagnosticar un ambiente que no está siempre arriba). Esta
v1 de producto es **exclusivamente Staging**.

---

## 0. Objetivo

Panel de uso interno (solo Ignacio) para ver, de un vistazo, el estado de
Staging: salud del sistema y negocio/costos. Sin historial — solo snapshot
del momento.

---

## 1. Decisiones tomadas

| Decisión | Valor |
|---|---|
| Alcance | **Solo Staging.** Nada de Develop en esta versión. |
| Audiencia | Solo Ignacio |
| Historial | No — snapshot on-demand |
| Forma de servirlo | Backend n8n (webhook) expone JSON; frontend estático separado lo consume |
| Errores | Tabla por workflow (OK/falladas/tasa/último error), no solo tasa global |
| Costos Meta/Groq | Estimados, marcados como tales (no hay medición real — ver §6.4) |

---

## 2. Repos reales del proyecto (confirmado por lectura directa)

| Repo | Qué es | Convenciones a heredar |
|---|---|---|
| **`dental-clinic-bot`** | Los 4 workflows de n8n (WF1-WF4), `envs/`, `scripts/` de export/import/validate/patch-env, `docs/`. Tiene `.claude/skills/n8n-workflow-dev`, `n8n-workflow-qa`. | WF5 se agrega **acá**, no en un repo nuevo — reutiliza todo el tooling existente. |
| **`expedita-web`** | Sitio estático (marketing + legales), `build.py` + `templates/` + `config.json` → `dist/`, deploy a Cloudflare Pages. Tiene `.claude/skills/expedita-qa` con checklist pre-commit. | El panel nuevo copia el patrón de: CLAUDE.md auto-cargado, skill de QA con checklist, deploy a Cloudflare Pages, rutas limpias sin `.html`. **No** copia `build.py`/`config.json` — ese generador resuelve un problema (pie legal idéntico en 8 páginas) que el panel no tiene, es una sola página. |

**Repo nuevo:** `expedita-diagnostico` — solo frontend + docs + CI, mismo
nivel que `expedita-web` pero sin el generador de plantillas (innecesario
para una sola página).

---

## 3. ⚠️ Restricción dura heredada de `dental-clinic-bot`: User-Agent

Cloudflare está delante de `staging.expedita.com.ar` y filtra requests por
User-Agent **antes** de que lleguen a n8n:

| User-Agent | Respuesta | Gravedad |
|---|---|---|
| Default de librerías (`Python-urllib/...`, etc.) | `403` (Cloudflare error 1010) | Falla, pero se nota |
| **Cualquier UA que contenga la subcadena `"bot"`** | `204` con body vacío | 🚨 Indistinguible de una respuesta válida — rompe clientes en silencio |
| UA explícito sin `"bot"` (p.ej. `expedita-verify-deploy/1.0`) | Pasa | — |

**Aplica directo a este proyecto:**
- El `fetch()` del navegador desde el frontend usa el UA real del browser —
  no tiene el problema.
- Cualquier script de verificación post-deploy o de testing que hable con
  el webhook de WF5 **debe** setear un User-Agent explícito sin `"bot"` —
  sugiero `expedita-diagnostico/1.0`, siguiendo el mismo patrón que ya usa
  `scripts/verify-deploy.py` en `dental-clinic-bot`.

---

## 4. Arquitectura

```
┌──────────────────────────┐   HTTPS + Cloudflare Access   ┌──────────────────────────┐
│  diag.expedita.com.ar    │ ─────────────────────────────▶│ staging.expedita.com.ar  │
│  (Cloudflare Pages,      │        fetch() JSON            │ /webhook/diagnostico     │
│   repo expedita-         │◀─────────────────────────────  │ (n8n, WF5, agente-server)│
│   diagnostico)           │                                 └──────────────────────────┘
└──────────────────────────┘                                          │
                                                    ┌───────────────────┼───────────────────┐
                                                    ▼                   ▼                   ▼
                                              Supabase             n8n REST API        Meta Graph API
```

---

## 5. Repos y estructura

### `dental-clinic-bot` (existente, se agrega)
```
workflows/WF5_Diagnostico.json
envs/staging.overrides.json     # +DIAG_TOKEN
envs/test.overrides.json        # sin cambios (WF5 no se despliega a test en esta v1)
envs/vps.overrides.json         # sin cambios (Producción no existe aún)
docs/Especificaciones_de_la_aplicacion.md   # +sección "Panel de Diagnóstico (WF5)"
```

### `expedita-diagnostico` (nuevo)
```
/
├── CLAUDE.md
├── .claude/skills/
│   ├── diagnostico-contract/SKILL.md    # contrato JSON, on-demand
│   └── diagnostico-qa/SKILL.md          # checklist pre-commit, espejo de expedita-qa
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── .github/workflows/deploy.yml         # o config nativa de Cloudflare Pages
├── docs/
│   ├── CONTRATO_JSON.md
│   └── mock-response.json               # para desarrollar sin depender de WF5 desplegado
└── README.md
```

---

## 6. Contrato JSON

**Endpoint:** `GET /webhook/diagnostico`
**Header:** `X-Diag-Token: <DIAG_TOKEN de staging.overrides.json>`
**Sin query params** — una sola versión de la respuesta, ya que solo existe Staging.

```json
{
  "generated_at": "2026-08-27T14:32:00-03:00",
  "environment": "staging",
  "salud": {
    "n8n": {
      "status": "up",
      "workflows": [
        {
          "nombre": "WF1_Bot_WhatsApp",
          "activo": true,
          "ejecuciones_ok_24h": 142,
          "ejecuciones_error_24h": 3,
          "tasa_error_pct": 2.1,
          "ultimo_error_at": "2026-08-27T09:12:00-03:00",
          "ultimo_error_mensaje": "Timeout Supabase",
          "ejecuciones_colgadas": 0
        },
        { "nombre": "WF2_Sync_Feriados", "activo": true, "ultima_corrida_ok_at": "2026-08-27T03:00:04-03:00", "horas_desde_ultima_corrida": 11.5, "ejecuciones_error_24h": 0 },
        { "nombre": "WF3_Recordatorio_Turnos", "activo": true, "ultima_corrida_ok_at": "2026-08-27T10:00:02-03:00", "horas_desde_ultima_corrida": 4.5, "ejecuciones_error_24h": 0 },
        { "nombre": "WF4_Sync_GCal_Appointments", "activo": true, "ultima_corrida_ok_at": "2026-08-27T14:00:01-03:00", "horas_desde_ultima_corrida": 0.5, "ejecuciones_error_24h": 0 }
      ],
      "tasa_error_global_pct": 1.8,
      "duracion_promedio_wf1_ms": 3400
    },
    "db": {
      "status": "ok",
      "latencia_ms": 210,
      "espacio_usado_mb": 187,
      "espacio_limite_mb": 500,
      "turnos_huerfanos": 1
    },
    "meta": {
      "status": "ok",
      "quality_rating": "GREEN",
      "webhooks_ok": true,
      "token_dias_restantes": null
    },
    "infra": {
      "tunnel_status": "up",
      "redis_memoria_mb": 8.2
    }
  },
  "negocio": {
    "turnos": {
      "creados_total": 63,
      "creados_mes": 24,
      "cancelados_bot": 5,
      "cancelados_gcal_manual": 2,
      "tasa_cancelacion_pct": 11.1,
      "por_tipo": [
        { "especialidad": "Consulta general", "cantidad": 40 },
        { "especialidad": "Control", "cantidad": 23 }
      ]
    },
    "recordatorios": {
      "confirmados_manana": 8,
      "recordatorios_enviados": 8,
      "tasa_exito_pct": 100.0
    },
    "pacientes": {
      "altas_total": 38,
      "altas_mes": 12
    },
    "costos": {
      "meta_estimado_ars": 22608,
      "meta_medido_ars": null,
      "groq_estimado_usd": 0.46,
      "nota": "estimado — no hay medición real de pricing_category ni de tokens todavía"
    },
    "validacion_telefono": {
      "rechazos_24h": 0
    }
  }
}
```

**Regla para el frontend:** un valor `null` se muestra como "sin datos" o se
oculta, nunca como `0` — importa sobre todo en costos, donde "no lo mido
todavía" y "medí cero" son cosas distintas.

---

## 7. Indicadores → fuente de datos

### 7.1 Salud (n8n API)

| Indicador | Fuente |
|---|---|
| n8n up/down, workflow activo/inactivo | `GET /rest/workflows` (n8n API) |
| Ejecuciones OK/error 24h por workflow | `GET /rest/executions?workflowId=...` filtrando por `startedAt` y `status` |
| Última corrida exitosa de un cron | Última execution `status=success`, ordenada desc |
| Ejecuciones colgadas | `status=running` con `startedAt` hace más del umbral (sugiero 15 min WF1, 60 min los cron) |
| Duración promedio WF1 | Promedio `stoppedAt - startedAt` sobre las últimas N ejecuciones OK |

### 7.2 Salud (DB, Meta, infra)

| Indicador | Fuente |
|---|---|
| Latencia Supabase | `SELECT 1` cronometrado |
| Espacio usado | `pg_database_size(current_database())` |
| Turnos huérfanos | `SELECT count(*) FROM appointments WHERE patient_id IS NULL` |
| Quality rating Meta | Graph API `GET /{phone-number-id}?fields=quality_rating` |
| Estado webhooks | Graph API `GET /{app-id}/subscriptions` |
| Tunnel up/down | Request de salud propio, o métricas de `cloudflared` si están habilitadas |
| Memoria Redis | `INFO memory` |

### 7.3 Negocio (SQL directo, columnas ya confirmadas contra el schema real)

```sql
-- Turnos creados
SELECT count(*) FROM appointments WHERE created_at >= date_trunc('month', now());

-- Cancelados por origen
SELECT count(*) FROM appointments WHERE status = 'Cancelled' AND origen_baja = 'bot';
SELECT count(*) FROM appointments WHERE status = 'Cancelled' AND origen_baja = 'gcal_manual';

-- Turnos por tipo
SELECT especialidad, count(*) FROM appointments GROUP BY especialidad;

-- Altas de pacientes
SELECT count(*) FROM patients WHERE created_at >= date_trunc('month', now());

-- Tasa de éxito de recordatorios
SELECT
  count(*) FILTER (WHERE reminder_sent_at IS NOT NULL) AS enviados,
  count(*) AS confirmados
FROM appointments
WHERE status = 'Confirmed' AND date = (now() + interval '1 day')::date;
```

### 7.4 Costos — gap conocido (fuera de alcance resolver acá)

No existe hoy un log de `pricing_category` de Meta ni de tokens de Groq. El
panel muestra la fórmula estimada de `KB_Acceso_numeros_costos_y_plan.md`
(turnos/día × 8 mensajes × tarifa AR), con `meta_medido_ars` en `null`. Si
en el futuro se instrumenta un log real, el frontend ya está preparado
(regla del §6) para mostrarlo sin cambios.

---

## 8. Seguridad

**Decisión (2026-08-27):** sin Cloudflare Access por ahora — se maneja con
token manual. Nota al margen: Access sí tiene tier gratuito hasta 50
usuarios (lo confirmé, no es pago), así que queda como mejora disponible
más adelante sin costo si en algún momento se quiere sacar el token de la
ecuación. No es parte de esta v1.

Mecanismo v1:

- `DIAG_TOKEN` en `envs/staging.overrides.json` de `dental-clinic-bot`,
  validado por WF5 contra el header `X-Diag-Token`.
- El túnel que ya expone `staging.expedita.com.ar` deja `/webhook/diagnostico`
  accesible en cuanto WF5 esté activo — no hace falta configuración nueva de
  Cloudflare para esto.
- El token **nunca se commitea ni se hardcodea** en `src/app.js` (ese
  archivo es público: cualquiera que vea el código fuente de la página lo
  leería). En su lugar:
  - Al cargar la página, si no hay token guardado en `sessionStorage`, se
    pide con `prompt()`.
  - Se guarda en `sessionStorage` (no `localStorage`) — dura la pestaña,
    se pierde al cerrarla. Es un compromiso razonable para una herramienta
    de uso personal, no para algo con múltiples usuarios.
  - Si el fetch devuelve 401/403, se limpia el token guardado y se vuelve a
    pedir (por si lo rotaste en `envs/staging.overrides.json`).
- Consecuencia práctica: cada vez que abrís el panel en un browser/perfil
  nuevo, te va a pedir el token una vez. Sin Access, es el precio de no
  pagar — está bien para este caso de uso.

---

## 9. Requisitos del frontend

- Una página, sin routing.
- Fetch al cargar + botón "Actualizar" (sin auto-refresh).
- Bloques: Salud n8n (tabla con errores por workflow), Base de datos,
  Meta/WhatsApp, Infraestructura, Turnos/Negocio, Costos (marcados como
  estimados).
- "Última actualización" con `generated_at`.
- Bloque con `status: "error"` o ausente → "sin datos" en ese bloque, sin
  romper el resto.
- Sin dependencias de CDN si se puede evitar.

---

## 10. Requisitos del backend (WF5)

- Webhook trigger GET, un único modo (full) — sin rama minimal.
- Header `X-Diag-Token` validado contra Config node.
- Cada bloque (DB, Meta, infra) con `continueOnFail` + timeout 5s.
- Reusar credenciales existentes (Postgres, Google, HTTP genérico Meta).
- **Nunca** usar un User-Agent con la subcadena `"bot"` en ningún request
  saliente que este workflow haga (ver §3) — no debería aplicar porque WF5
  llama a APIs externas (n8n propio, Meta), no a sí mismo, pero si algún
  nodo hace un self-check HTTP contra el propio dominio de staging, aplicar
  la regla igual.

---

## 11. Deploy y CI/CD

- **Frontend:** deploy automático de Cloudflare Pages sobre push a `main`
  del repo `expedita-diagnostico` (misma mecánica que ya usa `expedita-web`).
- **Backend (WF5):** loop ya establecido en `dental-clinic-bot`
  (`export-workflows.ps1` → `validate-json.py` → commit →
  `import-workflows.ps1 -Env staging`). El deploy a `staging` **sigue
  requiriendo tu autorización explícita en el momento** — eso no cambia. Un
  chequeo de solo-lectura (¿responde el webhook?, ¿el JSON tiene la forma
  esperada?) sí se puede correr sin autorización previa, siguiendo el mismo
  criterio que ya aplica `n8n-qa` con `verify-deploy.py`.

---

## 12. Skills de Claude Code a crear (repo `expedita-diagnostico`)

- `CLAUDE.md`: qué es el proyecto, que WF5 vive en `dental-clinic-bot` (no
  acá), dónde está el contrato, convención de branches, User-Agent para
  scripts (§3).
- `.claude/skills/diagnostico-contract/SKILL.md`: contrato JSON (§6) +
  reglas de UI (§9), on-demand al tocar `src/app.js`.
- `.claude/skills/diagnostico-qa/SKILL.md`: checklist pre-commit, espejo de
  `expedita-qa` de `expedita-web` — adaptado a un panel de una sola página
  (sin el checklist de "8 páginas idénticas" que no aplica acá): probar
  fetch contra `docs/mock-response.json`, probar con bloques en `null`/
  `error`, responsive básico, sin secretos commiteados.

---

## 13. Decisiones confirmadas (2026-08-27)

1. **Sin Cloudflare Access en v1** — seguridad por `DIAG_TOKEN` manual (ver
   §8). Access queda como mejora futura sin costo (tiene tier gratis hasta
   50 usuarios) si se quiere sacar el token de la ecuación más adelante.
2. **Nombre del repo nuevo:** `expedita-diagnostico`, confirmado.
3. **Deploy de WF5 a Staging:** manual, con autorización explícita en el
   momento — mismo gate que ya rige WF1-WF4 en `dental-clinic-bot`. No se
   automatiza.
4. **Túnel:** ya existe y expone `staging.expedita.com.ar` — el path
   `/webhook/diagnostico` queda accesible sin configuración nueva de
   Cloudflare en cuanto WF5 esté activo.
