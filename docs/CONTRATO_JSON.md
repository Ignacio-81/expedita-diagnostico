# Contrato JSON — Panel de Diagnóstico

Extraído de §6 de [SPEC.md](SPEC.md). Este documento es la referencia
versionada del contrato que expone WF5 (repo `dental-clinic-bot`) y que
consume el frontend de este repo. Si el contrato cambia, actualizar acá y
en `docs/mock-response.json` a la vez.

**Endpoint:** `GET /webhook/diagnostico`
**Header:** `X-Diag-Token: <DIAG_TOKEN de staging.overrides.json>`
**Sin query params** — una sola versión de la respuesta, ya que solo existe
Staging.

**Regla para el frontend:** un valor `null` se muestra como "sin datos" o se
oculta, nunca como `0` — importa sobre todo en costos, donde "no lo mido
todavía" y "medí cero" son cosas distintas.

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

Ejemplo completo y usable para desarrollo sin depender de WF5 desplegado:
[docs/mock-response.json](mock-response.json).

## Bloque con error o ausente

Un bloque de `salud` o `negocio` puede llegar con `status: "error"` o estar
directamente ausente (WF5 tiene `continueOnFail` por bloque, ver §10 de
SPEC.md). El frontend debe mostrar "sin datos" en ese bloque puntual, sin
romper el resto de la página.

## Reglas de UI relacionadas (§9 de SPEC.md)

- Fetch al cargar + botón "Actualizar" (sin auto-refresh).
- Bloques: Salud n8n (tabla con errores por workflow), Base de datos,
  Meta/WhatsApp, Infraestructura, Turnos/Negocio, Costos (marcados como
  estimados).
- "Última actualización" con `generated_at`.
- Sin dependencias de CDN si se puede evitar.

Ver también `.claude/skills/diagnostico-contract/SKILL.md` para el detalle
on-demand al tocar `src/app.js`.
