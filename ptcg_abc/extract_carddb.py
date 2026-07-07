"""Extract the full card / attack database from the cabt engine.

The native library bundled with kaggle-environments exports AllCard() and
AllAttack(), each returning a JSON string covering the whole card pool.
Writes data/cards.json and data/attacks.json next to this script.
"""

import ctypes
import json
import os


def main() -> None:
    from kaggle_environments.envs.cabt.cg.sim import lib

    lib.AllCard.restype = ctypes.c_char_p
    lib.AllAttack.restype = ctypes.c_char_p

    cards = json.loads(lib.AllCard().decode())
    attacks = json.loads(lib.AllAttack().decode())

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "cards.json"), "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=1)
    with open(os.path.join(out_dir, "attacks.json"), "w", encoding="utf-8") as f:
        json.dump(attacks, f, ensure_ascii=False, indent=1)
    print(f"cards: {len(cards)}, attacks: {len(attacks)} -> {out_dir}")


if __name__ == "__main__":
    main()
