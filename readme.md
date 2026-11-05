# NameBack

복구된 MP3의 내부 곡 제목 태그를 읽어 파일명을 안전하게 바꾸는 Windows 데스크톱 앱입니다. 파일 내용은 수정하지 않으며, 변경 전 미리보기와 변경 이력 기반 복원을 제공합니다.

## 개발 실행

```powershell
npm install
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r python/requirements.txt
npm run dev
```

앱은 선택한 폴더 바로 아래의 MP3만 검색합니다. 제목 태그가 없거나 안전한 파일명으로 만들 수 없는 파일은 변경하지 않고 미확인 목록에 표시합니다. 같은 파일명이 있으면 번호를 붙여 덮어쓰기를 방지합니다.

## 검증 및 Windows 패키징

```powershell
npm test
npm run build
.\.venv\Scripts\Activate.ps1
npm run package:win
```

처리와 이력 저장은 로컬에서 수행하며 온라인 음악 정보 검색이나 AI 기능을 사용하지 않습니다.
