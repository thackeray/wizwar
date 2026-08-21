#!/usr/bin/env python3
"""
preprocess.py — 用本地视觉服务（Qwen3-VL-8B，端口 6999）对图片做预处理：
  1) 尺寸提取（PIL）
  2) OCR（7B 视觉模型逐行读文字）
  3) 中文视觉描述

用途：主工作模型没有视觉能力，把图片抽成结构化文本（OCR+描述）供其直接消费。

用法:
  python preprocess.py --kind cards   [--input work/cards]  [--out work/processed]
  python preprocess.py --kind boards  [--input work/boards] [--out work/processed]
  python preprocess.py --kind cards --limit 5   # 试跑前 N 张

断点续跑：已生成输出的图片自动跳过；失败重试 3 次。
输出：每图一个 <out>/<kind>/<相对路径>.json，以及 <out>/<kind>.json 汇总。
"""
import argparse
import base64
import json
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from PIL import Image

VISION_URL = "http://localhost:6999/v1/vision"
MAX_TOKENS = 700
RETRIES = 3

CARD_PROMPT = """这是 Wiz-War 桌游卡牌扫描图。请按下面格式输出，不要推理过程，只给结果：
【OCR】逐行列出卡面上所有文字（含卡名、规则文本、字母符号），按从上到下顺序，原文输出。
【DESC】用中文描述卡牌视觉：卡名、学派图标/颜色、能量数值位置、文字框布局、插图内容、边框风格。"""

BOARD_PROMPT = """这是 Wiz-War 桌游的棋盘扇区图。请按下面格式输出，不要推理过程，只给结果：
【OCR】逐行列出图上所有文字标签（按从上到下、从左到右），没有文字就写"无"。
【DESC】用中文描述：扇区颜色、正面还是背面、整体布局（网格/房间/走廊/中央区域）、图中的标记（传送门/宝藏/家/门/墙/裂缝等）、插图场景、边框风格。"""


def call_vision(b64_image: str, prompt: str) -> str:
    payload = json.dumps({
        "image": b64_image,
        "prompt": prompt,
        "max_tokens": MAX_TOKENS,
        "temperature": 0.0,          # 贪心，确定性、更快
        "thinking": False,           # 预置闭合 think 块，跳过推理
    }).encode()
    req = urllib.request.Request(
        VISION_URL, data=payload, headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=240).read())
    return r["text"]


def split_sections(text: str):
    """从模型输出里切出 【OCR】 和 【DESC】 两段，找不到的置空。"""
    ocr, desc = "", ""
    i_ocr = text.find("【OCR】")
    i_desc = text.find("【DESC】")
    if i_ocr >= 0:
        ocr = text[i_ocr + len("【OCR】"):]
        if i_desc > i_ocr:
            ocr = ocr[: i_desc - (i_ocr + len("【OCR】"))]
        ocr = ocr.strip()
    if i_desc >= 0:
        desc = text[i_desc + len("【DESC】"):].strip()
    return ocr, desc


def process_image(img_path: Path, rel_name: str, prompt: str) -> dict:
    with Image.open(img_path) as im:
        width, height = im.size
    with open(img_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    last_err = None
    for attempt in range(1, RETRIES + 1):
        try:
            t0 = time.time()
            raw = call_vision(b64, prompt)
            ocr, desc = split_sections(raw)
            return {
                "file": rel_name,
                "width": width,
                "height": height,
                "ocr": ocr,
                "description": desc,
                "raw_response": raw,
                "elapsed_s": round(time.time() - t0, 1),
                "processed_at": datetime.now().isoformat(timespec="seconds"),
            }
        except Exception as e:
            last_err = e
            time.sleep(3 * attempt)
    return {"file": rel_name, "width": width, "height": height,
            "error": str(last_err), "processed_at": datetime.now().isoformat(timespec="seconds")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", required=True, choices=["cards", "boards"])
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default="work/processed")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 张（试跑用）")
    args = ap.parse_args()

    in_dir = Path(args.input)
    out_dir = Path(args.out) / args.kind
    out_dir.mkdir(parents=True, exist_ok=True)

    prompt = CARD_PROMPT if args.kind == "cards" else BOARD_PROMPT
    images = sorted(p for p in in_dir.rglob("*.png") if p.is_file())
    print(f"[{args.kind}] 共 {len(images)} 张图，输出目录 {out_dir}", flush=True)

    ok, fail, skip = 0, 0, 0
    for idx, img in enumerate(images, 1):
        rel = img.relative_to(in_dir).as_posix()
        out_file = out_dir / (rel + ".json")
        if out_file.exists():
            skip += 1
            continue
        if args.limit and (idx - skip) > args.limit:
            break
        result = process_image(img, rel, prompt)
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        if "error" in result:
            fail += 1
            print(f"[{idx}/{len(images)}] FAIL {rel}: {result['error']}", flush=True)
        else:
            ok += 1
            print(f"[{idx}/{len(images)}] OK {rel} ({result['elapsed_s']}s)", flush=True)

    # 汇总
    entries = []
    for f in sorted(out_dir.rglob("*.json")):
        if f.name.endswith(".json"):
            entries.append(json.loads(f.read_text(encoding="utf-8")))
    manifest = out_dir.parent / f"{args.kind}.json"
    manifest.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[{args.kind}] 完成: 成功 {ok}，失败 {fail}，跳过 {skip}；汇总 {manifest}", flush=True)


if __name__ == "__main__":
    main()
