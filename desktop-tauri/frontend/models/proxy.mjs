// UX validation only. Rust remains the authority for every native request.
export function proxyFromFields(mode, host, port) {
  if (mode === 'system') return { mode: 'system' };
  const value = String(port).trim();
  const address = String(host).trim();
  if (!['http', 'socks5'].includes(mode) || !/^[0-9]{1,5}$/.test(value)
      || Number(value) < 1 || Number(value) > 65535
      || !/^[a-zA-Z0-9.:[\]-]{1,253}$/.test(address)) throw 'PROXY_INVALID';
  return { mode, host: address, port: Number(value) };
}
