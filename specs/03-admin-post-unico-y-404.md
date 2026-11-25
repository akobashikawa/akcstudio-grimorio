# SPEC 03 — Un solo post por creación desde `/admin/` y atajo desde el 404

> **Status:** Implemented
> **Depends on:** SPEC 01, SPEC 02
> **Date:** 2026-11-25
> **Objective:** Crear un post completo de un solo idioma en un único paso desde `/admin/` y ofrecer desde el 404 la creación de la versión que falta en el otro idioma.

## Por qué existe esta spec

SPEC 01 hizo que `/admin/` creara siempre el par `en`/`es` en un solo commit. SPEC 02 declaró opcional la traducción de cada post, pero dejó ese comportamiento intacto: el admin sigue generando un archivo vacío en el otro idioma, con descripción pendiente, y después obliga a abrir el editor para escribir el contenido. Son dos pasos y un archivo que el autor no pidió.

Pages CMS ya funciona con la idea correcta: una entrada es un archivo y se rellenan título, descripción, cuerpo y frontmatter en una sola pantalla. Esta spec lleva esa misma idea a `/admin/`, elimina la creación del par y añade un atajo en el 404 para crear la traducción que falta cuando alguien llega a una URL inexistente.

## Scope

**In:**

- Reemplazar el formulario actual de **New post** por uno completo con idioma, título, slug, descripción, fecha, categoría, tags, featured, draft y cuerpo Markdown.
- Elegir el idioma del post en el propio formulario: `en` o `es`.
- Inicializar ese idioma con el filtro activo del listado (`All` y `English` → `en`; `Spanish` → `es`).
- Botón **Generate from title** que rellena el slug a partir del título sin sobreescribirlo después.
- Vista **Write/Preview** del cuerpo con el mismo `MarkdownPreview` del editor.
- Crear un solo archivo `src/content/posts/{lang}/{slug}.md` en un solo commit con `createPost()`.
- Rechazar la creación si ya existe un archivo con ese slug en el idioma elegido.
- Permitir el mismo slug si solo existe en el otro idioma, para poder crear la traducción.
- Volver al listado tras crear, refrescarlo y mostrar un aviso de éxito.
- Mantener `draft` marcado por defecto y `featured` desmarcado.
- Embeber en el 404 un índice de slugs publicados por idioma y detectar rutas `/{lang}/posts/{slug}/` sin versión en ese idioma.
- Mostrar en ese 404 un botón para crear la versión faltante, solo si hay token en `localStorage`.
- Abrir `/admin/` con el idioma destino, el slug y los datos del post de origen precargados.
- Copiar al crear la traducción: título, descripción, fecha, categoría, tags, featured y cuerpo; forzar `draft: true`.
- Añadir las claves de i18n del aviso y del botón en `en.json` y `es.json`.
- Actualizar `README.md` y las pruebas Playwright del admin y del 404.

**Out of scope (para futuras specs):**

- Crear el par `en`/`es` en un solo commit. Se elimina esa función.
- Sincronizar slugs o contenido entre traducciones después de crearlas.
- Generar una traducción automática o un archivo provisional en el otro idioma.
- Añadir un campo `translationKey` al frontmatter.
- Cambiar el fallback del selector de idioma, los `hreflang`, el sitemap o `check-posts` (SPEC 02 sigue vigente).
- Borrar, renombrar o cambiar el slug de un post creado.
- Subir imágenes, editar páginas fijas o tocar Pages CMS.
- Publicar automáticamente la traducción copiada.
- Autenticación distinta del PAT, SSR o backend propio.
- Detectar la versión faltante en el servidor o generar una ruta estática en la URL inexistente.

## Data model

Esta spec no añade estructuras persistentes ni campos de frontmatter. Reutiliza `PostFrontmatter` de SPEC 01 y el slug como única clave de emparejamiento de SPEC 02.

```ts
// src/lib/github-content.ts
export type CreatePostInput = {
  lang: PostLanguage;
  slug: string;
  frontmatter: PostFrontmatter;
  body: string;
};

export type CreatePostResult = {
  lang: PostLanguage;
  slug: string;
  path: string; // src/content/posts/{lang}/{slug}.md
  sha: string; // sha del archivo creado
  commitSha: string;
};

// Datos que el 404 envía a /admin/ para precargar el formulario.
export type CreatePostPrefill = {
  lang: PostLanguage; // idioma que se va a crear
  slug: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  category: Category;
  tags: string[];
  featured: boolean;
  body: string;
};
```

```ts
// src/lib/slug.ts
export const SLUG_MAX_LENGTH = 60;
export function slugify(title: string): string;
```

Reglas de `slugify()`:

1. Normaliza con `NFKD` y elimina los diacríticos: `Canción de otoño` → `cancion-de-otono`.
2. Pasa a minúsculas.
3. Sustituye cualquier secuencia que no sea `[a-z0-9]` por un guion.
4. Colapsa guiones repetidos y elimina los de los extremos.
5. Recorta a 60 caracteres en el último guion antes del límite y vuelve a quitar el guion final.
6. Si el resultado queda vacío, devuelve `""`; el formulario muestra el error de slug y no inventa un valor.

Contrato de la URL del admin:

```text
/admin/?new=1&lang=es&fromLang=en&fromSlug=welcome
```

- `new=1` abre **New post** en lugar del editor.
- `lang` es el idioma destino obligatorio (`en` o `es`).
- `fromLang` y `fromSlug` son opcionales. Si están presentes, el admin lee ese post con `getPost()` y precarga el formulario.
- Sin `fromLang`/`fromSlug` el formulario se abre con los valores por defecto y el idioma indicado.
- Tras crear o cancelar, se limpian todos los parámetros.

Índice embebido en el 404:

```ts
type MissingPostIndex = Record<PostLanguage, string[]>;
// { "en": ["welcome", "writing-with-markdown"], "es": ["welcome"] }
```

- Solo incluye posts publicados (`draft !== true`), es decir, datos que ya son públicos.
- No incluye títulos, descripciones ni cuerpos. El admin obtiene el contenido con `getPost()`.
- Se serializa con `JSON.stringify` y se escapan los `<` como `\u003c` antes de insertarlo en el HTML.
- Se genera en build; un post nuevo aparece en el 404 del siguiente despliegue.

Rutas reconocidas por el script del 404:

```text
/posts/<slug>/      → idioma en
/es/posts/<slug>/   → idioma es
```

Se ignoran las barras finales y cualquier otra ruta. El botón solo se muestra si:

1. La ruta coincide con el patrón anterior.
2. El slug existe en el índice del otro idioma.
3. `localStorage` contiene `grimorio.github.token`.

Convenciones:

- El `lang` del frontmatter coincide siempre con la carpeta.
- El commit de creación es `cms: create posts/{lang}/{slug}.md`.
- La fecha, categoría, tags y featured de la traducción se copian del post de origen.
- `draft` se fuerza a `true` al precargar una traducción, aunque el origen esté publicado.
- No se copia `updated`: un post recién creado no lo tiene.

## Implementation plan

1. Crear `src/lib/slug.ts` con `slugify()` y `SLUG_MAX_LENGTH`. Verificar con `pnpm check` y una prueba manual de títulos con acentos, `ñ`, signos y espacios.
2. En `src/lib/github-content.ts`, sustituir `createPostPair()` por `createPost()`: validar el slug, comprobar que `src/content/posts/{lang}/{slug}.md` no existe, serializar el frontmatter con `serializePost()` y hacer un `PUT` a la Contents API con `branch` y sin `sha`. Devolver `CreatePostResult`. Mapear el archivo existente a `GithubApiError(409, ...)`.
3. En `src/lib/frontmatter.ts`, eliminar `createPostFrontmatter()` y `PENDING_DESCRIPTIONS`, ya sin uso. Verificar `pnpm check` y `pnpm build`; el sitio no cambia.
4. Reescribir `src/components/admin/PostCreator.vue`:
   - Añadir selector de idioma `English`/`Spanish`.
   - Añadir los campos descripción, cuerpo, featured y draft; mantener título, fecha, categoría y tags.
   - Añadir el botón **Generate from title** junto al slug, deshabilitado si el título está vacío.
   - Añadir las pestañas Write/Preview con `MarkdownPreview`.
   - Aceptar una prop opcional `prefill: CreatePostPrefill` y volcar sus valores al montar.
   - Validar con `validateFrontmatter()` y llamar a `createPost()`.
   - Emitir `created` con el resultado; no abrir el editor.
5. En `src/components/admin/PostList.vue`, incluir el idioma activo en el evento `create` (`All` → `en`). En `AdminApp.vue`, usar ese idioma como valor inicial de `PostCreator`, quitar la apertura automática del editor tras crear, refrescar el listado y mostrar un aviso de éxito.
6. En `AdminApp.vue`, ampliar `openFromQuery()` para entender `new=1`, validar `lang`, leer `fromLang`/`fromSlug` con `getPost()` y abrir `PostCreator` con el `prefill` resultante (título, descripción, fecha, categoría, tags, featured y cuerpo). Si la lectura falla, abrir el formulario con idioma y slug y mostrar un aviso para rellenar el resto a mano. Mantener el comportamiento actual de `?lang=&slug=`.
7. En `src/components/MissingPage.astro`, generar el `MissingPostIndex` con `getPosts()` de ambos idiomas, renderizar un bloque oculto con el aviso y el enlace, y añadir un `<script>` que detecte la ruta, compruebe el índice y el token, construya `/admin/?new=1&lang=...&fromLang=...&fromSlug=...` y muestre el bloque. Añadir `error.createMissing` y `error.createPost` a `en.json` y `es.json`.
8. Actualizar `README.md`: el admin crea un post por idioma en un solo paso, el botón de slug, los toggles, el atajo del 404 y la nota de que la traducción se crea como borrador.
9. Actualizar `tests/admin.spec.ts`: comprobar el formulario completo, la generación de slug, que crear en inglés solo hace un `PUT` a `posts/en/...` y vuelve al listado, y que el 404 no muestra el botón sin token. Añadir una prueba con token y un índice interceptado que verifique el enlace a `/admin/?new=1&...`.
10. Ejecutar `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e`. Probar a mano un post de un solo idioma y el flujo del 404. Eliminar el contenido de prueba antes de cerrar la spec.

## Acceptance criteria

- [x] **New post** muestra selector de idioma, título, slug, botón **Generate from title**, descripción, fecha, categoría, tags, featured, draft y cuerpo con Write/Preview.
- [x] El idioma inicial es `en` con los filtros `All` y `English`, y `es` con el filtro `Spanish`.
- [x] Pulsar **Generate from title** con `Canción de otoño` rellena el slug con `cancion-de-otono`.
- [x] El slug generado sigue siendo editable y no se vuelve a sincronizar al cambiar el título.
- [x] Un título que genera un slug vacío deja el slug vacío y muestra el error de validación.
- [x] Crear un post en inglés escribe solo `src/content/posts/en/{slug}.md` en un único commit.
- [x] Crear un post en español escribe solo `src/content/posts/es/{slug}.md` en un único commit.
- [x] Si el archivo ya existe en el idioma elegido, la creación falla con un mensaje claro y no se crea ningún commit.
- [x] Si el slug solo existe en el otro idioma, la creación se permite.
- [x] La descripción, la fecha, la categoría y los tags se validan antes de escribir.
- [x] `draft` empieza marcado y `featured` desmarcado; ambos valores se guardan tal como quedan en el formulario.
- [x] Tras crear, se vuelve al listado, el post aparece y se muestra un aviso de éxito.
- [x] `/admin/` ya no crea el archivo del otro idioma.
- [x] En `/es/posts/{slug}/` de un post publicado solo en inglés, con token guardado, aparece el botón para crear la versión en español.
- [x] En `/posts/{slug}/` de un post publicado solo en español, con token guardado, aparece el botón para crear la versión en inglés.
- [x] Sin token guardado, el 404 se ve exactamente como antes y no muestra el botón.
- [x] Una ruta que no sea un post, o un slug sin versión en el otro idioma, no muestra el botón.
- [x] El botón abre el admin con el idioma destino y el slug correctos, y copia título, descripción, fecha, categoría, tags, featured y cuerpo del post de origen.
- [x] La traducción precargada abre con `draft` marcado y `lang` del idioma destino.
- [x] `README.md` documenta el flujo de un solo idioma y el atajo del 404.
- [x] `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e` pasan.
- [x] No queda contenido de prueba en `src/content/posts/`.

## Decisions

- **Sí:** un archivo por creación. Coincide con Pages CMS, con la traducción opcional de SPEC 02 y con la forma real de escribir un artículo.
- **Sí:** formulario completo con cuerpo y preview. Elimina el archivo provisional y el segundo paso de abrir el editor para escribir.
- **Sí:** selector de idioma explícito, inicializado con el filtro del listado. Es visible y no depende de un estado implícito.
- **Sí:** botón **Generate from title** en lugar de sincronización automática. Evita que el slug cambie mientras se corrige el título y no pisa un slug escrito a mano.
- **Sí:** slug sin acentos, en minúsculas, con guiones y máximo de 60 caracteres. Es el mismo patrón que valida el proyecto.
- **Sí:** sin eliminación de stopwords ni traducción de palabras. Un slug predecible vale más que uno "bonito".
- **Sí:** `createPost()` con la Contents API. La Git Data API solo era necesaria para escribir dos archivos de forma atómica.
- **Sí:** comprobar la existencia antes del `PUT`. Devuelve un 409 claro en vez de depender del 422 genérico de GitHub.
- **Sí:** volver al listado con aviso. Crear es una acción completa; el editor se abre solo cuando se quiere retocar.
- **Sí:** `draft: true` por defecto. Un post creado puede estar incompleto y no debe publicarse sin revisión.
- **Sí:** el 404 embebe solo slugs publicados. Es información ya pública y evita un endpoint o una petición extra.
- **Sí:** el botón del 404 solo aparece con token. Es coherente con el botón **Edit** y no invita a visitantes anónimos a una pantalla de login.
- **Sí:** copiar todos los campos y el cuerpo al crear la traducción. El autor traduce sobre una base completa y el `draft: true` evita publicar texto sin traducir.
- **Sí:** mantener el fallback del selector de idioma de SPEC 02. El 404 con botón cubre enlaces antiguos y visitas directas sin romper la navegación normal.
- **No:** crear el par bilingüe. Contradice la traducción opcional y genera archivos que nadie pidió.
- **No:** incluir borradores en el índice del 404. Expondría slugs no publicados; si el idioma destino ya tiene un borrador, el 409 al crear lo explica.
- **No:** generar una página en la URL inexistente. Dejaría de ser un 404 real y complicaría el enrutado estático.
- **No:** traducción automática, `translationKey`, imágenes, borrado, renombrado o cambios en el selector, `hreflang` o sitemap.

## Risks

| Risk                                                                 | Mitigation                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| La traducción copiada se publica sin traducir                        | El prefill fuerza `draft: true`; el autor debe revisar y desmarcarlo.                                  |
| El slug generado no representa bien títulos con emojis o CJK         | Si `slugify()` devuelve vacío, el formulario exige escribirlo a mano.                                  |
| El índice del 404 crece con el número de posts                       | Solo guarda slugs, no contenido; el HTML sigue siendo pequeño para un blog personal.                   |
| Un borrador ya existe en el idioma destino y el botón ofrece crearlo | El `PUT` devuelve 409 con el mensaje de archivo existente; el autor abre el borrador desde el listado. |
| La lectura del post de origen falla al abrir el admin                | El formulario se abre con idioma y slug, muestra un aviso y permite rellenar el resto a mano.          |
| Dos pestañas crean el mismo slug a la vez                            | La comprobación previa y el 422/409 de GitHub impiden el segundo commit.                               |
| Un `PUT` sin `sha` sobrescribe un archivo existente                  | Se comprueba la existencia antes y GitHub rechaza la creación sin `sha` si el archivo ya está ahí.     |
| El 404 no muestra el botón sin JavaScript                            | El bloque nace oculto; el 404 normal sigue funcionando y el botón es una mejora progresiva.            |
| El HTML del 404 filtra información no pública                        | El índice solo contiene slugs de posts publicados, que ya aparecen en el sitemap y en los listados.    |

## What is **not** in this spec

- Crear ambos idiomas a la vez.
- Traducciones automáticas o archivos provisionales.
- Un campo `translationKey` en el frontmatter.
- Cambiar el selector de idioma, los `hreflang`, el sitemap o `check-posts`.
- Publicar automáticamente la versión creada desde el 404.
- Subida de imágenes, borrado, renombrado o edición del slug posterior.
- Cambios en Pages CMS.
- SSR, OAuth o un backend proxy.

Cada uno de esos puntos, si se implementa, va en su propia spec.
