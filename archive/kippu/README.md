# ふたり旅きっぷ

旅行もデートも、行きたい場所・予定・お金・持ち物・思い出を、ふたりで同時に書き込めるノートです。
Notion のように自分で表やビューを組み立てる必要はなく、開いたらすぐ使えます。

- **予定**: 旅行とデートをカレンダーで一覧
- **旅程**: 時刻つきの路線図。予定どうしの重なりや空き時間を自動でチェック。しおりも作れる
- **行きたい**: ふたり共通のリスト。♡ がそろうとスタンプ。地図・都市別・国別・未訪問・要予約で見られて、宿は料金で比較できる
- **お金**: 立て替えを記録すると精算額を計算
- **準備**: 予約・やること・持ち物（ふたり別々にチェック）
- **思い出**: 写真とひとこと。「行った！」を押すと、その場所に行ったスタンプがつく
- **AIに相談**: OpenAI の GPT-5.2 が、おすすめの場所・旅程のたたき台・旅程チェック・持ち物リスト・相談に答える

アカウント登録はありません。きっぷ帳を作るとリンクができるので、それを相手に送るだけです（QRコードでも渡せます）。見るだけのリンクも作れます。

## しくみ

```
ブラウザ（public/ の静的ファイルだけ。ビルド不要）
   │  supabase-js
   ▼
Supabase
  ├ Postgres   データ（docs テーブル）。書き込みは doc_write() 関数を通し、行ごとのアクセス制限（RLS）で守る
  ├ Auth       端末ごとの匿名ログイン。リンクを開くと、そのきっぷ帳のメンバーになる
  ├ Realtime   書き込みをもう一人の画面にすぐ反映。「いま見ています」と ♡ も
  ├ Storage    写真（非公開。メンバーだけが期限つきリンクで見られる）
  └ Edge Function "ai"   GPT-5.2 を呼ぶ。APIキーはここだけにあり、ブラウザには出ない
```

| ファイル | 役割 |
| --- | --- |
| `public/js/app.js` | 画面と操作（Preact + htm） |
| `public/js/api.js` | Supabase とのやりとり（データ・リアルタイム・写真・AI） |
| `public/js/geo.js` / `photos.js` | 地図と場所の検索（OpenStreetMap）/ 写真の縮小 |
| `public/config.js` | **接続先の Supabase（URL と publishable キー）** |
| `supabase/migrations/` | テーブル・RLS・関数・写真置き場の定義 |
| `supabase/functions/ai/` | GPT-5.2 の呼び出しとプロンプト |

## 手元で動かす

Node.js 20 以上と Docker Desktop が必要です。

```bash
npm install
npm run db:start          # ローカルの Supabase（初回はイメージの取得に数分）
npm run dev               # → http://localhost:5173
```

ローカルの Supabase は API が `http://127.0.0.1:57321` で動きます。ほかの Supabase プロジェクトとぶつからないよう、ポートを 573xx 番台にしてあります。`public/config.js` も最初からこの接続先になっています。

AI も試すときは、`supabase/functions/.env.example` を `supabase/functions/.env` にコピーして `OPENAI_API_KEY` を書き、別のターミナルで `npm run ai:serve` を動かします。

止めるときは `npm run db:stop` を実行します。

## 公開する（ふたりのスマホで使う）

### 1. Supabase プロジェクトを用意する

1. [supabase.com](https://supabase.com) でプロジェクトを作る
2. **Authentication → Sign In / Providers → Anonymous Sign-Ins** をオンにする
3. 手元からつないで、データベースと AI を送り込む

```bash
npx supabase login
npx supabase link --project-ref <プロジェクトID>
npm run deploy:db                                   # テーブル・RLS・関数・写真置き場
npx supabase secrets set OPENAI_API_KEY=sk-...      # GPT-5.2 のキー
npm run deploy:ai                                   # AI の Edge Function
```

4. **きっぷ帳を作るときの合言葉**を決める（知らない人が勝手に作って AI を使うのを防ぎます）。SQL Editor で次を実行します。

```sql
insert into app_settings (key, value) values ('create_passcode', 'ふたりだけの合言葉')
  on conflict (key) do update set value = excluded.value;
```

AI の利用回数の上限も同じ方法で変えられます（既定は、きっぷ帳ごとに1日100回、全体で1日500回）。

```sql
insert into app_settings (key, value) values ('ai_daily_limit', '50'), ('ai_global_daily_limit', '200')
  on conflict (key) do update set value = excluded.value;
```

### 2. 画面を公開する

1. `public/config.js` を、Project Settings → API にある **Project URL** と **publishable キー**（または anon キー）に書き換える
2. `public/` フォルダをそのまま静的ホスティングに置く
   - Cloudflare Pages や Netlify なら、フォルダをアップロードするだけで公開できます。`public/_headers` のセキュリティ設定もそのまま効きます
   - GitHub Pages でも動きます（`_headers` は効きません）
3. 公開した URL を開いて「ふたりのきっぷ帳をつくる」を押し、表示されたリンクを相手に送る

スマホでは「ホーム画面に追加」しておくと、アプリのように開けます。

## 設定（Edge Function の secrets）

| 名前 | 既定 | 内容 |
| --- | --- | --- |
| `OPENAI_API_KEY` | なし | 未設定のときは AI ボタンが出ません |
| `OPENAI_MODEL` | `gpt-5.2` | |
| `OPENAI_REASONING_EFFORT` | `low` | `none` / `low` / `medium` / `high` / `xhigh`。上げるほど丁寧になる代わりに、遅く高くなります |
| `OPENAI_WEB_SEARCH` | `0` | `1` にすると、「おすすめの場所」と「旅程をチェック」で Web 検索を使います。閉業や営業時間に強くなる代わりに、遅く高くなります |
| `ALLOWED_ORIGIN` | `*` | 公開した URL（例: `https://kippu.pages.dev`）にすると、ほかのサイトからは呼べなくなります |

## 知っておくこと

- **リンクが合鍵です。** 編集用のリンクを知っている人は、だれでも書き込めます。ふたりの間だけで送ってください。
- **写真**: ブラウザで長い辺 1600px の JPEG に縮めてから保存するので、位置情報などは消えます。Supabase の無料枠（1GB）で、2,000〜3,000 枚くらい入ります。
- **地図**: OpenStreetMap を使っています。場所の位置を調べるとき、場所の名前とエリアが OpenStreetMap に送られます。
- **AI**: 相談するとき、旅の情報（行き先・日程・候補・予定）が OpenAI に送られます。OpenAI 側には保存しない設定（`store: false`）で呼んでいます。1回の相談の料金は、`low` でおおむね数円〜10円ほどです。
- 元のアーティファクト版は `ふたり旅きっぷ.html` に残してあります（今は使っていません）。
