"""
論文 arXiv:2601.10904「ARC Prize 2025: Technical Report」の中心テーマ
=====================================================================
「refinement loop(反復改良ループ)」を体感するデモ。

論文 3.1.1 節「Evolutionary Program Synthesis(進化的プログラム合成)」より:

    Both approaches implement a two-phase refinement process.
    First, an exploration phase generates many candidate solutions.
    Second, a verification phase analyzes these programs to produce
    a feedback signal. This cycle repeats per task until the resulting
    program is fully refined and provides accurate answers for all
    training input/output pairs.

つまり:
    1. 探索フェーズ   … 候補プログラムをたくさん生成する(変異)
    2. 検証フェーズ   … デモペアで採点してフィードバック信号を得る
    3. このループをタスクごとに、全デモペアに正解するまで回す

これは J. Berman(自然言語プログラムを進化させる)や E. Pang(Python
プログラムを進化させる)のアプローチの骨格そのもの。本デモでは LLM の
代わりにランダム変異を使うが、ループの構造は同一である。

依存ライブラリなし・純 Python。実行:
    python3 refinement_loop_demo.py
"""

from __future__ import annotations

import random

Grid = list[list[int]]  # ARC のグリッド: 0〜9 の整数値を持つ 2 次元配列

# ---------------------------------------------------------------------------
# 1. DSL(ドメイン特化言語)のプリミティブ演算
#    「プログラム」= プリミティブを並べた列。ARC の多くの手法(Pang 等)は
#    こうしたグリッド変換の合成としてタスクの規則を表現する。
# ---------------------------------------------------------------------------


def flip_h(g: Grid) -> Grid:  # 左右反転
    return [row[::-1] for row in g]


def flip_v(g: Grid) -> Grid:  # 上下反転
    return g[::-1]


def rot90(g: Grid) -> Grid:  # 時計回りに90度回転
    return [list(row) for row in zip(*g[::-1])]


def transpose(g: Grid) -> Grid:  # 転置
    return [list(row) for row in zip(*g)]


def make_recolor(a: int, b: int):
    """色 a と色 b を入れ替える演算を返す(パラメータ付きプリミティブ)。"""

    def recolor(g: Grid) -> Grid:
        swap = {a: b, b: a}
        return [[swap.get(c, c) for c in row] for row in g]

    recolor.__name__ = f"recolor({a}<->{b})"
    return recolor


PRIMITIVES = [flip_h, flip_v, rot90, transpose] + [
    make_recolor(a, b) for a in range(4) for b in range(a + 1, 4)
]


def run_program(program: list, g: Grid) -> Grid:
    """プログラム(演算の列)をグリッドに順に適用する。"""
    for op in program:
        g = op(g)
    return g


def show_program(program: list) -> str:
    return " -> ".join(op.__name__ for op in program) or "(何もしない)"


# ---------------------------------------------------------------------------
# 2. 検証フェーズ: フィードバック信号(フィットネス)の計算
#    論文の言う "a feedback signal" にあたる。完全一致だけでなくセル単位の
#    部分点を与えることで、探索が正解に「近づく」方向を検出できる。
# ---------------------------------------------------------------------------


def fitness(program: list, demos: list[tuple[Grid, Grid]]) -> float:
    """全デモペアに対する平均セル一致率(0.0〜1.0)。形が違えば 0。"""
    total = 0.0
    for inp, expected in demos:
        got = run_program(program, inp)
        if len(got) != len(expected) or len(got[0]) != len(expected[0]):
            continue  # 形状不一致 → このペアは 0 点
        cells = sum(
            1
            for r in range(len(expected))
            for c in range(len(expected[0]))
            if got[r][c] == expected[r][c]
        )
        total += cells / (len(expected) * len(expected[0]))
    return total / len(demos)


# ---------------------------------------------------------------------------
# 3. 探索フェーズ: 候補の生成(変異)
#    Berman らは LLM に「前世代の良かったプログラム+失敗の分析」を渡して
#    改良版を書かせる。ここではその役割を単純なランダム変異で代替する。
# ---------------------------------------------------------------------------


def mutate(program: list, max_len: int = 3) -> list:
    """親プログラムを少しだけ変えた子プログラムを返す。"""
    child = list(program)
    choice = random.random()
    if choice < 0.34 and len(child) < max_len:
        child.insert(random.randrange(len(child) + 1), random.choice(PRIMITIVES))
    elif choice < 0.67 and child:
        child.pop(random.randrange(len(child)))
    elif child:
        child[random.randrange(len(child))] = random.choice(PRIMITIVES)
    else:
        child.append(random.choice(PRIMITIVES))
    return child


# ---------------------------------------------------------------------------
# 4. refinement loop 本体
#    探索(候補生成)→ 検証(採点)→ 良い個体を残して再び探索 …… を
#    「全デモペアに完全正解するまで」繰り返す。これが論文の中心概念。
# ---------------------------------------------------------------------------


def refinement_loop(
    demos: list[tuple[Grid, Grid]],
    population_size: int = 30,
    generations: int = 200,
    verbose: bool = True,
) -> list | None:
    population = [[random.choice(PRIMITIVES)] for _ in range(population_size)]

    for gen in range(generations):
        # --- 検証フェーズ: 各候補にフィードバック信号を付ける
        scored = sorted(population, key=lambda p: fitness(p, demos), reverse=True)
        best = scored[0]
        best_score = fitness(best, demos)

        if verbose and (gen % 10 == 0 or best_score == 1.0):
            print(f"  世代 {gen:3d}: ベストスコア {best_score:.2f}  {show_program(best)}")

        if best_score == 1.0:  # 全デモペアに完全正解 → refinement 完了
            return best

        # --- 探索フェーズ: 上位個体(エリート)から変異で次世代を作る。
        #     局所最適に population 全体が収束して探索が止まるのを防ぐため、
        #     毎世代 2 割は新規ランダム個体を注入する(多様性の維持)。
        elites = scored[: population_size // 5]
        immigrants = [
            [random.choice(PRIMITIVES) for _ in range(random.randint(1, 2))]
            for _ in range(population_size // 5)
        ]
        population = list(elites) + immigrants
        while len(population) < population_size:
            population.append(mutate(random.choice(elites)))

    return None


# ---------------------------------------------------------------------------
# 5. おもちゃの ARC 風タスクで実行
#    本物の ARC タスク同様「デモペアから規則を発見し、テスト入力に適用」する。
# ---------------------------------------------------------------------------


def demo() -> None:
    random.seed(42)

    tasks = {
        "タスクA: 180度回転(rot90 を2回合成する必要がある)": {
            "demos": [
                # 位置が動かないと解けないデモペアにする(色交換では模倣できない)
                ([[5, 0], [0, 0]], [[0, 0], [0, 5]]),
                ([[1, 2, 0], [0, 0, 0]], [[0, 0, 0], [0, 2, 1]]),
            ],
            "test": [[2, 2, 0], [0, 1, 3]],
        },
        "タスクB: 色1と色2を交換してから左右反転": {
            "demos": [
                ([[1, 2, 0], [0, 1, 2]], [[0, 1, 2], [1, 2, 0]]),
                ([[2, 2], [1, 0]], [[1, 1], [0, 2]]),
            ],
            "test": [[1, 0, 2], [2, 1, 1]],
        },
    }

    for name, task in tasks.items():
        print(f"\n=== {name} ===")
        program = refinement_loop(task["demos"])
        if program is None:
            print("  改良ループ内で解を発見できなかった")
            continue
        answer = run_program(program, task["test"])
        print(f"  発見したプログラム: {show_program(program)}")
        print(f"  テスト入力 {task['test']} への答え: {answer}")


if __name__ == "__main__":
    print(__doc__.split("=====")[0].strip())
    demo()
