import path from 'node:path';

export function isDirectChild(folderPath: string, filePath: string): boolean {
  return path.dirname(path.resolve(filePath)).toLocaleLowerCase('en-US') ===
    path.resolve(folderPath).toLocaleLowerCase('en-US');
}