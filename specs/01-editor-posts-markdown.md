# SPEC 01 — Editor de posts Markdown desde `/admin/`

> **Status:** Implemented
> **Depends on:** —
> **Date:** 2026-11-24
> **Objective:** Permitir editar y crear posts Markdown bilingües desde `/admin/` usando la GitHub Contents API y un PAT, con commit directo a `master`.

## Por qué existe esta spec

`markdown-cms` demuestra que un CMS estático puede usar GitHub como backend sin base de datos ni servidor propio. Este proyecto ya tiene el contenido en Markdown dentro de `src/content/posts/{en,es}` y se despliega desde `master`, así que podemos reutilizar esa técnica sin migrar el modelo de contenido ni añadir infraestructura.

## Scope

**In:**

- Ruta `/admin/` con una isla Vue para autenticación, listado, edición y creación.
- Login con PAT fine-grained guardado en `localStorage`.
- Validación del token contra `GET /repos/{owner}/{repo}` y `GET /user`.
- Listado de todos los posts de `en` y `es`, incluidos los borradores.
- Edición del frontmatter y del cuerpo de un post existente.
- Creación de un post nuevo en ambos idiomas con el mismo slug.
- Validación cliente de los campos del frontmatter antes de guardar.
- Vista previa del Markdown con `marked` y `DOMPurify`.
- Actualización automática de `updated` al guardar un post existente.
- Detección de conflictos mediante el `sha` de GitHub.
- Botón **Edit** en cada post publicado cuando haya un token guardado.
- `noindex` en `/admin/`, exclusión del sitemap y `Disallow` en `robots.txt`.
- Documentación de uso en `README.md`.
- Test Playwright mínimo de la vista no autenticada de `/admin/`.

**Out of scope (para futuras specs):**

- Editar `about`, `projects`, la home o la configuración del sitio.
- Subir imágenes o gestionar archivos de `public/`.
- Borrar o renombrar posts existentes.
- Cambiar el slug de un post ya creado.
- Editor WYSIWYG.
- OAuth, GitHub App o proxy con secreto en un Worker.
- Múltiples usuarios, roles o permisos internos.
- Publicación programada, ramas de borradores o Pull Requests.
- Previews de build o despliegues de preview.
- Edición offline o sincronización en tiempo real.

## Data model

```ts
// src/lib/admin-config.ts
export type AdminRepoConfig = {
  owner: string;
  repo: string;
  branch: "master";
};

export const ADMIN_STORAGE_KEYS = {
  token: "grimorio.github.token",
  user: "grimorio.github.user",
  expires: "grimorio.github.expires",
} as const;
```

```ts
// src/lib/frontmatter.ts
export type PostLanguage = "en" | "es";

export type PostFrontmatter = {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  updated?: string; // YYYY-MM-DD
  lang: PostLanguage;
  category: "guides" | "notes" | "stories";
  tags: string[];
  featured: boolean;
  draft: boolean;
};
```

```ts
// src/lib/github-content.ts
export type PostFile = {
  lang: PostLanguage;
  slug: string;
  path: string; // src/content/posts/{lang}/{slug}.md
  sha: string; // sha actual del archivo en GitHub
  frontmatter: PostFrontmatter;
  body: string;
};

export type PostSummary = {
  lang: PostLanguage;
  slug: string;
  title: string;
  date: string;
  category: string;
  draft: boolean;
  updated?: string;
  sha: string;
};

export type AdminSession = {
  token: string;
  user: string;
  expires?: string;
};
```

Convenciones:

- Ruta remota: `src/content/posts/{lang}/{slug}.md`.
- Slugs válidos: `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- El `lang` del frontmatter debe coincidir con la carpeta.
- Las fechas se serializan como cadenas `YYYY-MM-DD`, no como objetos `Date`.
- El frontmatter se escribe en este orden: `title`, `description`, `date`, `updated`, `lang`, `category`, `tags`, `featured`, `draft`.
- Los tags se guardan como array de strings entre comillas dobles.
- Los commits usan `cms: update posts/{lang}/{slug}.md` y `cms: create posts/en/{slug}.md and posts/es/{slug}.md`.

### Creación bilingüe

La creación usa la Git Data API para escribir ambos archivos en **un solo commit**:

1. Leer `refs/heads/master`.
2. Leer el commit y su `tree`.
3. Crear un blob por cada archivo.
4. Crear un árbol con `base_tree`.
5. Crear un commit con ambos archivos.
6. Actualizar `refs/heads/master` sin `force`.

Si cualquiera de los dos archivos ya existe, se aborta antes de escribir.

## Implementation plan

1. Añadir `marked`, `dompurify` y `yaml` a `package.json`; crear `src/lib/admin-config.ts` con tipos, claves de `localStorage` y el helper que deriva `owner`/`repo` desde `site.config.json` y fija `branch: "master"`. Verificar `pnpm install` y `pnpm build`.
2. Crear `src/lib/frontmatter.ts` con parseo y serialización de frontmatter, normalización de fechas y validación de campos. La aplicación sigue funcionando sin cambios visibles.
3. Crear `src/lib/github-content.ts` con codificación/decodificación Base64 UTF-8, validación de token, listado, lectura, guardado con `sha` y creación atómica de pares. La aplicación sigue funcionando sin cambios visibles.
4. Crear `src/pages/admin/index.astro` con `BaseLayout noindex`, props de repositorio y categorías, y una isla `AdminApp` con estado inicial de login. Verificar que `/admin/` carga y muestra el formulario de token.
5. Implementar `TokenLogin.vue`: enlace de creación de PAT, validación, guardado en `localStorage`, visualización de usuario/expiración y logout. Verificar login correcto, token inválido y token expirado.
6. Implementar `PostList.vue`: listado de posts `en`/`es`, estado `draft`/`published`, búsqueda por título o slug y botón **New post**. Verificar que aparecen también los borradores.
7. Implementar `PostEditor.vue` para posts existentes: carga desde GitHub, formulario de frontmatter, textarea del cuerpo, guardado con `sha` y aviso de conflicto con recarga. Verificar que un guardado genera un commit en `master`.
8. Implementar la creación de un post nuevo: formulario de slug, título, fecha, categoría y tags; creación de ambos archivos con descripciones `"Pending description."` / `"Descripción pendiente."`, cuerpo vacío y `draft: true`. Verificar que `pnpm check:posts` acepta el par.
9. Implementar `MarkdownPreview.vue` con `marked` y `DOMPurify`, usando la clase `.prose` del sitio. Verificar títulos, listas, código, tablas e imágenes.
10. Crear `EditPostButton.vue` y montarlo en `src/pages/[...lang]/posts/[id].astro`. Solo se muestra si existe token en `localStorage` y enlaza a `/admin/?lang={lang}&slug={slug}`.
11. Añadir `Disallow: /admin/` en `src/pages/robots.txt.ts` y excluir `/admin/` en el filtro del sitemap de `astro.config.mjs`.
12. Añadir `tests/admin.spec.ts` para la vista no autenticada y actualizar `README.md` con configuración del PAT, uso del editor y limitaciones.
13. Ejecutar `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e`. Corregir cualquier error de tipos, accesibilidad o build.

## Acceptance criteria

- [x] `/admin/` carga sin token y muestra el formulario de conexión con GitHub.
- [x] Un token sin permiso de escritura muestra un error y no se guarda.
- [x] Un token válido muestra el usuario de GitHub y permite cerrar sesión.
- [x] El token solo se guarda en `localStorage` y solo se envía a `api.github.com`.
- [x] La lista muestra todos los posts de `en` y `es`, incluidos los `draft: true`.
- [x] Editar un post existente carga título, descripción, fecha, categoría, tags, featured, draft y cuerpo.
- [x] Guardar un post existente crea un commit en `master` y actualiza `updated` con la fecha actual.
- [x] Si el `sha` remoto cambió, aparece un aviso de conflicto y no se sobrescribe el archivo.
- [x] Crear un post genera `src/content/posts/en/{slug}.md` y `src/content/posts/es/{slug}.md` en un solo commit.
- [x] El post nuevo tiene `draft: true`, descripciones pendientes y `lang` correcto en cada archivo.
- [x] Un slug duplicado o inválido se rechaza antes de escribir.
- [x] La vista previa renderiza Markdown y no ejecuta HTML peligroso.
- [x] El botón **Edit** aparece en un post solo cuando hay token guardado y abre el post correcto.
- [x] `/admin/` incluye `noindex`, no aparece en el sitemap y está bloqueado en `robots.txt`.
- [x] `pnpm check`, `pnpm build` y `pnpm test:e2e` pasan.
- [x] No se modifica ningún archivo de `src/content/posts/` durante la implementación salvo los posts de prueba manuales.

## Decisions

- **Sí:** PAT fine-grained en `localStorage`, igual que `markdown-cms`. Es la opción con menos infraestructura para un único editor.
- **No:** OAuth o GitHub App con Worker. Añade proxy, callback y secretos; queda para otra spec si aparecen más editores.
- **Sí:** commit directo a `master`. El workflow actual ya despliega en cada push y el campo `draft` controla la publicación.
- **No:** ramas o Pull Requests. Añaden fricción y lógica de revisión que no se necesitan ahora.
- **Sí:** editar solo posts Markdown. `about` y `projects` no son Markdown y migrarlos merece su propia spec.
- **Sí:** formulario de frontmatter + textarea + preview. Evita errores de esquema sin construir un editor WYSIWYG.
- **Sí:** crear ambos idiomas en un solo commit. Mantiene `check-posts` satisfecho y evita pares incompletos.
- **Sí:** `updated` automático al guardar un post existente. El sitemap ya usa ese campo.
- **Sí:** actualización optimista con `sha` y recarga ante conflicto. Nunca se sobrescribe a ciegas.
- **Sí:** `/admin/` sin enlace público y con `noindex`. La ruta sigue siendo accesible, pero no se anuncia.
- **Sí:** interfaz del admin solo en inglés. El contenido sigue siendo bilingüe.
- **Sí:** preview local con `marked` + `DOMPurify`. No reproduce directivas de Astro, pero es inmediata y segura.
- **No:** subida de imágenes, borrado, renombrado y edición de slug. Quedan fuera del MVP.
- **No:** variables de entorno nuevas. El PAT lo introduce el usuario en el navegador.

## Risks

| Risk                                             | Mitigation                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| XSS que robe el PAT de `localStorage`            | Sanitizar la preview con `DOMPurify`; no usar `v-html` con HTML sin sanitizar; token con permisos mínimos y expiración corta. |
| Rate limit de GitHub al listar muchos posts      | Usar el token autenticado, cachear la lista en memoria y añadir un botón de refresco manual.                                  |
| Fallo a mitad de creación de un par bilingüe     | Crear ambos archivos en un solo commit con la Git Data API.                                                                   |
| Commit directo a `master` con contenido inválido | Validar el esquema en cliente; el workflow ejecuta `pnpm build` y `pnpm check` antes de desplegar.                            |
| Conflicto entre dos pestañas o ediciones         | Guardar con el `sha` original y mostrar aviso de recarga si GitHub responde `409`.                                            |
| Token expirado o revocado                        | Detectar `401`, borrar el token y volver al formulario de login.                                                              |
| Preview distinta del render real de Astro        | Avisar en el README de que la preview es aproximada y validar el resultado final en el sitio.                                 |
| `/admin/` visible para cualquiera                | `noindex`, `robots.txt` y ausencia de enlaces públicos; la protección real es el PAT.                                         |

## What is **not** in this spec

- Edición de páginas que no sean posts Markdown.
- Subida de imágenes.
- Borrado o renombrado de posts.
- Editor visual WYSIWYG.
- OAuth, GitHub App o backend proxy.
- Multiusuario, roles o auditoría.
- Publicación programada o Pull Requests.

Cada uno de esos puntos, si se implementa, va en su propia spec.
