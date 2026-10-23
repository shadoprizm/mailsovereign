import { ImageOff } from "lucide-react";
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { getMessageHtml, trustRemoteMediaSender } from "./api";
import { EmailFrame } from "./email-frame";

export { EmailFrame } from "./email-frame";

import { buildEmailHtmlDocument } from "./html-document";
import type { MessageDetail } from "./types";

type MessageHtmlProps = {
  message: MessageDetail;
};

export function MessageHtml({ message }: MessageHtmlProps): React.ReactElement {
  return <MessageHtmlContent key={message.id} message={message} />;
}

function MessageHtmlContent({ message }: MessageHtmlProps): React.ReactElement {
  const [html, setHtml] = React.useState<Awaited<ReturnType<typeof getMessageHtml>> | null>(null);
  const [loadRemoteImages, setLoadRemoteImages] = React.useState(false);
  const [loadingImages, setLoadingImages] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savingTrust, setSavingTrust] = React.useState(false);
  const [quoteExpanded, setQuoteExpanded] = React.useState(false);
  const active = React.useRef(false);
  const busy = React.useRef(false);

  React.useEffect(() => {
    active.current = true;
    let current = true;
    setHtml(null);
    setError(null);
    setLoadRemoteImages(false);
    setQuoteExpanded(false);
    void getMessageHtml(message.id)
      .then((result) => {
        if (!current) return;
        setHtml(result);
        setLoadRemoteImages(result.remoteMediaTrusted);
      })
      .catch(() => {
        if (current) setError("HTML view is unavailable. Plain text is shown instead.");
      });
    return () => {
      current = false;
      active.current = false;
    };
  }, [message.id]);

  const rendered = React.useMemo(
    () =>
      html === null
        ? null
        : buildEmailHtmlDocument({
            allowRemoteImages: loadRemoteImages,
            html: html.html,
            origin: window.location.origin
          }),
    [html, loadRemoteImages]
  );
  const renderedQuote = React.useMemo(
    () =>
      html?.quotedHtml
        ? buildEmailHtmlDocument({
            allowRemoteImages: loadRemoteImages,
            html: html.quotedHtml,
            origin: window.location.origin
          })
        : null,
    [html, loadRemoteImages]
  );

  async function loadImages(always = false): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setLoadingImages(true);
    setSavingTrust(always);
    setError(null);
    try {
      if (always) await trustRemoteMediaSender(message.id);
      if (!active.current) return;
      const result = await getMessageHtml(message.id, true);
      if (!active.current) return;
      setHtml(result);
      setLoadRemoteImages(true);
    } catch {
      if (active.current) {
        setError(
          always
            ? "The sender preference or images could not be loaded. Try again."
            : "Remote images could not be loaded. Try again."
        );
      }
    } finally {
      busy.current = false;
      if (active.current) {
        setLoadingImages(false);
        setSavingTrust(false);
      }
    }
  }

  if (!rendered) {
    return (
      <>
        <PlainTextMessage message={message} />
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {html?.hasRemoteImages && !loadRemoteImages && (
        <RemoteImagesAlert
          direction={message.direction}
          fromAddress={message.fromAddress}
          loadingImages={loadingImages}
          onAlwaysLoad={() => void loadImages(true)}
          onLoad={() => void loadImages()}
          savingTrust={savingTrust}
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <EmailFrame srcDoc={rendered} title={`Message body: ${message.subject}`} />
      {renderedQuote ? (
        <>
          <QuotedContentDivider
            expanded={quoteExpanded}
            onToggle={() => setQuoteExpanded((expanded) => !expanded)}
          />
          {quoteExpanded ? (
            <EmailFrame
              srcDoc={renderedQuote}
              title={`Quoted message history: ${message.subject}`}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function QuotedContentDivider({
  expanded,
  onToggle
}: {
  expanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2" data-quoted-content-control>
      <Separator className="flex-1" />
      <Button
        aria-expanded={expanded}
        aria-label={expanded ? "Hide quoted message history" : "Show quoted message history"}
        className="h-6 min-w-10 rounded-full px-2 font-mono tracking-wider"
        onClick={onToggle}
        size="sm"
        type="button"
        variant="outline"
      >
        ...
      </Button>
      <Separator className="flex-1" />
    </div>
  );
}

export function RemoteImagesAlert({
  direction,
  fromAddress,
  loadingImages,
  onAlwaysLoad,
  onLoad,
  savingTrust
}: {
  direction: MessageDetail["direction"];
  fromAddress: string;
  loadingImages: boolean;
  onAlwaysLoad: () => void;
  onLoad: () => void;
  savingTrust: boolean;
}): React.ReactElement {
  return (
    <Alert>
      <ImageOff />
      <AlertTitle>Remote images are hidden</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>Loading them may tell the sender that you opened this message.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={loadingImages || savingTrust} onClick={onLoad} size="sm" type="button">
            Load images
          </Button>
          {direction === "inbound" && (
            <Button
              disabled={loadingImages || savingTrust}
              onClick={onAlwaysLoad}
              size="sm"
              title={`Always load remote images from ${fromAddress}`}
              type="button"
              variant="outline"
            >
              Always load from sender
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function PlainTextMessage({ message }: MessageHtmlProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const content = splitQuotedText(message.textBody || message.snippet);
  return (
    <div className="flex flex-col gap-4">
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-foreground/90">
        {content.body}
      </pre>
      {content.quote ? (
        <>
          <QuotedContentDivider expanded={expanded} onToggle={() => setExpanded((open) => !open)} />
          {expanded ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-muted-foreground">
              {content.quote}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function splitQuotedText(value: string): { body: string; quote: string | null } {
  const match = /\n{1,2}On [^\n]+ wrote:\n>/i.exec(value.replace(/\r\n?/g, "\n"));
  if (!match) return { body: value, quote: null };
  const normalized = value.replace(/\r\n?/g, "\n");
  return {
    body: normalized.slice(0, match.index).trimEnd(),
    quote: normalized.slice(match.index).trim()
  };
}
