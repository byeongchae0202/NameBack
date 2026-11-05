import path from 'node:path';

const INVALID_WINDOWS_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export interface SafeFilename {
  value: string | null;
  reason: string | null;
}

export function sanitizeTitle(title: string | null | undefined): SafeFilename {
  if (!title?.trim()) {
    return { value: null, reason: '제목 태그가 비어 있습니다.' };
  }

  const cleaned = title
    .replace(INVALID_WINDOWS_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return { value: null, reason: '파일명으로 사용할 수 없는 제목입니다.' };
  }
  if (RESERVED_WINDOWS_NAME.test(cleaned)) {
    return { value: null, reason: 'Windows 예약 이름은 사용할 수 없습니다.' };
  }
  if (cleaned.length > 180) {
    return { value: null, reason: '제목이 파일명 길이 제한을 초과합니다.' };
  }

  return { value: cleaned, reason: null };
}

export function allocateFilename(
  title: string,
  extension: string,
  reservedNames: Set<string>,
): { name: string; collided: boolean } {
  const normalized = new Set([...reservedNames].map((name) => name.toLocaleLowerCase('en-US')));
  let suffix = 1;

  while (true) {
    const suffixText = suffix === 1 ? '' : ` (${suffix})`;
    const name = `${title}${suffixText}${extension}`;
    if (!normalized.has(name.toLocaleLowerCase('en-US'))) {
      return { name, collided: suffix > 1 };
    }
    suffix += 1;
  }
}

export function isDirectChild(folderPath: string, filePath: string): boolean {
  return path.dirname(path.resolve(filePath)).toLocaleLowerCase('en-US') ===
    path.resolve(folderPath).toLocaleLowerCase('en-US');
}

export function extensionOf(filePath: string): string {
  return path.extname(filePath);
}