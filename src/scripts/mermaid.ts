type Theme = "light" | "dark";

export type MermaidLabels = {
  /** Button label to reveal the fenced source. */
  viewSource: string;
  /** Button label once the source is visible. */
  hideSource: string;
  /** Message shown when Mermaid cannot parse or render a diagram. */
  error: string;
  /** Accessible-name fallback when the SVG has no <title> or aria-label. */
  diagram: string;
};

export type MermaidRenderer = {
  render: () => Promise<void>;
  destroy: () => void;
};

type MermaidApi = (typeof import("mermaid"))["default"];

type Diagram = {
  pre: HTMLPreElement;
  figure: HTMLElement;
  canvas: HTMLElement;
  button: HTMLButtonElement;
  errorMessage: HTMLParagraphElement | null;
  source: string;
  /** Discards results from a previous render pass (e.g. an old theme). */
  pass: number;
};

type PanState = {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
};

const CODE_SELECTOR = "pre > code.language-mermaid";
// Mermaid's own default is 50000; anything above this is a broken label
// measurement, not a real diagram.
const MAX_DIMENSION = 6000;
// Quote-free so it survives any font-family attribute serialization.
const FONT_FAMILY = "IBM Plex Sans Variable, system-ui, sans-serif";
const isDark = (): boolean =>
  document.documentElement.classList.contains("dark");
const themeName = (): Theme => (isDark() ? "dark" : "light");

let diagramCounter = 0;

let api: MermaidApi | null = null;
const loadMermaid = async (): Promise<MermaidApi> => {
  api ??= (await import("mermaid")).default;
  return api;
};

/**
 * Finds every ```` ```mermaid ```` fence under `root` and turns it into a
 * figure with a rendered SVG, keeping the original `<pre>` as a fallback for
 * no-JS readers and as a "view source" toggle.
 */
export function createMermaidRenderer(options: {
  root: ParentNode;
  labels: MermaidLabels;
}): MermaidRenderer {
  const { root, labels } = options;
  const diagrams = new Map<HTMLPreElement, Diagram>();
  const canvases = new Map<HTMLElement, Diagram>();
  let lastTheme = themeName();
  let running: Promise<void> = Promise.resolve();

  const updateScrollable = (diagram: Diagram): void => {
    const { canvas } = diagram;
    const scrollable =
      canvas.scrollWidth > canvas.clientWidth ||
      canvas.scrollHeight > canvas.clientHeight;
    if (scrollable) {
      canvas.dataset.scrollable = "true";
      canvas.setAttribute("tabindex", "0");
    } else {
      delete canvas.dataset.scrollable;
      canvas.removeAttribute("tabindex");
    }
  };

  // Re-check on resizes: the overflow depends on the viewport width.
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const diagram = canvases.get(entry.target as HTMLElement);
      if (diagram) updateScrollable(diagram);
    }
  });

  const createFigure = (pre: HTMLPreElement): Diagram => {
    diagramCounter += 1;
    const sourceId = `mermaid-source-${diagramCounter}`;
    pre.id = sourceId;

    const figure = document.createElement("figure");
    figure.className = "mermaid-diagram";
    figure.setAttribute("aria-busy", "true");

    const canvas = document.createElement("div");
    canvas.className = "mermaid-canvas";
    canvas.setAttribute("role", "region");
    canvas.setAttribute("aria-label", labels.diagram);

    const pan: { state: PanState | null } = { state: null };
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || canvas.dataset.scrollable !== "true") return;
      // Avoid text selection while dragging; touch-action still lets the
      // browser handle vertical page gestures.
      event.preventDefault();
      pan.state = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: canvas.scrollLeft,
        top: canvas.scrollTop,
      };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* The pointer may already be gone; the drag simply ends. */
      }
      canvas.classList.add("is-panning");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (pan.state?.pointerId !== event.pointerId) return;
      canvas.scrollLeft = pan.state.left - (event.clientX - pan.state.x);
      canvas.scrollTop = pan.state.top - (event.clientY - pan.state.y);
    });
    const endPan = (event: PointerEvent) => {
      if (pan.state?.pointerId !== event.pointerId) return;
      pan.state = null;
      canvas.classList.remove("is-panning");
    };
    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);
    canvas.addEventListener("lostpointercapture", endPan);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mermaid-source-toggle";
    button.textContent = labels.viewSource;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", sourceId);
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(expanded));
      button.textContent = expanded ? labels.hideSource : labels.viewSource;
      pre.hidden = !expanded;
    });

    figure.append(canvas, button);
    pre.insertAdjacentElement("afterend", figure);

    const diagram: Diagram = {
      pre,
      figure,
      canvas,
      button,
      errorMessage: null,
      source: pre.querySelector("code")?.textContent ?? "",
      pass: 0,
    };
    canvases.set(canvas, diagram);
    resizeObserver.observe(canvas);
    return diagram;
  };

  /** Adds figures for new fences and forgets pres removed from the DOM. */
  const collect = (): void => {
    for (const [pre] of diagrams) {
      if (!pre.isConnected) diagrams.delete(pre);
    }
    for (const code of root.querySelectorAll<Element>(CODE_SELECTOR)) {
      const pre = code.closest("pre");
      if (pre && !diagrams.has(pre)) diagrams.set(pre, createFigure(pre));
    }
  };

  const markError = (diagram: Diagram, reason: unknown): void => {
    diagram.figure.dataset.mermaidState = "error";
    delete diagram.figure.dataset.mermaidTheme;
    diagram.figure.removeAttribute("aria-busy");
    diagram.pre.hidden = false;
    if (!diagram.errorMessage) {
      diagram.errorMessage = document.createElement("p");
      diagram.errorMessage.className = "mermaid-error";
      diagram.errorMessage.setAttribute("role", "status");
      diagram.canvas.before(diagram.errorMessage);
    }
    diagram.errorMessage.textContent = labels.error;
    console.warn("Mermaid diagram could not be rendered:", reason);
  };

  const renderDiagram = async (diagram: Diagram, theme: Theme) => {
    const pass = diagram.pass + 1;
    diagram.pass = pass;
    diagramCounter += 1;
    const renderId = `mermaid-diagram-${diagramCounter}`;
    try {
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render(renderId, diagram.source);
      if (pass !== diagram.pass) return;
      // Mermaid sanitizes its output under securityLevel: "strict"; the SVG
      // enters the DOM through a range fragment, never through v-html.
      const fragment = document.createRange().createContextualFragment(svg);
      const rendered = fragment.querySelector("svg") as SVGSVGElement | null;
      diagram.canvas.replaceChildren(fragment);
      if (rendered) {
        // Mermaid's viewBox is unreliable across browsers (Windows Chromium
        // computes it from the wrong origin and clips the content), so
        // re-derive the frame from the rendered content once the SVG is in
        // the document. 8px of padding covers markers, strokes and labels.
        const box = rendered.getBBox();
        if (!(box.width > 0 && box.height > 0)) {
          throw new Error("empty diagram box");
        }
        const pad = 8;
        const width = box.width + pad * 2;
        const height = box.height + pad * 2;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          // A broken label measurement produces enormous layouts (seen on
          // Windows Chromium with HTML labels); never show those.
          throw new Error(
            `implausible layout: ${Math.round(width)}x${Math.round(height)}`,
          );
        }
        rendered.setAttribute(
          "viewBox",
          `${box.x - pad} ${box.y - pad} ${width} ${height}`,
        );
        rendered.setAttribute("width", String(width));
        rendered.setAttribute("height", String(height));
        rendered.style.removeProperty("max-width");
        if (!rendered.querySelector("title")) {
          // Mermaid only names the SVG when the source has accTitle.
          rendered.setAttribute("role", "img");
          rendered.setAttribute("aria-label", labels.diagram);
        }
      }
      diagram.figure.dataset.mermaidState = "rendered";
      diagram.figure.dataset.mermaidTheme = theme;
      diagram.figure.removeAttribute("aria-busy");
      diagram.pre.hidden = true;
      updateScrollable(diagram);
    } catch (reason) {
      if (pass !== diagram.pass) return;
      diagram.canvas.replaceChildren();
      markError(diagram, reason);
    }
  };

  const runPass = async (): Promise<void> => {
    collect();
    if (diagrams.size === 0) return;
    // Mermaid measures labels synchronously; wait for the web fonts so the
    // layout matches the font the diagram is displayed with.
    await Promise.all([
      document.fonts.ready,
      document.fonts.load(`16px ${FONT_FAMILY}`).catch(() => {}),
    ]);
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // HTML labels are measured inside foreignObject and misbehave on
      // Windows Chromium (huge layouts); SVG text is stable everywhere.
      htmlLabels: false,
      theme: isDark() ? "dark" : "default",
      fontFamily: FONT_FAMILY,
    });
    const theme = themeName();
    for (const diagram of diagrams.values()) {
      await renderDiagram(diagram, theme);
    }
  };

  const observer = new MutationObserver(() => {
    const theme = themeName();
    if (theme === lastTheme) return;
    lastTheme = theme;
    // applyTheme settles over two animation frames; re-render after that.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void renderer.render();
      });
    });
  });
  observer.observe(document.documentElement, { attributeFilter: ["class"] });

  const renderer: MermaidRenderer = {
    render: () => {
      // One pass at a time: Mermaid shares global state between renders.
      running = running.then(runPass).catch(() => {
        /* Each diagram reports its own failure. */
      });
      return running;
    },
    destroy: () => {
      observer.disconnect();
      resizeObserver.disconnect();
    },
  };
  return renderer;
}
