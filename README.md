# SHINX NC Viewer

Fusion 360のSHINX 20ZXGN専用ポストから出力されたNCコードを、実機投入前に確認するWebビューアです。

## Web版

GitHub Pagesで公開する静的Web版は `docs/` にあります。

- サーバー不要
- NC変換やNC生成は行いません
- Gコードは外部送信しません
- 設定はlocalStorageに保存
- SHINX用NCのG90/G91、座標、工具、Z、Mコードを解析
- 2D XYプレビューと安全チェックを表示
- 解析結果JSON、座標CSV、安全チェックCSVを保存

## SHINX NC Viewer

ビューアでは、ポスト出力済みNCの以下を確認します。

- G90/G91の座標追跡
- 各行の実行後X/Y/Z
- G92、M21、P9000/P9900、G218/G219、M92/M95の有無
- SafeZ、ApproachZ、材料上面Z、最深Z
- G00/G01/G02/G03の2D XY表示
- 工具ごとの加工範囲と警告数

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
[shinx_20zxgn.cps](https://raw.githubusercontent.com/nakamurobo2026/shinx-fusion-nc-converter/main/shinx_20zxgn.cps?cachebust=8df98be)

導入方法とプロパティ説明は `SHINX_20ZXGN_POST_README.md` を参照してください。

## GitHub Pages

リポジトリ設定で Pages の Source を `Deploy from a branch`、Branch を `main`、Folder を `/docs` にすると公開できます。
