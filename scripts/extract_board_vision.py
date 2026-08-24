#!/usr/bin/env python3
"""
extract_board_vision.py — 用 6999 视觉服务 + board-extraction-prompt.md 提取棋盘拓扑。

对每个颜色（blue/red/yellow/green）的 front 图跑一次提示词，
输出模型的严格 JSON 文本。不解析、不修改，原样保存。

用法:
  python scripts/extract_board_vision.py [--color blue] [--all]
  python scripts/extract_board_vision.py --all        # 4 张全跑
"""
import argparse
import base64
import json
import re
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

VISION_URL = "http://localhost:6999/v1/vision"
PROMPT_FILE = Path(__file__).resolve().parent.parent / "work" / "board-extraction-prompt.md"
BOARDS_DIR = Path(__file__).resolve().parent.parent / "work" / "boards"
OUT_DIR = Path(__file__).resolve().parent.parent / "work" / "processed" / "boards_vision"

COLORS = ["blue", "red", "yellow", "green"]


def load_prompt(color: str) -> str:
    text = PROMPT_FILE.read_text(encoding="utf-8")
    # 提取提示词块（``` 代码块内）
    m = re.search(r"```\n(.*?)\n```", text, re.S)
    prompt = m.group(1) if m else text
    prompt = prompt.replace("[COLOR]", color)
    return prompt


def call_vision(b64_image: str, prompt: str, max_tokens: int = 4000) -> str:
    payload = json.dumps({
        "image": b64_image,
        "prompt": prompt,
        "max_tokens": max_tokens,
        "temperature": 0.0,   # 贪心，稳定 JSON
        "thinking": False,    # 跳过推理，直接出结果
    }).encode()
    req = urllib.request.Request(
        VISION_URL, data=payload, headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=1200).read())
    return r["text"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--color", choices=COLORS)
    ap.add_argument("--all", action="store_true", help="跑全部 4 个颜色")
    ap.add_argument("--max-tokens", type=int, default=4000)
    args = ap.parse_args()

    if args.all:
        colors = COLORS
    elif args.color:
        colors = [args.color]
    else:
        ap.print_help()
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for color in colors:
        img = BOARDS_DIR / f"{color} front.png"
        if not img.exists():
            print(f"[skip] {img} 不存在", file=sys.stderr)
            continue
        b64 = base64.b64encode(img.read_bytes()).decode()
        prompt = load_prompt(color)
        print(f"[{datetime.now():%H:%M:%S}] {color}: 发送 {img.name} ...")
        t0 = time.time()
        text = call_vision(b64, prompt, args.max_tokens)
        dt = time.time() - t0
        out = OUT_DIR / f"{color} front.json"
        # 清理：剥掉 ```json ... ``` 代码围栏，以及首个 { 之前 / 末尾 } 之后的杂散文本
        cleaned = text.strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        m = re.search(r"\{.*\}", cleaned, re.S)
        if m:
            cleaned = m.group(0)
        out.write_text(cleaned, encoding="utf-8")
        print(f"[{datetime.now():%H:%M:%S}] {color}: 完成 {dt:.0f}s, 输出 {len(cleaned)} 字符 -> {out}")
        # 校验是不是合法 JSON
        try:
            json.loads(cleaned)
            print(f"  [ok] 合法 JSON")
        except Exception as e:
            print(f"  [!!] 不是合法 JSON: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
