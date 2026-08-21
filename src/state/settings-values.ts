import type { UserSettings } from './types';

export const AUTO_PLAY_INTERVAL_MIN_SECONDS = 1;
export const AUTO_PLAY_INTERVAL_MAX_SECONDS = 60;
export const AUTO_PLAY_INTERVAL_STEP_SECONDS = 5;
export const AUTO_PLAY_INTERVAL_DEFAULT_SECONDS = 5;

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function clampSeconds(value: number): number {
  return Math.min(
    AUTO_PLAY_INTERVAL_MAX_SECONDS,
    Math.max(AUTO_PLAY_INTERVAL_MIN_SECONDS, Math.round(value)),
  );
}

export function normalizeAutoPlaySeconds(
  value: unknown,
  fallback = AUTO_PLAY_INTERVAL_DEFAULT_SECONDS,
): number {
  const fallbackValue = finiteNumber(fallback) ?? AUTO_PLAY_INTERVAL_DEFAULT_SECONDS;
  return clampSeconds(finiteNumber(value) ?? fallbackValue);
}

export function normalizeAutoPlayIntervalMs(
  value: unknown,
  fallback = AUTO_PLAY_INTERVAL_DEFAULT_SECONDS * 1000,
): number {
  const fallbackMs = finiteNumber(fallback) ?? AUTO_PLAY_INTERVAL_DEFAULT_SECONDS * 1000;
  const milliseconds = finiteNumber(value) ?? fallbackMs;
  return normalizeAutoPlaySeconds(
    milliseconds / 1000,
    fallbackMs / 1000,
  ) * 1000;
}

export function stepAutoPlaySeconds(
  value: unknown,
  direction: -1 | 1,
  fallback = AUTO_PLAY_INTERVAL_DEFAULT_SECONDS,
): number {
  const current = normalizeAutoPlaySeconds(value, fallback);
  return normalizeAutoPlaySeconds(
    current + direction * AUTO_PLAY_INTERVAL_STEP_SECONDS,
    current,
  );
}

export function normalizeDoublePageDirection(
  value: unknown,
): UserSettings['doublePageDirection'] {
  return value === 'rtl' ? 'rtl' : 'ltr';
}
