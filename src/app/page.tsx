'use client';

/**
 * PixelForge Studio — entry point.
 * The full editor workspace is loaded client-side only (canvas APIs require it).
 */

import dynamic from 'next/dynamic';

const EditorPlaceholder = dynamic(() => import('@/workspace/EditorRoot'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-[#17181c] text-neutral-400">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-neutral-700 border-t-emerald-400" />
        <p className="text-sm">Loading PixelForge Studio…</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <EditorPlaceholder />;
}
