import { Zip, ZipPassThrough } from 'fflate';
import type { RecoveryWorkerEvent, RecoveryWorkerRequest } from '../shared/contracts';
import { createRecoveryPreviews } from '../shared/recovery';
import { normalizeMetadata } from '../shared/metadata';

const workerContext = self as unknown as {
  onmessage: ((event: MessageEvent<RecoveryWorkerRequest>) => void) | null;
  postMessage(message: RecoveryWorkerEvent, transfer?: Transferable[]): void;
};

const jobs = new Map<string, AbortController>();

function send(event: RecoveryWorkerEvent, transfer?: Transferable[]): void {
  workerContext.postMessage(event, transfer);
}

async function analyze(jobId: string, files: File[], controller: AbortController): Promise<void> {
  const { parseBlob } = await import('music-metadata');
  const parsed: Array<{
    name: string;
    metadata: ReturnType<typeof normalizeMetadata>;
    error: string | null;
  }> = [];

  for (const [index, file] of files.entries()) {
    if (controller.signal.aborted) {
      send({ type: 'recovery:cancelled', jobId });
      return;
    }
    send({
      type: 'recovery:progress',
      jobId,
      phase: 'analyze',
      completed: index,
      total: files.length,
      currentFile: file.name,
    });
    try {
      const metadata = await parseBlob(file, { skipCovers: true, duration: false });
      parsed.push({ name: file.name, metadata: normalizeMetadata(metadata.common), error: null });
    } catch {
      parsed.push({
        name: file.name,
        metadata: { title: null, artist: null, album: null },
        error: '파일 메타데이터를 읽을 수 없습니다.',
      });
    }
    send({
      type: 'recovery:progress',
      jobId,
      phase: 'analyze',
      completed: index + 1,
      total: files.length,
      currentFile: files[index + 1]?.name,
    });
  }

  send({ type: 'recovery:analysis-result', jobId, results: createRecoveryPreviews(parsed) });
}

async function createZip(
  jobId: string,
  entries: Array<{ file: File; name: string }>,
  controller: AbortController,
): Promise<void> {
  let resolveArchive: () => void = () => undefined;
  let rejectArchive: (error: Error) => void = () => undefined;
  const archiveComplete = new Promise<void>((resolve, reject) => {
    resolveArchive = resolve;
    rejectArchive = reject;
  });
  let size = 0;
  const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  let lastReportedBytes = 0;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      rejectArchive(error);
      return;
    }
    if (chunk.byteLength > 0) {
      const transferable = chunk.slice();
      send({ type: 'recovery:zip-chunk', jobId, chunk: transferable.buffer }, [transferable.buffer]);
    }
    if (final) resolveArchive();
  });

  for (const [index, entry] of entries.entries()) {
    if (controller.signal.aborted) {
      send({ type: 'recovery:cancelled', jobId });
      return;
    }
    send({
      type: 'recovery:progress',
      jobId,
      phase: 'zip',
      completed: index,
      total: entries.length,
      currentFile: entry.name,
      bytesCompleted: size,
      totalBytes,
    });
    const zipEntry = new ZipPassThrough(entry.name);
    zip.add(zipEntry);
    const reader = entry.file.stream().getReader();
    try {
      while (true) {
        if (controller.signal.aborted) {
          await reader.cancel();
          send({ type: 'recovery:cancelled', jobId });
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        zipEntry.push(value, false);
        if (size - lastReportedBytes >= 8 * 1024 * 1024) {
          lastReportedBytes = size;
          send({
            type: 'recovery:progress',
            jobId,
            phase: 'zip',
            completed: index,
            total: entries.length,
            currentFile: entry.name,
            bytesCompleted: size,
            totalBytes,
          });
        }
      }
      zipEntry.push(new Uint8Array(), true);
    } finally {
      reader.releaseLock();
    }
    send({
      type: 'recovery:progress',
      jobId,
      phase: 'zip',
      completed: index + 1,
      total: entries.length,
      currentFile: entries[index + 1]?.name,
      bytesCompleted: size,
      totalBytes,
    });
  }

  zip.end();
  await archiveComplete;
  send({ type: 'recovery:zip-complete', jobId, fileCount: entries.length, size });
}

workerContext.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'recovery:cancel') {
    jobs.get(request.jobId)?.abort();
    return;
  }

  const controller = new AbortController();
  jobs.set(request.jobId, controller);
  const task = request.type === 'recovery:analyze'
    ? analyze(request.jobId, request.files, controller)
    : createZip(request.jobId, request.entries, controller);
  void task.catch((error: unknown) => {
    if (controller.signal.aborted) send({ type: 'recovery:cancelled', jobId: request.jobId });
    else send({
      type: 'recovery:error',
      jobId: request.jobId,
      message: error instanceof Error ? error.message : '브라우저 파일 처리를 완료하지 못했습니다.',
    });
  }).finally(() => jobs.delete(request.jobId));
};