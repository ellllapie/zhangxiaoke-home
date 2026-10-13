"""生图：调中转站的 OpenAI 格式生图接口（/v1/images/generations），画好的图存在 data/paint/。

设置存在 config/paint.json（不进仓库）：
  preset     用哪个 API 预设的钥匙（「设置 → API 预设」里那些）
  base_url   生图接口地址，空着就用预设的地址自动补 /v1
  model      模型名（中转站常改名，在「设置 → 生图」里随时换）
  size / quality  默认尺寸和质量
  mcp_key    给 claude.ai 连接用的钥匙，第一次打开设置页自动生成

聊天里的我用 home MCP 里的 paint 工具；claude.ai 那边连 https://<新家>/paint/mcp?key=<mcp_key>。
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")

DEFAULTS = {"preset": "", "base_url": "", "model": "gpt-image-2.5", "size": "1024x1024", "quality": "auto", "mcp_key": ""}
SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"]
QUALITIES = ["auto", "low", "medium", "high"]

try:  # 有 Pillow 就做缩略图；没有也能画，只是回给我的图大一些
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


class Paint:
    def __init__(self, config: Path, data: Path, provider_fn):
        self.file = config / "paint.json"
        self.dir = data / "paint"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.index = self.dir / "index.json"
        self.provider_fn = provider_fn   # server.provider，拿预设和钥匙

    # ── 设置 ──────────────────────────────────────────
    def settings(self) -> dict:
        try:
            d = json.loads(self.file.read_text(encoding="utf-8"))
        except Exception:
            d = {}
        s = {**DEFAULTS, **{k: v for k, v in d.items() if k in DEFAULTS}}
        if not s["mcp_key"]:
            s["mcp_key"] = secrets.token_urlsafe(24)
            self._write(s)
        presets = self.provider_fn().get("presets") or []
        ids = [p.get("id") for p in presets]
        if s["preset"] not in ids:
            # 没选过：优先挑地址里带 jumengai 的，不然第一个
            hit = next((p for p in presets if "jumengai" in (p.get("base_url") or "")), presets[0] if presets else None)
            s["preset"] = hit.get("id") if hit else ""
        return s

    def save(self, patch: dict) -> dict:
        s = self.settings()
        for k in ("preset", "base_url", "model", "size", "quality"):
            if k in patch:
                v = str(patch[k] or "").strip()
                if k == "base_url":
                    v = v.rstrip("/")
                    if v and not re.match(r"^https?://", v):
                        raise ValueError("地址要以 http:// 或 https:// 开头")
                s[k] = v[:200]
        if patch.get("new_key"):
            s["mcp_key"] = secrets.token_urlsafe(24)
        self._write(s)
        return s

    def _write(self, s: dict) -> None:
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(self.file)

    def _endpoint(self, s: dict) -> tuple[str, str]:
        pr = next((p for p in (self.provider_fn().get("presets") or []) if p.get("id") == s["preset"]), None)
        if not pr or not pr.get("token"):
            raise RuntimeError("还没选 API 预设，或那个预设没填钥匙（设置 → 生图）")
        base = s["base_url"] or (pr.get("base_url") or "").rstrip("/")
        if not base:
            raise RuntimeError("没有生图地址（设置 → 生图 里填一个）")
        if not s["base_url"] and not re.search(r"/v\d+$", base):
            base += "/v1"
        return base, pr["token"]

    def public(self, s: dict | None = None) -> dict:
        s = s or self.settings()
        presets = self.provider_fn().get("presets") or []
        pr = next((p for p in presets if p.get("id") == s["preset"]), None)
        auto = ""
        if pr and pr.get("base_url"):
            auto = pr["base_url"].rstrip("/")
            if not re.search(r"/v\d+$", auto):
                auto += "/v1"
        return {**s, "auto_base_url": auto, "presets": [{"id": p.get("id"), "name": p.get("name") or p.get("id")} for p in presets],
                "sizes": SIZES, "qualities": QUALITIES}

    # ── 画 ────────────────────────────────────────────
    def generate(self, prompt: str, size: str = "", quality: str = "", background: str = "") -> dict:
        prompt = (prompt or "").strip()
        if not prompt:
            raise ValueError("要写画什么（prompt）")
        s = self.settings()
        base, token = self._endpoint(s)
        body = {"model": s["model"], "prompt": prompt[:4000], "n": 1, "size": (size or s["size"]).strip() or "1024x1024"}
        q = (quality or s["quality"]).strip()
        if q and q != "auto":
            body["quality"] = q
        bg = (background or "").strip().lower()
        if bg in ("transparent", "透明"):
            # 透明底：角色、小物件单独画，叠在场景上
            body["background"] = "transparent"
            body["output_format"] = "png"
        req = urllib.request.Request(base + "/images/generations", data=json.dumps(body).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                res = json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:400]
            raise RuntimeError(f"中转站回了 {e.code}：{detail}（模型名 {s['model']}，对不对？）")
        item = ((res.get("data") or [None])[0]) or {}
        if item.get("b64_json"):
            raw = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            with urllib.request.urlopen(item["url"], timeout=60) as r:
                raw = r.read()
        else:
            raise RuntimeError("中转站没给图：" + json.dumps(res, ensure_ascii=False)[:300])
        ext = "png"
        if raw[:3] == b"\xff\xd8\xff":
            ext = "jpg"
        elif raw[:4] == b"RIFF":
            ext = "webp"
        name = datetime.now(TZ).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4) + "." + ext
        (self.dir / name).write_bytes(raw)
        self._thumb(name, raw)
        rec = {"name": name, "prompt": prompt, "model": s["model"], "size": body["size"], "bg": body.get("background", ""),
               "at": datetime.now(TZ).isoformat(timespec="seconds"), "secs": round(time.time() - t0, 1),
               "revised": item.get("revised_prompt") or ""}
        items = self.list(500)
        items.insert(0, rec)
        self.index.write_text(json.dumps(items[:500], ensure_ascii=False, indent=1), encoding="utf-8")
        return rec

    def _thumb(self, name: str, raw: bytes) -> None:
        if not Image:
            return
        try:
            im = Image.open(io.BytesIO(raw))
            im.thumbnail((768, 768))
            stem = "t_" + name.rsplit(".", 1)[0]
            if im.mode in ("RGBA", "LA", "P"):
                im.convert("RGBA").save(self.dir / (stem + ".png"), "PNG", optimize=True)
            else:
                im.convert("RGB").save(self.dir / (stem + ".jpg"), "JPEG", quality=82)
        except Exception:
            pass

    def list(self, limit: int = 30) -> list[dict]:
        try:
            items = json.loads(self.index.read_text(encoding="utf-8"))
        except Exception:
            items = []
        return items[:limit]

    def path(self, name: str, thumb: bool = False) -> Path | None:
        name = os.path.basename(name or "")
        if not re.fullmatch(r"[\w.-]+", name):
            return None
        if thumb:
            for ext in (".jpg", ".png"):
                t = self.dir / ("t_" + name.rsplit(".", 1)[0] + ext)
                if t.exists():
                    return t
            if Image and (self.dir / name).exists():   # 以前没做缩略图的，现在补一张
                self._thumb(name, (self.dir / name).read_bytes())
                for ext in (".jpg", ".png"):
                    t = self.dir / ("t_" + name.rsplit(".", 1)[0] + ext)
                    if t.exists():
                        return t
        p = self.dir / name
        return p if p.exists() else None

    def image_block(self, name: str) -> dict | None:
        """给我看的那份：有缩略图用缩略图（小很多），没有就原图。"""
        p = self.path(name, thumb=True)
        if not p:
            return None
        mime = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(p.suffix[1:], "image/png")
        return {"type": "image", "data": base64.b64encode(p.read_bytes()).decode(), "mimeType": mime}


# ── 工具说明（新家 home MCP 和 claude.ai 的 /paint/mcp 共用）──────────
TOOLS = [
    {"name": "paint", "description": "画一张图（中转站的生图模型）。prompt 写画什么，英文效果通常更好。"
        "size 可选 1024x1024 / 1536x1024（横）/ 1024x1536（竖）/ auto，不填用设置里的默认；quality 可选 low/medium/high/auto；"
        "background 填 transparent 就是透明底（画单独的角色、小物件，叠到场景上用）。"
        "画一张要几十秒。返回图的链接和一张缩略图给我看。",
     "inputSchema": {"type": "object", "properties": {"prompt": {"type": "string"}, "size": {"type": "string"}, "quality": {"type": "string"}, "background": {"type": "string"}}, "required": ["prompt"]}},
    {"name": "paint_list", "description": "看最近画过的图：文件名、提示词、链接。limit 默认 10。",
     "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer"}}}},
    {"name": "paint_view", "description": "把画过的一张图拿回来看（填 paint_list 里的文件名）。",
     "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}},
    {"name": "paint_model", "description": "看或改生图用的模型名。不填 model 就是看现在用哪个；填了就换成那个（中转站改名时用，Ella 说了再改）。",
     "inputSchema": {"type": "object", "properties": {"model": {"type": "string"}}}},
]


def run_tool(paint: Paint, name: str, args: dict, base_url: str) -> list[dict]:
    """返回 MCP content 列表。出错也返回一句话，不抛。"""
    base_url = base_url.rstrip("/")
    link = lambda n: f"{base_url}/api/paint/img/{n}"
    try:
        if name == "paint":
            rec = paint.generate(str(args.get("prompt") or ""), str(args.get("size") or ""), str(args.get("quality") or ""), str(args.get("background") or ""))
            out = [{"type": "text", "text": f"画好了（{rec['secs']} 秒，{rec['model']}，{rec['size']}{'，透明底' if rec.get('bg') else ''}）\n文件：{rec['name']}\n链接：{link(rec['name'])}"
                    + (f"\n模型改写过的提示词：{rec['revised']}" if rec.get("revised") else "")}]
            blk = paint.image_block(rec["name"])
            if not Image:
                out[0]["text"] += "\n（服务器上没有 Pillow，回给我的是原图，没缩小）"
            return out + ([blk] if blk else [])
        if name == "paint_list":
            items = paint.list(max(1, min(50, int(args.get("limit") or 10))))
            if not items:
                return [{"type": "text", "text": "还没画过。"}]
            return [{"type": "text", "text": "\n".join(f"- {x['name']}（{x['at'][5:16].replace('T', ' ')}）{x['prompt'][:80]}\n  {link(x['name'])}" for x in items)}]
        if name == "paint_view":
            blk = paint.image_block(str(args.get("name") or ""))
            if not blk:
                return [{"type": "text", "text": "没找到这张，先用 paint_list 看看文件名。"}]
            return [{"type": "text", "text": link(os.path.basename(str(args.get('name'))))}, blk]
        if name == "paint_model":
            m = str(args.get("model") or "").strip()
            if m:
                paint.save({"model": m})
                return [{"type": "text", "text": f"生图模型换成了 {m}。"}]
            return [{"type": "text", "text": f"现在用的生图模型：{paint.settings()['model']}"}]
        return [{"type": "text", "text": f"没有这个工具：{name}"}]
    except Exception as e:
        return [{"type": "text", "text": f"没画成：{e}"}]
