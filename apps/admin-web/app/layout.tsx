import type { Metadata } from 'next';
import { APP_NAME } from '@jongno/shared';
import './globals.css';
export const metadata: Metadata = { title: APP_NAME, description: '종로소방 현장 · 작업 · 정산 관리' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ko"><body>{children}</body></html>; }
