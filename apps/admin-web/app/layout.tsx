import type { Metadata, Viewport } from 'next';
import { APP_BRAND } from '@jongno/shared';
import './globals.css';
export const metadata: Metadata = { title: APP_BRAND.name, description: '현장 · 작업 · 정산 관리', manifest:'/manifest.webmanifest', appleWebApp:{capable:true,statusBarStyle:'default',title:APP_BRAND.name}, icons:{icon:'/icons/app-192.png',apple:'/icons/app-180.png'} };
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#213e59'};
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ko"><body>{children}</body></html>; }
