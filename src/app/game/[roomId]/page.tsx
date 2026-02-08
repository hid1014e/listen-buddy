'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getQuestionForRoom } from '@/lib/listening-questions';

const TALKING_SECONDS = 3 * 60;
const SUMMARY_SECONDS = 1 * 60;

export default function GameRoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null && typeof window !== 'undefined') {
    sessionIdRef.current = sessionStorage.getItem('listen_buddy_session_id') ?? crypto.randomUUID();
    sessionStorage.setItem('listen_buddy_session_id', sessionIdRef.current);
  }
  const sessionId = sessionIdRef.current ?? '';

  const [status, setStatus] = useState<'connecting' | 'connected' | 'ended'>('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isRemoteCameraOn, setIsRemoteCameraOn] = useState(false);
  const [hasLocalStream, setHasLocalStream] = useState(false);
  const [gamePhase, setGamePhase] = useState<'talking' | 'summary' | 'done'>('talking');
  const [timeRemaining, setTimeRemaining] = useState(TALKING_SECONDS);
  const questionText = getQuestionForRoom(roomId);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isInitiatorRef = useRef<boolean | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const requestOfferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVideoEnabledRef = useRef(false);
  const gameStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    isVideoEnabledRef.current = isVideoEnabled;
  }, [isVideoEnabled]);

  // 3分→1分タイマー（game-start受信で開始、initiatorはontrackで開始）
  const gamePhaseRef = useRef(gamePhase);
  gamePhaseRef.current = gamePhase;
  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => {
      const startedAt = gameStartedAtRef.current;
      if (startedAt) {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        if (elapsed < TALKING_SECONDS) {
          setGamePhase('talking');
          setTimeRemaining(TALKING_SECONDS - elapsed);
        } else if (elapsed < TALKING_SECONDS + SUMMARY_SECONDS) {
          setGamePhase('summary');
          setTimeRemaining(TALKING_SECONDS + SUMMARY_SECONDS - elapsed);
        } else {
          setGamePhase('done');
          setTimeRemaining(0);
        }
      } else {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            const phase = gamePhaseRef.current;
            if (phase === 'talking') {
              setGamePhase('summary');
              return SUMMARY_SECONDS;
            }
            if (phase === 'summary') {
              setGamePhase('done');
              return 0;
            }
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const cleanup = useCallback(() => {
    if (requestOfferTimerRef.current) {
      clearTimeout(requestOfferTimerRef.current);
      requestOfferTimerRef.current = null;
    }
    localStreamRef.current = null;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setStatus('ended');
  }, []);

  useEffect(() => {
    if (!roomId || !sessionId) return;

    const channel = supabase.channel(`listen_buddy_room_${roomId}`, {
      config: { broadcast: { self: true } },
    });

    channelRef.current = channel;

    channel.on('broadcast', { event: 'signaling' }, async (payload) => {
      const msg = payload.payload as { from: string; type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; enabled?: boolean; startedAt?: number };
      if (msg.from === sessionId) return;

      const pc = pcRef.current;

      if (msg.type === 'offer' && msg.sdp) {
        if (requestOfferTimerRef.current) {
          clearTimeout(requestOfferTimerRef.current);
          requestOfferTimerRef.current = null;
        }
        if (!pc) {
          pendingOfferRef.current = msg.sdp;
          return;
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          for (const c of pendingCandidatesRef.current) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch {
              /* ignore */
            }
          }
          pendingCandidatesRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({
            type: 'broadcast',
            event: 'signaling',
            payload: { from: sessionId, type: 'answer', sdp: answer },
          });
        } catch (e) {
          console.error('[ListenBuddy] offer処理エラー:', e);
        }
      } else if (msg.type === 'answer' && msg.sdp && pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          for (const c of pendingCandidatesRef.current) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch {
              /* ignore */
            }
          }
          pendingCandidatesRef.current = [];
        } catch (e) {
          console.error('[ListenBuddy] answer処理エラー:', e);
        }
      } else if (msg.type === 'ice' && msg.candidate) {
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch {
            /* ignore */
          }
        } else {
          pendingCandidatesRef.current.push(msg.candidate);
        }
      } else if (msg.type === 'request-offer') {
        if (isInitiatorRef.current && pc) {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            channel.send({
              type: 'broadcast',
              event: 'signaling',
              payload: { from: sessionId, type: 'offer', sdp: offer },
            });
          } catch (e) {
            console.error('[ListenBuddy] 再送offerエラー:', e);
          }
        }
      } else if (msg.type === 'game-start' && typeof msg.startedAt === 'number') {
        gameStartedAtRef.current = msg.startedAt;
      } else if (msg.type === 'camera-state' && typeof msg.enabled === 'boolean') {
        setIsRemoteCameraOn(msg.enabled);
      } else if (msg.type === 'request-camera-state') {
        channel.send({
          type: 'broadcast',
          event: 'signaling',
          payload: { from: sessionId, type: 'camera-state', enabled: isVideoEnabledRef.current },
        });
      } else if (msg.type === 'hangup') {
        if (requestOfferTimerRef.current) {
          clearTimeout(requestOfferTimerRef.current);
          requestOfferTimerRef.current = null;
        }
        if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
        }
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        supabase.removeChannel(channel);
        channelRef.current = null;
        setStatus('ended');
        window.location.href = '/';
      }
    });

    channel.subscribe(async (subStatus) => {
      if (subStatus !== 'SUBSCRIBED') return;

      const { data: room } = await supabase
        .from('listen_buddy_rooms')
        .select('user1_session_id')
        .eq('id', roomId)
        .single();

      const isInitiator = room?.user1_session_id === sessionId;
      isInitiatorRef.current = isInitiator;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getVideoTracks().forEach((t) => { t.enabled = false; });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setHasLocalStream(true);

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      pcRef.current = pc;

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.ontrack = (e) => {
        if (remoteVideoRef.current && e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0];
        }
        setStatus('connected');
        const startedAt = Date.now();
        gameStartedAtRef.current = startedAt;
        if (isInitiator) {
          channel.send({
            type: 'broadcast',
            event: 'signaling',
            payload: { from: sessionId, type: 'game-start', startedAt },
          });
        }
        setGamePhase('talking');
        setTimeRemaining(TALKING_SECONDS);
        channel.send({
          type: 'broadcast',
          event: 'signaling',
          payload: { from: sessionId, type: 'request-camera-state' },
        });
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          channel.send({
            type: 'broadcast',
            event: 'signaling',
            payload: { from: sessionId, type: 'ice', candidate: e.candidate.toJSON() },
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          console.warn('[ListenBuddy] connectionState:', pc.connectionState);
        }
      };

      const pendingOffer = pendingOfferRef.current;
      pendingOfferRef.current = null;
      if (requestOfferTimerRef.current) {
        clearTimeout(requestOfferTimerRef.current);
        requestOfferTimerRef.current = null;
      }

      channel.send({
        type: 'broadcast',
        event: 'signaling',
        payload: { from: sessionId, type: 'camera-state', enabled: false },
      });

      if (pendingOffer) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
          for (const c of pendingCandidatesRef.current) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch {
              /* ignore */
            }
          }
          pendingCandidatesRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({
            type: 'broadcast',
            event: 'signaling',
            payload: { from: sessionId, type: 'answer', sdp: answer },
          });
        } catch (e) {
          console.error('[ListenBuddy] 受理offer処理エラー:', e);
        }
      } else if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        channel.send({
          type: 'broadcast',
          event: 'signaling',
          payload: { from: sessionId, type: 'offer', sdp: offer },
        });
      } else {
        requestOfferTimerRef.current = setTimeout(() => {
          channel.send({
            type: 'broadcast',
            event: 'signaling',
            payload: { from: sessionId, type: 'request-offer' },
          });
        }, 2000);
      }
    });

    return () => {
      cleanup();
    };
  }, [roomId, sessionId, cleanup]);

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-900">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-4 py-3 bg-zinc-800 text-white">
        <h1 className="text-lg font-bold">傾聴ゲーム</h1>
        <span className="text-sm text-zinc-300 flex-1 text-center flex items-center justify-center gap-2">
          {status === 'connecting' && '接続中...'}
          {status === 'connected' && (
            <>
              {gamePhase === 'talking' && (
                <span className="font-mono bg-zinc-700 px-2 py-0.5 rounded">
                  残り {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
                </span>
              )}
              {gamePhase === 'summary' && (
                <span className="font-mono bg-amber-600 px-2 py-0.5 rounded">
                  要約 {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
                </span>
              )}
              {gamePhase === 'done' && '完了'}
              {gamePhase !== 'done' && '通話中'}
            </>
          )}
          {status === 'ended' && '終了'}
        </span>
        <button
          type="button"
          onClick={async () => {
            channelRef.current?.send({
              type: 'broadcast',
              event: 'signaling',
              payload: { from: sessionId, type: 'hangup' },
            });
            await new Promise((r) => setTimeout(r, 100));
            cleanup();
            router.push('/');
          }}
          className="text-sm text-zinc-400 hover:text-white min-w-[80px] text-right"
        >
          トップに戻る
        </button>
      </header>

      {/* 質問カード（通話中・要約中のみ） */}
      {status === 'connected' && (gamePhase === 'talking' || gamePhase === 'summary') && (
        <div className="absolute top-14 left-4 right-4 z-20 pointer-events-none">
          <div className={`max-w-md mx-auto p-4 rounded-xl shadow-lg ${
            gamePhase === 'talking'
              ? 'bg-gradient-to-br from-violet-600 to-purple-700 text-white'
              : 'bg-gradient-to-br from-amber-600 to-orange-600 text-white'
          }`}>
            <p className="text-xs font-medium opacity-90 mb-1">
              {gamePhase === 'talking' ? '📌 この質問で聞いてみよう' : '📝 1分で要約する時間'}
            </p>
            <p className="text-base font-bold">
              {gamePhase === 'talking' ? questionText : '相手の話を1分で要約して伝えましょう'}
            </p>
            <p className="text-xs opacity-80 mt-2">
              {gamePhase === 'talking'
                ? '（3分経過後、自動で要約フェーズに切り替わります）'
                : '（1分経つと自動で終了します）'}
            </p>
          </div>
        </div>
      )}

      {/* 完了メッセージ（案A: BuddyShare誘導） */}
      {status === 'connected' && gamePhase === 'done' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-800 rounded-2xl p-8 max-w-sm text-center text-white">
            <p className="text-2xl font-bold mb-2">お疲れ様でした！</p>
            <p className="text-sm text-zinc-400 mb-6">今日の傾聴セッション、お疲れ様でした</p>
            <p className="text-sm text-zinc-300 mb-6">
              体験をさらに深めるなら、BuddyShare で本格的なバディを始めませんか？
            </p>
            <div className="flex flex-col gap-3">
              <a
                href="https://myapp-hides-projects-19f80db4.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-violet-600 hover:bg-violet-500 px-6 py-3 text-white font-medium transition-colors"
              >
                BuddyShare の7日間お試しへ
              </a>
              <p className="text-xs text-zinc-500 mt-1">サイトパスワード: catcat</p>
              <button
                type="button"
                onClick={async () => {
                  channelRef.current?.send({
                    type: 'broadcast',
                    event: 'signaling',
                    payload: { from: sessionId, type: 'hangup' },
                  });
                  await new Promise((r) => setTimeout(r, 100));
                  cleanup();
                  router.push('/');
                }}
                className="rounded-full bg-zinc-600 hover:bg-zinc-500 px-6 py-2 text-white font-medium"
              >
                トップに戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ビデオエリア（左右2分割・BuddyShare風） */}
      <div className="flex-1 grid grid-cols-2 gap-4 p-4 min-h-0">
        {/* 自分の画面 */}
        <div className="relative rounded-lg overflow-hidden bg-zinc-800 border-2 border-zinc-600">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-contain bg-black ${!isVideoEnabled ? 'invisible' : ''}`}
          />
          <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/60 text-white text-xs">
            自分
          </div>
          {!hasLocalStream && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400">
              <span className="text-sm">自分の映像</span>
              <span className="text-xs mt-1">接続待機中...</span>
            </div>
          )}
          {hasLocalStream && !isVideoEnabled && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 bg-zinc-800 z-10">
              <svg className="w-10 h-10 mb-2 opacity-60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/></svg>
              <span className="text-sm">カメラがオフです</span>
            </div>
          )}
        </div>

        {/* 相手の画面 */}
        <div className="relative rounded-lg overflow-hidden bg-zinc-800 border-2 border-zinc-600">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-contain bg-black ${status === 'connected' && !isRemoteCameraOn ? 'invisible' : ''}`}
          />
          <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/60 text-white text-xs">
            相手
          </div>
          {status !== 'connected' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 bg-zinc-800 z-10">
              <span className="text-sm">相手の映像</span>
              <span className="text-xs mt-1">接続待機中...</span>
            </div>
          )}
          {status === 'connected' && !isRemoteCameraOn && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 bg-zinc-800 z-10">
              <svg className="w-10 h-10 mb-2 opacity-60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/></svg>
              <span className="text-sm">カメラがオフです</span>
            </div>
          )}
        </div>
      </div>

      {/* コントロールバー */}
      <div className="flex items-center justify-center gap-4 p-4 bg-zinc-800">
        {/* カメラ（BuddyShareと同様：オフ時はFiCameraOffで統一） */}
        <button
          type="button"
          onClick={() => {
            const next = !isVideoEnabled;
            setIsVideoEnabled(next);
            localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
            channelRef.current?.send({
              type: 'broadcast',
              event: 'signaling',
              payload: { from: sessionId, type: 'camera-state', enabled: next },
            });
          }}
          className={`rounded-full w-12 h-12 flex items-center justify-center text-white ${isVideoEnabled ? 'bg-blue-500 hover:bg-blue-600' : 'bg-zinc-600 hover:bg-zinc-500'}`}
          title={isVideoEnabled ? 'カメラをオフ' : 'カメラをオン'}
        >
          {isVideoEnabled ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/></svg>
          )}
        </button>
        {/* マイク（BuddyShareと同様：オフ時はマイクオフアイコン） */}
        <button
          type="button"
          onClick={() => {
            const next = !isMuted;
            setIsMuted(next);
            localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
          }}
          className={`rounded-full w-12 h-12 flex items-center justify-center text-white ${isMuted ? 'bg-zinc-600 hover:bg-zinc-500' : 'bg-blue-500 hover:bg-blue-600'}`}
          title={isMuted ? 'ミュート解除' : 'ミュート'}
        >
          {isMuted ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          )}
        </button>
        <button
          type="button"
          onClick={async () => {
            channelRef.current?.send({
              type: 'broadcast',
              event: 'signaling',
              payload: { from: sessionId, type: 'hangup' },
            });
            await new Promise((r) => setTimeout(r, 100));
            cleanup();
            router.push('/');
          }}
          className="rounded-full w-12 h-12 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white"
          title="終了"
        >
          <svg className="w-5 h-5 rotate-135" fill="currentColor" viewBox="0 0 24 24"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
        </button>
      </div>

    </div>
  );
}
