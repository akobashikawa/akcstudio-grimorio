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

const CODE_SELECTOR = "pre > code.language-mermaid";
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
  let lastTheme = themeName();
  let running: Promise<void> = Promise.resolve();

  const createFigure = (pre: HTMLPreElement): Diagram => {
    diagramCounter += 1;
    const sourceId = `mermaid-source-${diagramCounter}`;
    pre.id = sourceId;

    const figure = document.createElement("figure");
    figure.className = "mermaid-diagram";
    figure.setAttribute("aria-busy", "true");

    const canvas = document.createElement("div");
    canvas.className = "mermaid-canvas";

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

    return {
      pre,
      figure,
      canvas,
      button,
      errorMessage: null,
      source: pre.querySelector("code")?.textContent ?? "",
      pass: 0,
    };
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
      const rendered = fragment.querySelector("svg");
      if (rendered && !rendered.querySelector("title")) {
        // Mermaid only names the SVG when the source has accTitle.
        rendered.setAttribute("role", "img");
        rendered.setAttribute("aria-label", labels.diagram);
      }
      diagram.canvas.replaceChildren(fragment);
      diagram.figure.dataset.mermaidState = "rendered";
      diagram.figure.dataset.mermaidTheme = theme;
      diagram.figure.removeAttribute("aria-busy");
      diagram.pre.hidden = true;
    } catch (reason) {
      if (pass !== diagram.pass) return;
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
    }
  };

  const runPass = async (): Promise<void> => {
    collect();
    if (diagrams.size === 0) return;
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: isDark() ? "dark" : "default",
      fontFamily:
        getComputedStyle(document.documentElement)
          .getPropertyValue("--font-body")
          .trim() || undefined,
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
    },
  };
  return renderer;
}
