// ---------------------------------------------------------------------------
// Configuración — editar acá, nunca poner el token acá.
// ---------------------------------------------------------------------------

// Allowlist FIJA de backends (WF5, repo dental-clinic-bot). Nunca aceptar una
// URL arbitraria por query param: una URL maliciosa se llevaría el token.
// `?env=test` elige Develop/Test (n8n local de Ignacio); cualquier otro valor
// o ausencia => staging.
const BACKENDS = {
  staging: "https://staging.expedita.com.ar/webhook/diagnostico",
  test: "https://local-dev.expedita.com.ar/webhook/diagnostico",
};

const PARAMS = new URLSearchParams(location.search);
const AMBIENTE = PARAMS.get("env") === "test" ? "test" : "staging";
const WEBHOOK_URL = BACKENDS[AMBIENTE];

// Mocks locales para desarrollar sin depender de que WF5 esté desplegado.
// `?mock=sin-reset` elige la variante sin reset (también allowlist fija).
const MOCKS = {
  "con-reset": "../docs/mock-response.json",
  "sin-reset": "../docs/mock-response-sin-reset.json",
  v4: "../docs/mock-response-v4.json",
  "v4-critico": "../docs/mock-response-v4-critico.json",
};
const MOCK_URL = MOCKS[PARAMS.get("mock")] || MOCKS["con-reset"];

// En localhost/file:// se usa el mock automáticamente — no hace falta token
// ni pegarle a staging para iterar sobre el frontend. Se puede forzar el
// fetch real agregando ?real=1 (staging) o ?env=test (Develop/Test) a la URL,
// sin necesidad de desplegar a Pages para probar.
const FORCE_REAL = PARAMS.has("real") || AMBIENTE === "test";
const USE_MOCK =
  !FORCE_REAL && ["localhost", "127.0.0.1", ""].includes(location.hostname);

// Token por ambiente: staging y test usan tokens distintos.
const TOKEN_STORAGE_KEY = `diagToken:${AMBIENTE}`;
const THEME_STORAGE_KEY = "diagTheme";

// Versiones de contrato que este panel entiende. Sin `contract_version` en la
// respuesta => "2.0" (el backend v2.0 no publica el campo). El backend salta de
// 2.0 a 4.0 en staging; 3.x (fases 2-4 de la spec) también se entiende por si
// se despliega una versión intermedia.
const CONTRATOS_SOPORTADOS = ["2.0", "3.0", "3.1", "3.2", "4.0"];
const CONTRATO_DEFAULT = "2.0";

// Sin umbrales de salud en el front: los define el backend (Config) y llegan
// en `resumen.alertas[]` (contrato 4.0). Ver `toneAlertas()`.

// Workflows programados (cron): no traen ejecuciones_ok_24h ni tasa_error_pct.
const WORKFLOWS_CRON = new Set([
  "WF2_Sync_Feriados",
  "WF3_Recordatorio_Turnos",
  "WF4_Sync_GCal_Appointments",
  "WF6_Auto_Cancelacion",
]);

// Orden fijo de negocio.costos.mensajes_por_categoria.
const CATEGORIAS_MENSAJE = ["service", "utility", "marketing", "authentication"];

// Última respuesta completa del webhook — se usa para repintar el encabezado
// de un panel si el GET posterior a un reset falla (ver resetearMedicion).
let ultimoData = null;

// Alertas del semáforo global (resumen.alertas[]) y versión del contrato de la
// última respuesta renderizada. Los render de bloque las consultan para
// resaltar campos y elevar el pill; se reasignan en render().
let ALERTAS = [];
let VERSION_ACTUAL = [2, 0];

// ---------------------------------------------------------------------------
// Helpers de formato — regla central: null/undefined => "sin datos", nunca 0.
// ---------------------------------------------------------------------------

function esDato(v) {
  return v !== null && v !== undefined;
}

function esObjeto(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function fmt(v, suffix) {
  if (!esDato(v)) return "sin datos";
  return suffix ? `${v}${suffix}` : String(v);
}

function fmtPct(v) {
  if (!esDato(v)) return "sin datos";
  return `${Number(v).toFixed(1)}%`;
}

function fmtBool(v) {
  if (!esDato(v)) return "sin datos";
  return v ? "Sí" : "No";
}

function fmtArs(v) {
  if (!esDato(v)) return "sin datos";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtUsd(v) {
  if (!esDato(v)) return "sin datos";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(v);
}

// Parsea un ISO del backend (con o sin milisegundos) a Date; null si no es
// válido. Toda comparación de fechas pasa por acá — nunca por string.
function parseFecha(iso) {
  if (!esDato(iso)) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtFecha(iso) {
  const d = parseFecha(iso);
  if (!d) return "sin datos";
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" });
}

function fmtFechaCorta(iso) {
  const d = parseFecha(iso);
  if (!d) return "sin datos";
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function fmtUltimaCorrida(at, horas) {
  if (!esDato(at)) return "sin datos";
  if (esDato(horas)) return `${fmtFecha(at)} (hace ${horas} h)`;
  return fmtFecha(at);
}

function plural(n, singular, pluralTxt) {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

// "3.2" => [3, 2]. Un valor ilegible cae a [0, 0].
function parseVersion(v) {
  const [maj, min] = String(v).split(".");
  return [parseInt(maj, 10) || 0, parseInt(min, 10) || 0];
}

// ¿El contrato de la respuesta actual ya debería traer un bloque introducido
// en `minVersion`? Si sí y falta => "sin datos"; si no => se oculta (es normal
// que un backend 2.0 no lo publique).
function versionAlcanza(minVersion) {
  const [a, b] = VERSION_ACTUAL;
  const [c, d] = parseVersion(minVersion);
  return a > c || (a === c && b >= d);
}

// Día "YYYY-MM-DD" => "dd/mm" sin pasar por Date (evita el corrimiento UTC).
function fmtDia(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (m) return `${m[3]}/${m[2]}`;
  return fmtFechaCorta(iso);
}

// --- Semáforo: resumen.alertas[] es la ÚNICA fuente de color/umbral.
const TONE_RANK = { unk: 0, good: 1, warn: 2, crit: 3 };

function peorTono(a, b) {
  return (TONE_RANK[b] || 0) > (TONE_RANK[a] || 0) ? b : a;
}

function severidadATono(sev) {
  const s = String(sev || "").toLowerCase();
  if (s === "critico" || s === "crítico") return "crit";
  if (s === "advertencia") return "warn";
  return "warn";
}

// Peor tono entre las alertas del bloque (y, si se pasa, del campo) — o
// undefined si no hay ninguna. `mencion` restringe a alertas que nombran ese
// texto (p. ej. un workflow). Comparación laxa: el backend puede anidar
// bloque/campo ("salud.n8n", "workflows.WF1.tasa_error_pct").
function toneAlertas(bloque, campo, mencion) {
  let tone;
  for (const a of ALERTAS) {
    if (!esObjeto(a)) continue;
    if (!String(a.bloque || "").toLowerCase().includes(bloque)) continue;
    if (campo && !String(a.campo || "").toLowerCase().includes(campo)) continue;
    if (mencion && !JSON.stringify(a).toLowerCase().includes(mencion.toLowerCase())) continue;
    tone = peorTono(tone || "unk", severidadATono(a.severidad));
  }
  return tone;
}

// Clase de celda según alertas ("cell-warn"/"cell-crit"/"").
function claseCelda(tone) {
  return tone === "crit" ? "cell-crit" : tone === "warn" ? "cell-warn" : "";
}

// Encabezado de un ancla de medición (negocio.reset_desde o
// negocio.costos.reset_desde, independientes entre sí).
//   null   => textoSinReset
//   futuro => "Empieza el <fecha>"
//   pasado => "Midiendo desde <fecha> (N días)"
function fmtAncla(resetDesde, textoSinReset) {
  if (!esDato(resetDesde)) return textoSinReset;
  const d = parseFecha(resetDesde);
  if (!d) return "Punto de partida de la medición: sin datos";
  const ahora = Date.now();
  if (d.getTime() > ahora) {
    return `Empieza el ${fmtFechaCorta(resetDesde)}`;
  }
  const dias = Math.floor((ahora - d.getTime()) / 86400000);
  const transcurrido = dias === 0 ? "menos de 1 día" : plural(dias, "día", "días");
  return `Midiendo desde ${fmtFechaCorta(resetDesde)} (${transcurrido})`;
}

// ---------------------------------------------------------------------------
// Iconos — construidos con SVG/DOM (nunca innerHTML) para poder combinar
// color + ícono + texto en cada indicador de estado (nunca color solo).
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_PATHS = {
  good: [
    { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
    { tag: "path", attrs: { d: "M8 12l3 3 5-6" } },
  ],
  warn: [
    { tag: "path", attrs: { d: "M12 2 1 21h22L12 2z" } },
    { tag: "line", attrs: { x1: "12", y1: "9", x2: "12", y2: "13" } },
    { tag: "line", attrs: { x1: "12", y1: "17", x2: "12.01", y2: "17" } },
  ],
  crit: [
    { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
    { tag: "path", attrs: { d: "M15 9l-6 6M9 9l6 6" } },
  ],
  unk: [
    { tag: "circle", attrs: { cx: "12", cy: "12", r: "10" } },
    {
      tag: "path",
      attrs: { d: "M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.4" },
    },
    { tag: "line", attrs: { x1: "12", y1: "17", x2: "12.01", y2: "17" } },
  ],
};

function buildIcon(tone) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const parts = ICON_PATHS[tone] || ICON_PATHS.unk;
  for (const part of parts) {
    const node = document.createElementNS(SVG_NS, part.tag);
    for (const [attr, value] of Object.entries(part.attrs)) {
      node.setAttribute(attr, value);
    }
    svg.appendChild(node);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// Helpers de DOM — se construye con createElement/textContent (nunca
// innerHTML con datos del backend) para no depender de escapar HTML a mano.
// ---------------------------------------------------------------------------

function el(tag, opts) {
  const node = document.createElement(tag);
  if (opts) {
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// items: [{ label, value, tone?: 'warn'|'crit'|'muted', dot?: 'good'|'warn'|'crit'|'unk', small?: bool, sub? }]
function renderStats(container, items, opts) {
  let cls = "stats";
  if (opts && opts.singleColumn) cls += " stats-1col";
  if (opts && opts.className) cls += ` ${opts.className}`;
  const wrap = el("div", { className: cls });
  for (const item of items) {
    const stat = el("div", { className: "stat" });
    stat.appendChild(el("span", { className: "stat-label", text: item.label }));

    let valueClass = "stat-value";
    if (item.tone === "warn") valueClass += " warn";
    else if (item.tone === "crit") valueClass += " crit";
    else if (item.tone === "muted") valueClass += " muted";
    if (item.small) valueClass += " small";

    const valueEl = el("span", { className: valueClass });
    if (item.dot) {
      valueEl.appendChild(el("span", { className: `dot dot-${item.dot}` }));
      valueEl.appendChild(document.createTextNode(item.value));
    } else {
      valueEl.textContent = item.value;
    }
    stat.appendChild(valueEl);

    if (item.sub) stat.appendChild(el("span", { className: "stat-sub", text: item.sub }));
    wrap.appendChild(stat);
  }
  container.appendChild(wrap);
  return wrap;
}

// Tabla simple de dos columnas: rows = [[a, b], ...]. No agrega nada si rows
// viene vacío.
function renderTablaPares(container, rows, headerA, headerB) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const tablaWrap = el("div", { className: "tabla-simple table-wrap" });
  const tabla = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", { text: headerA }));
  headRow.appendChild(el("th", { text: headerB }));
  thead.appendChild(headRow);
  tabla.appendChild(thead);
  const tbody = el("tbody");
  for (const [a, b] of rows) {
    const tr = el("tr");
    tr.appendChild(el("td", { text: fmt(a) }));
    tr.appendChild(el("td", { text: fmt(b) }));
    tbody.appendChild(tr);
  }
  tabla.appendChild(tbody);
  tablaWrap.appendChild(tabla);
  container.appendChild(tablaWrap);
}

function renderSinDatos(container, motivo) {
  clear(container);
  container.appendChild(
    el("p", { className: "sin-datos", text: motivo || "sin datos" })
  );
}

// Caja con el `error_detalle` de un bloque/sub-bloque en error.
function renderErrorDetalle(container, detalle, tone) {
  const caja = el("p", { className: `error-detalle error-detalle-${tone || "crit"}` });
  caja.appendChild(buildIcon(tone || "crit"));
  caja.appendChild(
    document.createTextNode(esDato(detalle) && detalle !== "" ? String(detalle) : "Error sin detalle")
  );
  container.appendChild(caja);
}

// Mapea un status crudo del contrato ("up"/"ok"/"error"/"down"/ausente) al
// tono visual fijo: good (verde), crit (rojo) o unk (gris, sin datos).
function statusToTone(status) {
  const s = (status || "").toLowerCase();
  if (s === "up" || s === "ok") return "good";
  if (s === "error" || s === "down") return "crit";
  return "unk";
}

function toneLabel(tone) {
  if (tone === "good") return "OK";
  if (tone === "warn") return "ADVERTENCIA";
  if (tone === "crit") return "ERROR";
  return "SIN DATOS";
}

function setPill(pillEl, tone, label) {
  pillEl.className = `pill pill-${tone}`;
  clear(pillEl);
  pillEl.appendChild(buildIcon(tone));
  pillEl.appendChild(document.createTextNode(label || toneLabel(tone)));
}

// GREEN/YELLOW/RED de Meta quality_rating -> mismo esquema good/warn/crit.
function qualityRatingTone(rating) {
  const r = (rating || "").toUpperCase();
  if (r === "GREEN") return { tone: "good", label: "GREEN" };
  if (r === "YELLOW") return { tone: "warn", label: "YELLOW" };
  if (r === "RED") return { tone: "crit", label: "RED" };
  return { tone: "unk", label: esDato(rating) ? String(rating) : "SIN DATOS" };
}

// ---------------------------------------------------------------------------
// Render por bloque — cada uno se ejecuta aislado.
//   - Bloque AUSENTE => "sin datos" solo en ese bloque.
//   - Bloque con status "error" => se renderizan igual sus campos (los null
//     como "sin datos") y además se muestra su `error_detalle`.
// Un bloque roto nunca tira abajo el resto de la página.
// ---------------------------------------------------------------------------

// pillFn(block) => { tone, label? }; por defecto se deriva de block.status.
function renderBloqueSalud(bodyEl, pillEl, block, renderFn, pillFn, bloque) {
  const alertaBloque = bloque ? toneAlertas(bloque) : undefined;
  if (!esObjeto(block)) {
    setPill(pillEl, alertaBloque || "unk");
    renderSinDatos(bodyEl, "sin datos");
    return;
  }
  try {
    let pill = pillFn ? pillFn(block) : { tone: statusToTone(block.status) };
    // Una alerta del backend sobre este bloque eleva el pill (nunca lo baja).
    if (alertaBloque && peorTono(pill.tone, alertaBloque) !== pill.tone) {
      pill = { tone: alertaBloque };
    }
    setPill(pillEl, pill.tone, pill.label);
    clear(bodyEl);
    // El detalle toma el tono del pill (p. ej. túnel "degradado" => advertencia).
    if (block.status === "error" || (pill.tone === "warn" && esDato(block.error_detalle))) {
      renderErrorDetalle(bodyEl, block.error_detalle, pill.tone === "warn" ? "warn" : "crit");
    }
    renderFn(block);
  } catch (err) {
    console.error("Error renderizando bloque de salud:", err);
    setPill(pillEl, "crit");
    renderSinDatos(bodyEl, "sin datos (error al mostrar este bloque)");
  }
}

function esWorkflowCron(wf) {
  if (WORKFLOWS_CRON.has(wf.nombre)) return true;
  return !("ejecuciones_ok_24h" in wf) && "ultima_corrida_ok_at" in wf;
}

// Conteo con "≥" cuando la fila viene truncada (contrato 3.2+: son mínimos).
function fmtConteo(v, truncado) {
  if (!esDato(v)) return "sin datos";
  return truncado === true ? `≥ ${v}` : String(v);
}

// Tasa de error de una fila no-cron. `null` (contrato 4.0) = no hubo
// ejecuciones en 24h; ausente = sin datos.
function fmtTasaFila(wf) {
  if (wf.tasa_error_pct === null) return "sin ejecuciones";
  return fmtPct(wf.tasa_error_pct);
}

function celdaUltimaCorrida(wf) {
  const td = el("td");
  const at = esDato(wf.ultima_corrida_at) ? wf.ultima_corrida_at : wf.ultima_corrida_ok_at;
  if (!esDato(at) && !esDato(wf.ultima_corrida_status)) {
    td.textContent = "sin datos";
    return td;
  }
  let txt = fmtUltimaCorrida(at, wf.horas_desde_ultima_corrida);
  if (esDato(wf.ultima_corrida_status)) {
    const st = String(wf.ultima_corrida_status);
    txt = `${st} · ${txt}`;
    const ok = st.toLowerCase() === "success";
    const running = st.toLowerCase() === "running";
    if (!ok && !running) td.className = "cell-warn";
  }
  td.textContent = txt;
  return td;
}

function renderN8n(body, pill, block) {
  renderBloqueSalud(body, pill, block, (b) => {
    const tableWrap = el("div", { className: "table-wrap" });
    const table = el("table", { className: "tabla-workflows" });
    const thead = el("thead");
    const headRow = el("tr");
    [
      "Workflow",
      "Activo",
      "OK 24h",
      "Error 24h",
      "Tasa error",
      "Colgadas",
      "Última corrida",
      "Último error",
    ].forEach((h) => headRow.appendChild(el("th", { text: h })));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    const workflows = Array.isArray(b.workflows) ? b.workflows : [];
    const hayResumen = ALERTAS.length > 0;
    for (const wfCrudo of workflows) {
      const wf = esObjeto(wfCrudo) ? wfCrudo : {};
      const cron = esWorkflowCron(wf);
      const noExiste = wf.activo === null;
      const nombre = esDato(wf.nombre) ? String(wf.nombre) : "";
      const tr = el("tr", { className: noExiste ? "fila-inexistente" : "" });

      const nombreCell = el("td", { text: fmt(wf.nombre) });
      // Workflow sin error-workflow: si falla, nadie se entera.
      if (wf.error_workflow_configurado === false) {
        nombreCell.appendChild(
          el("span", {
            className: "tag-alerta",
            text: "sin error workflow",
          })
        );
      }
      tr.appendChild(nombreCell);

      const activoCell = el("td");
      if (noExiste) {
        activoCell.className = "cell-muted";
        activoCell.appendChild(el("span", { className: "dot dot-unk" }));
        activoCell.appendChild(document.createTextNode("no existe en esta instancia"));
      } else {
        activoCell.appendChild(
          el("span", { className: `dot ${wf.activo ? "dot-good" : "dot-unk"}` })
        );
        activoCell.appendChild(document.createTextNode(fmtBool(wf.activo)));
      }
      tr.appendChild(activoCell);

      tr.appendChild(
        el("td", { text: cron ? "—" : fmtConteo(wf.ejecuciones_ok_24h, wf.truncado) })
      );
      tr.appendChild(el("td", { text: fmtConteo(wf.ejecuciones_error_24h, wf.truncado) }));

      if (cron) {
        tr.appendChild(el("td", { text: "—" }));
      } else {
        tr.appendChild(
          el("td", {
            className: claseCelda(nombre ? toneAlertas("n8n", "tasa_error", nombre) : undefined),
            text: fmtTasaFila(wf),
          })
        );
      }

      // Colgadas > 0 es un conteo, no un umbral: con semáforo (4.0) manda el
      // backend; sin él (2.0/3.x) se mantiene el resaltado estructural.
      const colgadasTone = hayResumen
        ? nombre
          ? toneAlertas("n8n", "colgada", nombre)
          : undefined
        : esDato(wf.ejecuciones_colgadas) && wf.ejecuciones_colgadas > 0
          ? "warn"
          : undefined;
      tr.appendChild(
        el("td", {
          className: claseCelda(colgadasTone),
          text: fmtConteo(wf.ejecuciones_colgadas, wf.truncado),
        })
      );

      tr.appendChild(cron ? celdaUltimaCorrida(wf) : el("td", { text: "—" }));

      let errorTexto = "—";
      if (esDato(wf.ultimo_error_mensaje)) {
        errorTexto = `${wf.ultimo_error_mensaje} (${fmtFecha(wf.ultimo_error_at)})`;
      } else if (esDato(wf.ultimo_error_at)) {
        errorTexto = fmtFecha(wf.ultimo_error_at);
      }
      tr.appendChild(el("td", { className: "cell-muted", text: errorTexto }));

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    body.appendChild(tableWrap);
    if (workflows.some((w) => esObjeto(w) && w.truncado === true)) {
      body.appendChild(
        el("p", {
          className: "nota",
          text: "“≥” = conteo truncado: el valor real es igual o mayor.",
        })
      );
    }

    const resumen = el("div", { className: "resumen-linea" });
    const agregarResumen = (etiqueta, valor, nota, tone) => {
      const item = el("div", { className: "resumen-item" });
      const linea = el("span");
      linea.appendChild(document.createTextNode(`${etiqueta}: `));
      linea.appendChild(
        el("strong", { className: claseCelda(tone), text: valor })
      );
      item.appendChild(linea);
      if (nota) item.appendChild(el("span", { className: "resumen-nota", text: nota }));
      resumen.appendChild(item);
    };

    // 4.0: tasa operativa (excluye panel y alertas). 2.0/3.x: la global.
    if ("tasa_error_operativa_pct" in b) {
      agregarResumen(
        "Tasa de error operativa",
        fmtPct(b.tasa_error_operativa_pct),
        "Excluye las ejecuciones del propio panel y de las alertas.",
        toneAlertas("n8n", "tasa_error_operativa")
      );
    } else if ("tasa_error_global_pct" in b) {
      agregarResumen(
        "Tasa de error global",
        fmtPct(b.tasa_error_global_pct),
        "Incluye las ejecuciones del propio panel y de WF6; para el bot, ver la fila de WF1.",
        toneAlertas("n8n", "tasa_error_global")
      );
    }

    const t = b.trafico_wf1;
    if (esObjeto(t)) {
      agregarResumen(
        "Tráfico real WF1 (24 h)",
        fmt(t.mensajes_procesados_24h, " mensajes"),
        [t.fuente, t.nota].filter(esDato).join(" — ") || null
      );
      agregarResumen("Duración p95 WF1", fmt(t.duracion_p95_ms, " ms"), null);
    } else if ("duracion_promedio_wf1_ms" in b) {
      agregarResumen(
        "Duración promedio WF1",
        fmt(b.duracion_promedio_wf1_ms, " ms"),
        "Incluye webhooks de estado de Meta."
      );
    }

    if (resumen.childNodes.length > 0) body.appendChild(resumen);
  }, undefined, "n8n");
}

function renderDb(body, pill, block) {
  renderBloqueSalud(body, pill, block, (b) => {
    renderStats(body, [
      {
        label: "Latencia",
        value: fmt(b.latencia_ms, " ms"),
        tone: toneAlertas("db", "latencia"),
      },
      {
        label: "Turnos huérfanos",
        value: fmt(b.turnos_huerfanos),
        tone:
          toneAlertas("db", "huerfano") ||
          (ALERTAS.length === 0 && esDato(b.turnos_huerfanos) && b.turnos_huerfanos > 0
            ? "warn"
            : undefined),
      },
    ]);

    const etiquetaEspacio = "Espacio del proyecto Supabase (todos los ambientes)";
    const usado = b.espacio_usado_mb;
    const limite = b.espacio_limite_mb;
    const block2 = el("div", { className: "stat stat-block" });
    block2.appendChild(el("span", { className: "stat-label", text: etiquetaEspacio }));
    if (esDato(usado) && esDato(limite) && limite > 0) {
      const pct = Math.min(100, Math.max(0, (usado / limite) * 100));
      block2.appendChild(
        el("span", {
          className: "stat-sub",
          text: `${usado} MB de ${limite} MB (${pct.toFixed(0)}%)`,
        })
      );
      const track = el("div", { className: "meter-track" });
      const fill = el("div", {
        className: `meter-fill${toneAlertas("db", "espacio") ? ` meter-${toneAlertas("db", "espacio")}` : ""}`,
      });
      fill.style.width = `${pct}%`;
      track.appendChild(fill);
      block2.appendChild(track);
    } else {
      block2.appendChild(el("span", { className: "stat-value muted", text: "sin datos" }));
    }
    if (esDato(b.espacio_nota)) {
      block2.appendChild(el("span", { className: "stat-sub", text: String(b.espacio_nota) }));
    }
    body.appendChild(block2);
  }, undefined, "db");
}

// phone_status / name_status (3.1+): CONNECTED => OK, cualquier otro => ERROR.
function statCadena(label, valor, okSi) {
  const stat = el("div", { className: "stat" });
  stat.appendChild(el("span", { className: "stat-label", text: label }));
  const v = el("span", { className: "stat-value small" });
  if (esDato(valor)) {
    const ok = String(valor).toUpperCase() === okSi;
    v.appendChild(el("span", { className: `dot ${ok ? "dot-good" : "dot-crit"}` }));
    v.appendChild(document.createTextNode(String(valor)));
  } else {
    v.classList.add("muted");
    v.textContent = "sin datos";
  }
  stat.appendChild(v);
  return stat;
}

function renderMeta(body, pill, block) {
  // token_dias_restantes fue quitado en 4.0 (null siempre en 2.0): no se lee.
  renderBloqueSalud(body, pill, block, (b) => {
    const quality = qualityRatingTone(b.quality_rating);
    const statsWrap = el("div", { className: "stats" });

    const qualityStat = el("div", { className: "stat" });
    qualityStat.appendChild(el("span", { className: "stat-label", text: "Calidad" }));
    const qualityPill = el("span", { className: `pill pill-${quality.tone}` });
    qualityPill.style.marginTop = "2px";
    qualityPill.appendChild(buildIcon(quality.tone));
    qualityPill.appendChild(document.createTextNode(quality.label));
    qualityStat.appendChild(qualityPill);
    statsWrap.appendChild(qualityStat);

    const webhooksStat = el("div", { className: "stat" });
    webhooksStat.appendChild(el("span", { className: "stat-label", text: "Webhooks" }));
    const webhooksValue = el("span", { className: "stat-value small" });
    if (esDato(b.webhooks_ok)) {
      webhooksValue.appendChild(
        el("span", { className: `dot ${b.webhooks_ok ? "dot-good" : "dot-crit"}` })
      );
      webhooksValue.appendChild(document.createTextNode(fmtBool(b.webhooks_ok)));
    } else {
      webhooksValue.classList.add("muted");
      webhooksValue.textContent = "sin datos";
    }
    webhooksStat.appendChild(webhooksValue);
    statsWrap.appendChild(webhooksStat);

    // Campos 3.1+: solo si el backend los publica.
    if ("phone_status" in b) statsWrap.appendChild(statCadena("Número", b.phone_status, "CONNECTED"));
    if ("name_status" in b) statsWrap.appendChild(statCadena("Nombre", b.name_status, "APPROVED"));
    if ("messaging_limit" in b) {
      const limStat = el("div", { className: "stat" });
      limStat.appendChild(el("span", { className: "stat-label", text: "Límite de mensajería" }));
      limStat.appendChild(
        el("span", {
          className: esDato(b.messaging_limit) ? "stat-value small" : "stat-value small muted",
          text: fmt(b.messaging_limit),
        })
      );
      statsWrap.appendChild(limStat);
    }

    body.appendChild(statsWrap);
  }, undefined, "meta");
}

// El bloque infra NO trae `status` cuando está sano: el pill se deriva de
// tunnel_status. "degradado" = Cloudflare cortó la request antes de n8n
// (advertencia); "n/a" = el ambiente no tiene dominio público (no aplica).
function infraPill(b) {
  const t = (b.tunnel_status || "").toLowerCase();
  if (t === "down") return { tone: "crit" };
  if (t === "degradado") return { tone: "warn" };
  if (b.status === "error") return { tone: "crit" };
  if (t === "up") return { tone: "good" };
  if (t === "n/a") return { tone: "unk", label: "NO APLICA" };
  return { tone: "unk" };
}

const TUNNEL_TONO = { up: "good", degradado: "warn", down: "crit" };

function renderInfra(body, pill, block) {
  renderBloqueSalud(
    body,
    pill,
    block,
    (b) => {
      const t = (b.tunnel_status || "").toLowerCase();
      const statsWrap = el("div", { className: "stats" });

      const tunnelStat = el("div", { className: "stat" });
      tunnelStat.appendChild(el("span", { className: "stat-label", text: "Túnel" }));
      const tunnelValue = el("span", { className: "stat-value small" });
      if (esDato(b.tunnel_status)) {
        tunnelValue.appendChild(el("span", { className: `dot dot-${TUNNEL_TONO[t] || "unk"}` }));
        tunnelValue.appendChild(
          document.createTextNode(t === "n/a" ? "no aplica" : String(b.tunnel_status))
        );
      } else {
        tunnelValue.classList.add("muted");
        tunnelValue.textContent = "sin datos";
      }
      tunnelStat.appendChild(tunnelValue);
      if (t === "n/a" && esDato(b.tunnel_detalle)) {
        tunnelStat.appendChild(el("span", { className: "stat-sub", text: String(b.tunnel_detalle) }));
      }
      statsWrap.appendChild(tunnelStat);

      // Redis: con maxmemory (4.0) "X MB de Y MB"; sin límite configurado lo
      // dice; contrato viejo => solo la memoria usada.
      const redisStat = el("div", { className: "stat" });
      redisStat.appendChild(el("span", { className: "stat-label", text: "Redis — memoria usada" }));
      let redisTxt = fmt(b.redis_memoria_mb, " MB");
      let redisSub = null;
      if (esDato(b.redis_memoria_mb)) {
        if (esDato(b.redis_maxmemory_mb) && Number(b.redis_maxmemory_mb) > 0) {
          redisTxt = `${b.redis_memoria_mb} MB de ${b.redis_maxmemory_mb} MB`;
        } else if (b.redis_maxmemory_configurado === false) {
          redisSub = "sin límite configurado";
        }
      }
      redisStat.appendChild(
        el("span", {
          className: esDato(b.redis_memoria_mb) ? "stat-value" : "stat-value muted",
          text: redisTxt,
        })
      );
      if (redisSub) redisStat.appendChild(el("span", { className: "stat-sub", text: redisSub }));
      statsWrap.appendChild(redisStat);

      if ("redis_keys" in b) {
        const keysStat = el("div", { className: "stat" });
        keysStat.appendChild(el("span", { className: "stat-label", text: "Redis — claves" }));
        keysStat.appendChild(
          el("span", {
            className: esDato(b.redis_keys) ? "stat-value" : "stat-value muted",
            text: fmt(b.redis_keys),
          })
        );
        statsWrap.appendChild(keysStat);
      }

      body.appendChild(statsWrap);
    },
    infraPill,
    "infra"
  );
}

// Groq / LLM (contrato 3.2+). Sin `status` propio: el pill sale de las
// alertas del backend; sin alertas, "OK" si el bloque llegó con datos.
function renderLlm(card, body, pill, block) {
  if (!esObjeto(block) && !versionAlcanza("3.2")) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  renderBloqueSalud(
    body,
    pill,
    block,
    (b) => {
      renderStats(body, [
        {
          label: "Groq — errores (24 h)",
          value: fmt(b.errores_24h),
          tone: toneAlertas("llm", "errores"),
        },
        {
          label: "Groq — límite de tasa (24 h)",
          value: fmt(b.rate_limit_24h),
          tone: toneAlertas("llm", "rate_limit"),
        },
        { label: "Techo de tokens/min", value: fmt(b.techo_tpm), small: true },
        {
          label: "Ventana cubierta",
          value: fmt(b.ventana_cubierta_horas, " h"),
          small: true,
          sub:
            esDato(b.ventana_cubierta_horas) && Number(b.ventana_cubierta_horas) < 24
              ? "La medición cubre menos de 24 h: los conteos son parciales."
              : undefined,
        },
        {
          label: "Proxy — derivaciones por error (24 h)",
          value: fmt(b.proxy_sin_instrumentacion),
          small: true,
        },
      ]);
      // `proxy_sin_instrumentacion` es un CONTEO (negocio.derivaciones.ultimas_24h.error_sistema),
      // nunca un booleano — es una referencia independiente de la instrumentación real,
      // presente siempre que el bloque llega con datos.
      if (esDato(b.proxy_sin_instrumentacion)) {
        body.appendChild(
          el("p", {
            className: "nota",
            text: "El proxy es una referencia independiente (derivaciones por error de sistema en 24 h) — no depende de que la instrumentación del bot esté activa.",
          })
        );
      }
    },
    (b) => ({ tone: b.status === "error" ? "crit" : "good" }),
    "llm"
  );
}

// Sub-bloque de negocio: muestra su error_detalle si viene con status
// "error". Devuelve el objeto o {}. `minVersion`: si el bloque falta, se
// oculta (null) salvo que el contrato de la respuesta ya debería traerlo.
function subBloque(container, obj) {
  const b = esObjeto(obj) ? obj : {};
  if (b.status === "error") renderErrorDetalle(container, b.error_detalle, "crit");
  return b;
}

// Crea un subgrupo con título, o null si el bloque no aplica a esta versión.
function grupoNegocio(body, titulo, obj, minVersion) {
  if (!esObjeto(obj) && !versionAlcanza(minVersion)) return null;
  const grupo = el("div", { className: "subgrupo" });
  grupo.appendChild(el("h3", { text: titulo }));
  body.appendChild(grupo);
  if (!esObjeto(obj)) {
    grupo.appendChild(el("p", { className: "sin-datos", text: "sin datos" }));
    return null;
  }
  return grupo;
}

function statNota(label, value, sub, extra) {
  return { label, value, sub, ...(extra || {}) };
}

function renderTurnos(body, negocio, conReset) {
  const grupo = el("div", { className: "subgrupo" });
  grupo.appendChild(el("h3", { text: "Turnos" }));
  const turnos = subBloque(grupo, negocio.turnos);
  const creados = conReset
    ? [{ label: "Creados desde el reset", value: fmt(turnos.creados_total) }]
    : [
        { label: "Creados (histórico)", value: fmt(turnos.creados_total) },
        { label: "Creados (mes en curso)", value: fmt(turnos.creados_mes) },
      ];
  // Contrato 2.0: una sola tasa. 3.0+: 5 causas de baja + total + tasa total.
  const legacy = "tasa_cancelacion_pct" in turnos && !("cancelados_total" in turnos);
  const bajas = legacy
    ? [
        statNota("Cancelados — bot", fmt(turnos.cancelados_bot), "Paciente por menú."),
        statNota("Cancelados — GCal", fmt(turnos.cancelados_gcal_manual), "Recepción (manual en GCal)."),
        statNota(
          "Tasa de cancelación",
          fmtPct(turnos.tasa_cancelacion_pct),
          "Paciente por menú + recepción; no incluye auto-cancelaciones."
        ),
      ]
    : [
        statNota("Cancelados — total", fmt(turnos.cancelados_total), "Suma de todas las causas."),
        statNota(
          "Tasa de cancelación total",
          fmtPct(turnos.tasa_cancelacion_total_pct),
          "Todas las causas de baja sobre los turnos creados."
        ),
        statNota("Paciente (menú)", fmt(turnos.cancelados_bot), null, { small: true }),
        statNota("Paciente (recordatorio)", fmt(turnos.cancelados_bot_recordatorio), null, { small: true }),
        statNota("Recepción (GCal manual)", fmt(turnos.cancelados_gcal_manual), null, { small: true }),
        statNota(
          "Automática por falta de confirmación",
          fmt(turnos.cancelados_auto_sin_confirmacion),
          null,
          { small: true }
        ),
        statNota("Sin origen", fmt(turnos.cancelados_sin_origen), null, { small: true }),
      ];
  renderStats(grupo, [...creados, ...bajas]);
  if (esDato(turnos.origenes_desconocidos) && turnos.origenes_desconocidos > 0) {
    renderErrorDetalle(
      grupo,
      `Hay ${turnos.origenes_desconocidos} baja(s) con un origen que el panel no conoce.`,
      "warn"
    );
  }
  const porTipo = Array.isArray(turnos.por_tipo) ? turnos.por_tipo : [];
  renderTablaPares(
    grupo,
    porTipo.map((t) => (esObjeto(t) ? [t.especialidad, t.cantidad] : [null, null])),
    "Especialidad",
    "Cantidad"
  );
  if (esDato(turnos.cohorte_definicion)) {
    grupo.appendChild(
      el("p", { className: "nota", text: `Cancelaciones: ${turnos.cohorte_definicion}` })
    );
  }
  body.appendChild(grupo);
}

// Tabla genérica: cols = [{ h, get(fila) => texto, tone?(fila) => cell class }].
function renderTablaFilas(container, filas, cols) {
  if (!Array.isArray(filas) || filas.length === 0) return;
  const wrap = el("div", { className: "tabla-simple table-wrap" });
  const tabla = el("table");
  const thead = el("thead");
  const hr = el("tr");
  for (const c of cols) hr.appendChild(el("th", { text: c.h }));
  thead.appendChild(hr);
  tabla.appendChild(thead);
  const tbody = el("tbody");
  filas.forEach((f, i) => {
    const fila = esObjeto(f) ? f : {};
    const tr = el("tr");
    for (const c of cols) {
      tr.appendChild(el("td", { className: c.clase ? c.clase(fila, i) : "", text: c.get(fila) }));
    }
    tbody.appendChild(tr);
  });
  tabla.appendChild(tbody);
  wrap.appendChild(tabla);
  container.appendChild(wrap);
}

function renderRecordatorios(body, negocio) {
  const grupo = el("div", { className: "subgrupo" });
  const rec = subBloque(grupo, negocio.recordatorios);
  const nuevo = "proximos_dias" in rec || "wf3_corrida_hoy" in rec || "definicion" in rec;
  const hayLegacy = "confirmados_manana" in rec || "recordatorios_enviados" in rec;

  if (nuevo || !hayLegacy) {
    grupo.insertBefore(el("h3", { text: "Recordatorios — próximos días" }), grupo.firstChild);
    const wf3 = rec.wf3_corrida_hoy;
    const wf3Txt =
      wf3 === "ok" ? "corrió OK" : wf3 === "error" ? "corrió con error" : wf3 === "no_corrio" ? "todavía no corrió" : "sin datos";
    const hoy = esObjeto(rec.hoy) ? rec.hoy : null;
    const stats = [
      {
        label: "WF3 hoy",
        value: wf3Txt,
        small: true,
        tone: wf3 === "error" ? "crit" : !esDato(wf3) ? "muted" : undefined,
      },
    ];
    if (hoy) {
      stats.push(
        { label: "Enviados hoy", value: fmt(hoy.enviados), small: true },
        { label: "Entregados hoy", value: fmt(hoy.entregados), small: true },
        { label: "Sin entrega confirmada", value: fmt(hoy.sin_entrega_confirmada), small: true }
      );
    }
    renderStats(grupo, stats);

    // Resaltar en rojo "sin recordatorio previos" de MAÑANA (primer
    // elemento) solo cuando el WF3 de hoy ya corrió.
    const wf3Corrio = wf3 === "ok" || wf3 === "error";
    const num = (k) => (f) => fmt(f[k]);
    renderTablaFilas(
      grupo,
      Array.isArray(rec.proximos_dias) ? rec.proximos_dias : [],
      [
        { h: "Fecha", get: (f) => fmtDia(f.fecha) },
        { h: "Vigentes", get: num("vigentes") },
        { h: "Con recordatorio", get: num("con_recordatorio") },
        { h: "Entregado", get: num("recordatorio_entregado") },
        { h: "Confirmados", get: num("confirmados") },
        { h: "Sin recordatorio", get: num("vigentes_sin_recordatorio") },
        {
          h: "Sin recordatorio (previos)",
          get: num("vigentes_sin_recordatorio_previos"),
          clase: (f, i) =>
            i === 0 && wf3Corrio && esDato(f.vigentes_sin_recordatorio_previos) && f.vigentes_sin_recordatorio_previos > 0
              ? "cell-crit"
              : "",
        },
        { h: "Auto-canc.", get: num("cancelados_auto") },
        { h: "Canc. paciente", get: num("cancelados_paciente") },
        { h: "Canc. recepción", get: num("cancelados_recepcion") },
      ]
    );
    grupo.appendChild(
      el("p", {
        className: "nota",
        text:
          (esDato(rec.definicion) ? `${rec.definicion} ` : "") +
          "“Entregado” no es lo mismo que “enviado”. El reset no afecta esta sección.",
      })
    );
  } else {
    grupo.insertBefore(el("h3", { text: "Recordatorios — turnos de mañana" }), grupo.firstChild);
    renderStats(grupo, [
      { label: "Turnos agendados para mañana", value: fmt(rec.confirmados_manana) },
      { label: "Con recordatorio enviado", value: fmt(rec.recordatorios_enviados) },
      {
        label: "Cobertura de recordatorio",
        value: fmtPct(rec.tasa_exito_pct),
        sub: "Antes de las 08:00 es normal que dé 0%: el envío corre a esa hora.",
      },
    ]);
    grupo.appendChild(
      el("p", {
        className: "nota",
        text:
          "Foto de mañana (el reset no la afecta). Son turnos agendados, no confirmaciones del paciente; “enviado” no garantiza “entregado”.",
      })
    );
  }
  body.appendChild(grupo);
}

// Barra apilada + leyenda con texto (nunca color solo).
function renderBarraApilada(container, partes, total) {
  if (!esDato(total) || total <= 0) return;
  const barra = el("div", { className: "barra-apilada" });
  barra.setAttribute("role", "img");
  barra.setAttribute(
    "aria-label",
    partes.map((p) => `${p.label}: ${fmt(p.valor)}`).join(", ")
  );
  const leyenda = el("ul", { className: "barra-leyenda" });
  partes.forEach((p, i) => {
    const v = esDato(p.valor) ? Number(p.valor) : 0;
    if (v > 0) {
      const seg = el("span", { className: `barra-seg barra-c${i + 1}` });
      seg.style.width = `${Math.min(100, (v / total) * 100)}%`;
      seg.title = `${p.label}: ${v}`;
      barra.appendChild(seg);
    }
    const li = el("li");
    li.appendChild(el("span", { className: `barra-clave barra-c${i + 1}` }));
    li.appendChild(document.createTextNode(`${p.label}: ${fmt(p.valor)}`));
    leyenda.appendChild(li);
  });
  container.appendChild(barra);
  container.appendChild(leyenda);
}

function renderConfirmacion(body, negocio) {
  const grupo = grupoNegocio(body, "Confirmación de turnos (embudo)", negocio.confirmacion, "3.0");
  if (!grupo) return;
  const c = subBloque(grupo, negocio.confirmacion);
  renderStats(grupo, [
    { label: "Recordatorios enviados", value: fmt(c.recordatorios_enviados) },
    { label: "Sin botones", value: fmt(c.sin_botones), small: true },
    { label: "En curso", value: fmt(c.en_curso), small: true },
    { label: "Elegibles cerrados", value: fmt(c.elegibles_cerrados), small: true },
    { label: "No entregados", value: fmt(c.no_entregados), small: true },
    {
      label: "Confirmación (paciente o recepción)",
      value: fmtPct(c.tasa_confirmacion_pct),
    },
    {
      label: "Auto-cancelación",
      value: fmtPct(c.tasa_auto_cancelacion_pct),
      sub: "Proxy de ausentismo (referencia sana: < 8-10%).",
    },
    { label: "Cancelación por el paciente", value: fmtPct(c.tasa_cancelacion_paciente_pct) },
  ]);
  renderBarraApilada(
    grupo,
    [
      { label: "Confirmados", valor: c.confirmados },
      { label: "Auto-cancelados", valor: c.auto_cancelados },
      { label: "Cancelados por el paciente", valor: c.cancelados_paciente },
      { label: "Cancelados por recepción", valor: c.cancelados_recepcion },
      { label: "Sin resolución", valor: c.sin_resolucion },
    ],
    c.elegibles_cerrados
  );
  if (esDato(c.elegibles_cerrados) && c.elegibles_cerrados < 10) {
    grupo.appendChild(
      el("p", { className: "nota", text: "Muestra chica: menos de 10 turnos cerrados, los porcentajes son poco confiables." })
    );
  }
  if (esDato(c.definicion)) grupo.appendChild(el("p", { className: "nota", text: String(c.definicion) }));
}

function renderAutoCancelacion(body, negocio) {
  const grupo = grupoNegocio(body, "Auto-cancelación (WF6)", negocio.auto_cancelacion, "3.1");
  if (!grupo) return;
  const a = subBloque(grupo, negocio.auto_cancelacion);
  renderStats(grupo, [
    { label: "Corte de hoy", value: fmtFechaCorta(a.corte_hoy_at), small: true },
    { label: "Pendientes de decisión", value: fmt(a.pendientes_de_decision) },
    { label: "Auto-cancelados hoy", value: fmt(a.auto_cancelados_hoy) },
  ]);
  // Con semáforo (4.0) el aviso de "WF6 no decidió" lo decide el backend.
  if (ALERTAS.length === 0 && !versionAlcanza("4.0")) {
    const corte = parseFecha(a.corte_hoy_at);
    if (corte && esDato(a.pendientes_de_decision) && a.pendientes_de_decision > 0 &&
        Date.now() - corte.getTime() > 45 * 60000) {
      renderErrorDetalle(grupo, "Pasó el corte y quedan turnos pendientes: WF6 no decidió.", "warn");
    }
  }
  if (esDato(a.definicion)) grupo.appendChild(el("p", { className: "nota", text: String(a.definicion) }));
}

const MOTIVOS_PEDIDOS = [
  ["explicito_menu", "Pedida por menú"],
  ["explicito_texto", "Pedida por texto"],
  ["explicito_ia", "Pedida (detectada por IA)"],
  ["urgencia", "Urgencia"],
];
const MOTIVOS_FALLA = [
  ["fallback_flujo", "Falla del flujo"],
  ["fallback_ia", "Falla de la IA"],
  ["error_sistema", "Error de sistema"],
];

function renderDerivaciones(body, negocio) {
  const grupo = grupoNegocio(body, "Derivaciones a humano", negocio.derivaciones, "3.2");
  if (!grupo) return;
  const d = subBloque(grupo, negocio.derivaciones);
  const pm = esObjeto(d.por_motivo) ? d.por_motivo : {};
  const u = esObjeto(d.ultimas_24h) ? d.ultimas_24h : {};
  const c = esObjeto(d.contencion_7d) ? d.contencion_7d : {};

  let contencion = fmtPct(c.contencion_pct);
  if (!esDato(c.contencion_pct) && esDato(c.dias_cubiertos)) {
    contencion = `midiendo (${c.dias_cubiertos} de 7 días)`;
  }
  renderStats(grupo, [
    { label: "Derivaciones (total)", value: fmt(d.total) },
    { label: "En modo humano ahora", value: fmt(d.en_modo_humano_ahora) },
    {
      label: "Contención del bot (7 d)",
      value: contencion,
      tone: esDato(c.contencion_pct) ? undefined : "muted",
      sub: esDato(c.conversaciones)
        ? `${fmt(c.derivadas)} derivadas de ${c.conversaciones} conversaciones. Referencia: 70-85%.`
        : "Referencia: 70-85%.",
    },
  ]);

  grupo.appendChild(el("h4", { className: "subtitulo", text: "Pedidas por el paciente" }));
  renderTablaPares(grupo, MOTIVOS_PEDIDOS.map(([k, l]) => [l, pm[k]]), "Motivo", "Cantidad");
  grupo.appendChild(el("h4", { className: "subtitulo subtitulo-falla", text: "Por falla del bot" }));
  renderTablaPares(grupo, MOTIVOS_FALLA.map(([k, l]) => [l, pm[k]]), "Motivo", "Cantidad");
  if (esDato(pm.motivo_desconocido) && pm.motivo_desconocido > 0) {
    renderErrorDetalle(grupo, `Hay ${pm.motivo_desconocido} derivación(es) con un motivo que el panel no conoce.`, "warn");
  }
  if (esObjeto(d.ultimas_24h)) {
    renderStats(grupo, [
      { label: "Últimas 24 h", value: fmt(u.total), small: true },
      { label: "Error de sistema (24 h)", value: fmt(u.error_sistema), small: true },
      { label: "Falla IA (24 h)", value: fmt(u.fallback_ia), small: true },
      { label: "Falla flujo (24 h)", value: fmt(u.fallback_flujo), small: true },
      { label: "Urgencia (24 h)", value: fmt(u.urgencia), small: true },
    ]);
  }
}

function renderPacientes(body, negocio, conReset) {
  const grupo = el("div", { className: "subgrupo" });
  grupo.appendChild(el("h3", { text: "Pacientes" }));
  const pacientes = subBloque(grupo, negocio.pacientes);
  renderStats(
    grupo,
    conReset
      ? [{ label: "Altas desde el reset", value: fmt(pacientes.altas_total) }]
      : [
          { label: "Altas (histórico)", value: fmt(pacientes.altas_total) },
          { label: "Altas (mes en curso)", value: fmt(pacientes.altas_mes) },
        ]
  );
  body.appendChild(grupo);
}

function renderNegocio(body, negocio) {
  if (!esObjeto(negocio)) {
    renderSinDatos(body, "sin datos");
    return;
  }
  try {
    clear(body);

    body.appendChild(
      el("p", {
        className: "periodo-info",
        text: fmtAncla(negocio.reset_desde, "Histórico completo (sin reset)"),
      })
    );
    const conReset = esDato(negocio.reset_desde);

    // Cada sub-bloque va aislado: uno roto no tira los demás.
    const seccion = (nombre, fn) => {
      try {
        fn();
      } catch (err) {
        console.error(`Error renderizando ${nombre}:`, err);
        body.appendChild(el("p", { className: "sin-datos", text: `${nombre}: sin datos (error al mostrar)` }));
      }
    };
    seccion("Turnos", () => renderTurnos(body, negocio, conReset));
    seccion("Recordatorios", () => renderRecordatorios(body, negocio));
    seccion("Confirmación", () => renderConfirmacion(body, negocio));
    seccion("Auto-cancelación", () => renderAutoCancelacion(body, negocio));
    seccion("Derivaciones", () => renderDerivaciones(body, negocio));
    seccion("Pacientes", () => renderPacientes(body, negocio, conReset));
  } catch (err) {
    console.error("Error renderizando negocio:", err);
    renderSinDatos(body, "sin datos (error al mostrar este bloque)");
  }
}

// ---------------------------------------------------------------------------
// Tendencia 7 días (contrato 4.0) — sparklines SVG propios, sin librerías.
// ---------------------------------------------------------------------------

const SERIES_TENDENCIA = [
  ["turnos_creados", "Turnos creados"],
  ["recordatorios_enviados", "Recordatorios enviados"],
  ["confirmaciones", "Confirmaciones"],
  ["auto_cancelados", "Auto-cancelados"],
  ["derivaciones", "Derivaciones"],
  ["mensajes_facturables", "Mensajes facturables"],
];

function buildSparkline(dias, clave) {
  const W = 120;
  const H = 32;
  const PAD = 3;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("role", "img");
  const valores = dias.map((d) => (esObjeto(d) && esDato(d[clave]) ? Number(d[clave]) : null));
  svg.setAttribute(
    "aria-label",
    dias.map((d, i) => `${fmtDia(esObjeto(d) ? d.fecha : null)}: ${fmt(valores[i])}`).join(", ")
  );
  const nums = valores.filter((v) => v !== null);
  if (nums.length === 0) return svg;
  const max = Math.max(...nums);
  const min = Math.min(...nums, 0);
  const rango = max - min || 1;
  const x = (i) => PAD + (dias.length > 1 ? (i * (W - 2 * PAD)) / (dias.length - 1) : 0);
  const y = (v) => H - PAD - ((v - min) / rango) * (H - 2 * PAD);

  // Línea sólida por tramos contiguos; el tramo hacia el día parcial va punteado.
  for (let i = 1; i < dias.length; i++) {
    if (valores[i] === null || valores[i - 1] === null) continue;
    const seg = document.createElementNS(SVG_NS, "line");
    seg.setAttribute("x1", x(i - 1));
    seg.setAttribute("y1", y(valores[i - 1]));
    seg.setAttribute("x2", x(i));
    seg.setAttribute("y2", y(valores[i]));
    seg.setAttribute("class", esObjeto(dias[i]) && dias[i].parcial === true ? "spark-seg spark-parcial" : "spark-seg");
    svg.appendChild(seg);
  }
  dias.forEach((d, i) => {
    if (valores[i] === null) return;
    const parcial = esObjeto(d) && d.parcial === true;
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", x(i));
    dot.setAttribute("cy", y(valores[i]));
    dot.setAttribute("r", parcial ? "3" : "2");
    dot.setAttribute("class", parcial ? "spark-dot spark-dot-parcial" : "spark-dot");
    const t = document.createElementNS(SVG_NS, "title");
    t.textContent = `${fmtDia(esObjeto(d) ? d.fecha : null)}: ${valores[i]}${parcial ? " (día en curso, parcial)" : ""}`;
    dot.appendChild(t);
    svg.appendChild(dot);
  });
  return svg;
}

function renderTendencia(card, body, negocio) {
  const dias = esObjeto(negocio) && Array.isArray(negocio.tendencia_7d) ? negocio.tendencia_7d : null;
  if (!dias && !versionAlcanza("4.0")) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  try {
    clear(body);
    if (esObjeto(negocio) && negocio.tendencia_status === "error") {
      renderErrorDetalle(body, negocio.tendencia_error_detalle || negocio.tendencia_detalle, "crit");
    }
    if (!dias || dias.length === 0) {
      body.appendChild(el("p", { className: "sin-datos", text: "sin datos" }));
      return;
    }
    const grilla = el("div", { className: "sparks" });
    for (const [clave, label] of SERIES_TENDENCIA) {
      const item = el("div", { className: "spark-item" });
      item.appendChild(el("span", { className: "stat-label", text: label }));
      const ultimo = dias[dias.length - 1];
      item.appendChild(
        el("span", {
          className: "stat-value small",
          text: fmt(esObjeto(ultimo) ? ultimo[clave] : null),
        })
      );
      item.appendChild(buildSparkline(dias, clave));
      grilla.appendChild(item);
    }
    body.appendChild(grilla);
    const desde = esObjeto(dias[0]) ? fmtDia(dias[0].fecha) : "?";
    const hasta = esObjeto(dias[dias.length - 1]) ? fmtDia(dias[dias.length - 1].fecha) : "?";
    const parcial = dias.some((d) => esObjeto(d) && d.parcial === true);
    body.appendChild(
      el("p", {
        className: "nota",
        text:
          `Últimos 7 días (AR): ${desde} – ${hasta}, incluido hoy.` +
          (parcial ? " El punto hueco / tramo punteado es el día en curso (parcial)." : ""),
      })
    );
  } catch (err) {
    console.error("Error renderizando tendencia:", err);
    renderSinDatos(body, "sin datos (error al mostrar este bloque)");
  }
}

// ---------------------------------------------------------------------------
// Semáforo global (contrato 4.0) — resumen.estado + resumen.alertas[].
// ---------------------------------------------------------------------------

const ESTADO_SEMAFORO = {
  ok: { tone: "good", label: "Todo OK" },
  advertencia: { tone: "warn", label: "Advertencia" },
  critico: { tone: "crit", label: "Crítico" },
  sin_datos: { tone: "unk", label: "Sin datos" },
};

function renderSemaforo(card, resumen) {
  if (!esObjeto(resumen)) {
    // Contrato < 4.0 no lo publica: se oculta. En 4.0, su ausencia es "sin datos".
    if (!versionAlcanza("4.0")) {
      card.hidden = true;
      return;
    }
  }
  card.hidden = false;
  clear(card);
  try {
    const r = esObjeto(resumen) ? resumen : {};
    const alertas = (Array.isArray(r.alertas) ? r.alertas : []).filter(esObjeto);
    const crit = alertas.filter((a) => severidadATono(a.severidad) === "crit");
    const warn = alertas.filter((a) => severidadATono(a.severidad) !== "crit");
    const est = ESTADO_SEMAFORO[String(r.estado || "").toLowerCase()] || ESTADO_SEMAFORO.sin_datos;
    card.className = `semaforo semaforo-${est.tone}`;

    const cab = el("div", { className: "semaforo-cab" });
    cab.appendChild(buildIcon(est.tone));
    let titulo = est.label;
    if (alertas.length > 0) {
      titulo = `${est.label}: ${plural(warn.length, "advertencia", "advertencias")}, ${plural(crit.length, "crítico", "críticos")}`;
    }
    cab.appendChild(el("strong", { className: "semaforo-titulo", text: titulo }));
    card.appendChild(cab);

    if (!esObjeto(resumen)) {
      card.appendChild(el("p", { className: "semaforo-nota", text: "El backend no publicó el resumen global." }));
    } else if (est.tone === "unk") {
      card.appendChild(el("p", { className: "semaforo-nota", text: "No se pudo medir ningún bloque de salud." }));
    }

    if (alertas.length > 0) {
      const ul = el("ul", { className: "semaforo-lista" });
      // Críticas primero.
      for (const a of [...crit, ...warn]) {
        const tone = severidadATono(a.severidad);
        const li = el("li", { className: `semaforo-item semaforo-item-${tone}` });
        li.appendChild(buildIcon(tone));
        const txt = el("span", { className: "semaforo-msg" });
        txt.appendChild(el("span", { text: esDato(a.mensaje) ? String(a.mensaje) : String(a.codigo || "Alerta sin mensaje") }));
        const det = [];
        if (esDato(a.bloque) || esDato(a.campo)) det.push([a.bloque, a.campo].filter(esDato).join("."));
        if (esDato(a.valor)) det.push(`valor ${a.valor}${esDato(a.umbral) ? ` (umbral ${a.umbral})` : ""}`);
        if (esDato(a.codigo)) det.push(String(a.codigo));
        if (det.length) txt.appendChild(el("small", { className: "semaforo-det", text: det.join(" · ") }));
        li.appendChild(txt);
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
  } catch (err) {
    console.error("Error renderizando el semáforo:", err);
    card.className = "semaforo semaforo-unk";
    clear(card);
    card.appendChild(el("strong", { text: "Semáforo: sin datos (error al mostrarlo)" }));
  }
}

function lineaMedicion(costos) {
  const partes = [`Primer mensaje medido: ${fmtFechaCorta(costos.medicion_desde)}`];
  if (esDato(costos.medicion_dias)) {
    partes.push(plural(costos.medicion_dias, "día", "días"));
  }
  if (typeof costos.medicion_mes_completo === "boolean") {
    partes.push(costos.medicion_mes_completo ? "mes completo" : "mes parcial");
  }
  return partes.join(" · ");
}

function renderCostos(body, negocio) {
  const costos = esObjeto(negocio) && esObjeto(negocio.costos) ? negocio.costos : null;
  if (!costos) {
    renderSinDatos(body, "sin datos");
    return;
  }
  try {
    clear(body);

    body.appendChild(
      el("p", {
        className: "periodo-info",
        text: fmtAncla(costos.reset_desde, "Mes calendario en curso (sin reset)"),
      })
    );
    body.appendChild(el("p", { className: "periodo-sub", text: lineaMedicion(costos) }));

    if (costos.medicion_status === "error") {
      renderErrorDetalle(body, costos.medicion_error_detalle, "crit");
    }

    // Cifra destacada: hasta el 1/10/2026 lo que importa es cuánto costaría
    // el mismo tráfico con el cobro por mensaje; desde entonces, el medido.
    const perMessageVigente = costos.pricing_per_message_vigente === true;
    const medidoTone = esDato(costos.meta_medido_ars) ? undefined : "muted";
    const destacadas = perMessageVigente
      ? [{ label: "Meta — medido", value: fmtArs(costos.meta_medido_ars), tone: medidoTone }]
      : [
          {
            label: "Con el cobro por mensaje (desde 1/10/2026)",
            value: fmtArs(costos.meta_proyectado_per_message_ars),
            tone: esDato(costos.meta_proyectado_per_message_ars) ? undefined : "muted",
          },
          {
            label: "Medido con las reglas actuales",
            value: fmtArs(costos.meta_medido_ars),
            tone: medidoTone,
            small: true,
          },
        ];
    renderStats(body, destacadas, { className: "stats-destacadas" });

    let proyeccion = {
      label: "Proyección a 30 días del medido",
      value: fmtArs(costos.meta_medido_proyeccion_mes_ars),
      small: true,
    };
    if (!esDato(costos.meta_medido_proyeccion_mes_ars)) {
      proyeccion.tone = "muted";
      if (esDato(costos.medicion_dias) && costos.medicion_dias < 7) {
        proyeccion.value = "necesita ≥ 7 días de medición";
      }
    }
    const secundarias = el("div", { className: "subgrupo" });
    renderStats(
      secundarias,
      [
        proyeccion,
        {
          label: "Estimado por turnos (modelo anterior)",
          value: fmtArs(costos.meta_estimado_ars),
          tone: esDato(costos.meta_estimado_ars) ? undefined : "muted",
          small: true,
        },
        {
          label: "Groq — estimado (hoy free tier)",
          value: fmtUsd(costos.groq_estimado_usd),
          tone: esDato(costos.groq_estimado_usd) ? undefined : "muted",
          small: true,
        },
      ],
      { singleColumn: true }
    );
    body.appendChild(secundarias);

    const grupoMensajes = el("div", { className: "subgrupo" });
    grupoMensajes.appendChild(el("h3", { text: "Mensajes medidos" }));
    renderStats(grupoMensajes, [
      {
        label: "Total en la ventana",
        value: fmt(costos.mensajes_medidos),
        tone: esDato(costos.mensajes_medidos) ? undefined : "muted",
      },
    ]);
    const porCategoria = esObjeto(costos.mensajes_por_categoria)
      ? costos.mensajes_por_categoria
      : {};
    renderTablaPares(
      grupoMensajes,
      CATEGORIAS_MENSAJE.map((c) => [c, porCategoria[c]]),
      "Categoría",
      "Mensajes"
    );
    body.appendChild(grupoMensajes);

    if (esDato(costos.nota)) {
      body.appendChild(el("p", { className: "nota", text: String(costos.nota) }));
    }
  } catch (err) {
    console.error("Error renderizando costos:", err);
    renderSinDatos(body, "sin datos (error al mostrar este bloque)");
  }
}

// ---------------------------------------------------------------------------
// Tema — claro/oscuro persistido en localStorage; si no hay preferencia
// guardada, sigue prefers-color-scheme del sistema (ver styles.css).
// ---------------------------------------------------------------------------

function getEffectiveTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function updateThemeToggleUI(theme) {
  const boton = document.getElementById("btn-theme");
  const label = document.getElementById("theme-toggle-label");
  boton.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  label.textContent = theme === "dark" ? "Modo claro" : "Modo oscuro";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (err) {
    // Sin storage (modo privado, etc.): el tema dura solo esta carga.
  }
  updateThemeToggleUI(theme);
}

function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (err) {
    stored = null;
  }
  if (stored === "light" || stored === "dark") {
    document.documentElement.setAttribute("data-theme", stored);
  }
  updateThemeToggleUI(getEffectiveTheme());
}

// ---------------------------------------------------------------------------
// Manejo de token — nunca hardcodeado, siempre sessionStorage, uno por
// ambiente. §8 de la spec.
// ---------------------------------------------------------------------------

function getTokenGuardado() {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

function pedirToken() {
  const token = window.prompt(`Token de diagnóstico (X-Diag-Token) — ambiente ${AMBIENTE}:`);
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    return token;
  }
  return null;
}

function limpiarToken() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Fetch principal
// ---------------------------------------------------------------------------

// Agrega X-Diag-Token a un fetch y reintenta una vez si el token vigente fue
// rechazado (401/403) — compartido entre el GET de diagnóstico y el POST de
// reset, que usan el mismo token.
async function fetchConToken(url, opts) {
  let token = getTokenGuardado() || pedirToken();
  if (!token) {
    throw new Error("Se necesita el token de diagnóstico para continuar.");
  }

  const conToken = (t) => ({
    ...opts,
    headers: { ...(opts && opts.headers), "X-Diag-Token": t },
  });

  let res = await fetch(url, conToken(token));

  if (res.status === 401 || res.status === 403) {
    limpiarToken();
    token = pedirToken();
    if (!token) {
      throw new Error("Se necesita el token de diagnóstico para continuar.");
    }
    res = await fetch(url, conToken(token));
    if (res.status === 401 || res.status === 403) {
      limpiarToken();
      throw new Error("El token de diagnóstico fue rechazado (HTTP " + res.status + ").");
    }
  }

  return res;
}

async function obtenerDiagnostico() {
  if (USE_MOCK) {
    const res = await fetch(MOCK_URL, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`No se pudo leer el mock (HTTP ${res.status})`);
    }
    return res.json();
  }

  const res = await fetchConToken(WEBHOOK_URL);
  if (res.status === 204) {
    throw new Error(
      "El backend respondió 204 sin cuerpo (¿Cloudflare filtró la request antes de llegar a n8n?)."
    );
  }
  if (!res.ok) {
    throw new Error(`El webhook respondió HTTP ${res.status}`);
  }

  return res.json();
}

function mostrarErrorGlobal(mensaje) {
  const nodo = document.getElementById("global-error");
  if (!mensaje) {
    nodo.hidden = true;
    nodo.textContent = "";
    return;
  }
  nodo.hidden = false;
  nodo.textContent = mensaje;
}

// ---------------------------------------------------------------------------
// Versión de contrato
// ---------------------------------------------------------------------------

function versionContrato(data) {
  const v = data.contract_version;
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return CONTRATO_DEFAULT;
}

function mayorDe(version) {
  return String(version).split(".")[0];
}

// Un MAYOR no soportado => banner. Mismo MAYOR con MENOR desconocido => ok
// (los campos nuevos simplemente se ignoran).
function contratoReconocido(version) {
  return CONTRATOS_SOPORTADOS.some((s) => mayorDe(s) === mayorDe(version));
}

function renderContrato(version) {
  document.getElementById("contract-badge").textContent = `contrato ${version}`;
  const aviso = document.getElementById("contract-warning");
  if (contratoReconocido(version)) {
    aviso.hidden = true;
    aviso.textContent = "";
    return;
  }
  aviso.hidden = false;
  aviso.textContent =
    `El backend publica el contrato v${version}; este panel entiende ` +
    `${CONTRATOS_SOPORTADOS.join(", ")}. Puede haber datos faltantes o mal ` +
    "rotulados — actualizar el panel.";
}

function render(dataCruda) {
  const data = esObjeto(dataCruda) ? dataCruda : {};
  ultimoData = data;

  const envBadge = document.getElementById("env-badge");
  envBadge.textContent = USE_MOCK
    ? `${fmt(data.environment)} (mock local)`
    : fmt(data.environment);

  const version = versionContrato(data);
  VERSION_ACTUAL = parseVersion(version);
  ALERTAS = esObjeto(data.resumen) && Array.isArray(data.resumen.alertas) ? data.resumen.alertas : [];
  renderContrato(version);
  renderSemaforo(document.getElementById("semaforo"), data.resumen);

  document.getElementById("ultima-actualizacion").textContent =
    `Última actualización: ${fmtFecha(data.generated_at)}`;

  const salud = esObjeto(data.salud) ? data.salud : {};

  renderN8n(
    document.getElementById("n8n-body"),
    document.getElementById("n8n-status"),
    salud.n8n
  );
  renderDb(
    document.getElementById("db-body"),
    document.getElementById("db-status"),
    salud.db
  );
  renderMeta(
    document.getElementById("meta-body"),
    document.getElementById("meta-status"),
    salud.meta
  );
  renderInfra(
    document.getElementById("infra-body"),
    document.getElementById("infra-status"),
    salud.infra
  );

  renderLlm(
    document.getElementById("panel-llm"),
    document.getElementById("llm-body"),
    document.getElementById("llm-status"),
    salud.llm
  );

  renderNegocio(document.getElementById("negocio-body"), data.negocio);
  renderCostos(document.getElementById("costos-body"), data.negocio);
  renderTendencia(document.getElementById("panel-tendencia"), document.getElementById("tendencia-body"), data.negocio);
}

// ---------------------------------------------------------------------------
// Reset del punto de partida — POST al mismo endpoint del GET. Dos botones
// independientes (Turnos/Negocio y Costos), con confirmación previa.
// Tras el 200 se hace un GET completo: al moverse el ancla cambian los
// números, no solo la fecha. `desde_anterior` se muestra porque es la única
// forma de deshacer un reset accidental.
// ---------------------------------------------------------------------------

const RESET_LABELS = {
  negocio: "Turnos/Negocio",
  costos: "Costos",
};

// Lee/escribe el ancla de un ámbito sobre un objeto de respuesta.
function leerAncla(data, ambito) {
  const negocio = esObjeto(data) && esObjeto(data.negocio) ? data.negocio : {};
  if (ambito === "negocio") return esDato(negocio.reset_desde) ? negocio.reset_desde : null;
  const costos = esObjeto(negocio.costos) ? negocio.costos : {};
  return esDato(costos.reset_desde) ? costos.reset_desde : null;
}

function escribirAncla(data, ambito, desde) {
  if (!esObjeto(data.negocio)) data.negocio = {};
  if (ambito === "negocio") {
    data.negocio.reset_desde = desde;
  } else {
    if (!esObjeto(data.negocio.costos)) data.negocio.costos = {};
    data.negocio.costos.reset_desde = desde;
  }
}

function repintarPanel(ambito) {
  if (!ultimoData) return;
  if (ambito === "negocio") {
    renderNegocio(document.getElementById("negocio-body"), ultimoData.negocio);
  } else {
    renderCostos(document.getElementById("costos-body"), ultimoData.negocio);
  }
}

function mostrarAvisoReset(ambito, { aplicadoAt, anterior, advertencia }) {
  const nodo = document.getElementById(`reset-aviso-${ambito}`);
  if (!nodo) return;
  clear(nodo);
  nodo.className = advertencia ? "reset-aviso reset-aviso-warn" : "reset-aviso";
  const aplicado = esDato(aplicadoAt) ? ` el ${fmtFechaCorta(aplicadoAt)}` : "";
  nodo.appendChild(
    el("span", {
      text:
        `Reset aplicado${aplicado} · Anterior: ` +
        (esDato(anterior) ? fmtFechaCorta(anterior) : "sin reset previo"),
    })
  );
  if (advertencia) nodo.appendChild(el("strong", { text: ` — ${advertencia}` }));
  nodo.hidden = false;
}

async function leerCuerpoError(res) {
  const cuerpo = await res.json().catch(() => null);
  return esObjeto(cuerpo) && esDato(cuerpo.detalle) ? String(cuerpo.detalle) : null;
}

async function resetearMedicion(ambito) {
  let boton = null;
  try {
    if (!RESET_LABELS[ambito]) {
      throw new Error(`Ámbito de reset desconocido: ${ambito}`);
    }
    boton = document.getElementById(`btn-reset-${ambito}`);

    const confirmado = window.confirm(
      `¿Resetear el punto de partida de ${RESET_LABELS[ambito]} a partir de ahora?\n\n` +
        "Los contadores de ese panel pasan a contar desde este momento."
    );
    if (!confirmado) return;

    if (boton) boton.disabled = true;
    mostrarErrorGlobal(null);

    if (USE_MOCK) {
      // Sin backend real en modo mock local: simula el reset moviendo el
      // ancla del ámbito (ver .claude/skills/diagnostico-qa/SKILL.md).
      if (!ultimoData) throw new Error("Todavía no hay datos cargados para simular el reset.");
      const anterior = leerAncla(ultimoData, ambito);
      const ahora = new Date().toISOString();
      escribirAncla(ultimoData, ambito, ahora);
      repintarPanel(ambito);
      mostrarAvisoReset(ambito, {
        aplicadoAt: ahora,
        anterior,
        advertencia: "simulado en mock local: los números no cambian",
      });
      return;
    }

    const res = await fetchConToken(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "reset", ambito }),
    });

    if (res.status === 400) {
      const detalle = await leerCuerpoError(res);
      throw new Error(`No se pudo resetear: ${detalle || "solicitud inválida"}`);
    }
    if (res.status === 500) {
      const detalle = await leerCuerpoError(res);
      throw new Error(
        `El reset falló, no se aplicó nada${detalle ? `: ${detalle}` : "."}`
      );
    }
    if (!res.ok) {
      throw new Error(`El webhook respondió HTTP ${res.status} al reset.`);
    }

    const cuerpo = await res.json().catch(() => null);
    if (!esObjeto(cuerpo) || cuerpo.ok !== true) {
      throw new Error("El reset respondió sin confirmación (ok ≠ true); actualizá para verificar.");
    }
    const nuevoDesde =
      ambito === "negocio" ? cuerpo.medicion_negocio_desde : cuerpo.medicion_costos_desde;
    const anterior = esObjeto(cuerpo.desde_anterior) ? cuerpo.desde_anterior[ambito] : null;
    const aplicadoAt = esDato(cuerpo.aplicado_at) ? cuerpo.aplicado_at : nuevoDesde;

    try {
      const data = await obtenerDiagnostico();
      render(data);
      mostrarAvisoReset(ambito, { aplicadoAt, anterior });
    } catch (errGet) {
      console.error("Reset aplicado, pero falló el GET posterior:", errGet);
      if (ultimoData) {
        escribirAncla(ultimoData, ambito, esDato(nuevoDesde) ? nuevoDesde : null);
        repintarPanel(ambito);
      }
      mostrarAvisoReset(ambito, {
        aplicadoAt,
        anterior,
        advertencia: "Reset aplicado; actualizá para ver los números.",
      });
    }
  } catch (err) {
    console.error("Error reseteando medición:", err);
    mostrarErrorGlobal((err && err.message) || "No se pudo resetear la medición.");
  } finally {
    if (boton) boton.disabled = false;
  }
}

async function actualizar() {
  const boton = document.getElementById("btn-actualizar");
  boton.disabled = true;
  mostrarErrorGlobal(null);
  try {
    const data = await obtenerDiagnostico();
    render(data);
  } catch (err) {
    console.error("Error obteniendo diagnóstico:", err);
    mostrarErrorGlobal((err && err.message) || "No se pudo obtener el diagnóstico.");
  } finally {
    boton.disabled = false;
  }
}

function initAmbiente() {
  const nodo = document.getElementById("backend-info");
  if (!nodo) return;
  nodo.textContent = USE_MOCK
    ? "Backend: mock local (docs/). Agregar ?real=1 para staging o ?env=test para Develop/Test."
    : `Backend: ${AMBIENTE}${AMBIENTE === "staging" ? " (agregar ?env=test para Develop/Test)" : ""}.`;
}

initTheme();
initAmbiente();
document.getElementById("btn-theme").addEventListener("click", () => {
  applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
});
document.getElementById("btn-actualizar").addEventListener("click", actualizar);
document.getElementById("btn-reset-negocio").addEventListener("click", () => resetearMedicion("negocio"));
document.getElementById("btn-reset-costos").addEventListener("click", () => resetearMedicion("costos"));
actualizar();
