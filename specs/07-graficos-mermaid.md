# SPEC 07 — Diagramas Mermaid en los posts

> **Status:** Implemented
> **Depends on:** SPEC 01
> **Date:** 2026-11-27
> **Objective:** Renderizar los fences `mermaid` de los posts como diagramas SVG en el artículo y en la preview de `/admin/`, siguiendo el tema claro/oscuro y conservando el código fuente como fallback.

## Por qué existe esta spec

El sitio ya acepta fences `mermaid` en el contenido, pero el pipeline de Astro los trata como código: Shiki los resalta con su gramática de Mermaid y el lector ve el texto del diagrama en vez del diagrama. Hoy hay cuatro bloques `mermaid` en el post de Pages CMS (`en`/`es`) y un diagrama de arquitectura en ASCII en `como-construimos-admin-de-pat-a-github-app.md` que el autor seleccionó para convertir.

Además, el bloque de EN de Pages CMS está truncado: un ` ``` DB ` mal cerrado parte el flowchart y deja el resto de las aristas como un párrafo. La spec no solo añade la presentación; también corrige ese contenido.

## Scope

**In:**

- Añadir `mermaid@^11` como dependencia de producción.
- Excluir `mermaid` del resaltado de Shiki en `astro.config.mjs`, conservando la exclusión por defecto de `math`.
- Helper de cliente `src/scripts/mermaid.ts` con `createMermaidRenderer()`: detecta `pre > code.language-mermaid`, importa Mermaid con `import()` diferido, renderiza en cola, re-renderiza al cambiar de tema y expone `render()`/`destroy()`.
- Enganchar el helper en el `<script>` de `src/pages/[...lang]/posts/[id].astro`, solo cuando la página contiene fences `mermaid`.
- Estilos en `src/styles/global.css`: figura, contenedor con scroll horizontal, SVG responsive, botón de fuente y aviso de error.
- Etiquetas en `src/i18n/en.json` y `src/i18n/es.json`: `article.diagramSource`, `article.diagramSourceHide`, `article.diagramError`, `article.diagramLabel`.
- Preview de `/admin/` con Mermaid: `src/components/admin/MarkdownPreview.vue` usa el mismo helper al montar y al cambiar el Markdown.
- No añadir el botón **Copy** a los bloques `mermaid`.
- Corregir el fence roto de `src/content/posts/en/como-desplegar-pagescms-selfhosted-gratis-vercel-neon-github.md`.
- Migrar el diagrama ASCII de `src/content/posts/es/como-construimos-admin-de-pat-a-github-app.md` (líneas 57–76) a `sequenceDiagram`, con `autonumber` y `accTitle`.
- Documentar la sintaxis en `src/content/posts/{en,es}/writing-with-markdown.md` y en `README.md`.
- Adaptar `tests/posts.ts`: contar `diagrams` por separado y excluir `mermaid` de `codeBlocks`.
- Tests E2E en `tests/blog.spec.ts` y `tests/admin.spec.ts`.

**Out of scope (para futuras specs):**

- Generar el SVG en build con un navegador headless.
- Diagramas dentro de RSS, `llms.txt` o la preview de Pages CMS.
- Zoom, pan, pantalla completa, exportar PNG/SVG o compartir un diagrama suelto.
- Temas personalizados de Mermaid con la paleta del sitio (`themeVariables`).
- Migrar el resto de los fences ` ```text ` (árbol de `localStorage`, diagramas de cajas de Pages CMS).
- Validar la sintaxis Mermaid en `pnpm check` o en el editor.
- Diagramas como imagen OG o portada.
- Cargar Mermaid en páginas sin diagramas.

## Data model

Esta spec no introduce datos persistidos. Define un contrato de DOM, una configuración y un cambio en el fixture de los tests.

API del helper:

```ts
// src/scripts/mermaid.ts
export type MermaidLabels = {
  viewSource: string;
  hideSource: string;
  error: string;
  diagram: string; // aria-label de reserva cuando el SVG no trae <title>
};

export function createMermaidRenderer(options: {
  root: ParentNode;
  labels: MermaidLabels;
}): {
  render: () => Promise<void>;
  destroy: () => void;
};
```

Contrato de DOM tras un render correcto:

```html
<pre hidden><code class="language-mermaid">sequenceDiagram …</code></pre>
<figure
  class="mermaid-diagram"
  data-mermaid-state="rendered"
  data-mermaid-theme="light"
>
  <div class="mermaid-canvas"><svg …></svg></div>
  <button type="button" class="mermaid-source-toggle" aria-expanded="false">
    View diagram source
  </button>
</figure>
```

Estados y convenciones:

- `data-mermaid-state`: `rendered` o `error`.
- `data-mermaid-theme`: `light` o `dark`, para que los tests comprueben el re-render.
- El `<pre>` original no se elimina: queda oculto con `hidden` y el botón lo muestra/oculta con `aria-expanded`.
- En estado `error` la figura contiene `<p class="mermaid-error" role="status">` con la etiqueta `error`; el `<pre>` sigue visible.
- Cada figura recibe un id monotónico `mermaid-diagram-{n}` para `mermaid.render()`.
- Si el SVG no trae `<title>` ni `aria-label`, el helper le pone `role="img"` y `aria-label={labels.diagram}`.

Configuración de Mermaid:

```ts
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  // Windows Chromium mismeasures HTML labels inside foreignObject; SVG text
  // is stable everywhere.
  htmlLabels: false,
  theme: isDark ? "dark" : "default",
  fontFamily: FONT_FAMILY, // "IBM Plex Sans Variable, system-ui, sans-serif"
});
```

Fixture de tests:

````ts
// tests/posts.ts
type PostFixture = {
  // …
  diagrams: number; // fences ```mermaid
  codeBlocks: number; // fences restantes (los que llevan botón Copy)
};
````

Convenciones:

- La renderización es secuencial (`for … of` con `await`): Mermaid comparte estado global y no admite dos `render()` en paralelo con seguridad.
- Un contador por figura descarta resultados de una pasada de tema anterior.
- `render()` es idempotente: no duplica figuras ni botones; reutiliza el texto fuente del `<code>`.
- El `import("mermaid")` solo se ejecuta si `root` contiene `code.language-mermaid`.
- La preview de `/admin/` usa las etiquetas en inglés con `useTranslations("en")`, porque `/admin/` es solo inglés.
- Antes del primer render se espera a `document.fonts.ready` (y `document.fonts.load` de la fuente del diagrama): Mermaid mide las etiquetas de forma síncrona y el layout debe coincidir con la fuente mostrada.
- Tras renderizar se comprueba el `viewBox`: si alguna dimensión supera **6 000 px**, el layout se considera roto (medición defectuosa del navegador): estado `error`, aviso con `role="status"`, fuente visible y `console.warn`; nunca se inserta el SVG gigante.

## Implementation plan

1. Añadir `mermaid@^11` con `pnpm add mermaid` y verificar que `pnpm check` y `pnpm build` siguen pasando sin cambios visibles.
2. En `astro.config.mjs`, añadir `markdown.syntaxHighlight = { type: "shiki", excludeLangs: ["math", "mermaid"] }`. Verificar en el build que el fence de Pages CMS pasa a `<pre><code class="language-mermaid">` sin clases `astro-code`. Comprobar que los bloques normales siguen resaltados.
3. Crear `src/scripts/mermaid.ts` con `createMermaidRenderer()`: búsqueda de fences, import diferido, cola de render, botón de fuente, estado de error, nombre accesible y `MutationObserver` sobre la clase de `<html>`. Engancharlo en el `<script>` de `[id].astro` y verificar en `pnpm dev` sobre `/es/posts/como-desplegar-pagescms-selfhosted-gratis-vercel-neon-github/`: dos SVG, fuente oculta y toggle funcional.
4. Añadir las cuatro claves de i18n en `en.json`/`es.json` y los estilos de `.mermaid-diagram`, `.mermaid-canvas`, `.mermaid-source-toggle` y `.mermaid-error` en `global.css`. Verificar claro/oscuro y que a 375 px la página no gana scroll horizontal.
5. En el script de `[id].astro`, saltar los bloques `language-mermaid` al inyectar el botón **Copy**. Verificar que los bloques normales conservan su botón y que los diagramas no lo tienen.
6. En `MarkdownPreview.vue`, crear el renderer en `onMounted`, volver a llamar a `render()` tras cada actualización de `props.markdown` (`watch` + `nextTick`) y llamar a `destroy()` en `onBeforeUnmount`. Mantener DOMPurify como está: el SVG se inyecta con la API del DOM, no con `v-html`. Verificar en `/admin/` con un post de prueba con un diagrama válido y otro inválido.
7. Corregir el fence de EN a `API <-->|"3. Read/encrypt tokens"| DB` y migrar el ASCII de `como-construimos-admin-de-pat-a-github-app.md` a `sequenceDiagram` con participantes `Navegador`, `Worker` y `GitHub`, conservando los mensajes del original (login, authorize, callback, canje, KV, cookie, sesión y `fetch`). Añadir `## Diagrams` / `## Diagramas` a `writing-with-markdown` en ambos idiomas con un ejemplo mínimo.
8. Ajustar `tests/posts.ts` (`diagrams` y `codeBlocks`) y añadir los tests E2E: render en ambos idiomas, fuente oculta y toggle, tema, ausencia del botón Copy, fuente visible sin JavaScript, ancho en móvil y preview del admin con sintaxis válida e inválida. Ejecutar `pnpm test:e2e`.
9. Actualizar `README.md` (sintaxis, carga diferida, tema, fallback, preview del admin y límite en feeds) y verificar `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e`.

## Acceptance criteria

- [ ] El post de Pages CMS muestra dos `figure.mermaid-diagram[data-mermaid-state="rendered"]` con `<svg>` en `/posts/…/` y en `/es/posts/…/`.
- [ ] En el post de EN, la arista `API <-->|"3. Read/encrypt tokens"| DB` y la arista `6. Push event` forman parte del mismo diagrama; no queda ninguna línea `API -->…` como párrafo.
- [ ] El diagrama de `como-construimos-admin-de-pat-a-github-app.md` se renderiza como `sequenceDiagram` y conserva los mensajes del ASCII original.
- [ ] Los bloques `mermaid` no muestran el botón **Copy**; los bloques de código normales lo conservan.
- [ ] Tras renderizar, el `<pre>` fuente está oculto; **View diagram source** lo muestra y lo vuelve a ocultar con `aria-expanded` correcto.
- [ ] Sin JavaScript, el texto del fence `mermaid` sigue visible en `#article-body`.
- [ ] Al cambiar a tema oscuro, cada figura pasa a `data-mermaid-theme="dark"` y vuelve a tener `<svg>` sin errores en consola.
- [ ] El motor de Mermaid (`mermaid.core`, `mermaid-parser`, chunks de diagramas) no se descarga en páginas sin diagramas (`/`, `/about/`, `/posts/welcome/`); solo se carga el chunk-facade de ~5 KB que genera Vite.
- [ ] En `/admin/`, la preview de un post con un fence `mermaid` válido muestra el `<svg>`; con sintaxis inválida muestra el código y un aviso con `role="status"`, sin romper la edición.
- [ ] Cada `<svg>` renderizado tiene nombre accesible (`<title>` de `accTitle` o `aria-label`).
- [ ] A 375 px el artículo no genera scroll horizontal.
- [ ] El flowchart ancho se muestra a escala 1:1 (`width` = ancho del `viewBox`) y su contenedor activa scroll horizontal en vez de encoger el texto.
- [ ] Los flowcharts usan etiquetas de texto SVG: ningún `<svg>` de diagrama contiene `foreignObject`.
- [ ] Un layout con `viewBox` mayor que 6 000 px se trata como error: aviso con `role="status"`, fuente visible y sin SVG insertado (test con motor falso).
- [ ] `writing-with-markdown` (EN/ES) documenta la sintaxis y su ejemplo se renderiza.
- [ ] `README.md` documenta la sintaxis, la carga diferida, el tema, el fallback y el límite en feeds.
- [ ] `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e` pasan.

## Decisions

- **Sí:** render en cliente con `import()` diferido. No toca el pipeline de Astro 7 (Sätteri) ni el build, y el coste se paga solo en las páginas con diagramas. Un SVG en build exigiría Chromium en el workflow Deploy.
- **Sí:** excluir `mermaid` de Shiki. Sin la exclusión, el fence no se distingue de un bloque resaltado y el fallback sin JS muestra colores de código; además se evita resaltar una gramática que no se usa.
- **Sí:** un helper compartido entre artículo y admin. Un único camino de render, cola y tema; la preview no reimplementa la lógica.
- **Sí:** renderizar en la preview de `/admin/`. El autor necesita ver el diagrama antes del commit; es la superficie donde más se equivoca en la sintaxis.
- **Sí:** seguir el tema del sitio con re-render. Un diagrama claro sobre fondo oscuro se lee mal; Mermaid ya trae temas `default` y `dark` mantenidos.
- **Sí:** conservar el `<pre>` y ofrecer toggle. Cubre el test de lectura sin JavaScript y deja el fuente a un clic si el diagrama no convence.
- **Sí:** `securityLevel: "strict"`. El autor es de confianza, pero el contenido también pasa por Pages CMS; strict desactiva HTML y clics dentro del SVG.
- **Sí:** no ampliar el perfil de DOMPurify. El SVG se inyecta con la API del DOM tras `mermaid.render()`, no con `v-html`, y Mermaid sanea las etiquetas con strict.
- **Sí:** cola de render y token por figura. Mermaid usa estado global; dos renders simultáneos o un cambio de tema a mitad de render producen SVG corruptos.
- **Sí:** aceptar el chunk-facade de ~5 KB. El import dinámico de `mermaid` produce un chunk (`mermaid.*.js`) que Vite enlaza estáticamente en las páginas de post; contiene solo el mapa de dependencias del preload, sin código de Mermaid. El motor real (85 KB + chunks de diagramas) se pide solo donde hay diagramas.
- **Sí:** tamaño natural con scroll horizontal. El SVG se post-procesa tras el render: `width` se fija al ancho del `viewBox` y se retira el `max-width`, de modo que un diagrama ancho se lee a escala 1:1 y el contenedor hace scroll (igual que los bloques de código). Encoger el SVG al ancho de la columna dejaba el texto ilegible en flowcharts anchos. El post-proceso es genérico y no exige configurar `useMaxWidth` tipo a tipo.
- **Sí:** `htmlLabels: false` global. En Chromium de Windows la medición de etiquetas HTML dentro de `foreignObject` produce layouts absurdos (16 500 × 16 528 px en producción) mientras los diagramas de secuencia (texto SVG) se ven bien; con etiquetas SVG el mismo contenido se renderiza correctamente y `<br/>` sigue funcionando. Verificado con las fuentes reales.
- **Sí:** `fontFamily` como cadena simple sin comillas (`IBM Plex Sans Variable, system-ui, sans-serif`). Evita diferencias de serialización del stack CSS entre navegadores; la medición y la visualización usan la misma fuente.
- **Sí:** guarda de 6 000 px tras el render. Un layout absurdo no debe aparecer nunca como un canvas gigante: se degrada a estado `error` con la fuente visible, igual que un error de sintaxis.
- **Sí:** arreglar el fence de EN y migrar solo el diagrama seleccionado. Son los dos casos que el autor ya señaló; migrar todo el ASCII es trabajo editorial con riesgo de perder matices.
- **No:** SVG en build. Añade un navegador headless al workflow Deploy y hace el build más lento y frágil por un beneficio marginal en un blog personal.
- **No:** SVG o HTML renderizado en RSS/`llms.txt`. Muchos lectores ignoran SVG inline; el fence es una representación textual honesta del diagrama.
- **No:** zoom, pan o exportar. El navegador ya permite ampliar; añadir controles obliga a gestionarlos con teclado y a mantener una librería más.
- **No:** temas de Mermaid con la paleta del sitio. Los colores derivados de Mermaid (`primaryBorderColor`, `lineColor`, etc.) hacen impredecible el contraste; los temas integrados están probados.
- **No:** validar Mermaid en `pnpm check`. El parser real corre en el navegador; replicarlo en Node añade una dependencia y otro motor de render.
- **No:** Mermaid en la preview de Pages CMS. Pages CMS renderiza su propia preview fuera de este repositorio.

## Risks

| Risk                                                        | Mitigation                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El chunk de Mermaid pesa ~1 MB sin comprimir                | Import diferido solo cuando hay diagramas; el `<pre>` sigue visible hasta que el SVG está listo, así que no hay hueco en blanco.                                 |
| Mermaid comparte estado global entre renders                | Render secuencial en cola y `initialize()` antes de cada lote.                                                                                                   |
| El usuario cambia de tema mientras un diagrama se renderiza | Contador por figura: solo se aplica el resultado de la última pasada.                                                                                            |
| Sintaxis Mermaid inválida                                   | Estado `error`, fuente visible y aviso con `role="status"`; `console.warn` en lugar de `console.error` para no romper el test de consola.                        |
| Dos diagramas generan ids repetidos                         | Contador monotónico `mermaid-diagram-N` por página/preview.                                                                                                      |
| Un diagrama ancho rompe el layout móvil                     | `.mermaid-canvas` con `overflow-x: auto`: el diagrama se muestra a escala 1:1 y hace scroll dentro del contenedor; el test de layout ya comprueba `scrollWidth`. |
| El fixture de `codeBlocks` deja de cuadrar                  | `tests/posts.ts` separa `diagrams` de `codeBlocks`; el test de `.copy-code` sigue usando solo bloques de código.                                                 |
| El SVG inyectado escapa al saneado de la preview            | `securityLevel: "strict"` en Mermaid y SVG insertado con `createElement`, nunca con `v-html`.                                                                    |
| Un error de render bloquea el resto de la página            | Cada figura captura su error; un diagrama roto no impide renderizar los demás.                                                                                   |
| Un navegador mide mal las etiquetas HTML (Windows Chromium) | `htmlLabels: false` (texto SVG) y guarda de 6 000 px: el diagrama degrada a estado `error` con la fuente visible, nunca un canvas de 16 000 px.                  |
| La fuente web carga después de la medición de Mermaid       | `document.fonts.ready` + `fonts.load` antes del primer render; medición y visualización usan la misma fuente.                                                    |

## What is **not** in this spec

- SVG generado en build.
- Diagramas en RSS, `llms.txt` o Pages CMS.
- Zoom, pan, pantalla completa o exportación.
- Temas personalizados de Mermaid.
- Migrar el resto de los diagramas ASCII.
- Validación de sintaxis en `pnpm check` o en el editor.
- Imágenes OG generadas a partir de diagramas.

Cada uno de esos puntos, si se implementa, va en su propia spec.
