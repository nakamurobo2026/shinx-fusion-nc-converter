# SHINX 20ZXGN Fusion 360 Post Processor

`shinx_20zxgn.cps` は、Fusion 360のFanuc系モーション出力をベースに、SHINX 20ZXGN固有の機械準備コードだけを追加する専用ポストです。

## ダウンロード

[shinx_20zxgn.cps](https://raw.githubusercontent.com/nakamurobo2026/shinx-fusion-nc-converter/main/shinx_20zxgn.cps)

## 設計方針

- Fusionが計算したX/Y、送り、円弧を基本保持します。
- `rawZ - sectionInitial.z` のような独自Z補正は行いません。
- Z値のクランプは行いません。
- ZはSHINX雛形に合わせ、材料厚基準のG90安全高さからG91差分で下げます。
- SHINX固有のヘッダー、フッター、工具マクロ、G92原点補完だけを差し込みます。

## 導入方法

1. `shinx_20zxgn.cps` をFusion 360のローカルポストフォルダへ配置します。
2. Fusion 360の製造ワークスペースで `ポスト処理` を開きます。
3. ポストライブラリから `SHINX 20ZXGN` を選択します。
4. 必要に応じてポストプロパティを調整して出力します。

一般的なローカルポスト配置先の例:

```text
%APPDATA%\Autodesk\Fusion 360 CAM\Posts
```

## SHINX固有コード

工具取得:

```nc
T{shinx_tool}
G65 P9000 L1
```

工具返却:

```nc
G65 P9900 L1
```

原点設定:

```nc
G90 G00 X{machine_origin_x} Y{machine_origin_y}
G92 X0.000 Y0.000
M21
G90 G00 X{first_cut_x} Y{first_cut_y}
G90 G00 Z{safe_z}
G90 G00 Z{approach_z}
G91 G01 Z-{approach_clearance} F{plunge_feed}
```

この後の加工本文では、FusionのZ絶対値は出さず、Fusion Zの差分だけをG91で出力します。
XY、送り、円弧はFusionのFanuc系モーション出力を基本保持します。

`autoSafeHeight` が `true` の場合:

```text
safeZ = materialThickness + safeClearance
approachZ = materialThickness + approachClearance
```

材料厚は Fusion Setup の Stock 厚み、Model Bounding Box、`manualMaterialThickness` の順で取得します。

## ポストプロパティ

- `machiningFace`: 加工面番号。初期値は8。
- `machineOriginX`: 機械側加工原点X。初期値 `-1303.520`。
- `machineOriginY`: 機械側加工原点Y。初期値 `-2610.910`。
- `safeZ`: `autoSafeHeight=false` の時に使う手動安全Z。初期値 `60.0`。
- `autoSafeHeight`: 材料厚から安全高さ/接近高さを自動計算する。初期値 `true`。
- `safeClearance`: 材料厚へ足す安全余裕。初期値 `20.0`。
- `approachClearance`: 材料厚へ足す接近余裕。初期値 `5.0`。
- `plungeFeed`: `approachZ` から材料上面付近へG91で下げる送り。初期値 `1500`。
- `manualMaterialThickness`: Fusionから材料厚を取得できない場合の手動材料厚。初期値 `30.0`。
- `spindleSpeedOverride`: 0ならFusion工程のS値を使用。0以外なら固定S値。
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
