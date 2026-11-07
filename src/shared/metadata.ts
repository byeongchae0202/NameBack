export interface NormalizedMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
}

const KOREAN_MOJIBAKE_MARKERS = /[ÃÀÁÂÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝß±²³µ¶¸¹º»¼½¾¿ìë]/;
const HAS_HANGUL = /[\uac00-\ud7af]/;
const HANGUL_CHARACTERS = /[\uac00-\ud7af]/g;
const LIKELY_MOJIBAKE = /(?:Ã[\u0080-\u00ff]|Â[\u0080-\u00ff]|[ìë][\u0080-\u00ff\u2018-\u203a]|[À-ÿ][À-ÿ]|\uFFFD)/;
const WINDOWS_1252_BYTES = new Map<string, number>([
  ['€', 0x80], ['‚', 0x82], ['ƒ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87],
  ['ˆ', 0x88], ['‰', 0x89], ['Š', 0x8a], ['‹', 0x8b], ['Œ', 0x8c], ['Ž', 0x8e], ['‘', 0x91],
  ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97], ['™', 0x99],
  ['š', 0x9a], ['›', 0x9b], ['œ', 0x9c], ['ž', 0x9e], ['Ÿ', 0x9f],
]);

function repairLegacyKoreanMojibake(value: string): string | null {
  if (!KOREAN_MOJIBAKE_MARKERS.test(value) || HAS_HANGUL.test(value)) return null;

  const sourceBytes = Array.from(value, (character) => character.codePointAt(0) ?? 0);
  if (sourceBytes.some((byte) => byte > 0xff)) return null;

  const isLeadByte = (byte: number) => byte >= 0x81 && byte <= 0xfe;
  const isTrailByte = (byte: number) =>
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    (byte >= 0x81 && byte <= 0xfe);
  const bytes: number[] = [];

  for (let index = 0; index < sourceBytes.length; index += 1) {
    const byte = sourceBytes[index];
    const nextByte = sourceBytes[index + 1];
    if (isLeadByte(byte) && nextByte !== undefined && isTrailByte(nextByte)) {
      bytes.push(byte, nextByte);
      index += 1;
    } else if (byte === 0xb7) {
      bytes.push(0xa1, 0xa4);
    } else {
      bytes.push(byte);
    }
  }

  try {
    const decoded = new TextDecoder('euc-kr', { fatal: true }).decode(Uint8Array.from(bytes));
    const decodedHangulCount = decoded.match(HANGUL_CHARACTERS)?.length ?? 0;
    return decodedHangulCount > 0 && !KOREAN_MOJIBAKE_MARKERS.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function repairUtf8Mojibake(value: string): string | null {
  if (!KOREAN_MOJIBAKE_MARKERS.test(value) || HAS_HANGUL.test(value)) return null;
  const bytes = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0xff) return codePoint;
    return WINDOWS_1252_BYTES.get(character) ?? -1;
  });
  if (bytes.some((byte) => byte < 0)) return null;

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    return KOREAN_MOJIBAKE_MARKERS.test(decoded) ? null : decoded;
  } catch {
    return null;
  }
}

function firstText(value: unknown): string | null {
  if (Array.isArray(value)) return firstText(value[0]);
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/[\u0001-\u001f\u007f]/g, ' ')
    .normalize('NFC')
    .trim();
  const repaired = repairUtf8Mojibake(text) ?? repairLegacyKoreanMojibake(text);
  if (!repaired && LIKELY_MOJIBAKE.test(text)) return null;
  return (repaired ?? text).trim() || null;
}

export function normalizeMetadata(value: {
  title?: unknown;
  artist?: unknown;
  album?: unknown;
}): NormalizedMetadata {
  return {
    title: firstText(value.title),
    artist: firstText(value.artist),
    album: firstText(value.album),
  };
}