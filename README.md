# Expedita — Panel de Diagnóstico

Panel de uso interno (solo Ignacio) para ver, de un vistazo, el estado de
Staging: salud del sistema (n8n, DB, Meta/WhatsApp, infraestructura) y
negocio/costos. Sin historial — solo snapshot del momento.

Frontend estático (`src/`) que consume vía `fetch()` un webhook JSON
expuesto por n8n.

## ⚠️ El backend no vive acá

El backend (WF5, el workflow de n8n que arma y expone el JSON de
diagnóstico) vive en el repo **`dental-clinic-bot`**, junto a los demás
workflows (WF1-WF4) y su tooling de export/import/validate. Este repo
(`expedita-diagnostico`) contiene **solo** el frontend, su documentación y
la configuración de CI/deploy.

## Documentación

La especificación técnica completa está en [docs/SPEC.md](docs/SPEC.md).

---

## Deploy

Sitio estático, sin build step — `src/` se sirve tal cual. Deploy en
**Cloudflare Pages**, misma mecánica que `expedita-web`: push a `main` →
deploy automático, sin acción manual.

### 1 · Conectar el repo a Cloudflare Pages (una sola vez)

1. Dashboard de Cloudflare → **Workers & Pages** → **Create application** →
   pestaña **Pages** → **Connect to Git**.
2. Elegir el repo `Ignacio-81/expedita-diagnostico`. Si es la primera vez
   que Cloudflare pide autorización sobre GitHub en esta cuenta, autorizar
   el GitHub App de Cloudflare (si ya se autorizó para `expedita-web`, este
   paso es inmediato — mismo App, un repo más habilitado).
3. Configuración de build:
   - **Project name:** `expedita-diagnostico`
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** *(vacío)*
   - **Build output directory:** `src`
4. **Save and Deploy.**

A partir de acá, cada push a `main` dispara un deploy de producción
automático; Pages además genera *preview deployments* para otras ramas/PRs
sin configuración extra — comportamiento nativo, no hay nada que mantener.

### 2 · DNS: apuntar `diag.expedita.com.ar` al proyecto de Pages

La zona `expedita.com.ar` ya está delegada a Cloudflare (se usa para
`expedita-web` y para el túnel de `staging`/`n8n`) — no hace falta crear
una zona nueva ni tocar los nameservers.

**Vía recomendada — Custom domains del proyecto de Pages:**

1. Proyecto `expedita-diagnostico` en Pages → pestaña **Custom domains** →
   **Set up a custom domain**.
2. Escribir `diag.expedita.com.ar` y confirmar. Como la zona ya vive en la
   misma cuenta de Cloudflare, el registro DNS (`CNAME diag →
   expedita-diagnostico.pages.dev`, proxied) se crea y activa solo — no
   requiere un paso manual en la pestaña DNS.
3. El certificado TLS lo emite Cloudflare (Universal SSL) automáticamente
   para el subdominio nuevo.

**Alternativa manual** (solo si el paso anterior no está disponible): zona
`expedita.com.ar` → **DNS** → **Add record** → Type `CNAME`, Name `diag`,
Target `expedita-diagnostico.pages.dev`, Proxy status **Proxied** (nube
naranja).

**No toca `staging.expedita.com.ar`.** Ese hostname lo expone el
Cloudflare Tunnel de `dental-clinic-bot` (`agente-server` → n8n) y ya
funciona — este paso es exclusivamente para el subdominio nuevo del
frontend, un registro DNS más en la misma zona, sin relación con el túnel.

### Qué NO cambia acá

El deploy del backend (WF5) sigue el loop manual ya establecido en
`dental-clinic-bot` (`export-workflows.ps1` → `validate-json.py` → commit →
`import-workflows.ps1 -Env staging`), con autorización explícita de
Ignacio en cada ambiente — este repo no introduce ninguna automatización
sobre eso.

### Futuro — Cloudflare Access (opcional, fuera de alcance v1)

La v1 protege el webhook con `DIAG_TOKEN` manual vía `prompt()` (§8 de
`docs/SPEC.md`). Cloudflare Access tiene tier gratis hasta 50 usuarios y
podría reemplazar ese mecanismo — autenticación a nivel de Cloudflare antes
de que la request llegue al sitio, sin pedir token en el frontend. Queda
documentado como mejora disponible sin costo si en algún momento se quiere
sacar el token de la ecuación; no está implementado ni planificado para
esta versión.
