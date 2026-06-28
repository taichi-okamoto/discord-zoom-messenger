# Discord Zoom Messenger

DiscordとZoomのデスクトップアプリに、同じメッセージを送信するWindows向けElectronアプリです。

Discord APIやZoom APIは使いません。ログイン処理も行いません。ユーザーがすでに開いている通常のDiscord/Zoomウィンドウを前面に出し、クリップボード貼り付けとキー操作で送信します。

## 主な機能

- 開いているDiscord/Zoomウィンドウの検出
- Zoom → Discord の順番で同時送信
- Discordだけへの送信
- Zoomだけへの送信
- Zoomチャット欄が閉じている場合の自動オープン
- Zoomミニウィンドウ、Zoomチャット別窓のブロック
- ベータテスト用の診断ログコピー

## Zoomの前提

Zoomは次の状態で使ってください。

- Zoomは通常ウィンドウで開く
- チャット欄はメイン画面右側に統合表示する
- チャット欄が閉じている場合は、送信時にアプリが開きます
- ミニウィンドウ状態では送信しません
- チャットが別窓に分離している場合は送信しません

Zoom送信に失敗した場合、同時送信ではDiscordにも送信しません。

## 開発環境での起動

```cmd
npm install
npm start
```

## 配布用アプリの作成

```cmd
npm install
npm run dist
```

主な生成物:

```text
dist\Discord Zoom Messenger Setup 0.1.0.exe
dist\win-unpacked\Discord Zoom Messenger.exe
```

インストール不要版として配布する場合は、`dist\win-unpacked` フォルダ一式をzip化してください。`Discord Zoom Messenger.exe` 単体では動作しません。

## 診断ログについて

問題が起きた場合は、アプリ下部の「診断ログをコピー」ボタンでログをコピーできます。

診断ログに含まれるもの:

- アプリ、Electron、OSのバージョン
- 検出したDiscord/Zoom候補
- 送信対象として選ばれたウィンドウ
- 全ウィンドウ一覧
- 直近の送信結果
- 画面に表示されているステータスログ

送信メッセージ本文は含めず、文字数のみ記録します。ただし、ウィンドウタイトルにはDiscordサーバー名やZoomの表示名などが含まれる場合があります。ログを共有する前に内容を確認してください。

## 制約

- Windows専用です
- Discordデスクトップアプリ、Zoomデスクトップアプリを対象にしています
- 画面操作を含むため、Discord/ZoomのUI変更で動作しなくなる可能性があります
- 送信時に一時的にクリップボードを使用します
- Zoomの分離チャットウィンドウ、ミニウィンドウへの送信には対応していません
