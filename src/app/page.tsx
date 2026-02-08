import Link from "next/link";

const BUDDYSHARE_URL = 'https://myapp-hides-projects-19f80db4.vercel.app';
const BUDDYSHARE_SITE_PASSWORD = 'catcat';

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-8 px-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Listen Buddy
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          傾聴ゲームで聞く力を磨こう
        </p>
        <Link
          href="/game"
          className="rounded-full bg-zinc-900 px-8 py-3 text-lg font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-center"
        >
          ゲーム開始
          <span className="block text-sm font-normal opacity-90 mt-1">（マッチング後、ランダムな相手とテレビ通話が始まります）</span>
        </Link>

        {/* 案B: BuddyShare について */}
        <section className="mt-8 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 mb-2">
            BuddyShare について
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
            目標達成・習慣化をバディと一緒に。定期的なミーティングで、互いに傾聴し合い、進捗を報告し合うサービスです。
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mb-4">
            サイトパスワード: {BUDDYSHARE_SITE_PASSWORD}
          </p>
          <a
            href={BUDDYSHARE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400"
          >
            BuddyShare を詳しく見る →
          </a>
        </section>
      </main>
    </div>
  );
}
