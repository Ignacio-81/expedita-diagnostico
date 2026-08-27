---
name: diagnostico-qa
description: >
  Checklist de QA para expedita-diagnostico antes de dar por terminado un
  cambio en el frontend, y flujo de commit (con confirmación previa) una
  vez que pasa. Usar después de tocar src/app.js, src/index.html, o
  src/styles.css — y siempre antes de "listo, funciona". Espejo de
  expedita-qa (repo expedita-web), adaptado a un panel de una sola página.
---

# QA para expedita-diagnostico

Este es un panel de **una sola página**, no un sitio de 8 páginas con pie
legal idéntico como `expedita-web` — el QA acá no es "¿el pie sale igual en
todos lados?", es "¿el panel muestra algo útil y correcto pase lo que pase
con el backend, incluido cuando el backend falla parcial o totalmente?".

## 1. Fetch contra el mock, sin depender de WF5

`docs/mock-response.json` existe exactamente para poder desarrollar y
probar sin que WF5 esté desplegado en `staging`. Antes de dar un cambio por
terminado:

- Servir `src/` localmente (por ejemplo `python3 -m http.server` desde la
  raíz del repo) y confirmar que el panel renderiza correctamente usando
  `docs/mock-response.json` como respuesta simulada.
- Confirmar que los 6 bloques de §9 de la spec aparecen: Salud n8n (tabla
  por workflow), Base de datos, Meta/WhatsApp, Infraestructura,
  Turnos/Negocio, Costos.
- Confirmar que "Última actualización" muestra el `generated_at` del mock,
  no la hora local del browser.

## 2. Bloques en `null` o `error` — el caso que más importa

Editar una copia local de `docs/mock-response.json` (no commitear el
cambio) para simular:

- Un bloque de `salud` con `"status": "error"` — el panel debe mostrar "sin
  datos" **solo** en ese bloque, sin romper el resto de la página ni tirar
  un error en consola que corte el render.
- Un bloque de `salud` directamente **ausente** del JSON (no solo con
  status error) — mismo resultado esperado.
- `negocio.costos.meta_medido_ars` en `null` — tiene que mostrarse como
  "sin datos", nunca como `$0` o `0`. Ver la regla de `null` vs `0` en
  `.claude/skills/diagnostico-contract/SKILL.md`.

Si cualquiera de estos tres casos rompe el render de otro bloque o tira una
excepción sin capturar, no está listo para commitear.

## 3. Responsive básico

Sin un sitio de 8 páginas no hace falta revisar consistencia entre
páginas, pero sí que el panel se use bien en los tamaños típicos. Si se
reusan los breakpoints de `expedita-web` (`assets/styles.css:332-347`:
`62rem` y `40rem`) mantener la misma convención acá; si se definen
breakpoints propios, dejarlos documentados en `src/styles.css` con un
comentario corto.

Probar en el navegador:

- Ancho de escritorio completo.
- ~62rem (tablet) — la tabla de workflows n8n no debería desbordar
  horizontalmente sin scroll propio.
- ~40rem (mobile chico) — los bloques deben apilarse legibles, sin texto
  cortado.

## 4. Sin secretos commiteados

`DIAG_TOKEN` nunca va hardcodeado en `src/app.js` (ver CLAUDE.md). Antes de
commitear:

```
grep -rin "token\|key\|secret" src/
```

Revisar cada resultado a mano — es esperado encontrar la palabra `token` en
el código que maneja `sessionStorage`/`prompt()` (eso es lógica, no un
secreto filtrado); lo que **no** debe aparecer es un valor real de
`DIAG_TOKEN` pegado en el código.

## 5. Antes de commitear

1. Los 3 casos del punto 2 (bloque `error`, bloque ausente, `null` en
   costos) probados manualmente en el navegador — no alcanza con leer el
   código y asumir que anda.
2. Responsive del punto 3 revisado si el cambio tocó `src/styles.css` o
   layout en `src/index.html`.
3. `git status` — revisar que lo que cambió tiene sentido antes de
   stagear.
4. Grep de secretos del punto 4, limpio.

## 6. Commit

**Siempre preguntar antes de commitear.** Nunca correr `git commit` (ni
`git push`) sin una confirmación explícita de Ignacio en el turno actual,
aunque el checklist de arriba haya pasado en verde. Mostrar qué se va a
commitear (`git status` + `git diff` de lo staged, o al menos el mensaje
propuesto) antes de pedir esa confirmación.

Nunca usar `--force`, `--no-verify` ni saltear hooks para destrabar un
commit o push. Si un hook falla, investigar la causa y corregir antes de
reintentar.
