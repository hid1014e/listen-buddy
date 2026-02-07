import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { session_id } = await request.json();
    if (!session_id || typeof session_id !== 'string') {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase env missing:', { hasUrl: !!supabaseUrl, hasKey: !!supabaseKey });
      return NextResponse.json(
        { error: 'Supabaseの設定がありません。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 既にマッチ済みかチェック（相手のリクエストでルーム作成された場合）
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: roomAsUser1 } = await supabase
      .from('listen_buddy_rooms')
      .select('id')
      .eq('user1_session_id', session_id)
      .gte('created_at', fiveMinAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: roomAsUser2 } = await supabase
      .from('listen_buddy_rooms')
      .select('id')
      .eq('user2_session_id', session_id)
      .gte('created_at', fiveMinAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingRoom = roomAsUser1 ?? roomAsUser2;
    if (existingRoom) {
      return NextResponse.json({
        paired: true,
        room_id: existingRoom.id,
      });
    }

    // 古い待機エントリを削除（2分以上前＝離脱したユーザー）
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await supabase
      .from('listen_buddy_waiting')
      .delete()
      .lt('created_at', twoMinAgo);

    // 待機に追加（既にいれば created_at は更新しない＝参加順を維持）
    const { error: insertError } = await supabase
      .from('listen_buddy_waiting')
      .upsert({ session_id }, { onConflict: 'session_id' });

    if (insertError) {
      console.error('listen_buddy_waiting insert error:', insertError);
      const hint = /does not exist|42P01|relation/i.test(insertError.message)
        ? 'listen_buddy_waiting テーブルがありません。SETUP.md の SQL を Supabase SQL Editor で実行してください。'
        : undefined;
      return NextResponse.json(
        { error: insertError.message, hint },
        { status: 500 }
      );
    }

    // 待機中の人数を取得（自分を含む）
    const { data: waitingList, error: selectError } = await supabase
      .from('listen_buddy_waiting')
      .select('session_id, created_at')
      .order('created_at', { ascending: true });

    if (selectError || !waitingList || waitingList.length < 2) {
      console.log('[match] waiting_count:', waitingList?.length ?? 0, 'session:', session_id.slice(0, 8));
      return NextResponse.json({ paired: false, waiting_count: waitingList?.length ?? 0 });
    }

    console.log('[match] 2人以上検出! session_ids:', waitingList.map((w) => w.session_id.slice(0, 8)));

    // 2人以上なら最古の2人をマッチング
    const [user1, user2] = waitingList;
    if (user1.session_id === user2.session_id) {
      return NextResponse.json({ paired: false });
    }

    // session_id が小さい方だけがルーム作成（重複防止）
    const [first, second] = user1.session_id < user2.session_id
      ? [user1, user2]
      : [user2, user1];

    if (session_id !== first.session_id) {
      console.log('[match] 相手発見、作成担当は相手、次回で接続 session:', session_id.slice(0, 8));
      return NextResponse.json({ paired: false, waiting_count: 2, msg: '相手発見・次回で接続' });
    }

    // ルーム作成
    const { data: room, error: roomError } = await supabase
      .from('listen_buddy_rooms')
      .insert({
        user1_session_id: first.session_id,
        user2_session_id: second.session_id,
      })
      .select('id')
      .single();

    if (roomError || !room) {
      console.error('[match] ルーム作成失敗:', roomError?.message ?? 'no room data');
      return NextResponse.json({ paired: false });
    }

    // 待機から2人を削除
    await supabase
      .from('listen_buddy_waiting')
      .delete()
      .in('session_id', [first.session_id, second.session_id]);

    console.log('[match] ルーム作成成功! room_id:', room.id);
    return NextResponse.json({
      paired: true,
      room_id: room.id,
    });
  } catch (e) {
    console.error('match error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
