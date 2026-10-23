import * as React from "react";

import { Button } from "@/components/ui/button";

import { type FrameImageStatus, observeFrameImages } from "./frame-images";

export function EmailFrame({
  srcDoc,
  title
}: {
  srcDoc: string;
  title: string;
}): React.ReactElement {
  // A changed document gets its own observations, timers, and retry state.
  return <ObservedEmailFrame key={srcDoc} srcDoc={srcDoc} title={title} />;
}

function ObservedEmailFrame({
  srcDoc,
  title
}: {
  srcDoc: string;
  title: string;
}): React.ReactElement {
  const [height, setHeight] = React.useState(0);
  const [frameUrl, setFrameUrl] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<FrameImageStatus | null>(null);
  const [slow, setSlow] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const observerCleanup = React.useRef<(() => void) | null>(null);
  const frameRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    const url = URL.createObjectURL(new Blob([srcDoc], { type: "text/html" }));
    setFrameUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [srcDoc]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Each retry creates a new iframe document to observe.
  React.useEffect(() => {
    if (!frameUrl) return;
    let animation = 0;
    const timeout = window.setTimeout(() => setSlow(true), 20_000);
    const observeWhenParsed = () => {
      const frame = frameRef.current;
      const document = frame?.contentDocument;
      // iframe load waits for every image. Observe the parsed document earlier so a slow image
      // cannot hold the entire message at zero height.
      if (
        frame &&
        document?.URL === frameUrl &&
        document.body &&
        document.readyState !== "loading"
      ) {
        const stopImages = observeFrameImages(document, setStatus);
        const stopHeight = observeFrameHeight(frame, setHeight);
        observerCleanup.current = () => {
          stopImages();
          stopHeight();
        };
      } else {
        animation = window.requestAnimationFrame(observeWhenParsed);
      }
    };
    animation = window.requestAnimationFrame(observeWhenParsed);
    return () => {
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(animation);
      observerCleanup.current?.();
    };
  }, [attempt, frameUrl]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {status?.failed || (slow && (status === null || status.pending > 0)) ? (
        <div
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          role="status"
        >
          <span>
            {status?.failed
              ? "Some images could not be loaded."
              : "Images are taking longer than expected."}
          </span>
          <Button
            onClick={() => {
              observerCleanup.current?.();
              setStatus(null);
              setSlow(false);
              setAttempt((value) => value + 1);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry images
          </Button>
        </div>
      ) : status === null || status.pending > 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          Loading images…
        </p>
      ) : null}
      <iframe
        key={attempt}
        className="block w-full border-0 bg-white"
        height={height}
        ref={frameRef}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        referrerPolicy="no-referrer"
        src={frameUrl ?? undefined}
        title={title}
      />
    </div>
  );
}

function observeFrameHeight(
  frame: HTMLIFrameElement,
  setHeight: React.Dispatch<React.SetStateAction<number>>
): () => void {
  const document = frame.contentDocument;
  if (!document) return () => undefined;

  const update = (): void => {
    const nextHeight = Math.ceil(
      Math.max(
        document.body?.offsetHeight ?? 0,
        document.body?.scrollHeight ?? 0,
        document.documentElement.offsetHeight,
        document.documentElement.scrollHeight
      )
    );
    setHeight((current) => (current === nextHeight ? current : nextHeight));
  };

  update();
  const observer = new ResizeObserver(update);
  observer.observe(document.documentElement);
  if (document.body) observer.observe(document.body);
  document.addEventListener("load", update, true);

  return () => {
    observer.disconnect();
    document.removeEventListener("load", update, true);
  };
}
