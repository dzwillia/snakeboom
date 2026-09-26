/**
 * Every release stays playable at its own subdomain, the tag with dots as dashes (v0.17.0 lives at
 * https://v0-17-0.snakeboom.com, its relay at https://api.v0-17-0.snakeboom.com; see infra/README.md).
 * This works that address out from what the build knows: its version and the relay URL Vite baked in.
 */

/** The tag with dots as dashes: the release's subdomain label. A -dev build is not a release. */
export function releaseSlug(version: string): string | null {
  if (version.endsWith('-dev') || !/^v\d+\.\d+\.\d+(-[0-9a-z.-]+)?$/.test(version)) return null;
  return version.replace(/\./g, '-');
}

/**
 * Where this exact build lives for good, or null when this page already is that address, when the build
 * is not a tagged release (a -dev build) or when the relay is not one of ours (localhost).
 */
export function releaseUrl(version: string, relayBase: string, host: string): string | null {
  const slug = releaseSlug(version);
  if (!slug) return null;
  let relay: URL;
  try {
    relay = new URL(relayBase);
  } catch {
    return null;
  }
  if (relay.protocol !== 'https:') return null;
  // api.snakeboom.com serves snakeboom.com; api.v0-17-0.snakeboom.com serves v0-17-0.snakeboom.com.
  const site = relay.hostname.replace(/^api\./, '');
  const domain = site.startsWith(`${slug}.`) ? site.slice(slug.length + 1) : site;
  const target = `${slug}.${domain}`;
  return host === target ? null : `https://${target}/`;
}
