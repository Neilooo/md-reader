/**
 * 渲染后处理：为代码块与 Mermaid 块注入复制控件，点击统一由容器上的
 * 一次事件委托处理。注入必须幂等：同一棵 DOM 重复调用不能产生双重包裹
 * 或重复按钮；源码变化导致的整棵 DOM 重建会由调用方重新触发 inject。
 */
import { copyText } from "./useClipboard";

export interface CodeBlockActionLabels {
  copy: string;
  copied: string;
  copyMermaid: string;
  copiedMermaid: string;
  copyFailed: string;
}

export interface CodeBlockActionOptions {
  /** 每次读取当前语言的文案，切换语言后按钮标题可随 inject 刷新。 */
  labels: () => CodeBlockActionLabels;
  onFailure: (message: string) => void;
}

const COPY_ICON = `<svg class="icon-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"></rect><path d="M10.5 3.5H4A1.5 1.5 0 0 0 2.5 5v6.5"></path></svg>`;
const CHECK_ICON = `<svg class="icon-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5 6.3 12 13 4.8"></path></svg>`;

function createButton(action: "code" | "mermaid") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "code-copy-btn";
  btn.dataset.action = action;
  btn.innerHTML = COPY_ICON + CHECK_ICON;
  return btn;
}

type CodeCopyButton = ReturnType<typeof createButton>;

/** 确保目标块外层有包裹层与操作头，且不重复创建标签/按钮。 */
function ensureWrapper(
  el: HTMLElement,
  action: "code" | "mermaid",
  lang: string | null
): void {
  let wrapper = el.parentElement;
  if (!wrapper || !wrapper.classList.contains("code-block")) {
    wrapper = document.createElement("div");
    wrapper.className = "code-block";
    el.parentNode?.insertBefore(wrapper, el);
    wrapper.appendChild(el);
  }

  let header = wrapper.firstElementChild;
  if (!header || !header.classList.contains("code-block-header")) {
    header = document.createElement("div");
    header.className = "code-block-header";
    wrapper.insertBefore(header, el);
  }

  let label = header.querySelector<HTMLElement>(".code-block-lang");
  if (lang) {
    if (!label) {
      label = document.createElement("span");
      label.className = "code-block-lang";
      header.insertBefore(label, header.firstChild);
    }
    label.textContent = lang;
  } else if (label) {
    label.remove();
  }

  let btn = header.querySelector<CodeCopyButton>(".code-copy-btn");
  if (!btn) {
    btn = createButton(action);
    header.appendChild(btn);
  }
  btn.dataset.action = action;
}

function refreshLabels(
  container: HTMLElement,
  labels: CodeBlockActionLabels
): void {
  container.querySelectorAll<CodeCopyButton>(".code-copy-btn").forEach((btn) => {
    const isMermaid = btn.dataset.action === "mermaid";
    const copied = btn.dataset.copied === "1";
    if (isMermaid) {
      btn.title = copied ? labels.copiedMermaid : labels.copyMermaid;
    } else {
      btn.title = copied ? labels.copied : labels.copy;
    }
    btn.setAttribute("aria-label", btn.title);
  });
}

export function setupCodeBlockActions(
  container: HTMLElement,
  options: CodeBlockActionOptions
): { inject: () => void; dispose: () => void } {
  const timers = new Map<CodeCopyButton, number>();

  function inject(): void {
    container.querySelectorAll<HTMLElement>("pre.hljs").forEach((pre) => {
      ensureWrapper(pre, "code", pre.dataset.lang || null);
    });
    container.querySelectorAll<HTMLElement>(".mermaid-block").forEach((block) => {
      // 必须在 renderMermaid 覆盖 innerHTML 前保存源码；重渲染时沿用同一份。
      if (block.dataset.mermaidSrc == null) {
        block.dataset.mermaidSrc = block.textContent ?? "";
      }
      ensureWrapper(block, "mermaid", "mermaid");
    });
    refreshLabels(container, options.labels());
  }

  async function onClick(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<CodeCopyButton>(".code-copy-btn");
    if (!btn || !container.contains(btn)) return;
    event.preventDefault();

    const wrapper = btn.closest(".code-block");
    const text =
      btn.dataset.action === "mermaid"
        ? wrapper?.querySelector<HTMLElement>(".mermaid-block")?.dataset
            .mermaidSrc ?? ""
        : wrapper?.querySelector<HTMLElement>("pre.hljs code")?.textContent ?? "";

    const ok = await copyText(text);
    const labels = options.labels();
    const previous = timers.get(btn);
    if (previous != null) window.clearTimeout(previous);
    timers.delete(btn);

    if (!ok) {
      btn.dataset.copied = "0";
      btn.classList.remove("is-copied");
      refreshLabels(container, labels);
      options.onFailure(labels.copyFailed);
      return;
    }

    btn.dataset.copied = "1";
    btn.classList.add("is-copied");
    refreshLabels(container, labels);
    const timer = window.setTimeout(() => {
      btn.dataset.copied = "0";
      btn.classList.remove("is-copied");
      refreshLabels(container, options.labels());
      timers.delete(btn);
    }, 2000);
    timers.set(btn, timer);
  }

  container.addEventListener("click", onClick);

  return {
    inject,
    dispose() {
      container.removeEventListener("click", onClick);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    },
  };
}
