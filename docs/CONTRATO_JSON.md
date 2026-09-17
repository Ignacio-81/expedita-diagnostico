# Contrato JSON — Panel de Diagnóstico

Extraído de §6 de [SPEC.md](SPEC.md). Este documento es la referencia
versionada del contrato que expone WF5 (repo `dental-clinic-bot`) y que
consume el frontend de este repo. Si el contrato cambia, actualizar acá y
en `docs/mock-response.json` a la vez.

**Endpoint:** `GET /webhook/diagnostico`
**Header:** `X-Diag-Token: <DIAG_TOKEN de staging.overrides.json>`
**Query params opcionales:** `desde`/`hasta` para una consulta ad-hoc de una
sola vez (§ Consulta ad-hoc, más abajo).

**Reset de la ventana:** `POST /webhook/diagnostico` con el mismo token
(§ Reset de la ventana, más abajo).

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
    "periodo": {
      "modo": "desde_ancla",
      "desde": "2026-09-05T00:00:00-03:00",
      "hasta": null,
      "dias": 12,
      "estado": "activo",
      "origen": "config"
    },
    "turnos": {
      "creados_total": 63,
      "creados_mes": 24,
      "creados_periodo": 9,
      "cancelados_bot": 5,
      "cancelados_gcal_manual": 2,
      "cancelados_bot_cohorte_periodo": 1,
      "cancelados_gcal_manual_cohorte_periodo": 0,
      "tasa_cancelacion_pct": 11.1,
      "tasa_cancelacion_cohorte_periodo_pct": 11.1,
      "por_tipo": [
        { "especialidad": "Consulta general", "cantidad": 40 },
        { "especialidad": "Control", "cantidad": 23 }
      ],
      "por_tipo_periodo": [
        { "especialidad": "Consulta general", "cantidad": 6 },
        { "especialidad": "Control", "cantidad": 3 }
      ],
      "cohorte_definicion": "Cancelaciones de turnos creados dentro de la ventana, sin importar cuándo se cancelaron — no son cancelaciones ocurridas en la ventana."
    },
    "recordatorios": {
      "confirmados_manana": 8,
      "recordatorios_enviados": 8,
      "tasa_exito_pct": 100.0
    },
    "pacientes": {
      "altas_total": 38,
      "altas_mes": 12,
      "altas_periodo": 5
    },
    "costos": {
      "periodo": {
        "modo": "desde_ancla",
        "desde": "2026-09-14T00:00:00-03:00",
        "hasta": null,
        "dias": 3,
        "estado": "activo",
        "origen": "config"
      },
      "meta_estimado_ars": 22608,
      "meta_medido_ars": null,
      "groq_estimado_usd": 0.46,
      "mensajes_medidos_periodo": 210,
      "mensajes_por_categoria_periodo": [
        { "categoria": "utility", "cantidad": 150 },
        { "categoria": "marketing", "cantidad": 60 }
      ],
      "meta_medido_periodo_ars": 6800,
      "meta_proyectado_per_message_periodo_ars": 32.4,
      "medicion_desde_periodo": "2026-09-14T00:00:00-03:00",
      "meta_estimado_periodo_ars": null,
      "groq_estimado_periodo_usd": null,
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

## Ventana de medición (`periodo`)

`negocio.periodo` y `negocio.costos.periodo` son anclas **independientes**:
pueden estar en modos distintos al mismo tiempo.

| Campo | Significado |
|---|---|
| `modo` | `"historico"` (sin ventana) · `"desde_ancla"` (reset previo, ventana hasta ahora) · `"consulta"` (query params, no escribe nada) |
| `desde` | Inicio de ventana. `null` en `"historico"` |
| `hasta` | `null` = ventana abierta |
| `dias` | Duración, mínimo 1. `null` en `"historico"` |
| `estado` | `"activo"` · `"pendiente"` (arranca en el futuro) |
| `origen` | `"config"` · `"query"` |

Regla de UI: `historico` → no mostrar fecha. `pendiente` → "empieza el
`<fecha>`". `activo` → fecha normal (y opcionalmente `dias`).

## Campos `_periodo`

Aditivos — lo que ya se mostraba (`_total`, `_mes`) sigue igual. Se muestran
en primer plano para que un reset se note en pantalla:

- `negocio.turnos`: `creados_periodo`, `cancelados_bot_cohorte_periodo`,
  `cancelados_gcal_manual_cohorte_periodo`,
  `tasa_cancelacion_cohorte_periodo_pct` (puede ser `null`),
  `por_tipo_periodo`, `cohorte_definicion` (aclaración fija: son
  cancelaciones de una cohorte de turnos creados en la ventana, no
  cancelaciones ocurridas en la ventana).
- `negocio.pacientes`: `altas_periodo`.
- `negocio.costos`: `mensajes_medidos_periodo`,
  `mensajes_por_categoria_periodo`, `meta_medido_periodo_ars`,
  `meta_proyectado_per_message_periodo_ars`, `medicion_desde_periodo`,
  `meta_estimado_periodo_ars`, `groq_estimado_periodo_usd` — todos pueden
  ser `null` ("sin datos suficientes", nunca `0`); los dos estimados vienen
  `null` a propósito con ventanas de menos de 7 días.

## Reset de la ventana (`POST /webhook/diagnostico`)

Mismo path que el GET, mismo token.

```
POST /webhook/diagnostico
Header: X-Diag-Token: <token>
Content-Type: application/json

{"accion":"reset","ambito":"negocio"|"costos","desde":null}
```

- `ambito`: el frontend manda siempre `"negocio"` o `"costos"` — un botón
  por panel. (`"todo"` existe para uso manual/curl, no lo usa el frontend.)
- `desde`: se omite (o `null`) para "resetear a ahora" — caso normal del
  botón. Pasar una fecha ahí es el mecanismo manual (sin UI) para corregir
  un reset hecho por error, usando el `desde_anterior` de la respuesta.

| HTTP | Body | UI |
|---|---|---|
| 200 | `{"ok":true,"ambito":"...","medicion_negocio_desde":"...","medicion_costos_desde":"...","desde_anterior":{...},"aplicado_at":"..."}` | Reset aplicado — usar el `medicion_*_desde` correspondiente al `ambito` para refrescar el encabezado de fecha, sin otro GET. |
| 400 | `{"error":"bad_request","detalle":"..."}` | No debería pasar si siempre se manda `accion:"reset"` y `ambito` válido. |
| 401/403 | `{"error":"unauthorized"}` | Mismo manejo que el GET: limpiar token guardado y volver a pedirlo. |
| 500 | `{"error":"internal","detalle":"..."}` | Reset falló del lado del backend, no se aplicó nada. |

No hay auditoría/historial de resets — la única corrección posible es un
nuevo POST con `desde_anterior` en `desde`.

## Consulta ad-hoc por query params

```
GET /webhook/diagnostico?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
```

`desde` sin `hasta` = ventana abierta. `hasta` sin `desde` se ignora.
`desde > hasta` o fechas no parseables → `400`. No escribe nada en el
backend (`periodo.modo: "consulta"` en la respuesta). El frontend v1 no
ofrece UI para esto.

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
- Botón de reset en Turnos/Negocio y otro, independiente, en Costos —
  confirmación explícita antes del POST.
- "Midiendo desde" por panel usando `periodo.desde`, con los campos
  `_periodo` en primer plano.

Ver también `.claude/skills/diagnostico-contract/SKILL.md` para el detalle
on-demand al tocar `src/app.js`.
