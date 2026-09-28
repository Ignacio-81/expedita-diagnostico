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
// respuesta => "2.0" (el backend v2.0 no publica el campo).
const CONTRATOS_SOPORTADOS = ["2.0"];
const CONTRATO_DEFAULT = "2.0";

// Umbral de tasa de error por workflow. Hardcodeado hasta el contrato v4.0,
// donde lo define el backend en `resumen.alertas[]`.
const UMBRAL_TASA_ERROR_PCT = 5;

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
function renderBloqueSalud(bodyEl, pillEl, block, renderFn, pillFn) {
  if (!esObjeto(block)) {
    setPill(pillEl, "unk");
    renderSinDatos(bodyEl, "sin datos");
    return;
  }
  try {
    const pill = pillFn ? pillFn(block) : { tone: statusToTone(block.status) };
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
      "Última corrida OK",
      "Último error",
    ].forEach((h) => headRow.appendChild(el("th", { text: h })));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    const workflows = Array.isArray(b.workflows) ? b.workflows : [];
    for (const wfCrudo of workflows) {
      const wf = esObjeto(wfCrudo) ? wfCrudo : {};
      const cron = esWorkflowCron(wf);
      const noExiste = wf.activo === null;
      const tr = el("tr", { className: noExiste ? "fila-inexistente" : "" });
      tr.appendChild(el("td", { text: fmt(wf.nombre) }));

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

      tr.appendChild(el("td", { text: cron ? "—" : fmt(wf.ejecuciones_ok_24h) }));
      tr.appendChild(el("td", { text: fmt(wf.ejecuciones_error_24h) }));

      if (cron) {
        tr.appendChild(el("td", { text: "—" }));
      } else {
        const tasaWarn =
          esDato(wf.tasa_error_pct) && wf.tasa_error_pct > UMBRAL_TASA_ERROR_PCT;
        tr.appendChild(
          el("td", {
            className: tasaWarn ? "cell-warn" : "",
            text: fmtPct(wf.tasa_error_pct),
          })
        );
      }

      const colgadasWarn = esDato(wf.ejecuciones_colgadas) && wf.ejecuciones_colgadas > 0;
      tr.appendChild(
        el("td", {
          className: colgadasWarn ? "cell-warn" : "",
          text: fmt(wf.ejecuciones_colgadas),
        })
      );

      tr.appendChild(
        el("td", {
          text: cron
            ? fmtUltimaCorrida(wf.ultima_corrida_ok_at, wf.horas_desde_ultima_corrida)
            : "—",
        })
      );

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

    const resumen = el("div", { className: "resumen-linea" });

    const r1 = el("div", { className: "resumen-item" });
    const r1Valor = el("span");
    r1Valor.appendChild(document.createTextNode("Tasa de error global: "));
    r1Valor.appendChild(el("strong", { text: fmtPct(b.tasa_error_global_pct) }));
    r1.appendChild(r1Valor);
    r1.appendChild(
      el("span", {
        className: "resumen-nota",
        text: "Incluye las ejecuciones del propio panel y de WF6; para el bot, ver la fila de WF1.",
      })
    );
    resumen.appendChild(r1);

    const r2 = el("div", { className: "resumen-item" });
    const r2Valor = el("span");
    r2Valor.appendChild(document.createTextNode("Duración promedio WF1: "));
    r2Valor.appendChild(el("strong", { text: fmt(b.duracion_promedio_wf1_ms, " ms") }));
    r2.appendChild(r2Valor);
    r2.appendChild(
      el("span", { className: "resumen-nota", text: "Incluye webhooks de estado de Meta." })
    );
    resumen.appendChild(r2);

    body.appendChild(resumen);
  });
}

function renderDb(body, pill, block) {
  renderBloqueSalud(body, pill, block, (b) => {
    renderStats(body, [
      { label: "Latencia", value: fmt(b.latencia_ms, " ms") },
      {
        label: "Turnos huérfanos",
        value: fmt(b.turnos_huerfanos),
        tone: esDato(b.turnos_huerfanos) && b.turnos_huerfanos > 0 ? "warn" : undefined,
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
      const fill = el("div", { className: "meter-fill" });
      fill.style.width = `${pct}%`;
      track.appendChild(fill);
      block2.appendChild(track);
    } else {
      block2.appendChild(el("span", { className: "stat-value muted", text: "sin datos" }));
    }
    body.appendChild(block2);
  });
}

function renderMeta(body, pill, block) {
  // token_dias_restantes es null siempre por diseño: no se muestra.
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

    body.appendChild(statsWrap);
  });
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

      const redisStat = el("div", { className: "stat" });
      redisStat.appendChild(el("span", { className: "stat-label", text: "Redis — memoria usada" }));
      redisStat.appendChild(
        el("span", {
          className: esDato(b.redis_memoria_mb) ? "stat-value" : "stat-value muted",
          text: fmt(b.redis_memoria_mb, " MB"),
        })
      );
      statsWrap.appendChild(redisStat);

      body.appendChild(statsWrap);
    },
    infraPill
  );
}

// Sub-bloque de negocio (turnos/recordatorios/pacientes): muestra su
// error_detalle si viene con status "error". Devuelve el objeto o {}.
function subBloque(container, obj) {
  const b = esObjeto(obj) ? obj : {};
  if (b.status === "error") renderErrorDetalle(container, b.error_detalle, "crit");
  return b;
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

    // --- Turnos
    const grupoTurnos = el("div", { className: "subgrupo" });
    grupoTurnos.appendChild(el("h3", { text: "Turnos" }));
    const turnos = subBloque(grupoTurnos, negocio.turnos);
    const creados = conReset
      ? [{ label: "Creados desde el reset", value: fmt(turnos.creados_total) }]
      : [
          { label: "Creados (histórico)", value: fmt(turnos.creados_total) },
          { label: "Creados (mes en curso)", value: fmt(turnos.creados_mes) },
        ];
    renderStats(grupoTurnos, [
      ...creados,
      { label: "Cancelados — bot", value: fmt(turnos.cancelados_bot), sub: "Paciente por menú." },
      {
        label: "Cancelados — GCal",
        value: fmt(turnos.cancelados_gcal_manual),
        sub: "Recepción (manual en GCal).",
      },
      {
        label: "Tasa de cancelación",
        value: fmtPct(turnos.tasa_cancelacion_pct),
        sub: "Paciente por menú + recepción; no incluye auto-cancelaciones.",
      },
    ]);
    const porTipo = Array.isArray(turnos.por_tipo) ? turnos.por_tipo : [];
    renderTablaPares(
      grupoTurnos,
      porTipo.map((t) => (esObjeto(t) ? [t.especialidad, t.cantidad] : [null, null])),
      "Especialidad",
      "Cantidad"
    );
    if (esDato(turnos.cohorte_definicion)) {
      grupoTurnos.appendChild(
        el("p", { className: "nota", text: `Cancelaciones: ${turnos.cohorte_definicion}` })
      );
    }
    body.appendChild(grupoTurnos);

    // --- Recordatorios (foto de mañana; el reset no la toca)
    const grupoRecordatorios = el("div", { className: "subgrupo" });
    grupoRecordatorios.appendChild(el("h3", { text: "Recordatorios — turnos de mañana" }));
    const recordatorios = subBloque(grupoRecordatorios, negocio.recordatorios);
    renderStats(grupoRecordatorios, [
      { label: "Turnos agendados para mañana", value: fmt(recordatorios.confirmados_manana) },
      { label: "Con recordatorio enviado", value: fmt(recordatorios.recordatorios_enviados) },
      {
        label: "Cobertura de recordatorio",
        value: fmtPct(recordatorios.tasa_exito_pct),
        sub: "Antes de las 08:00 es normal que dé 0%: el envío corre a esa hora.",
      },
    ]);
    grupoRecordatorios.appendChild(
      el("p", {
        className: "nota",
        text:
          "Foto de mañana (el reset no la afecta). Son turnos agendados, no confirmaciones del paciente; “enviado” no garantiza “entregado”.",
      })
    );
    body.appendChild(grupoRecordatorios);

    // --- Pacientes
    const grupoPacientes = el("div", { className: "subgrupo" });
    grupoPacientes.appendChild(el("h3", { text: "Pacientes" }));
    const pacientes = subBloque(grupoPacientes, negocio.pacientes);
    renderStats(
      grupoPacientes,
      conReset
        ? [{ label: "Altas desde el reset", value: fmt(pacientes.altas_total) }]
        : [
            { label: "Altas (histórico)", value: fmt(pacientes.altas_total) },
            { label: "Altas (mes en curso)", value: fmt(pacientes.altas_mes) },
          ]
    );
    body.appendChild(grupoPacientes);
  } catch (err) {
    console.error("Error renderizando negocio:", err);
    renderSinDatos(body, "sin datos (error al mostrar este bloque)");
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

  renderContrato(versionContrato(data));

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

  renderNegocio(document.getElementById("negocio-body"), data.negocio);
  renderCostos(document.getElementById("costos-body"), data.negocio);
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
