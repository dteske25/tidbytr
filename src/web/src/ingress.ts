const INGRESS_PREFIX_PATTERN = /^(.*\/api\/hassio_ingress\/[^/]+)(?:\/.*)?$/;

export function appBasePath(pathname = window.location.pathname): string {
  const ingressMatch = pathname.match(INGRESS_PREFIX_PATTERN);
  if (ingressMatch?.[1]) {
    return `${ingressMatch[1]}/`;
  }

  if (pathname.endsWith("/")) {
    return pathname;
  }

  const lastSlash = pathname.lastIndexOf("/");
  return `${pathname.slice(0, lastSlash + 1)}`;
}

export function apiUrl(path: string, pathname = window.location.pathname): string {
  const cleanPath = path.replace(/^\/?api\/?/, "").replace(/^\/+/, "");
  return `${appBasePath(pathname)}api/${cleanPath}`;
}
