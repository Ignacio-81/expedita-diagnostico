# SPEC frontend — Panel de diagnóstico al contrato v2.0 (Fase 1) y hoja de ruta hasta v4.0 (fases 2-5)

| Campo | Valor |
|---|---|
| Destinatario | Agente de Claude Code que trabaja en **este repo** (`expedita-diagnostico`). Este documento es **autocontenido**: no hace falta leer nada del repo del backend (`dental-clinic-bot`). |
| Estado | ✅ **APROBADA v1.0 — 2026-09-28, por Ignacio** (confirmación única: "Aprobar todo", con las decisiones F-1…F-4 de §5 tal como se propusieron). **Fase 1: implementar ya** (fecha límite 2026-10-01). Fases 2-5: implementar cada una recién cuando Ignacio avise que el backend de esa versión está listo para desplegar (§4). Reemplaza a la v0.1 (propuesta del mismo día; contenido sin cambios, solo decisiones fijadas). |
| Urgencia | **Fase 1 antes del 2026-10-01** (ese día Meta pasa a cobrar por mensaje y el número más importante del panel — la proyección per-message — hoy no se ve). |
| Autor | `n8n-functional` (repo `dental-clinic-bot`), a partir de un análisis del panel aprobado por Ignacio el 2026-09-28. Spec hermana del backend: `dental-clinic-bot/specs/diagnostico-v3-mejoras-panel-2026-09.md`. |
| Reemplaza / deja obsoleto | **`docs/prompt-frontend-fix-reset-costos-2026-09.md`** (este mismo directorio, sin commitear) — describe el contrato **viejo** (bloque `periodo`), que ya no existe. **Queda obsoleto: no seguirlo. Tarea de la Fase 1 (F-4, fijada): borrarlo** (nunca se commiteó). También quedan desactualizadas las secciones §6.1-§6.4 de `docs/SPEC.md` y la totalidad de `docs/CONTRATO_JSON.md` y `docs/mock-response.json` — se rehacen en esta Fase 1 (§3.8). |

---

## 0. Qué pasó y por qué hay que cambiar el panel

El último commit de este repo (`f1a6c8f`, 2026-09-17) implementó el contrato **v1.0**: un bloque `periodo` (`negocio.periodo`, `negocio.costos.periodo`) y campos con sufijo `_periodo`. **Al día siguiente (2026-09-18) el backend cambió de diseño** (ADR-008 del otro repo): el reset ya no agrega un bloque paralelo, sino que **redefine el punto de partida de los contadores de siempre**. Todo `periodo` y todo `_periodo` **se eliminó** del backend.

Consecuencias visibles hoy en el panel:

- ~15 indicadores muestran "sin datos" permanentemente (todos los `_periodo`, la sección "Cancelaciones — cohorte del período", `mensajes_por_categoria_periodo`).
- "Midiendo desde…" **nunca aparece** (lee `negocio.periodo`; el dato ahora está en `negocio.reset_desde` y `negocio.costos.reset_desde`).
- `aplicarResetLocal()` escribe un `periodo` que nadie más lee.
- Campos que el backend **sí** publica y el panel **no** muestra: `meta_proyectado_per_message_ars`, `meta_medido_proyeccion_mes_ars`, `medicion_dias`, `medicion_mes_completo`, `pricing_per_message_vigente`, `mensajes_medidos`, `mensajes_por_categoria` (ahora **objeto**, no array), `medicion_desde`, `medicion_status`/`medicion_error_detalle`, `turnos.cohorte_definicion` (con texto nuevo), los `status`/`error_detalle` de cada sub-bloque de negocio, `infra.tunnel_detalle`, y el `error_detalle` de cualquier bloque de salud.

**Causa raíz:** el contrato no tiene versión, así que front y back se desincronizaron en silencio. Desde la Fase 2 el backend publica `contract_version` (§4.1) y el front tiene que avisar si no la reconoce.

---

## 1. Reglas que NO cambian (ya están en `CLAUDE.md` y en las skills de este repo)

1. **Token:** `X-Diag-Token`, nunca hardcodeado, en `sessionStorage`, pedido con `prompt()`, se limpia y se vuelve a pedir ante `401/403`.
2. **User-Agent:** el `fetch()` del navegador está bien. Cualquier **script** (curl, verificación) contra el backend manda un UA explícito **sin la subcadena `"bot"`** (`expedita-diagnostico/1.0`). Cloudflare devuelve `204` vacío a cualquier UA con `bot` — indistinguible de una respuesta válida.
3. **`null` ≠ `0`:** `null`/ausente → "sin datos" (o se oculta si así lo dice esta spec); `0` es un dato medido y se muestra como `0` / `$ 0`.
4. **DOM:** `createElement`/`textContent`, nunca `innerHTML` con datos del backend.
5. **Degradación por bloque:** un bloque roto o ausente nunca rompe el resto.
6. **Sin CDN, sin dependencias.** Vanilla JS.
7. **Commit solo con confirmación explícita de Ignacio** (skill `diagnostico-qa` §6).
8. 🚫 **El agente no le pega al backend de `staging`** (ni GET ni, con más razón, el POST de reset, que escribe en la base real). Se desarrolla contra el mock; la validación contra `staging` la hace **Ignacio**. Contra Develop/Test (§3.7) solo si Ignacio lo habilita y le provee el token de ese ambiente.

---

## 2. Contrato v2.0 — el que el backend publica HOY (fuente: código de WF5 al 2026-09-28)

### 2.1 Endpoint

```
GET  https://staging.expedita.com.ar/webhook/diagnostico
Header: X-Diag-Token: <token>
```

- **Ya no hay consulta ad-hoc:** `?desde=&hasta=` se **ignoran** (no dan error, no hacen nada). No mandarlos.
- `401` → `{"error":"unauthorized"}`.
- No hay campo `contract_version` en v2.0: **su ausencia significa `"2.0"`**.

### 2.2 Respuesta `200` — ejemplo completo (usar como nuevo `docs/mock-response.json`)

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

### 2.3 Diccionario de campos v2.0 — tipos y semántica de `null`

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

### 2.4 Reset — `POST` (sin cambios de forma respecto de lo que ya usa el front)

```
POST https://staging.expedita.com.ar/webhook/diagnostico
Header: X-Diag-Token: <token>
Content-Type: application/json

{"accion":"reset","ambito":"negocio"}      // o "costos"   ("todo" existe, no lo usa el front)
```

Literales exactos en minúscula. `desde` se omite (= ahora).

| HTTP | Body | UI |
|---|---|---|
| 200 | `{"ok":true,"ambito":"negocio","medicion_negocio_desde":"2026-09-28T10:20:00-03:00","medicion_costos_desde":null,"desde_anterior":{"negocio":"2026-09-18T12:00:00-03:00","costos":null},"aplicado_at":"2026-09-28T10:20:00-03:00"}` | Ver §3.5 |
| 400 | `{"error":"bad_request","detalle":"..."}` | Mensaje de error con `detalle` |
| 401/403 | `{"error":"unauthorized"}` | Limpiar token y volver a pedirlo |
| 500 | `{"error":"internal","detalle":"..."}` | "El reset falló, no se aplicó nada" + detalle |

`desde_anterior` es la **única** forma de deshacer un reset accidental (no hay historial en el backend).

---

## 3. Fase 1 — qué cambiar (solo frontend, contrato v2.0)

### 3.1 Versión de contrato

- Leer `data.contract_version`; **ausente → `"2.0"`**.
- Constante `CONTRATOS_SOPORTADOS = ["2.0"]` (en fases siguientes se agregan).
- Si la versión recibida tiene un **MAYOR** que no está en la lista → banner visible arriba (reusar `#global-error` o uno propio, tono advertencia): *"El backend publica el contrato vX; este panel entiende 2.0. Puede haber datos faltantes o mal rotulados — actualizar el panel."* y **renderizar igual** lo que se pueda. Mismo MAYOR con MENOR desconocido → sin banner (los campos nuevos se ignoran).
- Mostrar la versión en el pie o junto al badge de ambiente (`contrato 2.0`).

### 3.2 Salud

- **Regla nueva de bloque en error:** si el bloque **existe** con `status: "error"`, se renderizan igual sus campos (los `null` como "sin datos") **y se muestra `error_detalle`** como texto (pill ERROR). Solo si el bloque está **ausente** se muestra únicamente "sin datos". Hoy `error_detalle` no se ve en ningún lado.
- **n8n:** tabla con las 6 filas. Para cron, las columnas "OK 24h" y "Tasa error" muestran "—". Con `activo: null` → "no existe en esta instancia" (tono gris). Debajo de la tasa global, nota corta: *"Incluye las ejecuciones del propio panel y de WF6; para el bot, ver la fila de WF1."* Debajo de la duración: *"Incluye webhooks de estado de Meta."* El umbral de 5% queda hardcodeado **hasta v4.0** (ahí lo define el backend).
- **DB:** etiqueta del espacio: *"Espacio del proyecto Supabase (todos los ambientes)"*.
- **Meta:** **quitar** "Token — días restantes".
- **Infra:** pill derivado así: `status === "error"` → ERROR; si no, por `tunnel_status`: `up` → OK, `degradado` → ADVERTENCIA (tono warn, con el `error_detalle`), `down` → ERROR, `n/a` → "NO APLICA" gris + `tunnel_detalle`. Redis: *"Redis — memoria usada"* (contexto se agrega en v4.0).

### 3.3 Turnos / Negocio

- Encabezado: `reset_desde` null → *"Histórico completo (sin reset)"*; pasado → *"Midiendo desde <fecha>"* (+ días transcurridos calculados en el front); futuro → *"Empieza el <fecha>"*. Comparar **como fechas** (`new Date(...)`), nunca como strings.
- Turnos: con reset → una sola cifra *"Creados desde el reset"* (`creados_total`); sin reset → *"Creados (histórico)"* y *"Creados (mes en curso)"*. Cancelados bot / GCal manual. Tasa rotulada *"Tasa de cancelación (paciente por menú + recepción; no incluye auto-cancelaciones)"*. Tabla `por_tipo`. Nota con `cohorte_definicion`.
- **Eliminar** la sección "Cancelaciones — cohorte del período".
- Recordatorios (rotular con honestidad, sin cambiar números): *"Turnos agendados para mañana"* (`confirmados_manana`), *"Con recordatorio enviado"*, *"Cobertura de recordatorio"* (`tasa_exito_pct`) con nota *"antes de las 08:00 es normal que dé 0%: el envío corre a esa hora"*. Aclarar que no es confirmación del paciente.
- Pacientes: misma regla que turnos (una cifra con reset, dos sin reset).
- **Eliminar** "Validación de teléfono".
- Mostrar `status`/`error_detalle` de `turnos`, `recordatorios`, `pacientes` cuando vengan.

### 3.4 Costos

- Cambiar el tag del título de "Estimado" a **"Medido + estimado"**.
- Encabezado: `costos.reset_desde` null → *"Mes calendario en curso (sin reset)"*; si no, igual que negocio. Debajo: *"Primer mensaje medido: <medicion_desde> · <medicion_dias> días"* y, si `medicion_mes_completo` es bool, *"mes completo"* / *"mes parcial"*.
- Cifra destacada (arriba, grande):
  - si `pricing_per_message_vigente === false`: **`meta_proyectado_per_message_ars`** rotulado *"Con el cobro por mensaje (desde 1/10/2026)"*, y al lado `meta_medido_ars` *"Medido con las reglas actuales"*.
  - si `true`: **`meta_medido_ars`** *"Medido"* (el proyectado queda como secundario o se oculta: son iguales).
- Secundarias: `meta_medido_proyeccion_mes_ars` *"Proyección a 30 días del medido"* (si `null` y `medicion_dias < 7`: *"necesita ≥ 7 días de medición"*), `meta_estimado_ars` *"Estimado por turnos (modelo anterior)"*, `groq_estimado_usd` *"Groq — estimado (hoy free tier)"*.
- `mensajes_medidos` + tabla de categorías **desde el objeto**, orden fijo `service, utility, marketing, authentication`.
- `medicion_status: "error"` → mostrar `medicion_error_detalle`.
- `nota` al pie.

### 3.5 Reset

- Mantener dos botones independientes con confirmación previa, `try/catch` que envuelva **todo** el handler (incluido lo previo al `fetch`), y error visible en la UI.
- Tras el `200`: **hacer un GET completo** (los contadores cambian de valor al moverse el ancla; parchear solo la fecha dejaría números viejos con fecha nueva). Si ese GET falla, al menos actualizar el encabezado con `medicion_*_desde` y mostrar *"reset aplicado; actualizá para ver los números"*.
- Mostrar, tras el reset, *"Anterior: <desde_anterior.<ambito>>"* (o *"sin reset previo"* si `null`) — es la única pista para deshacerlo.
- Borrar `aplicarResetLocal()` tal como está (escribe `periodo`). En modo mock, simular el reset seteando `reset_desde` / `costos.reset_desde`.
- **Verificar específicamente el botón de Costos:** el 2026-09-2x se observó en `staging` que su clic **no emitía ningún POST** (el de Negocio sí). Con el handler reescrito, confirmar en DevTools → Network que **ambos** emiten el POST con el `ambito` correcto (en modo mock no hay red: ver §3.7).

### 3.6 Robustez

- Ningún acceso a subcampos sin guarda (`(negocio.costos || {})`, etc.).
- Ninguna comparación de fechas por string.

### 3.7 Selector de ambiente (F-2, fijada — implementar en la Fase 1)

Allowlist **fija en el código** de dos backends — nunca una URL arbitraria por query param (una URL maliciosa se llevaría el token):

- `staging` (default): `https://staging.expedita.com.ar/webhook/diagnostico`
- `test` (`?env=test`): `https://local-dev.expedita.com.ar/webhook/diagnostico` (Develop/Test, n8n local de Ignacio; solo responde si él lo tiene levantado)

Token guardado **por ambiente** (`diagToken:staging` / `diagToken:test`), porque son distintos. Sirve para probar el POST real de reset contra Develop/Test sin tocar `staging`.

### 3.8 Documentación de este repo (misma Fase 1)

- `docs/mock-response.json` → reemplazar por el ejemplo de §2.2. Agregar `docs/mock-response-sin-reset.json` (ambos `reset_desde: null`, `medicion_mes_completo` bool) para probar las dos ramas.
- `docs/CONTRATO_JSON.md` → reescribir con §2 de este documento (v2.0).
- `.claude/skills/diagnostico-contract/SKILL.md` → actualizar forma, quitar `periodo`/ad-hoc, agregar la regla de `contract_version` y la nueva regla de bloque en error (§3.2).
- `.claude/skills/diagnostico-qa/SKILL.md` → agregar los casos de §3.9.
- `docs/SPEC.md` §6.1-§6.4 → nota "superado por `docs/SPEC-frontend-contrato-v2-y-v3-2026-09.md`" (no borrar el texto).
- `docs/prompt-frontend-fix-reset-costos-2026-09.md` → **borrarlo** (F-4, fijada; nunca se commiteó).

### 3.9 Criterios de aceptación — Fase 1

- **F1-1** Con el mock v2.0 **ningún** indicador visible muestra "sin datos" salvo los que el mock trae en `null`.
- **F1-2** Aparece "Midiendo desde…" en Negocio (mock con reset) y "Mes calendario en curso (sin reset)" en Costos.
- **F1-3** Con `reset_desde` futuro → "Empieza el …".
- **F1-4** La proyección per-message es la cifra destacada de Costos con `pricing_per_message_vigente: false`; con `true`, lo es el medido.
- **F1-5** `mensajes_por_categoria` se muestra como tabla de 4 filas; con las 4 en `null` → "sin datos" sin romper.
- **F1-6** `meta_medido_ars: 0` se ve como `$ 0`; `null` como "sin datos".
- **F1-7** No aparecen: token días restantes, validación de teléfono, sección de cohorte del período, ningún `_periodo`.
- **F1-8** `salud.n8n` con `status: "error"` + `error_detalle` + `workflows[]` → la tabla se ve **y** el detalle también. Bloque ausente → "sin datos" solo ahí.
- **F1-9** `infra` con `tunnel_status: "n/a"` → pill gris "NO APLICA" + `tunnel_detalle`; `"degradado"` → advertencia.
- **F1-10** Mock con `"contract_version": "3.0"` → banner de versión no reconocida y el resto renderiza.
- **F1-11** Reset en mock: los dos botones actualizan su encabezado; en real (Develop/Test o Ignacio en `staging`) los dos emiten POST con su `ambito` y luego un GET.
- **F1-12** Casos de la skill QA §2 (bloque error, bloque ausente, `null` en costos) siguen pasando; grep de secretos limpio; responsive.

---

## 4. Fases 2 a 5 — cambios de UI esperados (NO implementar hasta que el backend publique esa versión)

Regla de deploy entre repos: **el frontend se publica primero**. Antes de que el backend despliegue la versión N, este panel ya tiene que entender N **y seguir entendiendo N-1** (rollback del backend). Por eso cada fase de acá abajo se implementa **cuando Ignacio avise que el backend de esa versión está aprobado**, y se publica antes del deploy del backend. Todo campo nuevo se lee con guarda (puede no estar todavía).

### 4.1 Contrato `"3.0"` (Fase 2) — aparece `contract_version`

Backend: campo raíz `contract_version: "3.0"` (también en el 200 del POST reset).

- `negocio.turnos`: **se quita** `tasa_cancelacion_pct`; **se agregan** `cancelados_bot_recordatorio`, `cancelados_auto_sin_confirmacion`, `cancelados_sin_origen`, `cancelados_total` (int\|null), `tasa_cancelacion_total_pct` (number\|null), opcional `origenes_desconocidos` (int). UI: desglose de cancelaciones por origen — *paciente (menú)*, *paciente (recordatorio)*, *recepción*, *automática por falta de confirmación*, *sin origen*; tasa total. Si `origenes_desconocidos > 0`, advertencia "hay un origen de baja que el panel no conoce".
- `negocio.recordatorios`: **se quitan** `confirmados_manana`, `recordatorios_enviados`, `tasa_exito_pct`; **se agregan**:
  - `wf3_corrida_hoy`: `"ok"` \| `"error"` \| `"no_corrio"` \| `null`.
  - `proximos_dias[]` (4 elementos: mañana … mañana+3): `{fecha, vigentes, con_recordatorio, recordatorio_entregado, confirmados, vigentes_sin_recordatorio, vigentes_sin_recordatorio_previos, cancelados_auto, cancelados_paciente, cancelados_recepcion}` (int). UI: tabla por fecha. Resaltar en rojo `vigentes_sin_recordatorio_previos > 0` **del primer elemento (mañana)** cuando `wf3_corrida_hoy` es `"ok"`/`"error"`. "Entregado" ≠ "enviado": mostrar ambos.
  - `definicion` (string, nota).
- **Nuevo** `negocio.confirmacion` (embudo): `recordatorios_enviados, sin_botones, en_curso, elegibles_cerrados, no_entregados, confirmados, auto_cancelados, cancelados_paciente, cancelados_recepcion, sin_resolucion` (int\|null), `tasa_confirmacion_pct, tasa_auto_cancelacion_pct, tasa_cancelacion_paciente_pct` (number\|null), `definicion`, `status`/`error_detalle`. UI: embudo o barras apiladas de los 5 resultados sobre `elegibles_cerrados`; la tasa de auto-cancelación rotulada *"proxy de ausentismo (referencia sana: < 8-10%)"*; si `elegibles_cerrados < 10`, *"muestra chica"*. Sigue el ancla de Turnos/Negocio.
- `CONTRATOS_SOPORTADOS = ["2.0", "3.0"]`.

### 4.2 Contrato `"3.1"` (Fase 3)

- `salud.n8n.workflows[]` cron: `ultima_corrida_at` (ISO\|null), `ultima_corrida_status` (string verbatim de n8n: `success`, `error`, `crashed`, `running`, …). Todas las filas: `error_workflow_configurado` (bool\|null). Aparece la fila `WF7_Alertas` (no-cron). UI: columna "Última corrida" con estado; ícono de alerta desenganchada si `error_workflow_configurado === false`.
- `salud.meta`: `phone_status`, `name_status`, `messaging_limit` (string\|null, verbatim). UI: `CONNECTED` → OK, otro → ERROR; límite tal cual (`TIER_250`, …).
- `negocio.recordatorios.hoy`: `{enviados, entregados, sin_entrega_confirmada}`.
- **Nuevo** `negocio.auto_cancelacion`: `{corte_hoy_at, pendientes_de_decision, auto_cancelados_hoy, definicion}`. UI: si pasaron > 45 min de `corte_hoy_at` y `pendientes_de_decision > 0`, advertencia "WF6 no decidió".
- Las **alertas activas** (Telegram/Healthchecks) viven fuera del panel: no hay UI que hacer.

### 4.3 Contrato `"3.2"` (Fase 4)

- **Nuevo** `negocio.derivaciones`: `total` (int\|null), `por_motivo` (objeto con **7 claves siempre**: `explicito_menu, explicito_texto, explicito_ia, urgencia, fallback_flujo, fallback_ia, error_sistema`; + opcional `motivo_desconocido`), `ultimas_24h` `{total, error_sistema, fallback_ia, fallback_flujo, urgencia}`, `en_modo_humano_ahora` (int\|null), y `contencion_7d` `{conversaciones, derivadas, contencion_pct, dias_cubiertos}`. UI: separar *pedidas por el paciente* (explicito_*, urgencia) de *por falla del bot* (fallback_*, error_sistema — destacadas). Contención con referencia 70-85%; `contencion_pct: null` con `dias_cubiertos < 7` → *"midiendo (N de 7 días)"*.
- `salud.n8n.trafico_wf1`: `{mensajes_procesados_24h, fuente, nota, duracion_p95_ms}` — reemplaza visualmente a "OK 24h" de WF1 como "tráfico real".
- `salud.n8n.tasa_error_operativa_pct` (excluye panel y alertas) — pasa a ser **la** tasa global mostrada; `tasa_error_global_pct` queda deprecada (ocultarla).
- `salud.n8n.workflows[].truncado` (bool\|null): con `true`, marcar los conteos de esa fila como "≥" (mínimos).
- **Nuevo** `salud.llm`: `{errores_24h, rate_limit_24h, ventana_cubierta_horas, techo_tpm, proxy_sin_instrumentacion}`. UI: "Groq — errores / límite de tasa (24 h)"; si `ventana_cubierta_horas < 24`, aclararlo.

### 4.4 Contrato `"4.0"` (Fase 5)

- **Se quitan:** `salud.meta.token_dias_restantes`, `negocio.validacion_telefono`, `salud.n8n.tasa_error_global_pct` y `salud.n8n.duracion_promedio_wf1_ms`.
- `tasa_error_pct` pasa a `null` sin ejecuciones → "sin ejecuciones".
- `salud.db`: `espacio_alcance` (`"proyecto_supabase"`), `espacio_nota` (string, mostrar como ayuda).
- `salud.infra`: `redis_maxmemory_mb` (number\|null), `redis_maxmemory_configurado` (bool\|null), `redis_keys` (int\|null). UI: "X MB de Y MB" o "sin límite configurado".
- **Nuevo bloque raíz `resumen`**: `{estado: "ok"|"advertencia"|"critico"|"sin_datos", alertas: [{codigo, severidad: "advertencia"|"critico", bloque, campo, mensaje, valor, umbral}]}`. UI: **semáforo global arriba** ("Todo OK" / "N advertencias, M críticos" con la lista de `mensaje`), y resaltado del campo según `campo`/`codigo`. **Eliminar todos los umbrales hardcodeados** del front (el 5% incluido): el color de una métrica sale solo de `alertas[]`.
- **Nuevo `negocio.tendencia_7d[]`**: 7 elementos `{fecha, parcial, turnos_creados, recordatorios_enviados, confirmaciones, auto_cancelados, derivaciones, mensajes_facturables}` (+ `tendencia_status: "error"` si falla). UI: mini-gráficos (sparklines) dibujados con SVG/DOM propios, sin librerías; el día `parcial` con estilo distinto.
- **Auto-refresh** (F-3, fijada): **opt-in** con un toggle (apagado por defecto, persistido en `localStorage`), cada **10 min**, **solo con la pestaña visible** (Page Visibility API), sin superponer requests. Cada refresh es una ejecución real del backend: no bajar de 10 min.

---

## 5. Decisiones FIJADAS del lado del frontend (aprobadas por Ignacio el 2026-09-28)

| # | Tema | **Decisión fijada** |
|---|---|---|
| **F-1** | Qué hacer tras un reset | **GET completo** (§3.5): con el contrato v2.0 los números cambian con el ancla. Si el GET falla, solo se actualiza el encabezado con aviso. |
| **F-2** | Selector de ambiente | **Sí, en la Fase 1** (§3.7): allowlist **fija en el código** `staging` (default) / `test` (`?env=test`), token por ambiente. **Nunca** URL libre por parámetro. |
| **F-3** | Auto-refresh (Fase 5) | **Opt-in** (toggle apagado por defecto, en `localStorage`), **cada 10 min**, **solo con la pestaña visible**, sin superponer requests (§4.4). |
| **F-4** | `docs/prompt-frontend-fix-reset-costos-2026-09.md` | **Borrarlo** como parte de la Fase 1 (nunca se commiteó y describe un contrato que no existe). |

Decisiones del backend que afectan a la UI (también fijadas): alertas por **Telegram** + latido **Healthchecks.io** (fuera del panel, sin UI); el backend **sí** instrumenta el bot, así que `contencion_7d`, `trafico_wf1.duracion_p95_ms` y `salud.llm` van a existir desde el contrato 3.2; `groq_estimado_usd` se conserva y se rotula "costo si se pasa a Dev Tier (hoy free tier, US$ 0)"; la confirmación en el embudo se rotula "paciente o recepción".
