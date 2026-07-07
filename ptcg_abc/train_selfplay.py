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


def _first_opponent(obs):
    sel = obs["select"]
    return list(range(min(max(sel["minCount"], 1), sel["maxCount"])))


def play_pair(w_a, w_b, games, rng, opponent_fn=None):
    """Win rate of weights w_a vs weights w_b (or vs opponent_fn), alternating seats."""
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
                you = cur["yourIndex"]
                o = {"select": obs["select"], "current": cur, "logs": obs["logs"]}
                if you != seat_a and opponent_fn is not None:
                    picks = opponent_fn(o)
                else:
                    agent_mod.WEIGHTS = weights[you]
                    picks = agent_mod.agent(o)
                obs = battle_select(picks)
        finally:
            battle_finish()
        if cur["result"] == seat_a:
            wins += 1
    return wins / games


def fitness(w, champion, games, rng):
    """Blend mirror strength with generalization vs the 'first' baseline.

    Pure mirror fitness overfits: a run that beat the defaults 52.8% in the
    mirror dropped from 68% to 58% against 'first'."""
    mirror = play_pair(w, champion, games // 2, rng)
    vs_first = play_pair(w, None, games // 2, rng, opponent_fn=_first_opponent)
    return 0.5 * mirror + 0.5 * vs_first


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
    champ_first = play_pair(champion, None, args.games, rng, opponent_fn=_first_opponent)
    default_first = champ_first
    print(f"defaults vs first: {champ_first:.1%}")

    promotions = 0
    history = []
    for it in range(args.iters):
        cand = mutate(champion, rng)
        # Blended score: mirror strength + generalization vs 'first'.
        # The champion's own score is 0.5 (mirror vs itself) + champ_first.
        mirror = play_pair(cand, champion, args.games // 2, rng)
        cand_first = play_pair(cand, None, args.games // 2, rng,
                               opponent_fn=_first_opponent)
        accepted = (mirror + cand_first) > (0.5 + champ_first) + args.margin
        anchor = None
        if accepted:
            # Anti-drift anchor: promotions must also hold up against the
            # original defaults (a 3pt-margin run without this gate drifted
            # to 47.2% vs defaults after 6 noise promotions).
            anchor = play_pair(cand, defaults, args.games // 2, rng)
            accepted = anchor >= 0.5
        if accepted:
            champion = cand
            champ_first = play_pair(champion, None, args.games, rng,
                                    opponent_fn=_first_opponent)
            promotions += 1
        anchor_s = f" anchor={anchor:.1%}" if anchor is not None else ""
        print(f"iter {it}: mirror={mirror:.1%} first={cand_first:.1%}{anchor_s} "
              f"{'PROMOTE' if accepted else ''}", flush=True)
        history.append({"iter": it, "mirror": mirror, "first": cand_first,
                        "anchor": anchor, "accepted": accepted,
                        "weights": {k: round(v, 3) for k, v in cand.items()}})

    final_vs_default = play_pair(champion, defaults, args.games * 2, rng)
    final_vs_first = play_pair(champion, None, args.games * 2, rng,
                               opponent_fn=_first_opponent)
    print(f"\npromotions: {promotions}")
    print(f"champion vs default weights ({args.games * 2} games): {final_vs_default:.1%}")
    print(f"champion vs first ({args.games * 2} games): {final_vs_first:.1%} "
          f"(defaults: {default_first:.1%})")
    print("champion:", json.dumps({k: round(v, 3) for k, v in champion.items()}))
    result = {"weights": champion, "vs_default": final_vs_default,
              "vs_first": final_vs_first, "default_vs_first": default_first,
              "promotions": promotions, "history": history}
    # Only ship weights that don't regress either axis on the big final
    # sample; agent.py auto-loads weights_best.json, so a noise champion
    # would silently degrade the agent.
    if (champion != defaults and final_vs_default >= 0.51
            and final_vs_first >= default_first):
        with open("weights_best.json", "w") as f:
            json.dump(result, f, indent=1)
        print("saved weights_best.json")
    else:
        with open("selfplay_run.json", "w") as f:
            json.dump(result, f, indent=1)
        print("champion did not clearly beat defaults; kept defaults (log: selfplay_run.json)")
    agent_mod.WEIGHTS = defaults


if __name__ == "__main__":
    main()
