import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  FluentProvider,
  Input,
  MessageBar,
  Spinner,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  ClockRegular,
  FolderOpenRegular,
  HistoryRegular,
  MusicNote2Regular,
  SearchRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import type {
  AudioFile,
  HistoryEntry,
  OperationResult,
  RenamePreview,
  UnverifiedEntry,
} from '../shared/contracts';

type ViewKey = 'rename' | 'unverified' | 'history';
type ThemeChoice = 'light' | 'dark' | 'system';

const brandRamp: BrandVariants = {
  10: '#061F1B', 20: '#0A352E', 30: '#0D4B40', 40: '#105D50',
  50: '#136C5B', 60: '#25816E', 70: '#3A9682', 80: '#58AA97',
  90: '#78BDAE', 100: '#9ACFC2', 110: '#B5DCD2', 120: '#C9E6DE',
  130: '#D8EEE8', 140: '#E5F4F0', 150: '#F0F9F6', 160: '#F8FCFA',
};

const lightTheme = createLightTheme(brandRamp);
const darkTheme = createDarkTheme(brandRamp);

function readThemeChoice(): ThemeChoice {
  const saved = localStorage.getItem('app-theme');
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '작업을 완료하지 못했습니다.';
}

function statusLabel(status: RenamePreview['status']): string {
  if (status === 'ready') return '변경 가능';
  if (status === 'collision') return '번호 부여';
  if (status === 'unchanged') return '변경 없음';
  return '미확인';
}

function operationLabel(status: OperationResult['status']): string {
  if (status === 'success') return '변경 완료';
  if (status === 'restored') return '복원 완료';
  return '실패';
}

function AppContent() {
  const [view, setView] = useState<ViewKey>('rename');
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [previews, setPreviews] = useState<RenamePreview[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [unverified, setUnverified] = useState<UnverifiedEntry[]>([]);
  const [results, setResults] = useState<OperationResult[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readThemeChoice);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  const isDark = themeChoice === 'dark' || (themeChoice === 'system' && systemDark);
  const selectedPaths = previews.filter((item) => item.selected).map((item) => item.sourcePath);
  const visiblePreviews = previews.filter((item) =>
    `${item.currentName} ${item.title ?? ''} ${item.artist ?? ''}`.toLocaleLowerCase('ko').includes(search.toLocaleLowerCase('ko')),
  );
  const eligibleCount = previews.filter((item) => item.status === 'ready' || item.status === 'collision').length;
  const selectedCount = previews.filter((item) => item.selected).length;

  useEffect(() => {
    void Promise.all([window.nameBack.listHistory(), window.nameBack.listUnverified()])
      .then(([nextHistory, nextUnverified]) => {
        setHistory(nextHistory);
        setUnverified(nextUnverified);
      })
      .catch((cause: unknown) => setError(messageFrom(cause)));
  }, []);

  useEffect(() => {
    const mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mediaQuery.addEventListener('change', updateSystemTheme);
    return () => mediaQuery.removeEventListener('change', updateSystemTheme);
  }, []);

  function chooseTheme(): void {
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem('app-theme', next);
    setThemeChoice(next);
  }

  async function loadFolder(folder: string, initialFiles?: AudioFile[]): Promise<void> {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const scan = initialFiles ? { folderPath: folder, files: initialFiles } : await window.nameBack.scanFolder();
      setFolderPath(scan.folderPath);
      setFiles(scan.files);
      const initialSelection = scan.files.filter((file) => file.status === 'eligible').map((file) => file.path);
      const nextPreviews = await window.nameBack.previewRename(initialSelection);
      setPreviews(nextPreviews);
      setUnverified(await window.nameBack.listUnverified());
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectFolder(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const scan = await window.nameBack.selectFolder();
      if (scan) await loadFolder(scan.folderPath, scan.files);
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setLoading(false);
    }
  }

  async function toggleSelection(item: RenamePreview, checked: boolean): Promise<void> {
    const next = new Set(selectedPaths);
    if (checked) next.add(item.sourcePath);
    else next.delete(item.sourcePath);
    try {
      setPreviews(await window.nameBack.previewRename([...next]));
      setError(null);
    } catch (cause) {
      setError(messageFrom(cause));
    }
  }

  async function selectAll(checked: boolean): Promise<void> {
    const next = checked
      ? previews.filter((item) => item.status === 'ready' || item.status === 'collision').map((item) => item.sourcePath)
      : [];
    try {
      setPreviews(await window.nameBack.previewRename(next));
      setError(null);
    } catch (cause) {
      setError(messageFrom(cause));
    }
  }

  async function executeSelected(): Promise<void> {
    if (selectedPaths.length === 0) return;
    const confirmed = window.confirm(`선택한 ${selectedPaths.length}개 파일의 이름을 미리보기대로 변경할까요?\n파일 내용은 바뀌지 않습니다.`);
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    try {
      const nextResults = await window.nameBack.executeRename(selectedPaths);
      setResults(nextResults);
      if (folderPath) await loadFolder(folderPath);
      const [nextHistory, nextUnverified] = await Promise.all([
        window.nameBack.listHistory(),
        window.nameBack.listUnverified(),
      ]);
      setHistory(nextHistory);
      setUnverified(nextUnverified);
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setLoading(false);
    }
  }

  async function restore(entry: HistoryEntry): Promise<void> {
    if (!window.confirm(`“${entry.proposedName}”을(를) 원래 이름 “${entry.originalName}”으로 복원할까요?`)) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.nameBack.restoreHistory(entry.id);
      if (result.status === 'failed') setError(result.error ?? '복원하지 못했습니다.');
      setHistory(await window.nameBack.listHistory());
      if (folderPath && result.status === 'restored') await loadFolder(folderPath);
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setLoading(false);
    }
  }

  function renderRenameView() {
    if (loading && files.length === 0) {
      return <div className="state-panel"><Spinner label="폴더의 MP3 파일과 태그를 읽고 있습니다" /></div>;
    }
    if (!folderPath) {
      return (
        <Card className="empty-panel">
          <div className="empty-icon"><FolderOpenRegular /></div>
          <Text size={500} weight="semibold">작업할 폴더를 선택해 주세요</Text>
          <Text className="empty-copy">선택한 폴더 바로 아래의 MP3 파일만 확인합니다. 파일 내용은 수정하지 않습니다.</Text>
          <Button appearance="primary" icon={<FolderOpenRegular />} onClick={() => void handleSelectFolder()}>
            MP3 폴더 선택
          </Button>
        </Card>
      );
    }
    if (files.length === 0) {
      return (
        <Card className="empty-panel">
          <div className="empty-icon"><MusicNote2Regular /></div>
          <Text size={500} weight="semibold">이 폴더에서 MP3를 찾지 못했습니다</Text>
          <Text className="empty-copy">다른 폴더를 선택하거나 폴더 내용을 확인해 주세요.</Text>
          <Button appearance="primary" icon={<FolderOpenRegular />} onClick={() => void handleSelectFolder()}>
            다른 폴더 선택
          </Button>
        </Card>
      );
    }
    if (visiblePreviews.length === 0) {
      return <div className="state-panel"><SearchRegular /><Text>검색 결과가 없습니다.</Text></div>;
    }
    return (
      <div className="table-scroll">
        <Table aria-label="파일명 변경 미리보기" size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell className="select-column">
                <Checkbox
                  aria-label="변경 가능한 파일 전체 선택"
                  checked={eligibleCount > 0 && selectedCount === eligibleCount}
                  onChange={(_, data) => void selectAll(data.checked === true)}
                />
              </TableHeaderCell>
              <TableHeaderCell>현재 파일명</TableHeaderCell>
              <TableHeaderCell>제목</TableHeaderCell>
              <TableHeaderCell>변경할 파일명</TableHeaderCell>
              <TableHeaderCell>상태</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiblePreviews.map((item) => {
              const eligible = item.status === 'ready' || item.status === 'collision';
              return (
                <TableRow key={item.sourcePath}>
                  <TableCell className="select-column">
                    <Checkbox
                      aria-label={`${item.currentName} 선택`}
                      checked={item.selected}
                      disabled={!eligible || loading}
                      onChange={(_, data) => void toggleSelection(item, data.checked === true)}
                    />
                  </TableCell>
                  <TableCell><Text className="file-name">{item.currentName}</Text></TableCell>
                  <TableCell>
                    <Text className="file-title">{item.title ?? '제목 없음'}</Text>
                    {(item.artist || item.album) && (
                      <Text className="file-reference">{[item.artist, item.album].filter(Boolean).join(' · ')}</Text>
                    )}
                    {item.reason && <Text className="file-reference">{item.reason}</Text>}
                  </TableCell>
                  <TableCell><Text className={eligible ? 'target-name' : 'muted'}>{item.proposedName ?? '변경 안 함'}</Text></TableCell>
                  <TableCell>
                    <Badge appearance="tint" color={item.status === 'unverified' ? 'warning' : 'success'}>
                      {statusLabel(item.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <FluentProvider theme={isDark ? darkTheme : lightTheme}>
      <div className={`app-shell${isDark ? ' dark' : ''}`}>
        <aside className="sidebar">
          <div className="brand-lockup">
            <div className="brand-mark"><MusicNote2Regular /></div>
            <span>NameBack</span>
          </div>
          <TabList
            vertical
            selectedValue={view}
            onTabSelect={(_, data) => setView(data.value as ViewKey)}
            className="side-nav"
            aria-label="주 메뉴"
          >
            <Tab value="rename" icon={<MusicNote2Regular />}>이름 변경</Tab>
            <Tab value="unverified" icon={<WarningRegular />}>
              미확인 <span className="nav-count">{unverified.length}</span>
            </Tab>
            <Tab value="history" icon={<HistoryRegular />}>변경 이력</Tab>
          </TabList>
          <div className="sidebar-foot">로컬 파일 처리 · 네트워크 연결 없음</div>
        </aside>

        <main className="workspace">
          <header className="topbar">
            <div className="page-heading">
              <Text className="eyebrow">NAMEBACK / LOCAL LIBRARY</Text>
              <h1>{view === 'rename' ? '이름 변경 미리보기' : view === 'unverified' ? '미확인 파일' : '변경 이력'}</h1>
              <Text className="subheading">
                {view === 'rename' ? '제목 태그를 확인하고 변경할 파일을 선택하세요.' : view === 'unverified' ? '제목이 없거나 안전한 파일명으로 만들 수 없는 파일입니다.' : '이전 작업을 확인하고 안전하게 복원합니다.'}
              </Text>
            </div>
            <div className="top-actions">
              <Button
                appearance="subtle"
                icon={isDark ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
                aria-label={isDark ? '밝은 테마로 전환' : '어두운 테마로 전환'}
                title={isDark ? '밝은 테마' : '어두운 테마'}
                onClick={chooseTheme}
              />
              <Button appearance="primary" icon={<FolderOpenRegular />} onClick={() => void handleSelectFolder()} disabled={loading}>
                폴더 선택
              </Button>
            </div>
          </header>

          {error && <MessageBar intent="error" className="notice">{error}</MessageBar>}

          {view === 'rename' && (
            <section className="content-section page-enter">
              <div className="folder-bar">
                <div className="folder-location">
                  <FolderOpenRegular />
                  <Text title={folderPath ?? undefined}>{folderPath ?? '선택된 폴더 없음'}</Text>
                </div>
                <Input
                  className="search-box"
                  contentBefore={<SearchRegular />}
                  aria-label="파일명 또는 제목 검색"
                  placeholder="파일명 또는 제목 검색"
                  value={search}
                  onChange={(_, data) => setSearch(data.value)}
                />
              </div>
              <div className="summary-row">
                <span><strong>{files.length}</strong>개 MP3</span>
                <span><strong>{eligibleCount}</strong>개 변경 가능</span>
                <span><strong>{previews.filter((item) => item.status === 'unverified').length}</strong>개 미확인</span>
              </div>
              {renderRenameView()}
              {folderPath && files.length > 0 && (
                <div className="action-row">
                  <Text className="muted">선택 {selectedCount}개 · 대상 이름을 덮어쓰지 않습니다.</Text>
                  <Button
                    appearance="primary"
                    icon={<MusicNote2Regular />}
                    disabled={selectedCount === 0 || loading}
                    onClick={() => void executeSelected()}
                  >
                    선택한 {selectedCount}개 이름 변경
                  </Button>
                </div>
              )}
              {loading && files.length > 0 && <div className="inline-progress"><Spinner size="tiny" label="처리 중" /></div>}
              {results.length > 0 && (
                <section className="results-block" aria-live="polite">
                  <div className="section-title"><ClockRegular /><Text weight="semibold">이번 처리 결과</Text></div>
                  {results.map((result, index) => (
                    <div className="result-line" key={`${result.originalPath}-${index}`}>
                      <span>{result.resultingPath ? `${result.originalPath.split(/[\\/]/).pop()} → ${result.resultingPath.split(/[\\/]/).pop()}` : result.originalPath.split(/[\\/]/).pop()}</span>
                      <Badge appearance="tint" color={result.status === 'failed' ? 'danger' : 'success'}>{operationLabel(result.status)}</Badge>
                      {result.error && <Text className="error-detail">{result.error}</Text>}
                    </div>
                  ))}
                </section>
              )}
            </section>
          )}

          {view === 'unverified' && (
            <section className="content-section page-enter">
              <div className="section-heading"><WarningRegular /><Text weight="semibold">확인이 필요한 MP3</Text><span className="heading-count">{unverified.length}</span></div>
              {unverified.length === 0 ? (
                <Card className="empty-panel compact-empty">
                  <div className="empty-icon"><WarningRegular /></div>
                  <Text size={500} weight="semibold">미확인 파일이 없습니다</Text>
                  <Text className="empty-copy">폴더를 검색하면 제목 태그가 없는 파일이 여기에 표시됩니다.</Text>
                  <Button appearance="primary" icon={<FolderOpenRegular />} onClick={() => void handleSelectFolder()}>MP3 폴더 검색</Button>
                </Card>
              ) : (
                <div className="table-scroll">
                  <Table aria-label="미확인 파일 목록" size="small">
                    <TableHeader><TableRow><TableHeaderCell>파일명</TableHeaderCell><TableHeaderCell>제목</TableHeaderCell><TableHeaderCell>미확인 사유</TableHeaderCell><TableHeaderCell>폴더</TableHeaderCell></TableRow></TableHeader>
                    <TableBody>{unverified.map((item) => (
                      <TableRow key={`${item.folderPath}-${item.filePath}`}>
                        <TableCell><Text className="file-name">{item.fileName}</Text></TableCell>
                        <TableCell>{item.title ?? '제목 없음'}</TableCell>
                        <TableCell><Badge appearance="tint" color="warning">{item.reason}</Badge></TableCell>
                        <TableCell><Text className="muted" title={item.folderPath}>{item.folderPath}</Text></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
              )}
            </section>
          )}

          {view === 'history' && (
            <section className="content-section page-enter">
              <div className="section-heading"><HistoryRegular /><Text weight="semibold">최근 변경 작업</Text><span className="heading-count">{history.length}</span></div>
              {history.length === 0 ? (
                <Card className="empty-panel compact-empty">
                  <div className="empty-icon"><HistoryRegular /></div>
                  <Text size={500} weight="semibold">아직 변경 이력이 없습니다</Text>
                  <Text className="empty-copy">파일명을 변경하면 원래 경로와 결과가 이곳에 기록됩니다.</Text>
                  <Button appearance="primary" onClick={() => setView('rename')}>이름 변경으로 이동</Button>
                </Card>
              ) : (
                <div className="table-scroll">
                  <Table aria-label="파일명 변경 이력" size="small">
                    <TableHeader><TableRow><TableHeaderCell>처리 시각</TableHeaderCell><TableHeaderCell>변경 전</TableHeaderCell><TableHeaderCell>변경 후</TableHeaderCell><TableHeaderCell>상태</TableHeaderCell><TableHeaderCell>복원</TableHeaderCell></TableRow></TableHeader>
                    <TableBody>{history.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{new Date(entry.timestamp).toLocaleString('ko-KR')}</TableCell>
                        <TableCell><Text className="file-name">{entry.originalName}</Text><Text className="file-reference">{entry.folderPath}</Text></TableCell>
                        <TableCell><Text className="target-name">{entry.proposedName}</Text>{entry.error && <Text className="error-detail">{entry.error}</Text>}</TableCell>
                        <TableCell><Badge appearance="tint" color={entry.status === 'failed' ? 'danger' : entry.status === 'restored' ? 'informative' : 'success'}>{entry.status === 'restored' ? '복원됨' : operationLabel(entry.status)}</Badge></TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            appearance="secondary"
                            icon={<ArrowClockwiseRegular />}
                            disabled={entry.status !== 'success' || loading}
                            onClick={() => void restore(entry)}
                          >복원</Button>
                        </TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
              )}
            </section>
          )}

          <footer className="privacy-footer">
            <span><span className="privacy-dot" />파일과 이력은 이 PC에만 저장됩니다</span>
            <span>MP3 전용 · 제목 태그만 파일명에 사용</span>
          </footer>
        </main>
      </div>
    </FluentProvider>
  );
}

export function App() {
  return <AppContent />;
}