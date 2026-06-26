# SHINX Fusion NC Converter

GitHub Pages用の静的Web版です。

- サーバー不要
- Gコードはブラウザ内だけで処理
- 設定はブラウザのlocalStorageに保存
- `.nc` / `.txt` で保存
- Fusionの `FANUC (with G91)` / `fanuc incremental.cps` 由来の `G91`、`G17/G18/G19`、`G02/G03 I/J/K` 円弧をR指定へ変換

## 原点設定シーケンス

SHINX変換時は、機械側加工原点へXY移動して `G92 X0.000 Y0.000` を設定した後、安全Z、Fusion側の最初の加工開始XY、接近Z、加工深さ下降の順に固定で出力します。

公開URLは GitHub Pages 設定後に次の形式になります。

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```
