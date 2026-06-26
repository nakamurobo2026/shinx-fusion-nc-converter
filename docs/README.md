# SHINX NC Viewer

GitHub Pages用の静的Web版です。

- サーバー不要
- FusionのSHINX専用ポストから出力されたNCを読み込み
- NC変換やNC生成は行わない
- G90/G91、X/Y/Z、F/S/T、Mコード、G65 P9000/P9900を解析
- 座標一覧、工具ビュー、Zビュー、2D XYプレビュー、安全チェックを表示
- 解析結果JSON、座標CSV、安全チェックCSVを保存
- 設定はブラウザのlocalStorageに保存

公開URLは GitHub Pages 設定後に次の形式になります。

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```
