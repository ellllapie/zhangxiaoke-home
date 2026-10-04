"""女巫页的 To Do 和笔记。

存在日记仓库里，是普通的 markdown，章小克在别的窗口用 GitHub 工具也能读、能加：
  memories/witch/todo.md   每行一条：- [ ] 周六 满月 Moon Water / - [x] 已经做完的
  memories/witch/notes.md  每条一段：## 2026-10-04 18:30 · 谁写的   下面一行可以是 ![](图片)，再下面是正文
"""

from __future__ import annotations

import re
import time
import urllib.error

TODO_PATH = "memories/witch/todo.md"
NOTES_PATH = "memories/witch/notes.md"
TODO_HEAD = "# 女巫页 To Do\n\n<!-- 一行一条：- [ ] 没做 / - [x] 做完了。Ella 和章小克都能加。 -->\n\n"
NOTES_HEAD = "# 女巫页笔记\n\n<!-- 一条一段：## 日期 时间 · 谁写的，下一行可以放 ![](图片地址)，再下面写字。新的在最上面。 -->\n"
TODO_LINE = re.compile(r"^\s*[-*]\s*\[( |x|X)\]\s*(.+)$")
NOTE_HEAD = re.compile(r"^##\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})(?:\s*·\s*(.+))?$")
IMG = re.compile(r"^!\[[^\]]*\]\(([^)\s]+)\)\s*$")


class Witch:
    def __init__(self, diary):
        self.d = diary
        self._cache: tuple[float, dict] | None = None

    # ── 读 ──
    def get(self, force: bool = False) -> dict:
        if self._cache and not force and time.time() - self._cache[0] < 30:
            return self._cache[1]
        todo_raw, _ = self.d._file(TODO_PATH)
        notes_raw, _ = self.d._file(NOTES_PATH)
        out = {"todo": self._todos(todo_raw), "notes": self._notes(notes_raw)}
        self._cache = (time.time(), out)
        return out

    @staticmethod
    def _todos(raw: str) -> list[dict]:
        out = []
        for line in raw.splitlines():
            m = TODO_LINE.match(line)
            if m:
                out.append({"i": len(out), "done": m.group(1).lower() == "x", "text": m.group(2).strip()})
        return out

    @staticmethod
    def _notes(raw: str) -> list[dict]:
        out, cur = [], None
        for line in raw.splitlines():
            m = NOTE_HEAD.match(line.strip())
            if m:
                cur = {"date": m.group(1), "time": m.group(2).zfill(5), "who": (m.group(3) or "").strip(), "img": "", "lines": []}
                out.append(cur)
                continue
            if cur is None:
                continue
            im = IMG.match(line.strip())
            if im and not cur["img"] and not any(x.strip() for x in cur["lines"]):
                cur["img"] = im.group(1)
            else:
                cur["lines"].append(line)
        for n in out:
            n["text"] = "\n".join(n.pop("lines")).strip()
            n["id"] = f"{n['date']} {n['time']}"
        return [n for n in out if n["text"] or n["img"]]

    # ── 写（读一遍改一遍存；同时被别处改了就再来一次）──
    def _edit(self, path: str, head: str, fn, message: str) -> None:
        for attempt in (1, 2):
            raw, sha = self.d._file(path)
            if not raw.strip():
                raw = head
            new = fn(raw)
            try:
                self.d._put(path, new, sha, message)
                break
            except urllib.error.HTTPError as e:
                if attempt == 1 and e.code in (409, 422):
                    continue
                raise
        self._cache = None

    def todo(self, op: str, text: str = "", i: int = -1) -> None:
        def fn(raw: str) -> str:
            lines = raw.splitlines()
            idx = [k for k, l in enumerate(lines) if TODO_LINE.match(l)]
            if op == "add":
                t = text.replace("\n", " ").strip()
                if not t:
                    raise ValueError("空的")
                pos = (idx[-1] + 1) if idx else len(lines)
                lines.insert(pos, f"- [ ] {t}")
            elif 0 <= i < len(idx):
                k = idx[i]
                m = TODO_LINE.match(lines[k])
                if op == "toggle":
                    lines[k] = f"- [{' ' if m.group(1).lower() == 'x' else 'x'}] {m.group(2).strip()}"
                elif op == "del":
                    lines.pop(k)
            else:
                raise ValueError("没有这一条")
            return "\n".join(lines).rstrip() + "\n"
        self._edit(TODO_PATH, TODO_HEAD, fn, f"女巫页 To Do：{op}")

    def add_note(self, text: str, img: str, when: str, who: str) -> None:
        text = re.sub(r"^##", "\\##", text.strip(), flags=re.M)

        def fn(raw: str) -> str:
            k = raw.find("\n## ")
            head, rest = (raw, "") if k < 0 else (raw[:k + 1], raw[k + 1:])
            block = f"## {when} · {who}\n\n" + (f"![]({img})\n\n" if img else "") + (text + "\n" if text else "")
            return head.rstrip("\n") + "\n\n" + block + ("\n" + rest if rest else "")
        self._edit(NOTES_PATH, NOTES_HEAD, fn, "女巫页笔记")

    def del_note(self, note_id: str) -> None:
        def fn(raw: str) -> str:
            out, skip = [], False
            for line in raw.splitlines():
                m = NOTE_HEAD.match(line.strip())
                if m:
                    skip = f"{m.group(1)} {m.group(2).zfill(5)}" == note_id
                if not skip:
                    out.append(line)
            return "\n".join(out).rstrip() + "\n"
        self._edit(NOTES_PATH, NOTES_HEAD, fn, "女巫页笔记：删一条")
