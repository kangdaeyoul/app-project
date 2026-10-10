import type { MetadataRoute } from "next";
import { APP_BRAND } from "@jongno/shared";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_BRAND.name,
    short_name: APP_BRAND.name,
    description: "현장 일정, 작업기록과 사진을 한곳에서",
    lang: "ko",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f6f8",
    theme_color: "#213e59",
    icons: [
      {
        src: "/icons/app-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
