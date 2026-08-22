export function connect(): never {
  throw new Error("Cloudflare sockets are unavailable in Node unit tests.");
}
