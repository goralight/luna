/**
 * Payload 3 on Next.js serves REST under `/api/*` (see src/app/(payload)/api/[...slug]/route.ts).
 * PAYLOAD_URL may be the site origin (`https://example.com`) or already include `/api`.
 *
 * @param {string} raw from env, no trailing slash preferred
 * @returns {string} e.g. `https://example.com/api`
 */
export function getPayloadApiBase(raw) {
  if (!raw) return '';
  const base = String(raw).replace(/\/$/, '');
  if (base.endsWith('/api')) return base;
  return `${base}/api`;
}
