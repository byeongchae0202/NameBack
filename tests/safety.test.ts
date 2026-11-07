import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseFile } from 'music-metadata';
import { allocateFilename, sanitizeTitle } from '../src/shared/filename';
import { normalizeMetadata } from '../src/shared/metadata';
import { createRecoveryPreviews, isSupportedRecoveryFile, titleFromFilename } from '../src/shared/recovery';
import { isDirectChild } from '../electron/pathSafety';

function syncsafeSize(size: number): Buffer {
  return Buffer.from([(size >>> 21) & 0x7f, (size >>> 14) & 0x7f, (size >>> 7) & 0x7f, size & 0x7f]);
}

function makeFrame(version: number, id: string, value: string, encoding: 0 | 1 | 3): Buffer {
  const text = encoding === 0
    ? Buffer.from(value, 'latin1')
    : encoding === 1
      ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, 'utf16le')])
      : Buffer.from(value, 'utf8');
  const body = Buffer.concat([Buffer.from([encoding]), text]);
  const size = version === 2
    ? Buffer.from([(body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff])
    : version === 4
      ? syncsafeSize(body.length)
      : Buffer.from([body.length >>> 24, body.length >>> 16, body.length >>> 8, body.length]);
  return version === 2
    ? Buffer.concat([Buffer.from(id), size, body])
    : Buffer.concat([Buffer.from(id), size, Buffer.from([0, 0]), body]);
}

function makeMp3(version: 2 | 3 | 4 | 1, encoding: 0 | 1 | 3, title: string, artist: string, album: string): Buffer {
  const frames = Buffer.alloc(417 * 3);
  for (let offset = 0; offset < frames.length; offset += 417) {
    frames.set([0xff, 0xfb, 0x90, 0x64], offset);
  }
  if (version === 1) {
    const tag = Buffer.alloc(128);
    tag.write('TAG', 0, 'ascii');
    tag.write(title, 3, 30, 'latin1');
    tag.write(artist, 33, 30, 'latin1');
    tag.write(album, 63, 30, 'latin1');
    return Buffer.concat([frames, tag]);
  }

  const frameIds = version === 2 ? ['TT2', 'TP1', 'TAL'] : ['TIT2', 'TPE1', 'TALB'];
  const tagFrames = [title, artist, album].map((value, index) => makeFrame(version, frameIds[index], value, encoding));
  const body = Buffer.concat(tagFrames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), syncsafeSize(body.length), body, frames]);
}

test('sanitizes Windows-invalid characters and trailing dots/spaces', () => {
  assert.deepEqual(sanitizeTitle('  Rain: Again?  '), { value: 'Rain Again', reason: null });
  assert.equal(sanitizeTitle('...  ').value, null);
});

test('rejects empty and reserved Windows filenames', () => {
  assert.equal(sanitizeTitle('').value, null);
  assert.match(sanitizeTitle('CON').reason ?? '', /예약 이름/);
});

test('allocates deterministic case-insensitive numbered suffixes', () => {
  const reserved = new Set(['Song.mp3', 'song (2).mp3']);
  assert.deepEqual(allocateFilename('Song', '.mp3', reserved), {
    name: 'Song (3).mp3',
    collided: true,
  });
});

test('accepts only direct children of the selected folder', () => {
  assert.equal(isDirectChild('C:/Music', 'C:/Music/track.mp3'), true);
  assert.equal(isDirectChild('C:/Music', 'C:/Music/sub/track.mp3'), false);
});

test('normalizes empty and array-valued metadata consistently', () => {
  assert.deepEqual(normalizeMetadata({ title: ['  Song title ', 'Alternate'], artist: '  ', album: null }), {
    title: 'Song title',
    artist: null,
    album: null,
  });
});

test('repairs CP949 Korean metadata misread as Latin-1 and preserves valid Hangul', () => {
  assert.deepEqual(normalizeMetadata({
    title: 'Ã³À½ºÎÅÍ Áö±Ý±îÁö·ù',
    artist: 'Sweet Dream(³»»ç¶ûÆÏÁãost)Àå³ª¶ó2Áý',
    album: '¹Ì·ÃÇÑ »ç¶ûJK ±èµ¿¿í',
  }), {
    title: '처음부터 지금까지류',
    artist: 'Sweet Dream(내사랑팥쥐ost)장나라2집',
    album: '미련한 사랑JK 김동욱',
  });
  assert.equal(normalizeMetadata({ title: '그리고 사랑해이수영' }).title, '그리고 사랑해이수영');
  assert.equal(normalizeMetadata({ title: '¾È' }).title, '안');
});

test('repairs UTF-8 mojibake and strips metadata control characters', () => {
  assert.equal(normalizeMetadata({ title: '\uFEFFì•ˆë…•\0' }).title, '안녕');
});

test('supports common audio and video extensions with safe filename fallback', () => {
  assert.equal(isSupportedRecoveryFile('clip.MKV'), true);
  assert.equal(isSupportedRecoveryFile('movie.avi'), true);
  assert.equal(isSupportedRecoveryFile('notes.txt'), false);
  assert.equal(titleFromFilename('recovery_42_My_Film.mp4'), 'My Film');
  assert.equal(titleFromFilename('recovery_xxx_Actual_Title.mp4'), 'Actual Title');
  assert.equal(titleFromFilename('%EC%95%88%EB%85%95.mp4'), '안녕');
  assert.equal(titleFromFilename('recovery_xxx.mp4'), null);
});

test('creates safe browser previews with case-insensitive collision suffixes', () => {
  const previews = createRecoveryPreviews([
    { name: 'recovered-01.mp3', metadata: { title: 'Song', artist: 'Artist', album: null } },
    { name: 'recovered-02.mp3', metadata: { title: 'song', artist: null, album: null } },
    { name: 'track-03.mp3', metadata: { title: '   ', artist: null, album: null } },
  ]);

  assert.deepEqual(previews.map((item) => [item.proposedName, item.status]), [
    ['Song.mp3', 'ready'],
    ['song (2).mp3', 'collision'],
    [null, 'unverified'],
  ]);
});

test('reads ID3v1 and ID3v2.2, v2.3, and v2.4 metadata fixtures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nameback-metadata-'));
  const fixtures = [
    { version: 2 as const, encoding: 0 as const, title: 'Rain Again', artist: 'Artist', album: 'First' },
    { version: 3 as const, encoding: 1 as const, title: '서른 즈음에', artist: '김광석', album: '다시 부르기' },
    { version: 4 as const, encoding: 3 as const, title: '비와 당신', artist: '박중훈', album: '라디오 스타' },
    { version: 1 as const, encoding: 0 as const, title: 'Legacy Title', artist: 'Old Artist', album: 'Old Album' },
  ];
  const filePaths = fixtures.map((_, index) => path.join(directory, `fixture-${index}.mp3`));

  try {
    await Promise.all(fixtures.map((fixture, index) => writeFile(
      filePaths[index],
      makeMp3(fixture.version, fixture.encoding, fixture.title, fixture.artist, fixture.album),
    )));
    const migrated = await Promise.all(filePaths.map(async (filePath) => {
      const metadata = await parseFile(filePath, { skipCovers: true, duration: false });
      return normalizeMetadata(metadata.common);
    }));

    assert.deepEqual(migrated, fixtures.map(({ title, artist, album }) => ({ title, artist, album })));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses meaningful filenames only when metadata titles are missing', () => {
  const previews = createRecoveryPreviews([
    { name: 'recovery_42_My_Film.mkv', metadata: { title: null, artist: null, album: null }, error: 'metadata unavailable' },
    { name: 'recovery_xxx.mp4', metadata: { title: null, artist: null, album: null }, error: 'metadata unavailable' },
  ]);

  assert.deepEqual(previews.map((item) => [item.title, item.proposedName, item.status]), [
    ['My Film', 'My Film.mkv', 'ready'],
    [null, null, 'unverified'],
  ]);
});

test('falls back to a clean filename when a nonempty metadata title is corrupted', () => {
  const previews = createRecoveryPreviews([
    { name: 'recovery_xxx_Actual_Title.mp4', metadata: { title: '\uFFFD title', artist: null, album: null } },
  ]);

  assert.deepEqual([previews[0].title, previews[0].proposedName, previews[0].status], [
    'Actual Title', 'Actual Title.mp4', 'ready',
  ]);
});