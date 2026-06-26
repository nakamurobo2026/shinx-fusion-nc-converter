# SHINX Motion Viewer

GitHub Pages用のSHINX専用NCシミュレーターです。

- FusionのSHINX専用ポストから出力されたNCを読み込み
- Three.jsで材料、工具、工具軌跡、G92加工原点、機械原点を可視化
- NCを1行ずつ再生、一時停止、停止、行送り、行戻し
- 速度は `0.25x` から `100x` まで切替
- 現在行、工具位置、X/Y/Z/F/S/T、タイムラインを同期表示
- 右側に断面Zビュー、XYビュー、安全チェックを表示
- 材料厚、SafeZ、ApproachZ、加工範囲、加工時間、工具数をNCから自動推定

公開URLは GitHub Pages 設定後に次の形式になります。

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```
