-- Listen Buddy マッチング用テーブル（BuddyShareとは別）
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

-- RLS（anon でアクセス可能にする）
ALTER TABLE listen_buddy_waiting ENABLE ROW LEVEL SECURITY;
ALTER TABLE listen_buddy_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for listen_buddy_waiting" ON listen_buddy_waiting
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for listen_buddy_rooms" ON listen_buddy_rooms
  FOR ALL USING (true) WITH CHECK (true);
