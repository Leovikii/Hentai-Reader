/// <reference types="vite/client" />

declare module '$' {
  export function GM_getValue<T>(key: string, defaultValue: T): T;
  export function GM_setValue(key: string, value: unknown): void;
}
