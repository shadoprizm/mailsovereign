export type FrameImageStatus = { failed: number; pending: number };

// The parent observes its script-free, same-origin sandbox. No sender script is enabled.
export function observeFrameImages(
  document: Document,
  report: (status: FrameImageStatus) => void
): () => void {
  const images = [...document.images];
  const probes: HTMLImageElement[] = [];
  const backgroundUrls = new Set<string>();
  const view = document.defaultView;
  if (view) {
    for (const element of [...document.querySelectorAll("body, body *")].slice(0, 5_000)) {
      const background = view.getComputedStyle(element).backgroundImage;
      for (const match of background.matchAll(/url\("([^"]+)"\)/g)) {
        if (match[1] && backgroundUrls.size < 200) backgroundUrls.add(match[1]);
      }
    }
  }
  for (const url of backgroundUrls) {
    const probe = document.createElement("img");
    probe.referrerPolicy = "no-referrer";
    probes.push(probe);
    images.push(probe);
    probe.src = url;
  }
  const placeholders = new Map<HTMLImageElement, HTMLSpanElement>();
  const refresh = () => {
    let failed = 0;
    let pending = 0;
    for (const image of images) {
      if (!image.complete) pending++;
      else if (!image.naturalWidth) {
        failed++;
        if (image.isConnected && !placeholders.has(image)) {
          const placeholder = document.createElement("span");
          placeholder.setAttribute("data-mail-image-placeholder", "");
          placeholder.setAttribute("role", "img");
          placeholder.setAttribute("aria-label", image.alt || "Image unavailable");
          image.hidden = true;
          image.style.setProperty("display", "none", "important");
          image.parentNode?.insertBefore(placeholder, image.nextSibling);
          placeholders.set(image, placeholder);
        }
      }
    }
    report({ failed, pending });
  };
  for (const image of images) {
    image.addEventListener("load", refresh);
    image.addEventListener("error", refresh);
  }
  refresh();
  return () => {
    for (const image of images) {
      image.removeEventListener("load", refresh);
      image.removeEventListener("error", refresh);
    }
    for (const probe of probes) probe.removeAttribute("src");
    for (const placeholder of placeholders.values()) placeholder.remove();
  };
}
