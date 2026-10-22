/**
 * 判断监听地址是否只对本机可见。
 *
 * 这个判断用于启动时提示误配：容器里把 HOST 设成 127.0.0.1 时，
 * 进程只在容器自己的 loopback 上监听，宿主机 `-p 8765:8765` 的端口映射
 * 指向容器 eth0，反向代理必然拿到 connection refused（nginx 侧表现为 502）。
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized === "" || normalized === "localhost") {
    return true;
  }
  if (normalized === "::1" || normalized === "[::1]") {
    return true;
  }
  return normalized.startsWith("127.");
}

/**
 * 监听地址只对本机可见时返回警告文案，否则返回 undefined。
 */
export function buildBindAddressWarning(host: string, port: number): string | undefined {
  if (!isLoopbackHost(host)) {
    return undefined;
  }
  return (
    `[relay] 警告：监听地址是 ${host}:${port}，只有本机可访问。` +
    `\n[relay] 容器或反向代理场景请设置 HOST=0.0.0.0，否则外部连接会得到 502 / connection refused。`
  );
}
