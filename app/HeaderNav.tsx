'use client';

// Context-aware header nav (client island — needs the current path).
// On /admin → a back-to-app button. Elsewhere → a "Work with ZeroIndex" CTA → intake.
// Unified model (2026-05-30): every subdomain app opens from the apex in a NEW
// tab, so a "back to zeroindex" button is redundant (the apex stays open behind
// it) and its ← would mislead. Instead the header converts — to intake, in a new
// tab. The brand logo (left) is the path home; the /admin branch is unchanged.
// Only intake itself keeps the apex back-link (converting to itself = circular).
// See the zeroindex-app-layout skill. The Admin entry point lives in the footer.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function HeaderNav({ appName }: { appName: string }) {
  const pathname = usePathname();
  const onAdmin = pathname === '/admin' || pathname.startsWith('/admin/');

  if (onAdmin) {
    return (
      <Link href="/" className="btn-primary">
        <span aria-hidden="true">&larr;</span>
        {appName}
      </Link>
    );
  }

  return (
    <a href="https://intake.zeroindex.ai" target="_blank" rel="noopener" className="btn-primary">
      Work with ZeroIndex
    </a>
  );
}
