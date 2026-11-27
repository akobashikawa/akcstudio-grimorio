# SPEC 05 — Eliminar un post desde `/admin/`

> **Status:** Approved
> **Depends on:** SPEC 01, SPEC 03, SPEC 04
> **Date:** 2026-11-27
> **Objective:** Permitir borrar un post de un idioma desde el listado y el editor de `/admin/`, con confirmación de dos pasos y la misma convención de commit que el resto del admin.

## Por qué existe esta spec

SPEC 01 creó el editor de posts y SPEC 03 añadió la creación de un post por idioma. SPEC 04 retiró el PAT del navegador. Lo que nunca se pudo hacer desde `/admin/` es **eliminar**: hoy hay que ir a Pages CMS o a GitHub. Eso obliga a cambiar de herramienta para la operación más destructiva y rompe la idea de que `/admin/` cubra el ciclo completo.

El admin ya hace `PUT` sobre la Contents API; un `DELETE` con el `sha` del archivo es el mismo camino y deja la operación en la historia de Git, que actúa como papelera sin necesidad de implementar una.

## Scope

**In:**

- Añadir `deletePost()` a `src/lib/github-content.ts`: leer el archivo para obtener su `sha` y borrarlo con la Contents API.
- Mensaje de commit `cms: delete posts/{lang}/{slug}.md`, alineado con los templates de `.pages.yml`.
- Botón de papelera por fila en `PostList.vue`, con confirmación de dos pasos en la propia fila.
- Botón **Delete post** en `PostEditor.vue`, con la misma confirmación de dos pasos.
- Borrar solo el archivo del post seleccionado; si existe la traducción, no se toca.
- Permitir borrar posts publicados y borradores.
- Tras borrar: quitar el post de la lista, limpiar los parámetros de la URL, volver al listado y mostrar un aviso de éxito.
- Tratar un `404` del borrado como "ya estaba borrado": quitar el post de la lista y avisar, sin error.
- `401` durante el borrado → flujo de sesión caducada existente (`onUnauthorized`).
- Estado de confirmación por post (solo una confirmación activa a la vez), cancelable.
- Etiquetas accesibles (`aria-label`, `role="status"`/`role="alert"`) y foco al botón de confirmar.
- Actualizar `README.md`: el admin ya permite eliminar; ajustar la lista de limitaciones.
- Ampliar `tests/admin.spec.ts`: borrar desde el listado, borrar desde el editor, cancelar no llama a la API y `404` se trata como éxito.

**Out of scope (para futuras specs):**

- Borrar imágenes de portada o cualquier asset de `public/covers`.
- Borrar ambos idiomas a la vez.
- Renombrar un post o cambiar su slug.
- Papelera, undo o borrado lógico dentro del admin (Git es la papelera).
- Borrado desde Pages CMS (ya existe).
- Cambios en RSS, sitemap o redirecciones (el deploy los reconstruye).
- Confirmación escribiendo el slug.
- Auditoría del autor del borrado más allá del commit.

## Data model

```ts
// src/lib/github-content.ts
export type DeletePostResult = {
  lang: PostLanguage;
  slug: string;
  path: string; // src/content/posts/{lang}/{slug}.md
  commitSha: string;
};

export async function deletePost(
  config: AdminRepoConfig,
  token: string,
  lang: PostLanguage,
  slug: string,
): Promise<DeletePostResult>;
```

Petición a GitHub:

```text
DELETE /repos/{owner}/{repo}/contents/src/content/posts/{lang}/{slug}.md
Authorization: Bearer <access token de la sesión>
{
  "message": "cms: delete posts/{lang}/{slug}.md",
  "sha": "<sha del GET previo>",
  "branch": "master"
}
```

Reglas:

- El `sha` se obtiene con un `GET` del mismo path. Si ese `GET` devuelve `404`, se lanza `GithubApiError(404, ...)` y el llamador lo trata como "ya borrado".
- Un `409`/`422` de GitHub se propaga como `GithubApiError` con su mensaje: el archivo cambió entre el `GET` y el `DELETE`.
- El resultado expone `commitSha` para poder mostrar/registrar el commit, igual que `createPost()` y `savePost()`.

Estado de UI (solo en memoria del componente):

```ts
type PendingDelete = { lang: PostLanguage; slug: string };
```

- `PostList` mantiene `pendingDelete` y emite `delete: [post: PostSummary]` tras el segundo clic.
- `PostEditor` mantiene el mismo patrón para el post abierto y emite `delete: [post: PostSummary]`.
- `AdminApp` es quien tiene el token y ejecuta `deletePost()`.

Convenciones:

- La confirmación muestra el path real (`src/content/posts/{lang}/{slug}.md`), no el título.
- Solo hay una confirmación activa a la vez; confirmar o cancelar limpia `pendingDelete`.
- El aviso de éxito es `Deleted posts/{lang}/{slug}.md.`
- El aviso de "ya borrado" es `posts/{lang}/{slug}.md was already deleted.`

## Implementation plan

1. En `src/lib/github-content.ts`, añadir `DeletePostResult` y `deletePost()`: `GET` del path con `githubFetch(..., { allowNotFound: true })` para el `sha`, `DELETE` con `githubJson<ContentsDeleteResponse>` y el mapeo de `404` a `GithubApiError(404, ...)`. Verificar con `pnpm check`.
2. En `AdminApp.vue`, añadir `deleting` (para deshabilitar la acción mientras corre) y `removePost(post)`: llama `deletePost()`, quita el post de `posts`, vuelve al listado, limpia la query y muestra `listNotice`; `401` → `onUnauthorized()`; `404` → quita el post y muestra el aviso de "ya borrado"; otro error → `postsError`. Pasar `:deleting` y `@delete` a `PostList` y `PostEditor`.
3. En `PostList.vue`, añadir el botón de papelera por fila con estado `pendingDelete`: el primer clic muestra **Delete** (confirmación) y **Cancel** además del path; el segundo emite `delete`. Deshabilitar mientras `deleting` o sin permiso de escritura. Verificar en `pnpm dev` con un post de prueba.
4. En `PostEditor.vue`, añadir **Delete post** junto a las acciones existentes con la misma confirmación de dos pasos; al confirmar, emitir `delete`. Verificar que **Back** sigue funcionando y que los cambios sin guardar se pierden solo si se confirma el borrado.
5. Actualizar `tests/admin.spec.ts`: stub de sesión reutilizado; en el test del listado interceptar `GET` (sha) y `DELETE` y comprobar el `message` y el `sha` enviados; añadir el caso de cancelación (sin `DELETE`) y el `404` (post desaparece y aviso). Ejecutar `pnpm test:e2e`.
6. Actualizar `README.md`: la sección `/admin/` pasa a decir que se pueden eliminar posts (un idioma, con confirmación, reversible por Git) y se retire esa limitación; mantener en limitaciones "no hay subida de imágenes" y "no se puede renombrar". Verificar `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e`.

## Acceptance criteria

- [ ] En el listado, cada fila muestra un botón de borrado accesible por teclado con un `aria-label` que incluye el slug.
- [ ] El primer clic muestra la confirmación con el path `src/content/posts/{lang}/{slug}.md` y un botón **Cancel**.
- [ ] Cancelar no envía ninguna petición y el post sigue en la lista.
- [ ] El segundo clic envía `DELETE` a `/contents/src/content/posts/{lang}/{slug}.md` con el `sha` del `GET` previo y el mensaje `cms: delete posts/{lang}/{slug}.md`.
- [ ] Tras borrar desde el listado, el post desaparece, la URL queda sin `lang`/`slug` y aparece `Deleted posts/{lang}/{slug}.md.`
- [ ] En el editor, **Delete post** aplica la misma confirmación de dos pasos y, al confirmar, vuelve al listado con el post eliminado.
- [ ] La traducción del mismo slug en el otro idioma sigue existiendo tras borrar un lado.
- [ ] Se puede borrar un post publicado y uno en borrador.
- [ ] Un `404` del `DELETE` (o del `GET` previo) quita el post de la lista y muestra `posts/{lang}/{slug}.md was already deleted.`
- [ ] Un `401` durante el borrado lleva a la tarjeta de login y desautentica igual que el resto del admin.
- [ ] Mientras el borrado está en curso, el botón queda deshabilitado y no se puede lanzar dos veces.
- [ ] Solo puede haber una confirmación activa a la vez.
- [ ] `README.md` documenta el borrado desde `/admin/` y ya no lo lista como limitación.
- [ ] `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e` pasan.

## Decisions

- **Sí:** borrar solo el archivo seleccionado. Es coherente con "una entrada es un archivo" de SPEC 02/03 y evita borrar contenido traducido sin querer.
- **Sí:** confirmación de dos pasos en el propio control. Se ve el path exacto, es accesible y no depende de diálogos nativos.
- **Sí:** acción en listado y editor. Desde el listado es rápida; desde el editor estás seguro de qué post es.
- **Sí:** cualquier post, publicado o borrador. Bloquear los publicados obligaría a editarlos antes de borrar y añadiría pasos sin proteger nada (Git conserva el contenido).
- **Sí:** `GET` previo para el `sha`. La Contents API exige `sha` en `DELETE`; es una petición extra aceptada.
- **Sí:** mensaje `cms: delete posts/...`, igual que el template de `.pages.yml`. La historia queda consistente entre ambos editores.
- **Sí:** `404` como éxito con aviso. El objetivo del usuario (que no esté) se cumple; mostrar un error sería confuso.
- **Sí:** el token sigue en `AdminApp`. Los componentes hijo emiten `delete` como ya emiten `saved`/`created`.
- **No:** borrar ambos idiomas a la vez. Añade una confirmación compuesta y riesgo de perder la traducción.
- **No:** borrar portadas o assets. `public/covers` puede compartir imágenes entre posts; va en su propia spec.
- **No:** papelera o undo. Git ya guarda la historia y el deploy la reconstruye.
- **No:** confirmación escribiendo el slug. Los dos pasos ya muestran el path y el botón destructivo.
- **No:** renombrar o cambiar el slug. Sigue en Pages CMS.

## Risks

| Risk                                                               | Mitigation                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Borrado accidental de un post publicado                            | Confirmación de dos pasos con el path visible; el commit conserva el contenido y se puede revertir en GitHub.  |
| El `sha` cambió entre el `GET` y el `DELETE` (dos editores)        | GitHub devuelve `409`/`422`; se muestra el mensaje y el post no se quita de la lista.                          |
| El usuario borra el post que está editando con cambios sin guardar | La confirmación está junto al resto de acciones; al confirmar se vuelve al listado y los cambios no se envían. |
| El borrado de un lado deja el otro idioma sin pareja               | Es el comportamiento acordado (SPEC 02: la traducción es opcional); `check-posts` emite el aviso ya existente. |
| Un `404` enmascara un error de permisos                            | Solo se trata como éxito si GitHub responde `404`; `401`/`403` siguen el flujo de sesión y error existente.    |
| Doble clic en confirmar lanza dos `DELETE`                         | El estado `deleting` deshabilita la acción mientras la promesa está en vuelo.                                  |
| La portada del post queda huérfana en `public/covers`              | Fuera de alcance; se documenta en la spec y se limpia a mano si molesta.                                       |

## What is **not** in this spec

- Borrar imágenes o assets de la portada.
- Borrar ambos idiomas en una sola acción.
- Renombrar posts o cambiar slugs.
- Papelera, deshacer o borrado lógico.
- Cambios en RSS, sitemap o redirecciones.
- Confirmación escribiendo el slug.
- Cualquier cambio en Pages CMS.

Cada uno de esos puntos, si se implementa, va en su propia spec.
