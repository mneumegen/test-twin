/**
 * Shared Embla setup logic for the Carousel component.
 *
 * Used by:
 * - `Carousel.astro`'s inline `<script>` on the live site
 * - `editor-live-sync.js` in the CloudCannon editor, because CC's
 *   editable-regions renderer uses `renderToStaticMarkup` and does
 *   not execute inline scripts, so we need to initialize carousels
 *   from the live-sync script in that context.
 */

import EmblaCarousel, { type EmblaCarouselType } from "embla-carousel";
import AutoScroll from "embla-carousel-auto-scroll";
import Autoplay from "embla-carousel-autoplay";

export interface CarouselElement extends HTMLElement {
  __embla?: EmblaCarouselType;
}

export function setupCarousel(carousel: CarouselElement): void {
  if (carousel.hasAttribute("data-embla-initialized")) return;

  const inner = carousel.querySelector<HTMLElement>(".carousel-inner");
  const viewport = inner?.querySelector<HTMLElement>(".viewport");
  const track = viewport?.querySelector<HTMLElement>(".track");
  const slides = track?.querySelectorAll<HTMLElement>(".slide");
  const controlsWrapper = inner?.querySelector<HTMLElement>(".controls-wrapper");
  const indicatorsContainer = controlsWrapper?.querySelector<HTMLElement>(".indicators");
  const fractionEl = controlsWrapper?.querySelector<HTMLElement>(".carousel-fraction");
  const progressEl = controlsWrapper?.querySelector<HTMLElement>(".carousel-progress");

  if (!inner || !viewport || !track || !slides || !slides.length) {
    // Silently skip: in the CloudCannon editor the inner DOM can be
    // briefly incomplete while content loads; the live-sync observer
    // will re-run setup once slides are inserted.
    if (import.meta.env.DEV) {
      console.debug("Carousel: skipping setup, required elements missing", carousel);
    }
    return;
  }

  const loop = inner.getAttribute("data-loop") !== "false";
  const slidesToScroll = inner.hasAttribute("data-slides-to-scroll")
    ? Number(inner.getAttribute("data-slides-to-scroll")) || "auto"
    : "auto";
  const alignAttr = inner.getAttribute("data-align");
  const align =
    alignAttr === "start" || alignAttr === "center" || alignAttr === "end"
      ? (alignAttr as "start" | "center" | "end")
      : "start";

  const plugins = [];

  if (inner.hasAttribute("data-autoplay")) {
    const autoplayInterval = Number(inner.getAttribute("data-autoplay")) * 1000 || 3000;

    plugins.push(Autoplay({ delay: autoplayInterval, stopOnInteraction: false }));
  }

  let watchDrag = true;

  if (inner.hasAttribute("data-autoscroll")) {
    const scrollValue = parseFloat(inner.getAttribute("data-autoscroll") || "1");
    const speed = isNaN(scrollValue) ? 1 : scrollValue;

    plugins.push(AutoScroll({ speed }));
    watchDrag = false;
  }

  const embla = EmblaCarousel(
    viewport,
    {
      // Only real slides: components inside slides can leave inline <script> tags in the track,
      // which Embla would otherwise count as zero-width slides (an extra tiny scroll step).
      slides: ":scope > .slide",
      loop,
      slidesToScroll,
      align,
      watchDrag,
      duration: 20,
      startIndex: 0,
      skipSnaps: false,
      inViewThreshold: 0.7,
    },
    plugins
  );

  carousel.setAttribute("data-embla-initialized", "true");
  carousel.__embla = embla;

  const prevButton = inner.querySelector<HTMLButtonElement>(".prev > .button-inner");
  const nextButton = inner.querySelector<HTMLButtonElement>(".next > .button-inner");

  if (prevButton) prevButton.style.borderRadius = "9999px";
  if (nextButton) nextButton.style.borderRadius = "9999px";

  const updateButtons = () => {
    if (prevButton) prevButton.disabled = !embla.canScrollPrev();
    if (nextButton) nextButton.disabled = !embla.canScrollNext();
  };

  updateButtons();
  embla.on("select", updateButtons);
  if (prevButton) prevButton.addEventListener("click", () => embla.scrollPrev());
  if (nextButton) nextButton.addEventListener("click", () => embla.scrollNext());

  if (indicatorsContainer) {
    const renderDots = () => {
      indicatorsContainer.innerHTML = "";

      embla.scrollSnapList().forEach((_, index) => {
        const dot = document.createElement("div");

        dot.className = "indicator";
        dot.setAttribute("data-selected", (index === embla.selectedScrollSnap()).toString());
        dot.addEventListener("click", () => embla.scrollTo(index));
        indicatorsContainer.appendChild(dot);
      });
    };

    const updateSelectedDot = () => {
      indicatorsContainer.querySelectorAll(".indicator").forEach((dot, index) => {
        const isSelected = index === embla.selectedScrollSnap();

        dot.setAttribute("data-selected", isSelected.toString());
      });
    };

    embla.on("select", updateSelectedDot);
    embla.on("reInit", renderDots);
    renderDots();
  }

  if (fractionEl) {
    const updateFraction = () => {
      const snaps = embla.scrollSnapList().length;
      const current = embla.selectedScrollSnap() + 1;
      const safeTotal = Math.max(snaps, 1);
      const safeCurrent = Math.min(current, safeTotal);

      fractionEl.textContent = `${safeCurrent}/${safeTotal}`;
      fractionEl.setAttribute("aria-label", `Slide ${safeCurrent} of ${safeTotal}`);
    };

    embla.on("select", updateFraction);
    embla.on("reInit", updateFraction);
    updateFraction();
  }

  if (progressEl) {
    setupProgress(embla, progressEl, viewport);
  }
}

function setupProgress(
  embla: EmblaCarouselType,
  progressEl: HTMLElement,
  viewport: HTMLElement
): void {
  const thumb = progressEl.querySelector<HTMLElement>(".carousel-progress-thumb");

  if (!thumb) return;

  // Re-setup (editor live-sync destroy → setup) must not stack listeners.
  const host = progressEl as HTMLElement & { __progressAbort?: AbortController };

  host.__progressAbort?.abort();
  const controller = new AbortController();
  const { signal } = controller;

  host.__progressAbort = controller;

  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  // Visible fraction = viewport width / full width of the slide strip.
  const visibleRatio = () => {
    const total = embla
      .slideNodes()
      .reduce((sum, slide) => sum + slide.getBoundingClientRect().width, 0);
    const visible = viewport.getBoundingClientRect().width;

    return total > 0 ? clamp(visible / total) : 1;
  };

  let thumbWidth = 0;
  let trackWidth = 0;

  const measure = () => {
    trackWidth = progressEl.getBoundingClientRect().width;
    thumbWidth = trackWidth * visibleRatio();
    progressEl.style.setProperty("--carousel-progress-thumb-width", `${thumbWidth}px`);
  };

  const setOffset = (progress: number) => {
    const offset = clamp(progress) * Math.max(trackWidth - thumbWidth, 0);

    progressEl.style.setProperty("--carousel-progress-offset", `${offset}px`);
  };

  const update = () => setOffset(embla.scrollProgress());

  const nearestSnap = (progress: number) => {
    const snaps = embla.scrollSnapList();
    let best = 0;

    snaps.forEach((snap, index) => {
      if (Math.abs(snap - progress) < Math.abs(snaps[best] - progress)) best = index;
    });

    return best;
  };

  const progressFromX = (clientX: number, grabOffset: number) => {
    const rect = progressEl.getBoundingClientRect();
    const range = Math.max(rect.width - thumbWidth, 1);

    return clamp((clientX - rect.left - grabOffset) / range);
  };

  let dragging = false;
  let grabOffset = 0;

  progressEl.addEventListener(
    "pointerdown",
    (event: PointerEvent) => {
      const thumbRect = thumb.getBoundingClientRect();

      grabOffset = event.target === thumb ? event.clientX - thumbRect.left : thumbWidth / 2;
      dragging = true;
      progressEl.setAttribute("data-dragging", "true");
      progressEl.setPointerCapture(event.pointerId);

      const progress = progressFromX(event.clientX, grabOffset);

      setOffset(progress);
      embla.scrollTo(nearestSnap(progress));
      event.preventDefault();
    },
    { signal }
  );

  progressEl.addEventListener(
    "pointermove",
    (event: PointerEvent) => {
      if (!dragging) return;
      const progress = progressFromX(event.clientX, grabOffset);
      const target = nearestSnap(progress);

      setOffset(progress);
      if (target !== embla.selectedScrollSnap()) embla.scrollTo(target);
    },
    { signal }
  );

  const endDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    progressEl.removeAttribute("data-dragging");
    if (progressEl.hasPointerCapture(event.pointerId)) {
      progressEl.releasePointerCapture(event.pointerId);
    }
    update();
  };

  progressEl.addEventListener("pointerup", endDrag, { signal });
  progressEl.addEventListener("pointercancel", endDrag, { signal });

  embla.on("scroll", () => {
    if (!dragging) update();
  });
  embla.on("settle", update);
  embla.on("select", () => {
    if (!dragging) update();
  });

  const remeasure = () => {
    measure();
    update();
  };

  embla.on("reInit", remeasure);
  embla.on("resize", remeasure);
  remeasure();
}

export function setupAllCarousels(root: ParentNode = document): void {
  root.querySelectorAll<CarouselElement>(".carousel").forEach((el) => setupCarousel(el));
}

export function destroyCarousel(carousel: CarouselElement): void {
  const embla = carousel.__embla;

  if (embla) {
    try {
      embla.destroy();
    } catch (err) {
      console.warn("Carousel destroy failed", err);
    }
    delete carousel.__embla;
  }

  carousel.removeAttribute("data-embla-initialized");
}
