import type { NextConfig } from "next";

const BACKEND = process.env.BUCHNATIVE_API_PROXY ?? "http://127.0.0.1:8080";

const nextConfig: NextConfig = {
  // Достъп до dev сървъра от LAN (друго устройство отваря http://192.168.1.146:3000):
  // Next 15.2+ блокира cross-origin dev заявки по подразбиране — HMR websocket-ът
  // (ws://192.168.1.146:3000/_next/hmr) се отказва без този списък.
  allowedDevOrigins: ["192.168.1.146"],
  // Браузърът говори само с :3000. Next проксира API-то към backend-а —
  // иначе localhost:8080 от LAN е чужда машина, а ::1 няма слушател (само IPv4).
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${BACKEND}/v1/:path*` },
      { source: "/ready", destination: `${BACKEND}/ready` },
      { source: "/health", destination: `${BACKEND}/health` },
    ];
  },
};

export default nextConfig;
