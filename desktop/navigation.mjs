const CLOUDFLARE_AUTHORIZATION_ORIGIN = "https://dash.cloudflare.com";

export function classifyNavigation(target, serverUrl) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return "blocked";
  }

  if (url.origin === serverUrl) return "application";
  if (url.origin === CLOUDFLARE_AUTHORIZATION_ORIGIN) return "authorization";
  if (url.protocol === "https:" || url.protocol === "mailto:") return "external";
  return "blocked";
}

export function mayGrantPermission(permission, requestingOrigin, serverUrl) {
  return permission === "notifications" && requestingOrigin === serverUrl;
}
