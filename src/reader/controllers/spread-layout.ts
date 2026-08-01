export interface SpreadPage {
  key: string;
  width?: number;
  height?: number;
  failed?: boolean;
}

export interface SpreadViewport {
  width: number;
  height: number;
  gutter?: number;
}

export interface ReaderSpread {
  key: string;
  logicalIndices: readonly number[];
  primaryIndex: number;
  width: number;
  height: number;
}

export interface SpreadLayout {
  spreads: readonly ReaderSpread[];
  spreadIndexForLogical(index: number): number;
  logicalIndexForSpread(index: number): number;
  withPrimaryLogical(index: number): SpreadLayout;
}

const DEFAULT_GUTTER = 20;

function hasReliablePortraitSize(page: SpreadPage | undefined): page is Required<Pick<SpreadPage, 'key' | 'width' | 'height'>> & SpreadPage {
  return !!page
    && !page.failed
    && Number.isFinite(page.width)
    && Number.isFinite(page.height)
    && (page.width ?? 0) > 0
    && (page.height ?? 0) > 0
    && page.width! < page.height!;
}

function canPair(
  first: SpreadPage | undefined,
  second: SpreadPage | undefined,
  enabled: boolean,
  viewport: SpreadViewport,
): first is Required<Pick<SpreadPage, 'key' | 'width' | 'height'>> & SpreadPage {
  if (!enabled || !hasReliablePortraitSize(first) || !hasReliablePortraitSize(second)) return false;
  if (!(viewport.width > 0) || !(viewport.height > 0)) return false;
  const gutter = Math.max(0, viewport.gutter ?? DEFAULT_GUTTER);
  const fittedWidth = viewport.height * (first.width / first.height + second.width / second.height);
  return fittedWidth + gutter <= viewport.width;
}

function createSingle(page: SpreadPage, index: number): ReaderSpread {
  const width = page.width && page.width > 0 ? page.width : 1;
  const height = page.height && page.height > 0 ? page.height : 1;
  return {
    key: `single:${page.key}`,
    logicalIndices: [index],
    primaryIndex: index,
    width,
    height,
  };
}

export function createSpreadLayout(
  pages: readonly SpreadPage[],
  viewport: SpreadViewport,
  enabled: boolean,
  preferredPrimaryKey?: string,
): SpreadLayout {
  const spreads: ReaderSpread[] = [];
  const logicalToSpread = new Array<number>(pages.length);
  const gutter = Math.max(0, viewport.gutter ?? DEFAULT_GUTTER);

  for (let index = 0; index < pages.length; index += 2) {
    const first = pages[index];
    const second = pages[index + 1];
    if (second && canPair(first, second, enabled, viewport)) {
      const height = viewport.height;
      const firstWidth = height * (first.width! / first.height!);
      const secondWidth = height * (second.width! / second.height!);
      const preferredIndex = preferredPrimaryKey === second.key ? index + 1 : index;
      const spreadIndex = spreads.length;
      spreads.push({
        key: `double:${first.key}:${second.key}`,
        logicalIndices: [index, index + 1],
        primaryIndex: preferredIndex,
        width: firstWidth + gutter + secondWidth,
        height,
      });
      logicalToSpread[index] = spreadIndex;
      logicalToSpread[index + 1] = spreadIndex;
    } else {
      logicalToSpread[index] = spreads.length;
      spreads.push(createSingle(first, index));
      if (second) {
        logicalToSpread[index + 1] = spreads.length;
        spreads.push(createSingle(second, index + 1));
      }
    }
  }

  function build(nextSpreads: readonly ReaderSpread[]): SpreadLayout {
    return {
      spreads: nextSpreads,
      spreadIndexForLogical: index => logicalToSpread[index] ?? -1,
      logicalIndexForSpread: index => nextSpreads[index]?.primaryIndex ?? -1,
      withPrimaryLogical: index => {
        const spreadIndex = logicalToSpread[index];
        if (spreadIndex === undefined) return build(nextSpreads);
        const spread = nextSpreads[spreadIndex];
        if (!spread.logicalIndices.includes(index) || spread.primaryIndex === index) return build(nextSpreads);
        const updated = nextSpreads.slice();
        updated[spreadIndex] = { ...spread, primaryIndex: index };
        return build(updated);
      },
    };
  }

  return build(spreads);
}

export function formatSpreadCounter(
  spread: ReaderSpread | undefined,
  offset: number,
  total: number,
): string {
  if (!spread) return `0 / ${offset + total}`;
  const first = offset + spread.logicalIndices[0] + 1;
  const last = offset + spread.logicalIndices[spread.logicalIndices.length - 1] + 1;
  return `${first === last ? first : `${first}\u2013${last}`} / ${offset + total}`;
}
