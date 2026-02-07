# Listen Buddy セットアップ

## 1. 依存関係のインストール

```bash
npm install
```

## 2. Supabase の設定

BuddyShare（myapp）と同じ Supabase プロジェクトを使用します。

### .env.local に以下を追加（myapp の .env.local からコピー可）

```
NEXT_PUBLIC_SUPABASE_URL=https://qzoofenzkofuuyixyxkw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...（myapp と同じ値）
SUPABASE_SERVICE_ROLE_KEY=eyJ...（myapp と同じ値、API ルート用）
```

### テーブルの作成（必須）

Supabase ダッシュボード → SQL Editor で以下を実行：

```sql
CREATE TABLE IF NOT EXISTS listen_buddy_waiting (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listen_buddy_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user1_session_id TEXT NOT NULL,
  user2_session_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE listen_buddy_waiting ENABLE ROW LEVEL SECURITY;
ALTER TABLE listen_buddy_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for listen_buddy_waiting" ON listen_buddy_waiting;
CREATE POLICY "Allow all for listen_buddy_waiting" ON listen_buddy_waiting
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for listen_buddy_rooms" ON listen_buddy_rooms;
CREATE POLICY "Allow all for listen_buddy_rooms" ON listen_buddy_rooms
  FOR ALL USING (true) WITH CHECK (true);
```

## 3. 起動

```bash
npm run dev
```
