export async function withDeadline<T>(work: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Request timed out after ${milliseconds}ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
export async function requestJson<T>(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, timeoutMs = 4000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withDeadline(async () => {
        const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return await response.json() as T;
      }, timeoutMs);
    } catch (error) {
      if (attempt > 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 150));
    }
  }
}
