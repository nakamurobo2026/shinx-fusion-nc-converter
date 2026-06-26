# SHINX Fusion NC Converter

Fusion 360 CAD/CAM から出力した Fanuc系Gコードを、SHINX 20ZXGN 用NCコードへ変換する完全ローカルWebアプリです。

## MVP機能

- 1ファイル読み込み
- 1工具を代表工具として変換
- T1-T7 から SHINX工具番号へのマッピング
- 主軸回転数 `S` の抽出
- SHINX用ヘッダー/原点補正/フッター生成
- 危険Mコードと不要ヘッダー/フッターの除去
- 危険チェックと変換ログ表示
- `.nc` / `.txt` 保存
- `config.json` に設定保存

## 起動

通常のPythonがPATHにある場合:

```powershell
cd shinx_converter
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

このCodex環境の同梱Pythonを使う場合:

```powershell
cd C:\Users\unknown\Documents\Codex\2026-06-26\fusion-360-cad-cam-g-shinx\shinx_converter
& "C:\Users\unknown\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m pip install -r requirements.txt
& "C:\Users\unknown\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" run_server.py
```

または `start_server.bat` を実行します。

ブラウザで `http://127.0.0.1:8000` を開きます。

## 注意

このMVPは安全確認を補助するツールです。実機投入前に、必ずSHINX 20ZXGN側のドライラン、シミュレーション、工具位置、ストローク、主軸、ワーク固定状態を確認してください。
