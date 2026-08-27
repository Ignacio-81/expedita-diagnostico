---
name: diagnostico-contract
description: >
  Contrato JSON completo que expone WF5 (endpoint, header, forma de la
  respuesta) y reglas de UI para consumirlo. Usar SIEMPRE que se edite
  src/app.js, src/index.html, o cualquier lógica de parseo/render del panel.
---

# Contrato JSON del panel de diagnóstico

El backend (WF5, en `dental-clinic-bot`) expone un único endpoint que este
frontend consume. No hay versiones alternativas de la respuesta ni query
params: un solo shape, documentado acá y en
[docs/CONTRATO_JSON.md](../../../docs/CONTRATO_JSON.md) (misma fuente,
mantener ambos sincronizados si el contrato cambia).

## Endpoint

```
GET /webhook/diagnostico
Header: X-Diag-Token: <token>
```

Sin query params. El `fetch()` del navegador usa el UA real del browser, así
que no le aplica la restricción de User-Agent de CLAUDE.md — esa restricción
es para scripts (curl, verificación post-deploy), no para el frontend en sí.

## Manejo de token (nunca hardcodear)

- Si no hay token en `sessionStorage`, pedirlo con `prompt()`.
- Guardar en `sessionStorage` (no `localStorage`) — dura la pestaña.
- Ante `401`/`403` en la respuesta: limpiar el token guardado y volver a
  pedirlo (puede haber rotado en `envs/staging.overrides.json` del otro
  repo).
- El token **nunca** va escrito en `src/app.js` — ese archivo es público.

## Forma de la respuesta

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
        { "nombre": "WF2_Sync_Feriados", "activo": true, "ultima_corrida_ok_at": "...", "horas_desde_ultima_corrida": 11.5, "ejecuciones_error_24h": 0 },
        { "nombre": "WF3_Recordatorio_Turnos", "activo": true, "ultima_corrida_ok_at": "...", "horas_desde_ultima_corrida": 4.5, "ejecuciones_error_24h": 0 },
        { "nombre": "WF4_Sync_GCal_Appointments", "activo": true, "ultima_corrida_ok_at": "...", "horas_desde_ultima_corrida": 0.5, "ejecuciones_error_24h": 0 }
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
      "por_tipo": [{ "especialidad": "Consulta general", "cantidad": 40 }]
    },
    "recordatorios": {
      "confirmados_manana": 8,
      "recordatorios_enviados": 8,
      "tasa_exito_pct": 100.0
    },
    "pacientes": { "altas_total": 38, "altas_mes": 12 },
    "costos": {
      "meta_estimado_ars": 22608,
      "meta_medido_ars": null,
      "groq_estimado_usd": 0.46,
      "nota": "estimado — no hay medición real de pricing_category ni de tokens todavía"
    },
    "validacion_telefono": { "rechazos_24h": 0 }
  }
}
```

Ejemplo completo, usable para desarrollar sin WF5 desplegado:
`docs/mock-response.json`.

## Regla de `null` vs `0` (crítica en costos)

Un valor `null` se muestra como "sin datos" o se oculta — **nunca** como
`0`. Aplica sobre todo a `negocio.costos.meta_medido_ars`: hoy siempre es
`null` porque no hay medición real todavía, y confundirlo con "costo cero"
sería directamente engañoso. Cuando en el futuro se instrumente la medición
real, el campo empieza a traer un número y el frontend ya debe estar
preparado para mostrarlo sin cambios de código.

## Bloque con `status: "error"` o ausente

Cada bloque de `salud` (`n8n`, `db`, `meta`, `infra`) puede llegar con
`status: "error"`, o el bloque puede faltar directamente del JSON (WF5 tiene
`continueOnFail` + timeout 5s por bloque). En ese caso: mostrar "sin datos"
**solo en ese bloque**, sin que rompa el render del resto de la página. Esto
es lo primero que hay que probar manualmente después de tocar `app.js` — ver
`.claude/skills/diagnostico-qa/SKILL.md`.

## Requisitos de UI (§9 de la spec)

- Una página, sin routing.
- Fetch al cargar + botón "Actualizar" — sin auto-refresh/polling.
- Bloques a renderizar: Salud n8n (tabla por workflow, no solo tasa
  global), Base de datos, Meta/WhatsApp, Infraestructura, Turnos/Negocio,
  Costos (marcados visualmente como estimados).
- Mostrar "Última actualización" usando `generated_at` de la respuesta.
- Sin dependencias de CDN si se puede evitar (el panel debe poder abrirse
  aunque un CDN externo esté caído).
