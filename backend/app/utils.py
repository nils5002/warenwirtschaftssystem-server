from __future__ import annotations

import importlib.util
import os
import shutil
from pathlib import Path
from typing import Dict, List, Tuple


def _find_tesseract_executable() -> str:
    env_cmd = os.environ.get("TESSERACT_CMD") or os.environ.get("TESSERACT_PATH")
    candidates: List[str] = []
    if env_cmd:
        candidates.append(env_cmd)
    exe_in_path = shutil.which("tesseract")
    if exe_in_path:
        candidates.append(exe_in_path)
    program_files = os.environ.get("ProgramFiles") or r"C:\\Program Files"
    program_files_x86 = os.environ.get("ProgramFiles(x86)") or r"C:\\Program Files (x86)"
    default_candidates = [
        Path(program_files) / "Tesseract-OCR" / "tesseract.exe",
        Path(program_files_x86) / "Tesseract-OCR" / "tesseract.exe",
        Path(program_files_x86) / "TesseractXplore" / "tesseract" / "tesseract.exe",
        Path(program_files_x86) / "TesseractXplore" / "Tesseract-OCR" / "tesseract.exe",
        Path(program_files_x86) / "TesseractXplore" / "tesseract.exe",
    ]
    candidates.extend(str(p) for p in default_candidates)
    seen: set[str] = set()
    for cand in candidates:
        if not cand:
            continue
        try:
            path = str(Path(cand))
        except OSError:
            continue
        if path in seen:
            continue
        seen.add(path)
        try:
            if Path(path).is_file():
                return path
        except OSError:
            continue
    return ""


def detect_ocr_engines() -> Tuple[List[str], Dict[str, bool]]:
    engines: List[str] = []
    details: Dict[str, bool] = {
        "pytesseract_available": False,
        "tesseract_ready": False,
        "easyocr_available": False,
    }
    try:
        pytesseract_available = importlib.util.find_spec("pytesseract") is not None
        pillow_available = importlib.util.find_spec("PIL") is not None
    except Exception:
        pytesseract_available = False
        pillow_available = False
    if pytesseract_available and pillow_available:
        tess = _find_tesseract_executable()
        details["pytesseract_available"] = True
        details["tesseract_ready"] = bool(tess)
        if tess:
            engines.append("tesseract")
    try:
        if importlib.util.find_spec("easyocr") is not None:
            engines.append("easyocr")
            details["easyocr_available"] = True
    except Exception:
        pass
    if not engines:
        engines.append("none")
    return engines, details


def default_file_types() -> List[str]:
    return sorted(
        {
            ".pdf",
            ".docx",
            ".doc",
            ".txt",
            ".rtf",
            ".md",
            ".png",
            ".jpg",
            ".jpeg",
            ".heic",
            ".mov",
            ".mp4",
        }
    )
