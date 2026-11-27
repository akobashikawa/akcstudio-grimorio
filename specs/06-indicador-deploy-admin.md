# SPEC 06 — Indicador del deploy en `/admin/`

> **Status:** Approved
> **Depends on:** SPEC 04, SPEC 05
> **Date:** 2026-11-27
> **Objective:** Mostrar en `/admin/` el estado del workflow Deploy para el commit guardado (en cola, en curso con tiempo transcurrido, live o fallido) con enlace al run de GitHub Actions.

## Por qué existe esta spec

Cada guardado, creación o borrado desde `/admin/` hace un commit en `master` y dispara el workflow Deploy. El sitio tarda uno o dos minutos en reflejarlo y el admin no muestra nada: el autor refresca a ciegas y no sabe si el deploy terminó, sigue en curso o falló. La información existe en la API de GitHub Actions y la sesión ya tiene un token de usuario de la GitHub App; solo falta leerla y mostrarla.

## Scope

**In:**

- Añadir el permiso **Actions: Read-only** a la GitHub App (paso manual del usuario y reautorización).
- Helper `listDeployRuns()` en `src/lib/github-content.ts`: runs del workflow Deploy filtrados por `head_sha`.
- Estado de deploy en `AdminApp.vue`: commit ancla, polling cada 10 s, máximo 15 min, cancelado por un nuevo guardado/borrado o el logout.
- Cinta de estado bajo el header con cinco estados: `queued`, `in_progress` con tiempo transcurrido, `completed/success` ("Live · 1:12"), `completed/failure` y permiso ausente.
- Enlace **View run** al `html_url` del run.
- Enganchar el seguimiento en `onPostSaved`, `onPostCreated` y `removePost` (éxito) usando el `commitSha` que ya devuelven esas operaciones.
- Degradación elegante: sin permiso (`403`) se muestra un aviso informativo, nunca un error que bloquee la edición.
- Tests de Playwright con stub de `/actions/runs`: queued → in_progress → success, `403` y ausencia de run.
- `README.md`: permiso `Actions: Read-only`, reautorización y comportamiento del indicador.

**Out of scope (para futuras specs):**

- Progreso porcentual real (el workflow no lo expone; el indicador muestra estado y tiempo).
- WebSockets o SSE: polling simple.
- Cancelar o reintentar el workflow desde el admin.
- Estado de **Quality checks** (solo se sigue el workflow Deploy).
- Notificaciones push, correo o badge fuera del admin.
- `version.json` en el sitio como fuente de estado.
- Seguimiento de commits hechos fuera del admin (Pages CMS, git).

## Data model

```ts
// src/lib/github-content.ts
export type DeployRun = {
  status:
    | "queued"
    | "in_progress"
    | "completed"
    | "requested"
    | "waiting"
    | "pending";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  htmlUrl: string;
  runStartedAt: string | null; // ISO
  updatedAt: string; // ISO
};

export async function listDeployRuns(
  config: AdminRepoConfig,
  token: string,
  headSha: string,
): Promise<DeployRun | null>;
```

Petición:

```text
GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}&per_page=20
→ workflow_runs[] filtrado por path ".github/workflows/deploy.yml"
→ el más reciente por created_at, o null si aún no existe
```

Estado de UI (AdminApp):

```ts
type DeployStatus = {
  sha: string; // commit guardado
  status: DeployRun["status"];
  conclusion: DeployRun["conclusion"];
  htmlUrl: string;
  startedAt: number; // epoch ms, para el contador
  error?: "forbidden" | "unavailable";
};
const deploy = ref<DeployStatus | null>(null);
```

Convenciones:

- Intervalo de polling: 10 s. Límite: 15 min; al superarlo se detiene y deja el último estado con el enlace.
- Si el run aún no existe (`null`) se reintenta hasta 2 min; luego se muestra "Deploy not started yet" con enlace a `…/actions/workflows/deploy.yml`.
- Textos: `Deploy queued`, `Deploying… {m:ss}`, `Live · {m:ss}`, `Deploy failed · {m:ss}`, `Deploy status unavailable`.
- Un nuevo guardado/creación/borrado reemplaza el estado y reinicia el polling.
- `403` al consultar runs → `error: "forbidden"` y aviso "Add Actions: Read-only to the GitHub App to see deploy status".
- El polling no debe llamar a `onUnauthorized()`: un `401` durante el polling detiene el seguimiento en silencio.

## Implementation plan

1. **Paso manual:** añadir **Actions: Read-only** (Repository permissions) a `akcstudio-grimorio-admin` en GitHub → instalar el cambio y **aprobar la reautorización** desde Settings → Applications → Authorized GitHub Apps. Verificar con `curl -s -H "Authorization: Bearer <token de sesión>" "https://api.github.com/repos/akobashikawa/akcstudio-grimorio/actions/runs?per_page=1"` desde la consola del admin (o comprobar que el indicador deja de dar 403 tras el deploy). Documentar en `README.md`.
2. Añadir `DeployRun` y `listDeployRuns()` a `src/lib/github-content.ts` (fetch a `/actions/runs`, filtro por `path` y `head_sha`, mapeo a `DeployRun`). Verificar con `pnpm check`.
3. En `AdminApp.vue`, añadir `deploy` ref, `trackDeploy(commitSha)`, `stopTracking()` y el contador con `setInterval`. Enganchar en `onPostSaved` (usar `result.commitSha` — requiere devolverlo desde `PostEditor`), `onPostCreated` (`result.commitSha`) y `removePost`. Verificar con `pnpm check`.
4. Propagar `commitSha` en el evento `saved` de `PostEditor.vue` (hoy emite el `PostSummary` actualizado; añadir el sha de commit a `SavePostResult`/evento) y en `CreatePostResult`/`DeletePostResult` ya existe. Verificar con `pnpm check`.
5. Añadir la cinta de estado al template de `AdminApp.vue` (temática light/dark, `role="status"` para cambios de estado, enlace `View run`) y estilos. Verificar a mano en `pnpm dev` con el stub del paso 6.
6. Tests en `tests/admin.spec.ts`: stub de `/actions/runs` que devuelva `queued` en la primera consulta, `in_progress` en la segunda y `completed/success` después; comprobar los textos y que el polling se detiene; caso `403` (aviso sin romper la edición) y caso sin run (reintento). Ejecutar `pnpm test:e2e`.
7. Actualizar `README.md` (permiso, reautorización, estados) y verificar `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e`.

## Acceptance criteria

- [ ] La GitHub App tiene **Actions: Read-only** y la reautorización está aprobada.
- [ ] Tras guardar un post, el admin muestra `Deploy queued` o `Deploying…` en menos de 15 s.
- [ ] El contador de `Deploying…` avanza en segundos.
- [ ] Al terminar el deploy, muestra `Live · {m:ss}` con enlace **View run** al run correcto.
- [ ] Un deploy fallido muestra `Deploy failed` con el enlace al run.
- [ ] Un segundo guardado reinicia el estado y deja de seguir el commit anterior.
- [ ] Sin permiso `Actions: Read-only`, el admin muestra `Deploy status unavailable` y la edición sigue funcionando.
- [ ] Un `401` durante el polling no desautentica ni muestra la tarjeta de login.
- [ ] El polling se detiene a los 15 min y conserva el último estado con enlace.
- [ ] El seguimiento también se dispara al crear y al borrar un post.
- [ ] `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e` pasan.
- [ ] `README.md` documenta el permiso y el indicador.

## Decisions

- **Sí:** API de GitHub Actions como fuente de estado. Muestra el estado real del workflow y el enlace al run, que es lo que el autor quiere saber.
- **Sí:** filtrar por `head_sha` del commit guardado. Evita confundirse con runs de commits anteriores o de las dos escrituras de Pages CMS.
- **Sí:** solo el workflow Deploy. Quality checks no cambia lo que ve un visitante; dos cintas serían ruido.
- **Sí:** polling de 10 s con límite de 15 min. Simple, sin permisos extra de websockets y suficiente para un deploy de 1–2 min.
- **Sí:** degradación elegante con `403`. La reautorización de permisos de la app es un paso humano; el admin no debe bloquearse si aún no se hizo.
- **Sí:** enlazar al run. Un fallo de deploy se investiga en GitHub; el admin solo señala.
- **No:** `version.json` en el sitio. Requiere integración de build y no distingue "no desplegado" de "desplegado pero fallido".
- **No:** WebSockets/SSE. Infraestructura desproporcionada para un workflow de CI.
- **No:** botones de cancelar/reintentar el workflow. La API exige permisos de escritura de Actions y el flujo no lo necesita.
- **No:** seguir commits hechos fuera del admin. Pages CMS y git quedan fuera; el indicador nace del `commitSha` que devuelve la operación del admin.

## Risks

| Risk                                                            | Mitigation                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| La reautorización de permisos de la app no se aprueba           | El indicador degrada a un aviso; documentado en README y en el criterio 7.                         |
| Un commit dispara Quality checks y Deploy a la vez              | Se filtra por `path` del workflow; el indicador solo sigue Deploy.                                 |
| El run tarda en crearse tras el commit                          | Se reintenta con `null` hasta 2 min y luego se muestra el enlace al workflow.                      |
| El token de sesión caduca durante el polling                    | `401` detiene el seguimiento en silencio; la siguiente operación normal gestiona la sesión.        |
| La API de Actions devuelve varios runs para el mismo sha        | Se ordena por `created_at` y se toma el más reciente.                                              |
| Un deploy cancelado por `concurrency` (segundo guardado rápido) | El siguiente guardado reemplaza el estado; el enlace del run cancelado queda disponible en GitHub. |

## What is **not** in this spec

- Progreso porcentual real del workflow.
- WebSockets, SSE o notificaciones fuera del admin.
- Cancelar o reintentar el workflow desde `/admin/`.
- Estado de Quality checks.
- `version.json` u otra fuente de estado en el sitio.
- Seguimiento de commits hechos fuera del admin.

Cada uno de esos puntos, si se implementa, va en su propia spec.
