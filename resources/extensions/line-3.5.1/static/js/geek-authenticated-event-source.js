(() => {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;

  class GeekAuthenticatedEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;

    constructor(url, options = {}) {
      this.url = String(url);
      this.withCredentials = options.withCredentials === true;
      this.readyState = GeekAuthenticatedEventSource.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this._listeners = new Map();
      this._controller = new AbortController();
      this._closedByUser = false;
      this._lastEventId = '';
      this.completed = this._connect();
    }

    addEventListener(type, listener) {
      if (typeof listener !== 'function') return;
      const listeners = this._listeners.get(type) || new Set();
      listeners.add(listener);
      this._listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this._listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event) {
      for (const listener of this._listeners.get(event.type) || []) {
        try { listener.call(this, event); } catch (error) { queueMicrotask(() => { throw error; }); }
      }
      const handler = this[`on${event.type}`];
      if (typeof handler === 'function') handler.call(this, event);
      return true;
    }

    close() {
      this._closedByUser = true;
      this.readyState = GeekAuthenticatedEventSource.CLOSED;
      this._controller.abort();
    }

    async _connect() {
      try {
        const tokenManager = root.g_plugin_enc?.();
        const accessToken = tokenManager?.getAccessToken?.() || '';
        if (!accessToken) throw new Error('LINE access token unavailable');
        const parsed = new URL(this.url);
        const path = `${parsed.pathname}${parsed.search}`;
        const hmacManager = root.g_plugin_hmac?.();
        if (!hmacManager?.getHmac) throw new Error('LINE HMAC manager unavailable');
        const hmac = await hmacManager.getHmac({ accessToken, path, body: undefined });
        if (!hmac) throw new Error('LINE HMAC unavailable');

        const response = await root.fetch(this.url, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'X-Line-Access': accessToken,
            'X-Hmac': hmac
          },
          credentials: this.withCredentials ? 'include' : 'same-origin',
          cache: 'no-store',
          signal: this._controller.signal
        });
        if (!response.ok) throw new Error(`LINE event stream HTTP ${response.status}`);
        if (!response.body?.getReader) throw new Error('LINE event stream body unavailable');

        this.readyState = GeekAuthenticatedEventSource.OPEN;
        this.dispatchEvent(new Event('open'));
        await this._consume(response.body.getReader());
        if (!this._closedByUser) this.dispatchEvent(new Event('error'));
      } catch (error) {
        if (!this._closedByUser && error?.name !== 'AbortError') {
          const event = new Event('error');
          event.error = error;
          this.dispatchEvent(event);
        }
      } finally {
        this.readyState = GeekAuthenticatedEventSource.CLOSED;
      }
    }

    async _consume(reader) {
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this._dispatchBlock(block);
        }
        if (done) break;
      }
      if (buffer.trim()) this._dispatchBlock(buffer);
    }

    _dispatchBlock(block) {
      let eventType = 'message';
      const data = [];
      for (const line of String(block).split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator === -1 ? line : line.slice(0, separator);
        let value = separator === -1 ? '' : line.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event' && value) eventType = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id' && !value.includes('\0')) this._lastEventId = value;
      }
      if (!data.length) return;
      this.dispatchEvent(new MessageEvent(eventType, {
        data: data.join('\n'),
        lastEventId: this._lastEventId,
        origin: new URL(this.url).origin
      }));
    }
  }

  GeekAuthenticatedEventSource.prototype.CONNECTING = GeekAuthenticatedEventSource.CONNECTING;
  GeekAuthenticatedEventSource.prototype.OPEN = GeekAuthenticatedEventSource.OPEN;
  GeekAuthenticatedEventSource.prototype.CLOSED = GeekAuthenticatedEventSource.CLOSED;
  root.GeekAuthenticatedEventSource = GeekAuthenticatedEventSource;
  if (typeof module !== 'undefined' && module.exports) module.exports = GeekAuthenticatedEventSource;
})();
