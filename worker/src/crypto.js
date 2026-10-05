// Random tokens and hashes on Web Crypto, which Workers and Node 22 both provide.

const toBase64Url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** 32 random bytes, base64url: session tokens and OAuth state. */
export const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** SHA-256 hex. Sessions are stored by this hash; the token itself only lives in the cookie. */
export const sha256Hex = async (text) => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
};

/** Constant-time string comparison for the OAuth state. */
export const sameString = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
