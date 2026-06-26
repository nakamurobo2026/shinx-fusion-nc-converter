# SHINX Motion Viewer

Fusion 360のSHINX 20ZXGN専用ポストから出力されたNCコードを、実機投入前に再生確認するNCシミュレーターです。

## Web版

GitHub Pagesで公開する静的Web版は `docs/` にあります。

- サーバー不要
- NC変換やNC生成は行いません
- Gコードは外部送信しません
- Three.jsで材料、工具、工具軌跡、G92加工原点、機械原点を可視化
- NCを1行ずつ再生し、現在行と工具位置を同期
- 断面Z、XY、現在座標、安全チェックを表示
- 材料厚、SafeZ、ApproachZ、加工範囲、加工時間、工具数をNCから自動推定

## SHINX Motion Viewer

シミュレーターでは、ポスト出力済みNCの以下を確認します。

- 工具が今どこにいるか
- あと何mmで材料に入るか
- 現在どのNC行を実行しているか
- G92、機械原点、SafeZ、ApproachZ、工具交換、SHINXマクロを含めた機械動作

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
