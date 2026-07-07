# golf_swing_pose

iPhoneで正面から撮影したゴルフスイング動画から、2D骨格(関節キーポイント)の時系列とスイングフェーズ(アドレス~フィニッシュ)を推定するパイプライン。オリジナル実装のモデルアーキテクチャ(既存の姿勢推定ライブラリのラップではない)を使用する。

このディレクトリはリポジトリ内の独立プロジェクトで、ルートのマルチエージェントパイプラインや `f1map/` とは無関係。

## 重要: 精度に関する現実的な前提

このモデルは**未学習の状態では実用的な精度を出さない**。バックボーン(ConvNeXt-Tiny)はImageNet事前学習重みで初期化されるが、姿勢推定ヘッド(SimCC)とスイングイベント検出ヘッド(BiLSTM)はランダム初期化から始まる。「MediaPipeを超える精度」を実際に得るには、以下のいずれか(理想は両方)の学習を行う必要がある:

1. `train_pose.py` で COCO keypoints データセット(できればゴルフスイングを含む画像でのfine-tuning)を使って姿勢推定ヘッドを学習する。
2. `train_events.py` で GolfDB 形式のスイング動画+イベントラベルを使ってイベント検出ヘッドを学習する。

学習用データ・GPUがなければ、`infer.py` はエラーなく最後まで実行できるが、出力される骨格・イベントは意味のある値にならない。

また、ImageNet/COCO事前学習重みのダウンロードには `download.pytorch.org` へのネットワークアクセスが必要。ネットワークが制限された環境では自動的にランダム初期化にフォールバックする(警告ログが出る)。

## アーキテクチャと参照論文

| コンポーネント | 設計 | 参照論文 |
|---|---|---|
| バックボーン | ConvNeXt-Tiny (ImageNet事前学習、transfer learning) | Liu et al., "A ConvNet for the 2020s", CVPR 2022 |
| 姿勢ヘッド | SimCC (X/Y軸それぞれを独立した1D分類問題として解く) + 軽量cross-attention | Li et al., "SimCC", ECCV 2022 (arXiv:2107.03332); RTMPose (Jiang et al., 2023, arXiv:2303.07399) がこの設計をヒートマップ方式より高精度・高速と報告 |
| 人物検出 | Faster R-CNN (MobileNetV3-Large FPN, COCO事前学習) | torchvision標準実装 |
| スイングイベント検出 | BiLSTM (2層) による時系列9クラス分類(8イベント+none) | McNally et al., "GolfDB"/SwingNet, CVPRW 2019 |
| 時系列平滑化 | One-Euro Filter | Casiez et al., CHI 2012 |

姿勢推定ヘッドとイベント検出ヘッドはこのリポジトリのためにゼロから実装したオリジナルコードであり、MediaPipe/MMPose/OpenPose等の既存姿勢推定ライブラリはコード内で一切使用していない。

## セットアップ

```bash
cd golf_swing_pose
pip install -r requirements.txt
```

## 使い方

### 推論(骨格抽出 + スイングフェーズ検出)

```bash
python infer.py --video swing_front.mov --out_dir outputs/ \
    --pose_checkpoint weights/pose_best.pt \
    --event_checkpoint weights/event_best.pt
```

チェックポイントを指定しない場合、バックボーンのみImageNet初期化(ネットワークアクセスがあれば)で実行され、警告ログとともに動作する(精度は保証されない)。

出力:
- `outputs/skeleton.json` — フレームごとの17関節(COCO形式)キーポイント(x, y, 信頼度)
- `outputs/swing_events.json` — 8つのスイングフェーズ(アドレス/トゥアップ/ミッドバックスイング/トップ/ミッドダウンスイング/インパクト/フォロースルー/フィニッシュ)のフレーム番号・タイムスタンプ
- `outputs/annotated.mp4` — 骨格線とイベントラベルを焼き込んだ動画

iPhone動画の回転メタデータが正しく反映されない場合は `--rotate 90/180/270` で手動補正できる。

### 学習

```bash
# 1. 姿勢推定モデル(COCO keypoints形式)
python train_pose.py --images_dir /path/to/coco/train2017 \
    --annotation_file /path/to/coco/annotations/person_keypoints_train2017.json \
    --epochs 60 --out weights/pose_best.pt

# 2. スイングイベント検出モデル(GolfDB形式、data/golfdb_dataset.py参照)
python train_events.py --videos_dir /path/to/golf_clips \
    --annotation_file /path/to/annotations.json \
    --pose_checkpoint weights/pose_best.pt --epochs 30 --out weights/event_best.pt
```

ゴルフスイングに特化した精度を出すには、COCOで一度学習した後、ゴルフスイングのフレームにキーポイントアノテーションを付けたデータセットで `--resume weights/pose_best.pt` を指定して追加fine-tuningすることを推奨する。

### スモークテスト(疎通確認)

```bash
python examples/smoke_test.py
```

合成動画でパイプライン全体(検出→姿勢推定→平滑化→イベント検出→JSON/動画出力)が例外なく完走するかを確認する統合テスト。精度の検証ではない(合成動画には実在の人物が写っていないため、人物検出は「誰も見つからない」フォールバック経路を通る)。

## ディレクトリ構成

```
golf_swing_pose/
  configs/           # モデル・キーポイント定義・イベント定義
  models/            # backbone / pose_head(SimCC) / pose_model / event_head / detector
  data/              # COCO/GolfDB形式データローダ、アフィン変換・SimCCラベルエンコード
  pipeline/          # 動画IO、bboxトラッキング、One-Euro平滑化、可視化
  infer.py           # 推論エントリポイント
  train_pose.py      # 姿勢モデル学習エントリポイント
  train_events.py    # イベント検出モデル学習エントリポイント
  examples/          # スモークテスト
  weights/           # 学習済みチェックポイント配置用
```

## 実装していないもの

- 3D姿勢推定・複数人物対応(単一人物・2D前提)
- ViTPose/RTMPoseそのもののフル再実装や複数バックボーンの切り替え(設計思想の参照に留める)
- 学習済み重みそのもの(学習データ・GPUがこの開発環境になかったため、アーキテクチャと学習スクリプトの提供までが範囲)
