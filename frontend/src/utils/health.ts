const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 轮询后端健康检查端点，等待后端就绪。
 * 对齐旧前端 waitForBackendReady 逻辑。
 *
 * @param maxWaitMs  最长等待时间 (ms)，默认 45000
 * @param intervalMs 轮询间隔 (ms)，默认 1500
 * @returns 后端就绪时 resolve true，超时 reject
 */
export async function waitForBackendReady(
  maxWaitMs = 45000,
  intervalMs = 1500,
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return false;
  }

  const deadline = Date.now() + Math.max(1000, maxWaitMs);
  const interval = Math.max(300, intervalMs);

  while (Date.now() < deadline) {
    try {
      const response = await fetch('/healthz', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json, text/plain, */*',
        },
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // 后端预热中，忽略临时错误
    }
    await sleep(interval);
  }

  throw new Error('后端启动超时，请检查服务状态');
}
