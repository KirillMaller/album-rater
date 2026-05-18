const proxyUrl = process.env.VITE_YANDEX_PROXY_URL || 'https://195.208.3.209.sslip.io';
const healthUrl = new URL('/health', proxyUrl).toString();

const timeoutMs = Number(process.env.PROXY_HEALTH_TIMEOUT_MS || 10000);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const startedAt = Date.now();
  const response = await fetch(healthUrl, { signal: controller.signal });
  const elapsedMs = Date.now() - startedAt;
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  const data = JSON.parse(body);
  if (data.ok !== true || data.service !== 'yandex-music-proxy') {
    throw new Error(`Unexpected health response: ${body}`);
  }

  console.log(`Yandex proxy is healthy: ${healthUrl} (${elapsedMs} ms)`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Yandex proxy health check failed: ${healthUrl}`);
  console.error(message);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
