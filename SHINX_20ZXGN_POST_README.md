# SHINX 20ZXGN Fusion 360 Post Processor

`shinx_20zxgn.cps` は、Fusion 360からSHINX 20ZXGN用NCコードを直接出力するための専用ポストです。

## ダウンロード

[shinx_20zxgn.cps](https://raw.githubusercontent.com/nakamurobo2026/shinx-fusion-nc-converter/main/shinx_20zxgn.cps)

## 導入方法

1. `shinx_20zxgn.cps` をFusion 360のローカルポストフォルダへ配置します。
2. Fusion 360の製造ワークスペースで `ポスト処理` を開きます。
3. ポストライブラリから `SHINX 20ZXGN` を選択します。
4. 必要に応じてポストプロパティを調整して出力します。

一般的なローカルポスト配置先の例:

```text
%APPDATA%\Autodesk\Fusion 360 CAM\Posts
```

Fusionのバージョンや環境により場所が異なる場合があります。

## 重要方針

- ATCの細かい動作はポスト内で展開しません。
- SHINX側の既存マクロ `P9000` / `P9900` を呼び出します。
- `O9000` / `O9900` 系マクロの中身は変更しません。

工具取得:

```nc
T{shinx_tool}
G65 P9000 L1
```

工具返却:

```nc
G65 P9900 L1
```

## 原点設定シーケンス

加工前は必ず次の順序で出力します。

```nc
G90 G00 X{machine_origin_x} Y{machine_origin_y}
G92 X0.000 Y0.000
M21
G90 G00 Z{safe_z}
G90 G00 X{first_cut_x} Y{first_cut_y}
G90 G00 Z{approach_z}
G91 G01 Z-{cut_depth} F{plunge_feed}
```

`first_cut_x` / `first_cut_y` はFusionの各工程の初期位置から取得します。

## ポストプロパティ

- `machiningFace`: 加工面番号。初期値は8。
- `machineOriginX`: 機械側加工原点X。初期値 `-1303.520`。
- `machineOriginY`: 機械側加工原点Y。初期値 `-2610.910`。
- `safeZ`: G92後の安全Z。初期値 `60.0`。
- `approachZ`: 加工開始前の接近Z。初期値 `5.0`。
- `spindleSpeedOverride`: 0ならFusion工程のS値を使用。0以外なら固定S値。
- `plungeFeed`: 初期下降送り。初期値 `1500`。
- `maxDepth`: 最大深さ兼、初期下降深さ。初期値 `31.0`。
- `useToolMapping`: Fusion工具番号をSHINX工具番号へ変換する。
- `tool1Mapped` ... `tool7Mapped`: 工具番号マッピング。

## 工具番号マッピング

初期設定:

```text
Fusion T1 -> SHINX T9
Fusion T2 -> SHINX T10
Fusion T3 -> SHINX T11
Fusion T4 -> SHINX T12
Fusion T5 -> SHINX T13
Fusion T6 -> SHINX T14
Fusion T7 -> SHINX T15
```

`useToolMapping` が `false` の場合はFusion工具番号をそのまま出力します。

## 複数工具

- 初回工具はヘッダー内で取得します。
- `onSection()` で工具番号を確認します。
- 前回工具と違う場合のみ、現在工具返却から次工具取得までを出力します。
- 同じ工具が連続する場合は工具交換しません。
- 最終工具はフッター前に `G65 P9900 L1` で返却します。

## 注意

このポストはSHINX 20ZXGN向けの専用出力です。実機投入前に必ずドライラン、空運転、ストローク、工具番号、主軸、ワーク固定、G92原点を確認してください。
