"""Local evaluation harness: pit the heuristic agent against baselines.

Talks to the cabt engine directly (battle_start/battle_select) which is much
faster than the kaggle_environments runner. Alternates who plays first.

Usage:
    python evaluate.py --opponent random --games 50
    python evaluate.py --opponent first --games 50
"""

import argparse
import random
import sys
import time

from kaggle_environments.envs.cabt.cg.game import battle_start, battle_select, battle_finish

import agent as agent_mod


def random_agent(obs):
    sel = obs["select"]
    n = len(sel["option"])
    k = min(sel["maxCount"], n)
    lo = sel["minCount"]
    cnt = random.randint(lo, k) if lo < k else k
    return random.sample(range(n), cnt)


def first_agent(obs):
    sel = obs["select"]
    return list(range(min(max(sel["minCount"], 1), sel["maxCount"])))


BASELINES = {"random": random_agent, "first": first_agent, "self": agent_mod.agent}


def play_game(players, decks, max_steps=5000):
    """players: [fn, fn] taking the engine obs; returns winner index or -1."""
    obs, sd = battle_start(decks[0], decks[1])
    if sd.errorPlayer >= 0:
        raise RuntimeError(f"deck error for player {sd.errorPlayer}")
    try:
        for _ in range(max_steps):
            cur = obs["current"]
            if cur["result"] >= 0:
                r = cur["result"]
                return r if r in (0, 1) else -1
            you = cur["yourIndex"]
            picks = players[you]({"select": obs["select"], "current": cur,
                                  "logs": obs["logs"]})
            obs = battle_select(picks)
        return -1
    finally:
        battle_finish()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--opponent", choices=sorted(BASELINES), default="random")
    ap.add_argument("--games", type=int, default=50)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    random.seed(args.seed)
    opp = BASELINES[args.opponent]
    deck = list(agent_mod.DECK)

    wins = losses = draws = 0
    t0 = time.time()
    for g in range(args.games):
        me = g % 2  # alternate seats
        players = [None, None]
        players[me] = agent_mod.agent
        players[1 - me] = opp
        result = play_game(players, [deck, deck])
        if result == me:
            wins += 1
        elif result == 1 - me:
            losses += 1
        else:
            draws += 1
        print(f"game {g + 1}: {'W' if result == me else 'L' if result == 1 - me else 'D'}"
              f"  (as player {me})", file=sys.stderr)

    dt = time.time() - t0
    n = args.games
    print(f"\nvs {args.opponent}: {wins}W {losses}L {draws}D "
          f"-> win rate {wins / n:.1%} ({dt:.1f}s, {dt / n:.2f}s/game)")


if __name__ == "__main__":
    main()
