import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { parseFile } from 'music-metadata';
import type {
  AudioFile,
  FolderScan,
  HistoryEntry,
  OperationResult,
  RenamePreview,
  UnverifiedEntry,
} from '../src/shared/contracts';
import { allocateFilename, extensionOf, sanitizeTitle } from '../src/shared/filename';
import { normalizeMetadata } from '../src/shared/metadata';
import { isDirectChild } from './pathSafety';

interface MetadataRecord {
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  error: string | null;
}

let mainWindow: BrowserWindow | null = null;
let database: Database.Database;
let selectedFolder: string | null = null;

function normalized(filePath: string): string {
  return path.resolve(filePath).toLocaleLowerCase('en-US');
}

function requireSelectedFolder(): string {
  if (!selectedFolder) throw new Error('먼저 작업할 폴더를 선택해 주세요.');
  return selectedFolder;
}

function assertDirectChild(folderPath: string, filePath: string): void {
  if (!isDirectChild(folderPath, filePath)) {
    throw new Error('선택한 폴더 바로 아래의 파일만 처리할 수 있습니다.');
  }
}

function createDatabase(): void {
  const databasePath = path.join(app.getPath('userData'), 'nameback.sqlite');
  database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      original_path TEXT NOT NULL,
      resulting_path TEXT,
      original_name TEXT NOT NULL,
      proposed_name TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      restored_at TEXT
    );
    CREATE TABLE IF NOT EXISTS unverified_files (
      folder_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      title TEXT,
      reason TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (folder_path, file_path)
    );
  `);
}

async function readMetadata(filePath: string): Promise<MetadataRecord> {
  try {
    const metadata = await parseFile(filePath, { skipCovers: true, duration: false });
    return { path: filePath, ...normalizeMetadata(metadata.common), error: null };
  } catch {
    return {
      path: filePath,
      title: null,
      artist: null,
      album: null,
      error: 'MP3 메타데이터를 읽을 수 없습니다.',
    };
  }
}

async function scanFolder(folderPath: string): Promise<FolderScan> {
  const realFolder = await fs.promises.realpath(folderPath);
  const folderInfo = await fs.promises.stat(realFolder);
  if (!folderInfo.isDirectory()) throw new Error('선택한 경로가 폴더가 아닙니다.');
  selectedFolder = realFolder;

  const entries = await fs.promises.readdir(realFolder, { withFileTypes: true });
  const filePaths = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLocaleLowerCase('en-US') === '.mp3')
    .map((entry) => path.join(realFolder, entry.name))
    .sort((left, right) => left.localeCompare(right, 'ko'));
  const metadata: MetadataRecord[] = [];
  for (const filePath of filePaths) metadata.push(await readMetadata(filePath));
  const metadataByPath = new Map(metadata.map((record) => [normalized(record.path), record]));
  const files: AudioFile[] = filePaths.map((filePath) => {
    const record = metadataByPath.get(normalized(filePath));
    const safeTitle = sanitizeTitle(record?.title);
    const reason = record?.error ?? safeTitle.reason;
    return {
      path: filePath,
      name: path.basename(filePath),
      title: record?.title ?? null,
      artist: record?.artist ?? null,
      album: record?.album ?? null,
      status: safeTitle.value ? 'eligible' : 'unverified',
      reason,
    };
  });

  const updateUnverified = database.transaction(() => {
    database.prepare('DELETE FROM unverified_files WHERE folder_path = ?').run(realFolder);
    const insert = database.prepare(`
      INSERT INTO unverified_files (folder_path, file_path, file_name, title, reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const timestamp = new Date().toISOString();
    for (const file of files.filter((item) => item.status === 'unverified')) {
      insert.run(realFolder, file.path, file.name, file.title, file.reason ?? '확인할 수 없는 제목입니다.', timestamp);
    }
  });
  updateUnverified();
  return { folderPath: realFolder, files };
}

async function selectFolder(): Promise<FolderScan | null> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'MP3 폴더 선택',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return scanFolder(result.filePaths[0]);
}

function makePreview(files: AudioFile[], selectedPaths: string[]): RenamePreview[] {
  const selected = new Set(selectedPaths.map(normalized));
  const reserved = new Set(files.map((file) => file.name.toLocaleLowerCase('en-US')));

  return files.map((file) => {
    if (file.status === 'unverified') {
      return { ...file, sourcePath: file.path, currentName: file.name, proposedName: null, status: 'unverified', selected: false };
    }
    const safeTitle = sanitizeTitle(file.title);
    if (!safeTitle.value) {
      return {
        ...file, sourcePath: file.path, currentName: file.name, proposedName: null, status: 'unverified', selected: false,
        reason: safeTitle.reason,
      };
    }

    const extension = extensionOf(file.path);
    if (`${safeTitle.value}${extension}`.toLocaleLowerCase('en-US') === file.name.toLocaleLowerCase('en-US')) {
      return { ...file, sourcePath: file.path, currentName: file.name, proposedName: file.name, status: 'unchanged', selected: false };
    }
    const allocation = allocateFilename(safeTitle.value, extension, reserved);
    reserved.add(allocation.name.toLocaleLowerCase('en-US'));
    return {
      ...file,
      sourcePath: file.path,
      currentName: file.name,
      proposedName: allocation.name,
      status: allocation.collided ? 'collision' : 'ready',
      selected: selected.has(normalized(file.path)),
    };
  });
}

function exclusiveRename(sourcePath: string, targetPath: string): void {
  fs.linkSync(sourcePath, targetPath);
  try {
    fs.unlinkSync(sourcePath);
  } catch (error) {
    try { fs.unlinkSync(targetPath); } catch { /* Preserve the original failure. */ }
    throw error;
  }
}

async function executeRename(selectedPaths: string[]): Promise<OperationResult[]> {
  const folderPath = requireSelectedFolder();
  const scan = await scanFolder(folderPath);
  const selected = new Set(selectedPaths.map(normalized));
  const previews = makePreview(scan.files, selectedPaths).filter(
    (item) => selected.has(normalized(item.sourcePath)) && item.proposedName && item.status !== 'unchanged' && item.status !== 'unverified',
  );
  const batchId = randomUUID();
  const results: OperationResult[] = [];

  for (const item of previews) {
    const originalPath = item.sourcePath;
    const targetPath = path.join(folderPath, item.proposedName!);
    try {
      assertDirectChild(folderPath, originalPath);
      assertDirectChild(folderPath, targetPath);
      const sourceStat = await fs.promises.lstat(originalPath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('원본 파일이 더 이상 안전한 일반 파일이 아닙니다.');
      if (fs.existsSync(targetPath)) throw new Error('미리보기 이후 대상 이름이 이미 사용 중입니다.');
      exclusiveRename(originalPath, targetPath);
      const timestamp = new Date().toISOString();
      const inserted = database.prepare(`
        INSERT INTO operations (batch_id, timestamp, folder_path, original_path, resulting_path, original_name, proposed_name, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'success')
      `).run(batchId, timestamp, folderPath, originalPath, targetPath, path.basename(originalPath), path.basename(targetPath));
      results.push({ id: Number(inserted.lastInsertRowid), originalPath, resultingPath: targetPath, status: 'success', error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      let id: number | null = null;
      try {
        const inserted = database.prepare(`
          INSERT INTO operations (batch_id, timestamp, folder_path, original_path, original_name, proposed_name, status, error)
          VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)
        `).run(batchId, new Date().toISOString(), folderPath, originalPath, path.basename(originalPath), path.basename(targetPath), message);
        id = Number(inserted.lastInsertRowid);
      } catch {}
      results.push({ id, originalPath, resultingPath: null, status: 'failed', error: message });
    }
  }
  return results;
}

function listHistory(): HistoryEntry[] {
  return database.prepare(`
    SELECT id, batch_id AS batchId, timestamp, folder_path AS folderPath,
      original_path AS originalPath, resulting_path AS resultingPath,
      original_name AS originalName, proposed_name AS proposedName,
      status, error, restored_at AS restoredAt
    FROM operations ORDER BY id DESC LIMIT 500
  `).all() as HistoryEntry[];
}

function listUnverified(): UnverifiedEntry[] {
  return database.prepare(`
    SELECT folder_path AS folderPath, file_path AS filePath, file_name AS fileName,
      title, reason, updated_at AS updatedAt
    FROM unverified_files ORDER BY updated_at DESC, file_name COLLATE NOCASE
  `).all() as UnverifiedEntry[];
}

async function restoreHistory(id: number): Promise<OperationResult> {
  const entry = database.prepare(`
    SELECT id, folder_path AS folderPath, original_path AS originalPath,
      resulting_path AS resultingPath, status
    FROM operations WHERE id = ?
  `).get(id) as Pick<HistoryEntry, 'id' | 'folderPath' | 'originalPath' | 'resultingPath' | 'status'> | undefined;
  if (!entry || entry.status !== 'success' || !entry.resultingPath) {
    return { id, originalPath: '', resultingPath: null, status: 'failed', error: '복원할 수 있는 변경 이력이 아닙니다.' };
  }
  const folderPath = requireSelectedFolder();
  if (normalized(folderPath) !== normalized(entry.folderPath)) {
    return { id, originalPath: entry.resultingPath, resultingPath: null, status: 'failed', error: '이 변경의 원본 폴더를 선택한 뒤 복원해 주세요.' };
  }
  try {
    assertDirectChild(folderPath, entry.originalPath);
    assertDirectChild(folderPath, entry.resultingPath);
    const currentStat = await fs.promises.lstat(entry.resultingPath);
    if (!currentStat.isFile() || currentStat.isSymbolicLink()) throw new Error('현재 파일이 더 이상 안전한 일반 파일이 아닙니다.');
    if (fs.existsSync(entry.originalPath)) throw new Error('원래 파일명이 이미 사용 중이므로 복원하지 않았습니다.');
    exclusiveRename(entry.resultingPath, entry.originalPath);
    database.prepare("UPDATE operations SET status = 'restored', restored_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return { id, originalPath: entry.resultingPath, resultingPath: entry.originalPath, status: 'restored', error: null };
  } catch (error) {
    return {
      id,
      originalPath: entry.resultingPath,
      resultingPath: null,
      status: 'failed',
      error: error instanceof Error ? error.message : '복원 중 오류가 발생했습니다.',
    };
  }
}

function registerIpc(): void {
  ipcMain.handle('folder:select', selectFolder);
  ipcMain.handle('folder:scan', async () => scanFolder(requireSelectedFolder()));
  ipcMain.handle('rename:preview', async (_event, selectedPaths: unknown) => {
    if (!Array.isArray(selectedPaths) || selectedPaths.some((item) => typeof item !== 'string')) {
      throw new Error('파일 선택 정보가 올바르지 않습니다.');
    }
    const folderPath = requireSelectedFolder();
    const scan = await scanFolder(folderPath);
    return makePreview(scan.files, selectedPaths as string[]);
  });
  ipcMain.handle('rename:execute', async (_event, selectedPaths: unknown) => {
    if (!Array.isArray(selectedPaths) || selectedPaths.some((item) => typeof item !== 'string')) {
      throw new Error('파일 선택 정보가 올바르지 않습니다.');
    }
    return executeRename(selectedPaths as string[]);
  });
  ipcMain.handle('history:list', listHistory);
  ipcMain.handle('unverified:list', listUnverified);
  ipcMain.handle('history:restore', async (_event, id: unknown) => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new Error('이력 식별자가 올바르지 않습니다.');
    return restoreHistory(id);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#f5f6f7',
    title: 'NameBack',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devServerUrl = process.env.NAMEBACK_DEV_SERVER_URL;
  if (devServerUrl) void mainWindow.loadURL(devServerUrl);
  else void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

void app.whenReady().then(() => {
  createDatabase();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (database?.open) database.close();
});