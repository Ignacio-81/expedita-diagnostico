// ---------------------------------------------------------------------------
// Configuración — editar acá, nunca poner el token acá.
// ---------------------------------------------------------------------------

// URL del webhook de WF5 en staging (repo dental-clinic-bot). Sin query params.
const WEBHOOK_URL = "https://staging.expedita.com.ar/webhook/diagnostico";

// Mock local para desarrollar sin depender de que WF5 esté desplegado.
const MOCK_URL = "../docs/mock-response.json";

// En localhost/file:// se usa el mock automáticamente — no hace falta token
// ni pegarle a staging para iterar sobre el frontend.
const USE_MOCK = ["localhost", "127.0.0.1", ""].includes(location.hostname);

const TOKEN_STORAGE_KEY = "diagToken";

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

function renderKV(container, rows) {
  clear(container);
  const list = el("div", { className: "kv-list" });
  for (const row of rows) {
    const item = el("div", { className: "kv-row" });
    item.appendChild(el("span", { className: "kv-label", text: row.label }));
    const valueEl = el("span", { className: "kv-value", text: row.value });
    if (row.warn) valueEl.classList.add("num-warn");
    item.appendChild(valueEl);
    list.appendChild(item);
  }
  container.appendChild(list);
}

function renderSinDatos(container, motivo) {
  clear(container);
  container.appendChild(
    el("p", { className: "sin-datos", text: motivo || "sin datos" })
  );
}

function setStatusPill(pillEl, status) {
  pillEl.className = "status-pill";
  const s = (status || "").toLowerCase();
  if (s === "up" || s === "ok") {
    pillEl.classList.add("status-ok");
    pillEl.textContent = "OK";
  } else if (s === "error" || s === "down") {
    pillEl.classList.add("status-error");
    pillEl.textContent = "ERROR";
  } else {
    pillEl.classList.add("status-unknown");
    pillEl.textContent = "sin datos";
  }
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
      "Últ. corrida OK",
      "Horas desde últ. corrida",
      "Último error",
    ].forEach((h) => headRow.appendChild(el("th", { text: h })));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    const workflows = Array.isArray(b.workflows) ? b.workflows : [];
    for (const wf of workflows) {
      const tr = el("tr");
      tr.appendChild(el("td", { text: fmt(wf.nombre) }));
      tr.appendChild(el("td", { text: fmtBool(wf.activo) }));
      tr.appendChild(el("td", { text: fmt(wf.ejecuciones_ok_24h) }));
      tr.appendChild(el("td", { text: fmt(wf.ejecuciones_error_24h) }));

      const tasaCell = el("td", { text: fmtPct(wf.tasa_error_pct) });
      if (esDato(wf.tasa_error_pct) && wf.tasa_error_pct > 5) {
        tasaCell.classList.add("num-warn");
      }
      tr.appendChild(tasaCell);

      const colgadasCell = el("td", { text: fmt(wf.ejecuciones_colgadas) });
      if (esDato(wf.ejecuciones_colgadas) && wf.ejecuciones_colgadas > 0) {
        colgadasCell.classList.add("num-warn");
      }
      tr.appendChild(colgadasCell);

      tr.appendChild(el("td", { text: fmtFecha(wf.ultima_corrida_ok_at) }));
      tr.appendChild(
        el("td", {
          text: esDato(wf.horas_desde_ultima_corrida)
            ? `${wf.horas_desde_ultima_corrida} h`
            : "sin datos",
        })
      );

      const errorTexto = wf.ultimo_error_mensaje
        ? `${wf.ultimo_error_mensaje} (${fmtFecha(wf.ultimo_error_at)})`
        : "—";
      tr.appendChild(el("td", { text: errorTexto }));

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);

    const resumen = el("div", { className: "resumen-linea" });
    resumen.appendChild(
      el("span", {
        text: `Tasa de error global: ${fmtPct(b.tasa_error_global_pct)}`,
      })
    );
    resumen.appendChild(
      el("span", {
        text: `Duración promedio WF1: ${fmt(b.duracion_promedio_wf1_ms, " ms")}`,
      })
    );
    body.appendChild(resumen);
  });
}

function renderDb(body, pill, block) {
  renderBloqueSalud(body, pill, block, (b) => {
    const rows = [
      { label: "Latencia", value: fmt(b.latencia_ms, " ms") },
      {
        label: "Espacio usado / límite",
        value: `${fmt(b.espacio_usado_mb, " MB")} / ${fmt(b.espacio_limite_mb, " MB")}`,
      },
      {
        label: "Turnos huérfanos",
        value: fmt(b.turnos_huerfanos),
        warn: esDato(b.turnos_huerfanos) && b.turnos_huerfanos > 0,
      },
    ];
    renderKV(body, rows);
  });
}

function renderMeta(body, pill, block) {
  renderBloqueSalud(body, pill, block, (b) => {
    const rows = [
      { label: "Quality rating", value: fmt(b.quality_rating) },
      { label: "Webhooks OK", value: fmtBool(b.webhooks_ok) },
      { label: "Token — días restantes", value: fmt(b.token_dias_restantes) },
    ];
    renderKV(body, rows);
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
      const rows = [
        { label: "Túnel", value: fmt(b.tunnel_status) },
        { label: "Redis — memoria", value: fmt(b.redis_memoria_mb, " MB") },
      ];
      renderKV(body, rows);
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

    const turnos = negocio.turnos || {};
    const grupoTurnos = el("div", { className: "subgrupo" });
    grupoTurnos.appendChild(el("h3", { text: "Turnos" }));
    renderKV(grupoTurnos, [
      { label: "Creados (total)", value: fmt(turnos.creados_total) },
      { label: "Creados (mes)", value: fmt(turnos.creados_mes) },
      { label: "Cancelados por bot", value: fmt(turnos.cancelados_bot) },
      {
        label: "Cancelados GCal manual",
        value: fmt(turnos.cancelados_gcal_manual),
      },
      { label: "Tasa de cancelación", value: fmtPct(turnos.tasa_cancelacion_pct) },
    ]);
    if (Array.isArray(turnos.por_tipo) && turnos.por_tipo.length > 0) {
      const tabla = el("table", { className: "tabla-simple" });
      const thead = el("thead");
      const headRow = el("tr");
      headRow.appendChild(el("th", { text: "Especialidad" }));
      headRow.appendChild(el("th", { text: "Cantidad" }));
      thead.appendChild(headRow);
      tabla.appendChild(thead);
      const tbody = el("tbody");
      for (const item of turnos.por_tipo) {
        const tr = el("tr");
        tr.appendChild(el("td", { text: fmt(item.especialidad) }));
        tr.appendChild(el("td", { text: fmt(item.cantidad) }));
        tbody.appendChild(tr);
      }
      tabla.appendChild(tbody);
      grupoTurnos.appendChild(tabla);
    }
    body.appendChild(grupoTurnos);

    const recordatorios = negocio.recordatorios || {};
    const grupoRecordatorios = el("div", { className: "subgrupo" });
    grupoRecordatorios.appendChild(el("h3", { text: "Recordatorios" }));
    renderKV(grupoRecordatorios, [
      { label: "Confirmados mañana", value: fmt(recordatorios.confirmados_manana) },
      { label: "Enviados", value: fmt(recordatorios.recordatorios_enviados) },
      { label: "Tasa de éxito", value: fmtPct(recordatorios.tasa_exito_pct) },
    ]);
    body.appendChild(grupoRecordatorios);

    const pacientes = negocio.pacientes || {};
    const grupoPacientes = el("div", { className: "subgrupo" });
    grupoPacientes.appendChild(el("h3", { text: "Pacientes" }));
    renderKV(grupoPacientes, [
      { label: "Altas (total)", value: fmt(pacientes.altas_total) },
      { label: "Altas (mes)", value: fmt(pacientes.altas_mes) },
    ]);
    body.appendChild(grupoPacientes);

    const validacion = negocio.validacion_telefono || {};
    const grupoValidacion = el("div", { className: "subgrupo" });
    grupoValidacion.appendChild(el("h3", { text: "Validación de teléfono" }));
    renderKV(grupoValidacion, [
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
    const rows = [
      { label: "Meta — estimado", value: fmtArs(costos.meta_estimado_ars) },
      { label: "Meta — medido", value: fmtArs(costos.meta_medido_ars) },
      { label: "Groq — estimado", value: fmtUsd(costos.groq_estimado_usd) },
    ];
    renderKV(body, rows);
    if (costos.nota) {
      body.appendChild(el("p", { className: "nota", text: costos.nota }));
    }
  } catch (err) {
    console.error("Error renderizando costos:", err);
    renderSinDatos(body, "sin datos");
  }
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

async function obtenerDiagnostico() {
  if (USE_MOCK) {
    const res = await fetch(MOCK_URL);
    if (!res.ok) {
      throw new Error(`No se pudo leer el mock (HTTP ${res.status})`);
    }
    return res.json();
  }

  let token = getTokenGuardado() || pedirToken();
  if (!token) {
    throw new Error("Se necesita el token de diagnóstico para continuar.");
  }

  let res = await fetch(WEBHOOK_URL, {
    headers: { "X-Diag-Token": token },
  });

  if (res.status === 401 || res.status === 403) {
    limpiarToken();
    token = pedirToken();
    if (!token) {
      throw new Error("Se necesita el token de diagnóstico para continuar.");
    }
    res = await fetch(WEBHOOK_URL, {
      headers: { "X-Diag-Token": token },
    });
  }

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

document.getElementById("btn-actualizar").addEventListener("click", actualizar);
actualizar();
