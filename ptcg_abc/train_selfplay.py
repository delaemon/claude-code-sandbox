"""Self-play weight optimization for the heuristic agent ((1+1)-ES).

The champion starts from agent.WEIGHTS (the hand-tuned defaults). Each
iteration mutates the champion's weights log-normally, plays candidate vs
champion head-to-head (seat-alternating), and promotes the candidate only if
it wins above a noise margin. This is plain evolutionary self-play: the
opponent improves whenever the champion is replaced.

Outputs weights_best.json, which agent.py picks up automatically on import.

Usage:
    python train_selfplay.py --games 300 --iters 60 --seed 0
"""

import argparse
import json
import math
import random

from kaggle_environments.envs.cabt.cg.game import battle_start, battle_select, battle_finish

import agent as agent_mod


def play_pair(w_a, w_b, games, rng):
    """Win rate of weights w_a vs weights w_b, alternating seats."""
    wins = 0
    for g in range(games):
        seat_a = g % 2
        weights = [None, None]
        weights[seat_a] = w_a
        weights[1 - seat_a] = w_b
        obs, sd = battle_start(list(agent_mod.DECK), list(agent_mod.DECK))
        try:
            for _ in range(5000):
                cur = obs["current"]
                if cur["result"] >= 0:
                    break
                agent_mod.WEIGHTS = weights[cur["yourIndex"]]
                picks = agent_mod.agent(
                    {"select": obs["select"], "current": cur, "logs": obs["logs"]})
                obs = battle_select(picks)
        finally:
            battle_finish()
        if cur["result"] == seat_a:
            wins += 1
    return wins / games


def mutate(weights, rng, rate=0.4, sigma=0.35):
    w = dict(weights)
    changed = False
    for k in w:
        if rng.random() < rate:
            w[k] = w[k] * math.exp(rng.gauss(0, sigma))
            changed = True
    if not changed:
        k = rng.choice(list(w))
        w[k] = w[k] * math.exp(rng.gauss(0, sigma))
    return w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=300)
    ap.add_argument("--iters", type=int, default=60)
    ap.add_argument("--margin", type=float, default=0.03)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    random.seed(args.seed)

    defaults = dict(agent_mod.WEIGHTS)
    champion = dict(defaults)
    promotions = 0
    history = []
    for it in range(args.iters):
        cand = mutate(champion, rng)
        fit = play_pair(cand, champion, args.games, rng)
        accepted = fit > 0.5 + args.margin
        if accepted:
            champion = cand
            promotions += 1
        diff = {k: round(cand[k], 1) for k in cand if abs(cand[k] - champion.get(k, cand[k])) > 1e-9 or accepted}
        print(f"iter {it}: fit={fit:.1%} {'PROMOTE' if accepted else ''}", flush=True)
        history.append({"iter": it, "fit": fit, "accepted": accepted,
                        "weights": {k: round(v, 3) for k, v in cand.items()}})

    final_vs_default = play_pair(champion, defaults, args.games * 2, rng)
    print(f"\npromotions: {promotions}")
    print(f"champion vs default weights ({args.games * 2} games): {final_vs_default:.1%}")
    print("champion:", json.dumps({k: round(v, 3) for k, v in champion.items()}))
    with open("weights_best.json", "w") as f:
        json.dump({"weights": champion, "vs_default": final_vs_default,
                   "promotions": promotions, "history": history}, f, indent=1)
    agent_mod.WEIGHTS = defaults


if __name__ == "__main__":
    main()
