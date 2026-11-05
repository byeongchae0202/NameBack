import json
import sys

from mutagen.mp3 import MP3


def read_file(file_path):
    try:
        audio = MP3(file_path)
        tags = audio.tags or {}
        return {
            "path": file_path,
            "title": first_text(tags.get("TIT2")),
            "artist": first_text(tags.get("TPE1")),
            "album": first_text(tags.get("TALB")),
            "error": None,
        }
    except Exception as error:
        return {
            "path": file_path,
            "title": None,
            "artist": None,
            "album": None,
            "error": str(error) or "MP3 메타데이터를 읽을 수 없습니다.",
        }


def first_text(value):
    if value is None:
        return None
    if isinstance(value, list):
        value = value[0] if value else None
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            result = [read_file(file_path) for file_path in request.get("files", [])]
            sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as error:
            sys.stdout.write(json.dumps({"error": str(error)}, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()