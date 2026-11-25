# SPEC 02 — Pages CMS y traducciones opcionales

> **Status:** Approved
> **Depends on:** SPEC 01
> **Date:** 2026-11-24
> **Objective:** Añadir Pages CMS como editor alternativo y hacer opcional la traducción de cada post, sin cambiar el modelo de contenido ni el editor `/admin/`.

## Por qué existe esta spec

SPEC 01 resolvió la edición sin infraestructura con `/admin/` y un PAT. Pages CMS cubre dos huecos que ese editor no tiene: subida de imágenes y edición visual, usando el mismo repositorio de GitHub y sin backend propio.

Pages CMS edita una entrada por archivo. Hoy `check-posts` obliga a que cada post tenga su pareja en el otro idioma, así que un post creado desde Pages CMS rompería el build hasta crear la traducción. El proyecto quiere permitir posts en un solo idioma sin que eso sea un error.

## Scope

**In:**

- Añadir `.pages.yml` en la raíz con `media`, `settings` y dos colecciones: `src/content/posts/en` y `src/content/posts/es`.
- Configurar la subida de imágenes a `public/covers` y la escritura de URLs `/covers/...`.
- Mapear todos los campos del esquema actual: `title`, `description`, `date`, `updated`, `lang`, `category`, `tags`, `featured`, `draft` y `body`.
- Rellenar `lang` con un campo oculto y un `default` distinto por colección.
- Permitir crear, renombrar y borrar entradas desde Pages CMS (valores por defecto de `operations`).
- Mantener `/admin/` sin cambios de comportamiento, incluida la creación de ambos idiomas en un solo commit.
- Permitir crear posts desde Pages CMS (un idioma) y desde `/admin/` (ambos idiomas).
- Cambiar `scripts/check-posts.mjs`: la falta de traducción pasa a ser un aviso, no un error.
- Mantener como error que `lang` no coincida con la carpeta.
- Mantener como aviso que un par existente tenga estados `draft` distintos.
- Hacer que el selector de idioma navegue a la traducción exacta si existe; si no, al listado `/posts/` del otro idioma.
- Emitir `hreflang`, `x-default` y `og:locale:alternate` solo para idiomas con una página publicada.
- Filtrar los `links` alternativos del sitemap para no apuntar a posts que no existen.
- Documentar Pages CMS, la traducción opcional y el comportamiento del selector en `README.md`.
- Ampliar las pruebas Playwright del selector de idioma y de los `hreflang` en un post emparejado.

**Out of scope (para futuras specs):**

- Eliminar o reescribir `/admin/`.
- Crear posts de un solo idioma desde `/admin/`; seguirá creando el par.
- Generar automáticamente una traducción o un archivo provisional.
- Añadir un campo `translationKey` al frontmatter.
- Editar `about`, `projects`, la home o `src/site.config.json` desde Pages CMS.
- Subir imágenes desde `/admin/`.
- Autoalojar Pages CMS o integrarlo dentro del dominio del sitio.
- Usuarios, roles, permisos o auditoría dentro de Pages CMS.
- Publicación programada, Pull Requests o ramas de borrador.
- Redirecciones 301 para slugs renombrados.
- Cambiar el esquema de frontmatter o las URLs del sitio.

## Data model

### `.pages.yml`

La colección inglesa queda así; la española es idéntica salvo `name: posts-es`, `label: Español`, `path: src/content/posts/es` y `default: es` en `lang`.

```yaml
media:
  input: public/covers
  output: /covers
  rename: safe
  extensions: [jpg, jpeg, png, webp, avif, gif, svg]

settings:
  commit:
    identity: user
    templates:
      create: "cms: add {path}"
      update: "cms: update {path}"
      delete: "cms: delete {path}"
      rename: "cms: rename {oldPath} -> {newPath}"

content:
  - name: posts
    label: Posts
    type: group
    items:
      - name: posts-en
        label: English
        type: collection
        path: src/content/posts/en
        format: yaml-frontmatter
        filename:
          template: "{primary}.md"
          field: create
        view:
          fields: [date, title, category, draft, featured]
          primary: title
          sort: [date, title]
          search: [title, description, tags]
          default:
            sort: date
            order: desc
        fields:
          - name: title
            type: string
            required: true
            options:
              maxlength: 120
          - name: description
            type: text
            required: true
            options:
              maxlength: 300
          - name: date
            type: date
            required: true
            options:
              format: yyyy-MM-dd
          - name: updated
            type: date
            default: ""
            options:
              format: yyyy-MM-dd
          - name: lang
            type: string
            hidden: true
            default: en
          - name: category
            type: select
            options:
              values: [guides, notes, stories]
          - name: tags
            type: string
            list: true
          - name: featured
            type: boolean
            default: false
          - name: draft
            type: boolean
            default: false
          - name: body
            type: rich-text
            options:
              format: markdown
              switcher: true
```

Convenciones:

- No se declara `operations`: `create`, `rename` y `delete` quedan habilitados por defecto.
- `draft: false` como valor inicial evita convertir en borrador un post antiguo que no tenga el campo al guardarlo desde Pages CMS.
- `updated` vacío se elimina al serializar; el esquema de Astro sigue aceptando su ausencia.
- El slug es la única clave de emparejamiento. Dos archivos con el mismo nombre en `en/` y `es/` son traducciones.
- Un post está publicado cuando `draft` no es `true`.
- Renombrar un archivo en Pages CMS cambia su slug y deja de emparejarlo con la traducción; es un efecto aceptado.

### Traducciones disponibles

```ts
// src/lib/posts.ts
export async function getPostLanguages(id: string): Promise<Language[]>;
```

Devuelve los idiomas que tienen un post publicado con ese `id`. Los borradores no cuentan porque no generan página.

No se añaden campos ni estructuras persistentes nuevas. El contenido sigue siendo Markdown con el frontmatter de SPEC 01.

## Implementation plan

1. Crear `.pages.yml` con `media`, `settings` y el grupo `Posts` con las colecciones `posts-en` y `posts-es`. Verificar con `pnpm exec prettier --check .pages.yml` y `pnpm build`; el sitio no cambia.
2. Cambiar `scripts/check-posts.mjs`: si falta la pareja de un post publicado, añadir un `warning` en lugar de un `problem`. Mantener el error de `lang` y el aviso de `draft` distinto. Ajustar el mensaje final. Verificar moviendo temporalmente un archivo de `es/`: el script sale con código 0 y muestra el aviso; un `lang` incorrecto sigue saliendo con código 1.
3. Añadir `getPostLanguages(id)` a `src/lib/posts.ts` usando `getPosts(lang)` para cada idioma. Verificar con `pnpm check`.
4. Actualizar `src/layouts/BaseLayout.astro`: calcular los idiomas disponibles, limitar `hreflang`, `x-default` y `og:locale:alternate` a esos idiomas, y pasar `languageUrl` a `Navigation`. Verificar en un post emparejado que siguen apareciendo los dos `hreflang`.
5. Actualizar `src/components/header/Navigation.vue`: recibir `languageUrl` como prop y eliminar el cálculo local con `stripLanguage`. Verificar que el selector sigue llevando a la traducción exacta en un post emparejado.
6. Para un post sin traducción, calcular `languageUrl` como `localizePath(otroIdioma, "/posts/")` y mantener la ruta normal en el resto de páginas. Verificar a mano en una rama con un post de un solo idioma.
7. Actualizar el `serialize` de `astro.config.mjs` para filtrar `item.links` contra las rutas publicadas: claves de `lastModified` más `/`, `/about/`, `/projects/`, `/posts/` y sus equivalentes en `/es/`. Verificar que el sitemap de un post sin traducción no incluye el `link` al idioma inexistente.
8. Actualizar `README.md`: traducción opcional, comportamiento del selector, sección de Pages CMS con login, GitHub App, imágenes, renombrado/borrado y limitaciones, y la frase de CI que menciona el emparejamiento.
9. Añadir a `tests/blog.spec.ts` comprobaciones de `hreflang` en un post emparejado y mantener el test del selector entre `/posts/welcome/` y `/es/posts/welcome/`. Ejecutar `pnpm test:e2e`.
10. Probar Pages CMS en una rama: iniciar sesión, instalar la GitHub App solo para este repositorio, editar y guardar un post, subir una imagen, crear un post en un solo idioma, renombrarlo y borrarlo. Revisar el diff y ejecutar `pnpm check` y `pnpm build`.
11. Ejecutar `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e`. Eliminar el contenido de prueba usado en los pasos manuales.

## Acceptance criteria

- [ ] `.pages.yml` existe en la raíz y Pages CMS lo carga sin errores de configuración.
- [ ] Pages CMS muestra las colecciones English y Español con todos los posts existentes, incluidos los `draft: true`.
- [ ] Editar y guardar un post conserva el cuerpo, escribe `lang` correcto y respeta `updated` vacío.
- [ ] Subir una imagen la guarda en `public/covers` e inserta una URL `/covers/...` en el Markdown.
- [ ] Crear, renombrar y borrar entradas está disponible en Pages CMS y funciona.
- [ ] Un post creado solo en un idioma se publica sin el archivo del otro idioma.
- [ ] `pnpm check:posts` sale con código 0 y muestra un aviso por cada post publicado sin traducción.
- [ ] Un `lang` que no coincide con la carpeta sigue siendo un error de `pnpm check:posts`.
- [ ] Un post sin traducción aparece en su listado, su RSS y su sitemap, y no genera una ruta en el otro idioma.
- [ ] En un post sin traducción, el selector de idioma lleva al listado `/posts/` del otro idioma, no a un 404.
- [ ] Los `hreflang`, `x-default` y `og:locale:alternate` solo incluyen idiomas con página publicada.
- [ ] El sitemap de un post sin traducción no incluye un `link` alternativo al idioma inexistente.
- [ ] Un post emparejado conserva el comportamiento actual: el selector lleva a la traducción exacta.
- [ ] `/admin/` sigue creando ambos archivos en un solo commit y no cambia su comportamiento.
- [ ] `README.md` documenta Pages CMS, la traducción opcional y el selector con fallback.
- [ ] `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e` pasan.

## Decisions

- **Sí:** Pages CMS convive con `/admin/`. Pages CMS aporta imágenes y edición visual; `/admin/` sigue siendo la vía rápida para crear el par bilingüe en un commit.
- **Sí:** Pages CMS alojado en `app.pagescms.org`. Es gratuito y MIT; autoalojarlo añade infraestructura sin una necesidad actual.
- **Sí:** permitir renombrar y borrar desde Pages CMS. Es una decisión explícita del proyecto; el coste es que renombrar un lado rompe el emparejamiento y borrar un lado deja el otro.
- **Sí:** la falta de traducción es un aviso, no un error. Era el objetivo principal de esta spec.
- **Sí:** avisar solo de posts publicados sin pareja. Un borrador sin traducir es un estado normal y no debe llenar la salida de `pnpm check`.
- **Sí:** selector con fallback al listado `/posts/` del otro idioma. Evita un 404 y mantiene el cambio de idioma útil.
- **Sí:** filtrar `hreflang`, `x-default`, `og:locale:alternate` y los `links` del sitemap. Un alternativo a una página inexistente es peor que no tener alternativo.
- **Sí:** el slug sigue siendo la clave de emparejamiento. Evita migrar contenido y mantener dos fuentes de verdad.
- **Sí:** `/admin/` sigue creando ambos idiomas. No se toca su comportamiento en esta spec.
- **Sí:** `draft: false` por defecto en Pages CMS. Evita que el primer guardado de un post antiguo lo oculte.
- **Sí:** `body` como rich-text Markdown con conmutador a fuente. Permite imágenes y conserva la edición manual del Markdown.
- **No:** crear un archivo provisional en el otro idioma. Generaría contenido vacío y traducciones fantasma.
- **No:** añadir `translationKey` al frontmatter. El slug ya resuelve el caso actual.
- **No:** redirecciones para slugs renombrados. Requiere generar reglas y no hay URLs públicas que lo justifiquen todavía.
- **No:** editar contenido que no sean posts desde Pages CMS. Las páginas fijas y los proyectos merecen su propia spec.

## Risks

| Risk                                                         | Mitigation                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Pages CMS reformatea el frontmatter o el Markdown al guardar | Probar en una rama, revisar el diff y usar el conmutador a fuente para cuerpos delicados.       |
| Renombrar o borrar un archivo rompe el emparejamiento        | Es un efecto aceptado; documentarlo y recuperar desde Git si fue un error.                      |
| `.pages.yml` se desincroniza del esquema de Astro            | Mantener los campos alineados; `pnpm check` y el build fallan si el contenido no valida.        |
| Un `hreflang` o `link` del sitemap apunta a un 404           | Calcular los idiomas disponibles en build y filtrar alternativos.                               |
| Regresión del selector de idioma                             | Tests Playwright en un post emparejado y prueba manual en una rama con un post sin traducción.  |
| Dos editores guardan a la vez                                | `/admin/` usa `sha`; Pages CMS gestiona conflictos. Evitar editar el mismo archivo en paralelo. |
| Dependencia del servicio alojado de Pages CMS                | `/admin/`, el editor local y Git siguen funcionando; la configuración vive en el repositorio.   |
| Primer guardado de un post antiguo añade `draft: false`      | Es el valor por defecto del esquema y no cambia la visibilidad.                                 |

## What is **not** in this spec

- Sustituir o eliminar `/admin/`.
- Crear posts de un solo idioma desde `/admin/`.
- Traducciones automáticas o archivos provisionales.
- Un campo `translationKey` en el frontmatter.
- Gestión de imágenes desde `/admin/`.
- Edición de páginas fijas o proyectos desde Pages CMS.
- Autoalojar Pages CMS.
- Roles, permisos o auditoría.
- Redirecciones para slugs renombrados.
- Cambios en el esquema de frontmatter o en las URLs.

Cada uno de esos puntos, si se implementa, va en su propia spec.
