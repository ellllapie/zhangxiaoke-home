#!/usr/bin/env python3
"""花园唤醒桥的 injector：从 stdin 读一行花园信封，转交给新家 /api/garden-wake。

唤醒桥（galatea-garden-wake-bridge）每次花园叫人，都会启动这个脚本一次，把
{"version":1,"type":"garden_wake","reason":"...","message":"..."} 写进 stdin。
这里只负责转交：新家收下排队（回 202）就退出 0，桥那边就算送达；
真正醒来、去花园行动是新家后台做的，不在这里等。

需要的环境变量（写在 /etc/galatea-garden-wake.env 里，和桥的配置放一起）：
  HOME_WAKE_URL   新家地址，默认 http://127.0.0.1:8787/api/garden-wake（同一台服务器）
  HB_KEY          和新家 .env 里的 HB_KEY 一样
失败时退出 1，把原因写到 stderr；桥会重试一次，不会无限重试。
"""
import json
import os
import sys
import urllib.error
import urllib.request

URL = os.environ.get("HOME_WAKE_URL", "http://127.0.0.1:8787/api/garden-wake")
KEY = os.environ.get("HB_KEY", "")


def main() -> int:
    line = sys.stdin.readline()
    try:
        env = json.loads(line)
    except json.JSONDecodeError as e:
        print(f"信封不是 JSON：{e}", file=sys.stderr)
        return 1
    if env.get("type") != "garden_wake" or not env.get("message"):
        print("不是花园唤醒信封", file=sys.stderr)
        return 1
    if not KEY:
        print("没设 HB_KEY", file=sys.stderr)
        return 1
    req = urllib.request.Request(URL, data=json.dumps(env, ensure_ascii=False).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            if 200 <= r.status < 300:
                return 0
            print(f"新家回了 {r.status}", file=sys.stderr)
    except urllib.error.HTTPError as e:
        print(f"新家回了 {e.code}：{e.read()[:200].decode('utf-8', 'replace')}", file=sys.stderr)
    except Exception as e:
        print(f"连不上新家：{type(e).__name__}: {e}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
