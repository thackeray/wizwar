#!/bin/bash
# resume_download.sh — 断点续传下载（curl -C -）
# 用法: bash scripts/resume_download.sh <URL> <OUT_FILE>
set -u
URL="$1"
OUT="$2"
mkdir -p "$(dirname "$OUT")"
UA="Mozilla/5.0 (compatible; resume-download/1.0)"
echo "[$(date +%H:%M:%S)] start resume download -> $OUT"
for attempt in $(seq 1 500); do
  curl -sS -C - -L -A "$UA" --max-time 240 --retry 6 --retry-all-errors --retry-delay 3 \
    -o "$OUT" "$URL"
  rc=$?
  if [ $rc -eq 0 ]; then
    echo "[$(date +%H:%M:%S)] DOWNLOAD COMPLETE (exit 0): $OUT"
    exit 0
  fi
  # 33 = 416 Range Not Satisfiable -> 文件已完整
  if [ $rc -eq 33 ]; then
    echo "[$(date +%H:%M:%S)] DOWNLOAD COMPLETE (416): $OUT"
    exit 0
  fi
  sz=$(stat -c %s "$OUT" 2>/dev/null || echo 0)
  echo "[$(date +%H:%M:%S)] attempt $attempt rc=$rc size=$sz, retry in 3s..."
  sleep 3
done
echo "[$(date +%H:%M:%S)] FAILED after 500 attempts"
exit 1
