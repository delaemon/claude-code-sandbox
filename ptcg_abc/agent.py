"""Heuristic agent for the PTCG AI Battle Challenge (cabt engine).

Kaggle submission interface: agent(obs) -> list[int]
  - first call: obs["select"] is None -> return the 60-card deck
  - after that: return indices into obs["select"]["option"]

Main-phase policy: evolve > bench basics > attach energy > attach tool >
play trainers > attack with the highest-damage affordable attack > end turn.
Sub-selects use a generic card-value score: pick high for gains (deck
searches, new active), low for costs (hand discards, energy payment).
"""

import json
import os

import carddb

# Placeholder deck bundled with the engine (Kyogre / Mega Abomasnow line).
DECK = (
    [721] * 2 + [722] * 4 + [723] * 4
    + [1092] + [1121] * 2 + [1145] * 2 + [1163] * 2
    + [1219] * 4 + [1227] * 4 + [1262] * 2
    + [3] * 33
)

# Decision weights. Defaults reproduce the hand-tuned heuristic exactly;
# train_selfplay.py optimizes this vector and loads weights_best.json.
WEIGHTS = {
    "evolve": 90.0,
    "bench": 80.0,
    "pokemon_attach": 78.0,
    "energy": 70.0,
    "energy_active": 5.0,
    "tool": 60.0,
    "ability": 55.0,
    "effect_ok": 55.0,
    "item": 50.0,
    "supporter": 45.0,
    "filler": 20.0,
    "ko_bonus": 500.0,
    "mill_min_deck": 8.0,
    "battler_hp": 1.0,
    "battler_dmg": 2.0,
    "active_energy": 40.0,
}

_weights_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weights_best.json")
if os.path.exists(_weights_path):
    with open(_weights_path) as _f:
        WEIGHTS.update(json.load(_f)["weights"])

OPT_NUMBER = 0
OPT_CARD = 3
OPT_ENERGY = 6
OPT_PLAY = 7
OPT_ATTACH = 8
OPT_EVOLVE = 9
OPT_ABILITY = 10
OPT_RETREAT = 12
OPT_ATTACK = 13
OPT_END_TURN = 14
OPT_EFFECT_OK = 15

# Ability guard: avoid re-picking the same ability option forever in one turn.
_ability_uses = {}


def can_pay(energy_types, cost):
    """Check a list of attached energy type ids against an attack cost."""
    pool = list(energy_types)
    for c in sorted(cost, reverse=True):  # typed costs first, 0 = colorless
        if c == 0:
            if not pool:
                return False
            pool.pop()
        elif c in pool:
            pool.remove(c)
        else:
            return False
    return True


def best_attack(pokemon):
    """(damage, attackId) of the strongest attack payable with attached energy."""
    c = carddb.card(pokemon["id"])
    if not c:
        return (0, None)
    best = (0, None)
    for aid in c["attacks"]:
        a = carddb.attack(aid)
        if a and can_pay(pokemon.get("energies") or [], a["energies"]):
            if a["damage"] >= best[0]:
                best = (a["damage"], aid)
    return best


def wants_energy(pokemon):
    """True if some attack of this pokemon is not yet payable."""
    c = carddb.card(pokemon["id"])
    if not c:
        return False
    energies = pokemon.get("energies") or []
    for aid in c["attacks"]:
        a = carddb.attack(aid)
        if a and not can_pay(energies, a["energies"]):
            return True
    return False


def _count_energy(entries, card_id=3):
    return sum(1 for e in entries or [] if e.get("id") == card_id)


def estimate_damage(attack_id, me, opp_active, my_active):
    """Expected damage of an attack, including known effect attacks."""
    a = carddb.attack(attack_id)
    if not a:
        return 0
    dmg = a["damage"]
    if attack_id == 1042:  # Kyogre Riptide: 20 x basic {W} in own discard
        dmg = 20 * _count_energy(me.get("discard"))
    elif attack_id == 1046:  # Mega Abomasnow Hammer-lanche: mill 6, 100 x {W} milled
        deck_count = me.get("deckCount", 0)
        if deck_count <= WEIGHTS["mill_min_deck"]:
            return -1  # deck-out risk outweighs the nuke
        seen = (
            _count_energy(me.get("hand"))
            + _count_energy(me.get("discard"))
            + sum(_count_energy(p.get("energyCards")) for p in
                  (me.get("active") or []) + (me.get("bench") or []))
        )
        density = max(0.0, min(1.0, (33 - seen) / max(deck_count, 1)))
        dmg = int(100 * 6 * density)
    # Weakness doubles damage.
    my_card = carddb.card(my_active["id"]) if my_active else None
    opp_card = carddb.card(opp_active["id"]) if opp_active else None
    if my_card and opp_card and opp_card.get("weakness") == my_card.get("pokemonType"):
        dmg *= 2
    return dmg


def card_value(card_id):
    """Generic usefulness score of a card for pick/discard decisions."""
    c = carddb.card(card_id)
    if not c:
        return 0
    if c["cardType"] == 0:  # pokemon: value scales with HP, evolutions high
        v = 50 + c["hp"] / 10
        if not c["basic"]:
            v += 20
        return v
    if c["cardType"] in (5, 6):
        return 30  # energy: useful but plentiful
    if c["cardType"] == 3:
        return 40  # supporter
    return 45  # item / tool / stadium


def battler_value(card_id):
    """How good a pokemon is as the next active."""
    c = carddb.card(card_id)
    if not c or c["cardType"] != 0:
        return 0
    dmg = max((carddb.attack_damage(a) for a in c["attacks"]), default=0)
    return WEIGHTS["battler_hp"] * c["hp"] + WEIGHTS["battler_dmg"] * dmg


def _pick_cards(sel, players, gain):
    """Generic sub-select: choose maxCount best (gain) or minCount worst (cost)."""
    opts = sel["option"]

    def score(o):
        cid = _option_card_id(o, players)
        v = card_value(cid) if cid is not None else 0
        return v if gain else -v

    order = sorted(range(len(opts)), key=lambda i: -score(opts[i]))
    count = sel["maxCount"] if gain else sel["minCount"]
    count = max(sel["minCount"], min(count, len(opts)))
    return order[:count]


def _option_card_id(o, players):
    """Resolve a type-3 option to a card id where the referenced zone is visible."""
    if o.get("type") != OPT_CARD:
        return None
    p = players[o["playerIndex"]]
    area, idx = o["area"], o["index"]
    zone = None
    if area == carddb.AREA_HAND:
        zone = p.get("hand")
    elif area == carddb.AREA_DISCARD:
        zone = p.get("discard")
    elif area == carddb.AREA_ACTIVE:
        zone = p.get("active")
    elif area == carddb.AREA_BENCH:
        zone = p.get("bench")
    if zone and idx < len(zone):
        entry = zone[idx]
        return entry.get("id")
    return None


def _in_play(players, you, area, index):
    p = players[you]
    zone = p["active"] if area == carddb.AREA_ACTIVE else p["bench"]
    if zone and index < len(zone):
        return zone[index]
    return None


def _main_phase(sel, cur):
    you = cur["yourIndex"]
    players = cur["players"]
    me = players[you]
    opp = players[1 - you]
    hand = me.get("hand") or []
    opts = sel["option"]

    def hand_card(i):
        return carddb.card(hand[i]["id"]) if i < len(hand) else None

    # Setup actions first (attacking ends the turn, so it always comes last).
    setup = []
    attacks = []
    for i, o in enumerate(opts):
        t = o["type"]
        s = None
        if t == OPT_EVOLVE:
            s = WEIGHTS["evolve"]
        elif t == OPT_PLAY:
            c = hand_card(o["index"])
            if c and c["cardType"] == 0:
                s = WEIGHTS["bench"]  # bench a basic
            elif c and c["cardType"] in (1, 4):
                s = WEIGHTS["item"]  # item / stadium
            elif c and c["cardType"] == 3:
                s = WEIGHTS["supporter"]  # supporter
        elif t == OPT_ATTACH:
            c = hand_card(o["index"])
            target = _in_play(players, you, o["inPlayArea"], o["inPlayIndex"])
            if c and c["cardType"] in (5, 6) and not cur["energyAttached"]:
                if target is not None and wants_energy(target):
                    s = WEIGHTS["energy"] + (WEIGHTS["energy_active"] if o["inPlayArea"] == carddb.AREA_ACTIVE else 0)
                else:
                    s = WEIGHTS["filler"]  # target already powered; low priority filler
            elif c and c["cardType"] == 2:
                s = WEIGHTS["tool"] if target is not None and not target.get("tools") else None
            elif c and c["cardType"] == 0:
                s = WEIGHTS["pokemon_attach"]  # pokemon placed via attach-style option (bench slot)
        elif t == OPT_ABILITY:
            key = (cur["turn"], o.get("area"), o.get("index"))
            if _ability_uses.get(key, 0) < 2:
                s = WEIGHTS["ability"]
        elif t == OPT_EFFECT_OK:
            s = WEIGHTS["effect_ok"]
        elif t == OPT_ATTACK:
            my_active = (me.get("active") or [None])[0]
            opp_active = (opp.get("active") or [None])[0]
            dmg = estimate_damage(o["attackId"], me, opp_active, my_active)
            hp_left = opp_active.get("hp", 9999) if opp_active else 9999
            if dmg >= 0:
                attacks.append((dmg + (WEIGHTS["ko_bonus"] if dmg >= hp_left else 0), i))
            continue
        if s is not None:
            setup.append((s, i, t, o))

    if setup:
        setup.sort(key=lambda x: -x[0])
        s, i, t, o = setup[0]
        if t == OPT_ABILITY:
            key = (cur["turn"], o.get("area"), o.get("index"))
            _ability_uses[key] = _ability_uses.get(key, 0) + 1
            if len(_ability_uses) > 500:
                _ability_uses.clear()
        return [i]
    if attacks:
        attacks.sort(key=lambda x: -x[0])
        best_score, best_i = attacks[0]
        if best_score > 0:
            return [best_i]
    # Nothing worthwhile: end turn if possible, else first option.
    for i, o in enumerate(opts):
        if o["type"] == OPT_END_TURN:
            return [i]
    return [0]


def agent(obs):
    if obs.get("select") is None:
        return list(DECK)

    sel = obs["select"]
    cur = obs["current"]
    players = cur["players"]
    stype, ctx = sel["type"], sel["context"]
    opts = sel["option"]

    if stype == 0:
        return _main_phase(sel, cur)

    # Choose a new active / setup pokemon: strongest battler, counting
    # already-attached energy for in-play candidates.
    if (stype, ctx) in ((1, 1), (1, 4)):
        def active_score(o):
            v = battler_value(_option_card_id(o, players) or 0)
            if o.get("area") in (carddb.AREA_ACTIVE, carddb.AREA_BENCH):
                entry = _in_play(players, o["playerIndex"], o["area"], o["index"])
                if entry:
                    v += WEIGHTS["active_energy"] * len(entry.get("energies") or [])
            return v

        order = sorted(range(len(opts)), key=lambda i: -active_score(opts[i]))
        return order[: max(1, sel["minCount"])]

    # Card picks: treat own-hand fixed-count picks as costs, the rest as gains.
    if stype == 1:
        own_hand = all(
            o.get("area") == carddb.AREA_HAND
            and o.get("playerIndex") == cur["yourIndex"]
            for o in opts
        )
        cost = own_hand and sel["minCount"] == sel["maxCount"]
        return _pick_cards(sel, players, gain=not cost)

    # Energy payment: pay the minimum.
    if stype == 4:
        return list(range(min(max(sel["minCount"], 1), len(opts))))

    # Numbers / coins / anything else: first legal choice(s).
    return list(range(max(sel["minCount"], 1)))


agents = {"heuristic": agent}
