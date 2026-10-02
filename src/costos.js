// ---------------------------------------------------------------------------
// Página 2 — "Costos y mensajes" (costos.html).
//
// Se carga ANTES de app.js: solo declara funciones; los helpers (el, fmt,
// fmtArs, renderStats, setPill, ...) viven en app.js y se resuelven al
// llamarlas. Reglas heredadas del panel:
//   - null/ausente => "sin datos" (nunca "NaN", "undefined" ni "$ 0").
//     0 es un dato medido y se muestra como 0.
//   - Todo campo del contrato 4.0 posterior al 2026-10-02 es OPCIONAL: un
//     payload de un ambiente no actualizado (Develop/Test) renderiza igual.
//   - DOM con createElement/textContent, nunca innerHTML con datos.
// ---------------------------------------------------------------------------

// Mismo orden/colores que `barra-c*` (ver styles.css). Etiqueta + ayuda en
// lenguaje llano; "service"/"utility"... son los nombres de Meta.
const CATEGORIAS_INFO = {
  service: "Respuestas del bot dentro de la ventana de 24 h. Cupo gratuito de 1.000 por mes.",
  utility: "Plantillas transaccionales (p. ej. recordatorios). Enviadas fuera de la ventana se cobran.",
  marketing: "Plantillas promocionales.",
  authentication: "Códigos de verificación.",
};

// Contrato de costos con los defaults seguros: un objeto vacío si falta.
function costosDe(negocio) {
  return esObjeto(negocio) && esObjeto(negocio.costos) ? negocio.costos : null;
}

// Etiqueta corta "medido" / "estimado" (texto, nunca solo color).
function tagFuente(tipo) {
  return el("span", {
    className: `tag-fuente tag-fuente-${tipo}`,
    text: tipo === "medido" ? "medido" : "estimado",
  });
}

// Stat con etiqueta + (opcional) tag de fuente al lado. `item` como renderStats
// más `fuente`: "medido" | "estimado".
function renderStatsFuente(container, items, opts) {
  const wrap = renderStats(container, items, opts);
  const nodos = wrap.querySelectorAll(".stat");
  items.forEach((item, i) => {
    if (!item.fuente || !nodos[i]) return;
    const label = nodos[i].querySelector(".stat-label");
    if (label) label.appendChild(tagFuente(item.fuente));
  });
  return wrap;
}

// "2026-10-10" => "10/10/2026" sin pasar por Date (evita el corrimiento UTC).
function fmtDiaLargo(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fmtFechaCorta(iso);
}

// El backend escribe `nota` en ASCII; si algún intermediario la dejó con "\n"
// literales se convierten en saltos reales. Nunca se trunca.
function textoNota(nota) {
  return String(nota).replace(/\\n/g, "\n");
}

// Panel desplegable accesible (<details>) con título.
function crearDetails(titulo, abierto) {
  const d = el("details", { className: "desplegable" });
  if (abierto) d.open = true;
  d.appendChild(el("summary", { text: titulo }));
  return d;
}

// ---------------------------------------------------------------------------
// Tarjeta 1 — Costos de Meta
// ---------------------------------------------------------------------------

function textoVentana(costos) {
  const desde = parseFecha(costos.medicion_desde);
  if (desde) {
    const dias = numeroONull(costos.medicion_dias);
    return `Midiendo desde ${fmtFechaCorta(costos.medicion_desde)}` +
      (dias !== null ? ` (${plural(dias, "día", "días")})` : "");
  }
  // Sin mensajes medidos todavía: se cae al ancla (reset o mes calendario).
  return fmtAncla(costos.reset_desde, "Mes calendario en curso (sin reset)");
}

function avisosVentana(costos) {
  const avisos = [];
  const dias = numeroONull(costos.medicion_dias);
  if (costos.medicion_mes_completo === false) {
    avisos.push("Ventana parcial: la medición no cubre un mes completo, así que los totales son de una parte del mes.");
  } else if (costos.medicion_mes_completo === null || !("medicion_mes_completo" in costos)) {
    if (esDato(costos.reset_desde)) {
      avisos.push("Ventana definida por un reset: los totales cuentan solo desde ese punto, no un mes calendario.");
    }
  }
  if (dias !== null && dias < 7) {
    avisos.push("Hay menos de 7 días de medición: los estimados y proyecciones pueden no estar disponibles.");
  }
  return avisos;
}

function renderCostosMeta(body, costos) {
  clear(body);

  body.appendChild(el("p", { className: "periodo-info", text: textoVentana(costos) }));
  // Ancla del reset como contexto (null => mes calendario en curso).
  body.appendChild(
    el("p", {
      className: "periodo-sub",
      text: esDato(costos.reset_desde)
        ? `Punto de partida (reset): ${fmtFechaCorta(costos.reset_desde)}`
        : "Sin reset: se mide el mes calendario en curso.",
    })
  );
  for (const aviso of avisosVentana(costos)) {
    renderErrorDetalle(body, aviso, "warn");
  }
  if (costos.medicion_status === "error") {
    renderErrorDetalle(body, costos.medicion_error_detalle, "crit");
  }
  if (costos.pricing_per_message_vigente === false) {
    renderErrorDetalle(
      body,
      "El backend indica que el cobro por mensaje no está vigente en esta medición: los valores pueden no reflejar las reglas nuevas.",
      "warn"
    );
  }

  // --- Dato principal: lo que Meta cobró. `meta_proyectado_per_message_ars`
  // está DEPRECADO (publica lo mismo): solo fallback si falta el medido.
  let medido = costos.meta_medido_ars;
  let subMedido = "Costo real de los mensajes cobrados por Meta (billable y entregados), con la tarifa de la fecha de cada mensaje.";
  if (numeroONull(medido) === null && numeroONull(costos.meta_proyectado_per_message_ars) !== null) {
    medido = costos.meta_proyectado_per_message_ars;
    subMedido = "Valor tomado de meta_proyectado_per_message_ars (deprecado): el backend no publicó meta_medido_ars.";
  }
  const hayMedido = numeroONull(medido) !== null;
  renderStatsFuente(
    body,
    [
      {
        label: "Medido: lo que Meta cobró",
        value: fmtArs(medido),
        tone: hayMedido ? undefined : "muted",
        sub: subMedido,
        fuente: "medido",
      },
    ],
    { singleColumn: true, className: "stats-destacadas" }
  );

  // --- Proyección del mes (principal) y lineal (secundaria).
  const calendario = costos.meta_proyeccion_mes_calendario_ars;
  const hayCalendario = numeroONull(calendario) !== null;
  const lineal = costos.meta_medido_proyeccion_mes_ars;
  const proyecciones = el("div", { className: "subgrupo" });
  proyecciones.appendChild(el("h3", { text: "Proyección del mes" }));
  renderStatsFuente(
    proyecciones,
    [
      {
        label: "Proyección del mes en curso",
        value: fmtArs(calendario),
        tone: hayCalendario ? undefined : "muted",
        sub: hayCalendario
          ? "Lo cobrado hasta hoy + el ritmo de los últimos 30 días hasta fin de mes, aplicando el cupo."
          : "Sin datos suficientes para proyectar el mes.",
        fuente: "estimado",
      },
      {
        label: "Proyección lineal de la ventana",
        value: fmtArs(lineal),
        tone: "muted",
        small: true,
        sub: "Referencia secundaria: extrapola la ventana medida y subestima si el cupo se agota dentro del mes.",
        fuente: "estimado",
      },
    ],
    { singleColumn: true }
  );
  body.appendChild(proyecciones);

  // --- Estimado mensual de régimen + badge de fuente.
  body.appendChild(renderEstimadoRegimen(costos));

  // --- Groq: siempre estimado.
  const groq = el("div", { className: "subgrupo" });
  renderStatsFuente(
    groq,
    [
      {
        label: "Groq — estimado (hoy free tier)",
        value: fmtUsd(costos.groq_estimado_usd),
        tone: numeroONull(costos.groq_estimado_usd) !== null ? undefined : "muted",
        small: true,
        sub: "Siempre estimado: los tokens de Groq no se miden.",
        fuente: "estimado",
      },
    ],
    { singleColumn: true }
  );
  body.appendChild(groq);
}

const FUENTE_ESTIMADO = {
  medido: {
    label: "MEDIDO",
    ayuda: "Calculado con datos reales: hay al menos 14 días y 20 turnos desde el 1/10.",
  },
  supuesto: {
    label: "SUPUESTO",
    ayuda: "NO medido: asume 1 mensaje utility por turno y el número de mensajes service por turno que indica el backend.",
  },
};

function renderEstimadoRegimen(costos) {
  const grupo = el("div", { className: "subgrupo" });
  grupo.appendChild(el("h3", { text: "Estimado mensual" }));

  const conFuente = "meta_estimado_fuente" in costos;
  const fuente = esDato(costos.meta_estimado_fuente) ? String(costos.meta_estimado_fuente).toLowerCase() : null;
  const hayEstimado = numeroONull(costos.meta_estimado_ars) !== null;

  const stat = el("div", { className: "stat" });
  const label = el("span", {
    className: "stat-label",
    text: conFuente ? "Estimado mensual de régimen" : "Estimado mensual (backend sin actualizar)",
  });
  stat.appendChild(label);
  const fila = el("span", { className: "stat-fila" });
  fila.appendChild(
    el("span", {
      className: `stat-value small${hayEstimado ? "" : " muted"}`,
      text: hayEstimado
        ? fmtArs(costos.meta_estimado_ars)
        : "sin datos suficientes (<7 días desde el reset)",
    })
  );
  // Badge de fuente: texto + ícono + tooltip (y la explicación visible abajo).
  if (hayEstimado && fuente) {
    const info = FUENTE_ESTIMADO[fuente];
    const tone = fuente === "medido" ? "good" : "warn";
    const badge = el("span", { className: `pill pill-${tone} pill-chico` });
    badge.appendChild(buildIcon(tone));
    badge.appendChild(document.createTextNode(info ? info.label : fuente.toUpperCase()));
    badge.title = info ? info.ayuda : "Fuente del estimado informada por el backend.";
    fila.appendChild(badge);
  }
  stat.appendChild(fila);

  if (hayEstimado && fuente) {
    const info = FUENTE_ESTIMADO[fuente];
    let ayuda = info ? info.ayuda : `Fuente informada por el backend: ${fuente}.`;
    if (fuente === "supuesto" && numeroONull(costos.meta_estimado_service_por_turno) !== null) {
      ayuda = `NO medido: asume 1 mensaje utility por turno + ${fmtNum(costos.meta_estimado_service_por_turno, 1)} mensajes service por turno.`;
    }
    stat.appendChild(el("span", { className: "stat-sub", text: ayuda }));
  } else if (hayEstimado && !conFuente) {
    stat.appendChild(
      el("span", {
        className: "stat-sub",
        text: "Este backend no publica meta_estimado_fuente: el valor puede venir de la fórmula anterior (turnos × 1 mensaje utility).",
      })
    );
  } else if (hayEstimado) {
    stat.appendChild(el("span", { className: "stat-sub", text: "El backend no informó la fuente del estimado." }));
  }
  label.appendChild(tagFuente("estimado"));
  const wrap = el("div", { className: "stats stats-1col" });
  wrap.appendChild(stat);
  grupo.appendChild(wrap);

  // Costo por turno (promedio derivado; con cupo depende del volumen).
  renderStats(
    grupo,
    [
      {
        label: "Costo por turno",
        value: fmtArs(costos.meta_estimado_costo_por_turno_ars, 2),
        tone: numeroONull(costos.meta_estimado_costo_por_turno_ars) !== null ? undefined : "muted",
        small: true,
        sub: "Promedio derivado: con el cupo gratuito, depende del volumen de turnos.",
      },
    ],
    { singleColumn: true, className: "stats-gap" }
  );

  // Muestra usada (secundaria, colapsable).
  const m = costos.meta_estimado_muestra;
  if (esObjeto(m)) {
    const d = crearDetails("Muestra usada para el estimado", false);
    renderTablaPares(
      d,
      [
        ["Desde", esDato(m.desde) ? fmtDiaLargo(m.desde) : null],
        ["Días", numeroONull(m.dias) !== null ? fmtNum(m.dias) : null],
        ["Turnos", numeroONull(m.turnos) !== null ? fmtNum(m.turnos) : null],
        ["Mensajes cobrados", numeroONull(m.mensajes_cobrados) !== null ? fmtNum(m.mensajes_cobrados) : null],
        ["Service entregados", numeroONull(m.service_entregados) !== null ? fmtNum(m.service_entregados) : null],
      ],
      "Dato",
      "Valor"
    );
    grupo.appendChild(d);
  } else if (conFuente && hayEstimado) {
    grupo.appendChild(el("p", { className: "sin-datos", text: "Muestra usada: sin datos" }));
  }
  return grupo;
}

// ---------------------------------------------------------------------------
// Tarjeta 2 — Cupo gratuito de service
// ---------------------------------------------------------------------------

function estadoCupo(c) {
  const consumidos = numeroONull(c.consumidos_mes);
  const cupo = numeroONull(c.cupo_mes);
  if (c.agotado_observado === true) {
    return {
      tone: "crit",
      pill: "AGOTADO",
      texto: "Agotado: desde ahora los service se cobran.",
    };
  }
  if (consumidos !== null && cupo !== null && consumidos >= cupo) {
    return {
      tone: "warn",
      pill: "CUPO ALCANZADO",
      texto: "El conteo del panel ya alcanzó el cupo, pero Meta todavía no cobró ningún service: puede estar por empezar a cobrar.",
    };
  }
  if (c.se_agota_este_mes === true) {
    const fecha = esDato(c.fecha_agotamiento_estimada) ? fmtDiaLargo(c.fecha_agotamiento_estimada) : "fecha sin datos";
    return {
      tone: "warn",
      pill: "SE AGOTA ESTE MES",
      texto: `Se agota este mes (estimado: ${fecha}).`,
    };
  }
  if (c.se_agota_este_mes === false) {
    return { tone: "good", pill: "NORMAL", texto: "Normal: al ritmo actual el cupo alcanza hasta fin de mes (estimado)." };
  }
  return {
    tone: "unk",
    pill: "SIN ESTIMACIÓN",
    texto: "Sin estimación de agotamiento: hacen falta al menos 7 días de datos.",
  };
}

function medidorCupo(consumidos, cupo, tone) {
  const wrap = el("div", { className: "cupo-medidor" });
  const pct = cupo > 0 ? (consumidos / cupo) * 100 : 0;
  const track = el("div", { className: "meter-track meter-grande" });
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(cupo));
  track.setAttribute("aria-valuenow", String(Math.min(consumidos, cupo)));
  track.setAttribute("aria-valuetext", `${fmtNum(consumidos)} de ${fmtNum(cupo)} mensajes service`);
  const fill = el("div", {
    className: `meter-fill${tone === "crit" ? " meter-crit" : tone === "warn" ? " meter-warn" : ""}`,
  });
  fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  track.appendChild(fill);
  wrap.appendChild(track);
  wrap.appendChild(
    el("p", {
      className: "cupo-medidor-txt",
      text: `${fmtNum(consumidos)} / ${fmtNum(cupo)} service consumidos este mes (${fmtNum(pct, 1)}%)`,
    })
  );
  return wrap;
}

function renderCupo(body, pill, costos) {
  clear(body);
  const c = costos && esObjeto(costos.cupo_service) ? costos.cupo_service : null;

  if (!c) {
    setPill(pill, "unk", "NO DISPONIBLE");
    const motivo =
      costos && "cupo_service" in costos
        ? "No disponible: el backend no pudo calcular el cupo (zona horaria inválida o falló la consulta)."
        : "No disponible: este backend todavía no publica el bloque cupo_service.";
    body.appendChild(el("p", { className: "sin-datos", text: motivo }));
    body.appendChild(notasCupo(null));
    return;
  }

  const estado = estadoCupo(c);
  setPill(pill, estado.tone, estado.pill);

  const cupo = numeroONull(c.cupo_mes);
  const consumidos = numeroONull(c.consumidos_mes);

  const cab = el("p", { className: `cupo-estado cupo-estado-${estado.tone}` });
  cab.appendChild(buildIcon(estado.tone));
  cab.appendChild(document.createTextNode(estado.texto));
  body.appendChild(cab);

  if (consumidos !== null && cupo !== null && cupo > 0) {
    body.appendChild(medidorCupo(consumidos, cupo, estado.tone));
  } else {
    body.appendChild(el("p", { className: "sin-datos", text: "Consumo del cupo: sin datos" }));
  }

  const restantes = numeroONull(c.restantes);
  const ritmo = numeroONull(c.ritmo_diario);
  const base = numeroONull(c.ritmo_dias_base);
  renderStatsFuente(body, [
    {
      label: "Consumidos este mes",
      value: fmtNum(c.consumidos_mes),
      tone: consumidos !== null ? undefined : "muted",
      fuente: "medido",
      small: true,
    },
    {
      label: "Restantes",
      value: fmtNum(c.restantes),
      tone: restantes !== null ? undefined : "muted",
      sub: c.agotado_observado === true ? "Meta ya cobró al menos un service este mes." : undefined,
      fuente: "medido",
      small: true,
    },
    {
      label: "Ritmo diario",
      value: ritmo !== null ? `${fmtNum(ritmo, 1)} /día` : "sin datos",
      tone: ritmo !== null ? undefined : "muted",
      sub: base !== null ? `Base: últimos ${plural(base, "día", "días")}.` : undefined,
      fuente: "estimado",
      small: true,
    },
    {
      label: "Agotamiento estimado",
      value: c.agotado_observado === true
        ? "ya agotado"
        : esDato(c.fecha_agotamiento_estimada)
          ? fmtDiaLargo(c.fecha_agotamiento_estimada)
          : c.se_agota_este_mes === false
            ? "no se agota este mes"
            : "sin datos",
      tone: c.agotado_observado === true || esDato(c.fecha_agotamiento_estimada) ? "warn" : "muted",
      sub: c.se_agota_este_mes === null || !("se_agota_este_mes" in c) ? "Sin estimación todavía." : undefined,
      fuente: "estimado",
      small: true,
    },
  ], { className: "stats-cupo" });

  // Mes + zona horaria (CONFIGURADA, no verificada).
  const meta = [];
  if (esDato(c.mes)) meta.push(`Mes: ${c.mes}`);
  if (esDato(c.zona_horaria)) meta.push(`Zona horaria configurada: ${c.zona_horaria}`);
  if (esDato(c.agotado_observado_at)) meta.push(`Agotado observado: ${fmtFechaCorta(c.agotado_observado_at)}`);
  if (meta.length) body.appendChild(el("p", { className: "periodo-sub", text: meta.join(" · ") }));

  body.appendChild(notasCupo(c));
}

function notasCupo(c) {
  const ul = el("ul", { className: "notas-lista" });
  const zona = c && esDato(c.zona_horaria) ? ` (${c.zona_horaria})` : "";
  ul.appendChild(
    el("li", {
      text:
        `La zona horaria mostrada${zona} es la CONFIGURADA y puede no coincidir con la de la cuenta de Meta (no verificada). ` +
        "El mes del cupo empieza el día 1 a las 00:00 en la zona de la cuenta de Meta.",
    })
  );
  ul.appendChild(
    el("li", {
      text:
        "El panel cuenta solo los mensajes que manda el bot: si se responde por otra vía, el consumo real del cupo es mayor.",
    })
  );
  const warn = el("li", { className: "nota-importante" });
  warn.appendChild(el("strong", { text: "Sin método de pago en la cuenta de Meta, " }));
  warn.appendChild(document.createTextNode("al agotarse el cupo Meta deja de entregar las respuestas del bot."));
  ul.appendChild(warn);
  const cont = el("div", { className: "nota" });
  cont.appendChild(ul);
  return cont;
}

// ---------------------------------------------------------------------------
// Tarjeta 3 — Estadística de mensajes
// ---------------------------------------------------------------------------

// Una barra horizontal por categoría (siempre las 4, 0 incluido). El valor va
// en texto: la barra es solo apoyo visual.
function renderCategorias(container, costos) {
  const porCat = esObjeto(costos.mensajes_por_categoria) ? costos.mensajes_por_categoria : {};
  const valores = CATEGORIAS_MENSAJE.map((k) => numeroONull(porCat[k]));
  const suma = valores.reduce((acc, v) => acc + (v === null ? 0 : v), 0);
  const total = numeroONull(costos.mensajes_medidos);
  const base = Math.max(suma, total === null ? 0 : total, 1);

  const lista = el("ul", { className: "categorias" });
  CATEGORIAS_MENSAJE.forEach((k, i) => {
    const v = valores[i];
    const li = el("li", { className: "categoria" });
    const cab = el("div", { className: "categoria-cab" });
    cab.appendChild(el("span", { className: `barra-clave barra-c${i + 1}` }));
    cab.appendChild(el("span", { className: "categoria-nombre", text: k }));
    const pct = v !== null ? (v / base) * 100 : null;
    cab.appendChild(
      el("span", {
        className: `categoria-valor${v === null ? " muted" : ""}`,
        text: v === null ? "sin datos" : `${fmtNum(v)}${total ? ` (${fmtNum(pct, 1)}%)` : ""}`,
      })
    );
    li.appendChild(cab);
    const track = el("div", { className: "categoria-track" });
    if (v !== null && v > 0) {
      const fill = el("div", { className: `categoria-fill barra-c${i + 1}` });
      fill.style.width = `${Math.min(100, pct)}%`;
      track.appendChild(fill);
    }
    li.appendChild(track);
    li.appendChild(el("span", { className: "categoria-ayuda", text: CATEGORIAS_INFO[k] }));
    lista.appendChild(li);
  });
  container.appendChild(lista);
}

// Mini-tabla de 7 días: mensajes facturables (con barra) + turnos creados +
// recordatorios enviados. El día `parcial: true` se marca con texto.
function renderSerie7d(container, negocio) {
  const dias = esObjeto(negocio) && Array.isArray(negocio.tendencia_7d) ? negocio.tendencia_7d : null;
  const grupo = el("div", { className: "subgrupo" });
  grupo.appendChild(el("h3", { text: "Últimos 7 días" }));
  container.appendChild(grupo);
  if (!dias || dias.length === 0) {
    grupo.appendChild(el("p", { className: "sin-datos", text: "sin datos (este backend no publica tendencia_7d)" }));
    return;
  }
  const filas = dias.map((d) => (esObjeto(d) ? d : {}));
  const hayFacturables = filas.some((d) => "mensajes_facturables" in d);
  const max = Math.max(1, ...filas.map((d) => numeroONull(d.mensajes_facturables) || 0));

  const wrap = el("div", { className: "tabla-simple table-wrap" });
  const tabla = el("table", { className: "tabla-7d" });
  const thead = el("thead");
  const hr = el("tr");
  ["Día", "Mensajes facturables", "Turnos creados", "Recordatorios enviados"].forEach((h) =>
    hr.appendChild(el("th", { text: h }))
  );
  thead.appendChild(hr);
  tabla.appendChild(thead);
  const tbody = el("tbody");
  for (const d of filas) {
    const parcial = d.parcial === true;
    const tr = el("tr", { className: parcial ? "fila-parcial" : "" });
    const tdDia = el("td", { text: fmtDia(d.fecha) });
    if (parcial) tdDia.appendChild(el("span", { className: "tag-parcial", text: "parcial (en curso)" }));
    tr.appendChild(tdDia);

    const fact = numeroONull(d.mensajes_facturables);
    const tdFact = el("td", { className: "celda-barra" });
    tdFact.appendChild(el("span", { className: "celda-barra-num", text: fmtNum(d.mensajes_facturables) }));
    if (fact !== null && fact > 0) {
      const bar = el("span", { className: `celda-barra-fill${parcial ? " celda-barra-parcial" : ""}` });
      bar.style.width = `${Math.min(100, (fact / max) * 100)}%`;
      tdFact.appendChild(bar);
    }
    tr.appendChild(tdFact);
    tr.appendChild(el("td", { text: fmtNum(d.turnos_creados) }));
    tr.appendChild(el("td", { text: fmtNum(d.recordatorios_enviados) }));
    tbody.appendChild(tr);
  }
  tabla.appendChild(tbody);
  wrap.appendChild(tabla);
  grupo.appendChild(wrap);
  if (!hayFacturables) {
    grupo.appendChild(el("p", { className: "nota", text: "Este backend todavía no publica mensajes_facturables por día." }));
  }
  if (filas.some((d) => d.parcial === true)) {
    grupo.appendChild(
      el("p", { className: "nota", text: "El día marcado como parcial es el día en curso: sus valores todavía pueden crecer." })
    );
  }
}

function renderMensajes(body, negocio, salud) {
  clear(body);
  const costos = costosDe(negocio);

  const grupoTotales = el("div", { className: "subgrupo" });
  grupoTotales.appendChild(el("h3", { text: "Mensajes medidos en la ventana" }));
  if (costos) {
    const total = numeroONull(costos.mensajes_medidos);
    renderStats(grupoTotales, [
      { label: "Total en la ventana", value: fmtNum(costos.mensajes_medidos), tone: total !== null ? undefined : "muted" },
    ]);
    renderCategorias(grupoTotales, costos);
  } else {
    grupoTotales.appendChild(el("p", { className: "sin-datos", text: "sin datos" }));
  }
  body.appendChild(grupoTotales);

  // Mensajes de pacientes procesados en 24 h (salud.n8n.trafico_wf1).
  const n8n = esObjeto(salud) && esObjeto(salud.n8n) ? salud.n8n : null;
  const t = n8n && esObjeto(n8n.trafico_wf1) ? n8n.trafico_wf1 : null;
  const grupoTrafico = el("div", { className: "subgrupo" });
  grupoTrafico.appendChild(el("h3", { text: "Mensajes de pacientes (24 h)" }));
  if (t) {
    renderStats(grupoTrafico, [
      {
        label: "Procesados en 24 h",
        value: fmtNum(t.mensajes_procesados_24h),
        tone: numeroONull(t.mensajes_procesados_24h) !== null ? undefined : "muted",
        sub: "Mensajes que escribieron los pacientes (no los que envía el bot).",
      },
    ]);
    const detalle = [t.fuente, t.nota].filter(esDato).join(" — ");
    if (detalle) grupoTrafico.appendChild(el("p", { className: "nota", text: detalle }));
  } else {
    grupoTrafico.appendChild(el("p", { className: "sin-datos", text: "sin datos (este backend no publica trafico_wf1)" }));
  }
  body.appendChild(grupoTrafico);

  renderSerie7d(body, negocio);
}

// ---------------------------------------------------------------------------
// Tarjeta 4 — Cómo se calcula
// ---------------------------------------------------------------------------

const RESUMEN_REGLAS = [
  "Desde el 1/10/2026 Meta cobra por mensaje entregado, y solo lo que llega con billable=true.",
  "Los mensajes service (las respuestas del bot dentro de la ventana de 24 h) tienen un cupo gratuito de 1.000 por mes y por número de teléfono. El mes empieza el día 1 a las 00:00 en la zona horaria de la cuenta de Meta y el cupo no se acumula. Desde el 1.001 se cobran; dentro del cupo llegan como billable=false.",
  "La mayoría de los mensajes del bot son service y hoy salen gratis por el cupo: por eso el costo medido es bajo.",
  "Los mensajes utility enviados dentro de la ventana pueden llegar gratis; los enviados fuera de la ventana (recordatorios) se cobran.",
  "«Medido: lo que Meta cobró» es el costo real de los mensajes cobrados y entregados, con la tarifa vigente en la fecha de cada mensaje. Es el dato principal y confiable.",
  "«Proyección del mes en curso» suma lo cobrado hasta hoy más el ritmo de los últimos 30 días hasta fin de mes, aplicando el cupo. La «proyección lineal de la ventana» solo extrapola lo medido y subestima si el cupo se agota dentro del mes.",
  "«Estimado mensual de régimen» = 30 × turnos/día × costo por turno de los mensajes utility/authentication/marketing + tarifa de service × lo que supere el cupo (30 × turnos/día × service por turno − 1.000, nunca menos de 0). Fuente «medido»: calculado con datos reales (al menos 14 días y 20 turnos desde el 1/10). Fuente «supuesto»: 1 utility por turno y el service por turno indicado, sin medir.",
  "Groq siempre es un estimado: los tokens no se miden.",
];

const NO_VERIFICADO = [
  "Si las utility enviadas dentro de la ventana se cobran desde el 1/10.",
  "La tarifa de service después del cupo: se asume la de utility.",
  "La zona horaria de la cuenta de Meta: el panel usa la configurada.",
];

function renderCalculo(body, costos) {
  clear(body);

  const resumen = crearDetails("Reglas de Meta en lenguaje llano", false);
  const ul = el("ul", { className: "notas-lista" });
  for (const r of RESUMEN_REGLAS) ul.appendChild(el("li", { text: r }));
  resumen.appendChild(ul);
  resumen.appendChild(el("h4", { className: "subtitulo", text: "No verificado" }));
  const ul2 = el("ul", { className: "notas-lista" });
  for (const r of NO_VERIFICADO) ul2.appendChild(el("li", { text: r }));
  resumen.appendChild(ul2);
  body.appendChild(resumen);

  const nota = costos && esDato(costos.nota) && String(costos.nota).trim() !== "" ? textoNota(costos.nota) : null;
  const detalleNota = crearDetails("Nota del backend (costos.nota)", false);
  if (nota) {
    detalleNota.appendChild(el("pre", { className: "nota-backend", text: nota }));
  } else {
    detalleNota.appendChild(el("p", { className: "sin-datos", text: "sin datos (el backend no publicó costos.nota)" }));
  }
  body.appendChild(detalleNota);
}

// ---------------------------------------------------------------------------
// Entrada de la página: cada tarjeta va aislada — una rota no tira las demás.
// ---------------------------------------------------------------------------

function renderTarjeta(nombre, bodyId, fn) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  try {
    fn(body);
  } catch (err) {
    console.error(`Error renderizando ${nombre}:`, err);
    renderSinDatos(body, "sin datos (error al mostrar este bloque)");
  }
}

function renderCostosPagina(negocio, salud) {
  const costos = costosDe(negocio);

  renderTarjeta("Costos de Meta", "costos-body", (body) => {
    if (!costos) return renderSinDatos(body, "sin datos");
    renderCostosMeta(body, costos);
  });

  const pillCupo = document.getElementById("cupo-status");
  renderTarjeta("Cupo de service", "cupo-body", (body) => renderCupo(body, pillCupo, costos));
  // Si el render del cupo falló antes de fijar el pill, queda gris.
  if (pillCupo && pillCupo.textContent.trim() === "—") setPill(pillCupo, "unk");

  renderTarjeta("Mensajes", "mensajes-body", (body) => renderMensajes(body, negocio, salud));
  renderTarjeta("Cómo se calcula", "calculo-body", (body) => renderCalculo(body, costos));
}
