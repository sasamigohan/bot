# assets

## ラジオ体操の音源

このディレクトリに `radio-taiso.<拡張子>` という名前で音源ファイルを置くと、
毎朝9:00（JST）の再生に使われます。

探索される拡張子は次の順です（先に見つかったものを使用）:

`.ogg` → `.opus` → `.webm` → `.mp3` → `.m4a` → `.wav`

- **推奨は `radio-taiso.ogg`（Ogg/Opus）**。ffmpeg も音声エンコーダも通さず
  そのまま送信できるため、最も軽く、途切れにくいです。
  変換例: `ffmpeg -i input.mp3 -c:a libopus -b:a 96k radio-taiso.ogg`
- `.mp3` などを置いた場合は `ffmpeg-static` 経由でその場で変換して再生します。

別の場所に置きたい場合は、環境変数 `RADIO_TAISO_AUDIO` にパスを指定してください
（相対パスはリポジトリのルート基準）。

## 本番（Oracle Linux）での注意

`ffmpeg-static` は optionalDependencies なので、取得に失敗しても `npm install` は通ります。
そのぶん **本番では `.ogg`（Ogg/Opus）を置くのが確実** です。Ogg/Opus なら ffmpeg も
音声エンコーダも一切通らないため、`ffmpeg-static` が無い環境でもそのまま再生できます。

システムの ffmpeg を使いたい場合は `dnf install -y ffmpeg` 等で入れたうえで、
環境変数 `FFMPEG_PATH=/usr/bin/ffmpeg` を指定してください
（`FFMPEG_PATH` が設定済みなら `ffmpeg-static` は参照されません）。

音源ファイルが見つからない場合でも Bot は停止しません。
再生だけスキップし、参加者の記録・ポイント付与・一覧投稿は通常どおり行われます。
