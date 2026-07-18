/** Extracts the bare username from an instagram.com profile URL
 *  (e.g. https://www.instagram.com/nasa/ -> "nasa"). Shared by the
 *  RSSHub bridge candidate-URL builder and the extension-push routes
 *  so the parsing rule lives in exactly one place. */
export function extractInstagramUsername(identityUrl: string): string {
  return new URL(identityUrl).pathname.replace(/^\/|\/$/g, '');
}
