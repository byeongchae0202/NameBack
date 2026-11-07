import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  createLightTheme,
  type BrandVariants,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  DismissCircleRegular,
  FolderOpenRegular,
  MusicNote2Regular,
  ShieldLockRegular,
} from '@fluentui/react-icons';
import type { RecoveryPreview, RecoveryWorkerEvent, RecoveryWorkerRequest } from '../shared/contracts';
import { isSupportedRecoveryFile } from '../shared/recovery';
import { extensionOf, sanitizeTitle } from '../shared/filename';

type BrowserPhase = 'idle' | 'analyze' | 'zip' | 'ready' | 'done' | 'error';
type WritableTarget = { write(data: ArrayBuffer): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
type SaveTarget = { createWritable(): Promise<WritableTarget> };
type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<SaveTarget>;
};

const brandRamp: BrandVariants = {
  10: '#061F1B', 20: '#0A352E', 30: '#0D4B40', 40: '#105D50',
  50: '#136C5B', 60: '#25816E', 70: '#3A9682', 80: '#58AA97',
  90: '#78BDAE', 100: '#9ACFC2', 110: '#B5DCD2', 120: '#C9E6DE',
  130: '#D8EEE8', 140: '#E5F4F0', 150: '#F0F9F6', 160: '#F8FCFA',
};

const theme = createLightTheme(brandRamp);
const fallbackLimit = 512 * 1024 * 1024;
const maxFileSize = 1024 * 1024 * 1024;
const maxSelectionSize = 2 * 1024 * 1024 * 1024;
type ProgressState = { completed: number; total: number; currentFile: string | null; bytesCompleted: number; totalBytes: number };
const emptyProgress: ProgressState = { completed: 0, total: 0, currentFile: null, bytesCompleted: 0, totalBytes: 0 };

function displayStatus(item: RecoveryPreview): string {
  if (item.status === 'ready') return 'ZIP에 포함';
  if (item.status === 'collision') return '충돌 회피';
  if (item.status === 'unchanged') return '이름 유지';
  return '미확인 · 제외';
}

function BrowserAppContent() {
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const filesRef = useRef<File[]>([]);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const writerRef = useRef<WritableTarget | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const writeFailedRef = useRef(false);
  const fallbackMessageRef = useRef<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const [results, setResults] = useState<RecoveryPreview[]>([]);
  const [selectedFileCount, setSelectedFileCount] = useState(0);
  const [phase, setPhase] = useState<BrowserPhase>('idle');
  const [progress, setProgress] = useState<ProgressState>(emptyProgress);
  const [isDragging, setIsDragging] = useState(false);
  const [filenameDrafts, setFilenameDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function createWorker(): Worker {
    const worker = new Worker(new URL('../workers/recovery.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<RecoveryWorkerEvent>) => {
      const message = event.data;
      if (message.jobId !== jobIdRef.current) return;
      if (message.type === 'recovery:progress') {
        setPhase(message.phase);
        setProgress({
          completed: message.completed,
          total: message.total,
          currentFile: message.currentFile ?? null,
          bytesCompleted: message.bytesCompleted ?? 0,
          totalBytes: message.totalBytes ?? 0,
        });
      } else if (message.type === 'recovery:analysis-result') {
        setResults(message.results);
        setPhase('ready');
        setProgress({ ...emptyProgress, completed: message.results.length, total: message.results.length });
      } else if (message.type === 'recovery:zip-chunk') {
        if (writerRef.current) {
          writeQueueRef.current = writeQueueRef.current.then(() => writerRef.current?.write(message.chunk)).then(() => undefined).catch((cause: unknown) => {
            if (jobIdRef.current !== message.jobId) return;
            writeFailedRef.current = true;
            setError(cause instanceof Error ? cause.message : 'ZIP 파일을 저장하지 못했습니다.');
            setPhase('error');
            worker.postMessage({ type: 'recovery:cancel', jobId: message.jobId } satisfies RecoveryWorkerRequest);
          });
        }
        else chunksRef.current.push(message.chunk);
      } else if (message.type === 'recovery:zip-complete') {
        void finishDownload(message.jobId, message.fileCount, message.size);
      } else if (message.type === 'recovery:cancelled') {
        void writerRef.current?.abort();
        writerRef.current = null;
        chunksRef.current = [];
        jobIdRef.current = null;
        setPhase((current) => current === 'analyze' ? 'idle' : 'ready');
      } else if (message.type === 'recovery:error') {
        void writerRef.current?.abort();
        writerRef.current = null;
        chunksRef.current = [];
        setError(message.message);
        setPhase('error');
      }
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      setError('브라우저 처리기를 시작하지 못했습니다. 페이지를 새로고침해 다시 시도해 주세요.');
      setPhase('error');
    };
    return worker;
  }

  useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  async function finishDownload(jobId: string, fileCount: number, size: number): Promise<void> {
    const writer = writerRef.current;
    try {
      if (writer) {
        await writeQueueRef.current;
        if (jobIdRef.current !== jobId) return;
        if (writeFailedRef.current) throw new Error('ZIP 파일을 저장하지 못했습니다.');
        await writer.close();
        if (writerRef.current === writer) writerRef.current = null;
      } else {
        const blob = new Blob(chunksRef.current, { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'nameback-recovered.zip';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        chunksRef.current = [];
      }
      if (jobIdRef.current !== jobId) return;
      const completion = `${fileCount}개 파일을 ZIP으로 저장했습니다. (${(size / 1024 / 1024).toFixed(1)} MB)`;
      setNotice(fallbackMessageRef.current ? `${fallbackMessageRef.current} ${completion}` : completion);
      fallbackMessageRef.current = null;
      setPhase('done');
      jobIdRef.current = null;
    } catch (cause) {
      if (jobIdRef.current !== jobId) return;
      setError(cause instanceof Error ? cause.message : 'ZIP 파일을 저장하지 못했습니다.');
      setPhase('error');
    }
  }

  function startAnalysis(mediaFiles: File[]): void {
    if (jobIdRef.current) workerRef.current?.postMessage({ type: 'recovery:cancel', jobId: jobIdRef.current } satisfies RecoveryWorkerRequest);
    jobIdRef.current = null;
    filesRef.current = mediaFiles;
    setSelectedFileCount(mediaFiles.length);
    setResults([]);
    setFilenameDrafts({});
    setNotice(null);
    setError(null);
    setProgress({ ...emptyProgress, total: mediaFiles.length, currentFile: mediaFiles[0]?.name ?? null });
    setPhase(mediaFiles.length > 0 ? 'analyze' : 'idle');
    if (mediaFiles.length === 0) return;

    const jobId = crypto.randomUUID();
    jobIdRef.current = jobId;
    workerRef.current?.postMessage({ type: 'recovery:analyze', jobId, files: mediaFiles } satisfies RecoveryWorkerRequest);
  }

  function selectFiles(selectedFiles: FileList | null, append = false): void {
    const selected = Array.from(selectedFiles ?? []);
    if (selected.length === 0) return;
    const files: File[] = append ? [...filesRef.current] : [];
    const seen = new Set(files.map((file) => `${file.name.toLocaleLowerCase('en-US')}:${file.size}:${file.lastModified}`));
    let totalSize = files.reduce((sum, file) => sum + file.size, 0);
    let unsupportedCount = 0;
    let oversizedCount = 0;
    let duplicateCount = 0;
    for (const file of selected) {
      if (!isSupportedRecoveryFile(file.name)) {
        unsupportedCount += 1;
        continue;
      }
      const key = `${file.name.toLocaleLowerCase('en-US')}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      if (file.size > maxFileSize || totalSize + file.size > maxSelectionSize) {
        oversizedCount += 1;
        continue;
      }
      seen.add(key);
      files.push(file);
      totalSize += file.size;
    }

    if (files.length > 0) startAnalysis(files);
    const warnings = [
      unsupportedCount > 0 ? `지원하지 않는 파일 ${unsupportedCount}개 제외` : '',
      oversizedCount > 0 ? `용량 제한 파일 ${oversizedCount}개 제외 (파일당 1 GiB, 전체 2 GiB)` : '',
      duplicateCount > 0 ? `중복 파일 ${duplicateCount}개 제외` : '',
    ].filter(Boolean);
    if (warnings.length > 0) {
      const message = warnings.join(' · ');
      if (files.length === 0) setError(message);
      else setNotice(message);
    }
  }

  function draftName(item: RecoveryPreview): string | null {
    const draft = filenameDrafts[item.sourceIndex];
    if (draft === undefined) return item.proposedName;
    const safeTitle = sanitizeTitle(draft);
    if (!safeTitle.value) return null;
    return `${safeTitle.value}${extensionOf(item.currentName)}`;
  }

  function editError(item: RecoveryPreview): string | null {
    if (filenameDrafts[item.sourceIndex] === undefined) return null;
    const safeTitle = sanitizeTitle(filenameDrafts[item.sourceIndex]);
    if (!safeTitle.value) return safeTitle.reason;
    const candidate = `${safeTitle.value}${extensionOf(item.currentName)}`.toLocaleLowerCase('en-US');
    return results.some((other) =>
      other.sourceIndex !== item.sourceIndex && draftName(other)?.toLocaleLowerCase('en-US') === candidate,
    ) ? '다른 파일과 이름이 중복됩니다.' : null;
  }

  function outputName(item: RecoveryPreview): string | null {
    return item.status === 'unverified' || editError(item) ? null : draftName(item);
  }

  function clearSelection(): void {
    jobIdRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = createWorker();
    const writer = writerRef.current;
    writerRef.current = null;
    if (writer) void writer.abort().catch(() => undefined);
    chunksRef.current = [];
    fallbackMessageRef.current = null;
    writeFailedRef.current = false;
    writeQueueRef.current = Promise.resolve();
    filesRef.current = [];
    setSelectedFileCount(0);
    setResults([]);
    setFilenameDrafts({});
    setProgress(emptyProgress);
    setIsDragging(false);
    dragDepthRef.current = 0;
    setNotice(null);
    setError(null);
    setPhase('idle');
  }

  async function downloadZip(): Promise<void> {
    const entries = results
      .filter((item) => item.status !== 'unverified')
      .flatMap((item) => {
        const name = outputName(item);
        return name ? [{ file: filesRef.current[item.sourceIndex], name }] : [];
      });
    if (entries.length === 0) return;

    const totalSize = entries.reduce((sum, entry) => sum + entry.file.size, 0);
    const pickerWindow = window as SavePickerWindow;
    let useBlobFallback = !pickerWindow.showSaveFilePicker;
    let fallbackMessage = useBlobFallback
      ? '이 환경에서는 파일 스트림 저장을 사용할 수 없어 브라우저 다운로드로 전환했습니다.'
      : null;
    try {
      writerRef.current = null;
      setError(null);
      setNotice(null);
      if (pickerWindow.showSaveFilePicker) {
        try {
          const target = await pickerWindow.showSaveFilePicker({
            suggestedName: 'nameback-recovered.zip',
            types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
          });
          writerRef.current = await target.createWritable();
          useBlobFallback = false;
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          writerRef.current = null;
          useBlobFallback = true;
          fallbackMessage = '파일 스트림 저장 권한이 없어 브라우저 다운로드로 전환했습니다.';
        }
      }
      if (useBlobFallback && totalSize > fallbackLimit) {
        const confirmed = window.confirm('이 브라우저의 다운로드 방식은 ZIP 전체를 메모리에 보관합니다. 선택 파일이 512 MB를 넘습니다. 계속할까요?');
        if (!confirmed) {
          setNotice(null);
          return;
        }
      }
      fallbackMessageRef.current = fallbackMessage;
      chunksRef.current = [];
      writeQueueRef.current = Promise.resolve();
      writeFailedRef.current = false;
      setProgress({ ...emptyProgress, total: entries.length, currentFile: entries[0]?.name ?? null });
      setPhase('zip');
      const jobId = crypto.randomUUID();
      jobIdRef.current = jobId;
      workerRef.current?.postMessage({ type: 'recovery:zip', jobId, entries } satisfies RecoveryWorkerRequest);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      writerRef.current = null;
      fallbackMessageRef.current = null;
      setError(cause instanceof Error ? cause.message : '저장할 ZIP 파일을 준비하지 못했습니다.');
      setPhase('error');
    }
  }

  function cancelJob(): void {
    if (jobIdRef.current) {
      workerRef.current?.postMessage({ type: 'recovery:cancel', jobId: jobIdRef.current } satisfies RecoveryWorkerRequest);
    }
  }

  const eligibleCount = results.filter((item) => item.status !== 'unverified').length;
  const invalidEditCount = results.filter((item) => editError(item)).length;
  const busy = phase === 'analyze' || phase === 'zip';

  return (
    <FluentProvider theme={theme}>
      <div className="browser-shell browser-enter">
        <header className="browser-header">
          <div className="browser-brand"><span className="browser-brand-mark"><MusicNote2Regular /></span><Text weight="semibold">NameBack</Text></div>
          <div className="browser-header-actions">
            {(selectedFileCount > 0 || phase !== 'idle' || error || notice) && (
              <Button appearance="secondary" icon={<ArrowLeftRegular />} onClick={clearSelection}>
                다시 선택
              </Button>
            )}
            <Badge appearance="tint" color="success" icon={<ShieldLockRegular />}>이 브라우저에서만 처리</Badge>
          </div>
        </header>

        <main className="browser-main">
          <section className="browser-intro">
            <Text className="browser-eyebrow">LOCAL MEDIA RECOVERY</Text>
            <h1>오디오 · 동영상 파일 복구</h1>
            <Text>미디어 메타데이터와 파일명을 확인하고, 안전하게 생성한 파일명을 ZIP으로 저장합니다.</Text>
          </section>

          <Card className="browser-picker">
            <Field label="로컬 오디오 · 동영상 파일" hint="MP3, MP4, AVI, MKV 등 · 파일당 1 GiB, 전체 2 GiB까지">
              <input
                ref={fileInputRef}
                className="browser-file-input"
                type="file"
                accept=".mp3,.m4a,.mp4,.m4v,.mov,.3gp,.wav,.flac,.ogg,.opus,.wma,.avi,.mkv,.webm,.wmv,.mpg,.mpeg,audio/*,video/*"
                multiple
                disabled={busy}
                onChange={(event) => {
                  selectFiles(event.currentTarget.files, filesRef.current.length > 0);
                  event.currentTarget.value = '';
                }}
              />
              <div
                className={`browser-dropzone${isDragging ? ' is-dragging' : ''}${busy ? ' is-disabled' : ''}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!busy) {
                    dragDepthRef.current += 1;
                    setIsDragging(true);
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                  if (dragDepthRef.current === 0) setIsDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dragDepthRef.current = 0;
                  setIsDragging(false);
                  if (!busy) selectFiles(event.dataTransfer.files, true);
                }}
                aria-label="미디어 파일을 여기에 끌어다 놓기"
              >
                <FolderOpenRegular />
                <Text weight="semibold">파일을 끌어다 놓으세요</Text>
                <Text className="muted">여러 파일을 선택하거나 기존 목록에 추가할 수 있습니다.</Text>
                <Button
                  appearance="secondary"
                  icon={<FolderOpenRegular />}
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >{filesRef.current.length > 0 ? '파일 추가' : '파일 선택'}</Button>
              </div>
            </Field>
            <div className="browser-privacy" role="note">
              <ShieldLockRegular />
              <Text>선택한 파일의 내용과 태그 정보는 이 브라우저에서만 처리되며 서버로 전송되지 않습니다.</Text>
            </div>
          </Card>

          {error && <MessageBar intent="error" className="browser-notice">{error}<Button appearance="subtle" size="small" onClick={() => startAnalysis(filesRef.current)}>다시 분석</Button></MessageBar>}
          {notice && <MessageBar intent="success" className="browser-notice">{notice}</MessageBar>}

          {phase === 'analyze' && (
            <Card className="browser-state" aria-live="polite">
              <ProgressBar value={progress.total ? progress.completed / progress.total : 0} />
              <Text>
                미디어 정보 분석 중 · {progress.currentFile ? `${Math.min(progress.completed + 1, progress.total)}/${progress.total}번째 파일 · ${progress.currentFile}` : `${progress.completed}/${progress.total}개 완료`}
              </Text>
              <Button appearance="subtle" onClick={cancelJob}>취소</Button>
            </Card>
          )}

          {phase === 'idle' && !error && (
            <Card className="browser-empty">
              <span className="browser-empty-icon"><FolderOpenRegular /></span>
              <Text weight="semibold">미리볼 파일이 없습니다</Text>
              <Text className="muted">파일을 선택하면 제목과 제안 파일명을 확인할 수 있습니다.</Text>
            </Card>
          )}

          {results.length > 0 && (
            <section className="browser-results" aria-labelledby="browser-results-title">
              <div className="browser-section-heading">
                <div><Text className="browser-section-kicker">REVIEW</Text><h2 id="browser-results-title">복구 미리보기</h2></div>
                <Badge appearance="tint">{results.length}개 파일 · {eligibleCount}개 포함 가능</Badge>
              </div>
              <div className="browser-table-scroll">
                <Table aria-label="브라우저 파일명 복구 미리보기" size="small">
                  <TableHeader><TableRow>
                    <TableHeaderCell>선택한 파일</TableHeaderCell>
                    <TableHeaderCell>제목 · 아티스트</TableHeaderCell>
                    <TableHeaderCell>복구 파일명 편집</TableHeaderCell>
                    <TableHeaderCell>결과</TableHeaderCell>
                  </TableRow></TableHeader>
                  <TableBody>{results.map((item) => (
                    <TableRow key={`${item.sourceIndex}-${item.currentName}`}>
                      <TableCell><Text className="file-name">{item.currentName}</Text></TableCell>
                      <TableCell>
                        <Text className="file-title">{item.title ?? '제목 없음'}</Text>
                        {(item.artist || item.album) && <Text className="file-reference">{[item.artist, item.album].filter(Boolean).join(' · ')}</Text>}
                        {item.reason && <Text className="error-detail">{item.reason}</Text>}
                      </TableCell>
                      <TableCell>
                        {item.proposedName && item.status !== 'unverified' ? (
                          <div className="browser-name-editor">
                            <Input
                              aria-label={`${item.currentName} 복구 파일명`}
                              value={filenameDrafts[item.sourceIndex] ?? item.proposedName.slice(0, item.proposedName.length - extensionOf(item.currentName).length)}
                              className={editError(item) ? 'browser-input-invalid' : undefined}
                              onChange={(_, data) => setFilenameDrafts((current) => ({ ...current, [item.sourceIndex]: data.value }))}
                            />
                            <Text className="file-extension">{extensionOf(item.currentName) || '확장자 없음'}</Text>
                            {editError(item) && <Text className="error-detail">{editError(item)}</Text>}
                          </div>
                        ) : <Text className="muted">변경 안 함</Text>}
                      </TableCell>
                      <TableCell>
                        <Badge appearance="tint" color={editError(item) || item.status === 'unverified' ? 'warning' : item.status === 'collision' ? 'danger' : 'success'}>
                          {editError(item) ? '이름 확인 필요' : displayStatus(item)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
              <footer className="browser-actions">
                {phase === 'zip' ? (
                  <>
                    <Text className="muted">
                      ZIP 생성 중 · {progress.completed}/{progress.total}개
                      {progress.currentFile ? ` · ${progress.currentFile}` : ''}
                      {progress.totalBytes > 0 ? ` · ${(progress.bytesCompleted / 1024 / 1024).toFixed(0)}/${(progress.totalBytes / 1024 / 1024).toFixed(0)} MB` : ''}
                    </Text>
                    <ProgressBar
                      className="browser-zip-progress"
                      value={progress.totalBytes > 0
                        ? progress.bytesCompleted / progress.totalBytes
                        : progress.total ? progress.completed / progress.total : 0}
                    />
                    <Button appearance="secondary" onClick={cancelJob}>취소</Button>
                  </>
                ) : (
                  <>
                    <Text className="muted">
                      {invalidEditCount > 0 ? `수정한 이름 ${invalidEditCount}개를 확인해 주세요.` : '미확인 파일은 포함되지 않습니다.'}
                    </Text>
                    <Button
                      appearance="primary"
                      icon={<ArrowDownloadRegular />}
                      disabled={eligibleCount === 0 || busy || invalidEditCount > 0}
                      onClick={() => void downloadZip()}
                    >ZIP 저장</Button>
                  </>
                )}
              </footer>
            </section>
          )}

          {phase === 'error' && !results.length && (
            <Card className="browser-state browser-error-state">
              <DismissCircleRegular />
              <Text weight="semibold">처리를 완료하지 못했습니다</Text>
              <Button appearance="secondary" icon={<ArrowClockwiseRegular />} onClick={() => startAnalysis(filesRef.current)}>다시 시도</Button>
            </Card>
          )}

          <footer className="browser-footer">제목을 확인할 수 없는 파일은 제외 · 원본 내용은 바뀌지 않음 · 계정 불필요</footer>
        </main>
      </div>
    </FluentProvider>
  );
}

export function BrowserApp() {
  return <BrowserAppContent />;
}