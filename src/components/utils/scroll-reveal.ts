const PENDING = "[data-reveal]:not([data-revealed])";

let observer: IntersectionObserver | null = null;

function reveal(el: Element): void {
  el.setAttribute("data-revealed", "");
}

function pendingIn(root: ParentNode): Element[] {
  const found = Array.from(root.querySelectorAll(PENDING));
  if (root instanceof Element && root.matches(PENDING)) found.unshift(root);
  return found;
}

function isEditor(): boolean {
  return (
    document.documentElement.hasAttribute("data-cc-editor") ||
    Boolean((window as Window & { inEditorMode?: boolean }).inEditorMode)
  );
}

function getObserver(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries, io) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          io.unobserve(entry.target);
        }
      },
      { threshold: 0 }
    );
  }
  return observer;
}

export function revealAll(root: ParentNode = document): void {
  pendingIn(root).forEach(reveal);
}

export function initScrollReveals(root: ParentNode = document): void {
  if (isEditor() || !("IntersectionObserver" in window)) {
    revealAll(root);
    return;
  }
  const io = getObserver();
  pendingIn(root).forEach((el) => io.observe(el));
}
