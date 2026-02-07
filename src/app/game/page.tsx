'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function GamePage() {
  const [status, setStatus] = useState<'waiting' | 'found' | 'connecting' | 'error'>('waiting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // タブごとに必ず別ID（useRefはマウント時に1回だけ生成、複製タブでも新規マウントで別ID）
  const sessionIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    const sessionId = sessionIdRef.current;

    const tryMatch = async () => {
      try {
        const res = await fetch('/api/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatus('error');
          setErrorMsg(data.hint || data.error || 'エラーが発生しました');
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
        if (data.paired && data.room_id) {
          console.log('[ListenBuddy] マッチ成功! 遷移します', data.room_id);
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus('connecting');
          sessionStorage.setItem('listen_buddy_session_id', sessionIdRef.current);
          window.location.href = `/game/${data.room_id}`;
        }
        if (data.waiting_count === 2 && !data.paired) {
          setStatus('found');
        }
      } catch (e) {
        console.error('match error:', e);
        setStatus('error');
        setErrorMsg('接続エラー');
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };

    tryMatch();
    pollRef.current = setInterval(tryMatch, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
        傾聴ゲーム
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {status === 'waiting' && '相手を探しています...'}
        {status === 'found' && '相手を発見！接続準備中...'}
        {status === 'connecting' && '接続中...'}
        {status === 'error' && errorMsg}
      </p>
      <p className="text-xs text-zinc-400 max-w-xs text-center">
        2人目は「新しいタブ」または「シークレットモード」で開いてください。
        <br />
        <span className="font-mono text-zinc-500">ID: {sessionIdRef.current.slice(0, 8)}...</span>
      </p>
      <Link
        href="/"
        className="text-zinc-600 underline hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        キャンセル
      </Link>
    </div>
  );
}
