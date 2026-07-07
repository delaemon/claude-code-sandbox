"""1-ply expected-outcome planner agent for the PTCG AI Battle Challenge.

Builds on the heuristic agent but replaces the three decisions that decide
games with model-based lookahead using the card DB as a transition model:

1. energy routing  — attach where the marginal expected damage is highest,
   so a benched attacker is charged while the active fights
2. attack choice   — expected effect damage, KO/prize value, weakness, and
   self-mill (deck-out) cost are traded off explicitly
3. next active     — promote the pokemon with the best immediate expected
   damage, not just the biggest HP stick

Interface identical to agent.agent(): planner(obs) -> list[int]
"""

import agent as H
import carddb


def _entry_attacks(entry):
    c = carddb.card(entry["id"])
    return c["attacks"] if c else []


def _exp_damage(attack_id, me, opp_active, my_entry, energies=None):
    """estimate_damage, but with an optional hypothetical energy loadout."""
    a = carddb.attack(attack_id)
    if not a:
        return -1
    pool = energies if energies is not None else (my_entry.get("energies") or [])
    if not H.can_pay(pool, a["energies"]):
        return -1
    return H.estimate_damage(attack_id, me, opp_active, my_entry)


def _best_exp_damage(entry, me, opp_active, energies=None):
    best = 0
    for aid in _entry_attacks(entry):
        d = _exp_damage(aid, me, opp_active, entry, energies)
        if d > best:
            best = d
    return best


def _prize_value(card_entry):
    c = carddb.card(card_entry["id"]) if card_entry else None
    if not c:
        return 1
    if c.get("megaEx"):
        return 3
    if c.get("ex"):
        return 2
    return 1


def _energy_route_score(o, cur):
    """Marginal expected damage from attaching one more energy to the target.

    Value = max(damage unlocked right now, progress toward a still-unpayable
    attack discounted by how many more attachments it needs). No positional
    bias: charging tomorrow's benched attacker routinely beats topping up the
    active (measured +5pt vs the heuristic over 400 mirror games).
    """
    you = cur["yourIndex"]
    players = cur["players"]
    me = players[you]
    opp_active = (players[1 - you].get("active") or [None])[0]
    target = H._in_play(players, you, o["inPlayArea"], o["inPlayIndex"])
    if target is None:
        return 0
    hand = me.get("hand") or []
    energy_card = carddb.card(hand[o["index"]]["id"]) if o["index"] < len(hand) else None
    etype = energy_card.get("energyType", 0) if energy_card else 0
    now = target.get("energies") or []
    before = _best_exp_damage(target, me, opp_active)
    after = _best_exp_damage(target, me, opp_active, list(now) + [etype])
    marginal = after - before
    progress = 0
    for aid in _entry_attacks(target):
        a = carddb.attack(aid)
        if a and not H.can_pay(now, a["energies"]):
            need = len(a["energies"]) - len(now)
            if need >= 1:
                progress = max(
                    progress,
                    H.estimate_damage(aid, me, opp_active, target) / (need + 1),
                )
    return max(marginal, progress)


def _attack_score(o, cur):
    you = cur["yourIndex"]
    players = cur["players"]
    me = players[you]
    my_active = (me.get("active") or [None])[0]
    opp_active = (players[1 - you].get("active") or [None])[0]
    dmg = H.estimate_damage(o["attackId"], me, opp_active, my_active)
    if dmg < 0:
        return -1
    hp_left = opp_active.get("hp", 9999) if opp_active else 9999
    score = float(dmg)
    if dmg >= hp_left:
        # KO: prizes now, and the overkill damage is wasted.
        score = hp_left + 300 * _prize_value(opp_active)
    if o["attackId"] == 1046:  # Hammer-lanche mills our own deck
        deck = me.get("deckCount", 60)
        score -= 60 if deck < 20 else 15
    return score


def planner(obs):
    if obs.get("select") is None:
        return list(H.DECK)

    sel = obs["select"]
    cur = obs["current"]
    players = cur["players"]
    stype, ctx = sel["type"], sel["context"]
    opts = sel["option"]

    if stype == 0:
        base = H._main_phase(sel, cur)
        i = base[0]
        t = opts[i]["type"]
        # Override the heuristic on the decisions the planner models better.
        if t == H.OPT_ATTACH and not cur["energyAttached"]:
            me = players[cur["yourIndex"]]
            hand = me.get("hand") or []
            energy_opts = []
            for j, o in enumerate(opts):
                if o["type"] != H.OPT_ATTACH or o["index"] >= len(hand):
                    continue
                c = carddb.card(hand[o["index"]]["id"])
                if c and c["cardType"] in (5, 6):
                    energy_opts.append((_energy_route_score(o, cur), j))
            if energy_opts and t == H.OPT_ATTACH:
                chosen = opts[i]
                c = carddb.card(hand[chosen["index"]]["id"]) if chosen["index"] < len(hand) else None
                if c and c["cardType"] in (5, 6):
                    energy_opts.sort(key=lambda x: -x[0])
                    return [energy_opts[0][1]]
        if t in (H.OPT_ATTACK, H.OPT_END_TURN):
            attacks = [(_attack_score(o, cur), j) for j, o in enumerate(opts)
                       if o["type"] == H.OPT_ATTACK]
            attacks = [(s, j) for s, j in attacks if s > 0]
            if attacks:
                attacks.sort(key=lambda x: -x[0])
                return [attacks[0][1]]
            for j, o in enumerate(opts):
                if o["type"] == H.OPT_END_TURN:
                    return [j]
        return base

    # New active: best immediate expected damage, then HP.
    if (stype, ctx) in ((1, 1), (1, 4)):
        you = cur["yourIndex"]
        me = players[you]
        opp_active = (players[1 - you].get("active") or [None])[0]

        def score(o):
            cid = H._option_card_id(o, players)
            entry = None
            if o.get("area") in (carddb.AREA_ACTIVE, carddb.AREA_BENCH):
                entry = H._in_play(players, o["playerIndex"], o["area"], o["index"])
            if entry is not None:
                return (3 * _best_exp_damage(entry, me, opp_active)
                        + 40 * len(entry.get("energies") or [])
                        + entry.get("hp", 0))
            return H.battler_value(cid or 0)

        order = sorted(range(len(opts)), key=lambda i: -score(opts[i]))
        return order[: max(1, sel["minCount"])]

    return H.agent(obs)


agents = {"planner": planner}
