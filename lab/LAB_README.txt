SHOW PLAYER LAB（検証用）
- 本番(SHOW PLAYER)とは別のアプリ。Dockに別アプリとして追加できる。本番のURL・保存音源・設定には触れない。
- 元は本番 v146。次の変更だけ加えてある（再生・リモコン・フェード等の処理は、まだ変更していない）：
  1) 保存領域の名前を分離：IndexedDB は show-player-lab-local / show-player-lab-decoded、Service Worker のキャッシュは show-player-lab-offline-L1
  2) 見分ける表示：タイトル「SHOW PLAYER LAB」、画面上端の橙色の帯、フッターの「LAB（検証用）」、アイコンに「LAB」の帯、manifest の名前
  3) 「記録」の先頭に「SHOW PLAYER LAB(L1)」と出る
- 曲を使うには、本番から「プレイリスト共有」でZIPを書き出し、LAB で読み込む（保存領域が別のため）。
