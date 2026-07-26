import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /* config options here */
    reactCompiler: true,
    turbopack: {
        root: __dirname,
    },
    async rewrites() {
        const backend =
            process.env.MIKE_BACKEND_INTERNAL_URL || "http://127.0.0.1:3001";
        return [
            {
                source: "/sitemap.xml",
                destination: "/api/sitemap/sitemap.xml",
            },
            {
                source: "/sitemap_:slug.xml",
                destination: "/api/sitemap/sitemap_:slug.xml",
            },
            // Same-origin proxy so browsers on Tailscale can reach the API
            // without hard-coding 127.0.0.1 (which is the user's laptop).
            {
                source: "/mike-api/:path*",
                destination: `${backend}/:path*`,
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
