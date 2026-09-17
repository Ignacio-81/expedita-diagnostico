// ---------------------------------------------------------------------------
// Configuración — editar acá, nunca poner el token acá.
// ---------------------------------------------------------------------------

// URL del webhook de WF5 en staging (repo dental-clinic-bot). Sin query params.
const WEBHOOK_URL = "https://staging.expedita.com.ar/webhook/diagnostico";

// Mock local para desarrollar sin depender de que WF5 esté desplegado.
const MOCK_URL = "../docs/mock-response.json";

// En localhost/file:// se usa el mock automáticamente — no hace falta token
// ni pegarle a staging para iterar sobre el frontend. Se puede forzar el
// fetch real contra staging agregando ?real=1 a la URL, sin necesidad de
// desplegar a Pages para probar.
const FORCE_REAL = new URLSearchParams(location.search).has("real");
const USE_MOCK =
  !FORCE_REAL && ["localhost", "127.0.0.1", ""].includes(location.hostname);

const TOKEN_STORAGE_KEY = "diagToken";
const THEME_STORAGE_KEY = "diagTheme";

// Última respuesta completa del webhook — se usa para repintar un panel tras
// un reset sin necesidad de otro GET (ver resetearMedicion más abajo).
let ultimoData = null;

// ---------------------------------------------------------------------------
// Helpers de formato — regla central: null/undefined => "sin datos", nunca 0.
// ---------------------------------------------------------------------------

function esDato(v) {
  return v !== null && v !== undefined;
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

function fmtFecha(iso) {
  if (!esDato(iso)) return "sin datos";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "sin datos";
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" });
}

function fmtUltimaCorrida(at, horas) {
  if (!esDato(at)) return "sin datos";
  if (esDato(horas)) return `${fmtFecha(at)} (hace ${horas} h)`;
  return fmtFecha(at);
}

// Texto de "midiendo desde" a partir del bloque `periodo` (negocio.periodo o
// negocio.costos.periodo, con anclas independientes). null => no mostrar nada.
function fmtPeriodoDesde(periodo) {
  if (!periodo || periodo.modo === "historico" || !esDato(periodo.desde)) {
    return null;
  }
  if (periodo.estado === "pendiente") {
    return `Empieza el ${fmtFecha(periodo.desde)}`;
  }
  let txt = `Midiendo desde ${fmtFecha(periodo.desde)}`;
  if (esDato(periodo.dias)) {
    txt += ` (${periodo.dias} día${periodo.dias === 1 ? "" : "s"})`;
  }
  return txt;
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
  const cls = "stats" + (opts && opts.singleColumn ? " stats-1col" : "");
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
}

// Tabla simple de dos columnas (usada por turnos.por_tipo, por_tipo_periodo
// y mensajes_por_categoria_periodo). No agrega nada si rows viene vacío/ausente.
function renderTablaPares(container, rows, headerA, headerB, keyA, keyB) {
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
  for (const item of rows) {
    const tr = el("tr");
    tr.appendChild(el("td", { text: fmt(item[keyA]) }));
    tr.appendChild(el("td", { text: fmt(item[keyB]) }));
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

function setStatusPill(pillEl, status) {
  const tone = statusToTone(status);
  setPill(pillEl, tone, toneLabel(tone));
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
// Render por bloque — cada uno se ejecuta aislado: si un bloque falla o
// viene con status "error"/ausente, se muestra "sin datos" en ESE bloque
// sin tirar abajo el resto de la página.
// ---------------------------------------------------------------------------

function renderBloqueSalud(bodyEl, pillEl, block, renderFn, pillStatusFn) {
  if (!block || block.status === "error") {
    setStatusPill(pillEl, block ? block.status : null);
    renderSinDatos(bodyEl, "sin datos");
    return;
  }
  try {
    const pillStatus = pillStatusFn ? pillStatusFn(block) : block.status;
    setStatusPill(pillEl, pillStatus);
    renderFn(block);
  } catch (err) {
    console.error("Error renderizando bloque de salud:", err);
    setStatusPill(pillEl, "error");
    renderSinDatos(bodyEl, "sin datos");
  }
}

function renderN8n(body, pill, block) {
  renderBloqueSalud(body, pill, block, (b) => {
    clear(body);

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
    for (const wf of workflows) {
      const tr = el("tr");
      tr.appendChild(el("td", { text: fmt(wf.nombre) }));

      const activoCell = el("td");
      activoCell.appendChild(
        el("span", { className: `dot ${wf.activo ? "dot-good" : "dot-unk"}` })
      );
      activoCell.appendChild(document.createTextNode(fmtBool(wf.activo)));
      tr.appendChild(activoCell);

      tr.appendChild(el("td", { text: fmt(wf.ejecuciones_ok_24h) }));
      tr.appendChild(el("td", { text: fmt(wf.ejecuciones_error_24h) }));

      const tasaWarn = esDato(wf.tasa_error_pct) && wf.tasa_error_pct > 5;
      tr.appendChild(
        el("td", {
          className: tasaWarn ? "cell-warn" : "",
          text: fmtPct(wf.tasa_error_pct),
        })
      );

      const colgadasWarn = esDato(wf.ejecuciones_colgadas) && wf.ejecuciones_colgadas > 0;
      tr.appendChild(
        el("td", {
          className: colgadasWarn ? "cell-warn" : "",
          text: fmt(wf.ejecuciones_colgadas),
        })
      );

      tr.appendChild(
        el("td", { text: fmtUltimaCorrida(wf.ultima_corrida_ok_at, wf.horas_desde_ultima_corrida) })
      );

      const errorTexto = wf.ultimo_error_mensaje
        ? `${wf.ultimo_error_mensaje} (${fmtFecha(wf.ultimo_error_at)})`
        : "—";
      tr.appendChild(el("td", { className: "cell-muted", text: errorTexto }));

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    body.appendChild(tableWrap);

    const resumen = el("div", { className: "resumen-linea" });
    const r1 = el("span");
    r1.appendChild(document.createTextNode("Tasa de error global: "));
    r1.appendChild(el("strong", { text: fmtPct(b.tasa_error_global_pct) }));
    resumen.appendChild(r1);
    const r2 = el("span");
    r2.appendChild(document.createTextNode("Duración promedio WF1: "));
    r2.appendChild(el("strong", { text: fmt(b.duracion_promedio_wf1_ms, " ms") }));
    resumen.appendChild(r2);
    body.appendChild(resumen);
  });
}

function renderDb(body, pill, block) {
  renderBloqueSalud(body, pill, block, (b) => {
    clear(body);

    renderStats(body, [
      { label: "Latencia", value: fmt(b.latencia_ms, " ms") },
      {
        label: "Turnos huérfanos",
        value: fmt(b.turnos_huerfanos),
        tone: esDato(b.turnos_huerfanos) && b.turnos_huerfanos > 0 ? "warn" : undefined,
      },
    ]);

    const usado = b.espacio_usado_mb;
    const limite = b.espacio_limite_mb;
    if (esDato(usado) && esDato(limite) && limite > 0) {
      const pct = Math.min(100, Math.max(0, (usado / limite) * 100));
      const block2 = el("div", { className: "stat stat-block" });
      block2.appendChild(el("span", { className: "stat-label", text: "Espacio usado" }));
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
      body.appendChild(block2);
    } else {
      const block2 = el("div", { className: "stat stat-block" });
      block2.appendChild(el("span", { className: "stat-label", text: "Espacio usado" }));
      block2.appendChild(el("span", { className: "stat-value muted", text: "Sin datos" }));
      body.appendChild(block2);
    }
  });
}

function renderMeta(body, pill, block) {
  renderBloqueSalud(body, pill, block, (b) => {
    clear(body);

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
      webhooksValue.textContent = "Sin datos";
    }
    webhooksStat.appendChild(webhooksValue);
    statsWrap.appendChild(webhooksStat);

    body.appendChild(statsWrap);

    renderStats(
      body,
      [
        {
          label: "Token — días restantes",
          value: esDato(b.token_dias_restantes) ? fmt(b.token_dias_restantes) : "Sin datos",
          tone: esDato(b.token_dias_restantes) ? undefined : "muted",
        },
      ],
      { singleColumn: true }
    );
    body.lastChild.classList.add("stat-block");
  });
}

function renderInfra(body, pill, block) {
  // Este bloque no trae "status" propio en el contrato (a diferencia de
  // n8n/db/meta) — el pill se deriva de tunnel_status.
  renderBloqueSalud(
    body,
    pill,
    block,
    (b) => {
      clear(body);
      const tunnelTone = statusToTone(b.tunnel_status);
      const statsWrap = el("div", { className: "stats" });

      const tunnelStat = el("div", { className: "stat" });
      tunnelStat.appendChild(el("span", { className: "stat-label", text: "Túnel" }));
      const tunnelValue = el("span", { className: "stat-value small" });
      tunnelValue.appendChild(
        el("span", {
          className: `dot dot-${tunnelTone === "good" ? "good" : tunnelTone === "crit" ? "crit" : "unk"}`,
        })
      );
      tunnelValue.appendChild(document.createTextNode(fmt(b.tunnel_status)));
      tunnelStat.appendChild(tunnelValue);
      statsWrap.appendChild(tunnelStat);

      const redisStat = el("div", { className: "stat" });
      redisStat.appendChild(el("span", { className: "stat-label", text: "Redis — memoria" }));
      redisStat.appendChild(el("span", { className: "stat-value", text: fmt(b.redis_memoria_mb, " MB") }));
      statsWrap.appendChild(redisStat);

      body.appendChild(statsWrap);
    },
    (b) => b.tunnel_status
  );
}

function renderNegocio(body, negocio) {
  if (!negocio) {
    renderSinDatos(body, "sin datos");
    return;
  }
  try {
    clear(body);

    const periodoTexto = fmtPeriodoDesde(negocio.periodo);
    if (periodoTexto) {
      body.appendChild(el("p", { className: "periodo-info", text: periodoTexto }));
    }

    const turnos = negocio.turnos || {};
    const grupoTurnos = el("div", { className: "subgrupo" });
    grupoTurnos.appendChild(el("h3", { text: "Turnos" }));
    renderStats(grupoTurnos, [
      { label: "Creados (total)", value: fmt(turnos.creados_total) },
      { label: "Creados (mes)", value: fmt(turnos.creados_mes) },
      { label: "Creados (período)", value: fmt(turnos.creados_periodo) },
      { label: "Cancelados — bot", value: fmt(turnos.cancelados_bot) },
      { label: "Cancelados — GCal manual", value: fmt(turnos.cancelados_gcal_manual) },
      { label: "Tasa de cancelación", value: fmtPct(turnos.tasa_cancelacion_pct) },
    ]);
    renderTablaPares(
      grupoTurnos,
      turnos.por_tipo,
      "Especialidad",
      "Cantidad",
      "especialidad",
      "cantidad"
    );
    body.appendChild(grupoTurnos);

    const grupoCohorte = el("div", { className: "subgrupo" });
    grupoCohorte.appendChild(el("h3", { text: "Cancelaciones — cohorte del período" }));
    renderStats(grupoCohorte, [
      { label: "Cancelados — bot", value: fmt(turnos.cancelados_bot_cohorte_periodo) },
      { label: "Cancelados — GCal manual", value: fmt(turnos.cancelados_gcal_manual_cohorte_periodo) },
      { label: "Tasa de cancelación", value: fmtPct(turnos.tasa_cancelacion_cohorte_periodo_pct) },
    ]);
    renderTablaPares(
      grupoCohorte,
      turnos.por_tipo_periodo,
      "Especialidad",
      "Cantidad",
      "especialidad",
      "cantidad"
    );
    if (turnos.cohorte_definicion) {
      grupoCohorte.appendChild(el("p", { className: "nota", text: turnos.cohorte_definicion }));
    }
    body.appendChild(grupoCohorte);

    const recordatorios = negocio.recordatorios || {};
    const grupoRecordatorios = el("div", { className: "subgrupo" });
    grupoRecordatorios.appendChild(el("h3", { text: "Recordatorios" }));
    renderStats(grupoRecordatorios, [
      { label: "Confirmados mañana", value: fmt(recordatorios.confirmados_manana) },
      { label: "Enviados", value: fmt(recordatorios.recordatorios_enviados) },
      { label: "Tasa de éxito", value: fmtPct(recordatorios.tasa_exito_pct) },
    ]);
    body.appendChild(grupoRecordatorios);

    const pacientes = negocio.pacientes || {};
    const grupoPacientes = el("div", { className: "subgrupo" });
    grupoPacientes.appendChild(el("h3", { text: "Pacientes" }));
    renderStats(grupoPacientes, [
      { label: "Altas (total)", value: fmt(pacientes.altas_total) },
      { label: "Altas (mes)", value: fmt(pacientes.altas_mes) },
      { label: "Altas (período)", value: fmt(pacientes.altas_periodo) },
    ]);
    body.appendChild(grupoPacientes);

    const validacion = negocio.validacion_telefono || {};
    const grupoValidacion = el("div", { className: "subgrupo" });
    grupoValidacion.appendChild(el("h3", { text: "Validación de teléfono" }));
    renderStats(grupoValidacion, [
      { label: "Rechazos 24h", value: fmt(validacion.rechazos_24h) },
    ]);
    body.appendChild(grupoValidacion);
  } catch (err) {
    console.error("Error renderizando negocio:", err);
    renderSinDatos(body, "sin datos");
  }
}

function renderCostos(body, negocio) {
  const costos = negocio && negocio.costos;
  if (!costos) {
    renderSinDatos(body, "sin datos");
    return;
  }
  try {
    clear(body);

    const periodoTexto = fmtPeriodoDesde(costos.periodo);
    if (periodoTexto) {
      body.appendChild(el("p", { className: "periodo-info", text: periodoTexto }));
    }

    renderStats(
      body,
      [
        { label: "Meta — estimado", value: fmtArs(costos.meta_estimado_ars) },
        {
          label: "Meta — medido",
          value: esDato(costos.meta_medido_ars) ? fmtArs(costos.meta_medido_ars) : "Sin datos",
          tone: esDato(costos.meta_medido_ars) ? undefined : "muted",
        },
        { label: "Groq — estimado", value: fmtUsd(costos.groq_estimado_usd) },
      ],
      { singleColumn: true }
    );
    if (costos.nota) {
      body.appendChild(el("p", { className: "nota", text: costos.nota }));
    }

    const grupoPeriodo = el("div", { className: "subgrupo" });
    grupoPeriodo.appendChild(el("h3", { text: "Período" }));
    renderStats(
      grupoPeriodo,
      [
        { label: "Mensajes medidos", value: fmt(costos.mensajes_medidos_periodo) },
        { label: "Meta — medido", value: fmtArs(costos.meta_medido_periodo_ars) },
        { label: "Meta — proyectado por mensaje", value: fmtArs(costos.meta_proyectado_per_message_periodo_ars) },
        { label: "Meta — estimado", value: fmtArs(costos.meta_estimado_periodo_ars) },
        { label: "Groq — estimado", value: fmtUsd(costos.groq_estimado_periodo_usd) },
        { label: "Medición desde", value: fmtFecha(costos.medicion_desde_periodo) },
      ],
      { singleColumn: true }
    );
    renderTablaPares(
      grupoPeriodo,
      costos.mensajes_por_categoria_periodo,
      "Categoría",
      "Cantidad",
      "categoria",
      "cantidad"
    );
    body.appendChild(grupoPeriodo);
  } catch (err) {
    console.error("Error renderizando costos:", err);
    renderSinDatos(body, "sin datos");
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
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  updateThemeToggleUI(theme);
}

function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    document.documentElement.setAttribute("data-theme", stored);
  }
  updateThemeToggleUI(getEffectiveTheme());
}

// ---------------------------------------------------------------------------
// Manejo de token — nunca hardcodeado, siempre sessionStorage. §8 de la spec.
// ---------------------------------------------------------------------------

function getTokenGuardado() {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

function pedirToken() {
  const token = window.prompt("Token de diagnóstico (X-Diag-Token):");
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
  }

  return res;
}

async function obtenerDiagnostico() {
  if (USE_MOCK) {
    const res = await fetch(MOCK_URL);
    if (!res.ok) {
      throw new Error(`No se pudo leer el mock (HTTP ${res.status})`);
    }
    return res.json();
  }

  const res = await fetchConToken(WEBHOOK_URL);
  if (!res.ok) {
    throw new Error(`El webhook respondió HTTP ${res.status}`);
  }

  return res.json();
}

function mostrarErrorGlobal(mensaje) {
  const el = document.getElementById("global-error");
  if (!mensaje) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = mensaje;
}

function render(data) {
  ultimoData = data;

  const envBadge = document.getElementById("env-badge");
  envBadge.textContent = USE_MOCK
    ? `${fmt(data.environment)} (mock local)`
    : fmt(data.environment);

  document.getElementById("ultima-actualizacion").textContent =
    `Última actualización: ${fmtFecha(data.generated_at)}`;

  const salud = data.salud || {};

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
// Reset de la ventana de medición — POST al mismo endpoint del GET. Dos
// botones independientes (Turnos/Negocio y Costos), con confirmación previa.
// Actualiza solo el ancla de fecha con lo que devuelve el POST — no hace
// falta otro GET para que el reset se note en pantalla.
// ---------------------------------------------------------------------------

const RESET_LABELS = {
  negocio: "Turnos/Negocio",
  costos: "Costos",
};

// Repinta únicamente el panel afectado con el nuevo `desde` — los campos
// _periodo (creados_periodo, etc.) quedan como estaban hasta el próximo
// "Actualizar", que es cuando el backend los recalcula sobre la ventana nueva.
function aplicarResetLocal(ambito, desde) {
  if (!ultimoData) return;
  const negocio = ultimoData.negocio || (ultimoData.negocio = {});
  const periodoNuevo = {
    modo: "desde_ancla",
    desde,
    hasta: null,
    dias: null,
    estado: "activo",
    origen: "config",
  };

  if (ambito === "negocio") {
    negocio.periodo = periodoNuevo;
    renderNegocio(document.getElementById("negocio-body"), negocio);
  } else {
    negocio.costos = negocio.costos || {};
    negocio.costos.periodo = periodoNuevo;
    renderCostos(document.getElementById("costos-body"), negocio);
  }
}

async function resetearMedicion(ambito) {
  const confirmado = window.confirm(
    `¿Resetear la medición de ${RESET_LABELS[ambito]} a partir de ahora?`
  );
  if (!confirmado) return;

  const boton = document.getElementById(`btn-reset-${ambito}`);
  boton.disabled = true;
  mostrarErrorGlobal(null);
  try {
    if (USE_MOCK) {
      // Sin backend real en modo mock local: simula el reset para poder
      // probar la UI (ver .claude/skills/diagnostico-qa/SKILL.md).
      aplicarResetLocal(ambito, new Date().toISOString());
      return;
    }

    const res = await fetchConToken(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "reset", ambito }),
    });

    if (res.status === 400) {
      const cuerpo = await res.json().catch(() => null);
      throw new Error(
        `No se pudo resetear: ${(cuerpo && cuerpo.detalle) || "solicitud inválida"}`
      );
    }
    if (res.status === 500) {
      const cuerpo = await res.json().catch(() => null);
      const detalle = cuerpo && cuerpo.detalle ? `: ${cuerpo.detalle}` : ".";
      throw new Error(`El reset falló del lado del backend, no se aplicó nada${detalle}`);
    }
    if (!res.ok) {
      throw new Error(`El webhook respondió HTTP ${res.status}`);
    }

    const cuerpo = await res.json();
    const desde =
      ambito === "negocio" ? cuerpo.medicion_negocio_desde : cuerpo.medicion_costos_desde;
    aplicarResetLocal(ambito, desde);
  } catch (err) {
    console.error("Error reseteando medición:", err);
    mostrarErrorGlobal(err.message || "No se pudo resetear la medición.");
  } finally {
    boton.disabled = false;
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
    mostrarErrorGlobal(err.message || "No se pudo obtener el diagnóstico.");
  } finally {
    boton.disabled = false;
  }
}

initTheme();
document.getElementById("btn-theme").addEventListener("click", () => {
  applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
});
document.getElementById("btn-actualizar").addEventListener("click", actualizar);
document.getElementById("btn-reset-negocio").addEventListener("click", () => resetearMedicion("negocio"));
document.getElementById("btn-reset-costos").addEventListener("click", () => resetearMedicion("costos"));
actualizar();
