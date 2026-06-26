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

## ローカルFastAPI版

Python + FastAPI版は `shinx_converter/` にあります。

```powershell
cd shinx_converter
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

## GitHub Pages

リポジトリ設定で Pages の Source を `Deploy from a branch`、Branch を `main`、Folder を `/docs` にすると公開できます。
