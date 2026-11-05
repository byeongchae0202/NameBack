import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateFilename, isDirectChild, sanitizeTitle } from '../src/shared/filename';

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