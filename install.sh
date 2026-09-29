#!/usr/bin/env bash
# 章小克的家 —— 一键安装 / 更新
# 用法：  bash install.sh home.ellax6k.top
# 再跑一次就是更新（不会覆盖 .env 和 config/ 里你填好的东西）
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "用法：bash install.sh 你的域名   例如 bash install.sh home.ellax6k.top"
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(id -un)"
PORT=8787
cd "$DIR"

echo "==> 安装系统依赖（python venv、caddy）"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-pip caddy >/dev/null

echo "==> Python 环境"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

echo "==> 配置文件"
mkdir -p config data workspace
[ -f config/mcp.json ] || cp config/mcp.example.json config/mcp.json
[ -f config/system_prompt.md ] || cp config/system_prompt.example.md config/system_prompt.md

if [ ! -f .env ]; then
  echo
  read -r -s -p "给网页设一个登录密码（输入时不显示）：" PW; echo
  read -r -s -p "再输一次：" PW2; echo
  if [ "$PW" != "$PW2" ] || [ -z "$PW" ]; then echo "两次不一样或为空，重新跑一下"; exit 1; fi
  SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
  umask 077
  cat > .env <<EOF
APP_PASSWORD=$PW
SECRET_KEY=$SECRET
# 可选：MODEL=claude-opus-4-6   （不填用 Claude Code 默认）
# 可选：EFFORT=high
# 可选：ALLOW_SHELL=1           （允许在服务器上跑命令、改文件）
EOF
  chmod 600 .env
  echo "   .env 已生成"
fi
chmod 600 .env config/mcp.json 2>/dev/null || true

echo "==> 后台服务（systemd）"
sudo tee /etc/systemd/system/zhangxiaoke-home.service >/dev/null <<EOF
[Unit]
Description=章小克的家
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DIR
Environment=HOME=/home/$USER_NAME
ExecStart=$DIR/.venv/bin/uvicorn app.server:app --host 127.0.0.1 --port $PORT --proxy-headers
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now zhangxiaoke-home >/dev/null
sudo systemctl restart zhangxiaoke-home

echo "==> HTTPS（Caddy 自动申请证书）"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:$PORT {
        flush_interval -1
    }
}
EOF
sudo systemctl reload caddy || sudo systemctl restart caddy

sleep 2
echo
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null; then
  echo "✅ 服务起来了。打开 https://$DOMAIN"
  echo "   第一次打开证书可能要等半分钟。"
else
  echo "⚠️  服务没起来，看日志：sudo journalctl -u zhangxiaoke-home -n 50 --no-pager"
fi
echo
echo "还要做的："
echo "  1. 把系统提示词贴进   $DIR/config/system_prompt.md"
echo "  2. 把 MCP 地址填进     $DIR/config/mcp.json"
echo "  改完跑：sudo systemctl restart zhangxiaoke-home"
