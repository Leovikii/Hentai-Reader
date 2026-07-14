import type { GalleryItem } from '../core/gallery';

/** Owns reader-local navigation and its live scroll-DOM registry. */
export class ReaderSession {
  private images: HTMLElement[] = [];
  private index = 0;
  private navigated = false;
  private previousIndex = -1;
  private readonly getItems: () => readonly GalleryItem[];

  constructor(getItems: () => readonly GalleryItem[]) {
    this.getItems = getItems;
  }

  syncImages(images: HTMLElement[]): boolean {
    const changed = images.length !== this.images.length
      || images.some((image, index) => image !== this.images[index]);
    if (!changed) return false;
    this.images = images;
    return true;
  }

  replaceImage(index: number, image: HTMLElement): void {
    if (index < 0 || index >= this.images.length) return;
    this.images[index] = image;
  }

  setCurrentIndex(index: number, trackNavigation = true): void {
    if (trackNavigation && this.previousIndex !== -1 && this.previousIndex !== index) {
      this.navigated = true;
    }
    this.previousIndex = index;
    this.index = index;
  }

  reset(startIndex: number): void {
    this.navigated = false;
    this.previousIndex = startIndex;
    this.index = startIndex;
  }

  prepend(count: number): void {
    this.index += count;
    this.previousIndex = this.index;
  }

  get currentIndex(): number { return this.index; }
  get lastIndex(): number { return this.previousIndex; }
  get hasNavigated(): boolean { return this.navigated; }
  get imageCount(): number { return this.images.length; }

  elementAt(index: number): HTMLElement | undefined {
    return this.images[index];
  }

  itemAt(index: number): GalleryItem | undefined {
    return this.getItems()[index];
  }

  indexOfViewerUrl(url: string): number {
    return this.getItems().findIndex(item => item.viewerUrl === url);
  }

  snapshotImages(): readonly HTMLElement[] {
    return this.images;
  }
}
