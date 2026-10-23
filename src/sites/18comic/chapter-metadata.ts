interface ChapterMetadata {
  aid?: string;
  scramble_id?: string;
}

export function get18ComicChapterMetadata(doc: Document, fallback: ChapterMetadata = {}) {
  // Read page-local scripts, not attributes or suffixes such as next_aid.
  const scripts = Array.from(doc.querySelectorAll('script'), script => script.textContent || '').join('\n');
  const read = (name: keyof ChapterMetadata) => scripts.match(new RegExp(
    `(?:^|[^\\w$.-])(?:window\\.)?${name}\\s*=\\s*(['"]?)(\\d+)\\1(?![\\w$.])`,
  ))?.[2] || fallback[name] || '';
  return { aid: read('aid'), scrambleId: read('scramble_id') };
}
