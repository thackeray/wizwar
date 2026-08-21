#!/usr/bin/env python3
"""
gen_cards.py — Generate card JSON data files from OCR results + components list.

Maps each card to its school, type, range, duration, target, and effect.
Uses OCR text for display; infers effect ops from card name/type.
"""
import json
import re
from pathlib import Path

CARDS_JSON = Path("work/processed/cards.json")
OUT_DIR = Path("src/core/cards/data")

# School mapping: directory name -> school id
SCHOOL_MAP = {
    "Cantrip": "cantrip",
    "Alchemy": "alchemy",
    "Conjuring": "conjuring",
    "Elemental": "elemental",
    "Mentalism": "mentalism",
    "Mutation": "mutation",
    "Thaumaturgy": "thaumaturgy",
}

# Card type inference by name keywords
def infer_type(name: str) -> str:
    n = name.lower()
    if "energy" in n:
        return "energy"
    if any(k in n for k in ["shield", "negate", "dispel", "absorb", "ward", "glue", "fog", "mist"]):
        return "counter-spell" if "negate" in n or "absorb" in n else "neutral-spell"
    if any(k in n for k in ["form", "body", "projection"]):
        return "transform"
    if any(k in n for k in ["stone", "rock", "dagger", "blade", "key", "powder", "trap", "bush", "cloud", "solvent", "tacks"]):
        return "item"
    if any(k in n for k in ["bolt", "ball", "burn", "force", "thrust", "storm", "dart", "flood", "wall of fire", "spikes", "zot", "ka-bong", "backlash", "globe", "yoink", "heave", "mad dash", "stretch", "gravity", "pass through", "seal", "rotate", "create", "destroy", "pick lock", "drop object", "around the corner", "full shield", "swap", "teleport", "share life", "thought steal", "pain link", "meditate", "shatter", "anti-anti", "slow death", "invisible", "fire clock", "windrider", "stone block", "stone dead", "fool's gold", "add", "homunculus", "bloodshard", "brainstone", "lifestone", "mightstone", "null powder", "powerstone", "speedstone", "spellstone", "universal solvent", "visionstone", "acid bath", "featherweight", "disease", "gnome", "adrenaline", "big man", "extra arms", "golem", "slime", "strength", "wallivore", "werewolf", "wall of earth", "fire darts", "lightning", "waterbolt", "brain burn", "mental force", "psychic storm", "astral", "booby", "dust cloud", "rosebush", "thornbush", "handful", "create door", "create wall", "destroy wall", "wall of fire", "fog", "mist body", "stone block", "stone spikes", "fire clock"]):
        return "attack-spell"
    return "neutral-spell"

def infer_range(name: str) -> str:
    n = name.lower()
    if any(k in n for k in ["self", "caster", "meditate", "adrenaline", "strength", "featherweight", "big man", "golem", "slime", "gnome", "werewolf", "mist body", "astral", "invisible", "share life", "pain link", "lifestone", "bloodshard", "fool's gold", "add", "powerstone", "speedstone", "spellstone", "visionstone", "mightstone", "brainstone", "null powder", "universal solvent", "homunculus", "stone dead", "slow death", "disease"]):
        return "caster"
    if any(k in n for k in ["punch", "adjacent"]):
        return "adjacent"
    return "los"

def infer_target(name: str) -> str:
    n = name.lower()
    if any(k in n for k in ["wall", "door", "lock", "seal", "rotate", "create", "destroy"]):
        return "wall" if "wall" in n else "door"
    if any(k in n for k in ["object", "drop", "pick"]):
        return "object"
    if any(k in n for k in ["treasure"]):
        return "treasure"
    if any(k in n for k in ["self", "caster", "meditate", "adrenaline", "strength", "featherweight", "big man", "golem", "slime", "gnome", "werewolf", "mist body", "astral", "invisible", "share life", "pain link", "lifestone", "bloodshard", "fool's gold", "add", "powerstone", "speedstone", "spellstone", "visionstone", "mightstone", "brainstone", "null powder", "universal solvent", "homunculus", "stone dead", "slow death", "disease"]):
        return "self"
    if any(k in n for k in ["wizard", "bolt", "ball", "burn", "force", "thrust", "storm", "dart", "flood", "zot", "ka-bong", "backlash", "globe", "yoink", "heave", "mad dash", "stretch", "gravity", "swap", "teleport", "thought steal", "acid bath", "brain burn", "mental force", "psychic storm"]):
        return "wizard"
    return "square"

def infer_effect(name: str, card_type: str) -> dict:
    n = name.lower()
    if card_type == "energy":
        return {"op": "energy"}
    if card_type == "transform":
        return {"op": "transform"}
    if card_type == "item":
        return {"op": "item"}
    if "damage" in n or any(k in n for k in ["bolt", "ball", "burn", "force", "thrust", "storm", "dart", "flood", "zot", "ka-bong", "backlash", "globe", "yoink", "heave", "mad dash", "stretch", "gravity", "acid bath", "brain burn", "mental force", "psychic storm", "stone spikes", "stone dead", "slow death", "disease", "fire clock", "wall of fire"]):
        return {"op": "damage", "amount": 2, "kind": "magical"}
    if any(k in n for k in ["shield", "ward", "glue", "fog", "mist"]):
        return {"op": "shield"}
    if any(k in n for k in ["negate", "absorb", "dispel"]):
        return {"op": "negate"}
    if any(k in n for k in ["create wall", "create door"]):
        return {"op": "create-object", "object": "wall"}
    if any(k in n for k in ["destroy wall"]):
        return {"op": "destroy-object"}
    if any(k in n for k in ["teleport"]):
        return {"op": "teleport"}
    if any(k in n for k in ["stun", "languor"]):
        return {"op": "stun"}
    if any(k in n for k in ["draw"]):
        return {"op": "draw", "count": 1}
    if any(k in n for k in ["steal"]):
        return {"op": "steal-treasure"}
    if any(k in n for k in ["swap"]):
        return {"op": "swap-positions"}
    if any(k in n for k in ["share life"]):
        return {"op": "share-life"}
    if any(k in n for k in ["rotate"]):
        return {"op": "rotate-sector"}
    if any(k in n for k in ["seal"]):
        return {"op": "seal-door"}
    if any(k in n for k in ["pick lock"]):
        return {"op": "pick-lock"}
    if any(k in n for k in ["drop object"]):
        return {"op": "drop-object"}
    return {"op": "no-op"}

def clean_name(name: str) -> str:
    # Remove duplicate suffixes like " 2", " 3"
    return re.sub(r"\s+\d+$", "", name).strip()

def main():
    data = json.loads(CARDS_JSON.read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Group cards by school
    by_school = {}
    for c in data:
        parts = c["file"].split("/")
        if len(parts) < 2:
            continue
        school_dir = parts[0]
        if school_dir not in SCHOOL_MAP:
            continue
        school = SCHOOL_MAP[school_dir]
        name = clean_name(parts[1].replace(".png", ""))
        by_school.setdefault(school, []).append((name, c))

    # Generate card files
    for school, cards in by_school.items():
        card_defs = []
        seen_ids = set()
        for name, c in cards:
            # Create unique id (prefix with school to avoid cross-school collisions)
            base_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            card_id = f"{school}-{base_id}"
            counter = 2
            while card_id in seen_ids:
                card_id = f"{school}-{base_id}-{counter}"
                counter += 1
            seen_ids.add(card_id)

            card_type = infer_type(name)
            card_def = {
                "id": card_id,
                "name": name,
                "school": school,
                "type": card_type,
                "energy": 1,
                "range": infer_range(name),
                "duration": "instant" if card_type in ["attack-spell", "item"] else "temporary",
                "target": infer_target(name),
                "energyValue": c.get("energy_value", 0),
                "text": c.get("ocr", "").replace("\n", " ").strip(),
                "effect": infer_effect(name, card_type),
            }
            card_defs.append(card_def)

        out_file = OUT_DIR / f"{school}.json"
        out_file.write_text(json.dumps(card_defs, indent=2, ensure_ascii=False))
        print(f"{school}: {len(card_defs)} cards -> {out_file}")

if __name__ == "__main__":
    main()