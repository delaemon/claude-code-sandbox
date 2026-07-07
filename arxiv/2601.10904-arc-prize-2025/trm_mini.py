"""
論文 3.2.1 節で紹介される Paper Award 1位
「Tiny Recursive Model (TRM)」(Jolicoeur-Martineau, arXiv:2510.04871)
の中核ループを写した参考コード。

わずか 7M パラメータの単一ネットワークで ARC-AGI-1 45% / ARC-AGI-2 8% を
達成した手法。ポイントは巨大モデルではなく「同じ小さなネットワークを
再帰的に何度も回して答えを磨く」= 重み空間ではなく *推論の反復* で
性能を稼ぐこと。これも論文の言う refinement loop の一種
(zero-pretraining deep learning に分類される)。

論文からの引用(3.2.1 節):
    It starts with the embedded input question x and initial embedded
    answer y, and latent z. For up to N_sup = 16 improvement steps,
    it tries to improve its answer y. It does so by
      i)  recursively updating n times its latent z given the question x,
          current answer y, and current latent z (recursive reasoning),
      ii) updating its answer y given the current answer y and latent z.

※ このファイルは構造を理解するための「読むコード」。実際に動かすには
   PyTorch が必要(この2行構造は本家実装 SamsungSAILMontreal/TinyRecursiveModels
   と対応している)。依存なしで動くデモは refinement_loop_demo.py を参照。
"""

# import torch
# import torch.nn as nn


class TinyRecursiveModel:  # (nn.Module)
    """
    たった1つの小さなネットワーク net(2層程度の Transformer ブロック)を、
    役割の違う2通りの呼び方で使い回す:

      z = net(x, y, z)   ... 潜在状態 z の更新(=「考える」)
      y = net(y, z)      ... 答え y の更新(=「答案を書き直す」)

    ネットワークは1つだけなのでパラメータ数は増えず、
    「考える回数」を増やすことで実効的な推論の深さを稼ぐ。
    """

    N_SUP = 16  # 改良ステップの最大回数(deep supervision の回数)
    n = 6       # 1ステップの中で z を再帰更新する回数(recursive reasoning)

    def __init__(self, net):
        self.net = net  # 唯一の小さなネットワーク(~7M パラメータ)

    def improvement_step(self, x, y, z):
        """1回の改良ステップ: z を n 回練ってから y を1回書き直す。"""
        # i) recursive reasoning: 問題x・現在の答えy・潜在zから z を更新
        for _ in range(self.n):
            z = self.net(x, y, z)
        # ii) 練った z を使って答え y を更新(前回の答えの誤りを修正できる)
        y = self.net(y, z)
        return y, z

    def forward(self, x, y, z):
        """
        推論: 最大 N_SUP 回、答えを段階的に改良する。
        これが「探索(zの更新で仮説を練る)→ 検証・反映(yを書き直す)」の
        refinement loop に相当する。
        """
        for _ in range(self.N_SUP):
            y, z = self.improvement_step(x, y, z)
            # 学習時はここで毎ステップ損失を取る(deep supervision)。
            # つまり「途中の答案にも赤ペンを入れる」ことで、
            # 少ないデータ・小さいネットでも安定して学習できる。
        return y


# ---------------------------------------------------------------------------
# 学習時の擬似コード(deep supervision)
# ---------------------------------------------------------------------------
#
# for x, y_true in arc_task_examples:          # データはそのタスクの例のみ
#     y, z = y_init, z_init
#     for step in range(TinyRecursiveModel.N_SUP):
#         y, z = model.improvement_step(x, y, z)
#         loss = cross_entropy(decode(y), y_true)   # 毎ステップ採点
#         loss.backward()                            # 途中の答案にも勾配
#         optimizer.step(); optimizer.zero_grad()
#         y, z = y.detach(), z.detach()   # ステップ間は勾配を切る(1-step gradient)
#
# 事前学習なし・外部データなし。「そのタスクを解くプログラム」を
# ネットワークの重みとして直接フィッティングしている点が、
# 記号的プログラム合成(refinement_loop_demo.py)と対になる
# 「重み空間での refinement loop」(論文 3.1.2 節)である。
