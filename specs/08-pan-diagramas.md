# SPEC 08 — Pan por arrastre en diagramas

> **Status:** Approved
> **Depends on:** SPEC 07
> **Date:** 2026-11-28
> **Objective:** Permitir desplazar con el puntero (ratón, lápiz o táctil) los diagramas que desbordan su contenedor, sin sustituir la scrollbar ni el teclado.

## Por qué existe esta spec

SPEC 07 dejó fuera el pan: los diagramas anchos se leen a escala 1:1 con `overflow-x: auto`, y desplazarlos con la scrollbar es incómodo. La scrollbar nativa se conserva como pista visual; el arrastre es el atajo. Este spec traslada a SPEC 08 el punto "Zoom, pan, pantalla completa…" que SPEC 07 declaró fuera de alcance, pero solo el pan: zoom y pantalla completa siguen fuera.

## Scope

**In:**

- Pan por arrastre con Pointer Events sobre `.mermaid-canvas`, horizontal y vertical, solo cuando hay overflow (`scrollWidth > clientWidth || scrollHeight > clientHeight`).
- `touch-action: pan-y` en el canvas: el gesto horizontal panea el diagrama y el vertical sigue scrolleando la página.
- Estado visual: `cursor: grab` en canvas desplazable, `grabbing` mientras se arrastra, `user-select: none` durante el pan.
- Accesibilidad: `role="region"` + `aria-label` (reutilizando `article.diagramLabel`) y `tabindex="0"` solo cuando hay overflow, para que el canvas sea focoable y las flechas lo desplacen (scroll nativo del contenedor enfocado).
- Actualización del estado de scrollability tras cada render y con un `ResizeObserver` (el ancho de la ventana cambia el overflow).
- Tests E2E: pan con ratón, tope de scroll, caso sin overflow, foco y `ArrowRight`, `touch-action` computado.
- `README.md`: una línea sobre arrastrar para desplazar (o foco + flechas).

**Out of scope (para futuras specs):**

- Zoom, pantalla completa, exportar PNG/SVG o compartir un diagrama suelto.
- Botón de reset o doble clic para volver al inicio.
- Inercia/momentum tras soltar el puntero.
- Pan con la rueda del ratón (el scroll nativo ya lo cubre; `Shift` + rueda desplaza en horizontal).
- Pinch-zoom táctil.
- Cambios en el renderizado del diagrama (SPEC 07).

## Data model

Esta spec no introduce datos persistidos. Define estado de UI y contrato de DOM.

```ts
// src/scripts/mermaid.ts (estado por canvas, en el closure del renderer)
type PanState = {
  pointerId: number;
  x: number; // clientX al iniciar el pan
  y: number; // clientY al iniciar el pan
  left: number; // canvas.scrollLeft al iniciar
  top: number; // canvas.scrollTop al iniciar
} | null;
```

Contrato de DOM del canvas:

```html
<div
  class="mermaid-canvas"
  role="region"
  aria-label="Diagrama"
  tabindex="0"
  data-scrollable="true"
>
  <svg width="1590" height="525">…</svg>
</div>
```

Estados y convenciones:

- `role="region"` y `aria-label` (etiqueta `article.diagramLabel`) se fijan al crear el canvas.
- `tabindex="0"` y `data-scrollable="true"` solo cuando hay overflow; sin overflow el canvas no recibe foco ni muestra cursor de pan.
- `is-panning` se añade al canvas durante el arrastre y se retira en `pointerup`, `pointercancel` o `lostpointercapture`.
- El pan recalcula `scrollLeft`/`scrollTop` desde la posición inicial (sin acumular delta entre frames).
- `updateScrollable()` corre tras cada render correcto y en las entradas del `ResizeObserver`.

CSS en `global.css`:

```css
.prose .mermaid-canvas {
  touch-action: pan-y;
}
.prose .mermaid-canvas[data-scrollable="true"] {
  cursor: grab;
}
.prose .mermaid-canvas.is-panning {
  cursor: grabbing;
  user-select: none;
}
```

## Implementation plan

1. En `src/scripts/mermaid.ts`: fijar `role="region"` y `aria-label` al crear el canvas; extraer `updateScrollable(diagram)` (fija/retira `tabindex` y `data-scrollable` según overflow), llamarla tras cada render correcto; registrar un `ResizeObserver` compartido que observe los canvas y llame a `updateScrollable`. Verificar con `pnpm check`.
2. Implementar el pan con Pointer Events en el canvas (down/move/up/cancel/lostpointercapture), con `setPointerCapture`, `preventDefault` en `pointerdown` y la clase `is-panning`. Verificar en `pnpm dev` en el post de Pages CMS (ambos diagramas) y en la cheatsheet (el contador no debe panear).
3. Añadir los estilos de `touch-action`, `cursor` y `user-select` en `global.css`. Verificar claro/oscuro, móvil y que el foco visible del canvas se mantiene.
4. Añadir los tests E2E en `tests/blog.spec.ts` y ejecutar `pnpm test:e2e`.
5. Actualizar `README.md` y verificar `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e`.

## Acceptance criteria

- [ ] En el post de Pages CMS, ambos canvas muestran `data-scrollable="true"`, `tabindex="0"`, `role="region"` y `aria-label`.
- [ ] Arrastrar con el ratón dentro de un canvas desplazable incrementa `scrollLeft`, con tope en `scrollWidth - clientWidth`.
- [ ] En la cheatsheet, el flowchart del contador (380 px) no recibe `tabindex` ni `data-scrollable`, y arrastrar sobre él no cambia `scrollLeft`.
- [ ] El `cursor` computado de un canvas desplazable es `grab` y `grabbing` durante el arrastre.
- [ ] Durante el arrastre el canvas tiene la clase `is-panning`; al soltar desaparece.
- [ ] El `touch-action` computado del canvas es `pan-y`.
- [ ] Focando el canvas con teclado, `ArrowRight` incrementa `scrollLeft` (scroll nativo del contenedor enfocado).
- [ ] La scrollbar nativa del canvas sigue presente.
- [ ] Redimensionando la ventana, el estado `data-scrollable` se actualiza (canvas que cabe deja de ser desplazable).
- [ ] La edición y el toggle de fuente no se ven afectados: el arrastre no interfiere con el botón **View diagram source** (fuera del canvas).
- [ ] Sin errores en consola durante el pan.
- [ ] `README.md` documenta el gesto.
- [ ] `pnpm format:check`, `pnpm check`, `pnpm build` y `pnpm test:e2e` pasan.

## Decisions

- **Sí:** Pointer Events como única API (un solo camino para ratón, lápiz y táctil); nada de controladores separados de mouse/touch.
- **Sí:** `touch-action: pan-y`. Reserva el gesto vertical para la página y deja el horizontal para el pan; evita secuestrar el scroll en móvil.
- **Sí:** `tabindex` solo con overflow. Un tab stop por diagrama que cabe sería ruido de navegación.
- **Sí:** reutilizar `article.diagramLabel` como `aria-label`. No introduce claves nuevas y ya está traducido.
- **Sí:** recalcular `scrollLeft` desde la posición inicial en cada `pointermove`. Evita la deriva por redondeo y hace el pan predecible.
- **Sí:** `ResizeObserver` + re-check tras render. La scrollability depende del ancho de la ventana y del tamaño del SVG re-renderizado al cambiar de tema.
- **No:** inercia/momentum. La scrollbar y las flechas cubren el recorrido largo; añadir física multiplica los casos de prueba.
- **No:** botón de reset o doble clic para volver al inicio. El usuario pidió solo paneo; `Home`/`Ctrl+Inicio` sobre el canvas enfocado ya vuelve.
- **No:** pan con la rueda del ratón. El scroll nativo ya lo hace; interceptar la rueda rompería el scroll de página.
- **No:** zoom, pantalla completa o exportación. Siguen fuera (SPEC 07); van en su propia spec si aterrizan.

## Risks

| Risk                                                           | Mitigation                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| El pan secuestra el scroll vertical de la página en táctil     | `touch-action: pan-y`: los gestos verticales los maneja el navegador.                                           |
| Arrastrar selecciona el texto del SVG                          | `preventDefault` en `pointerdown` y `user-select: none` durante `is-panning`.                                   |
| El estado de scrollability queda obsoleto tras un resize       | `ResizeObserver` sobre el canvas y re-check tras cada render.                                                   |
| El puntero sale del canvas a mitad de arrastre                 | `setPointerCapture` mantiene los eventos; `pointercancel`/`lostpointercapture` limpian el estado.               |
| Un canvas desplazable roba el foco visual del toggle de fuente | El foco visible solo aparece al focar con teclado (`:focus-visible`); el toggle está fuera del canvas.          |
| El pan interfiere con gestos del sistema (pull-to-refresh)     | `preventDefault` solo en `pointerdown`; el navegador sigue decidiendo los gestos verticales vía `touch-action`. |

## What is **not** in this spec

- Zoom, pantalla completa, exportación o compartir un diagrama.
- Botón de reset o doble clic para volver al inicio.
- Inercia/momentum.
- Pan con la rueda del ratón o pinch-zoom.
- Cualquier cambio en el pipeline de render de SPEC 07.

Cada uno de esos puntos, si se implementa, va en su propia spec.
