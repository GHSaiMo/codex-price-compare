#!/usr/bin/env bash
# 把本地 main 通过 SSH 以 git bundle 同步到 NAS 并重启服务，不依赖 GitHub / 代理。
# 用法: scripts/deploy-nas.sh [--no-restart]
set -euo pipefail

NAS_HOST="${NAS_HOST:-nas}"
NAS_DIR="${NAS_DIR:-/vol1/1000/apps/codex-price-compare}"
SERVICE="codex-price-compare"
RESTART=1
[ "${1:-}" = "--no-restart" ] && RESTART=0

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交改动，请先提交。" >&2
  exit 1
fi

LOCAL_HEAD=$(git rev-parse HEAD)
NAS_HEAD=$(ssh -o ConnectTimeout=8 "$NAS_HOST" "git -C $NAS_DIR rev-parse HEAD")

if [ "$NAS_HEAD" = "$LOCAL_HEAD" ]; then
  echo "NAS 已是最新 ($LOCAL_HEAD)。"
else
  if ! git merge-base --is-ancestor "$NAS_HEAD" "$LOCAL_HEAD"; then
    echo "NAS 提交 $NAS_HEAD 不是本地 HEAD 的祖先，需手动处理分叉。" >&2
    exit 1
  fi
  BUNDLE=$(mktemp -t deploy-nas.XXXXXX)
  trap 'rm -f "$BUNDLE"' EXIT
  git bundle create "$BUNDLE" "$NAS_HEAD..main" >/dev/null 2>&1
  REMOTE_TMP="/tmp/deploy-$LOCAL_HEAD.bundle"
  ssh "$NAS_HOST" "cat > $REMOTE_TMP" < "$BUNDLE"
  ssh "$NAS_HOST" "cd $NAS_DIR && git pull --ff-only -q $REMOTE_TMP main; rc=\$?; rm -f $REMOTE_TMP; exit \$rc"
  echo "NAS 已更新到 $(ssh "$NAS_HOST" "git -C $NAS_DIR log --oneline -1")"
fi

if [ "$RESTART" = 1 ]; then
  ssh "$NAS_HOST" "sudo systemctl restart $SERVICE && sleep 3 && systemctl is-active $SERVICE"
fi

fail=0
for port in 49173 49174; do
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)
  echo "探活 :$port -> $code"
  [ "$code" = "200" ] || fail=1
done
exit $fail
