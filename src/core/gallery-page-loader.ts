import type { GalleryPage } from './gallery';
import type { GalleryAdapter } from './site-adapter';

export class EmptyGalleryPageError extends Error {
  constructor(url: string) {
    super(`Gallery page has no items: ${url}`);
    this.name = 'EmptyGalleryPageError';
  }
}

/** Owns gallery-page request deduplication and pagination loop protection. */
export class GalleryPageLoader {
  private readonly adapter: GalleryAdapter;
  private readonly inFlight = new Map<string, Promise<GalleryPage>>();
  private readonly loadedUrls = new Set<string>();
  private readonly retryDelaysMs = [1000, 2000, 4000] as const;

  constructor(adapter: GalleryAdapter) {
    this.adapter = adapter;
  }

  async loadInitialPage(doc: Document, url: string): Promise<GalleryPage> {
    const page = this.normalize(url, await this.adapter.loadInitialPage(doc, url));
    this.markLoaded(url, page.pageUrl);
    return page;
  }

  loadPage(url: string, signal?: AbortSignal): Promise<GalleryPage | null> {
    if (this.loadedUrls.has(url)) return Promise.resolve(null);

    const existing = this.inFlight.get(url);
    if (existing) return existing;

    const request = this.fetchWithRetry(url, signal)
      .then(page => {
        if (page.items.length === 0) throw new EmptyGalleryPageError(url);
        const normalized = this.normalize(url, page);
        this.markLoaded(url, normalized.pageUrl);
        return normalized;
      })
      .finally(() => {
        this.inFlight.delete(url);
      });

    this.inFlight.set(url, request);
    return request;
  }

  private async fetchWithRetry(url: string, signal?: AbortSignal): Promise<GalleryPage> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.adapter.loadPage(url, signal);
      } catch (error) {
        if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') {
          throw error;
        }
        if (attempt >= this.retryDelaysMs.length) throw error;
        await this.waitForRetry(this.retryDelaysMs[attempt], signal);
      }
    }
  }

  private waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(finish, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(new DOMException('Request cancelled', 'AbortError'));
      };
      function finish() {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  hasLoaded(url: string): boolean {
    return this.loadedUrls.has(url);
  }

  private markLoaded(...urls: string[]): void {
    for (const url of urls) {
      if (url) this.loadedUrls.add(url);
    }
  }

  private normalize(requestedUrl: string, page: GalleryPage): GalleryPage {
    const isLoop = (url: string | null): boolean => !!url && (
      url === requestedUrl
      || url === page.pageUrl
      || this.loadedUrls.has(url)
    );

    return {
      ...page,
      nextUrl: isLoop(page.nextUrl) ? null : page.nextUrl,
      prevUrl: isLoop(page.prevUrl) ? null : page.prevUrl,
    };
  }
}
