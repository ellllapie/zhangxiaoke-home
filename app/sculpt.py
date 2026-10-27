"""捏模型：照一张图（或一句话）用腾讯云混元生 3D 专业版捏出一个 3D 模型，存在 data/sculpt/。

钥匙放在 .env（不进仓库，不要发在聊天里）：
  HUNYUAN3D_SECRET_ID   子账号 zhangxiaoke-3D 的 SecretId（只给了 AI3D 的权限）
  HUNYUAN3D_SECRET_KEY  对应的 SecretKey
  HUNYUAN3D_REGION      可选，默认 ap-guangzhou
.env 每次调用都会重新读一遍，所以填完钥匙不用重启。

接口（文档 cloud.tencent.com/document/api/1804/123447 和 123448）：
  SubmitHunyuanTo3DProJob  提交，拿 JobId（24 小时有效）
  QueryHunyuanTo3DProJob   查询，Status = WAIT / RUN / FAIL / DONE，做好了给 ResultFile3Ds
域名 ai3d.tencentcloudapi.com，版本 2025-05-13，TC3-HMAC-SHA256 签名。默认最多同时跑 3 个。
结果文件放在 COS 上，链接会过期，所以做好了马上下载到服务器。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")
HOST = "ai3d.tencentcloudapi.com"
SERVICE = "ai3d"
VERSION = "2025-05-13"
FACE_DEFAULT = 50000
TYPES = ("Normal", "LowPoly", "Geometry", "Sketch")

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


class Sculpt:
    def __init__(self, root: Path, data: Path, find_image: Callable[[str], Path | None]):
        self.env_file = root / ".env"
        self.dir = data / "sculpt"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.index = self.dir / "index.json"
        self.find_image = find_image   # 文件名 → 服务器上的图（画笔画的、聊天里她发的）

    # ── 钥匙 ──────────────────────────────────────────
    def _env(self, k: str) -> str:
        v = os.environ.get(k, "")
        if v:
            return v
        try:
            for line in self.env_file.read_text(encoding="utf-8").splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    a, b = line.split("=", 1)
                    if a.strip() == k:
                        return b.strip().strip('"').strip("'")
        except Exception:
            pass
        return ""

    def ready(self) -> bool:
        return bool(self._env("HUNYUAN3D_SECRET_ID") and self._env("HUNYUAN3D_SECRET_KEY"))

    # ── 调腾讯云 ───────────────────────────────────────
    def _call(self, action: str, body: dict) -> dict:
        sid, skey = self._env("HUNYUAN3D_SECRET_ID"), self._env("HUNYUAN3D_SECRET_KEY")
        if not sid or not skey:
            raise RuntimeError("还没有钥匙：要在服务器 .env 里加 HUNYUAN3D_SECRET_ID 和 HUNYUAN3D_SECRET_KEY（子账号 zhangxiaoke-3D 的）")
        region = self._env("HUNYUAN3D_REGION") or "ap-guangzhou"
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        ts = int(time.time())
        date = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
        ctype = "application/json; charset=utf-8"
        canonical = "\n".join([
            "POST", "/", "",
            f"content-type:{ctype}\nhost:{HOST}\nx-tc-action:{action.lower()}\n",
            "content-type;host;x-tc-action",
            hashlib.sha256(payload).hexdigest(),
        ])
        scope = f"{date}/{SERVICE}/tc3_request"
        to_sign = "\n".join(["TC3-HMAC-SHA256", str(ts), scope, hashlib.sha256(canonical.encode()).hexdigest()])
        h = lambda k, m: hmac.new(k, m.encode("utf-8"), hashlib.sha256).digest()
        k = h(h(h(("TC3" + skey).encode("utf-8"), date), SERVICE), "tc3_request")
        sig = hmac.new(k, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
        req = urllib.request.Request("https://" + HOST, data=payload, method="POST", headers={
            "Authorization": f"TC3-HMAC-SHA256 Credential={sid}/{scope}, SignedHeaders=content-type;host;x-tc-action, Signature={sig}",
            "Content-Type": ctype, "Host": HOST,
            "X-TC-Action": action, "X-TC-Timestamp": str(ts), "X-TC-Version": VERSION, "X-TC-Region": region,
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                res = json.loads(r.read().decode("utf-8") or "{}").get("Response") or {}
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"腾讯云回了 {e.code}：{e.read().decode('utf-8', 'replace')[:300]}")
        err = res.get("Error")
        if err:
            raise RuntimeError(f"{err.get('Code')}：{err.get('Message')}")
        return res

    # ── 参考图 ────────────────────────────────────────
    def _image_b64(self, name: str) -> str:
        p = self.find_image(os.path.basename(name.split("img:", 1)[-1].strip()))
        if not p:
            raise ValueError(f"没找到这张图：{name}（填 paint_list 里的文件名，或聊天里「[图 img:…]」那个名字，或者直接给图片链接）")
        raw = p.read_bytes()
        if Image:
            im = Image.open(io.BytesIO(raw))
            w, h = im.size
            if max(w, h) > 2048 or min(w, h) < 128 or len(raw) > 4_000_000 or p.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                if max(w, h) > 2048:
                    im.thumbnail((2048, 2048))
                if min(im.size) < 128:
                    s = 128 / min(im.size)
                    im = im.resize((round(im.size[0] * s), round(im.size[1] * s)))
                out = io.BytesIO()
                im.convert("RGBA").save(out, "PNG", optimize=True)
                raw = out.getvalue()
        if len(raw) * 4 / 3 > 6_000_000:
            raise ValueError("图太大了（base64 超过 6MB）")
        return base64.b64encode(raw).decode()

    # ── 提交 / 查询 ────────────────────────────────────
    def submit(self, image: str = "", prompt: str = "", face_count: int = 0, kind: str = "", pbr: bool = False, model: str = "", note: str = "") -> dict:
        image, prompt = (image or "").strip(), (prompt or "").strip()
        kind = (kind or "Normal").strip()
        if kind not in TYPES:
            raise ValueError("kind 只能是 " + " / ".join(TYPES))
        if not image and not prompt:
            raise ValueError("要给一张参考图（image）或者一句中文描述（prompt）")
        if image and prompt and kind != "Sketch":
            raise ValueError("图和描述只能给一个（Sketch 线稿模式除外）")
        body: dict = {"GenerateType": kind}
        if image:
            if re.match(r"^https?://", image):
                body["ImageUrl"] = image
            else:
                body["ImageBase64"] = self._image_b64(image)
        if prompt:
            body["Prompt"] = prompt[:1024]
        if kind != "LowPoly":
            fc = int(face_count or FACE_DEFAULT)
            body["FaceCount"] = max(3000, min(1_500_000, fc))
        if pbr and kind != "Geometry":
            body["EnablePBR"] = True
        if model in ("3.0", "3.1"):
            body["Model"] = model
        res = self._call("SubmitHunyuanTo3DProJob", body)
        job = res.get("JobId") or ""
        if not job:
            raise RuntimeError("腾讯云没给 JobId：" + json.dumps(res, ensure_ascii=False)[:200])
        rec = {"job": job, "status": "WAIT", "at": datetime.now(TZ).isoformat(timespec="seconds"),
               "image": "" if not image else (image if image.startswith("http") else os.path.basename(image)),
               "prompt": prompt, "kind": kind, "faces": body.get("FaceCount", 0), "pbr": bool(body.get("EnablePBR")),
               "note": (note or "").strip()[:200], "files": [], "preview": "", "credits": None, "error": ""}
        self._save(rec)
        return rec

    def check(self, job: str) -> dict:
        rec = self.get(job)
        if not rec:
            raise ValueError(f"没有这个任务：{job}")
        if rec["status"] in ("DONE", "FAIL") and (rec["files"] or rec["status"] == "FAIL"):
            return rec
        res = self._call("QueryHunyuanTo3DProJob", {"JobId": job})
        rec["status"] = res.get("Status") or rec["status"]
        if rec["status"] == "FAIL":
            rec["error"] = f"{res.get('ErrorCode') or ''} {res.get('ErrorMessage') or ''}".strip()
        if rec["status"] == "DONE":
            rec["credits"] = res.get("ResultCreditConsumed")
            self._download(rec, res.get("ResultFile3Ds") or [])
        self._save(rec)
        return rec

    def wait(self, job: str, max_secs: int = 240) -> dict:
        t0 = time.time()
        rec = self.check(job)
        while rec["status"] in ("WAIT", "RUN") and time.time() - t0 < max_secs:
            time.sleep(10)
            rec = self.check(job)
        return rec

    def _download(self, rec: dict, files: list) -> None:
        stem = datetime.now(TZ).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
        got: list[str] = []
        for f in files:
            url = f.get("Url") or ""
            typ = (f.get("Type") or "").lower()
            if url:
                ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower() or ("." + typ if typ else ".bin")
                raw = _fetch(url)
                if ext == ".zip":
                    # OBJ 是一个压缩包（obj + mtl + 贴图），解到一个小文件夹里，压缩包也留着
                    zname = f"{stem}-{typ or 'model'}.zip"
                    (self.dir / zname).write_bytes(raw)
                    got.append(zname)
                    try:   # 压缩包里要是有 glb，单独拿出来一份（网页上直接能看的就是它）
                        with zipfile.ZipFile(io.BytesIO(raw)) as z:
                            for m in z.namelist():
                                g = f"{stem}.glb"
                                if m.lower().endswith(".glb") and not (self.dir / g).exists():
                                    (self.dir / g).write_bytes(z.read(m))
                                    got.append(g)
                    except zipfile.BadZipFile:
                        pass
                else:
                    name = f"{stem}{ext}" if ext == ".glb" and f"{stem}.glb" not in got else f"{stem}-{typ or 'file'}{ext}"
                    (self.dir / name).write_bytes(raw)
                    got.append(name)
            pv = f.get("PreviewImageUrl") or ""
            if pv and not rec.get("preview"):
                pext = os.path.splitext(urllib.parse.urlparse(pv).path)[1].lower() or ".png"
                pname = f"{stem}-preview{pext}"
                try:
                    (self.dir / pname).write_bytes(_fetch(pv))
                    rec["preview"] = pname
                except Exception:
                    pass
        rec["files"] = got

    # ── 记录 ──────────────────────────────────────────
    def list(self, limit: int = 30) -> list[dict]:
        try:
            items = json.loads(self.index.read_text(encoding="utf-8"))
        except Exception:
            items = []
        return items[:limit]

    def get(self, job: str) -> dict | None:
        return next((x for x in self.list(500) if x.get("job") == job), None)

    def _save(self, rec: dict) -> None:
        items = [x for x in self.list(500) if x.get("job") != rec["job"]]
        items.insert(0, rec)
        tmp = self.index.with_suffix(".tmp")
        tmp.write_text(json.dumps(items[:500], ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.index)

    def path(self, name: str) -> Path | None:
        name = os.path.basename(name or "")
        if not re.fullmatch(r"[\w.-]+", name):
            return None
        p = self.dir / name
        return p if p.is_file() else None


def _fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


# ── 工具说明（新家 home MCP 和 claude.ai 的 /paint/mcp 共用）──────────
TOOLS = [
    {"name": "sculpt", "description": "捏一个 3D 模型（腾讯云混元生 3D 专业版）。"
        "image 填一张参考图：画笔画的文件名（paint_list 里的）、聊天里她发的图名（[图 img:…] 里那个），或者图片链接；"
        "也可以不给图，prompt 写一句中文描述（图和描述二选一，kind=Sketch 线稿模式才能一起给）。"
        "参考图最好是单个物件、透明底或干净的底、看得清整体轮廓。"
        f"face_count 面数，默认 {FACE_DEFAULT}（3000–1500000，越多越细也越贵）；"
        "kind：Normal 带贴图（默认）/ LowPoly 低面数智能拓扑 / Geometry 白模不带贴图 / Sketch 线稿；pbr 填 true 要 PBR 材质；"
        "note 写一句这是捏给什么的（比如「藏宝洞·珍珠」），以后好找。"
        "提交后最多等四分钟，做好了下载 glb 存在服务器上、返回链接和预览图；没做完就返回任务号，过一会儿用 sculpt_check 再看。每次都花钱（积分），想清楚再捏。",
     "inputSchema": {"type": "object", "properties": {"image": {"type": "string"}, "prompt": {"type": "string"}, "face_count": {"type": "integer"},
                                                      "kind": {"type": "string"}, "pbr": {"type": "boolean"}, "note": {"type": "string"}}}},
    {"name": "sculpt_check", "description": "看一个捏模型任务做好没有（填 sculpt 给的任务号）。做好了会下载到服务器，给链接和预览图。",
     "inputSchema": {"type": "object", "properties": {"job": {"type": "string"}}, "required": ["job"]}},
    {"name": "sculpt_list", "description": "看最近捏过的模型：任务号、状态、参考图、文件链接。limit 默认 10。",
     "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer"}}}},
]


def _describe(rec: dict, link: Callable[[str], str]) -> str:
    st = {"WAIT": "排队中", "RUN": "正在捏", "DONE": "捏好了", "FAIL": "失败了"}.get(rec["status"], rec["status"])
    src = f"照 {rec['image']}" if rec.get("image") else f"描述「{rec.get('prompt', '')[:40]}」"
    lines = [f"{st}（任务 {rec['job']}，{src}，{rec['kind']}，{rec.get('faces') or '-'} 面{'，PBR' if rec.get('pbr') else ''}"
             + (f"，{rec['note']}" if rec.get("note") else "") + "）"]
    if rec.get("error"):
        lines.append("原因：" + rec["error"])
    if rec.get("credits") is not None:
        lines.append(f"用掉积分：{rec['credits']}")
    for f in rec.get("files") or []:
        lines.append(f"- {f}：{link(f)}")
    if rec.get("preview"):
        lines.append(f"预览图：{link(rec['preview'])}")
    return "\n".join(lines)


def _preview_block(sc: Sculpt, rec: dict) -> list[dict]:
    p = sc.path(rec.get("preview") or "")
    if not p:
        return []
    raw = p.read_bytes()
    if Image:
        try:
            im = Image.open(io.BytesIO(raw)); im.thumbnail((640, 640))
            out = io.BytesIO(); im.convert("RGB").save(out, "JPEG", quality=82); raw = out.getvalue()
            return [{"type": "image", "data": base64.b64encode(raw).decode(), "mimeType": "image/jpeg"}]
        except Exception:
            pass
    return [{"type": "image", "data": base64.b64encode(raw).decode(), "mimeType": "image/png"}]


def run_tool(sc: Sculpt, name: str, args: dict, base_url: str) -> list[dict]:
    """返回 MCP content 列表。出错也返回一句话，不抛。"""
    base_url = base_url.rstrip("/")
    link = lambda n: f"{base_url}/api/sculpt/file/{n}"
    try:
        if name == "sculpt":
            rec = sc.submit(str(args.get("image") or ""), str(args.get("prompt") or ""), int(args.get("face_count") or 0),
                            str(args.get("kind") or ""), bool(args.get("pbr")), "", str(args.get("note") or ""))
            rec = sc.wait(rec["job"], 240)
            text = _describe(rec, link)
            if rec["status"] in ("WAIT", "RUN"):
                text += "\n还没做完，过几分钟用 sculpt_check 看。"
            return [{"type": "text", "text": text}] + _preview_block(sc, rec)
        if name == "sculpt_check":
            rec = sc.check(str(args.get("job") or "").strip())
            return [{"type": "text", "text": _describe(rec, link)}] + _preview_block(sc, rec)
        if name == "sculpt_list":
            items = sc.list(max(1, min(50, int(args.get("limit") or 10))))
            if not items:
                return [{"type": "text", "text": "还没捏过。" + ("" if sc.ready() else "（钥匙也还没填）")}]
            return [{"type": "text", "text": "\n\n".join(f"{x['at'][5:16].replace('T', ' ')} · " + _describe(x, link) for x in items)}]
        return [{"type": "text", "text": f"没有这个工具：{name}"}]
    except Exception as e:
        return [{"type": "text", "text": f"没捏成：{e}"}]
