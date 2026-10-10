import type { NextConfig } from 'next';
const config: NextConfig = {
  async headers(){return [{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/'},{key:'X-Content-Type-Options',value:'nosniff'}]},{source:'/manifest.webmanifest',headers:[{key:'Cache-Control',value:'no-cache'}]}];},
  async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://127.0.0.1:4000'}/api/:path*` }]; },
};
export default config;
