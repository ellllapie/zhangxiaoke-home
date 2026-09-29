"""外观：主题预设、上传的图片。

主题存在 data/themes.json（会跟着 data/ 一起备份）。内置主题写在这里，不能改，只能复制一份再改。
上传的图片存在 data/uploads/，要登录才能看。
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import uuid
from pathlib import Path

DEEP_SEA = {
    "id": "builtin-deepsea", "name": "深海", "builtin": True,
    "colors": {
        "bg": "#0b1a2b", "bg2": "#0f2236", "panel": "#132a42", "line": "#1f3b57",
        "text": "#e6eef5", "muted": "#8aa3ba", "me": "#1c3d5c", "meText": "#e6eef5",
        "aiText": "#e6eef5", "accent": "#7fb8d6", "glow": "#bfe3f2", "pink": "#e9a3b4",
        "btnText": "#06121e", "bar": "#0b1a2bd9", "code": "#07131f",
    },
    "background": {"type": "gradient", "gradient": "radial-gradient(120% 80% at 50% -10%, #16324d 0%, #0b1a2b 55%)",
                   "image": "", "dim": 0.35, "blur": 0},
    "font": {"family": "system", "size": 16},
    "radius": 16,
    "avatars": {"show": False, "ai": "", "me": ""},
    "css": "",
}

MOONSTONE = {
    "id": "builtin-moonstone", "name": "月光石", "builtin": True,
    "colors": {
        "bg": "#eef1f7", "bg2": "#f7f8fc", "panel": "#e3e8f3", "line": "#d3d9e8",
        "text": "#2a3142", "muted": "#7b8499", "me": "#dfe5f5", "meText": "#26304a",
        "aiText": "#2a3142", "accent": "#7d8fd0", "glow": "#5f73c4", "pink": "#c98bb0",
        "btnText": "#ffffff", "bar": "#f3f5fbd9", "code": "#e8ecf6",
    },
    "background": {"type": "gradient",
                   "gradient": "linear-gradient(160deg, #f4f6fb 0%, #e9edf7 45%, #e4e9fb 60%, #efeaf6 100%)",
                   "image": "", "dim": 0.15, "blur": 0},
    "font": {"family": "system", "size": 16},
    "radius": 18,
    "avatars": {"show": False, "ai": "", "me": ""},
    "css": "/* 月光石：偏一点角度才看得见的蓝光 */\n.bubble { box-shadow: 0 1px 0 #ffffff inset; }",
}

HONEY_JAR = {
    "id": "builtin-honeyjar", "name": "蜂蜜罐", "builtin": True,
    "colors": {
        "bg": "#231510", "bg2": "#2e1c15", "panel": "#3a241a", "line": "#4d3124",
        "text": "#f8ebdd", "muted": "#c4a48a", "me": "#5a3424", "meText": "#fbeee0",
        "aiText": "#f8ebdd", "accent": "#f0b35a", "glow": "#ffd98a", "pink": "#f3a6b8",
        "btnText": "#2a1508", "bar": "#231510e0", "code": "#1a0f0b",
    },
    "background": {"type": "gradient",
                   "gradient": "radial-gradient(1.5px 1.5px at 12% 20%, #ffe6a8 50%, transparent 51%), "
                               "radial-gradient(1px 1px at 78% 35%, #ffd0dc 50%, transparent 51%), "
                               "radial-gradient(1.5px 1.5px at 40% 70%, #fff1c9 50%, transparent 51%), "
                               "radial-gradient(1px 1px at 88% 82%, #ffe6a8 50%, transparent 51%), "
                               "radial-gradient(1px 1px at 25% 90%, #ffd0dc 50%, transparent 51%), "
                               "radial-gradient(110% 70% at 50% 0%, #5a3318 0%, #231510 60%)",
                   "image": "", "dim": 0.3, "blur": 0},
    "font": {"family": "rounded", "size": 16},
    "radius": 20,
    "avatars": {"show": False, "ai": "", "me": ""},
    "css": "/* 蜂蜜罐：柑橘花蜜、薰衣草、粉色蜡烛、洒了一桌的亮片 */\n#send { box-shadow: 0 0 14px #f0b35a66; }",
}

BUILTINS = [DEEP_SEA, MOONSTONE, HONEY_JAR]
ALLOWED_UPLOAD = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
MAX_UPLOAD_B64 = 12_000_000


class Themes:
    def __init__(self, data: Path):
        self.file = data / "themes.json"
        self.uploads = data / "uploads"
        self.uploads.mkdir(parents=True, exist_ok=True)

    def _load(self) -> dict:
        try:
            return json.loads(self.file.read_text(encoding="utf-8"))
        except Exception:
            return {"active": DEEP_SEA["id"], "themes": []}

    def _save(self, d: dict) -> None:
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.file)

    def all(self) -> dict:
        d = self._load()
        themes = BUILTINS + d.get("themes", [])
        ids = {t["id"] for t in themes}
        active = d.get("active") if d.get("active") in ids else DEEP_SEA["id"]
        return {"active": active, "themes": themes}

    def save(self, theme: dict) -> dict:
        d = self._load()
        theme = dict(theme)
        theme.pop("builtin", None)
        if not theme.get("id") or theme["id"].startswith("builtin-"):
            theme["id"] = "t-" + uuid.uuid4().hex[:10]
        theme["name"] = str(theme.get("name") or "新主题")[:30]
        theme["css"] = str(theme.get("css") or "")[:50_000]
        lst = [t for t in d.get("themes", []) if t["id"] != theme["id"]]
        lst.append(theme)
        d["themes"] = lst
        self._save(d)
        return theme

    def delete(self, tid: str) -> None:
        d = self._load()
        d["themes"] = [t for t in d.get("themes", []) if t["id"] != tid]
        if d.get("active") == tid:
            d["active"] = DEEP_SEA["id"]
        self._save(d)

    def set_active(self, tid: str) -> None:
        d = self._load()
        d["active"] = tid
        self._save(d)

    def upload(self, media_type: str, data_b64: str) -> str:
        ext = ALLOWED_UPLOAD.get(media_type)
        if not ext:
            raise ValueError("只收 jpg / png / webp / gif")
        if len(data_b64) > MAX_UPLOAD_B64:
            raise ValueError("图太大了")
        raw = base64.b64decode(data_b64)
        name = hashlib.sha256(raw).hexdigest()[:20] + "." + ext
        (self.uploads / name).write_bytes(raw)
        return f"/api/files/{name}"

    def file_path(self, name: str) -> Path | None:
        if not re.fullmatch(r"[0-9a-f]{20}\.(jpg|png|webp|gif)", name):
            return None
        p = self.uploads / name
        return p if p.exists() else None
