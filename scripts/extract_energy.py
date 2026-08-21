#!/usr/bin/env python3
"""
extract_energy.py — 第二轮：补充每张卡的 energy_value（能量数值，蓝/绿圈，中下方）。

规则依据（WizWar_v2.1 规则书）：
- 施法能量基础值恒为 1（除非用能量卡提升），无需逐卡 OCR。
- 只有部分卡在中下方（lower-middle）有带数字的圆形/椭圆徽章，
  表示该卡可作为能量卡使用（蓝圈=提升移动/法术能量，绿圈=提升持续时间）。
- Energy / Flash Energy / Random Energy 卡的数字印在中央插图，文件名即权威值。

提取策略：
- 文件名含 Energy N / Flash Energy N / Random Energy +N → 直接取 N（权威）。
- 其余卡 → 裁剪底部 30% 放大，问中下方圆圈里的数字；无则 0。

结果写回 work/processed/cards/...json 的 energy_value 字段，并重新生成汇总。

用法: python extract_energy.py [--input work/processed/cards]
"""
import argparse
import base64
import io
import json
import re
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from PIL import Image

VISION_URL = "http://localhost:6999/v1/vision"
PROMPT = (
    "这是Wiz-War卡牌的底部区域。有些卡在此区域的中下方有一个带数字的"
    "圆形或椭圆形徽章（能量数值）。请仔细查找该区域内所有圆形/椭圆徽章，"
    "如果某个徽章内有数字，回答那个数字；如果所有徽章都没有数字，回答\"无\"。"
    "只回答数字或\"无\"。"
)


def filename_energy(rel: str):
    """文件名自证：Energy 4 / Energy 4 2 / Flash Energy 5 / Random Energy +2 → 数值。"""
    n = rel.split("/")[-1].replace(".png", "")
    n = re.sub(r"\s*[0-9]+$", "", n)  # 去掉重复份后缀 " 2"/" 3"
    m = re.match(r"(?:Flash )?Energy (\d+)$", n)
    if m:
        return int(m.group(1))
    m = re.match(r"Random Energy \+(\d+)$", n)
    if m:
        return int(m.group(1))
    return None


def crop_bottom(img: Image.Image):
    W, H = img.size
    crop = img.crop((0, int(H * 0.70), W, H))
    return crop.resize((int(crop.width * 2), int(crop.height * 2)), Image.LANCZOS)


def call_energy(b64_image: str) -> str:
    payload = json.dumps({
        "image": b64_image,
        "prompt": PROMPT,
        "max_tokens": 30,
        "temperature": 0.0,
        "thinking": False,
    }).encode()
    req = urllib.request.Request(VISION_URL, data=payload, headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=240).read())
    return r["text"]


def parse_value(text: str):
    m = re.search(r"\b([1-9])\b", text)
    return int(m.group(1)) if m else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="work/processed/cards")
    args = ap.parse_args()
    in_dir = Path(args.input)
    img_root = in_dir.parent.parent / "cards"
    files = sorted(in_dir.rglob("*.png.json"))
    print(f"共 {len(files)} 张卡待处理", flush=True)

    ok, fail, skip = 0, 0, 0
    for idx, f in enumerate(files, 1):
        data = json.loads(f.read_text(encoding="utf-8"))
        if data.get("energy_value") is not None and data.get("energy_method") == "final":
            skip += 1
            continue

        known = filename_energy(data["file"])
        if known is not None:
            val, raw, method = known, f"filename:{known}", "filename"
        else:
            try:
                img = Image.open(img_root / data["file"])
                buf = io.BytesIO()
                crop_bottom(img).save(buf, format="PNG")
                raw = call_energy(base64.b64encode(buf.getvalue()).decode())
                val = parse_value(raw)
                method = "bottom-crop"
            except Exception as e:
                fail += 1
                print(f"[{idx}/{len(files)}] FAIL {data['file']}: {e}", flush=True)
                time.sleep(2)
                continue

        data["energy_value"] = val
        data["energy_raw"] = raw.strip()
        data["energy_method"] = method
        data["energy_at"] = datetime.now().isoformat(timespec="seconds")
        f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        ok += 1
        if idx % 30 == 0:
            print(f"[{idx}/{len(files)}] ...({val})", flush=True)

    entries = [json.loads(f.read_text(encoding="utf-8")) for f in in_dir.rglob("*.png.json")]
    (in_dir.parent / "cards.json").write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"完成: 成功 {ok}, 失败 {fail}, 跳过 {skip}", flush=True)


if __name__ == "__main__":
    main()
