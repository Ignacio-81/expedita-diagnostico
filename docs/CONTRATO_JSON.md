# Contrato JSON — Panel de Diagnóstico (v2.0)

Referencia del contrato que expone WF5 (repo `dental-clinic-bot`) y que
consume el frontend de este repo. Fuente: §2 de
[SPEC-frontend-contrato-v2-y-v3-2026-09.md](SPEC-frontend-contrato-v2-y-v3-2026-09.md)
(código de WF5 al 2026-09-28). Reemplaza al contrato v1.0 (bloque `periodo`
y campos `_periodo`), que ya no existe en el backend.

Si el contrato cambia, actualizar acá, en `docs/mock-response.json`,
`docs/mock-response-sin-reset.json` y en
`.claude/skills/diagnostico-contract/SKILL.md` a la vez.

**Mocks:** `docs/mock-response.json` (con reset en Negocio, sin reset en
Costos) y `docs/mock-response-sin-reset.json` (ninguna de las dos anclas
reseteada). En localhost el panel usa el primero; `?mock=sin-reset` elige el
segundo.

**Regla para el frontend:** un valor `null` se muestra como "sin datos" o se
oculta (si este documento lo dice), nunca como `0`. `0` es un dato medido y
se muestra como `0` / `$ 0`.

## 1. Endpoint

```
GET  https://staging.expedita.com.ar/webhook/diagnostico
Header: X-Diag-Token: <token>
```

- **Ya no hay consulta ad-hoc:** `?desde=&hasta=` se **ignoran** (no dan error, no hacen nada). No mandarlos.
- `401` → `{"error":"unauthorized"}`.
- No hay campo `contract_version` en v2.0: **su ausencia significa `"2.0"`**.

## 2. Respuesta `200` — ejemplo completo (= `docs/mock-response.json`)

```json
{
  "generated_at": "2026-09-28T10:15:00-03:00",
  "environment": "staging",
  "salud": {
    "n8n": {
      "status": "up",
      "workflows": [
        { "nombre": "WF1_Bot_WhatsApp", "activo": true, "ejecuciones_ok_24h": 57, "ejecuciones_error_24h": 1, "tasa_error_pct": 1.7, "ultimo_error_at": "2026-09-28T09:12:03-03:00", "ultimo_error_mensaje": "Error en el nodo \"GET slots GCal\"", "ejecuciones_colgadas": 0 },
        { "nombre": "WF2_Sync_Feriados", "activo": true, "ultima_corrida_ok_at": "2026-09-28T03:00:02-03:00", "horas_desde_ultima_corrida": 7.3, "ejecuciones_error_24h": 0, "ejecuciones_colgadas": 0 },
        { "nombre": "WF3_Recordatorio_Turnos", "activo": true, "ultima_corrida_ok_at": "2026-09-28T08:00:04-03:00", "horas_desde_ultima_corrida": 2.3, "ejecuciones_error_24h": 0, "ejecuciones_colgadas": 0 },
        { "nombre": "WF4_Sync_GCal_Appointments", "activo": true, "ultima_corrida_ok_at": "2026-09-28T10:00:01-03:00", "horas_desde_ultima_corrida": 0.3, "ejecuciones_error_24h": 0, "ejecuciones_colgadas": 0 },
        { "nombre": "WF5_Diagnostico", "activo": true, "ejecuciones_ok_24h": 6, "ejecuciones_error_24h": 0, "tasa_error_pct": 0, "ultimo_error_at": null, "ultimo_error_mensaje": null, "ejecuciones_colgadas": 0 },
        { "nombre": "WF6_Auto_Cancelacion", "activo": true, "ultima_corrida_ok_at": "2026-09-28T10:15:00-03:00", "horas_desde_ultima_corrida": 0, "ejecuciones_error_24h": 0, "ejecuciones_colgadas": 0 }
      ],
      "tasa_error_global_pct": 0.6,
      "duracion_promedio_wf1_ms": 2150
    },
    "db": { "status": "ok", "latencia_ms": 480, "espacio_usado_mb": 42.3, "espacio_limite_mb": 500, "turnos_huerfanos": 0 },
    "meta": { "status": "ok", "quality_rating": "GREEN", "webhooks_ok": true, "token_dias_restantes": null },
    "infra": { "tunnel_status": "up", "redis_memoria_mb": 1.4 }
  },
  "negocio": {
    "reset_desde": "2026-09-18T12:00:00-03:00",
    "turnos": {
      "creados_total": 24,
      "creados_mes": 24,
      "cancelados_bot": 2,
      "cancelados_gcal_manual": 1,
      "tasa_cancelacion_pct": 12.5,
      "por_tipo": [
        { "especialidad": "Consulta/Limpieza", "cantidad": 15 },
        { "especialidad": "Ortodoncia", "cantidad": 9 }
      ],
      "cohorte_definicion": "turnos que hoy están en estado Cancelled, contados según su fecha de creación (la base no tiene fecha de cancelación) — desde 'reset_desde' si hay un reset activo, o sin límite si no lo hay"
    },
    "recordatorios": { "confirmados_manana": 4, "recordatorios_enviados": 4, "tasa_exito_pct": 100 },
    "pacientes": { "altas_total": 11, "altas_mes": 11 },
    "costos": {
      "reset_desde": null,
      "meta_estimado_ars": 22608,
      "meta_medido_ars": 1507,
      "meta_proyectado_per_message_ars": 6782,
      "meta_medido_proyeccion_mes_ars": 1615,
      "pricing_per_message_vigente": false,
      "medicion_desde": "2026-09-01T09:14:22.000-03:00",
      "medicion_dias": 28,
      "medicion_mes_completo": true,
      "mensajes_medidos": 180,
      "mensajes_por_categoria": { "service": 140, "utility": 40, "marketing": 0, "authentication": 0 },
      "groq_estimado_usd": 0.46,
      "nota": "meta_medido_ars: costo REAL de los mensajes capturados por categoría de pricing desde medicion_desde (ventana que puede ser parcial: ver medicion_dias / medicion_mes_completo). meta_estimado_ars y groq_estimado_usd: proyección a 30 días a partir de turnos/día (requieren ≥7 días de datos desde el último reset; si no, quedan en null). Los tokens de Groq no se miden todavía — ese número siempre es estimado."
    },
    "validacion_telefono": { "rechazos_24h": null }
  }
}
```

Los números son ilustrativos; la **forma** (claves, tipos, anidación) es la exacta.

## 3. Diccionario de campos v2.0 — tipos y semántica de `null`

**Raíz:** `generated_at` (ISO con `-03:00`), `environment` (`"staging"` o `"test"`), `salud`, `negocio`.

**`salud.n8n`**
- `status`: `"up"` | `"error"`. Con `"error"` aparece `error_detalle` (string) **y `workflows[]` igual viene con lo que se pudo medir** (p. ej. un workflow no existe en la instancia → solo esa fila degrada).
- `workflows[]`: **6 filas** (WF1-WF6), dos formas:
  - **No-cron** (`WF1_Bot_WhatsApp`, `WF5_Diagnostico`): `nombre`, `activo` (bool\|null — `null` si el workflow no existe en la instancia), `ejecuciones_ok_24h` (int), `ejecuciones_error_24h` (int), `tasa_error_pct` (number — ⚠️ vale **`0` cuando no hubo ejecuciones**, se corrige en v4.0), `ultimo_error_at` (ISO\|null), `ultimo_error_mensaje` (string\|null — **solo WF1** lo trae; WF5 siempre `null`), `ejecuciones_colgadas` (int).
  - **Cron** (`WF2_Sync_Feriados`, `WF3_Recordatorio_Turnos`, `WF4_Sync_GCal_Appointments`, `WF6_Auto_Cancelacion`): `nombre`, `activo`, `ultima_corrida_ok_at` (ISO\|null), `horas_desde_ultima_corrida` (number 1 decimal\|null), `ejecuciones_error_24h`, `ejecuciones_colgadas`. **No** traen `ejecuciones_ok_24h` ni `tasa_error_pct` (mostrar "—", no "sin datos").
- `tasa_error_global_pct` (number): suma **todas** las filas, **incluidas las ejecuciones del propio panel (WF5, una por cada "Actualizar") y de WF6 (cada 15 min)** → diluye la tasa real del bot. Para el bot, mirar la fila de WF1.
- `duracion_promedio_wf1_ms` (int\|null): promedio de las últimas 20 ejecuciones OK de WF1 — **incluye los webhooks de estado de Meta** (~78% de las ejecuciones de WF1), así que subestima lo que tarda una respuesta real.

**`salud.db`** — `status` (`"ok"`\|`"error"`, + `error_detalle`), `latencia_ms` (int\|null), `espacio_usado_mb` (number\|null — **tamaño del proyecto Supabase entero**, incluidos los datos de otros ambientes; es lo que cuenta para el límite del plan), `espacio_limite_mb` (500), `turnos_huerfanos` (int\|null).

**`salud.meta`** — `status` (+ `error_detalle`), `quality_rating` (`"GREEN"`\|`"YELLOW"`\|`"RED"`\|otro\|null), `webhooks_ok` (bool), `token_dias_restantes` (**`null` siempre por diseño** → no mostrar).

**`salud.infra`** — ⚠️ **no trae `status` cuando está sano**: solo aparece `status: "error"` (+ `error_detalle`) si el túnel está `degradado`/`down` o Redis falló.
- `tunnel_status`: `"up"` (sano) \| `"degradado"` (Cloudflare devolvió 204/403: la request no llegó a n8n) \| `"down"` \| `"n/a"` (el ambiente no tiene dominio público: **no aplica**, no es error ni es sano).
- `tunnel_detalle` (string): **solo** cuando `tunnel_status = "n/a"`.
- `redis_memoria_mb` (number\|null).

**`negocio`**
- `reset_desde` (ISO\|null): ancla de **Turnos/Negocio**. `null` = nunca se reseteó → los contadores son **histórico completo**. Puede ser **futura** (reset programado a mano) → "empieza el <fecha>".
- `turnos`: `creados_total`, `creados_mes`, `cancelados_bot`, `cancelados_gcal_manual` (int\|null); `tasa_cancelacion_pct` (number\|null — `null` si no hay turnos en la ventana); `por_tipo[]` (`{especialidad, cantidad}`, ya ordenado desc; `[]` si falla); `cohorte_definicion` (string literal, mostrarlo como nota); si falla: `status: "error"` + `error_detalle`.
  - Con `reset_desde` **no nulo**, `creados_total` y `creados_mes` son **el mismo número** (los dos cuentan desde el reset). Sin reset: `creados_total` = histórico, `creados_mes` = mes calendario en curso.
  - ⚠️ `tasa_cancelacion_pct` hoy **solo suma cancelaciones del paciente por menú (`cancelados_bot`) y de la recepción (`cancelados_gcal_manual`)**: no incluye las del botón del recordatorio ni las **auto-cancelaciones** por falta de confirmación. Se corrige en v3.0.
- `recordatorios` (**foto de mañana**, el reset no la toca): `confirmados_manana` (int\|null) — ⚠️ **son los turnos AGENDADOS para mañana**, no confirmaciones del paciente; `recordatorios_enviados` (int\|null) — de esos, cuántos ya tienen recordatorio **enviado** (no necesariamente entregado); `tasa_exito_pct` (number\|null) = enviados / agendados — ⚠️ **da 0% antes de las 08:00**, cuando todavía no corrió el envío. Si falla: `status`/`error_detalle`.
- `pacientes`: `altas_total`, `altas_mes` (int\|null; misma regla que `creados_*` con reset); `status`/`error_detalle` si falla.
- `costos` (ancla **propia**, independiente):
  - `reset_desde` (ISO\|null) — `null` = ventana = **mes calendario en curso**.
  - `meta_medido_ars` (int\|null) — costo **real** de los mensajes capturados en la ventana con las reglas **vigentes hoy**. `0` es legítimo (ej.: solo mensajes gratis). `null` = no hay mensajes medidos o la medición falló.
  - `meta_proyectado_per_message_ars` (int\|null) — **el mismo tráfico con las reglas desde el 1/10/2026** (todo mensaje se cobra, incluidos los `service`). **Es el número más importante del panel hasta el 1/10.**
  - `meta_medido_proyeccion_mes_ars` (int\|null) — medido proyectado a 30 días; `null` si `medicion_dias < 7`.
  - `meta_estimado_ars` (int\|null) — estimación vieja por turnos/día (no medida); `null` con reset de < 7 días.
  - `groq_estimado_usd` (number\|null) — estimado; **hoy se usa el free tier de Groq, costo real US$ 0**.
  - `pricing_per_message_vigente` (bool) — `true` desde el 2026-10-01.
  - `medicion_desde` (ISO\|null, **con milisegundos**: `…:22.000-03:00` — no comparar strings) — primer mensaje capturado **observado** en la ventana (distinto de `reset_desde`, que es el configurado).
  - `medicion_dias` (int\|null) — días calendario cubiertos, inclusive.
  - `medicion_mes_completo` (bool\|null) — sin reset: si la medición cubre el mes desde el día 1; **con reset: `null` (no aplica)**.
  - `mensajes_medidos` (int\|null).
  - `mensajes_por_categoria`: **objeto** `{service, utility, marketing, authentication}` con int (0 legítimo) — o las 4 en `null` si la medición falló.
  - `nota` (string).
  - Solo si falla la medición: `medicion_status: "error"` + `medicion_error_detalle`.
- `validacion_telefono.rechazos_24h`: **`null` siempre por diseño** → no mostrar.

**Ya NO existen (no leerlos):** `negocio.periodo`, `negocio.costos.periodo` y cualquier campo que termine en `_periodo` (`creados_periodo`, `cancelados_*_cohorte_periodo`, `tasa_cancelacion_cohorte_periodo_pct`, `por_tipo_periodo`, `altas_periodo`, `mensajes_medidos_periodo`, `mensajes_por_categoria_periodo`, `meta_medido_periodo_ars`, `meta_proyectado_per_message_periodo_ars`, `medicion_desde_periodo`, `meta_estimado_periodo_ars`, `groq_estimado_periodo_usd`).

## 4. Reset — `POST` (sin cambios de forma respecto de lo que ya usa el front)

```
POST https://staging.expedita.com.ar/webhook/diagnostico
Header: X-Diag-Token: <token>
Content-Type: application/json

{"accion":"reset","ambito":"negocio"}      // o "costos"   ("todo" existe, no lo usa el front)
```

Literales exactos en minúscula. `desde` se omite (= ahora).

| HTTP | Body | UI |
|---|---|---|
| 200 | `{"ok":true,"ambito":"negocio","medicion_negocio_desde":"2026-09-28T10:20:00-03:00","medicion_costos_desde":null,"desde_anterior":{"negocio":"2026-09-18T12:00:00-03:00","costos":null},"aplicado_at":"2026-09-28T10:20:00-03:00"}` | GET completo después (los contadores cambian con el ancla) y mostrar `desde_anterior.<ambito>` — ver §3.5 de la SPEC-frontend |
| 400 | `{"error":"bad_request","detalle":"..."}` | Mensaje de error con `detalle` |
| 401/403 | `{"error":"unauthorized"}` | Limpiar token y volver a pedirlo |
| 500 | `{"error":"internal","detalle":"..."}` | "El reset falló, no se aplicó nada" + detalle |

`desde_anterior` es la **única** forma de deshacer un reset accidental (no hay historial en el backend).

## 5. Versión de contrato

- `contract_version` (raíz, string). **Ausente → `"2.0"`** (el backend v2.0
  no lo publica; aparece desde el contrato 3.0).
- El frontend declara `CONTRATOS_SOPORTADOS` (hoy `["2.0"]`). Un **MAYOR**
  fuera de la lista → banner de advertencia arriba y se renderiza igual lo
  que se pueda. Mismo MAYOR con MENOR desconocido → sin banner (los campos
  nuevos se ignoran).
- La versión se muestra junto al badge de ambiente (`contrato 2.0`).

## 6. Bloque con error o ausente

- Bloque **ausente** → "sin datos" solo en ese bloque.
- Bloque **presente con `status: "error"`** → se renderizan igual sus campos
  (los `null` como "sin datos") **y** se muestra su `error_detalle`. Aplica a
  `salud.*`, a `negocio.turnos` / `recordatorios` / `pacientes`, y a
  `negocio.costos` vía `medicion_status` / `medicion_error_detalle`.
- `salud.infra` no trae `status` cuando está sano: el pill se deriva de
  `tunnel_status` (`up` OK · `degradado` advertencia · `down` error · `n/a`
  "no aplica" + `tunnel_detalle`).
- Ningún bloque roto rompe el render del resto de la página.

## 7. Ambientes (allowlist fija en `src/app.js`)

| Ambiente | Cómo | URL |
|---|---|---|
| `staging` (default) | — | `https://staging.expedita.com.ar/webhook/diagnostico` |
| `test` | `?env=test` | `https://local-dev.expedita.com.ar/webhook/diagnostico` |

Nunca una URL arbitraria por query param. Token guardado por ambiente en
`sessionStorage` (`diagToken:staging` / `diagToken:test`).

Ver también `.claude/skills/diagnostico-contract/SKILL.md`.

---

# Contrato 4.0 (delta respecto de 2.0)

Fuente: backend `dental-clinic-bot`, `docs/Especificaciones_de_la_aplicacion.md`
§7.4; UI en `SPEC-frontend-contrato-v2-y-v3-2026-09.md` §4.1-§4.4. El panel
entiende `2.0`, `3.0`-`3.2` y `4.0` (`CONTRATOS_SOPORTADOS` en `src/app.js`);
todo campo nuevo se lee con guarda y un bloque que la versión de la respuesta
todavía no publica se oculta (si la versión ya lo exige y falta: "sin datos").
Mocks: `mock-response-v4.json` (todo sano) y `mock-response-v4-critico.json`
(alertas, nulos, bloque en error).

**Quitados** (no se leen): `salud.n8n.tasa_error_global_pct`,
`salud.n8n.duracion_promedio_wf1_ms`, `salud.meta.token_dias_restantes`,
`negocio.turnos.tasa_cancelacion_pct`,
`negocio.recordatorios.{confirmados_manana,recordatorios_enviados,tasa_exito_pct}`,
`negocio.validacion_telefono`.

**Cambia:** `workflows[].tasa_error_pct` es `null` (no `0`) sin ejecuciones en
24h → "sin ejecuciones".

**Agregados**
- Raíz: `contract_version`, `resumen {estado: ok|advertencia|critico|sin_datos,
  alertas[{codigo, severidad, bloque, campo, mensaje, valor, umbral}]}`.
  **Los umbrales viven en el backend**: el front no tiene ninguno; el color de
  una métrica y el pill de cada bloque salen solo de `resumen.alertas[]`.
- `salud.llm {errores_24h, rate_limit_24h, ventana_cubierta_horas, techo_tpm,
  proxy_sin_instrumentacion}`.
- `salud.n8n`: `tasa_error_operativa_pct`, `trafico_wf1 {mensajes_procesados_24h,
  fuente, nota, duracion_p95_ms}`; `workflows[]`: `error_workflow_configurado`,
  `truncado`, cron también `ultima_corrida_at`/`ultima_corrida_status`; fila
  `WF7_Alertas`.
- `salud.meta`: `phone_status`, `name_status`, `messaging_limit`.
- `salud.db`: `espacio_alcance`, `espacio_nota`.
- `salud.infra`: `redis_maxmemory_mb`, `redis_maxmemory_configurado`, `redis_keys`.
- `negocio.turnos`: `cancelados_bot_recordatorio`, `cancelados_auto_sin_confirmacion`,
  `cancelados_sin_origen`, `cancelados_total`, `tasa_cancelacion_total_pct`,
  `origenes_desconocidos` (opcional).
- `negocio.recordatorios`: `wf3_corrida_hoy`, `proximos_dias[4]`, `hoy`, `definicion`.
- `negocio.confirmacion`, `negocio.auto_cancelacion`, `negocio.derivaciones`
  (embudo, WF6, derivaciones a humano).
- `negocio.tendencia_7d[7]` (+ `tendencia_status: "error"` si falla).

**Validado contra un payload real de `test-mock` (2026-09-29):**
- `alertas[].bloque` es el path con notación de punto hasta el bloque
  (`"salud.n8n"`, `"negocio.derivaciones"`, nunca el nombre bare) y `.campo` es
  el path completo hasta la hoja, con el nombre del workflow **entre corchetes
  sin comillas** cuando aplica (`"salud.n8n.workflows[WF2_Sync_Feriados].horas_desde_ultima_corrida"`).
  El matching por subcadena en minúsculas de `toneAlertas()` funciona bien
  contra esta forma real (confirmado). `valor` viene con el tipo nativo del
  dato (number/boolean), nunca forzado a string.
- `negocio.tendencia_status` **no existe cuando la tendencia está sana** —
  solo se agrega (`"error"`) si la query de 7 días falla. El front ya lo trata
  bien (`negocio.tendencia_status === "error"` da `false` con el campo
  ausente, sin romper nada).
- `salud.llm.proxy_sin_instrumentacion` es un **número** (conteo, copia de
  `negocio.derivaciones.ultimas_24h.error_sistema`), **nunca un booleano**.
  ⚠️ Esto rompía la nota original (`=== true` nunca daba verdadero) — corregido
  el 2026-09-29 para mostrarlo como estadística + nota explicativa. Mocks
  actualizados a la forma numérica real.
