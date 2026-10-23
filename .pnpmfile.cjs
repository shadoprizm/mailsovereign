// The optional gateway embeds only WildDuck's IMAP protocol engine. Do not install the unrelated
// MongoDB, Redis, REST administration, delivery, certificate automation, or template services.
const imapDependencies = new Set([
  "@zone-eu/wild-config",
  "base32.js",
  "gelf",
  "he",
  "html-to-text",
  "iconv-lite",
  "libbase64",
  "libmime",
  "libqp",
  "nodemailer",
  "npmlog",
  "prom-client",
  "punycode.js"
]);

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name !== "@zone-eu/wildduck") return pkg;
      if (pkg.version !== "1.52.0")
        throw new Error(
          "Review the gateway IMAP engine dependency graph before updating WildDuck."
        );
      pkg.dependencies = Object.fromEntries(
        Object.entries(pkg.dependencies ?? {}).filter(([name]) => imapDependencies.has(name))
      );
      return pkg;
    }
  }
};
