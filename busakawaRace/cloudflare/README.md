# ぶさかわレース：展示用スマホ投票

## 構成

- `src/worker.js`: API、Secret認証、許可OriginのCORS、スマホ用静的ファイル配信。
- `src/race-room.js`: SQLite Durable Object。`exhibition-main-v1`という開催枠1つを使用。新しい受付ごとにraceIdを発行。
- `src/race-state.js`: 10秒準備→15秒投票→5秒閉幕→3秒カウントダウンの締切・順位。
- `public/vote.html`, `vote.js`: スマホ専用。番号・名前で投票。3Dや画像のアップロードは行わない。`previewUrl`は将来用。
- `public/shared-client.js`: API通信とサーバー時計の同期。表示時計は応答の往復時間の半分で補正するため、通信の非対称性による表示誤差はあり得る。受理判定は常にサーバー時刻。
- `public/host-client.js`: PCの管理通信。トークンは入力後メモリのみ。確定票取得に失敗するとレースを開始しない。
- `public/vendor/qr-code.js`: npmのqrcodeをブラウザ用にビルドしたQR生成コード。外部QRサービスへ情報を送らない。
- `test/api.test.js`: Workers実行環境・SQLiteを使う自動テスト。

登録済みキャラクターのlocalStorageと出走者sessionStorageには書き込まない。送信する出走者情報はID・名前だけ。牧場、制作、GLB、Pythonには変更なし。

## ローカルで試す

Node.js 22以上が必要。

```sh
cd cloudflare
npm ci
npm run setup:local
npm run dev
```

**開発用秘密ファイルがある間は、プロジェクト全体を無制限に配信する汎用HTTPサーバーを使わない。** 下記の専用サーバーは`.dev.vars`、Git、SQLite、依存ファイルを拒否する。

`.dev.vars`にランダムなローカル管理トークンが作られる。Git対象外で、既存ファイルは上書きしない。ファイル内のADMIN_TOKENの値だけを、展示PCの管理トークン欄へ入力する。画面共有やスクリーンショットにトークンを含めない。

別ターミナルでプロジェクトのルートから（秘密ファイルを配信しない専用サーバーを使う）：

```sh
python3 cloudflare/scripts/serve-project.py --port 8000
```

`http://127.0.0.1:8000/pasture.html`で出走者を選びレースへ進む。投票方式は「スマホ投票（Cloudflare）」を選ぶ。接続設定で `http://127.0.0.1:8787` とローカル管理トークンを入力し「受付を作成」。表示リンクで投票ページを開く。「投票進行スタート！」を押すまで受付で待機する。

**127.0.0.1のQRはスマホから開けない。** 同じWi-Fiの実機確認は、信頼できるLANだけでWranglerを以下のように起動し直し、PC管理画面にPCのLAN IPを入力する：

```sh
npm run build
npx wrangler dev --ip 0.0.0.0 --port 8787
```

例： `http://192.168.1.20:8787`。OSのファイアウォールで必要なアクセスを許可する。LANのHTTPは検証用。本番はWorkersのHTTPSを使用する。PCのWebページを別のOriginで開く場合は、wrangler.jsoncのALLOWED_ORIGINSに**正確なOrigin**を追加する。CORSは認証の代わりではなく、管理APIには必ずBearerトークンが必要。

ネットワークを使わない従来の動作確認は「PC内投票（テスト用）」へ切り替える。このモードだけ同じPCから複数票を入れられ、準備のスキップも使える。通信障害で自動的にこのモードへ切り替わることはない。

## Cloudflareの設定・デプロイ（まだ実行していない）

この操作でWorkersと公開投票ページ、SQLite Durable ObjectがCloudflareアカウントに作られる。利用プラン・リクエスト数・ストレージ等により課金対象になり得るため、アカウントのプラン・上限を先に確認する。公開後はAPIに第三者もアクセスできる。必要に応じCloudflare側のレート制限等を設定する。

1. `npx wrangler login`：ブラウザでアカウントを選びログインする。
2. `wrangler.jsonc`のnameとALLOWED_ORIGINSを確認。展示PCをローカル8000番で開くなら初期値が対応している。
3. `npx wrangler secret put ADMIN_TOKEN`：十分長いランダムな管理トークン（32文字以上、推奨64桁のランダムhex）を対話入力する。GitやHTMLへ書かない。これは本番Secretで、`.dev.vars`はローカル専用。
4. `npm run deploy`：SQLiteクラスの初回migrationと静的ファイルがデプロイされる。D1の作成は不要。
5. 表示された `https://...workers.dev` をPCの接続設定に入力する。トークンは担当者が入力する。スマホには渡さない。

PCは引き続きローカルサーバーで動かせる。制作・ArUco全体をCloudflareへ公開する必要はない。PCを再読み込みした場合、既存進行への自動復帰は行わない。担当者が新しい受付を作成し、新しいQRを案内する。

## 実機テスト手順（PC1台＋スマホ2台）

1. 牧場で1〜4体を選び、PCで新しい受付を作成。両スマホで**同じQR**を読む。raceId・名前・順番が同じか確認。
2. 準備前はボタンが無効であることを確認。PCで進行開始し、10→15→5→3・2・1・GOを確認。
3. 15秒の投票中にスマホAとBからそれぞれ1票。受理メッセージと全ボタン無効を確認。再読み込みしても再投票できないことを確認。
4. 投票中・締切後・レース中は公開API `/api/state?raceId=...` にcounts/resultsがなく、スマホに得票数・順位が出ないことを確認。
5. レース後だけ実際の順位・得票数が両画面へ出る。同票は同着。1体だけへ投票、一部0票、同票も試す。
6. 全員0票ならレースに進まず再投票案内。「もう一度」で新しいraceIdになる。両スマホで新しいQRを読む。古いQRでは投票不可。
7. 通信を遮断。スマホのボタンが無効になり通信エラーが出ること、確定票を受け取れていないPCが勝手に開始しないことを確認。確定済みで走行開始した後ならレースは継続でき、結果公開は再接続後に再試行する。
8. 管理トークンなしではcreate/start/close/cancel/publish/admin-stateが401になることを確認。
9. 最後に登録キャラクターが元のままか確認。

締切・開始はサーバーの絶対時刻で管理。二重開始は冪等、投票はraceIdとブラウザ識別子のハッシュをSQLiteの一意制約で排他。PCの締切後に届いたクリックもサーバーが拒否する。確定票が開始予定から2秒以上遅れて届いた場合は、瞬間移動を避けて停止し新しい受付を求める。

## API

公開：GET `/api/current`、GET `/api/state?raceId=...`（X-Voter-Idで自分の受理状況）、POST `/api/votes` `{raceId,voterId,entrantId}`。

管理：Authorization `Bearer ADMIN_TOKEN` が必須。

- POST `/api/admin/create` `{requestId,entrants:[{id,name}]}`：受付作成。requestIdは再送時の冪等キー。
- POST `/api/admin/start` `{raceId}`：一度だけ開始。
- POST `/api/admin/close` `{raceId}`：受付中のみ早期締切。
- POST `/api/admin/cancel` `{raceId}`：現在レースを中止。
- GET `/api/admin/state?raceId=...`：締切後のみcountsを返す。
- POST `/api/admin/publish` `{raceId,finishTimes:[{id,time}]}`：実際の完走時刻が投票順位・同着と整合し、サーバー上の完走可能時刻を過ぎている場合だけ結果公開。再送可能。

ブラウザ識別子は簡易的な重複防止。**同一人物の複数端末、別ブラウザ、保存データ削除による再投票は完全には防げない。** 本格的な本人確認や不正投票対策は別途必要。管理トークンを持つ担当PCは信頼する設計。

## 確認状況

- Workers実行環境でAPI自動テスト7件：管理認証、冪等性、並行二重投票、複数ブラウザ識別子、時間境界、古いraceId、0票、同票、非公開/CORS。
- 既存レース：58通りの計画、転倒・つまずき・転がり、1〜4体の完走・順位・同着・再実行・保存非変更の回帰テスト。
- オンライン進行：受付待機、サーバー締切への遷移、未確定票で停止、PC内投票の除外、確定票反映、同着、0票停止のVMテスト。
- ローカルHTTPとブラウザで受付作成、QR、管理開始、投票受理、二重投票拒否、確定票・公開制御、1票ずつの同着結果がPCと投票ページで一致すること、再レースの新raceIdと旧ページの拒否を確認。
- **未確認：Cloudflareへの本番デプロイ、実物スマホ2台、会場Wi-Fi、長時間展示負荷、外部インターネット経由の時刻誤差。**

## 公式資料

- [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Object storage / SQLite migration](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Static assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Workers + Durable Object testing](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)
