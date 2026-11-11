"""额度重置按钮（11-11）：替她在服务器后台打开 claude，输 /limit-reset，确认，读回结果。

/limit-reset 是 Claude Code 终端界面里的命令，没有接口能直接调，所以这里开一个假终端（pty）照着人手按。
- 用干净的环境开：去掉 ANTHROPIC_*/CLAUDE*（不然会走中转站或者"子会话"），
  传了令牌就带 CLAUDE_CODE_OAUTH_TOKEN（订阅账号里选的那个号），没传就是本机登录的号。
- 在自己的空文件夹 ~/limit-reset 里开，第一次问"信不信任这个文件夹"就选信任。
- 问"用不用"的时候选 Yes；它要是问"用哪一种"，选默认那项。
- 整个过程最多 70 秒，结束就把进程关掉。
只在她点了按钮、又在弹窗里点了确定以后才跑。
"""
from __future__ import annotations

import os
import re
import select
import signal
import struct
import time
from pathlib import Path

ANSI = re.compile(r"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]")
WORKDIR = Path.home() / "limit-reset"


def _read(fd: int, secs: float, until: re.Pattern | None = None) -> str:
    out, end = b"", time.time() + secs
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                b = os.read(fd, 65536)
            except OSError:
                break
            if not b:
                break
            out += b
            if until and until.search(_flat(_clean(out))):
                time.sleep(0.6)   # 让这一屏画完
                try:
                    out += os.read(fd, 65536) if select.select([fd], [], [], 0.3)[0] else b""
                except OSError:
                    pass
                break
    return _clean(out)


def _clean(b: bytes) -> str:
    return ANSI.sub("", b.decode("utf-8", "replace"))


def _flat(s: str) -> str:
    return re.sub(r"\s+", "", s)


# 终端里按光标挪着画字，空格常常被吃掉，所以都去掉空白再认
DONE = re.compile(r"weeklyresetdaystays|Couldn'treset|Couldn'tconfirm|Stillcouldn't|isn'tavailable|No\w+tous|Unknowncommand|resetsleft|Resetused|kept·run", re.I)
ASK = re.compile(r"Yes,usemy|Usea\w+\?|Whichresetdoyouwant", re.I)
LINES = [
    (re.compile(r"weeklyresetdaystays", re.I), "ok", "重置好了"),
    (re.compile(r"isn'tavailable", re.I), "no", "现在没有能用的重置（可能这周用过了，或者还没到上限）"),
    (re.compile(r"No\w+tous", re.I), "no", "没有能用的重置"),
    (re.compile(r"Couldn'treset", re.I), "fail", "没重置成，什么都没用掉，过一会儿再试"),
    (re.compile(r"Couldn'tconfirm|Stillcouldn't", re.I), "unsure", "不确定成没成，过一会儿看看额度有没有清零"),
    (re.compile(r"Unknowncommand", re.I), "fail", "这个号没有 /limit-reset 这个命令"),
]


def _tail(s: str) -> str:
    """终端最后几行，给她看原话"""
    s = re.sub(r"[─━▐▛▜▝▘█▀▄⏵⎿●✽◐❯✘⚠]+", " ", s)
    s = re.sub(r"[ \t]+", " ", s)
    lines = [x.strip() for x in s.splitlines() if x.strip()]
    keep = [x for x in lines if re.search(r"reset|limit|available|weekly|session", x, re.I)]
    return " / ".join((keep or lines)[-3:])[:300]


def run(token: str | None = None, timeout: float = 70, dry: bool = False) -> dict:
    """dry=True：走到问"用不用"那步就按 Esc，什么都不用掉（自测用）"""
    import pty, fcntl, termios
    WORKDIR.mkdir(exist_ok=True)
    pid, fd = pty.fork()
    if pid == 0:   # 子进程：变成 claude
        try:
            os.chdir(WORKDIR)
            for k in list(os.environ):
                if k.startswith(("ANTHROPIC_", "CLAUDE")):
                    del os.environ[k]
            if token:
                os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token
            os.environ.update(TERM="xterm-256color", COLUMNS="120", LINES="40")
            os.execvp("claude", ["claude"])
        finally:
            os._exit(127)
    t0, log = time.time(), ""
    left = lambda: max(1.0, timeout - (time.time() - t0))
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        ready = re.compile(r"/effort|trustthisfolder|forshortcuts|Try\"", re.I)
        s = _read(fd, min(20, left()), ready); log += s
        if "trustthisfolder" in _flat(s):
            os.write(fd, b"\x1b[B"); time.sleep(0.4); os.write(fd, b"\r")
            s = _read(fd, min(20, left()), re.compile(r"/effort|Try\"", re.I)); log += s
        os.write(fd, b"/limit-reset"); time.sleep(1.2); log += _read(fd, 1)
        os.write(fd, b"\r")
        s = _read(fd, min(30, left()), re.compile(DONE.pattern + "|" + ASK.pattern, re.I)); log += s
        for _ in range(2):   # 最多两道题：先问用哪一种，再问用不用
            f = _flat(s)
            if DONE.search(f) and not ASK.search(f):
                break
            if dry and ASK.search(f):
                return {"status": "dry", "msg": "走到确认那步了，没按", "raw": _tail(s)}
            if re.search(r"Whichresetdoyouwant", f, re.I) and not re.search(r"Yes,usemy", f, re.I):
                os.write(fd, b"\r")   # 用默认那项
            elif re.search(r"Yes,usemy", f, re.I):
                # 光标（❯）要在 Yes 那行上；在 No 上就往上挪一格
                if re.search(r"❯\s*No,keep", f, re.I):
                    os.write(fd, b"\x1b[A"); time.sleep(0.3)
                os.write(fd, b"\r")
            else:
                break
            s = _read(fd, min(30, left()), re.compile(DONE.pattern + "|Yes,usemy", re.I)); log += s
    finally:
        try:
            os.write(fd, b"\x1b"); time.sleep(0.3); os.write(fd, b"\x03"); time.sleep(0.3)
        except OSError:
            pass
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.kill(pid, sig); time.sleep(0.5)
            except ProcessLookupError:
                break
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass
    f = _flat(log)
    for rx, status, msg in LINES:
        if rx.search(f):
            return {"status": status, "msg": msg, "raw": _tail(log)}
    return {"status": "unsure", "msg": "没看到它回什么，过一会儿看看额度", "raw": _tail(log)}
