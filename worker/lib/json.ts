import { AppError, errorBody } from "./errors";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AppError("REQUEST_TOO_LARGE", "Request body is too large.", 413);
  }
  if (!request.body) {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let source = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new AppError("REQUEST_TOO_LARGE", "Request body is too large.", 413);
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    return JSON.parse(source) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}

export function jsonHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  next.set("content-type", "application/json; charset=utf-8");
  return next;
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: jsonHeaders(init?.headers)
  });
}

export function jsonError(code: string, message: string, status = 400): Response {
  return jsonResponse(errorBody(code, message), { status });
}
