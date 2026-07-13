/** Shared priority bands. Keep these values stable while consumers migrate. */
export const LOAD_PRIORITY = {
  scroll: 0,
  warmup: 5,
  pageHtml: 50,
  foreground: 100,
} as const;
