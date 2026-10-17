import handler from '@tanstack/react-start/server-entry';

import { getWwwRedirectLocation } from './lib/canonical-url';
import { normalizeProjectAssetMediaRequest } from './lib/project-asset-media-request';
import { paraglideMiddleware } from './paraglide/server.js';

/**
 * Documents must be revalidated on every load.
 *
 * Hashed assets under /assets/ ship `max-age=31536000, immutable`, which is
 * correct. HTML had no Cache-Control at all, so browsers applied heuristic
 * caching and could keep an old document that referenced asset hashes from a
 * previous build — files that no longer exist. The result looks like the app is
 * broken or that changes "didn't take", and only a hard reload fixes it.
 *
 * `no-cache` keeps the document cacheable but forces revalidation; with ETag or
 * Last-Modified that is a cheap 304, and on this local server a re-fetch is fine.
 */
function withHtmlRevalidation(response: Response): Response {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return response;
  if (response.headers.has('cache-control')) return response;

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-cache, must-revalidate');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Custom server entry — wraps every request in Paraglide's middleware so
// getLocale() resolves per-request (AsyncLocalStorage) during SSR.
export default {
  async fetch(req: Request): Promise<Response> {
    const redirectLocation = getWwwRedirectLocation(req.url);
    if (redirectLocation) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: redirectLocation,
        },
      });
    }

    const routedRequest = normalizeProjectAssetMediaRequest(req);
    const response = await paraglideMiddleware(routedRequest, () =>
      handler.fetch(routedRequest)
    );
    return withHtmlRevalidation(response);
  },
};
