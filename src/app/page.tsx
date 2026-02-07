import Link from "next/link";

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
          className="rounded-full bg-zinc-900 px-8 py-3 text-lg font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          ゲーム開始
        </Link>
      </main>
    </div>
  );
}
