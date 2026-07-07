"""Card / attack database helpers for the cabt engine.

Loads the DB directly from the engine (AllCard/AllAttack exports) so it works
both locally and inside the Kaggle runner, with data/*.json as a fallback.
"""

import ctypes
import json
import os

CARD_TYPE = {
    0: "pokemon",
    1: "item",
    2: "tool",
    3: "supporter",
    4: "stadium",
    5: "basic_energy",
    6: "special_energy",
}

# Areas used in options / logs.
AREA_DECK = 1
AREA_HAND = 2
AREA_DISCARD = 3
AREA_ACTIVE = 4
AREA_BENCH = 5
AREA_PRIZE = 6
AREA_STADIUM = 7

_cards = None
_attacks = None


def _load():
    global _cards, _attacks
    if _cards is not None:
        return
    try:
        from kaggle_environments.envs.cabt.cg.sim import lib

        lib.AllCard.restype = ctypes.c_char_p
        lib.AllAttack.restype = ctypes.c_char_p
        _cards = {c["cardId"]: c for c in json.loads(lib.AllCard().decode())}
        _attacks = {a["attackId"]: a for a in json.loads(lib.AllAttack().decode())}
    except Exception:
        base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
        with open(os.path.join(base, "cards.json"), encoding="utf-8") as f:
            _cards = {c["cardId"]: c for c in json.load(f)}
        with open(os.path.join(base, "attacks.json"), encoding="utf-8") as f:
            _attacks = {a["attackId"]: a for a in json.load(f)}


def card(card_id):
    _load()
    return _cards.get(card_id)


def attack(attack_id):
    _load()
    return _attacks.get(attack_id)


def all_cards():
    _load()
    return _cards


def is_pokemon(card_id):
    c = card(card_id)
    return c is not None and c["cardType"] == 0


def is_energy(card_id):
    c = card(card_id)
    return c is not None and c["cardType"] in (5, 6)


def is_basic_pokemon(card_id):
    c = card(card_id)
    return c is not None and c["cardType"] == 0 and c["basic"]


def attack_damage(attack_id):
    a = attack(attack_id)
    return a["damage"] if a else 0


def attack_cost(attack_id):
    a = attack(attack_id)
    return len(a["energies"]) if a else 0
