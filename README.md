# SHINX Fusion NC Converter

Fusion 360 CAD/CAM から出力した Fanuc系Gコードを、SHINX 20ZXGN 用NCコードへ変換するWebアプリです。

## Web版

GitHub Pagesで公開する静的Web版は `docs/` にあります。

- サーバー不要
- ブラウザ内で変換
- Gコードは外部送信しません
- 設定はlocalStorageに保存
- `.nc` / `.txt` で保存
- Fusionの `FANUC (with G91)` / `fanuc incremental.cps` 由来のインクリメンタル出力に対応し、I/J/K円弧はR指定へ変換

## SHINX原点設定シーケンス

変換後は加工前に次の順序を固定で出力します。

```nc
G90 G00 X{machine_origin_x} Y{machine_origin_y}
G92 X0.000 Y0.000
G90 G00 Z{safe_z}
G90 G00 X{first_cut_x} Y{first_cut_y}
```

`first_cut_x` / `first_cut_y` はFusion側Gコードの最初のXY移動から自動抽出します。
Fusion 360専用ポスト `shinx_20zxgn.cps` では、ポスト固定の接近Z/下降深さではなくFusionのツールパスZを材料上面基準に変換して出力します。
材料上面を取得できない場合は、`useManualStockTopZ` と `manualStockTopZ` を設定しない限りポストを停止します。

## ローカルFastAPI版

Python + FastAPI版は `shinx_converter/` にあります。

```powershell
cd shinx_converter
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

## Fusion 360専用ポスト

Fusion 360からSHINX 20ZXGN用NCコードを直接出す専用ポストは `shinx_20zxgn.cps` です。

ダウンロード:
[shinx_20zxgn.cps](https://raw.githubusercontent.com/nakamurobo2026/shinx-fusion-nc-converter/main/shinx_20zxgn.cps)

導入方法とプロパティ説明は `SHINX_20ZXGN_POST_README.md` を参照してください。

## GitHub Pages

リポジトリ設定で Pages の Source を `Deploy from a branch`、Branch を `main`、Folder を `/docs` にすると公開できます。
