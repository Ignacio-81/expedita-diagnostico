#!/usr/bin/env python3
"""Genera las variantes de fixtures a partir de diagnostico-staging.json.

Uso (desde la raíz del repo): python3 fixtures/generar-variantes.py

diagnostico-staging.json es la fuente de verdad (se edita a mano). Las demás
variantes difieren solo en `negocio.costos` (y `salud.n8n.trafico_wf1` en la
variante vieja). No contiene tokens ni datos personales.
"""
import copy
import json
import os

AQUI = os.path.dirname(os.path.abspath(__file__))


def cargar():
    with open(os.path.join(AQUI, "diagnostico-staging.json"), encoding="utf-8") as f:
        return json.load(f)


def guardar(nombre, data):
    with open(os.path.join(AQUI, nombre), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


base = cargar()

# (a) Cupo agotado: Meta ya cobró al menos un service este mes.
a = copy.deepcopy(base)
c = a["negocio"]["costos"]
c["cupo_service"].update(
    consumidos_mes=1025,
    restantes=0,
    agotado_observado=True,
    agotado_observado_at="2026-10-02T09:41:17.000-03:00",
    ritmo_diario=64.1,
    se_agota_este_mes=True,
    fecha_agotamiento_estimada="2026-10-02",
)
c["mensajes_medidos"] = 1090
c["mensajes_por_categoria"] = {"service": 1025, "utility": 65, "marketing": 0, "authentication": 0}
c["meta_medido_ars"] = 1130
c["meta_proyectado_per_message_ars"] = 1130
c["meta_medido_proyeccion_mes_ars"] = 2261
c["meta_proyeccion_mes_calendario_ars"] = 2261
c["meta_estimado_muestra"]["service_entregados"] = 1025
guardar("diagnostico-cupo-agotado.json", a)

# (b) Se agota este mes (estimado), todavía no agotado.
b = copy.deepcopy(base)
c = b["negocio"]["costos"]
c["cupo_service"].update(
    consumidos_mes=640,
    restantes=360,
    ritmo_diario=48.5,
    ritmo_dias_base=16,
    se_agota_este_mes=True,
    fecha_agotamiento_estimada="2026-10-10",
)
c["mensajes_medidos"] = 702
c["mensajes_por_categoria"] = {"service": 640, "utility": 62, "marketing": 0, "authentication": 0}
c["meta_proyeccion_mes_calendario_ars"] = 1480
guardar("diagnostico-cupo-se-agota.json", b)

# (c) cupo_service: null (zona inválida o falla la query).
cc = copy.deepcopy(base)
cc["negocio"]["costos"]["cupo_service"] = None
guardar("diagnostico-cupo-null.json", cc)

# (d) meta_estimado_* null (menos de 7 días desde el reset).
d = copy.deepcopy(base)
c = d["negocio"]["costos"]
c.update(
    meta_estimado_ars=None,
    meta_estimado_fuente=None,
    meta_estimado_costo_por_turno_ars=None,
    meta_estimado_service_por_turno=None,
    meta_estimado_muestra=None,
    meta_proyeccion_mes_calendario_ars=None,
    meta_medido_proyeccion_mes_ars=None,
    groq_estimado_usd=None,
    medicion_dias=3,
)
c["cupo_service"].update(ritmo_diario=None, ritmo_dias_base=3, se_agota_este_mes=None)
guardar("diagnostico-estimado-null.json", d)

# (e) Payload viejo: sin ningún campo nuevo (backend aún no actualizado).
e = copy.deepcopy(base)
c = e["negocio"]["costos"]
for k in (
    "meta_estimado_fuente",
    "meta_estimado_costo_por_turno_ars",
    "meta_estimado_service_por_turno",
    "meta_estimado_muestra",
    "meta_proyeccion_mes_calendario_ars",
    "cupo_service",
):
    c.pop(k, None)
c["meta_estimado_ars"] = 2261  # semántica vieja: turnos x 1 mensaje x utility
c["pricing_per_message_vigente"] = False
c["nota"] = (
    "meta_medido_ars: costo REAL de los mensajes capturados por categoria de pricing "
    "desde medicion_desde. meta_estimado_ars y groq_estimado_usd: proyeccion a 30 dias "
    "a partir de turnos/dia."
)
e["negocio"].pop("tendencia_7d_nota", None)
for dia in e["negocio"]["tendencia_7d"]:
    dia.pop("mensajes_facturables", None)
e["salud"]["n8n"].pop("trafico_wf1", None)
guardar("diagnostico-legacy.json", e)
print("ok")
