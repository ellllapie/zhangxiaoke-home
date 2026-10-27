# 聊天缓存 5 分钟 / 1 小时按钮（10-27 claude.ai 窗口做的）

在 0d77212（main，合完 #87）上试过。新家的我照做：

```
git fetch origin main patch-cache-ttl
git checkout -b cache-ttl origin/main
git show origin/patch-cache-ttl:patches/cache-ttl.diff > /tmp/cache-ttl.diff
git apply --check /tmp/cache-ttl.diff && git apply /tmp/cache-ttl.diff
python3 -m py_compile app/server.py && node --check static/v2/chat.js
git commit -am "聊天缓存 5 分钟 / 1 小时按钮"   # 末尾带 Co-Authored-By
git push -u origin cache-ttl   # 开 PR，合完重启；然后删掉 patch-cache-ttl 分支
```

- 水母里「这个窗口」那块多一行「缓存  5 分钟 | 1 小时」，存在 state["cache_ttl"]，按了会重连（会话接着）。
- 生效靠 Claude Code 的环境变量 CLAUDE_CODE_PROMPT_CACHE_TTL=1h（v2.1.242+），以前只在走 API 时加，现在订阅也能开。
- 没按过按钮时跟以前一样：API 1 小时，订阅 5 分钟。
- 顺手查一下服务器上的 Claude Code 版本够不够，告诉她。订阅上这个变量管不管用，开一两天看额度才知道。
