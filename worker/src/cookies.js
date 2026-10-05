// Cookie parsing and the two cookies the site sets. On https the names carry the __Host- prefix,
// which the browser only accepts with Secure, Path=/ and no Domain, so no subdomain can plant one.
// Under `wrangler dev` on http://localhost the plain names are used without Secure.

export const parseCookies = (header) => {
  const out = new Map();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || out.has(name)) continue;
    out.set(name, part.slice(eq + 1).trim());
  }
  return out;
};

export const isSecureOrigin = (siteOrigin) => String(siteOrigin).startsWith("https://");

export const cookieNames = (siteOrigin) => isSecureOrigin(siteOrigin)
  ? { session: "__Host-obl_session", oauth: "__Host-obl_oauth" }
  : { session: "obl_session", oauth: "obl_oauth" };

/** maxAge 0 clears the cookie. */
export const serializeCookie = (name, value, { maxAge, secure }) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
