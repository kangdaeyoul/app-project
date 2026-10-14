import type { NextConfig } from 'next';
const config: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_VERSION: process.env.RENDER_GIT_COMMIT ?? process.env.APP_BUILD_VERSION ?? `local-${new Date().toISOString()}` },
  async headers(){return [{source:'/',headers:[{key:'Cache-Control',value:'no-store, no-cache, max-age=0, must-revalidate'}]},{source:'/login',headers:[{key:'Cache-Control',value:'no-store, no-cache, max-age=0, must-revalidate'}]},{source:'/api/auth/:path*',headers:[{key:'Cache-Control',value:'no-store, no-cache, max-age=0, must-revalidate'}]},{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/'},{key:'X-Content-Type-Options',value:'nosniff'}]},{source:'/manifest.webmanifest',headers:[{key:'Cache-Control',value:'no-cache'}]}];},
  async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://127.0.0.1:4000'}/api/:path*` }]; },
};
export default config;
