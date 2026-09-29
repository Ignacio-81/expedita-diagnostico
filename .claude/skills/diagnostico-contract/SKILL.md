---
name: diagnostico-contract
description: >
  Contrato JSON completo que expone WF5 (endpoint, header, forma de la
  respuesta) y reglas de UI para consumirlo. Usar SIEMPRE que se edite
  src/app.js, src/index.html, o cualquier lógica de parseo/render del panel.
---

# Contrato JSON del panel de diagnóstico (v2.0 y v4.0)

El backend (WF5, en `dental-clinic-bot`) expone un único endpoint: GET para
el snapshot y POST para el reset. Referencia completa (diccionario de campos
con tipos y semántica de `null`) en
[docs/CONTRATO_JSON.md](../../../docs/CONTRATO_JSON.md) — mantener ambos
sincronizados si el contrato cambia. Las fases 2-5 (contratos 3.0 → 4.0) están en
[docs/SPEC-frontend-contrato-v2-y-v3-2026-09.md](../../../docs/SPEC-frontend-contrato-v2-y-v3-2026-09.md)
§4 y **ya están implementadas** (Ignacio las pidió el 2026-09-29). El delta
4.0 está al final de `docs/CONTRATO_JSON.md`. Reglas nuevas: el front **no
tiene umbrales de salud hardcodeados** (color/pill salen de
`resumen.alertas[]`); un bloque que la versión de la respuesta aún no publica
se oculta, y si la versión ya lo exige y falta → "sin datos".

## Endpoint

```
GET  /webhook/diagnostico          Header: X-Diag-Token: <token>
POST /webhook/diagnostico          {"accion":"reset","ambito":"negocio"|"costos"}
```

- **No hay consulta ad-hoc**: `?desde=&hasta=` se ignoran. No mandarlos.
- Ambientes: allowlist **fija** en `src/app.js` — `staging` (default) y
  `test` (`?env=test`, Develop/Test). **Nunca** aceptar una URL libre por
  query param (se llevaría el token).
- El `fetch()` del navegador usa el UA real del browser; la restricción de
  User-Agent de CLAUDE.md es para scripts (curl, verificación).
- 🚫 El agente **no** le pega a `staging` (ni GET ni POST de reset): se
  desarrolla contra el mock. Validar contra `staging` lo hace Ignacio.

## Versión de contrato

- `contract_version` en la raíz; **ausente → `"2.0"`**.
- `CONTRATOS_SOPORTADOS` en `src/app.js` (hoy `["2.0","3.0","3.1","3.2","4.0"]`).
- MAYOR desconocido → banner de advertencia (`#contract-warning`) y se
  renderiza igual lo que se pueda. Mismo MAYOR, MENOR desconocido → sin
  banner.
- La versión se muestra junto al badge de ambiente.

## Manejo de token (nunca hardcodear)

- Si no hay token en `sessionStorage`, pedirlo con `prompt()`.
- Clave **por ambiente**: `diagToken:staging` / `diagToken:test`.
- `sessionStorage` (no `localStorage`) — dura la pestaña.
- Ante `401`/`403`: limpiar el token guardado y volver a pedirlo.
- El token **nunca** va escrito en `src/app.js` — ese archivo es público.

## Forma de la respuesta (resumen — detalle en docs/CONTRATO_JSON.md)

```
generated_at, environment ("staging"|"test"), [contract_version]
salud.n8n      status, [error_detalle], workflows[6], tasa_error_global_pct, duracion_promedio_wf1_ms
               no-cron (WF1, WF5): activo, ejecuciones_ok_24h, ejecuciones_error_24h, tasa_error_pct,
                                   ultimo_error_at, ultimo_error_mensaje, ejecuciones_colgadas
               cron (WF2, WF3, WF4, WF6): activo, ultima_corrida_ok_at, horas_desde_ultima_corrida,
                                   ejecuciones_error_24h, ejecuciones_colgadas
salud.db       status, latencia_ms, espacio_usado_mb (proyecto Supabase entero), espacio_limite_mb, turnos_huerfanos
salud.meta     status, quality_rating, webhooks_ok, token_dias_restantes (null siempre → no mostrar)
salud.infra    [status:"error" + error_detalle], tunnel_status (up|degradado|down|n/a), [tunnel_detalle], redis_memoria_mb
negocio.reset_desde                 ancla de Turnos/Negocio (null = histórico completo; puede ser futura)
negocio.turnos                      creados_total, creados_mes, cancelados_bot, cancelados_gcal_manual,
                                    tasa_cancelacion_pct, por_tipo[{especialidad,cantidad}], cohorte_definicion
negocio.recordatorios               confirmados_manana (= agendados), recordatorios_enviados, tasa_exito_pct
negocio.pacientes                   altas_total, altas_mes
negocio.costos.reset_desde          ancla PROPIA de Costos (null = mes calendario en curso)
negocio.costos                      meta_medido_ars, meta_proyectado_per_message_ars, meta_medido_proyeccion_mes_ars,
                                    meta_estimado_ars, groq_estimado_usd, pricing_per_message_vigente,
                                    medicion_desde (con ms), medicion_dias, medicion_mes_completo (null con reset),
                                    mensajes_medidos, mensajes_por_categoria {service,utility,marketing,authentication},
                                    nota, [medicion_status:"error" + medicion_error_detalle]
negocio.validacion_telefono         rechazos_24h (null siempre → no mostrar)
```

**Ya NO existen (no leerlos):** `negocio.periodo`, `negocio.costos.periodo`
y cualquier campo `_periodo`.

## Regla de `null` vs `0`

`null`/ausente → "sin datos" (o se oculta si el contrato lo dice). `0` es un
dato medido → `0` / `$ 0`. Importa sobre todo en costos
(`meta_medido_ars: 0` es legítimo: solo mensajes gratis).

## Bloque con `status: "error"` o ausente

- **Ausente** → "sin datos" solo en ese bloque.
- **Presente con `status: "error"`** → se renderizan igual sus campos (los
  `null` como "sin datos") **y** se muestra `error_detalle`. Vale para los
  bloques de `salud`, para `turnos`/`recordatorios`/`pacientes`, y para
  costos vía `medicion_status`/`medicion_error_detalle`.
- Ningún bloque roto tira abajo el resto (cada render va en su `try/catch`).
- Nunca acceder a subcampos sin guarda; nunca comparar fechas como string
  (`new Date(...)`).

## Requisitos de UI

- Una página, sin routing. Fetch al cargar + botón "Actualizar" (sin
  auto-refresh hasta el contrato 4.0, y ahí opt-in).
- Negocio: encabezado "Histórico completo (sin reset)" / "Midiendo desde…"
  / "Empieza el…". Con reset, una sola cifra "desde el reset" para creados
  y altas; sin reset, histórico + mes en curso.
- Costos: con `pricing_per_message_vigente: false` la cifra destacada es
  `meta_proyectado_per_message_ars`; con `true`, `meta_medido_ars`.
- Reset: dos botones independientes con confirmación previa, handler
  entero en `try/catch`, error visible. Tras el `200` → **GET completo**; si
  falla, parchear solo el encabezado y avisar. Mostrar
  `desde_anterior.<ambito>` (única forma de deshacer un reset).
- DOM con `createElement`/`textContent`, nunca `innerHTML` con datos del
  backend. Sin CDN, sin dependencias.
