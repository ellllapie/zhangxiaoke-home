"""新家自己的网页推送（Web Push），不用第三方库。

iPhone 上把新家加到主屏幕、从桌面图标打开以后，可以像 App 一样收到通知。
这里做三件事：
  1. VAPID 钥匙：第一次用时生成，存在 data/vapid.pem（跟着 data/ 一起备份）。
  2. 加密：按 RFC 8291（aes128gcm）把通知内容加密成只有那台手机能解开的样子。
  3. 发送：带上 VAPID 签名（RFC 8292）POST 到手机浏览器给的推送地址。
只用 cryptography（有现成的安装包，不用编译）。
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    s = s.strip()
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _pub_raw(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _hkdf(salt: bytes, ikm: bytes, info: bytes, n: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=n, salt=salt, info=info).derive(ikm)


def encrypt(p256dh: str, auth: str, plaintext: bytes) -> bytes:
    """RFC 8291：给一台设备加密一条通知，返回 aes128gcm 格式的正文。"""
    ua_pub = unb64u(p256dh)
    auth_secret = unb64u(auth)
    as_key = ec.generate_private_key(ec.SECP256R1())
    as_pub = _pub_raw(as_key)
    shared = as_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub))
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    salt = os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    ct = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)   # \x02 = 最后一段
    rs = 4096
    return salt + rs.to_bytes(4, "big") + bytes([len(as_pub)]) + as_pub + ct


class WebPush:
    def __init__(self, data: Path, contact: str = "mailto:ellax6k@163.com"):
        self.key_file = data / "vapid.pem"
        self.subs_file = data / "push_subs.json"
        self.contact = contact
        self._key: ec.EllipticCurvePrivateKey | None = None

    # ── 钥匙 ──
    def key(self) -> ec.EllipticCurvePrivateKey:
        if self._key is None:
            if self.key_file.exists():
                self._key = serialization.load_pem_private_key(self.key_file.read_bytes(), password=None)
            else:
                self._key = ec.generate_private_key(ec.SECP256R1())
                self.key_file.write_bytes(self._key.private_bytes(
                    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        return self._key

    def public_key(self) -> str:
        return b64u(_pub_raw(self.key()))

    def _vapid(self, endpoint: str) -> str:
        u = urlparse(endpoint)
        head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
        claims = b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + 12 * 3600,
                                  "sub": self.contact}, separators=(",", ":")).encode())
        msg = f"{head}.{claims}".encode()
        r, s = decode_dss_signature(self.key().sign(msg, ec.ECDSA(hashes.SHA256())))
        sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
        return f"vapid t={head}.{claims}.{b64u(sig)}, k={self.public_key()}"

    # ── 订阅（每台设备一条）──
    def subs(self) -> list[dict]:
        try:
            return json.loads(self.subs_file.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save_subs(self, subs: list[dict]) -> None:
        self.subs_file.write_text(json.dumps(subs, ensure_ascii=False, indent=1), encoding="utf-8")

    def add(self, sub: dict, name: str = "") -> None:
        ep = sub.get("endpoint")
        keys = sub.get("keys") or {}
        if not ep or not keys.get("p256dh") or not keys.get("auth"):
            raise ValueError("订阅信息不完整")
        subs = [s for s in self.subs() if s["endpoint"] != ep]
        subs.append({"endpoint": ep, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
                     "name": name[:80], "at": int(time.time())})
        self._save_subs(subs)

    def remove(self, endpoint: str) -> None:
        self._save_subs([s for s in self.subs() if s["endpoint"] != endpoint])

    # ── 发送 ──
    def send_one(self, sub: dict, payload: dict, urgency: str = "normal") -> tuple[bool, str]:
        body = encrypt(sub["keys"]["p256dh"], sub["keys"]["auth"], json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        req = urllib.request.Request(sub["endpoint"], data=body, method="POST", headers={
            "Authorization": self._vapid(sub["endpoint"]),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": "86400",
            "Urgency": urgency,
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return True, f"HTTP {r.status}"
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                self.remove(sub["endpoint"])   # 这台设备取消了订阅
                return False, f"这台设备的订阅失效了（HTTP {e.code}），已移除"
            return False, f"HTTP {e.code}: {e.read()[:200].decode('utf-8', 'replace')}"
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"

    def send_all(self, payload: dict, urgency: str = "normal") -> tuple[bool, str]:
        subs = self.subs()
        if not subs:
            return False, "还没有设备打开新家通知"
        results = [self.send_one(s, payload, urgency) for s in subs]
        ok = any(r[0] for r in results)
        return ok, "；".join(r[1] for r in results)
