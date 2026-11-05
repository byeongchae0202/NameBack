# Project Plan

**Status**: Planning
**Created**: 2026-11-06
**Mode**: AUGMENT

---

## 1. Project Overview

**Goal**: Complete NameBack as both a distributable Windows Electron EXE and a separately hosted browser app. Ship the EXE first for direct folder selection and safe local renames; add the web app afterward for MP3 upload, metadata analysis, preview, and recovered-file download. Both clients use one Python MP3 domain core so title interpretation, sanitization, and collision allocation cannot drift. The project is designed so that every module is independently testable.

**App Type**: SPA + API (shared React client, FastAPI web API, and Electron desktop host)

**API Login**: No

**Mode**: AUGMENT

**Deployment Plan**: No deployment plan found

MP3-only scope remains: generated names use a sanitized embedded title plus the original extension; artist and album are reference metadata only. Missing, invalid, empty, reserved, or unusable titles remain unverified and are never guessed online. Neither client overwrites files or changes audio bytes. The EXE keeps SQLite history under Electron `app.getPath('userData')`; the web app does not persist uploads or require login. The web deployment serves the built React app and FastAPI API from one Azure App Service URL. The desktop client remains usable offline after installation.

---

## 2. React Client — Electron + Web Frontend

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Framework** | React + Vite |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test |

The React + TypeScript UI is shared where workflows overlap, with separate host adapters: Electron exposes a narrow typed preload API for native folder selection, local execution, and SQLite history; the browser client calls the web API and downloads a ZIP. Keep Electron `contextIsolation` enabled and renderer Node integration disabled. The EXE selects a folder, filters MP3s, previews source/title/proposed name/collisions, and requires confirmation before mutation. The web app accepts MP3 uploads, shows the same analysis and filename proposals, and offers eligible results as a downloadable ZIP; browsers never receive arbitrary local-folder access.

## 3. Python Domain Core — Local Worker + Web API

| Component | Technology |
|-----------|-----------|
| **Language** | Python |
| **Runtime** | CPython |
| **Package Manager** | pip |
| **Test Runner** | pytest |
| **Mocking Library** | unittest.mock |
| **Test Command** | pytest |
| **Orchestration** | docker-compose |

Create one importable `nameback_core` Python package as the source of truth for Mutagen tag extraction, title validation/sanitization, deterministic collision allocation, and serializable per-file analysis results. The packaged Electron sidecar and FastAPI web API are two adapters over that package, not independent implementations. Electron main remains responsible for selected-folder containment checks, execution-time file validation, no-overwrite local mutation, and SQLite history/restore. FastAPI accepts bounded multipart MP3 uploads, uses the same core to produce previews and archive entries, returns a ZIP, and discards request files after each operation. Package the sidecar with the EXE so end users need no Python installation; no container runtime or durable web datastore is needed.

## 4. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| Azure App Service (Linux) | Serve the built React web client and FastAPI upload/analyze/download API under one URL. Keep uploads request-scoped, cap aggregate batch size, and return a ZIP without durable file storage. The EXE remains a separate offline distribution. | `NAMEBACK_MAX_BATCH_BYTES` | `52428800` (50 MiB) | Essential |

Desktop-only persistence remains local SQLite (`better-sqlite3`) under Electron `app.getPath('userData')`, recording batch ID, timestamp, before/after paths, status, and per-file errors. The web version does not reuse this local history or persist user uploads.

## 5. Prerequisites

Check every `❓` tool before running the project. Python and pip are needed to develop the shared core and web API; the EXE bundles its worker. Edge is used to debug the browser client.

### Run

| Tool | Service(s) | Installed | Version |
|------|------------|-----------|---------|
| Node.js | frontend | ✅ | v24.18.0 |
| npm | frontend | ✅ | 11.16.0 |
| Python | shared-core, web-api | ❓ | Not confirmed |
| pip | shared-core, web-api | ❓ | Not confirmed |

### Debug

| Tool | Service(s) | Installed | Version |
|------|------------|-----------|---------|
| Microsoft Edge | web frontend | ✅ | 156.0.4314.58 |

No container emulator or Azure Functions extension is required. Debug the Electron shell with its VS Code launch configuration and the web client in Edge; inspect worker/API logs at their respective process boundaries.

## 6. Design System & UI

**Component Library**: Fluent UI v9
**Style Direction**: A compact Windows utility with a charcoal-green navigation rail, crisp neutral work surface, and restrained copper accents for actions and collision states. Dense file tables stay easy to scan, while rename and restore operations remain distinct and explicitly confirmed.
**Typography**: Segoe UI Variable, Segoe UI, sans-serif

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#176B59` | Folder selection, active navigation, and safe rename actions |
| `accent` | `#C56A3A` | Collision suffixes and attention-worthy review states |
| `surface` | `#F3F6F4` | Main file-review workspace |
| `text` | `#202A26` | Filenames, metadata, and operation details |
| `muted` | `#66736D` | Paths, timestamps, and secondary tag values |
| `border` | `#D7E0DB` | Table separators, fields, and panel boundaries |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Rename Review (EXE) | `/` | Choose one local folder, filter MP3s, inspect proposed names and collisions, then confirm selected renames. | `header, sidebar, main, table, action-bar` |
| Unverified Files (EXE) | `/unverified` | Review files with missing, unreadable, or unusable title tags; leave them unchanged. | `header, sidebar, main, tabs, table, empty` |
| History & Restore (EXE) | `/history` | Review local per-file outcomes and restore only when both recorded paths remain safe. | `header, sidebar, main, table, actions, error` |
| Web Upload & Results | `/` | Upload MP3 files, preview proposals from the shared core, and download eligible results as a ZIP. | `header, main, form, table, action-bar` |

### Sample Content

Rename Review — recovered MP3:
| Current file | Embedded title | Proposed name | Result |
|---|---|---|---|
| Recovery MP3 file 001.mp3 | 서른 즈음에 · 김광석 | 서른 즈음에.mp3 | 변경 가능 |
| Recovered Track 014.mp3 | 비와 당신 · 박중훈 | 비와 당신.mp3 | 변경 가능 |
| audio_093.mp3 | 서른 즈음에 · 김광석 | 서른 즈음에 (2).mp3 | 충돌 번호 부여 |

Unverified Files — unchanged MP3:
| Current file | Title tag | Reason | Action |
|---|---|---|---|
| track_003.mp3 | 비어 있음 | 제목 태그 없음 | 변경 안 함 |
| damaged_take_08.mp3 | 읽을 수 없음 | 태그 판독 실패 | 변경 안 함 |
| unknown_021.mp3 | `...` | 파일명으로 쓸 수 없는 제목 | 변경 안 함 |
The `읽기 가능` tab can show an empty state when all title tags in the selected folder are readable; the loading skeleton represents an in-progress tag scan.

History & Restore — rename operation:
| Original name | Current name | Completed | Outcome |
|---|---|---|---|
| Recovery MP3 file 001.mp3 | 서른 즈음에.mp3 | 2026-11-05 10:14 | 변경 완료 · 복원 가능 |
| Recovered Track 014.mp3 | 비와 당신.mp3 | 2026-11-05 10:16 | 변경 완료 · 복원 가능 |
| audio_093.mp3 | 서른 즈음에 (2).mp3 | 2026-11-05 10:18 | 변경 완료 · 충돌 회피 |
An inline error state explains when restoration is skipped because the original destination is occupied; it never replaces that file.

Web Upload & Results — uploaded MP3:
| Uploaded file | Embedded title · artist | Download name | Result |
|---|---|---|---|
| Recovered Track 014.mp3 | 비와 당신 · 박중훈 | 비와 당신.mp3 | ZIP에 포함 |
| audio_093.mp3 | 서른 즈음에 · 김광석 | 서른 즈음에 (2).mp3 | ZIP에 포함 · 충돌 회피 |
| track_003.mp3 | 제목 없음 | 변경 안 함 | 미확인 · ZIP 제외 |

## 7. Project Structure

```text
NameBack/
├── .azure/
│   └── project-plan.md
├── electron/
│   ├── main.ts                  # Local filesystem boundary, IPC, SQLite
│   └── preload.ts               # Narrow typed desktop bridge
├── src/
│   ├── app/                     # Shared React screens and Fluent UI components
│   ├── adapters/
│   │   ├── desktop.ts           # Calls the Electron preload API
│   │   └── web.ts               # Calls FastAPI with fetch/FormData
│   └── shared/
│       └── contracts.ts         # UI and transport contracts
├── python/
│   ├── nameback_core/
│   │   ├── metadata.py          # Mutagen parsing and normalized analysis
│   │   ├── filenames.py         # Canonical sanitization and collision allocation
│   │   └── models.py            # Per-file result contracts
│   ├── metadata_reader.py       # JSON-lines worker adapter for Electron
│   ├── web_api.py               # FastAPI analyze/download and static UI hosting
│   └── requirements.txt
├── tests/
│   ├── safety.test.ts           # Electron filesystem and IPC safety
│   └── python/                  # Shared core and web API tests
├── resources/
│   └── sidecar/                 # Bundled Windows worker executable
├── package.json
└── vite.config.ts
```

Keep the Python package as the only implementation of tag analysis and filename proposal rules. Leave path containment, exclusive local rename/restore, and SQLite in Electron main; keep the browser's uploaded files request-scoped and return a ZIP. SQLite and the packaged sidecar remain outside the web runtime.

## 8. Route Definitions

Desktop routes and IPC remain local-only; the browser routes use the HTTP API. The web client has no permission to browse arbitrary local folders, and its temporary upload files are removed after the request.

| # | Method | Path | Description | Request Body | Response Body | Status Codes |
|---|--------|------|-------------|-------------|--------------|-------------|
| 1 | Electron VIEW | `/` | Select a local folder and review candidate MP3 renames. | — | Rename Review screen | — |
| 2 | Electron VIEW | `/unverified` | Inspect files whose title cannot safely become a filename. | — | Unverified Files screen | — |
| 3 | Electron VIEW | `/history` | Inspect local outcomes and guarded restore options. | — | History & Restore screen | — |
| 4 | Web VIEW | `/` | Select MP3 uploads, review shared-core analysis, and download results. | — | Web Upload & Results screen | — |
| 5 | IPC | `folder:select`, `folder:scan` | Select and scan one local folder through Electron main. | `{}` | `{ folderPath, files[] }` | selected, canceled, error |
| 6 | IPC | `rename:preview`, `rename:execute` | Request shared-core proposals, then safely rename selected files locally. | `{ selectedPaths[] }` | `{ previews[] }` / `{ outcomes[] }` | success, partial, error |
| 7 | IPC | `history:list`, `unverified:list`, `history:restore` | Read local SQLite state and restore only when safe. | `{ id? }` | `{ entries[] }` / `{ outcome }` | success, conflict, not-found, error |
| 8 | POST | `/api/analyze` | Analyze bounded multipart uploads with `nameback_core` and return preview records. | `multipart/form-data: files[]` | `{ files: AnalysisResult[] }` | 200, 413, 422 |
| 9 | POST | `/api/download` | Re-run the same deterministic core for submitted uploads and stream eligible files as a ZIP. | `multipart/form-data: files[]` | `application/zip` | 200, 413, 422, 500 |
| 10 | GET | `/api/health` | App Service health probe. | — | `{ status: "ok" }` | 200, 503 |

## 9. Next Steps

1. Establish `nameback_core` as the single source for Mutagen analysis, title validation, sanitization, and deterministic collision allocation; adapt the Electron sidecar to call it and keep filesystem safety in Electron main.
2. Package and verify the Windows EXE on a clean machine without a Python installation; test folder containment, no-overwrite collisions, unchanged file hashes, history, and guarded restore.
3. Add the browser host adapter and FastAPI analyze/download endpoints over the same core; test upload limits, partial failures, ZIP names/content, and request-temp cleanup.
4. Build the React bundle once for the browser host and deploy the SPA + API to one Azure App Service URL. Confirm no upload persistence and configure the public URL and upload limit.
5. Run **azure-debug-plan** → **azure-debug-generate** for Electron, Python worker, FastAPI, and browser debugging; run **azure-deploy** when ready to provision and publish the web version.