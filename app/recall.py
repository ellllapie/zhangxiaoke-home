"""自动想起（2026-10-16）：她每发一句，新家先在 OB 的目录里对一下，有提到的人、事、东西，就把那一两条记忆放在她这句前面一起给我。

不用 Serein 那套路由和门槛。做法很笨但看得见：
  - 目录：隔一阵调一次 OB 的 pulse（只读，不会让记忆「浮现」），拿到每个桶的 id、标题、标签、主题。
  - 对词：她这句话里出现了哪个标签（Soso、洗澡、九州……）。越少见的标签越算数（出现在一百条里的「亲密关系」几乎不算）。
  - 拿正文：用最准的那个词去 breath(query=词) 拿那一条的正文。
  - 同一个窗口里最近几轮放过的不再放。
"""

import math
import re

PULSE_LINE = re.compile(r"^[📌💭💌]\s*\[([0-9a-f]{6,})\]\s*《([^》]*)》\s*(.*)$")
FIELD = re.compile(r"(主题|重要|权重|标签):(\S*)")
DATE_HEAD = re.compile(r"^\d{4}-\d{2}-\d{2}\s+\d{2}-\d{2}-\d{2}\s*")
LATIN = re.compile(r"^[A-Za-z0-9 .'_+-]+$")
# 太泛的标签：几乎每条都和这些有关，对上了也说明不了什么
# 说话里天天出现的字眼：标签里有也不算（10/16 「没有自动注入」对上了「没有」那条，就是这个）
COMMON = set("""没有 什么 一下 可以 就是 不是 还是 但是 因为 所以 然后 已经 现在 今天 明天 昨天 这个 那个 这样 那样 怎么 为什么
一个 一点 一起 自己 我们 你们 他们 她们 知道 觉得 喜欢 想要 不要 不想 可能 应该 真的 好像 有点 还有 只是 一直 时候 东西 事情
看看 试试 说话 回来 出去 起来 下来 开始 结束 问题 意思 感觉 以后 之前 刚才 马上 晚上 早上 中午 下午 上午 宝宝 老公 哈哈 嘿嘿
好的 嗯嗯 不会 不能 能不能 会不会 是不是 有没有 要不要 一样 一定 所有 每次 别的 其他 怎样 那么 这么 这里 那里 哪里""".split())
# 整句只有这几个字符时，它本身就是信号，按右边的标签翻记忆（10/16：单独一个「。」= 她在冷战，见「句号沟通法则」）
SIGNALS = {"。": "句号", ".": "句号", "．": "句号"}
STOP = {"ella", "章小克", "小克", "claude", "新家", "恋爱", "日常", "亲密", "亲密关系", "情侣日常", "情侣互动", "关系", "里程碑", "dream",
        "核心准则", "kelivo同步", "待办", "工作", "健康", "身份", "自我认知", "自我觉察", "情感连接", "情感表达", "亲密互动",
        "爱", "我", "她", "你", "今天", "宝宝", "老公", "一起做", "记忆", "梦境", "提醒"}


def parse_pulse(text: str) -> list[dict]:
    out = []
    for line in (text or "").splitlines():
        m = PULSE_LINE.match(line.strip())
        if not m:
            continue
        bid, title, rest = m.groups()
        head, _, tagstr = rest.partition("标签:")      # 标签里可能有空格（Clawd Mochi），一直取到行尾
        f = dict(FIELD.findall(head))
        tags = [t.strip() for t in tagstr.split(",") if t.strip()]
        out.append({"id": bid, "title": DATE_HEAD.sub("", title).strip() or title, "date": title[:10],
                    "tags": tags, "domains": [d for d in (f.get("主题") or "").split(",") if d],
                    "importance": int(f["重要"]) if (f.get("重要") or "").isdigit() else 5,
                    "letter": line.strip().startswith("💌")})
    return out


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").lower())


class Index:
    def __init__(self, buckets: list[dict]):
        self.buckets = [b for b in buckets if not b["letter"] and not any(d == "self" for d in b["domains"])]
        df: dict[str, int] = {}
        self.terms: dict[str, list[int]] = {}
        for i, b in enumerate(self.buckets):
            words = set()
            for t in b["tags"]:
                for w in re.split(r"[ 　]+", t):   # 「视频 占卜 数据」这种空格连着写的标签拆开
                    w = _norm(w)
                    if len(w) >= 2 and w not in STOP and not w.startswith("aspect:"):
                        words.add(w)
            for w in words:
                df[w] = df.get(w, 0) + 1
                self.terms.setdefault(w, []).append(i)
        n = max(1, len(self.buckets))
        self.idf = {w: math.log((n + 1) / c) for w, c in df.items()}
        self.n = n

    def match(self, text: str, limit: int = 2, skip: set | None = None) -> list[dict]:
        """返回 [{bucket, score, words}]，最多 limit 条。对不上（或者只对上很泛的词）就是空的。"""
        msg = _norm(text)
        sig = SIGNALS.get(msg)
        if sig:   # 整句就是一个暗号（单独一个句号……）：直接翻带那个标签的记忆
            res = [{"bucket": self.buckets[i], "score": 99.0, "words": [sig]}
                   for i in self.terms.get(sig, [])]   # 暗号每次都翻，不管最近放没放过
            res.sort(key=lambda r: -r["bucket"]["importance"])
            return res[:1]
        if len(msg) < 3:
            return []
        hits: dict[int, dict] = {}
        for w, idx in self.terms.items():
            if w not in msg:
                continue
            if LATIN.match(w) and not re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", msg):
                continue   # 英文词要整词对上（不然 sos 会对上 soso 里面）
            if w in COMMON:
                continue
            if LATIN.match(w) and len(w) < 3:
                continue   # 两个字母的英文（ai、ok）太泛，「claude.ai」会对上「AI」那条
            # 中文两个字的词也是实词（身高、年糕），不打折；英文太短的才打折
            weight = self.idf[w] * (min(1.0, 0.4 + len(w) / 5) if LATIN.match(w) else 1.0)
            for i in idx:
                h = hits.setdefault(i, {"score": 0.0, "words": []})
                h["score"] += weight
                h["words"].append(w)
        floor = math.log((self.n + 1) / 6)   # 至少要对上一个只出现在五六条以内的词
        res = []
        for i, h in hits.items():
            b = self.buckets[i]
            if skip and b["id"] in skip:
                continue
            if h["score"] < floor:
                continue
            res.append({"bucket": b, "score": h["score"] + b["importance"] * 0.05, "words": h["words"]})
        res.sort(key=lambda r: -r["score"])
        return res[:limit]


BLOCK = re.compile(r"\[bucket_id:([0-9a-f]+)\][^\n]*\n([\s\S]*?)(?=\n---\n\[bucket_id:|\Z)")


def parse_breath(text: str) -> dict[str, str]:
    """breath 返回的正文：{bucket_id: 正文}。"""
    return {m.group(1): m.group(2).strip() for m in BLOCK.finditer(text or "")}


def clip(s: str, n: int = 600) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[:n].rstrip() + "……"
