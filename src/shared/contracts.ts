export type FileStatus = 'eligible' | 'unverified';

export interface AudioFile {
  path: string;
  name: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  status: FileStatus;
  reason: string | null;
}

export type PreviewStatus = 'ready' | 'collision' | 'unchanged' | 'unverified';

export interface RenamePreview {
  sourcePath: string;
  currentName: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  proposedName: string | null;
  status: PreviewStatus;
  selected: boolean;
  reason: string | null;
}

export type OperationStatus = 'success' | 'failed' | 'restored';

export interface OperationResult {
  id: number | null;
  originalPath: string;
  resultingPath: string | null;
  status: OperationStatus;
  error: string | null;
}

export interface HistoryEntry {
  id: number;
  batchId: string;
  timestamp: string;
  folderPath: string;
  originalPath: string;
  resultingPath: string | null;
  originalName: string;
  proposedName: string;
  status: OperationStatus;
  error: string | null;
  restoredAt: string | null;
}

export interface UnverifiedEntry {
  folderPath: string;
  filePath: string;
  fileName: string;
  title: string | null;
  reason: string;
  updatedAt: string;
}

export interface FolderScan {
  folderPath: string;
  files: AudioFile[];
}

export interface DesktopApi {
  selectFolder(): Promise<FolderScan | null>;
  scanFolder(): Promise<FolderScan>;
  previewRename(selectedPaths: string[]): Promise<RenamePreview[]>;
  executeRename(selectedPaths: string[]): Promise<OperationResult[]>;
  listHistory(): Promise<HistoryEntry[]>;
  listUnverified(): Promise<UnverifiedEntry[]>;
  restoreHistory(id: number): Promise<OperationResult>;
}