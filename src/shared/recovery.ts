import { allocateFilename, extensionOf, sanitizeTitle } from './filename';
import type { RecoveryPreview } from './contracts';
import { normalizeMetadata, type NormalizedMetadata } from './metadata';

const RECOVERY_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.mp4', '.m4v', '.mov', '.3gp', '.wav', '.flac', '.ogg', '.opus', '.wma',
  '.avi', '.mkv', '.webm', '.wmv', '.mpg', '.mpeg',
]);
const GENERIC_FILENAME = /^(?:(?:recovery|recovered|restored)[ _-]*(?:x{2,}|unknown|temp(?:orary)?|file|audio|video|\d+)|x{2,}|unknown|untitled|temp(?:orary)?|recovery|recovered|restored|file|audio|video|track)(?:[ _-]?\d+)?$/i;
const RECOVERY_PREFIX = /^(?:recovery|recovered|restored)[_-]+(?:(?:\d+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|x{2,}|unknown|temp(?:orary)?|file|audio|video)[_-]+)+/i;

export function isSupportedRecoveryFile(name: string): boolean {
  const extension = name.match(/\.[^.\\/]+$/)?.[0].toLocaleLowerCase('en-US') ?? '';
  return RECOVERY_EXTENSIONS.has(extension);
}

export function titleFromFilename(name: string): string | null {
  const baseName = name.split(/[\\/]/).pop() ?? name;
  const extensionIndex = baseName.lastIndexOf('.');
  const stem = extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
  let candidate = stem;

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    candidate = candidate.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }

  candidate = candidate
    .replace(RECOVERY_PREFIX, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  candidate = normalizeMetadata({ title: candidate }).title ?? '';

  if (!candidate || GENERIC_FILENAME.test(candidate)) return null;
  return candidate;
}

export function createRecoveryPreviews(
  files: Array<{ name: string; metadata: NormalizedMetadata; error?: string | null }>,
): RecoveryPreview[] {
  const reservedNames = new Set(files.map((file) => file.name.toLocaleLowerCase('en-US')));

  return files.map((file, sourceIndex) => {
    const { title: normalizedTitle, artist, album } = normalizeMetadata(file.metadata);
    const title = normalizedTitle ?? titleFromFilename(file.name);
    const safeTitle = sanitizeTitle(title);
    const usedFilenameFallback = !normalizedTitle && Boolean(title);
    const reason = usedFilenameFallback
      ? '태그를 읽을 수 없어 파일명에서 제목을 추정했습니다.'
      : file.error ?? safeTitle.reason;
    if (!safeTitle.value) {
      return {
        sourceIndex,
        currentName: file.name,
        title,
        artist,
        album,
        proposedName: null,
        status: 'unverified',
        reason,
      };
    }

    const extension = extensionOf(file.name);
    const directName = `${safeTitle.value}${extension}`;
    if (directName.toLocaleLowerCase('en-US') === file.name.toLocaleLowerCase('en-US')) {
      return {
        sourceIndex,
        currentName: file.name,
        title,
        artist,
        album,
        proposedName: file.name,
        status: 'unchanged',
        reason: null,
      };
    }

    const allocation = allocateFilename(safeTitle.value, extension, reservedNames);
    reservedNames.add(allocation.name.toLocaleLowerCase('en-US'));
    return {
      sourceIndex,
      currentName: file.name,
      title,
      artist,
      album,
      proposedName: allocation.name,
      status: allocation.collided ? 'collision' : 'ready',
      reason: null,
    };
  });
}