# SPEC 04 — Sesión de GitHub App en `/admin/` sin PAT en el navegador

> **Status:** Approved
> **Depends on:** SPEC 01, SPEC 03
> **Date:** 2026-11-27
> **Objective:** Sustituir el PAT guardado en `localStorage` por una sesión de GitHub App mantenida en el Worker del sitio, para que `/admin/` sobreviva al borrado de `localStorage` sin volver a pegar ningún token.

## Por qué existe esta spec

SPEC 01 resolvió la edición sin infraestructura con `/admin/` y un PAT pegado en el navegador. SPEC 03 amplió ese modelo con el botón de traducción del 404, que también depende del token en `localStorage`. El resultado es una credencial de larga vida expuesta a cualquier XSS y una fricción constante: cada limpieza de `localStorage` obliga a buscar el PAT y pegarlo otra vez.

La solución no es otro PAT, sino mover la conversación con GitHub a un servidor que ya existe: el Worker del sitio. El navegador conserva su experiencia actual (listar, leer, guardar y crear posts) pero recibe un access token de 8 horas, nunca un PAT. La sesión real vive en la cookie `httpOnly` de Astro y en el KV del Worker, así que borrar `localStorage` deja de tener consecuencias.

Esta spec es específica de grimorio. La evaluación de Sveltia CMS para `akcstudio-astrowind` va aparte y no se toca aquí.

## Scope

**In:**

- Registrar una **GitHub App** (paso manual documentado) con callback `/api/auth/callback`, permiso `Contents: Read and write` y `Metadata: Read-only`, instalada solo en este repositorio.
- Activar **sesiones de Astro** con el driver KV que el adapter de Cloudflare aprovisiona automáticamente (binding `SESSION`), con `ttl` de 90 días.
- Añadir cuatro rutas on-demand (`prerender = false`) en `src/pages/api/auth/`:
  - `GET /api/auth/login`
  - `GET /api/auth/callback`
  - `GET /api/auth/session`
  - `POST /api/auth/logout`
- Guardar en la sesión del servidor el access token, su caducidad, el refresh token, su caducidad, el login y el resultado del preflight de escritura.
- Renovar el access token con `grant_type=refresh_token` cuando caduque, sin interacción del usuario.
- Validar el preflight en el callback con `validateToken()` y `verifyWriteAccess()` reutilizados del código actual.
- Devolver el access token a la SPA solo en memoria; eliminar `sessionStorage` y `localStorage` como almacén de credenciales.
- Sustituir `TokenLogin.vue` por una tarjeta de login con un enlace **Conectar con GitHub** a `/api/auth/login`.
- Soportar `next` en `/api/auth/login`: solo rutas que empiecen por `/admin/`; el resto cae en `/admin/`.
- **Logout** que destruye la sesión y revoca el grant en GitHub como best-effort.
- Flag no-secreto `grimorio.admin=1` en `localStorage` para que `EditPostButton` y `MissingPage` decidan si muestran sus botones; se escribe tras login válido y se borra en logout y en 401.
- Purgar las claves heredadas `grimorio.github.*` al cargar el admin.
- Añadir `.dev.vars` a `.gitignore` y documentar su contenido en `README.md`.
- Adaptar `tests/admin.spec.ts` y `tests/blog.spec.ts` al stub de `/api/auth/session` y al flag.
- Actualizar `README.md`: registro de la GitHub App, secrets, `.dev.vars`, flujo de sesión y retirada del PAT.

**Out of scope (para futuras specs):**

- Proxy completo de las escrituras: `github-content.ts` sigue llamando a `api.github.com` desde el navegador con el token de sesión.
- Allowlist por login de GitHub. GitHub ya limita el token a las instalaciones y repos donde el usuario tiene permiso.
- Roles, varios usuarios, auditoría, rate limiting o Turnstile.
- Device flow u OAuth App.
- Sveltia CMS, Pages CMS o cualquier otro editor.
- Cambios en el modelo de contenido, categorías, i18n, rutas públicas o sitemap.
- Subida de imágenes desde `/admin/`.
- Migración de posts existentes o de URLs.

## Data model

### Variables y secrets del Worker

```ts
// src/lib/admin-auth.ts
export type AdminAuthEnv = {
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
};

// Producción: wrangler secret put GITHUB_APP_CLIENT_SECRET
// Desarrollo: .dev.vars (no versionado)
```

`GITHUB_APP_CLIENT_ID` no es secreto, pero se lee del entorno para no hardcodear la app. El `client_secret` solo existe en el Worker.

### Sesión persistida (servidor)

```ts
// src/lib/admin-auth.ts
export type AdminSessionData = {
  login: string; // GET /user
  canWrite: boolean; // resultado de verifyWriteAccess()
  accessToken: string;
  accessExpiresAt: number; // epoch ms
  refreshToken: string;
  refreshExpiresAt: number; // epoch ms
  oauthState?: string; // solo durante el login; se borra en el callback
};
```

Se guarda con `Astro.session.set("admin", data)`. El navegador solo recibe la cookie `httpOnly` con el id de sesión; el valor no sale del KV.

### Respuesta de `/api/auth/session`

```ts
export type AdminSessionPayload = {
  token: string; // access token vigente (8 h)
  login: string;
  expiresAt: number; // epoch ms
  canWrite: boolean;
};
```

- `200` con `Cache-Control: no-store` cuando hay sesión válida.
- `401 { error: "unauthenticated" }` cuando no hay cookie, la sesión no existe o el refresh token expiró.

### Contrato de las rutas

```text
GET  /api/auth/login?next=/admin/?lang=es
     → 302 a https://github.com/login/oauth/authorize
       ?client_id=<id>&redirect_uri=<origin>/api/auth/callback&state=<nonce>

GET  /api/auth/callback?code=...&state=...
     → valida state contra la sesión
     → canjea code por access_token + refresh_token
     → GET /user y verifyWriteAccess()
     → guarda AdminSessionData
     → 302 a next (por defecto /admin/)

GET  /api/auth/session
     → 200 AdminSessionPayload | 401
     → si accessExpiresAt - 60 s < now, refresca antes de responder

POST /api/auth/logout
     → session.destroy() + revocación best-effort en GitHub
     → 204
```

Convenciones:

- `next` se acepta solo si empieza por `/admin/`; cualquier otro valor se ignora.
- El origen del `redirect_uri` se calcula con `new URL(request.url).origin`; nunca se lee de un parámetro.
- Las cuatro rutas declaran `export const prerender = false`.
- `POST /api/auth/logout` exige `Origin` igual al del sitio; si no coincide, `403`.

### Configuración de Astro

```js
// astro.config.mjs
session: {
  cookie: { name: "grimorio-admin", sameSite: "lax", secure: true },
  ttl: 60 * 60 * 24 * 90, // 90 días
}
```

En desarrollo (`NODE_ENV !== "production"`) `secure` pasa a `false` para que `http://localhost` acepte la cookie.

### Claves del navegador

```ts
// src/lib/admin-config.ts
export const ADMIN_STORAGE_KEYS = {
  signedIn: "grimorio.admin",
} as const;

export const ADMIN_LEGACY_STORAGE_KEYS = [
  "grimorio.github.token",
  "grimorio.github.user",
  "grimorio.github.expires",
  "grimorio.github.writeVerified",
] as const;
```

`grimorio.admin` vale `"1"` y no identifica a nadie; sirve solo para mostrar botones. La autorización real siempre la decide el Worker.

### Cliente

```ts
// src/lib/admin-auth-client.ts
export async function fetchSession(): Promise<AdminSessionPayload | null>;
export async function signOut(): Promise<void>;
export function rememberSignedIn(): void;
export function isSignedIn(): boolean;
export function forgetSignedIn(): void;
export function clearLegacySession(): void;
```

`fetchSession()` devuelve `null` en `401` y lanza en errores de red o `5xx`, para que el admin distinga "no autenticado" de "el servidor falló".

## Implementation plan

1. **Registro manual de la GitHub App.** En GitHub → Settings → Developer settings → GitHub Apps: crear `akcstudio-grimorio-admin`, callback `https://<dominio>/api/auth/callback` y `http://localhost:4321/api/auth/callback`, permisos `Contents: Read and write` y `Metadata: Read-only`, activar **Expire user authorization tokens**, instalar solo en `akcstudio-grimorio`. Crear `.dev.vars` con `GITHUB_APP_CLIENT_ID` y `GITHUB_APP_CLIENT_SECRET`, y añadir `.dev.vars` a `.gitignore`. Verificar con `pnpm build` que el sitio no cambia.
2. Crear `src/pages/api/auth/ping.ts` con `prerender = false` que devuelva `{ ok: true }` y comprobar con `pnpm dev` y `pnpm build` que una ruta on-demand funciona con `output: "static"`. Eliminarlo al terminar el paso.
3. Activar `session` en `astro.config.mjs` con el `cookie` y el `ttl` del modelo de datos. Verificar en `pnpm build` el aviso `Enabling sessions with Cloudflare KV with the "SESSION" KV binding.` y que `wrangler.jsonc` no necesita cambios manuales.
4. Crear `src/lib/admin-auth.ts` con `AdminAuthEnv`, `AdminSessionData`, `AdminSessionPayload`, `authorizeUrl()`, `exchangeCode()`, `refreshAccessToken()`, `revokeGrant()`, `isAdminNextPath()` y `readAdminSession()`. Verificar con `pnpm check`.
5. Implementar `GET /api/auth/login`: generar `state` con `crypto.randomUUID()`, guardarlo en la sesión, redirigir a `authorizeUrl(origin, state)`. Manual: abrir en el navegador y ver la pantalla de autorización de GitHub.
6. Implementar `GET /api/auth/callback`: comprobar `state`, canjear el `code`, leer `GET /user`, ejecutar `validateToken()` y `verifyWriteAccess()`, guardar `AdminSessionData` sin `oauthState` y redirigir a `next`. Manual: completar el login y comprobar que `/admin/` sigue mostrando el listado.
7. Implementar `GET /api/auth/session` con renovación (`refreshAccessToken()` cuando falten menos de 60 s) y `Cache-Control: no-store`; si el refresh falla con `400`/`401`, destruir la sesión y devolver `401`. Manual: adelantar `accessExpiresAt` en el KV local y comprobar que responde con un token nuevo.
8. Implementar `POST /api/auth/logout`: validar `Origin`, revocar el grant con el access token, destruir la sesión y devolver `204`. Manual: tras logout, `/api/auth/session` responde `401`.
9. Crear `src/lib/admin-auth-client.ts` con las seis funciones del modelo de datos, incluida la purga de claves heredadas. Sustituir `src/lib/admin-session.ts` por este módulo y actualizar sus importadores. Verificar con `pnpm check`.
10. Reescribir `AdminApp.vue`: al montar, `clearLegacySession()` + `fetchSession()`; con sesión, guardar el `token` en una ref en memoria y marcar `rememberSignedIn()`; sin sesión, mostrar la tarjeta de login. Eliminar `checking`/`loadStoredSession()` y el mensaje de token caducado. En cada `GithubApiError` con `401`, olvidar la sesión y volver al login.
11. Reescribir `TokenLogin.vue` como `LoginCard.vue`: sin input ni `tokenUrl`; un enlace a `/api/auth/login?next=...` con la URL actual del admin, más el mensaje de error de permisos cuando `canWrite` es `false`. Renombrar el importador en `AdminApp.vue`.
12. En `src/lib/admin-config.ts`, sustituir `ADMIN_STORAGE_KEYS` por el flag y las claves heredadas. Actualizar `EditPostButton.vue` y `MissingPage.astro` para leer `grimorio.admin` en lugar del token. Verificar el 404 sin flag y con flag.
13. Eliminar el código muerto del PAT: `tokenUrl`, `storeSession()`, `loadStoredSession()`, `hasWriteVerified()`, `markWriteVerified()` y las claves `grimorio.github.*` de los tipos. Verificar con `pnpm check` y `pnpm build`.
14. Actualizar `tests/admin.spec.ts`: stub de `**/api/auth/session` con `{ token: "write-token", login: "tester", expiresAt, canWrite: true }`, `addInitScript` con `grimorio.admin=1`, y asserts sobre el flag en lugar del token. Añadir un test de `401` que compruebe la tarjeta de login y la ausencia del listado. Ajustar `tests/blog.spec.ts` para el botón del 404. Ejecutar `pnpm test:e2e`.
15. Actualizar `README.md`: creación de la GitHub App, callback URLs, secrets en Cloudflare, `.dev.vars`, flujo de sesión, qué pasa al borrar `localStorage`, y el paso final de revocar el PAT `AKC Studio Grimorio admin`. Ejecutar `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e`.

## Acceptance criteria

- [ ] `pnpm dev` sirve `/api/auth/session` y responde `401 { "error": "unauthenticated" }` sin cookie.
- [ ] `/admin/` sin sesión muestra la tarjeta con **Conectar con GitHub** y no muestra el listado.
- [ ] Pulsar **Conectar con GitHub** lleva a GitHub, autoriza la app y vuelve a `/admin/` con el listado cargado.
- [ ] Tras el login, `localStorage` contiene `grimorio.admin=1` y ninguna clave `grimorio.github.*`.
- [ ] Borrar `localStorage` y recargar `/admin/` mantiene la sesión y el listado.
- [ ] El access token no aparece en `localStorage`, `sessionStorage` ni en cookies accesibles desde JavaScript.
- [ ] El access token caducado se renueva solo: `/api/auth/session` responde `200` con un token distinto y la fecha nueva.
- [ ] `/api/auth/session` responde con `Cache-Control: no-store`.
- [ ] Un usuario sin permiso de escritura recibe `canWrite: false` y el admin muestra el error de permisos en lugar del listado.
- [ ] **Logout** destruye la sesión: `/api/auth/session` pasa a `401` y `grimorio.admin` desaparece de `localStorage`.
- [ ] `next` solo acepta rutas que empiezan por `/admin/`; un valor externo redirige a `/admin/`.
- [ ] Un `POST /api/auth/logout` con `Origin` distinto responde `403`.
- [ ] Con `grimorio.admin` presente, un post muestra **Edit** y el 404 muestra el botón de traducción; sin el flag, no aparecen.
- [ ] El callback falla con `403` si el `state` no coincide con el guardado en la sesión.
- [ ] `.dev.vars` está en `.gitignore` y `README.md` explica su contenido sin valores reales.
- [ ] `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e` pasan.
- [ ] `README.md` documenta el registro de la GitHub App, los secrets y la retirada del PAT.

## Decisions

- **Sí:** GitHub App en lugar de OAuth App. Es el único flujo que emite access token de 8 h con refresh token de 6 meses; un OAuth App daría una credencial perpetua.
- **Sí:** endpoints en el Worker del sitio (`src/pages/api/auth/`). Mismo dominio, cookies sin CORS y un solo deploy; el sitio deja de ser estático puro, que es un coste aceptado.
- **Sí:** sesiones de Astro con KV. El adapter aprovisiona el binding `SESSION` y la cookie `httpOnly`; escribir firmas y almacenamiento a mano no aporta nada.
- **Sí:** `ttl` de 90 días. Equilibrio entre comodidad y exposición; el refresh token de GitHub pone el techo real en 6 meses.
- **Sí:** access token solo en memoria. Recargar cuesta una petición a `/api/auth/session` y el token no queda legible por otro script.
- **Sí:** preflight en el callback y cacheado en la sesión. Evita repetir `validateToken()` y el blob de `verifyWriteAccess()` en cada carga.
- **Sí:** sin allowlist de login. GitHub ya restringe el token a las instalaciones y repos donde el usuario tiene permiso; una lista extra sería redundante.
- **Sí:** flag `grimorio.admin` en `localStorage`. Es una pista de UI, no una credencial, y evita una petición por visita en posts y 404.
- **Sí:** conservar el botón **Edit** y el del 404. SPEC 03 sigue vigente; solo cambia la condición que los muestra.
- **Sí:** logout revoca el grant como best-effort. La sesión local se destruye siempre; el fallo de revocación no bloquea.
- **Sí:** `github-content.ts` intacto y token en Authorization desde el navegador. Un proxy completo es otra spec y otro contrato de API.
- **Sí:** tests con stub de `/api/auth/session`. `astro preview` no ejecuta rutas on-demand y el flujo real se prueba a mano en `pnpm dev`.
- **No:** PAT como fallback. Mantener dos flujos duplica superficie y retrasa la retirada del token de larga vida.
- **No:** device flow. La UX de pegar un código cada vez no resuelve el problema.
- **No:** sesiones con `sessionStorage`. No arregla el borrado de `localStorage` y vuelve a exponer el token a scripts de la página.
- **No:** allowlist, roles ni multi-usuario. No hay caso de uso todavía.

## Risks

| Risk                                                                                                | Mitigation                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| El primer deploy crea el KV `SESSION` y falla si el aprovisionamiento automático no está disponible | Verificar en step 3; si falla, declarar `kv_namespaces` con `binding: "SESSION"` en `wrangler.jsonc` e indicar el id.     |
| `astro preview` no ejecuta las rutas on-demand y los E2E parecen rotos                              | Los E2E stubbean `/api/auth/session`; el flujo real se verifica en `pnpm dev` o `wrangler dev`.                           |
| La cookie `secure` se descarta en `localhost`                                                       | `secure: false` cuando `NODE_ENV !== "production"`.                                                                       |
| El refresh token caduca a los 6 meses                                                               | `/api/auth/session` devuelve `401` y el admin muestra la tarjeta de login; un clic vuelve a autorizar.                    |
| Un deploy sin `GITHUB_APP_CLIENT_SECRET` rompe el login                                             | `exchangeCode()` devuelve `500` con un mensaje claro; el callback no crea sesión.                                         |
| CSRF en `/api/auth/logout`                                                                          | Comprobación de `Origin` y `state` en el callback.                                                                        |
| Open redirect con `next`                                                                            | Solo se aceptan rutas que empiezan por `/admin/`.                                                                         |
| La revocación del grant falla por permisos del token                                                | La sesión local se destruye igual y el admin queda desautenticado.                                                        |
| El flag `grimorio.admin` queda tras cerrar sesión en otra pestaña                                   | Se borra en el siguiente `401` de cualquier operación y en logout.                                                        |
| Un XSS roba el access token en memoria                                                              | Ventana de 8 h y revocable; el PAT anterior era perpetuo y estable.                                                       |
| El KV de sesiones no es consistente al instante                                                     | Se lee la sesión al inicio de cada request; un logout simultáneo en otra pestaña puede tardar una petición en reflejarse. |

## What is **not** in this spec

- Proxy completo de las escrituras a GitHub.
- PAT como método alternativo.
- Allowlist por login, roles, permisos o auditoría.
- Device flow u OAuth App.
- Sveltia CMS, Pages CMS o cambios en cualquier otro editor.
- Cambios en el modelo de contenido, i18n, rutas o sitemap.
- Subida de imágenes, borrado o renombrado de posts.
- Rate limiting o Turnstile.

Cada uno de esos puntos, si se implementa, va en su propia spec.
