import type { Metadata } from 'next';
import { APP_BRAND } from '@jongno/shared';
import './globals.css';
export const metadata: Metadata = { title: APP_BRAND.name, description: '현장 · 작업 · 정산 관리' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ko"><body>{children}</body></html>; }
