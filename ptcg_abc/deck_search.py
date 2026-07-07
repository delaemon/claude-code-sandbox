"""Hill-climbing deck search for the PTCG AI Battle Challenge.

Searches over copy counts of the default deck's card pool (the only cards we
know are tournament-legal). Fitness = win rate of the heuristic agent with the
candidate deck against the same agent piloting the default deck, alternating
seats. Fitness is noisy, so candidates must beat the incumbent by a margin.

Usage:
    python deck_search.py --games 200 --iters 80 --seed 0
"""

import argparse
import json
import random

from kaggle_environments.envs.cabt.cg.game import battle_start, battle_select, battle_finish

import agent as agent_mod

# card id -> max copies (Secret Box is an ACE SPEC: max 1; basic energy unlimited)
POOL = {
    721: 4,   # Kyogre
    722: 4,   # Snover
    723: 4,   # Mega Abomasnow ex
    1092: 1,  # Secret Box (ACE SPEC)
    1121: 4,  # Ultra Ball
    1145: 4,  # Mega Signal
    1163: 4,  # Powerglass
    1219: 4,  # Team Rocket's Petrel
    1227: 4,  # Lillie's Determination
    1262: 4,  # Surfing Beach
    3: 60,    # Basic {W} Energy
}

DEFAULT_COUNTS = {
    721: 2, 722: 4, 723: 4, 1092: 1, 1121: 2, 1145: 2,
    1163: 2, 1219: 4, 1227: 4, 1262: 2, 3: 33,
}


def to_deck(counts):
    deck = []
    for cid, n in sorted(counts.items()):
        deck += [cid] * n
    return deck


def play(my_deck, opp_deck, my_seat, max_steps=5000):
    decks = [None, None]
    decks[my_seat] = list(my_deck)
    decks[1 - my_seat] = list(opp_deck)
    obs, sd = battle_start(decks[0], decks[1])
    if sd.errorPlayer >= 0:
        battle_finish()
        return -2  # invalid deck
    try:
        for _ in range(max_steps):
            cur = obs["current"]
            if cur["result"] >= 0:
                return cur["result"]
            picks = agent_mod.agent(
                {"select": obs["select"], "current": cur, "logs": obs["logs"]})
            obs = battle_select(picks)
        return -1
    finally:
        battle_finish()


def fitness(counts, games):
    deck = to_deck(counts)
    base = to_deck(DEFAULT_COUNTS)
    wins = 0
    for g in range(games):
        seat = g % 2
        r = play(deck, base, seat)
        if r == -2:
            return 0.0
        if r == seat:
            wins += 1
    return wins / games


def neighbor(counts, rng):
    """Move one copy from one card to another, respecting max counts."""
    c = dict(counts)
    downs = [cid for cid, n in c.items() if n > 0]
    ups = [cid for cid, n in c.items() if n < POOL[cid]]
    while True:
        a = rng.choice(downs)
        b = rng.choice(ups)
        if a != b:
            break
    c[a] -= 1
    c[b] += 1
    # keep at least a playable count of basics (Kyogre + Snover)
    if c[721] + c[722] < 4:
        return None
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--iters", type=int, default=80)
    ap.add_argument("--margin", type=float, default=0.03)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    random.seed(args.seed)

    best = dict(DEFAULT_COUNTS)
    best_fit = fitness(best, args.games)  # ~0.5 by construction (mirror)
    print(f"default vs default: {best_fit:.1%}")

    history = []
    for it in range(args.iters):
        cand = neighbor(best, rng)
        if cand is None:
            continue
        fit = fitness(cand, args.games)
        diff = {cid: cand[cid] - DEFAULT_COUNTS[cid]
                for cid in cand if cand[cid] != DEFAULT_COUNTS[cid]}
        accepted = fit > best_fit + args.margin
        print(f"iter {it}: fit={fit:.1%} diff={diff} {'ACCEPT' if accepted else ''}")
        history.append({"iter": it, "fit": fit, "counts": cand, "accepted": accepted})
        if accepted:
            best, best_fit = cand, fit

    # Re-measure the final deck with a bigger sample.
    final_fit = fitness(best, args.games * 3)
    print(f"\nbest deck vs default ({args.games * 3} games): {final_fit:.1%}")
    print("counts:", json.dumps(best))
    with open("deck_search_result.json", "w") as f:
        json.dump({"best": best, "fitness": final_fit, "history": history}, f, indent=1)


if __name__ == "__main__":
    main()
