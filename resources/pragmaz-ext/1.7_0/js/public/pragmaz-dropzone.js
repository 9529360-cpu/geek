(() => {
  var e,
    t,
    n,
    a,
    o = {
      7: (e) => {
        'use strict';
        var t,
          n = 'object' == typeof Reflect ? Reflect : null,
          a =
            n && 'function' == typeof n.apply
              ? n.apply
              : function (e, t, n) {
                  return Function.prototype.apply.call(e, t, n);
                };
        t =
          n && 'function' == typeof n.ownKeys
            ? n.ownKeys
            : Object.getOwnPropertySymbols
              ? function (e) {
                  return Object.getOwnPropertyNames(e).concat(Object.getOwnPropertySymbols(e));
                }
              : function (e) {
                  return Object.getOwnPropertyNames(e);
                };
        var o =
          Number.isNaN ||
          function (e) {
            return e != e;
          };
        function s() {
          s.init.call(this);
        }
        ((e.exports = s),
          (e.exports.once = function (e, t) {
            return new Promise(function (n, a) {
              function o(n) {
                (e.removeListener(t, s), a(n));
              }
              function s() {
                ('function' == typeof e.removeListener && e.removeListener('error', o), n([].slice.call(arguments)));
              }
              (m(e, t, s, { once: !0 }),
                'error' !== t &&
                  (function (e, t, n) {
                    'function' == typeof e.on && m(e, 'error', t, { once: !0 });
                  })(e, o));
            });
          }),
          (s.EventEmitter = s),
          (s.prototype._events = void 0),
          (s.prototype._eventsCount = 0),
          (s.prototype._maxListeners = void 0));
        var i = 10;
        function r(e) {
          if ('function' != typeof e) throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof e);
        }
        function l(e) {
          return void 0 === e._maxListeners ? s.defaultMaxListeners : e._maxListeners;
        }
        function c(e, t, n, a) {
          var o, s, i, c;
          if (
            (r(n),
            void 0 === (s = e._events)
              ? ((s = e._events = Object.create(null)), (e._eventsCount = 0))
              : (void 0 !== s.newListener && (e.emit('newListener', t, n.listener ? n.listener : n), (s = e._events)), (i = s[t])),
            void 0 === i)
          )
            ((i = s[t] = n), ++e._eventsCount);
          else if (('function' == typeof i ? (i = s[t] = a ? [n, i] : [i, n]) : a ? i.unshift(n) : i.push(n), (o = l(e)) > 0 && i.length > o && !i.warned)) {
            i.warned = !0;
            var d = new Error('Possible EventEmitter memory leak detected. ' + i.length + ' ' + String(t) + ' listeners added. Use emitter.setMaxListeners() to increase limit');
            ((d.name = 'MaxListenersExceededWarning'), (d.emitter = e), (d.type = t), (d.count = i.length), (c = d), console && console.warn && console.warn(c));
          }
          return e;
        }
        function d() {
          if (!this.fired)
            return (this.target.removeListener(this.type, this.wrapFn), (this.fired = !0), 0 === arguments.length ? this.listener.call(this.target) : this.listener.apply(this.target, arguments));
        }
        function p(e, t, n) {
          var a = { fired: !1, wrapFn: void 0, target: e, type: t, listener: n },
            o = d.bind(a);
          return ((o.listener = n), (a.wrapFn = o), o);
        }
        function u(e, t, n) {
          var a = e._events;
          if (void 0 === a) return [];
          var o = a[t];
          return void 0 === o
            ? []
            : 'function' == typeof o
              ? n
                ? [o.listener || o]
                : [o]
              : n
                ? (function (e) {
                    for (var t = new Array(e.length), n = 0; n < t.length; ++n) t[n] = e[n].listener || e[n];
                    return t;
                  })(o)
                : h(o, o.length);
        }
        function g(e) {
          var t = this._events;
          if (void 0 !== t) {
            var n = t[e];
            if ('function' == typeof n) return 1;
            if (void 0 !== n) return n.length;
          }
          return 0;
        }
        function h(e, t) {
          for (var n = new Array(t), a = 0; a < t; ++a) n[a] = e[a];
          return n;
        }
        function m(e, t, n, a) {
          if ('function' == typeof e.on) a.once ? e.once(t, n) : e.on(t, n);
          else {
            if ('function' != typeof e.addEventListener) throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof e);
            e.addEventListener(t, function o(s) {
              (a.once && e.removeEventListener(t, o), n(s));
            });
          }
        }
        (Object.defineProperty(s, 'defaultMaxListeners', {
          enumerable: !0,
          get: function () {
            return i;
          },
          set: function (e) {
            if ('number' != typeof e || e < 0 || o(e)) throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + e + '.');
            i = e;
          },
        }),
          (s.init = function () {
            ((void 0 !== this._events && this._events !== Object.getPrototypeOf(this)._events) || ((this._events = Object.create(null)), (this._eventsCount = 0)),
              (this._maxListeners = this._maxListeners || void 0));
          }),
          (s.prototype.setMaxListeners = function (e) {
            if ('number' != typeof e || e < 0 || o(e)) throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + e + '.');
            return ((this._maxListeners = e), this);
          }),
          (s.prototype.getMaxListeners = function () {
            return l(this);
          }),
          (s.prototype.emit = function (e) {
            for (var t = [], n = 1; n < arguments.length; n++) t.push(arguments[n]);
            var o = 'error' === e,
              s = this._events;
            if (void 0 !== s) o = o && void 0 === s.error;
            else if (!o) return !1;
            if (o) {
              var i;
              if ((t.length > 0 && (i = t[0]), i instanceof Error)) throw i;
              var r = new Error('Unhandled error.' + (i ? ' (' + i.message + ')' : ''));
              throw ((r.context = i), r);
            }
            var l = s[e];
            if (void 0 === l) return !1;
            if ('function' == typeof l) a(l, this, t);
            else {
              var c = l.length,
                d = h(l, c);
              for (n = 0; n < c; ++n) a(d[n], this, t);
            }
            return !0;
          }),
          (s.prototype.addListener = function (e, t) {
            return c(this, e, t, !1);
          }),
          (s.prototype.on = s.prototype.addListener),
          (s.prototype.prependListener = function (e, t) {
            return c(this, e, t, !0);
          }),
          (s.prototype.once = function (e, t) {
            return (r(t), this.on(e, p(this, e, t)), this);
          }),
          (s.prototype.prependOnceListener = function (e, t) {
            return (r(t), this.prependListener(e, p(this, e, t)), this);
          }),
          (s.prototype.removeListener = function (e, t) {
            var n, a, o, s, i;
            if ((r(t), void 0 === (a = this._events))) return this;
            if (void 0 === (n = a[e])) return this;
            if (n === t || n.listener === t) 0 == --this._eventsCount ? (this._events = Object.create(null)) : (delete a[e], a.removeListener && this.emit('removeListener', e, n.listener || t));
            else if ('function' != typeof n) {
              for (o = -1, s = n.length - 1; s >= 0; s--)
                if (n[s] === t || n[s].listener === t) {
                  ((i = n[s].listener), (o = s));
                  break;
                }
              if (o < 0) return this;
              (0 === o
                ? n.shift()
                : (function (e, t) {
                    for (; t + 1 < e.length; t++) e[t] = e[t + 1];
                    e.pop();
                  })(n, o),
                1 === n.length && (a[e] = n[0]),
                void 0 !== a.removeListener && this.emit('removeListener', e, i || t));
            }
            return this;
          }),
          (s.prototype.off = s.prototype.removeListener),
          (s.prototype.removeAllListeners = function (e) {
            var t, n, a;
            if (void 0 === (n = this._events)) return this;
            if (void 0 === n.removeListener)
              return (
                0 === arguments.length
                  ? ((this._events = Object.create(null)), (this._eventsCount = 0))
                  : void 0 !== n[e] && (0 == --this._eventsCount ? (this._events = Object.create(null)) : delete n[e]),
                this
              );
            if (0 === arguments.length) {
              var o,
                s = Object.keys(n);
              for (a = 0; a < s.length; ++a) 'removeListener' !== (o = s[a]) && this.removeAllListeners(o);
              return (this.removeAllListeners('removeListener'), (this._events = Object.create(null)), (this._eventsCount = 0), this);
            }
            if ('function' == typeof (t = n[e])) this.removeListener(e, t);
            else if (void 0 !== t) for (a = t.length - 1; a >= 0; a--) this.removeListener(e, t[a]);
            return this;
          }),
          (s.prototype.listeners = function (e) {
            return u(this, e, !0);
          }),
          (s.prototype.rawListeners = function (e) {
            return u(this, e, !1);
          }),
          (s.listenerCount = function (e, t) {
            return 'function' == typeof e.listenerCount ? e.listenerCount(t) : g.call(e, t);
          }),
          (s.prototype.listenerCount = g),
          (s.prototype.eventNames = function () {
            return this._eventsCount > 0 ? t(this._events) : [];
          }));
      },
      759: (e, t, n) => {
        'use strict';
        const a = n(276);
        e.exports = (e) => {
          if (!a(e)) return !1;
          const t = e.trim().match(a.regex),
            n = {};
          if (t[1]) {
            n.mediaType = t[1].toLowerCase();
            const e = t[1].split(';').map((e) => e.toLowerCase());
            ((n.contentType = e[0]),
              e.slice(1).forEach((e) => {
                const t = e.split('=');
                n[t[0]] = t[1];
              }));
          }
          return (
            (n.base64 = !!t[t.length - 2]),
            (n.data = t[t.length - 1] || ''),
            (n.toBuffer = () => {
              const e = n.base64 ? 'base64' : 'utf8';
              return Buffer.from(n.base64 ? n.data : decodeURIComponent(n.data), e);
            }),
            n
          );
        };
      },
      276: function (e, t) {
        var n, a;
        void 0 ===
          (a =
            'function' ==
            typeof (n = function () {
              'use strict';
              function e(t) {
                return e.regex.test((t || '').trim());
              }
              return ((e.regex = /^data:([a-z]+\/[a-z0-9-+.]+(;[a-z0-9-.!#$%*+.{}|~`]+=[a-z0-9-.!#$%*+.{}()_|~`]+)*)?(;base64)?,([a-z0-9!$&',()*+;=\-._~:@\/?%\s<>]*?)$/i), e);
            })
              ? n.apply(t, [])
              : n) || (e.exports = a);
      },
      445: (e, t, n) => {
        'use strict';
        (n.r(t), n.d(t, { evc: () => W, gvc: () => A, svc: () => y }));
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebVoipStartCall'),
          s = (0, a.WhatsUpLoad)('WAWebWidFactory'),
          i = (0, a.WhatsUpLoad)('WAWebBackendApi');
        let r = null,
          l = null,
          c = null,
          d = null,
          p = null,
          u = null,
          g = !1,
          h = null;
        function m() {
          d && ((navigator.mediaDevices.getUserMedia = d), (d = null));
        }
        function f() {
          u && (clearInterval(u), (u = null));
        }
        function b() {
          return h ? Math.round((Date.now() - h) / 1e3) : 0;
        }
        function w() {
          if ((f(), m(), (c = null), (p = null), (l = null), (h = null), (g = !1), r)) {
            try {
              r.close();
            } catch (e) {}
            r = null;
          }
        }
        async function y(e, t, n = 30, y = 1) {
          return (
            console.log('\n🎯 ═══════════════════════════════════'),
            console.log('🎯 WUPE.call.svc - VoIP Call'),
            console.log('═══════════════════════════════════\n'),
            new Promise(async (W) => {
              let A = !1;
              const S = (e) => {
                A || ((A = !0), w(), W(e));
              };
              try {
                if (
                  ((g = !1),
                  !(await (async function () {
                    (console.log('🔧 Verificando VoIP WASM...\n'), localStorage.setItem('wa_calls_enabled', 'true'));
                    try {
                      (0, a.WhatsUpLoad)('WAWebEventsWaitForOfflineDeliveryEnd').initWaitForOfflineDeliveryEnd();
                      const e = (0, a.WhatsUpLoad)('WAWebVoipGatingUtils'),
                        t = (0, a.WhatsUpLoad)('WAWebVoipBackendLoadable'),
                        n = e.isCallingEnabled();
                      (console.log('📞 isCallingEnabled:', n), n || console.log('⚠️ Calling não está habilitado, tentando forçar...'), console.log('⏳ Carregando VoIP Backend...'));
                      const o = await t.requireVoipJsBackend();
                      return (console.log('⏳ Inicializando WAWebVoip...'), await o.WAWebVoipInit.initWAWebVoip(), console.log('✅ VoIP WASM carregado com sucesso!\n'), !0);
                    } catch (e) {
                      return (console.error('❌ Erro ao carregar VoIP WASM:', e), !1);
                    }
                    localStorage.removeItem('wa_calls_enabled');
                  })()))
                )
                  throw new Error('Não foi possível inicializar o módulo VoIP');
                (await (async function (e) {
                  console.log('🎤 Preparando áudio...');
                  const t = await (async function (e) {
                      if ('string' == typeof e && (e.startsWith('http') || e.startsWith('/'))) return (await fetch(e)).arrayBuffer();
                      if ('string' == typeof e && e.includes('base64')) {
                        const t = e.split(',')[1] || e,
                          n = atob(t),
                          a = new Uint8Array(n.length);
                        for (let e = 0; e < n.length; e++) a[e] = n.charCodeAt(e);
                        return a.buffer;
                      }
                      if ('string' == typeof e)
                        try {
                          const t = atob(e),
                            n = new Uint8Array(t.length);
                          for (let e = 0; e < t.length; e++) n[e] = t.charCodeAt(e);
                          return n.buffer;
                        } catch (e) {
                          throw new Error('Invalid audio source string');
                        }
                      if (e instanceof Blob || e instanceof File) return e.arrayBuffer();
                      if (e instanceof ArrayBuffer) return e;
                      throw new Error('Invalid audio source type');
                    })(e),
                    n = new AudioContext({ sampleRate: 48e3 }),
                    a = await n.decodeAudioData(t);
                  console.log('✅ Carregado:', a.duration.toFixed(2) + 's');
                  const o = await (async function (e) {
                    const t = e.getChannelData(0),
                      n = 16e3 / e.sampleRate,
                      a = Math.round(t.length * n),
                      o = new Float32Array(a);
                    for (let e = 0; e < a; e++) {
                      const a = e / n,
                        s = Math.floor(a);
                      let i = 0,
                        r = 0;
                      for (let e = -2; e <= 3; e++) {
                        const n = s + e;
                        if (n >= 0 && n < t.length) {
                          const e = a - n;
                          let o;
                          if (0 === e) o = 1;
                          else {
                            const t = Math.PI * e;
                            o = (3 * Math.sin(t) * Math.sin(t / 3)) / (t * t);
                          }
                          ((i += t[n] * o), (r += o));
                        }
                      }
                      o[e] = r > 0 ? i / r : 0;
                    }
                    let s = 0;
                    for (let e = 0; e < o.length; e++) s += o[e];
                    const i = s / o.length;
                    for (let e = 0; e < o.length; e++) o[e] -= i;
                    let r = 0;
                    for (let e = 0; e < o.length; e++) r += o[e] * o[e];
                    const l = Math.sqrt(r / o.length),
                      c = l > 0 ? 0.15 / l : 1;
                    for (let e = 0; e < o.length; e++) o[e] *= c;
                    for (let e = 0; e < o.length; e++) {
                      const t = o[e],
                        n = Math.abs(t);
                      if (n > 0.8) {
                        const a = n - 0.8,
                          s = 0.8 + a * (0.1 / (0.1 + a));
                        o[e] = Math.sign(t) * Math.min(s, 0.95);
                      }
                    }
                    const d = Math.floor(160);
                    for (let e = 0; e < d; e++) o[e] *= e / d;
                    for (let e = 0; e < d; e++) o[o.length - 1 - e] *= e / d;
                    return o;
                  })(a);
                  return ((r = new AudioContext({ sampleRate: 16e3 })), (p = r.createBuffer(1, o.length, 16e3)), p.copyToChannel(o, 0), console.log('✅ Pronto!\n'), await n.close(), !0);
                })(t),
                  (d = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)),
                  (navigator.mediaDevices.getUserMedia = async (e) =>
                    e && e.audio
                      ? (console.log('🎤 getUserMedia interceptado!'),
                        (c = r.createBufferSource()),
                        (c.buffer = p),
                        (c.loop = !1),
                        (c.onended = () => {
                          (console.log('\n✅ Áudio finalizado!'),
                            setTimeout(async () => {
                              try {
                                (console.log('📞 Encerrando...'), (await i.frontendSendAndReceive('initializeVoipWasm')).endCall(2, !0), console.log('✅ Encerrado!\n'), f());
                              } catch (e) {}
                            }, 1e3));
                        }),
                        (l = r.createMediaStreamDestination()),
                        c.connect(l),
                        l.stream)
                      : d(e)),
                  await new Promise((e) => setTimeout(e, 1e3)),
                  console.log('📞 Chamando...'));
                const w = s.createWid(e.includes('@') ? e : e + '@c.us');
                (await o.startWAWebVoipCall(w, !1, 0, 0), console.log('✅ Chamada iniciada!\n'));
                try {
                  const e = await (async function (e = 30) {
                    return (
                      console.log(`⏳ Aguardando conexão (timeout: ${e}s)...\n`),
                      new Promise((t, n) => {
                        let a = 0;
                        const o = Math.floor((1e3 * e) / 200);
                        u = setInterval(async () => {
                          if ((a++, a > o)) return (console.log('⏱️ Timeout - Ninguém atendeu!\n'), f(), void n(new Error('NO_ANSWER')));
                          try {
                            const e = (await i.frontendSendAndReceive('initializeVoipWasm')).getCallInfo();
                            if ((a % 25 == 0 && console.log(`   Check #${a}: callInfo=${e ? 'OK' : 'VAZIO'}`), (!e || '' === e) && a > 15))
                              return (console.log('❌ Chamada encerrada!\n'), f(), void n(new Error('CALL_ENDED')));
                            if (e) {
                              const n = JSON.parse(e);
                              if (a % 25 == 0) {
                                const e = n.participants?.find((e) => !e.is_self);
                                console.log(`   call_state=${n.call_state}, rx_packets=${e?.rx_audio_packet_count || 0}`);
                              }
                              const o = n.participants?.find((e) => !e.is_self);
                              if (o && (o.rx_audio_packet_count || 0) >= 5) {
                                const e = n.participants?.find((e) => !e.is_self);
                                return (console.log('✅ CONECTADA! call_state=6, rx_packets:', e?.rx_audio_packet_count || 0, '\n'), f(), void t('CONNECTED'));
                              }
                            }
                          } catch (e) {
                            console.log('⚠️ Erro ao verificar status:', e.message);
                          }
                        }, 200);
                      })
                    );
                  })(n);
                  if ('CONNECTED' === e) {
                    if ((console.log(`⏳ ${y}s antes de tocar...\n`), await new Promise((e) => setTimeout(e, 1e3 * y)), c)) {
                      const e = c.onended;
                      c.onended = () => {
                        e && e();
                        const t = b();
                        S({ success: !0, missed: !1, duration: t, status: 'completed' });
                      };
                    }
                    c &&
                      !c._started &&
                      ((c._started = !0),
                      c.start(0),
                      (h = Date.now()),
                      console.log('▶️ TOCANDO!\n'),
                      console.log('👁️ Monitorando desligamento durante reprodução...\n'),
                      (u = setInterval(async () => {
                        try {
                          const e = (await i.frontendSendAndReceive('initializeVoipWasm')).getCallInfo();
                          if (!e || '' === e) {
                            if ((console.log('❌ Chamada desligada durante reprodução!\n'), (g = !0), f(), c))
                              try {
                                (c.stop(), console.log('⏹️ Áudio interrompido!\n'));
                              } catch (e) {}
                            m();
                          }
                        } catch (e) {
                          console.log('⚠️ Erro ao monitorar:', e.message);
                        }
                      }, 500)));
                    const e = setInterval(async () => {
                      try {
                        const t = (await i.frontendSendAndReceive('initializeVoipWasm')).getCallInfo();
                        if (!t || '' === t) {
                          clearInterval(e);
                          const t = b();
                          S({ success: !0, missed: !1, duration: t, status: 'ended', endedBy: 'peer' });
                        }
                      } catch (e) {}
                    }, 500);
                  }
                } catch (e) {
                  'CALL_ENDED' === e.message
                    ? (console.log('🔴 Chamada foi desligada (você ou contato)'), S({ success: !1, missed: !0, duration: 0, status: 'missed', error: 'Chamada encerrada antes de conectar' }))
                    : 'NO_ANSWER' === e.message
                      ? (console.log('🔴 Ninguém atendeu a chamada'), S({ success: !1, missed: !0, duration: 0, status: 'missed', error: 'Ninguém atendeu' }))
                      : S({ success: !1, missed: !1, duration: 0, status: 'failed', error: e.message });
                }
              } catch (e) {
                (console.error('❌ Erro:', e), S({ success: !1, missed: !1, duration: 0, status: 'failed', error: e.message || 'Erro ao iniciar chamada' }));
              }
            })
          );
        }
        async function W() {
          try {
            return ((await i.frontendSendAndReceive('initializeVoipWasm')).endCall(2, !0), w(), { success: !0 });
          } catch (e) {
            return { success: !1, error: e.message };
          }
        }
        async function A() {
          try {
            const e = (await i.frontendSendAndReceive('initializeVoipWasm')).getCallInfo();
            return e ? JSON.parse(e) : null;
          } catch (e) {
            return null;
          }
        }
      },
      974: (e, t, n) => {
        'use strict';
        n.d(t, { q: () => s });
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebMsgCollection')?.MsgCollection;
        function s(e) {
          return o.get(e);
        }
      },
      270: (e, t, n) => {
        'use strict';
        (n.r(t),
          n.d(t, {
            DCCAV: () => te,
            PanelChat: () => Ke,
            abrirChat: () => b,
            archiveChat: () => Le,
            chat: () => r,
            chat_: () => l,
            createUser: () => h,
            deleteChat: () => Ie,
            disableFilter: () => Ge,
            disableUnreadChatsOnTop: () => ze,
            downMedia: () => U,
            enableUnreadChatsOnTop: () => Be,
            entraKnal: () => C,
            enviaPix: () => ke,
            filtraChat: () => $e,
            get: () => i,
            getActive: () => p,
            getChatRealName: () => _,
            getFilterState: () => Fe,
            getMsg: () => L.q,
            getName: () => S,
            getNameStatus: () => A,
            getProfilePic: () => m,
            getRealName: () => v,
            listaTodosChats: () => s,
            pinChat: () => Ce,
            revokeMsg: () => Pe,
            saf: () => X,
            sendCall: () => Se,
            sendReact: () => _e,
            shareador: () => de,
            spm: () => ne,
            state: () => me,
            stn: () => ge,
            svm: () => ie,
            unMuteKnal: () => x,
          }));
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebChatCollection');
        function s() {
          return o.ChatCollection._models;
        }
        function i(e) {
          return o.ChatCollection.get(e);
        }
        function r() {
          return o.ChatCollection;
        }
        function l() {
          return o.ChatCollection;
        }
        const d = (0, a.WhatsUpLoad)('WAWebChatCollection');
        function p() {
          return d.ChatCollection.getActive();
        }
        const u = (0, a.WhatsUpLoad)('WAWebWidFactory'),
          g = (0, a.WhatsUpLoad)('WAWebGetProfilePicJob');
        function h(e) {
          return u.createUserWidOrThrow(e);
        }
        function m(e, t) {
          return g.getProfilePic(e, t);
        }
        const f = (0, a.WhatsUpLoad)('WAWebCmd');
        function b(e) {
          return f.Cmd.openChatBottom(e);
        }
        var w = n(452);
        const y = (0, a.WhatsUpLoad)('WAWebContactCollection'),
          W = (0, a.WhatsUpLoad)('WAWebChatCollection');
        function A(e) {
          let t = y.ContactCollection.get(e);
          return t ? t.pushname || t.name || t.verifiedName || i(e)?.formattedTitle || (0, w.q)(t.id?.user || e) : i(e)?.formattedTitle || (0, w.q)(e) || e;
        }
        function S(e) {
          let t = y.ContactCollection.get(e);
          return t ? t.name || (0, w.q)(t.id.user) : i(e)?.formattedTitle || (0, w.q)(e) || e;
        }
        function v(e) {
          let t = y.ContactCollection.get(e);
          return t ? t.pushname || t.verifiedName || (0, w.q)(t.id.user) : i(e)?.formattedTitle || (0, w.q)(e) || e;
        }
        function _(e) {
          let t = W.ChatCollection.get(e);
          return t ? t.pushname || t.verifiedName || (0, w.q)(t.id.user) : i(e)?.formattedTitle || (0, w.q)(e) || e;
        }
        const M = (0, a.WhatsUpLoad)('WAWebLoadNewsletterPreviewChatAction')?.loadNewsletterPreviewChat,
          E = (0, a.WhatsUpLoad)('WAWebMexJoinNewsletterJob')?.mexJoinNewsletter,
          T = (0, a.WhatsUpLoad)('WAWebNewsletterToggleMuteStateAction')?.unmuteNewsletterAction;
        function C(e, t = !0) {
          M(e).then(async (e) => {
            (await E(e.id._serialized), t && T(e.id, { eventSurface: 5 }));
          });
        }
        function x(e) {
          M(e).then(async (e) => {
            T(e.id, { eventSurface: 5 });
          });
        }
        const P = (0, a.WhatsUpLoad)('WAWebDownloadManager')?.downloadManager;
        async function U(e) {
          var t = window.require('WAWebStartMediaDownloadQpl').startMediaDownloadQpl({ entryPoint: 'DownloadMusicArtwork' });
          return ((e.userDownloadAttemptCount = 0), (e.downloadQpl = t), await P.downloadAndMaybeDecrypt(e));
        }
        var L = n(974),
          D = n(509);
        ((0, a.WhatsUpLoad)('useWAWebLinkPreview'), (0, a.WhatsUpLoad)('WAWebLinkPreviewChatAction'));
        const I = (0, a.WhatsUpLoad)('WAWebMediaUploadMmsThumbnail'),
          k = (0, a.WhatsUpLoad)('WAWebGenMinimalLinkPreviewChatAction'),
          R = k.genMinimalLinkPreview;
        k.genMinimalLinkPreview2 = k.genMinimalLinkPreview;
        const O = k.genMinimalLinkPreview2,
          N = (0, a.WhatsUpLoad)('WAWebMediaOpaqueData'),
          $ = (0, a.WhatsUpLoad)('WABase64'),
          B = (0, a.WhatsUpLoad)('WATimeUtils'),
          z = 200;
        var G = [];
        async function F(e) {
          const t = new TextDecoder(),
            n = 'https://wup.plus/prev.png?get=' + btoa(unescape(encodeURIComponent(e))).replace('/', '_'),
            o = await (0, a.fdp)(n)
              .then((e) => t.decode(e))
              .then((e) => JSON.parse(e))
              .catch((e) => console.log(e)),
            s = /^video/.test(o.mediaType);
          return { title: o.title, description: o.description, canonicalUrl: o.url, matchedText: e, richPreviewType: s ? 1 : 0, doNotPlayInline: !s, imageUrl: o.image };
        }
        async function K(e) {
          try {
            const t = await (0, a.downloadImage)(e).catch((e) => console.log(e));
            if (!t) return null;
            const n = await (function (e) {
                return new Promise((t, n) => {
                  const a = new Image();
                  ((a.crossOrigin = 'anonymous'),
                    (a.src = e),
                    (a.onerror = n),
                    (a.onload = () => {
                      try {
                        const e = document.createElement('canvas'),
                          n = e.getContext('2d');
                        ((e.width = z), (e.height = z));
                        const o = Math.min(a.width, a.height),
                          s = (a.width - o) / 2,
                          i = (a.height - o) / 2;
                        (n.drawImage(a, s, i, o, o, 0, 0, z, z), t(e.toDataURL('image/jpeg').replace(/^data:image\/jpeg;base64,/, '')));
                      } catch (e) {
                        n();
                      }
                    }));
                });
              })(t.data),
              o = t.data.replace('data:image/jpeg;base64,', ''),
              s = await N.createFromBase64Jpeg(o),
              i = new Uint8Array(32),
              r = (window.crypto.getRandomValues(i), { key: $.encodeB64(i), timestamp: B.unixTime() }),
              l = new AbortController(),
              c = await I({ thumbnail: s, mediaType: 'thumbnail-link', mediaKeyInfo: r, uploadOrigin: 1, forwardedFromWeb: !1, signal: l.signal, timeout: 3e3, isViewOnce: !1 }),
              d = c.mediaEntry;
            return {
              thumbnail: n,
              thumbnailHQ: o,
              mediaKey: d.mediaKey,
              mediaKeyTimestamp: d.mediaKeyTimestamp,
              thumbnailDirectPath: d.directPath,
              thumbnailSha256: c.filehash,
              thumbnailEncSha256: d.encFilehash,
              thumbnailWidth: t.width,
              thumbnailHeight: t.height,
            };
          } catch (e) {
            console.log(e);
          }
        }
        ((k.genMinimalLinkPreview2 = (0, a.wrapf)(O, (e, ...t) => {
          const [n] = t,
            o = 'string' == typeof n ? (0, a.WhatsUpLoad)('useWAWebLinkPreview').findFirstWebLink(n).url : n.url,
            s = G.find((e) => e.url == o);
          return new Promise(async (n) => {
            try {
              if (s) n(s);
              else {
                const e = await F(o);
                if (!e) throw new Error(`preview not found for ${o}`);
                const { imageUrl: t, ...a } = e;
                let s = {};
                t &&
                  (s = await K(t).catch((e) => {
                    console.log(e);
                  }));
                const i = { url: o, data: { ...a, ...s } };
                (G.push(i), n(i));
              }
            } catch (a) {
              (console.log(a), n(e(...t)));
            }
          });
        })),
          (k.genMinimalLinkPreview = (0, a.wrapf)(R, (e, ...t) => {
            const [n] = t,
              o = 'string' == typeof n ? (0, a.WhatsUpLoad)('useWAWebLinkPreview').findFirstWebLink(n).url : n.url,
              s = G.find((e) => e.url == o);
            return new Promise(async (n) => {
              try {
                if ('true' == localStorage.getItem('linkpreviwhqenabled'))
                  if (s) n(s);
                  else {
                    const e = await F(o);
                    if (!e) throw new Error(`preview not found for ${o}`);
                    const { imageUrl: t, ...a } = e;
                    let s = {};
                    t &&
                      (s = await K(t).catch((e) => {
                        console.log(e);
                      }));
                    const i = { url: o, data: { ...a, ...s } };
                    (G.push(i), n(i));
                  }
                else n(e(...t));
              } catch (a) {
                (console.log(a), n(e(...t)));
              }
            });
          })));
        var q = n(242);
        const H = (0, a.WhatsUpLoad)('WAWebUserPrefsMeUser'),
          j = (0, a.WhatsUpLoad)('WAWebMsgKey'),
          J = (0, a.WhatsUpLoad)('WAWebWidFactory'),
          V = (0, a.WhatsUpLoad)('WAWebMsgKeyNewId');
        ((0, a.WhatsUpLoad)('WAWebGetEphemeralFieldsMsgActionsUtils'),
          (0, a.WhatsUpLoad)('WATimeUtils'),
          (0, a.WhatsUpLoad)('useWAWebLinkPreview'),
          (0, a.WhatsUpLoad)('WAWebLinkPreviewChatAction'),
          (0, a.WhatsUpLoad)('WAWebLinkPreviewCache'),
          (0, a.WhatsUpLoad)('WAWebBackendJobsCommon').mediaTypeFromProtobuf);
        const Y = (0, a.WhatsUpLoad)('WAWebMediaOpaqueData').createFromData;
        async function X(e, t, n = {}) {
          let o = e.split('@')[1];
          if ('lid' == o) {
            let e = (0, a.WhatsUpLoad)('WAWebApiContact').getPhoneNumber((0, a.WhatsUpLoad)('WAWebWidFactory').createWid(c));
            e?._serialized && ((c = e._serialized), (o = c.split('@')[1]));
          }
          let s = 'status@broadcast' === e ? (0, q.Y)() : l().get(e);
          s || ('g.us' != o && 'c.us' != o)
            ? s ||
              'lid' != o ||
              (await (0, a.WhatsUpLoad)('WAWebCreateChat').createChat(
                { chatId: (0, a.WhatsUpLoad)('WAWebWidFactory').asUserLidOrThrow((0, a.WhatsUpLoad)('WAWebWidFactory').createWid(e)), accountLid: (0, a.WhatsUpLoad)('WAWebWidFactory').createWid(e) },
                'debugCreateChat',
                { lidOriginType: (0, a.WhatsUpLoad)('WAWebUsernameTypes').LidOriginType.GENERAL }
              ),
              (s = l().get(e)))
            : (l().add({ id: new h(e, { intentionallyUsePrivateConstructor: !0 }) }, { merge: !0, add: !0 }), (s = l().get(e)));
          const i = await (0, a.convertToFile)(t, n.mimetype, n.filename),
            r = (i.name, await Y(i, i.type)),
            d = { isPtt: n.isPtt, asDocument: n.asDocument, asGif: n.asGif, isAudio: 'audio' === n.type, asSticker: n.asSticker, precomputedFields: { duration: null, waveform: null } };
          let p;
          'audio' === n.type
            ? ((d.isPtt = n.isPtt),
              (d.precomputedFields = await (async function (e, t) {
                if (e.isPtt)
                  try {
                    const e = await t.arrayBuffer(),
                      n = new AudioContext(),
                      a = await n.decodeAudioData(e),
                      o = a.getChannelData(0),
                      s = 64,
                      i = Math.floor(o.length / s),
                      r = [];
                    for (let e = 0; e < s; e++) {
                      const t = i * e;
                      let n = 0;
                      for (let e = 0; e < i; e++) n += Math.abs(o[t + e]);
                      r.push(n / i);
                    }
                    const l = Math.pow(Math.max(...r), -1),
                      c = r.map((e) => e * l),
                      d = new Uint8Array(c.map((e) => Math.floor(100 * e)));
                    return { duration: Math.floor(a.duration), waveform: d };
                  } catch (e) {}
              })(n, i)))
            : 'image' === n.type
              ? (p = n.isViewOnce)
              : 'video' === n.type
                ? (d.asGif = n.isGif)
                : 'document' === n.type
                  ? (d.asDocument = !0)
                  : 'sticker' === n.type && (d.asSticker = !0);
          const u = (0, a.WhatsUpLoad)('WAWebMedia').prepRawMedia(r, d);
          let g = {};
          if ((n.markIsRead && (await (0, a.WhatsUpLoad)('WAWebUpdateUnreadChatAction').sendSeen(s, !1)), await u.waitForPrep(), n.wulp)) {
            let e = (await (0, a.WhatsUpLoad)('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview2(n.wulp)).data;
            g.ctwaContext = {
              description: e.description,
              title: e.title,
              sourceUrl: e.canonicalUrl,
              thumbnailUrl: 'data:image/jpeg;base64,' + e.thumbnail,
              renderLargerThumbnail: !0,
              mediaType: 1,
              thumbnail: e.thumbnail,
            };
          }
          if (s.isGroup && n.tagall) {
            var m = (0, D.r)(s.id).participants.map((e) => e.id);
            const e = await (0, a.verificaArrayLid)(m);
            g.mentionedJidList = e.result;
          }
          if (n.buttons) {
            ((g.nativeFlowName = 'quick_reply'),
              (g.interactiveHeader = { title: n.title ? n.title : ' ', subtitle: n.subtitle ? n.subtitle : ' ', mediaType: n.type.toUpperCase(), thumbnail: void 0 }));
            let e = n.buttons.map((e, t) =>
              e.startsWith('http://') || e.startsWith('https://')
                ? {
                    $$unknownFieldCount: 0,
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                      display_text: e.split('|').length > 1 ? e.split('|')[1] : 'Acesse já!',
                      url: e.split('|').length > 1 ? e.split('|')[0] : e,
                      merchant_url: e.split('|').length > 1 ? e.split('|')[0] : e,
                    }),
                  }
                : { $$unknownFieldCount: 0, name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: e, id: `MYID${t}` }) }
            );
            ((g.interactivePayload = { messageVersion: 1, $$unknownFieldCount: 0, buttons: e }),
              (g.interactiveType = 'native_flow'),
              (g.kind = 'interactive'),
              (g.type = 'interactive'),
              (g.caption = n.caption));
          }
          if ((n.quotedMsg && (g.quotedMsg = await (0, L.q)(n.quotedMsg)), 'status@broadcast' == e))
            return {
              result: await (0, a.WhatsUpLoad)('WAWebWhatsUpPlusStatusMedia').sendMediaMsgToChat(u, s, {
                addEvenWhilePreparing: !1,
                caption: n.caption,
                type: n.type,
                backgroundColor: null != n.backgroundColor ? n.backgroundColor : null,
              }),
            };
          {
            if (('image' === n.type || 'video' === n.type) && n.caption && '' !== n.caption) {
              let e = localStorage.getItem('contatos_traduzir'),
                t = JSON.parse(e || '[{"error":"error"}]').filter(function (e) {
                  return e.id == s.id._serialized;
                }),
                o = localStorage.getItem('meu_nome') ? `*${localStorage.getItem('meu_nome')}:*\n\n` : '';
              if (t[0]) {
                let e = {};
                ((e.text = n.caption), (e.target = t[0].target));
                let s = await (0, a.fetchTrans)(e);
                n.caption = '' !== o ? o + s.result : s.result;
              } else '' !== o && (n.caption = o + n.caption);
            }
            const e = await (0, a.WhatsUpLoad)('WAWebMediaPrep').sendMediaMsgToChat(u, s, { addEvenWhilePreparing: !1, caption: n.caption, type: n.buttons ? 'interactive' : n.type, ...g });
            return (n.waitForAck && (await e), { sendMsgResult: e });
          }
        }
        const Q = (0, a.WhatsUpLoad)('WAWebSendMsgChatAction'),
          Z = (0, a.WhatsUpLoad)('WAWebPollsActionsMetricUtils')?.commitPollsActionsMetric,
          ee = (0, a.WhatsUpLoad)('WAWebPollsSendPollCreationMsgAction')?.createPollCreationMsgData;
        async function te(e) {
          if (e.includes('@g.us')) return { success: !0 };
          const t = window.require('WAWebWidFactory'),
            n = window.require('WAWebApiContact'),
            a = window.require('WAWebSchemaChat').getChatTable(),
            o = window.require('WAWebCreateChat'),
            s = window.require('WAWebUsernameTypes'),
            i = e.split('@')[1];
          let r = e,
            l = null;
          if ('lid' === i) {
            const a = t.createWid(e),
              o = n.getPhoneNumber(a);
            if (!o?._serialized) return { success: !1, error: 'LID fornecido não possui JID correspondente', inputId: e };
            ((r = o._serialized), (l = a));
          } else if ('c.us' === i) {
            const n = e.split('@')[0];
            try {
              const a = await window.WUPE.wa.checkLid(n);
              if (!a?.lid) return { success: !1, error: 'JID fornecido não possui LID correspondente (checkLid falhou)', inputId: e };
              l = t.createWid(a.lid);
            } catch (t) {
              return (debugError('   ❌ Erro ao executar checkLid:', t.message), { success: !1, error: 'Erro ao buscar LID: ' + t.message, inputId: e });
            }
          }
          let c = await a.get(r);
          if (c) {
            return { success: !0, finalChatId: r, chatInTable: c };
          }
          if (!l) return (debugError('❌ accountLid obrigatório mas não disponível!'), { success: !1, error: 'accountLid não disponível', finalChatId: r });
          let d = null;
          if (r.includes('@lid')) {
            if (((d = n.getPhoneNumber(l)), !d?._serialized))
              return (
                debugError('❌ LID não possui JID correspondente!'),
                { success: !1, error: 'accountLid não possui JID correspondente na base de contatos', finalChatId: r, accountLid: l.toString() }
              );
          } else d = r;
          d !== r && (debugWarn('⚠️ JID do LID difere do finalChatId!'), debugWarn('   Esperado:', r), debugWarn('   Encontrado:', d));
          const p = await a.get(r),
            u = await a.get(l.toString());
          if (p && u) return (debugError('⚠️⚠️⚠️ DUPLICATA JÁ EXISTE!'), { success: !1, error: 'Duplicata detectada (JID e LID)', finalChatId: r });
          if (u) return { success: !0, finalChatId: l.toString() };
          if (p) return { success: !0, finalChatId: r };
          if (!p)
            try {
              const e = { chatId: t.createWid(r), accountLid: l },
                n = { createdLocally: !0, notSpam: !0, lidOriginType: s.LidOriginType.GENERAL };
              await o.createChat(e, 'debugCreateChat', n);
            } catch (e) {
              return (debugError('   ❌ ERRO:', e?.message || String(e)), { success: !1, error: e?.message || String(e) });
            }
          const g = await a.get(r);
          if (!g) return (debugError('   ❌ Chat NÃO está na tabela!'), { success: !1, error: 'Chat não criado' });
          const h = !!(await a.get(l.toString()));
          h && debugError('   ⚠️ DUPLICATA criada (JID + LID)!');
          const m = { exists: !!g, hasAccountLid: !!g.accountLid, hasLidOriginType: !!g.lidOriginType, noDuplicate: !h };
          return { success: Object.values(m).every((e) => e), finalChatId: r, chatInTable: g, validations: m };
        }
        async function ne(e, t, n, o = !1) {
          let s = [];
          n.map((e) => s.push({ name: e }));
          let i = await te(e),
            r = null;
          if (e.includes('@g.us')) r = l().get(e);
          else {
            if (!i?.success) return { error: i?.error };
            if (((e = i.finalChatId), (r = l().get(e)), !r)) return { error: 'Chat não encontrado' };
          }
          let c = await ee({ poll: { name: t, options: s, selectableOptionsCount: 1 }, chat: r });
          if (r.isGroup && o) {
            var d = (await (0, D.r)(e)).participants.map((e) => e.id);
            const t = await (0, a.verificaArrayLid)(d);
            c.mentionedJidList = t.result;
          }
          const [p] = await Promise.all(Q.addAndSendMsgToChat(r, c));
          Z({ action: 2, chat: r, creationDateInSeconds: p.t, pollOptionsCount: s.length });
        }
        n(349);
        const ae = (0, a.WhatsUpLoad)('WAWebFrontendVcardUtils'),
          oe = (0, a.WhatsUpLoad)('WAWebUserPrefsMeUser'),
          se = ((0, a.WhatsUpLoad)('WAWebMsgKeyNewId'), (0, a.WhatsUpLoad)('WAWebSendMsgChatAction'));
        async function ie(e, t) {
          let n = await te(e),
            a = null;
          if (e.includes('@g.us')) a = l().get(e);
          else {
            if (!n?.success) return { error: n?.error };
            if (((e = n.finalChatId), (a = l().get(e)), !a)) return { error: 'Chat não encontrado' };
          }
          var o = await Promise.all(
              t.map(async (e) => {
                let t = l().get(e);
                return (t || (l().add({ id: new h(e, { intentionallyUsePrivateConstructor: !0 }) }, { merge: !0, add: !0 }), (t = l().get(e))), t);
              })
            ),
            s = await Promise.all(o),
            i = new Array();
          for (var r in s) 'object' == typeof s[r] && i.push(s[r].contact);
          var c = i.map(async (e) => {
              if ('object' == typeof e) return await ae.vcardFromContactModel(e);
            }),
            d = await Promise.resolve(
              await (async function (e) {
                const t = H.getMaybeMePnUser();
                let n, a;
                return ((n = e.id), n.isGroup && (a = J.asUserWidOrThrow(t)), new j({ from: t, to: n, id: await Promise.resolve(V.getMsgKeyNewSHA256Id()), participant: a, selfDir: 'out' }));
              })(a)
            );
          const p = await oe.getMaybeMePnUser();
          var u = await Promise.all(c);
          const g = {
            id: d,
            ack: 0,
            from: p,
            local: !0,
            self: 'in',
            t: parseInt(new Date().getTime() / 1e3),
            to: a.id,
            ...(i.length > 1 ? { type: 'multi_vcard' } : { type: 'vcard' }),
            ...(i.length > 1 ? { vcardList: u } : { body: u[0].vcard }),
            isNewMsg: !0,
          };
          await se.addAndSendMsgToChat(a, g);
        }
        let re = (0, a.WhatsUpLoad)('WAWebSendTextMsgChatAction')?.sendTextMsgToChat,
          le = (0, a.WhatsUpLoad)('WAWebSendTextMsgChatAction')?.addAndSendTextMsg,
          ce = (0, a.WhatsUpLoad)('WAWebSendTextMsgChatAction')?.createTextMsgData;
        async function de(e, t, n) {
          if (!t || ' ' == t) return;
          let o = e.split('@')[1];
          if ('lid' == o) {
            let t = (0, a.WhatsUpLoad)('WAWebApiContact').getPhoneNumber((0, a.WhatsUpLoad)('WAWebWidFactory').createWid(e));
            t?._serialized && (o = (e = t._serialized).split('@')[1]);
          }
          let s = l().get(e);
          s || ('g.us' != o && 'c.us' != o)
            ? s ||
              'lid' != o ||
              (await (0, a.WhatsUpLoad)('WAWebCreateChat').createChat(
                { chatId: (0, a.WhatsUpLoad)('WAWebWidFactory').asUserLidOrThrow((0, a.WhatsUpLoad)('WAWebWidFactory').createWid(e)), accountLid: (0, a.WhatsUpLoad)('WAWebWidFactory').createWid(e) },
                'debugCreateChat',
                { lidOriginType: (0, a.WhatsUpLoad)('WAWebUsernameTypes').LidOriginType.GENERAL }
              ),
              (s = l().get(e)))
            : (l().add({ id: new h(e, { intentionallyUsePrivateConstructor: !0 }) }, { merge: !0, add: !0 }), (s = l().get(e)));
          let i = {};
          if ((!1 === t.includes('http') && !n?.wulp) || 0 == n?.lp) {
            if (s.isGroup && n?.tagall) {
              var r = (0, D.r)(s.id).participants.map((e) => e.id);
              const e = await (0, a.verificaArrayLid)(r);
              i.mentionedJidList = e.result;
            } else if (s.isGroup) {
              const e = t.match(/(?<=@)(\d+)\b/g) || [];
              let n = [];
              if (e.length > 0) {
                const t = (0, D.r)(s.id);
                for (const a of e) {
                  const e = `${a}@c.us`,
                    o = t.participants.filter((t) => t.id._serialized == e);
                  1 == o.length && n.push(o[0].id);
                }
              }
              n.length > 0 && (i.mentionedJidList = n);
            }
            if ((n?.quotedMsg && (i = { quotedMsg: await (0, L.q)(n?.quotedMsg) }), n?.buttons)) {
              let e = await ce(s, t, i);
              ((e.nativeFlowName = 'quick_reply'),
                (e.interactiveHeader = { title: ' ', subtitle: ' ', hasMediaAttachment: !1 }),
                (e.interactiveHeader = { title: n.title ? n.title : ' ', subtitle: n.subtitle ? n.subtitle : ' ', hasMediaAttachment: !1 }));
              let a = n.buttons.map((e, t) =>
                e.startsWith('http://') || e.startsWith('https://')
                  ? {
                      $$unknownFieldCount: 0,
                      name: 'cta_url',
                      buttonParamsJson: JSON.stringify({
                        display_text: e.split('|').length > 1 ? e.split('|')[1] : 'Acesse já!',
                        url: e.split('|').length > 1 ? e.split('|')[0] : e,
                        merchant_url: e.split('|').length > 1 ? e.split('|')[0] : e,
                      }),
                    }
                  : { $$unknownFieldCount: 0, name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: e, id: `MYID${t}` }) }
              );
              return (
                (e.interactivePayload = { messageVersion: 1, $$unknownFieldCount: 0, buttons: a }),
                (e.interactiveType = 'native_flow'),
                (e.kind = 'interactive'),
                (e.type = 'interactive'),
                (e.caption = t),
                await le(s, e)
              );
            }
            return await re(s, t, i);
          }
          if (s.isGroup && n?.tagall) {
            r = (0, D.r)(s.id).participants.map((e) => e.id);
            const e = await (0, a.verificaArrayLid)(r);
            i.mentionedJidList = e.result;
          } else if (s.isGroup) {
            const e = t.match(/(?<=@)(\d+)\b/g) || [];
            let n = [];
            if (e.length > 0) {
              const t = (0, D.r)(s.id);
              for (const a of e) {
                const e = `${a}@c.us`,
                  o = t.participants.filter((t) => t.id._serialized == e);
                1 == o.length && n.push(o[0].id);
              }
            }
            n.length > 0 && (i.mentionedJidList = n);
          }
          if (n?.quotedMsg) {
            let e = await (0, L.q)(n?.quotedMsg);
            i = { ...i, quotedMsg: e };
          }
          if (n?.lp || (!n?.lp && !n?.wulp)) {
            let e = await (0, a.WhatsUpLoad)('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview(t);
            e && (i.linkPreview = e.data);
          } else if (n?.wulp) {
            let e = await (0, a.WhatsUpLoad)('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview2(n.wulp);
            i.ctwaContext = {
              description: e.data.description,
              title: e.data.title,
              sourceUrl: e.data.canonicalUrl,
              thumbnailUrl: 'data:image/jpeg;base64,' + e.data.thumbnail,
              renderLargerThumbnail: !0,
              mediaType: 1,
              thumbnail: e.data.thumbnail,
            };
          }
          if (n?.buttons) {
            let e = await ce(s, t, i);
            ((e.nativeFlowName = 'quick_reply'), (e.interactiveHeader = { title: n.title ? n.title : ' ', subtitle: n.subtitle ? n.subtitle : ' ', hasMediaAttachment: !1 }));
            let a = n.buttons.map((e, t) =>
              e.startsWith('http://') || e.startsWith('https://')
                ? {
                    $$unknownFieldCount: 0,
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                      display_text: e.split('|').length > 1 ? e.split('|')[1] : 'Acesse já!',
                      url: e.split('|').length > 1 ? e.split('|')[0] : e,
                      merchant_url: e.split('|').length > 1 ? e.split('|')[0] : e,
                    }),
                  }
                : { $$unknownFieldCount: 0, name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: e, id: `MYID${t}` }) }
            );
            return (
              (e.interactivePayload = { messageVersion: 1, $$unknownFieldCount: 0, buttons: a }),
              (e.interactiveType = 'native_flow'),
              (e.kind = 'interactive'),
              (e.type = 'interactive'),
              (e.caption = t),
              await le(s, e)
            );
          }
          return await re(s, t, i);
        }
        ((0, a.WhatsUpLoad)('useWAWebLinkPreview'), (0, a.WhatsUpLoad)('WAWebLinkPreviewChatAction'), (0, a.WhatsUpLoad)('WAWebLinkPreviewCache'));
        let pe = (0, a.WhatsUpLoad)('WAWebNewsletterSendMsgAction')?.sendNewsletterTextMsg,
          ue = (0, a.WhatsUpLoad)('WAWebLoadNewsletterPreviewChatAction').loadNewsletterPreviewChat;
        async function ge(e, t, n) {
          let o = await ue(e),
            s = {};
          if (n?.lp) {
            let e = await (0, a.WhatsUpLoad)('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview(t);
            e && (s.linkPreview = e.data);
          } else if (n?.wulp) {
            let e = await (0, a.WhatsUpLoad)('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview2(n.wulp);
            s.ctwaContext = {
              description: e.data.description,
              title: e.data.title,
              sourceUrl: e.data.canonicalUrl,
              thumbnailUrl: 'data:image/jpeg;base64,' + e.data.thumbnail,
              renderLargerThumbnail: !0,
              mediaType: 1,
              thumbnail: e.data.thumbnail,
            };
          }
          return await pe(o, t, s);
        }
        let he = (0, a.WhatsUpLoad)('WAWebChatStateBridge');
        async function me(e, t) {
          switch (e) {
            case 0:
              await he.sendChatStateComposing(t);
              break;
            case 1:
              await he.sendChatStateRecording(t);
              break;
            case 2:
              await he.sendChatStatePaused(t);
              break;
            default:
              return !1;
          }
          return !0;
        }
        var fe = n(707);
        const be = (0, a.WhatsUpLoad)('WAWebCallCollection'),
          we = (0, a.WhatsUpLoad)('WAWebDBDeviceListFanout')?.getFanOutList,
          ye = (0, a.WhatsUpLoad)('WAWebEncryptMsgProtobuf')?.encryptMsgProtobuf,
          We = (0, a.WhatsUpLoad)('WAWebUserPrefsMeUser')?.assertGetMe;
        async function Ae(e) {
          const t = ['ACTIVE', 'OUTGOING_CALLING', 'OUTGOING_RING'];
          let n;
          ((n = e ? be.get(e) : be.findFirst((e) => t.includes(e.getState()) || e.isGroup)),
            n.peerJid.isGroupCall() || (await (0, a.WhatsUpLoad)('WAWebManageE2ESessionsJob').ensureE2ESessions([n.peerJid])));
          const o = (0, a.WhatsUpLoad)('WASmaxJsx').smax('call', { to: n.peerJid.toString({ legacy: !0 }), id: (0, a.WhatsUpLoad)('WAWap').generateId() }, [
            (0, a.WhatsUpLoad)('WASmaxJsx').smax('terminate', { 'call-id': n.id, 'call-creator': n.peerJid.toString({ legacy: !0 }) }, null),
          ]);
          return (await (0, a.WhatsUpLoad)('WAComms').sendSmaxStanza(o), !0);
        }
        async function Se(e, t) {
          t = Object.assign({ isVideo: !1 }, t);
          const n = (0, fe.Pq)(e),
            o = (0, a.WhatsUpLoad)('WARandomHex').randomHex(16).substr(0, 64),
            s = We(),
            i = [(0, a.WhatsUpLoad)('WASmaxJsx').smax('audio', { enc: 'opus', rate: '16000' }, null), (0, a.WhatsUpLoad)('WASmaxJsx').smax('audio', { enc: 'opus', rate: '8000' }, null)];
          (t.isVideo && i.push((0, a.WhatsUpLoad)('WASmaxJsx').smax('video', { orientation: '0', screen_width: '1920', screen_height: '1080', device_orientation: '0', enc: 'vp8', dec: 'vp8' }, null)),
            i.push(
              (0, a.WhatsUpLoad)('WASmaxJsx').smax('net', { medium: '3' }, null),
              (0, a.WhatsUpLoad)('WASmaxJsx').smax('capability', { ver: '1' }, new Uint8Array([1, 4, 255, 131, 207, 4])),
              (0, a.WhatsUpLoad)('WASmaxJsx').smax('encopt', { keygen: '2' }, null)
            ));
          const r = self.crypto.getRandomValues(new Uint8Array(32)).buffer;
          i.push(
            ...(await (async function (e, t) {
              const n = await we({ wids: e });
              await (0, a.WhatsUpLoad)('WAWebManageE2ESessionsJob').ensureE2ESessions(n);
              let o = !1;
              const s = await Promise.all(
                  n.map(async (e) => {
                    const { type: n, ciphertext: s } = await ye(e, 0, { call: { callKey: new Uint8Array(t) } });
                    return (
                      (o = o || 'pkmsg' === n),
                      (0, a.WhatsUpLoad)('WASmaxJsx').smax('to', { jid: e.toString({ legacy: !0 }) }, [(0, a.WhatsUpLoad)('WASmaxJsx').smax('enc', { v: '2', type: n, count: '0' }, s)])
                    );
                  })
                ),
                i = [];
              if ((i.push((0, a.WhatsUpLoad)('WASmaxJsx').smax('destination', {}, s)), o)) {
                const e = await (0, a.WhatsUpLoad)('WAWebAdvSignatureApi').getADVEncodedIdentity();
                i.push((0, a.WhatsUpLoad)('WASmaxJsx').smax('device-identity', void 0, e));
              }
              return i;
            })([n], r))
          );
          const l = (0, a.WhatsUpLoad)('WASmaxJsx').smax('call', { to: n.toString({ legacy: !0 }), id: (0, a.WhatsUpLoad)('WARandomHex').randomHex(8) }, [
              (0, a.WhatsUpLoad)('WASmaxJsx').smax('offer', { 'call-id': o, 'call-creator': s.toString({ legacy: !0 }) }, i),
            ]),
            c = new ((0, a.WhatsUpLoad)('WAWebCallModel'))({
              id: o,
              peerJid: n,
              isVideo: t.isVideo,
              isGroup: !1,
              outgoing: !0,
              offerTime: (0, a.WhatsUpLoad)('WATimeUtils').unixTime(),
              webClientShouldHandle: !1,
              canHandleLocally: !0,
            });
          return (
            be.add(c),
            be.setActiveCall(be.assertGet(o)),
            c.setState('OUTGOING_CALLING'),
            await (0, a.WhatsUpLoad)('WAComms').sendSmaxStanza(l),
            console.log('<!> enviando call', e, o),
            setTimeout(
              () => {
                const t = (0, a.WhatsUpLoad)('WAWebCallCollection');
                (Ae(o), (t.activeCall = null), console.log('<!> call finalizada', e, o));
              },
              t.timeout ? t.timeout : 7e3
            ),
            c
          );
        }
        const ve = (0, a.WhatsUpLoad)('WAWebSendReactionMsgAction');
        function _e(e, t) {
          return ve.sendReactionToMsg(e, t);
        }
        var Me = n(563);
        const Ee = (0, a.WhatsUpLoad)('WAWebCmd'),
          Te = Ee.Cmd.pinChat;
        async function Ce(e, t) {
          return Ee.Cmd.pinChat(e, t);
        }
        Ee.Cmd.pinChat = (0, a.wrapf)(Te, async (e, ...t) => {
          const [n, a] = t;
          return (Me.A.trackEvent('conversation_pinned', { contactId: n.id._serialized }), await e(...t));
        });
        const xe = (0, a.WhatsUpLoad)('WAWebCmd');
        async function Pe(e, t) {
          return xe.Cmd.sendRevokeMsgs(e, { list: t, type: 'message' }, { clearMedia: !0, toastPosition: void 0 });
        }
        const Ue = (0, a.WhatsUpLoad)('WAWebCmd');
        async function Le(e, t) {
          return Ue.Cmd.archiveChat(e, t);
        }
        const De = (0, a.WhatsUpLoad)('WAWebDeleteChatAction');
        function Ie(e) {
          return De.sendDelete(e);
        }
        function ke(e, t, n, o) {
          (0, a.WhatsUpLoad)('WAWebUserPrefsCustomPaymentMethods').getPIX = function () {
            return { display_name: t, key: n, key_type: o };
          };
          var s = l().get(e);
          (0, a.WhatsUpLoad)('WAWebBizSendOrderAction').sendPixKeyPaymentInfoMessage(s);
        }
        let Re = new Set(),
          Oe = 'all',
          Ne = !1;
        function $e(e = null) {
          const t = (0, a.WhatsUpLoad)('WAWebCmd')?.Cmd;
          t &&
            (e
              ? ((Oe = 'custom'), (Re = new Set(e.map((e) => e?.id?.toString() || e?.id?._serialized || e))), t.trigger('set_active_filter', 'unread'), t.trigger('set_active_filter'))
              : ((Oe = 'all'), Re.clear(), t.trigger('set_active_filter')));
        }
        function Be() {
          const e = (0, a.WhatsUpLoad)('WAWebChatCollection')?.ChatCollection;
          if (!e) return !1;
          Ne = !0;
          const t = e
            .getModelsArray()
            .filter((e) => !e.isGroup)
            .sort((e, t) => (t.unreadCount > 0 && 0 === e.unreadCount ? 1 : e.unreadCount > 0 && 0 === t.unreadCount ? -1 : 0));
          return ($e(t), !0);
        }
        function ze() {
          return ((Ne = !1), $e(null), !0);
        }
        function Ge() {
          $e(null);
        }
        function Fe() {
          return { enabled: 'custom' === Oe, unreadOnTop: Ne, currentFilter: Oe };
        }
        function Ke() {
          return null;
        }
        (!(function () {
          const e = document.createElement('style');
          ((e.id = 'whatsup-hide-filters'), (e.textContent = '[aria-label="chat-list-filters"] { display: none !important; }'), document.head.appendChild(e));
        })(),
          (function () {
            const e = (0, a.WhatsUpLoad)('WAWebInboxFiltersGatingUtils');
            if (!e || e.inboxFiltersEnabled.__wrapped) return;
            const t = e.inboxFiltersEnabled;
            ((e.inboxFiltersEnabled = function () {
              return !0;
            }),
              Object.defineProperties(e.inboxFiltersEnabled, Object.getOwnPropertyDescriptors(t)),
              (e.inboxFiltersEnabled.__wrapped = !0));
          })(),
          (function () {
            const e = (0, a.WhatsUpLoad)('WAWebFrontendChatGetters');
            if (!e?.getShouldAppearInList) return !1;
            if (e.getShouldAppearInList.__wrapped) return !0;
            const t = e.getShouldAppearInList,
              n = function (e) {
                if ('custom' === Oe) {
                  const t = e?.id?.toString() || e?.id?._serialized;
                  return Re.has(t);
                }
                return t(e);
              };
            (Object.defineProperties(n, Object.getOwnPropertyDescriptors(t)), (n.__wrapped = !0), (e.getShouldAppearInList = n));
          })());
      },
      563: (e, t, n) => {
        'use strict';
        n.d(t, { A: () => o });
        class a {
          constructor() {
            ((this.requests = new Map()),
              (this.requestId = 0),
              (this.batchQueue = new Map()),
              (this.batchTimer = null),
              (this.batchDelay = 10),
              (this._engagementIndex = new Map()),
              (this._engagementIndexTime = Date.now()),
              (this._normalizedIds = new Map()),
              this._startIndexCleanup());
          }
          _startIndexCleanup() {
            setInterval(() => {
              (this._engagementIndex &&
                this._engagementIndex.size > 0 &&
                Date.now() - this._engagementIndexTime > 6e4 &&
                (this._engagementIndex.clear(), (this._engagementIndexTime = Date.now()), console.log('[WUPE DB] 🧹 Índices limpos')),
                this._normalizedIds && this._normalizedIds.size > 1e3 && this._normalizedIds.clear());
            }, 6e4);
          }
          create() {
            const e = `req_${++this.requestId}_${Date.now()}_${Math.random()}`,
              t = setTimeout(() => {
                this.requests.has(e) && (console.error('[WUPE DB] Timeout para requestId:', e), this.reject(e, new Error('Timeout na operação de banco de dados')));
              }, 1e4);
            return {
              id: e,
              promise: new Promise((n, a) => {
                this.requests.set(e, { resolve: n, reject: a, timeoutId: t, timestamp: Date.now() });
              }),
            };
          }
          resolve(e, t) {
            const n = this.requests.get(e);
            n ? (clearTimeout(n.timeoutId), n.resolve(t), this.requests.delete(e)) : console.warn('[WUPE DB] Request não encontrado:', e);
          }
          reject(e, t) {
            const n = this.requests.get(e);
            n && (clearTimeout(n.timeoutId), n.reject(t), this.requests.delete(e));
          }
          has(e) {
            return this.requests.has(e);
          }
          scheduleBatchGet(e, t) {
            return new Promise((n, a) => {
              (this.batchQueue.set(e, { fullKey: t, resolve: n, reject: a }),
                this.batchTimer ||
                  (this.batchTimer = setTimeout(() => {
                    this.processBatch();
                  }, this.batchDelay)));
            });
          }
          processBatch() {
            if (0 === this.batchQueue.size) return;
            const e = new Map(this.batchQueue);
            (this.batchQueue.clear(), (this.batchTimer = null));
            const t = Array.from(e.values()).map((e) => e.fullKey),
              { id: n, promise: a } = this.create();
            (window.dispatchEvent(new CustomEvent('WUPE_DB_GET_BATCH', { detail: { keys: t, requestId: n } })),
              a
                .then((t) => {
                  for (const [n, a] of e) {
                    const e = t[a.fullKey];
                    a.resolve(null != e ? e : null);
                  }
                })
                .catch((t) => {
                  for (const [n, a] of e) a.reject(t);
                }));
          }
          cleanup() {
            for (const [e, t] of this.requests) (clearTimeout(t.timeoutId), t.reject(new Error('RequestManager cleanup')));
            (this.requests.clear(), this.batchTimer && (clearTimeout(this.batchTimer), (this.batchTimer = null)));
          }
        }
        const o = new (class {
          constructor() {
            ((this.user = null),
              (this.listeners = new Map()),
              (this.requestManager = new a()),
              (this.initialized = !1),
              (this.cache = new Map()),
              (this.cacheExpiry = 5e3),
              (this.maxCacheSize = 500),
              (this.pendingOperations = new Map()),
              (this.eventTypes = {
                STATUS_SENT: 'status_sent',
                STATUS_SCHEDULED: 'status_scheduled',
                STATUS_VIEWED: 'status_viewed',
                STATUS_ENGAGEMENT: 'status_engagement',
                MESSAGE_NO_CONTACT: 'message_no_contact',
                DELETED_MESSAGE_RECOVERED: 'deleted_message_recovered',
                MESSAGE_WITH_NAME: 'message_with_name',
                CONVERSATION_PINNED: 'conversation_pinned',
                STATUS_DOWNLOADED: 'status_downloaded',
                CALL_REJECTED: 'call_rejected',
              }),
              (this.trackingConfig = { enabled: !0, maxDaysToKeep: 90, autoCleanInterval: 864e5, maxEventsPerType: 1e4, compactOldData: !0 }),
              this._setupEventListeners(),
              this._startAutoCleanup(),
              this._startCacheCleanup());
          }
          _setupEventListeners() {
            (window.addEventListener('WUPE_DB_GET_RESPONSE', (e) => {
              this.requestManager.resolve(e.detail.requestId, e.detail.value);
            }),
              window.addEventListener('WUPE_DB_GET_BATCH_RESPONSE', (e) => {
                this.requestManager.resolve(e.detail.requestId, e.detail.data);
              }),
              window.addEventListener('WUPE_DB_FIND_RESPONSE', (e) => {
                this.requestManager.resolve(e.detail.requestId, e.detail.data);
              }),
              window.addEventListener('WUPE_DB_KEYS_RESPONSE', (e) => {
                this.requestManager.resolve(e.detail.requestId, e.detail.keys);
              }),
              window.addEventListener('WUPE_DB_SUCCESS', (e) => {
                e.detail.requestId && this.requestManager.has(e.detail.requestId) && this.requestManager.resolve(e.detail.requestId, !0);
              }),
              window.addEventListener('WUPE_DB_ERROR', (e) => {
                e.detail.requestId && this.requestManager.has(e.detail.requestId) && this.requestManager.reject(e.detail.requestId, new Error(e.detail.error));
              }),
              window.addEventListener('WUPE_DB_GET_ALL_RESPONSE', (e) => {
                this.requestManager.resolve(e.detail.requestId, e.detail.data);
              }));
          }
          async init() {
            if (this.initialized) return this;
            if (
              ((this.user = (() => {
                try {
                  return window.require('WAWebUserPrefsMeUser').getMaybeMePnUser()?.user || null;
                } catch (e) {
                  return (console.error('Erro ao obter usuário:', e), null);
                }
              })()),
              !this.user)
            )
              throw new Error('Usuário não identificado');
            return ((this.initialized = !0), this);
          }
          _buildKey(e) {
            return `${this.user}${e}`;
          }
          _getCached(e) {
            const t = this.cache.get(e);
            if (t && Date.now() - t.timestamp < this.cacheExpiry) return t.value;
          }
          _setCache(e, t) {
            if (this.cache.size >= this.maxCacheSize) {
              const e = this.cache.keys().next().value;
              this.cache.delete(e);
            }
            this.cache.set(e, { value: t, timestamp: Date.now() });
          }
          _invalidateCache(e) {
            if ((this.cache.delete(e), e.includes('tracking_') || e.includes('_counter_')))
              for (const e of this.cache.keys()) (e.includes('tracking_') || e.includes('_counter_')) && this.cache.delete(e);
          }
          _startCacheCleanup() {
            setInterval(() => {
              const e = Date.now();
              for (const [t, n] of this.cache.entries()) e - n.timestamp > this.cacheExpiry && this.cache.delete(t);
            }, this.cacheExpiry);
          }
          async set(e, t) {
            this.initialized || (await this.init());
            const n = this._buildKey(e),
              { id: a, promise: o } = this.requestManager.create();
            return (window.dispatchEvent(new CustomEvent('WUPE_DB_SET', { detail: { msg: n, dir: t, requestId: a } })), this._invalidateCache(e), this._notifyListeners(e, t, 'set'), o);
          }
          async get(e, t = null, n = !0) {
            if ((this.initialized || (await this.init()), n)) {
              const t = this._getCached(e);
              if (void 0 !== t) return t;
            }
            const a = this._buildKey(e);
            try {
              const o = await this.requestManager.scheduleBatchGet(e, a),
                s = null != o ? o : t;
              return (n && this._setCache(e, s), s);
            } catch (e) {
              return (console.error('[WUPE DB] Erro ao obter:', e), t);
            }
          }
          async getl() {
            return (this.initialized || (await this.init()), await this.get('mylicenid', null));
          }
          async delete(e) {
            this.initialized || (await this.init());
            const t = this._buildKey(e),
              { id: n, promise: a } = this.requestManager.create();
            return (window.dispatchEvent(new CustomEvent('WUPE_DB_DELETE', { detail: { msg: t, requestId: n } })), this._invalidateCache(e), this._notifyListeners(e, null, 'delete'), a);
          }
          async has(e) {
            return null !== (await this.get(e));
          }
          async find(e) {
            this.initialized || (await this.init());
            const t = e instanceof RegExp ? e.source : e,
              n = `_find_${t}`,
              a = this._getCached(n);
            if (void 0 !== a) return a;
            const { id: o, promise: s } = this.requestManager.create();
            window.dispatchEvent(new CustomEvent('WUPE_DB_FIND', { detail: { prefix: this.user, pattern: t, requestId: o } }));
            const i = await s,
              r = {};
            for (const [e, t] of Object.entries(i)) r[e.replace(this.user, '')] = t;
            return (this._setCache(n, r), r);
          }
          async keys() {
            this.initialized || (await this.init());
            const e = '_all_keys',
              t = this._getCached(e);
            if (void 0 !== t) return t;
            const { id: n, promise: a } = this.requestManager.create();
            window.dispatchEvent(new CustomEvent('WUPE_DB_KEYS', { detail: { prefix: this.user, requestId: n } }));
            const o = (await a).map((e) => e.replace(this.user, ''));
            return (this._setCache(e, o), o);
          }
          async values() {
            const e = await this.getAll();
            return Object.values(e);
          }
          async getAll() {
            this.initialized || (await this.init());
            const e = '_get_all',
              t = this._getCached(e);
            if (void 0 !== t) return t;
            const { id: n, promise: a } = this.requestManager.create();
            window.dispatchEvent(new CustomEvent('WUPE_DB_GET_ALL', { detail: { prefix: this.user, requestId: n } }));
            const o = await a,
              s = {};
            for (const [e, t] of Object.entries(o || {})) s[e.replace(this.user, '')] = t;
            return (this._setCache(e, s), s);
          }
          async clear() {
            this.initialized || (await this.init());
            const { id: e, promise: t } = this.requestManager.create();
            return (window.dispatchEvent(new CustomEvent('WUPE_DB_CLEAR', { detail: { prefix: this.user, requestId: e } })), this.cache.clear(), t);
          }
          async setFile(e, t) {
            this.initialized || (await this.init());
            const n = `file_${e}`;
            return (await this.set(n, t), !0);
          }
          async getFile(e) {
            this.initialized || (await this.init());
            const t = `file_${e}`,
              n = await this.get(t);
            return n ? { name: e, data: n, size: n.length, sizeKB: (n.length / 1024).toFixed(2), sizeMB: (n.length / 1024 / 1024).toFixed(2) } : null;
          }
          async deleteFile(e) {
            this.initialized || (await this.init());
            const t = `file_${e}`;
            return (await this.delete(t), !0);
          }
          async listFiles() {
            this.initialized || (await this.init());
            const e = await this.find(/^file_/),
              t = [];
            for (const [n, a] of Object.entries(e)) {
              const e = n.replace('file_', '');
              t.push({ fileName: e, size: a.length, sizeKB: (a.length / 1024).toFixed(2), sizeMB: (a.length / 1024 / 1024).toFixed(2) });
            }
            return t;
          }
          async getFilesSize() {
            this.initialized || (await this.init());
            const e = await this.find(/^file_/);
            let t = 0,
              n = 0;
            for (const [a, o] of Object.entries(e)) ((t += (o || '').length), n++);
            return { totalFiles: n, totalBytes: t, totalKB: (t / 1024).toFixed(2), totalMB: (t / 1024 / 1024).toFixed(2), totalGB: (t / 1024 / 1024 / 1024).toFixed(2) };
          }
          async fileExists(e) {
            return (this.initialized || (await this.init()), await this.has(`file_${e}`));
          }
          async clearAllFiles() {
            this.initialized || (await this.init());
            const e = await this.listFiles();
            for (const t of e) this._invalidateCache(`file_${t.fileName}`);
            const t = e.map((e) => this.delete(`file_${e.fileName}`));
            return (await Promise.all(t), e.length);
          }
          async setJSON(e, t) {
            return this.set(e, JSON.stringify(t));
          }
          async getJSON(e, t = null) {
            const n = await this.get(e);
            if (!n) return t;
            try {
              return JSON.parse(n);
            } catch (e) {
              return (console.error('[WUPE DB] Erro ao parsear JSON:', e), t);
            }
          }
          on(e, t) {
            return (this.listeners.has(e) || this.listeners.set(e, []), this.listeners.get(e).push(t), () => this.off(e, t));
          }
          off(e, t) {
            if (!this.listeners.has(e)) return;
            const n = this.listeners.get(e),
              a = n.indexOf(t);
            a > -1 && n.splice(a, 1);
          }
          _notifyListeners(e, t, n) {
            this.listeners.has(e) &&
              this.listeners.get(e).forEach((a) => {
                try {
                  a({ key: e, value: t, operation: n, timestamp: Date.now() });
                } catch (e) {
                  console.error('[WUPE DB] Erro no listener:', e);
                }
              });
          }
          _getTrackingKey(e) {
            return `tracking_${e}`;
          }
          _formatDate(e) {
            return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
          }
          async trackEvent(e, t = {}) {
            if (!this.trackingConfig.enabled) return !1;
            this.initialized || (await this.init());
            try {
              const n = {
                  type: e,
                  subtype: t.subtype || null,
                  timestamp: Date.now(),
                  date: this._formatDate(new Date()),
                  contactId: t.contactId || null,
                  messageId: t.messageId || null,
                  extra: t.extra || {},
                },
                a = this._getTrackingKey(e),
                o = await this.getJSON(a, []);
              return (o.push(n), await this.setJSON(a, o), await this._updateQuickCounter(e, t.subtype), !0);
            } catch (e) {
              return (console.error('[WUPE TRACKING] Erro ao registrar evento:', e), !1);
            }
          }
          async _updateQuickCounter(e, t) {
            try {
              const n = `_counter_${e}`,
                a = await this.getJSON(n, { total: 0, subtypes: {} });
              (a.total++, t && (a.subtypes[t] = (a.subtypes[t] || 0) + 1), await this.setJSON(n, a));
            } catch (e) {
              console.error('[WUPE TRACKING] Erro ao atualizar contador:', e);
            }
          }
          async _filterAsync(e, t, n = 1e3) {
            const a = [];
            for (let o = 0; o < e.length; o += n) {
              const s = e.slice(o, o + n);
              (a.push(...s.filter(t)), o + n < e.length && (await new Promise((e) => setTimeout(e, 0))));
            }
            return a;
          }
          async getTrackingStats() {
            this.initialized || (await this.init());
            const e = '_tracking_stats',
              t = this._getCached(e);
            if (void 0 !== t) return t;
            const n = {},
              a = (await this.keys()).filter((e) => e.startsWith('tracking_') && !e.includes('_counter_') && !e.startsWith('tracking_summary_'));
            for (const e of a) {
              const t = e.replace('tracking_', ''),
                a = `_counter_${t}`,
                o = await this.getJSON(a, null);
              if (o) ((n[t] = o.total), Object.keys(o.subtypes || {}).length > 0 && (n[`${t}_by_type`] = o.subtypes));
              else {
                const a = await this.getJSON(e, []);
                n[t] = a.length;
              }
            }
            return (this._setCache(e, n), n);
          }
          async getTrackingStat(e) {
            this.initialized || (await this.init());
            try {
              const t = `_counter_${e}`,
                n = await this.getJSON(t, null);
              return n ? n.total : (await this.getJSON(this._getTrackingKey(e), [])).length;
            } catch (e) {
              return (console.error('[WUPE TRACKING] Erro ao obter estatística:', e), 0);
            }
          }
          async getTrackingStatsByDate(e, t) {
            this.initialized || (await this.init());
            const n = e.getTime(),
              a = t.getTime(),
              o = {},
              s = (await this.keys()).filter((e) => e.startsWith('tracking_') && !e.includes('_counter_') && !e.startsWith('tracking_summary_'));
            for (const e of s) {
              const t = e.replace('tracking_', ''),
                s = await this.getJSON(e, []),
                i = await this._filterAsync(s, (e) => e.timestamp >= n && e.timestamp <= a);
              o[t] = i.length;
            }
            return o;
          }
          _normalizeStatusId(e) {
            if (!e) return '';
            if (/^[A-F0-9]{22}$/i.test(e)) return e.toUpperCase();
            const t = e.match(/([A-F0-9]{22})/i);
            return t ? t[1].toUpperCase() : e.toUpperCase();
          }
          async getStatusReplies(e) {
            this.initialized || (await this.init());
            try {
              const t = this._normalizeStatusId(e),
                n = this._getTrackingKey(this.eventTypes.STATUS_ENGAGEMENT),
                a = await this.getJSON(n, []),
                o = await this._filterAsync(a, (e) => {
                  if ('reply' !== e.subtype) return !1;
                  const n = e.messageId || '',
                    a = e.extra?.statusId || '',
                    o = this._normalizeStatusId(n);
                  return this._normalizeStatusId(a) === t || o === t;
                });
              return (
                o.sort((e, t) => {
                  const n = e.extra?.timestamp || e.timestamp || 0;
                  return (t.extra?.timestamp || t.timestamp || 0) - n;
                }),
                o
              );
            } catch (e) {
              return (console.error('[WUPE DB] ❌ Erro ao buscar replies:', e), []);
            }
          }
          async getStatusRepliesStats_old(e) {
            this.initialized || (await this.init());
            try {
              const t = this._normalizeStatusId(e),
                n = this._getTrackingKey(this.eventTypes.STATUS_ENGAGEMENT),
                a = await this.getJSON(n, []),
                o = await this._filterAsync(a, (e) => {
                  if ('reply' !== e.subtype) return !1;
                  const n = e.messageId || '',
                    a = e.extra?.statusId || '',
                    o = this._normalizeStatusId(n);
                  return this._normalizeStatusId(a) === t || o === t;
                });
              if (0 === o.length) return { total: 0, today: 0, uniqueUsers: 0, recentReplies: [] };
              o.sort((e, t) => {
                const n = e.extra?.timestamp || e.timestamp || 0;
                return (t.extra?.timestamp || t.timestamp || 0) - n;
              });
              const s = new Date(),
                i = new Date(s);
              i.setHours(0, 0, 0, 0);
              const r = i.getTime(),
                l = o.filter((e) => (e.extra?.timestamp || e.timestamp || 0) >= r).length,
                c = new Set(o.map((e) => e.contactId)).size,
                d = o.slice(0, 5).map((e) => ({
                  userId: e.contactId,
                  content: e.extra?.content || '',
                  timestamp: e.extra?.timestamp || e.timestamp || 0,
                  date: new Date(e.extra?.timestamp || e.timestamp || 0).toLocaleString('pt-BR'),
                }));
              return { total: o.length, today: l, uniqueUsers: c, recentReplies: d };
            } catch (e) {
              return (console.error('[WUPE DB] ❌ Erro ao buscar estatísticas de replies:', e), { total: 0, today: 0, uniqueUsers: 0, recentReplies: [] });
            }
          }
          async getStatusRepliesStats(e) {
            this.initialized || (await this.init());
            try {
              const t = this._normalizeStatusId(e),
                n = `_replies_stats_${t}`,
                a = this._getCached(n);
              if (void 0 !== a) return a;
              (this._engagementIndex || ((this._engagementIndex = new Map()), (this._engagementIndexTime = Date.now())),
                Date.now() - this._engagementIndexTime > 3e4 && (this._engagementIndex.clear(), (this._engagementIndexTime = Date.now())));
              let o = this._engagementIndex.get(t);
              if (!o) {
                const e = this._getTrackingKey(this.eventTypes.STATUS_ENGAGEMENT),
                  n = await this.getJSON(e, []);
                o = [];
                for (const e of n) {
                  if ('reply' !== e.subtype) continue;
                  const n = e.messageId || '',
                    a = e.extra?.statusId || '';
                  this._normalizedIds || (this._normalizedIds = new Map());
                  let s = this._normalizedIds.get(n);
                  s || ((s = this._normalizeStatusId(n)), this._normalizedIds.set(n, s));
                  let i = this._normalizedIds.get(a);
                  (i || ((i = this._normalizeStatusId(a)), this._normalizedIds.set(a, i)), (i !== t && s !== t) || o.push(e));
                }
                if (
                  (o.sort((e, t) => {
                    const n = e.extra?.timestamp || e.timestamp || 0;
                    return (t.extra?.timestamp || t.timestamp || 0) - n;
                  }),
                  this._engagementIndex.set(t, o),
                  this._engagementIndex.size > 100)
                ) {
                  const e = this._engagementIndex.keys().next().value;
                  this._engagementIndex.delete(e);
                }
              }
              if (0 === o.length) {
                const e = { total: 0, today: 0, uniqueUsers: 0, recentReplies: [] };
                return (this._setCache(n, e), e);
              }
              const s = new Date();
              s.setHours(0, 0, 0, 0);
              const i = s.getTime();
              let r = 0;
              const l = new Set(),
                c = [],
                d = Math.max(5, Math.min(o.length, 100));
              for (let e = 0; e < o.length && e < d; e++) {
                const t = o[e],
                  n = t.extra?.timestamp || t.timestamp || 0;
                (n >= i && r++,
                  t.contactId && l.add(t.contactId),
                  c.length < 5 && c.push({ userId: t.contactId, content: t.extra?.content || '', timestamp: n, date: new Date(n).toLocaleString('pt-BR') }));
              }
              if (o.length > d) for (let e = d; e < o.length; e++) (o[e].contactId && l.add(o[e].contactId), (o[e].extra?.timestamp || o[e].timestamp || 0) >= i && r++);
              const p = { total: o.length, today: r, uniqueUsers: l.size, recentReplies: c };
              return (this._setCache(n, p), p);
            } catch (e) {
              return (console.error('[WUPE DB] ❌ Erro ao buscar estatísticas de replies:', e), { total: 0, today: 0, uniqueUsers: 0, recentReplies: [] });
            }
          }
          async getTrackingEvents(e, t = {}) {
            this.initialized || (await this.init());
            const { limit: n = 100, subtype: a = null } = t;
            try {
              let t = await this.getJSON(this._getTrackingKey(e), []);
              return (a && (t = await this._filterAsync(t, (e) => e.subtype === a)), t.sort((e, t) => t.timestamp - e.timestamp), t.slice(0, n));
            } catch (e) {
              return (console.error('[WUPE TRACKING] Erro ao obter eventos:', e), []);
            }
          }
          async resetTrackingStats() {
            this.initialized || (await this.init());
            try {
              const e = (await this.keys())
                .filter((e) => e.startsWith('tracking_') || e.startsWith('_counter_') || e.startsWith('status_ack_') || e.startsWith('_tracked_'))
                .map((e) => this.delete(e));
              return (await Promise.all(e), !0);
            } catch (e) {
              return (console.error('[WUPE TRACKING] Erro ao resetar estatísticas:', e), !1);
            }
          }
          _startAutoCleanup() {
            setInterval(async () => {
              this.trackingConfig.enabled && this.initialized;
            }, this.trackingConfig.autoCleanInterval);
          }
          async trackStatusSent(e = {}) {
            return this.trackEvent(this.eventTypes.STATUS_SENT, { subtype: e.type, messageId: e.statusId, extra: { duration: e.duration || null, timestamp: Date.now() } });
          }
          async trackStatusScheduledByContent(e, t) {
            return this.trackStatusScheduled({ name: e, conteudo: t });
          }
          async trackStatusScheduled(e) {
            let t, n, a, o;
            if ((this.initialized || (await this.init()), e.name && e.conteudo))
              ((t = e.name),
                (a = e.conteudo.horariododisparo),
                (o = e.conteudo),
                (n = 'text'),
                e.conteudo.arquivo64?.length > 0 ? (n = e.conteudo.arquivo64[0].tipodoarquivo) : e.conteudo.arquivo?.length > 0 && (n = e.conteudo.arquivo[0].tipodoarquivo));
            else {
              if (void 0 !== e.horariododisparo) return (console.error('[WUPE SCHEDULE] ❌ Nome do agendamento não encontrado. Use formato: { name, conteudo }'), !1);
              if (!e.name || !e.scheduledTime) return (console.error('[WUPE SCHEDULE] ❌ Formato de dados inválido'), !1);
              ((t = e.name), (n = e.type || 'text'), (a = e.scheduledTime), (o = e.content || null));
            }
            return t && a
              ? this.trackEvent(this.eventTypes.STATUS_SCHEDULED, { subtype: n || 'text', messageId: t, extra: { scheduledTime: a, status: 'pending', timestamp: Date.now(), content: o || null } })
              : (console.error('[WUPE SCHEDULE] ❌ Nome ou horário de disparo não fornecido'), !1);
          }
          async markScheduleAsSent(e) {
            this.initialized || (await this.init());
            const t = (await this.getTrackingEvents(this.eventTypes.STATUS_SCHEDULED, { limit: 1e3 })).find((t) => t.messageId === e);
            return t
              ? this.trackEvent(this.eventTypes.STATUS_SCHEDULED, {
                  subtype: t.subtype,
                  messageId: e,
                  extra: { scheduledTime: t.extra?.scheduledTime, status: 'sent', previousStatus: 'pending', sentAt: Date.now(), timestamp: Date.now() },
                })
              : (console.warn('[WUPE SCHEDULE] ⚠️ Agendamento não encontrado:', e), !1);
          }
          async deleteScheduleTracking(e) {
            this.initialized || (await this.init());
            const t = (await this.getJSON(this._getTrackingKey(this.eventTypes.STATUS_SCHEDULED), [])).filter((t) => t.messageId !== e);
            return (await this.setJSON(this._getTrackingKey(this.eventTypes.STATUS_SCHEDULED), t), !0);
          }
          async trackStatusView(e = {}) {
            if (!e.statusId || !e.viewerId) return (console.error('[WUPE TRACK] ❌ statusId ou viewerId ausente:', e), !1);
            const t = `_tracked_${e.statusId}_${e.viewerId}`;
            return (
              !(await this.get(t)) &&
              (await this.set(t, Date.now()),
              await this.trackEvent(this.eventTypes.STATUS_VIEWED, {
                messageId: e.statusId,
                contactId: e.viewerId,
                subtype: e.statusType,
                extra: { ...e.extra, timestamp: e.extra?.timestamp || Date.now() },
              }))
            );
          }
          async trackStatusEngagement(e = {}) {
            if (!e.statusId || !e.userId) return (console.error('[WUPE TRACK] ❌ statusId ou userId ausente:', e), !1);
            const t = e.replyMessageId || `${e.statusId}_${e.userId}_${e.extra?.content?.substring(0, 20) || ''}_${e.extra?.timestamp || Date.now()}`,
              n = `_tracked_engagement_${t}`;
            if (await this.get(n)) return !1;
            await this.set(n, Date.now());
            const a = await this.trackEvent(this.eventTypes.STATUS_ENGAGEMENT, {
              messageId: e.statusId,
              contactId: e.userId,
              subtype: e.interactionType,
              extra: { replyMessageId: t, content: e.extra?.content, timestamp: e.extra?.timestamp || Date.now(), statusAuthor: e.extra?.statusAuthor, ...e.extra },
            });
            if (a && e.statusId) {
              const t = this._normalizeStatusId(e.statusId);
              (this._invalidateCache(`_replies_stats_${t}`), this._engagementIndex && this._engagementIndex.delete(t));
            }
            return a;
          }
          async getScheduledStatusPending() {
            try {
              const e = await this.get('statusautoprogramadas');
              if (!e) return 0;
              const t = JSON.parse(e);
              return Array.isArray(t) ? t.filter((e) => !1 === e?.conteudo?.enviado).length : (console.warn('[WUPE DB] statusautoprogramadas não é um array'), 0);
            } catch (e) {
              return (console.error('[WUPE DB] Erro ao obter agendados pendentes:', e), 0);
            }
          }
          async updateScheduledStatus(e, t) {
            const n = (await this.getTrackingEvents(this.eventTypes.STATUS_SCHEDULED, { limit: 1e3 })).find((t) => t.messageId === e);
            n &&
              (await this.trackEvent(this.eventTypes.STATUS_SCHEDULED, {
                subtype: n.subtype,
                messageId: e,
                extra: { scheduledTime: n.extra.scheduledTime, status: t, previousStatus: n.extra.status, timestamp: Date.now() },
              }));
          }
          async getStatusStatistics() {
            this.initialized || (await this.init());
            const e = '_status_statistics',
              t = this._getCached(e);
            if (void 0 !== t) return t;
            const n = new Date(),
              a = new Date(n);
            a.setHours(0, 0, 0, 0);
            const o = new Date(a);
            o.setDate(o.getDate() - 1);
            const s = new Date(n);
            s.setDate(s.getDate() - 7);
            try {
              const t = a.getTime(),
                n = o.getTime(),
                i = s.getTime(),
                r = this._getTrackingKey(this.eventTypes.STATUS_VIEWED),
                l = await this.getJSON(r, []),
                c = this._getTrackingKey(this.eventTypes.STATUS_ENGAGEMENT),
                d = await this.getJSON(c, []),
                p = await this._filterAsync(d, (e) => 'reply' === e.subtype),
                u = await this._filterAsync(d, (e) => 'reaction' === e.subtype),
                g = this._getTrackingKey(this.eventTypes.STATUS_SENT),
                h = await this.getJSON(g, []),
                m = this._getTrackingKey(this.eventTypes.STATUS_SCHEDULED),
                f = await this.getJSON(m, []),
                b = new Map();
              f.forEach((e) => {
                const t = e.messageId,
                  n = b.get(t);
                (!n || e.timestamp > n.timestamp) && b.set(t, e);
              });
              const w = l.length,
                y = await this._filterAsync(l, (e) => (e.extra?.timestamp || e.timestamp || 0) >= t),
                W = await this._filterAsync(l, (e) => {
                  const a = e.extra?.timestamp || e.timestamp || 0;
                  return a >= n && a < t;
                }),
                A = p.length + u.length,
                S = await this._filterAsync([...p, ...u], (e) => (e.extra?.timestamp || e.timestamp || 0) >= t),
                v = await this._filterAsync([...p, ...u], (e) => {
                  const a = e.extra?.timestamp || e.timestamp || 0;
                  return a >= n && a < t;
                }),
                _ = w > 0 ? parseFloat(((A / w) * 100).toFixed(1)) : 0,
                M = W.length > 0 ? parseFloat(((v.length / W.length) * 100).toFixed(1)) : 0,
                E = y.length > 0 ? parseFloat(((S.length / y.length) * 100).toFixed(1)) : 0,
                T = parseFloat((E - M).toFixed(1)),
                C = {
                  totalEnviados: h.length,
                  trendSemana: h.filter((e) => e.timestamp >= i).length,
                  totalAgendados: f.length,
                  agendadosPendentes: Array.from(b.values()).filter((e) => 'sent' !== e.extra?.status).length,
                  views: w,
                  viewsHoje: y.length,
                  engagement: _,
                  engagementTrend: T,
                };
              return (this._setCache(e, C), C);
            } catch (e) {
              return (
                console.error('[WUPE STATS] Erro:', e),
                { totalEnviados: 0, trendSemana: 0, totalAgendados: 0, agendadosPendentes: 0, views: 0, viewsHoje: 0, engagement: 0, engagementTrend: 0 }
              );
            }
          }
          async processStatusAck_old_ruim(e, t) {
            this.initialized || (await this.init());
            try {
              if ((t instanceof Promise && (t = await t), !t)) return (console.error('[WUPE ACK] ❌ ackInfo é null ou undefined'), null);
              const n = await this.getStatusAckSummary(e),
                a = new Set(n?.allViewers || []),
                o = new Set(),
                s = new Map();
              if (t.read && Array.isArray(t.read) && t.read.length > 0)
                for (const e of t.read) {
                  const t = 'string' == typeof e ? e : e.id || e._serialized;
                  if (!t) continue;
                  const n = e.t ? (10 === e.t.toString().length ? 1e3 * e.t : e.t) : Date.now();
                  (o.add(t), s.has(t) || s.set(t, { timestamp: n, type: 'image' }));
                }
              if (t.played && Array.isArray(t.played) && t.played.length > 0)
                for (const e of t.played) {
                  const t = 'string' == typeof e ? e : e.id || e._serialized;
                  if (!t) continue;
                  const n = e.t ? (10 === e.t.toString().length ? 1e3 * e.t : e.t) : Date.now();
                  (o.add(t), s.has(t) ? (s.get(t).type = 'video') : s.set(t, { timestamp: n, type: 'video' }));
                }
              let i = 0,
                r = 0;
              const l = [];
              for (const [t, n] of s)
                a.has(t)
                  ? r++
                  : l.push(
                      this.trackStatusView({ statusId: e, viewerId: t, statusType: n.type, timestamp: n.timestamp }).then((e) => {
                        e && i++;
                      })
                    );
              await Promise.all(l);
              const c = new Set([...a, ...o]);
              await this.saveStatusAckSummary(e, t, Array.from(c));
              const d = (t.read?.length || 0) + (t.played?.length || 0);
              return {
                totalViews: d,
                totalViewsEstimated: d + Math.max(0, t.readRemaining || 0) + Math.max(0, t.playedRemaining || 0),
                statusType: (t.played?.length || 0) > 0 ? 'video' : 'image',
                newViewers: i,
                uniqueViewers: c.size,
                isDuplicate: 0 === i,
                viewers: Array.from(c),
                skipped: r,
                breakdown: { reads: t.read?.length || 0, plays: t.played?.length || 0, readRemaining: Math.max(0, t.readRemaining || 0), playedRemaining: Math.max(0, t.playedRemaining || 0) },
              };
            } catch (e) {
              return (console.error('[WUPE ACK] ❌ ERRO NO PROCESSAMENTO:', e), console.error('[WUPE ACK] Stack trace:', e.stack), null);
            }
          }
          async processStatusAck(e, t) {
            this.initialized || (await this.init());
            try {
              if ((t instanceof Promise && (t = await t), !t)) return (console.error('[WUPE ACK] ❌ ackInfo é null ou undefined'), null);
              const n = await this.getStatusAckSummary(e),
                a = new Set(n?.allViewers || []),
                o = new Set(),
                s = new Map();
              if (t.read && Array.isArray(t.read) && t.read.length > 0)
                for (const e of t.read) {
                  const t = 'string' == typeof e ? e : e.id || e._serialized;
                  if (!t) continue;
                  const n = e.t ? (10 === e.t.toString().length ? 1e3 * e.t : e.t) : Date.now();
                  (o.add(t), s.has(t) || s.set(t, { timestamp: n, type: 'image' }));
                }
              if (t.played && Array.isArray(t.played) && t.played.length > 0)
                for (const e of t.played) {
                  const t = 'string' == typeof e ? e : e.id || e._serialized;
                  if (!t) continue;
                  const n = e.t ? (10 === e.t.toString().length ? 1e3 * e.t : e.t) : Date.now();
                  (o.add(t), s.has(t) ? (s.get(t).type = 'video') : s.set(t, { timestamp: n, type: 'video' }));
                }
              const i = [],
                r = [];
              for (const [t, n] of s)
                if (!a.has(t)) {
                  const a = `_tracked_${e}_${t}`;
                  r.push(
                    this.get(a).then((e) => {
                      e || i.push({ viewerId: t, data: n, checkKey: a });
                    })
                  );
                }
              await Promise.all(r);
              let l = i.length,
                c = s.size - l;
              if (0 === i.length) {
                const n = new Set([...a, ...o]);
                return (
                  await this.saveStatusAckSummary(e, t, Array.from(n)),
                  {
                    totalViews: (t.read?.length || 0) + (t.played?.length || 0),
                    totalViewsEstimated: (t.read?.length || 0) + (t.played?.length || 0) + Math.max(0, t.readRemaining || 0) + Math.max(0, t.playedRemaining || 0),
                    statusType: (t.played?.length || 0) > 0 ? 'video' : 'image',
                    newViewers: 0,
                    uniqueViewers: n.size,
                    isDuplicate: !0,
                    viewers: Array.from(n),
                    skipped: c,
                    breakdown: { reads: t.read?.length || 0, plays: t.played?.length || 0, readRemaining: Math.max(0, t.readRemaining || 0), playedRemaining: Math.max(0, t.playedRemaining || 0) },
                  }
                );
              }
              const d = i.map(({ checkKey: e }) => this.set(e, Date.now()));
              (await Promise.all(d), await this._batchTrackStatusViews(e, i));
              const p = new Set([...a, ...o]);
              await this.saveStatusAckSummary(e, t, Array.from(p));
              const u = (t.read?.length || 0) + (t.played?.length || 0);
              return {
                totalViews: u,
                totalViewsEstimated: u + Math.max(0, t.readRemaining || 0) + Math.max(0, t.playedRemaining || 0),
                statusType: (t.played?.length || 0) > 0 ? 'video' : 'image',
                newViewers: l,
                uniqueViewers: p.size,
                isDuplicate: !1,
                viewers: Array.from(p),
                skipped: c,
                breakdown: { reads: t.read?.length || 0, plays: t.played?.length || 0, readRemaining: Math.max(0, t.readRemaining || 0), playedRemaining: Math.max(0, t.playedRemaining || 0) },
              };
            } catch (e) {
              return (console.error('[WUPE ACK] ❌ ERRO NO PROCESSAMENTO:', e), console.error('[WUPE ACK] Stack trace:', e.stack), null);
            }
          }
          async _batchTrackStatusViews(e, t) {
            if (0 === t.length) return;
            const n = this._getTrackingKey(this.eventTypes.STATUS_VIEWED),
              a = await this.getJSON(n, []),
              o = Date.now(),
              s = t.map(({ viewerId: t, data: n }) => ({
                type: this.eventTypes.STATUS_VIEWED,
                subtype: n.type,
                timestamp: o,
                date: this._formatDate(new Date(o)),
                contactId: t,
                messageId: e,
                extra: { timestamp: n.timestamp },
              }));
            (a.push(...s), await this.setJSON(n, a));
            const i = `_counter_${this.eventTypes.STATUS_VIEWED}`,
              r = await this.getJSON(i, { total: 0, subtypes: {} });
            r.total += t.length;
            for (const { data: e } of t) r.subtypes[e.type] = (r.subtypes[e.type] || 0) + 1;
            await this.setJSON(i, r);
          }
          async saveStatusAckSummary(e, t, n = []) {
            const a = `status_ack_${e}`,
              o = await this.getJSON(a, null),
              s = {
                statusId: e,
                firstProcessed: o?.firstProcessed || Date.now(),
                lastUpdate: Date.now(),
                updateCount: (o?.updateCount || 0) + 1,
                allViewers: n,
                delivery: {
                  count: t.delivery?.length || 0,
                  remaining: Math.max(0, t.deliveryRemaining || 0),
                  total: (t.delivery?.length || 0) + Math.max(0, t.deliveryRemaining || 0),
                  viewers: t.delivery?.map((e) => ('string' == typeof e ? e : e.id || e._serialized)).filter(Boolean) || [],
                },
                read: {
                  count: t.read?.length || 0,
                  remaining: Math.max(0, t.readRemaining || 0),
                  total: (t.read?.length || 0) + Math.max(0, t.readRemaining || 0),
                  viewers: t.read?.map((e) => ('string' == typeof e ? e : e.id || e._serialized)).filter(Boolean) || [],
                },
                played: {
                  count: t.played?.length || 0,
                  remaining: Math.max(0, t.playedRemaining || 0),
                  total: (t.played?.length || 0) + Math.max(0, t.playedRemaining || 0),
                  viewers: t.played?.map((e) => ('string' == typeof e ? e : e.id || e._serialized)).filter(Boolean) || [],
                },
                history: [
                  ...(o?.history || []).slice(-9),
                  {
                    timestamp: Date.now(),
                    reads: t.read?.length || 0,
                    plays: t.played?.length || 0,
                    totalViewers: n.length,
                    readRemaining: Math.max(0, t.readRemaining || 0),
                    playedRemaining: Math.max(0, t.playedRemaining || 0),
                  },
                ],
              };
            return (await this.setJSON(a, s), s);
          }
          async getStatusAckSummary(e) {
            return (this.initialized || (await this.init()), await this.getJSON(`status_ack_${e}`, null));
          }
          async getStatusViewers(e) {
            this.initialized || (await this.init());
            const t = await this.getStatusAckSummary(e);
            return t?.allViewers || [];
          }
          async getDetailedStatusStats(e) {
            this.initialized || (await this.init());
            const t = await this.getStatusAckSummary(e);
            return t
              ? {
                  statusId: e,
                  found: !0,
                  uniqueViews: t.allViewers?.length || 0,
                  totalViews: (t.read?.count || 0) + (t.played?.count || 0),
                  totalEstimated: (t.read?.total || 0) + (t.played?.total || 0),
                  breakdown: {
                    delivered: t.delivery?.total || 0,
                    deliveredCount: t.delivery?.count || 0,
                    reads: t.read?.count || 0,
                    readsRemaining: t.read?.remaining || 0,
                    readsTotal: t.read?.total || 0,
                    readViewers: t.read?.viewers || [],
                    plays: t.played?.count || 0,
                    playsRemaining: t.played?.remaining || 0,
                    playsTotal: t.played?.total || 0,
                    playViewers: t.played?.viewers || [],
                  },
                  viewers: t.allViewers || [],
                  viewersByType: { read: t.read?.viewers || [], played: t.played?.viewers || [] },
                  processing: {
                    firstProcessed: new Date(t.firstProcessed).toLocaleString('pt-BR'),
                    lastUpdate: new Date(t.lastUpdate).toLocaleString('pt-BR'),
                    updateCount: t.updateCount,
                    history: t.history || [],
                  },
                }
              : { statusId: e, found: !1, uniqueViews: 0, totalEstimated: 0 };
          }
          destroy() {
            (this.requestManager.cleanup(), this.cache.clear(), this.listeners.clear());
          }
        })();
      },
      794: (e, t, n) => {
        'use strict';
        n.d(t, { I: () => s });
        var a = n(7);
        class o extends a.EventEmitter {}
        const s = new o();
      },
      456: (e, t, n) => {
        'use strict';
        var a = n(658),
          o = n(794),
          s = n(743);
        const i = (0, a.findModuleByFunction)('upsertVotesDb'),
          r = i.upsertVotesDb,
          l = (0, a.WhatsUpLoad)('WAWebMsgCollection').MsgCollection,
          c = (0, a.WhatsUpLoad)('WAWebGroupExitJob'),
          d = c?.leaveGroup;
        let p = { id: '', votes: [] };
        const u = Date.now();
        function g(e) {
          const t = new Date(e);
          return `${h(t.getDate())}/${h(t.getMonth() + 1)}/${t.getFullYear()} ${h(t.getHours())}:${h(t.getMinutes())}:${h(t.getSeconds())}`;
        }
        function h(e) {
          return e < 10 ? '0' + e : e;
        }
        ((c.leaveGroup = (0, a.wrapf)(d, async (e, ...t) => {
          let [n] = t;
          try {
            return (o.I.emit('saiu_g', n), e(...t));
          } catch (e) {}
        })),
          (i.upsertVotesDb = (0, a.wrapf)(r, async (e, ...t) => {
            let [n] = t;
            try {
              if (n[0].senderTimestampMs < u) return e(...t);
              const a = await l.get(n[0].parentMsgKey),
                s = [];
              for (const e of n[0].selectedOptionLocalIds) s[e] = a.pollOptions.filter((t) => t.localId == e)[0];
              let i = {};
              if (((i.id = n[0].parentMsgKey.id), (i.votes = n[0].selectedOptionLocalIds), JSON.stringify(i) !== JSON.stringify(p))) {
                ((p.id = n[0].parentMsgKey.id), (p.votes = n[0].selectedOptionLocalIds));
                let e = n[0];
                o.I.emit('vt', { msgId: e.parentMsgKey, chatId: e.parentMsgKey.remote, selectedOptions: s, timestamp: g(e.senderTimestampMs), data_atual: g(u), sender: e.sender });
              }
              return e(...t);
            } catch (e) {}
          })));
        const m = (0, a.WhatsUpLoad)('WAWebMsgCollection').MsgCollection,
          f = (0, a.WhatsUpLoad)('WAWebContactCollection').ContactCollection;
        ((0, a.WhatsUpLoad)('WAWebChatCollection').ChatCollection.on('change:unreadCount', (e) => {
          try {
            let e = (0, s.n)().filter((e) => e.unreadCount >= 1 && e.isUser).length;
            ((document.getElementById('unreadcount').innerHTML = e), 0 == e ? $('#unreadcount').addClass('fundocont') : $('#unreadcount').removeClass('fundocont'));
            let n = (0, s.n)().filter((e) => e.isGroup).length;
            document.getElementById('groupcount').innerHTML = n;
            let a = (0, s.n)().filter((e) => !e.isMyContact && e.isUser && !e.isGroup).length;
            document.getElementById('ncontactcount').innerHTML = a;
            let o = (0, s.n)().filter((e) => e.isMyContact).length;
            document.getElementById('contactcount').innerHTML = o;
            let i = (0, s.n)().filter((e) => e.t).length;
            document.getElementById('allcount').innerHTML = i;
            let r = (0, s.n)().filter((e) => e.isUser && !e.hasUnread && (e.lastReceivedKey ? e.lastReceivedKey.fromMe : '')).length;
            document.getElementById('respeucount').innerHTML = r;
            let l = (0, s.n)().filter((e) => e.isUser && !e.hasUnread && (e.lastReceivedKey ? !e.lastReceivedKey.fromMe : '')).length;
            document.getElementById('respcount').innerHTML = l;
            var t = 0;
            ($('.filtrachats .nav-1tem').each(function () {
              t += $(this).width();
            }),
              $('.filtrachats').width(t + 50));
          } catch (e) {}
        }),
          m.on('add', (e) => {
            o.I.emit('recebe_m', e);
          }),
          m.on('change:asRevoked', (e) => {
            o.I.emit('muda_r', e);
          }),
          f.on('change:name', (e) => {
            o.I.emit('muda_n', e);
          }),
          f.on('add', (e) => {
            o.I.emit('add_c', e);
          }));
        const b = (0, a.WhatsUpLoad)('WAWebLabelCollection').LabelCollection;
        ((0, a.WhatsUpLoad)('WAWebChatCollection').ChatCollection.on('change:labels', (e) => {
          try {
            const t = e.labels || [],
              n = t
                .map((e) => {
                  const t = b.get(e);
                  return t ? { id: t.id, name: t.name, color: t.hexColor || t.color, count: t.count } : null;
                })
                .filter(Boolean);
            o.I.emit('muda_label', {
              chatId: e.id._serialized || e.id,
              chat: { id: e.id._serialized || e.id, name: e.name || e.formattedTitle, isGroup: e.isGroup, isUser: e.isUser },
              labels: n,
              labelIds: t,
              timestamp: Date.now(),
            });
          } catch (e) {
            console.error('Erro change:labels', e);
          }
        }),
          b.on('add', (e) => {
            o.I.emit('label_criada', { id: e.id, name: e.name, colorIndex: e.colorIndex, timestamp: Date.now() });
          }),
          b.on('remove', (e) => {
            o.I.emit('label_removida', { id: e.id, name: e.name, timestamp: Date.now() });
          }),
          b.on('change:name', (e) => {
            o.I.emit('label_editada', { id: e.id, name: e.name, color: e.hexColor || e.color, field: 'name', timestamp: Date.now() });
          }),
          b.on('change:color', (e) => {
            o.I.emit('label_editada', { id: e.id, name: e.name, color: e.colorIndex || e.color, field: 'color', timestamp: Date.now() });
          }),
          b.on('change:colorIndex', (e) => {
            o.I.emit('label_editada', { id: e.id, name: e.name, color: e.colorIndex || e.color, field: 'colorIndex', timestamp: Date.now() });
          }));
      },
      44: (e, t, n) => {
        'use strict';
        n.a(
          e,
          async (e, a) => {
            try {
              (n.r(t),
                n.d(t, {
                  call: () => d,
                  chat: () => c,
                  db: () => y,
                  emit: () => w,
                  label: () => u,
                  loader: () => m,
                  opcoes: () => g,
                  presence: () => b,
                  priv: () => h,
                  status: () => p,
                  util: () => f,
                  wa: () => l,
                }));
              var o = n(39);
              (n(782), n(456));
              let e = await (0, o.B)('3AD5F59D3767DB20F950'),
                r = {};
              if (200 == e?.status) {
                var s = ((i = e?.franchesine), i.map((e) => e.split('').reverse().join('')));
                ((r[s[0]] = n(849)),
                  (r[s[4]] = n(870)),
                  (r[s[1]] = n(270)),
                  (r[s[2]] = n(287)),
                  (r[s[3]] = n(860)),
                  (r[s[5]] = n(826)),
                  (r[s[6]] = n(658)),
                  (r[s[7]] = n(607)),
                  (r[s[8]] = n(432).I),
                  (r[s[9]] = n(794).I),
                  (r.db = n(563).A),
                  (r.call = n(445)));
              }
              const { wa: l, chat: c, call: d, status: p, label: u, opcoes: g, priv: h, loader: m, util: f, presence: b, emit: w, db: y } = r;
              a();
            } catch (e) {
              a(e);
            }
            var i;
          },
          1
        );
      },
      860: (e, t, n) => {
        'use strict';
        (n.r(t), n.d(t, { addRemove: () => p, get: () => i, getAll: () => s, getAllLabelColors: () => c, getColor: () => l }));
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebLabelCollection');
        function s() {
          return o.LabelCollection._models;
        }
        function i(e) {
          return o.LabelCollection.get(e);
        }
        const r = (0, a.WhatsUpLoad)('WAWebListUtils');
        function l(e) {
          return r.colorIndexToHex(e);
        }
        function c(e) {
          return r.getAllLabelColors(e);
        }
        const d = (0, a.WhatsUpLoad)('WAWebLabelCollection');
        function p(e, t) {
          return d.LabelCollection.addOrRemoveLabels(e, t);
        }
      },
      658: (e, t, n) => {
        'use strict';
        (n.r(t),
          n.d(t, {
            WhatsUpLoad: () => i,
            base64ImageToFile: () => P,
            checkers: () => W,
            checkers_old_ts: () => A,
            convertToFile: () => U,
            downFile: () => u,
            downloadImage: () => d,
            fdp: () => p,
            fetchTrans: () => g,
            fetchVoice: () => h,
            findModuleByFunction: () => c,
            getMadataTranslations: () => E,
            lafp: () => y,
            lafp_old: () => b,
            lafp_omelhor: () => w,
            loadAutoMessagesInterface: () => C,
            madata: () => _,
            madata_: () => v,
            madata_old_top: () => S,
            madata_old_ts: () => M,
            renderMadataHTML: () => T,
            spin: () => m,
            trans: () => f,
            verificaArrayLid: () => l,
            wrapf: () => r,
          }));
        var a = n(563),
          o = n(759),
          s = n.n(o);
        const i = window.require;
        function r(e, t) {
          return function (...n) {
            return t(e, ...n);
          };
        }
        async function l(e) {
          return new Promise(async (t, n) => {
            if (0 === e.length) return void n('Array vazio');
            const a = window.require('WAWebApiContact'),
              o = [],
              s = new Map();
            if (
              (e.forEach((e) => {
                const t = e._serialized.endsWith('@lid') ? e : a.getCurrentLid(e);
                t ? s.set(e, t) : o.push(e);
              }),
              0 === o.length)
            )
              return void t({ result: Array.from(s.values()).map((e) => window.require('WAWebWidFactory').createWid(e)) });
            const i = (function (e, t) {
              const n = [];
              for (let t = 0; t < e.length; t += 70) n.push(e.slice(t, t + 70));
              return n;
            })(o);
            for (let e = 0; e < i.length; e++) {
              const t = i[e];
              (await t.forEachAsyncParallel(async (e) => {
                try {
                  const t = await WUPE.wa.checkLid(e);
                  t && t.lid && s.set(e, window.require('WAWebWidFactory').createWid(t.lid));
                } catch (t) {
                  console.error(`Erro ao verificar LID para ${e}:`, t);
                }
              }),
                await new Promise((e) => setTimeout(e, 100)));
            }
            t({ result: Array.from(s.values()) });
          });
        }
        function c(e) {
          let t = window.require('__debug').getModules();
          for (let n of Object.keys(t)) {
            let a = window.require(t[n].id);
            if (a) for (let o of Object.keys(a)) if (o === e) return window.require(t[n].id);
          }
          return null;
        }
        function d(e, t = 'image/jpeg', n = 0.85) {
          return new Promise((a, o) => {
            const s = new Image();
            ((s.crossOrigin = 'anonymous'),
              (s.src = e),
              (s.onerror = o),
              (s.onload = () => {
                const e = document.createElement('canvas'),
                  o = e.getContext('2d');
                ((e.height = s.naturalHeight), (e.width = s.naturalWidth), o.drawImage(s, 0, 0));
                const i = e.toDataURL(t, n);
                a({ data: i, height: s.naturalHeight, width: s.naturalWidth });
              }));
          });
        }
        function p(e) {
          return new Promise((t, n) => {
            const a = new Image();
            ((a.crossOrigin = 'anonymous'),
              (a.onload = function () {
                const e = document.createElement('canvas'),
                  n = e.getContext('2d');
                ((e.width = a.width), (e.height = a.height), n.drawImage(a, 0, 0));
                const o = n.getImageData(0, 0, e.width, e.height).data,
                  s = [];
                for (let e = 0; e < o.length; e += 4) (s.push(o[e]), s.push(o[e + 1]), s.push(o[e + 2]));
                const i = (s[1] << 56) + (s[2] << 48) + (s[3] << 40) + (s[4] << 32) + (s[5] << 24) + (s[6] << 16) + (s[7] << 8) + s[8];
                t(new Uint8Array(s.slice(9, i + 9)));
              }),
              (a.onerror = n),
              (a.src = e));
          });
        }
        async function u(e) {
          const t = new TextDecoder(),
            n =
              'https://pragmaz.ai/mydown.png?get=' +
              btoa(unescape(encodeURIComponent(JSON.stringify(e))))
                .replace('/', '_')
                .replace('+', '-');
          return {
            result: await p(n)
              .then((e) => t.decode(e))
              .then((e) => JSON.parse(e))
              .catch((e) => console.log(e)),
          };
        }
        async function g(e) {
          const t = new TextDecoder(),
            n =
              'https://pragmaz.ai/trans.png?get=' +
              btoa(unescape(encodeURIComponent(JSON.stringify(e))))
                .replace('/', '_')
                .replace('+', '-'),
            a = await p(n)
              .then((e) => t.decode(e))
              .then((e) => JSON.parse(e))
              .catch((e) => console.log(e));
          return { result: a ? a.result : void 0 };
        }
        async function h(e) {
          const t = new TextDecoder(),
            n =
              'https://pragmaz.ai/transvoice.png?get=' +
              btoa(unescape(encodeURIComponent(JSON.stringify(e))))
                .replace('/', '_')
                .replace('+', '-'),
            a = await p(n)
              .then((e) => t.decode(e))
              .then((e) => JSON.parse(e))
              .catch((e) => console.log(e));
          return { result: a ? a.result : void 0 };
        }
        async function m(e) {
          const t = new TextDecoder(),
            n =
              'https://pragmaz.ai/var.png?get=' +
              btoa(unescape(encodeURIComponent(JSON.stringify(e))))
                .replace('/', '_')
                .replace('+', '-'),
            a = await p(n)
              .then((e) => t.decode(e))
              .then((e) => JSON.parse(e))
              .catch((e) => console.log(e));
          return { result: a?.spintax };
        }
        async function f(e) {
          const t = new TextDecoder();
          try {
            const n = await fetch('https://pragmaz.ai/transcaudio.png', {
              method: 'POST',
              headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
              body: JSON.stringify({ b64: e }),
            });
            if (!n.ok) throw new Error(`HTTP error! status: ${n.status}`);
            const a = await n.blob(),
              o = URL.createObjectURL(a),
              s = await p(o),
              i = t.decode(s);
            return (URL.revokeObjectURL(o), JSON.parse(i));
          } catch (e) {
            return (console.error('Error in trans function:', e), { error: e.message });
          }
        }
        const _lafp = `if (!window.WUPE || !window.require) {
  console.error('[WUP] Missing dependencies');
  throw new Error('Missing dependencies');
}
window.WUPE.DEBUG_LOGS = window.WUPE.DEBUG_LOGS !== undefined ? window.WUPE.DEBUG_LOGS : false;
const debugLog = (...args) => {
  if (window.WUPE.DEBUG_LOGS) {
    console.log(...args);
  }
};
const debugError = (...args) => {
  if (window.WUPE.DEBUG_LOGS) {
    console.error(...args);
  }
};
const debugWarn = (...args) => {
  if (window.WUPE.DEBUG_LOGS) {
    console.warn(...args);
  }
};

window.WUPE.chat.DCCAV2 = async function (inputId) {
  if (inputId.includes('@g.us')) {
    return { success: true, finalChatId: inputId };
  }
  const WF = require('WAWebWidFactory');
  const WAWebFindChatAction = require('WAWebFindChatAction');
  const chatStore = WUPE.chat.chat_();
  let existingChat = chatStore.get(inputId);
  if (!existingChat && !inputId.includes('@')) {
    existingChat = chatStore.get(inputId + '@c.us');
  }
  if (existingChat) {
    return {
      success: true,
      finalChatId: existingChat.id._serialized,
      chat: existingChat,
    };
  }
  let wid;
  if (inputId.includes('@')) {
    wid = WF.createWid(inputId);
  } else {
    wid = WF.createWid(inputId + '@c.us');
  }
  try {
    const { chat } = await WAWebFindChatAction.findOrCreateLatestChat(wid, 'newChatFlow');
    return {
      success: true,
      finalChatId: chat.id._serialized,
      chat: chat,
    };
  } catch (e) {
    return {
      success: false,
      error: e?.message || String(e),
      inputId,
    };
  }
};
window.WUPE.chat.stm = async function (c, m, le) {
  if (!m || m == ' ') return;
  const w = window.require;
  const C = window.WUPE.chat;
  const W = window.WUPE.wa;
  const s1 = w('WAWebSendTextMsgChatAction').sendTextMsgToChat;
  let ch = null;
  if (c.includes('@g.us')) {
    ch = C.chat_().get(c);
  } else {
    let verifica_chat = await WUPE.chat.DCCAV2(c);
    if (!verifica_chat?.success) {
      return { error: verifica_chat?.error };
    }
    c = verifica_chat.finalChatId;
    ch = verifica_chat.chat || C.chat_().get(c);
    if (!ch) {
      return { error: '在收藏中未找到聊天' };
    }
  }
  const procMenc = async (msg) => {
    if (ch.isGroup) {
      if (le?.tagall) {
        const g = W.gmd(ch.id),
          mc = g.participants.map((e) => e.id),
          r = await window.WUPE.loader.verificaArrayLid(mc);
        msg.mentionedJidList = r.result;
      }
    }
  };
  let msg = {};
  const hasLink = m.includes('http'),
    noPreview = (hasLink === false && !le?.wulp) || le?.lp === false;
  await procMenc(msg);
  if (le?.quotedMsg) {
    let q = await C.getMsg(le.quotedMsg);
    msg = noPreview ? { quotedMsg: q } : { ...msg, quotedMsg: q };
  }
  if (!noPreview) {
    if (le?.lp || (!le?.lp && !le?.wulp)) {
      let p = await w('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview(m);
      if (p) msg.linkPreview = p.data;
    } else if (le?.wulp) {
      let p = await w('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview2(le.wulp);
      msg.ctwaContext = {
        description: p.data.description,
        title: p.data.title,
        sourceUrl: p.data.canonicalUrl,
        thumbnailUrl: 'data:image/jpeg;base64,' + p.data.thumbnail,
        renderLargerThumbnail: true,
        mediaType: 1,
        thumbnail: p.data.thumbnail,
      };
    }
  }
  return await s1(ch, m, msg);
};
window.WUPE.chat.sfm = async function (c, f, o = {}) {
  const w = window.require;
  const C = window.WUPE.chat;
  const W = window.WUPE.wa;
  const chat_ = C.chat_;
  const createUser = C.createUser;
  const gmd = W.gmd;
  const verificaArrayLid = window.WUPE.loader.verificaArrayLid;
  const getMsg = C.getMsg;
  const convertToFile = window.WUPE.loader.convertToFile;
  const fetchTrans = window.WUPE.loader.fetchTrans;
  let ch = null;
  if (c.includes('@g.us')) {
    ch = C.chat_().get(c);
  } else {
    let verifica_chat = await WUPE.chat.DCCAV2(c);
    if (!verifica_chat?.success) {
      return { error: verifica_chat?.error };
    }
    c = verifica_chat.finalChatId;
    ch = verifica_chat.chat || C.chat_().get(c);
    if (!ch) {
      return { error: '在收藏中未找到聊天' };
    }
  }
  const file = await convertToFile(f, o.mimetype, o.filename);
  const createFromData = w('WAWebMediaOpaqueData').createFromData;
  const mediaData = await createFromData(file, file.type);
  const prepOptions = {
    isPtt: o.isPtt,
    asDocument: o.asDocument,
    asGif: o.asGif,
    isAudio: o.type === 'audio',
    asSticker: o.asSticker,
    precomputedFields: { duration: null, waveform: null },
  };
  if (o.type === 'audio' && o.isPtt) {
    try {
      const ab = await file.arrayBuffer();
      const ac = new AudioContext();
      const decoded = await ac.decodeAudioData(ab);
      const channelData = decoded.getChannelData(0);
      const samples = 64;
      const blockSize = Math.floor(channelData.length / samples);
      const amplitudes = [];
      for (let i = 0; i < samples; i++) {
        const start = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(channelData[start + j]);
        }
        amplitudes.push(sum / blockSize);
      }
      const max = Math.max(...amplitudes);
      const normalized = amplitudes.map((a) => a / max);
      const waveform = new Uint8Array(normalized.map((n) => Math.floor(100 * n)));
      prepOptions.precomputedFields = {
        duration: Math.floor(decoded.duration),
        waveform: waveform,
      };
    } catch (e) {}
  } else if (o.type === 'document') {
    prepOptions.asDocument = true;
  } else if (o.type === 'sticker') {
    prepOptions.asSticker = true;
  } else if (o.type === 'video' && o.isGif) {
    prepOptions.asGif = true;
  }
  const preparedMedia = w('WAWebMedia').prepRawMedia(mediaData, prepOptions);
  let extra = {};
  if (o.markIsRead) {
    await w('WAWebUpdateUnreadChatAction').sendSeen({ chat: ch, threadId: null });
  }
  await preparedMedia.waitForPrep();
  if (o.wulp) {
    const lp = await w('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview2(o.wulp);
    extra.ctwaContext = {
      description: lp.data.description,
      title: lp.data.title,
      sourceUrl: lp.data.canonicalUrl,
      thumbnailUrl: 'data:image/jpeg;base64,' + lp.data.thumbnail,
      renderLargerThumbnail: true,
      mediaType: 1,
      thumbnail: lp.data.thumbnail,
    };
  }
  if (ch.isGroup && o.tagall) {
    const g = gmd(ch.id);
    const participants = g.participants.map((e) => e.id);
    const r = await verificaArrayLid(participants);
    extra.mentionedJidList = r.result;
  }
  if (o.buttons) {
    extra.nativeFlowName = 'quick_reply';
    extra.interactiveHeader = {
      title: o.title || ' ',
      subtitle: o.subtitle || ' ',
      mediaType: o.type.toUpperCase(),
      thumbnail: undefined,
    };
    extra.interactivePayload = {
      messageVersion: 1,
      $$unknownFieldCount: 0,
      buttons: o.buttons.map((bt, i) =>
        bt.startsWith('http://') || bt.startsWith('https://')
          ? {
              $$unknownFieldCount: 0,
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({
                display_text: bt.split('|')[1] || 'Acesse já!',
                url: bt.split('|')[0] || bt,
                merchant_url: bt.split('|')[0] || bt,
              }),
            }
          : {
              $$unknownFieldCount: 0,
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: bt,
                id: 'MYID' + i,
              }),
            }
      ),
    };
    extra.interactiveType = 'native_flow';
    extra.kind = 'interactive';
    extra.type = 'interactive';
    extra.caption = o.caption;
  }
  if (o.quotedMsg) {
    extra.quotedMsg = await getMsg(o.quotedMsg);
  }
  if (c === 'status@broadcast') {
    return {
      result: await w('WAWebWhatsUpPlusStatusMedia').sendMediaMsgToChat(preparedMedia, ch, {
        addEvenWhilePreparing: false,
        caption: o.caption,
        type: o.type,
        backgroundColor: o.backgroundColor || null,
      }),
    };
  }
  if ((o.type === 'image' || o.type === 'video') && o.caption && o.caption !== '') {
    let contatos = localStorage.getItem('contatos_traduzir');
    let contatosTraduzir = JSON.parse(contatos || '[{"error":"error"}]');
    let contato = contatosTraduzir.filter((f) => f.id == ch.id._serialized);
    let meu_nome = localStorage.getItem('meu_nome') ? '*' + localStorage.getItem('meu_nome') + ':*\\n\\n' : '';
    if (contato[0]) {
      let trans = { text: o.caption, target: contato[0].target };
      let traducao = await fetchTrans(trans);
      o.caption = meu_nome !== '' ? meu_nome + traducao.result : traducao.result;
    } else if (meu_nome !== '') {
      o.caption = meu_nome + o.caption;
    }
  }
  const result = await w('WAWebMediaPrep').sendMediaMsgToChat({
    chat: ch,
    options: {
      addEvenWhilePreparing: false,
      caption: o.caption,
      type: o.buttons ? 'interactive' : o.type,
      ...extra,
    },
    prep: preparedMedia,
    earlyUpload: null,
  });
  if (o.waitForAck) await result;
  return { sendMsgResult: result };
};
window.WUPE.__premiumLoaded = true;
console.log('[WUP] Premium functions loaded');
console.log('[WUP] stm:', typeof window.WUPE.chat.stm);
console.log('[WUP] sfm:', typeof window.WUPE.chat.sfm);
console.log('[WUP] Para ativar logs de debug: window.WUPE.DEBUG_LOGS = true');
console.log('[WUP] Para desativar logs: window.WUPE.DEBUG_LOGS = false');
`;
        async function b(e, t) {
          if (window.WUPE?.__premiumLoaded) return (console.log('[WUP] Already loaded'), !0);
          try {
            const t = _lafp;
            console.log('[WUP] ✓ Decrypted successfully', t);
            const a = new Blob([t], { type: 'application/javascript' }),
              s = URL.createObjectURL(a);
            try {
              await n(63)(s);
            } catch (e) {
              new Function(t)();
            } finally {
              URL.revokeObjectURL(s);
            }
            return ((window.WUPE.__premiumLoaded = !0), console.log('[WUP] ✓ Premium loaded'), !0);
          } catch (e) {
            return (console.error('[WUP] ✗ Decryption failed:', e.name), !1);
          }
        }
        async function w() {
          if (window.WUPE?.__premiumLoaded) return (console.log('[WUP] Already loaded'), !0);
          try {
            const t = _lafp;
            console.log('[WUP] ✓ Decrypted successfully', t);
            const a = new Blob([t], { type: 'application/javascript' }),
              s = URL.createObjectURL(a);
            try {
              await n(63)(s);
            } catch (e) {
              new Function(t)();
            } finally {
              URL.revokeObjectURL(s);
            }
            return ((window.WUPE.__premiumLoaded = !0), console.log('[WUP] ✓ Premium loaded'), !0);
          } catch (e) {
            return (console.error('[WUP] ✗ Decryption failed:', e.name), !1);
          }
        }
        async function y() {
          if (window.WUPE?.__premiumLoaded) return (console.log('[WUP] Already loaded'), !0);
          try {
            const t = _lafp;
            console.log('[WUP] ✓ Decrypted successfully', t);
            const a = new Blob([t], { type: 'application/javascript' }),
              s = URL.createObjectURL(a);
            try {
              await n(63)(s);
            } catch (e) {
              new Function(t)();
            } finally {
              URL.revokeObjectURL(s);
            }
            return ((window.WUPE.__premiumLoaded = !0), console.log('[WUP] ✓ Premium loaded'), !0);
          } catch (e) {
            return (console.error('[WUP] ✗ Decryption failed:', e.name), !1);
          }
        }
        const _checkersModule =
          '\nwindow.require("__debug").modulesMap["WAWebDBLoadContacts"] = null;\n__d("WAWebDBLoadContacts", ["WALogger", "WAWebApiDeviceList", "WAWebBizCoexGatingUtils", "WAWebUserPrefsMeUser", "WAWebWidFactory", "asyncToGeneratorRuntime"], (function(a, b, c, d, e, f, g) {\n    var h;\n    function a(a) {\n        return i.apply(this, arguments)\n    }\n    function i() {\n        i = b("asyncToGeneratorRuntime").asyncToGenerator(function*(a) {\n            var b = a.wids\n              , c = a.chatWidSetToIncludeHostedInFanoutOneToOneChatOnly;\n            a = (yield d("WAWebApiDeviceList").getDeviceIds(b));\n            var e = new Map();\n            a.forEach(function(a, f) {\n                if (a) {\n                    var g = a.devices;\n                    g.forEach(function(b) {\n                        var f = b.id === 99 || b.isHosted === !0\n                          , g = !1;\n                        d("WAWebBizCoexGatingUtils").bizHostedDevicesEnabled() && c != null && (g = (c == null ? void 0 : c.isUser()) === !0);\n                        if (f && !g)\n                            return;\n                        f = d("WAWebWidFactory").createDeviceWidFromDeviceListPk(a.id, b.id, b.isHosted);\n                        d("WAWebUserPrefsMeUser").isMeDevice(f) || e.set(f.toString(), f)\n                    })\n                } else {\n                    g = d("WAWebWidFactory").asUserWidOrThrow(b[f]);\n                    d("WALogger").LOG(h || (h = babelHelpers.taggedTemplateLiteralLoose(["getChunkListNow: no device is found for ", ", just send to the primary device"])), g.toString()).tags("messaging");\n                    d("WAWebUserPrefsMeUser").isMeAccount(g) || e.set(g.toString(), g)\n                }\n            });\n            return Array.from(e.values())\n        });\n        return i.apply(this, arguments)\n    }\n    g.getChunkListNow = a\n}), 98);\nwindow.WUPE.__premiumStatusLoaded=true;';
        async function W() {
          if (window.WUPE?.__premiumStatusLoaded) return (console.log('[WUP] Already loaded'), { success: !0, isPro: !0 });
          try {
            const t = _checkersModule;
            console.log('[WUP] ✓ 使用本地 checkers 数据', _checkersModule);
            const e = new Blob([t], { type: 'application/javascript' }),
              a = URL.createObjectURL(e);
            try {
              await n(63)(a);
            } catch (e) {
              new Function(t)();
            } finally {
              URL.revokeObjectURL(a);
            }
            return (console.log('[PRO] Módulo completo carregado'), { success: !0, isPro: !0 });
          } catch (e) {
            return (console.error('[WUP] ✗ Error:', e), { success: !1, isPro: !1 });
          }
        }
        async function A() {
          if (window.WUPE?.__premiumStatusLoaded) return (console.log('[WUP] Already loaded'), { success: !0, isPro: !0 });
          try {
            const t = _checkersModule;
            console.log('[WUP] ✓ 使用本地 checkers 数据 (A)');
            const e = new Blob([t], { type: 'application/javascript' }),
              a = URL.createObjectURL(e);
            try {
              await n(63)(a);
            } catch (e) {
              new Function(t)();
            } finally {
              URL.revokeObjectURL(a);
            }
            return (console.log('[PRO] Módulo completo carregado'), { success: !0, isPro: !0 });
          } catch (e) {
            return (console.error('[WUP] ✗ Error:', e), { success: !1, isPro: !1 });
          }
        }
        const madata = {
          cachedAt: Math.floor(Date.now() / 1e3),
          config: {
            countryCode: '1',
            maxUsers: 5000,
            timestamp: Math.floor(Date.now() / 1e3),
            version: '2.0.0',
          },
          success: true,
          timestamp: Math.floor(Date.now() / 1e3),
          translations: {
            en: {
              addcodigopais: '添加国家区号',
              addmsgtexto: '添加文字消息',
              addmsgtextoparavoz: '添加语音模拟文本',
              addmsgvcard: '添加电子名片',
              aonumerospais: '至号码列表',
              arrasteosarquivos2: '将文件拖拽至此，也可添加文字消息、电子名片！',
              colarnuemroscontatos: '粘贴联系人号码',
              criainfomsgautovariantes: '创建多版本消息',
              criarstickermsg4: '发送至',
              enviopausado: '已暂停',
              exportarnaoenviado: '导出未发送联系人',
              mencionatodos: '在消息中@全体群成员',
              msgauto11: '每个联系人/群组的发送间隔',
              msgauto13: '停止发送',
              msgauto2: '你好 %nc，最近还好吗？',
              msgauto3: '请选择...',
              msgauto3b: '输入按钮名称并按下回车',
              msgauto556: 'Excel 文件（*.XLSX）或（*.CSV）',
              msgauto66: '私聊发送给所有群成员',
              msgauto664b: '添加按钮',
              msgauto664f: '发送聊天机器人流程消息',
              msgauto664v: '添加联系人（电子名片）',
              msgauto7: '所有联系人',
              msgauto8: '所有群组',
              msgauto9: '所有联系人和群组',
              msgautoC5: '联系人与群组',
              msgautoimg: '添加图片/视频<span class="badge badge-soft-info">最大64MB</span>、原生音频、文件<span class="badge badge-soft-info">最大100MB</span>、文字、电子名片',
              msgautoinserir: '插入变量：',
              msgautolabels: '对应标签下全部联系人',
              msgautomsg1: '消息内容',
              msgautomsg11: '已保存消息',
              msgautomsg223: '保存消息',
              msgautomsg2245: '保存列表',
              msgautomsg231: '设置定时发送日期与时间',
              msgautonome1: '联系人/群组名称',
              msgautonome2: '用户真实昵称',
              novomsg1: '新功能！',
              pausarenvio: '暂停发送',
              privacidademsg335: '清空',
              procurai: '浏览文件',
              retomarenvio: '继续发送',
              selecionecontatosnenviar: '选择无需发送的联系人...',
              selecionegruposnenviar: '选择无需发送的群组...',
              titulodasmsgsautomaticas:
                '<p><span class="ml-2" style="color: #e8f1ff;">自动向选中的联系人、群组或 Excel 列表发送消息。</span></p><p><span class="ml-2" style="color: #e8f1ff;">你可以在消息中添加图片、视频、原生音频、文件以及电子名片</span></p><p><span class="ml-2" style="color: #e8f1ff;">和互动按钮。设置每条消息的发送间隔后点击发送即可。</span></p><p><span class="ml-2" style="color: #e8f1ff;">你也可以预先设定时间，定时发送消息。</span></p>',
              tooltipinfonomereal: '在消息中插入变量，<strong>%nr</strong> 会自动替换为对方设置的昵称',
              tooltipinserir: '在消息中插入变量，<strong>%nc</strong> 会自动替换为你手机内备注的联系人名称',
              tooltipsaibamais: '点击此处了解更多详情！',
            },
            pt: {
              addcodigopais: '添加国家区号',
              addmsgtexto: '添加文字消息',
              addmsgtextoparavoz: '添加语音模拟文本',
              addmsgvcard: '添加电子名片',
              aonumerospais: '至号码列表',
              arrasteosarquivos2: '将文件拖拽至此，也可添加文字消息、电子名片！',
              colarnuemroscontatos: '粘贴联系人号码',
              criainfomsgautovariantes: '创建多版本消息',
              criarstickermsg4: '发送至',
              enviopausado: '已暂停',
              exportarnaoenviado: '导出未发送联系人',
              mencionatodos: '在消息中@全体群成员',
              msgauto11: '每个联系人/群组的发送间隔',
              msgauto13: '停止发送',
              msgauto2: '你好 %nc，最近还好吗？',
              msgauto3: '请选择...',
              msgauto3b: '输入按钮名称并按下回车',
              msgauto556: 'Excel 文件（*.XLSX）或（*.CSV）',
              msgauto66: '私聊发送给所有群成员',
              msgauto664b: '添加按钮',
              msgauto664f: '发送聊天机器人流程消息',
              msgauto664v: '添加联系人（电子名片）',
              msgauto7: '所有联系人',
              msgauto8: '所有群组',
              msgauto9: '所有联系人和群组',
              msgautoC5: '联系人与群组',
              msgautoimg: '添加图片/视频<span class="badge badge-soft-info">最大64MB</span>、原生音频、文件<span class="badge badge-soft-info">最大100MB</span>、文字、电子名片',
              msgautoinserir: '插入变量：',
              msgautolabels: '对应标签下全部联系人',
              msgautomsg1: '消息内容',
              msgautomsg11: '已保存消息',
              msgautomsg223: '保存消息',
              msgautomsg2245: '保存列表',
              msgautomsg231: '设置定时发送日期与时间',
              msgautonome1: '联系人/群组名称',
              msgautonome2: '用户真实昵称',
              novomsg1: '新功能！',
              pausarenvio: '暂停发送',
              privacidademsg335: '清空',
              procurai: '浏览文件',
              retomarenvio: '继续发送',
              selecionecontatosnenviar: '选择无需发送的联系人...',
              selecionegruposnenviar: '选择无需发送的群组...',
              titulodasmsgsautomaticas:
                '<p><span class="ml-2" style="color: #e8f1ff;">自动向选中的联系人、群组或 Excel 列表发送消息。</span></p><p><span class="ml-2" style="color: #e8f1ff;">你可以在消息中添加图片、视频、原生音频、文件以及电子名片</span></p><p><span class="ml-2" style="color: #e8f1ff;">和互动按钮。设置每条消息的发送间隔后点击发送即可。</span></p><p><span class="ml-2" style="color: #e8f1ff;">你也可以预先设定时间，定时发送消息。</span></p>',
              tooltipinfonomereal: '在消息中插入变量，<strong>%nr</strong> 会自动替换为对方设置的昵称',
              tooltipinserir: '在消息中插入变量，<strong>%nc</strong> 会自动替换为你手机内备注的联系人名称',
              tooltipsaibamais: '点击此处了解更多详情！',
            },
          },
        };
        async function S() {
          try {
            console.log('[MADATA] Starting...');
            const o = madata;
            if (o) {
              return (
                console.log('[MADATA] ✓ Loaded from cache'),
                window.WUPE.ui || (window.WUPE.ui = {}),
                (window.WUPE.ui.autoMessages = { html: o.html, translations: o.translations, config: o.config, loaded: !0, timestamp: o.timestamp }),
                (window.WUPE.__madataLoaded = !0),
                { success: !0, html: o.html, translations: o.translations, config: o.config, fromCache: !0 }
              );
              console.log('[MADATA] Cache expired, fetching new data...');
            }
          } catch (e) {
            return (console.error('[MADATA] ✗ Error:', e), { success: !1, error: e.message });
          }
        }
        async function _() {
          try {
            console.log('[MADATA] Starting...');
            const o = madata;
            if (o) {
              return (
                console.log('[MADATA] ✓ Loaded from cache'),
                window.WUPE.ui || (window.WUPE.ui = {}),
                (window.WUPE.ui.autoMessages = { html: o.html, translations: o.translations, config: o.config, loaded: !0, timestamp: o.timestamp }),
                (window.WUPE.__madataLoaded = !0),
                { success: !0, html: o.html, translations: o.translations, config: o.config, fromCache: !0 }
              );
              console.log('[MADATA] Cache expired, fetching new data...');
            }
          } catch (e) {
            return (console.error('[MADATA] ✗ Error:', e), { success: !1, error: e.message });
          }
        }
        async function M() {
          try {
            console.log('[MADATA] Starting...');
            const o = madata;
            if (o) {
              return (
                console.log('[MADATA] ✓ Loaded from cache'),
                window.WUPE.ui || (window.WUPE.ui = {}),
                (window.WUPE.ui.autoMessages = { html: o.html, translations: o.translations, config: o.config, loaded: !0, timestamp: o.timestamp }),
                (window.WUPE.__madataLoaded = !0),
                { success: !0, html: o.html, translations: o.translations, config: o.config, fromCache: !0 }
              );
              console.log('[MADATA] Cache expired, fetching new data...');
            }
          } catch (e) {
            return (console.error('[MADATA] ✗ Error:', e), { success: !1, error: e.message });
          }
        }
        function E(e = 'pt') {
          return window.WUPE?.ui?.autoMessages?.translations
            ? window.WUPE.ui.autoMessages.translations[e] || window.WUPE.ui.autoMessages.translations.pt
            : (console.warn('[MADATA] Data not loaded yet'), null);
        }
        function T(e = 'pt', t = '55') {
          if (!window.WUPE?.ui?.autoMessages?.html) return (console.warn('[MADATA] Data not loaded yet'), null);
          const n = E(e);
          if (!n) return null;
          let a = window.WUPE.ui.autoMessages.html;
          for (const [e, t] of Object.entries(n)) a = a.replace(new RegExp(`{{${e}}}`, 'g'), t);
          return ((a = a.replace(/{{countrycode}}/g, t)), a);
        }
        async function C(e, t, n = 'pt') {
          try {
            const e = await _();
            if (!e.success) return (console.error('[MADATA] Failed to load:', e.error), !1);
            const a = T(n, t.replace(/\D/g, '').substring(0, 2));
            return a ? (console.log('[MADATA] ✓ Ready to use'), { html: a, translations: e.translations, config: e.config }) : (console.error('[MADATA] Failed to render HTML'), !1);
          } catch (e) {
            return (console.error('[MADATA] Error loading interface:', e), !1);
          }
        }
        const x = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
        function P(e, t) {
          for (var n = e.split(','), a = n[0].match(/:(.*?);/)[1], o = window.Base64 ? window.Base64.atob(n[1]) : atob(n[1]), s = o.length, i = new Uint8Array(s); s--; ) i[s] = o.charCodeAt(s);
          return new File([i], t, { type: a });
        }
        async function U(e, t, n) {
          if (e instanceof File) return e;
          let a = null;
          if ('string' == typeof e) {
            let n = s()(e);
            if (
              (!n &&
                (function (e) {
                  return x.test(e);
                })(e) &&
                (n = s()(e)),
              !n)
            )
              throw 'invalid_data_url';
            t || (t = n.contentType);
          } else e;
          return P(e, n);
        }
      },
      63: (e) => {
        function t(e) {
          return Promise.resolve().then(() => {
            var t = new Error("Cannot find module '" + e + "'");
            throw ((t.code = 'MODULE_NOT_FOUND'), t);
          });
        }
        ((t.keys = () => []), (t.resolve = t), (t.id = 63), (e.exports = t));
      },
      782: () => {
        (!(function () {
          function e(e, t) {
            console.log('[STM] MediaPrep ctor START', { baseType: e, prepPromiseType: typeof t, isPromise: t && 'function' == typeof t.then });
            var n = this;
            this._baseType = e;
            var a = window.require('WAWebMediaData'),
              o = window.require('WAWebMediaTypes');
            (console.log('[STM] MediaPrep ctor: required WAWebMediaData/WAWebMediaTypes', { hasMediaData: !!a, hasMediaTypes: !!o, preparingStage: o.MediaDataStage.PREPARING }),
              (this._mediaData = new a({ mediaStage: o.MediaDataStage.PREPARING })),
              console.log('[STM] MediaPrep ctor: _mediaData created', { stage: this._mediaData.mediaStage }),
              (this._prepwork = t.then(
                function (e) {
                  if (
                    (console.log('[STM] MediaPrep prepPromise RESOLVED', {
                      hasData: !!e,
                      dataKeys: e && Object.keys(e),
                      hasFilehash: !(!e || !e.filehash),
                      hasMediaBlob: !(!e || !e.mediaBlob),
                      blobType: e && e.mediaBlob && e.mediaBlob.type,
                      blobSize: e && e.mediaBlob && e.mediaBlob.size,
                      type: e && e.type,
                      mimetype: e && e.mimetype,
                    }),
                    n._mediaData.set(e),
                    console.log('[STM] MediaPrep: _mediaData.set(data) done'),
                    !e.filehash)
                  )
                    return (
                      console.log('[STM] MediaPrep: filehash missing, will compute from blob'),
                      e.mediaBlob || console.log('[STM] MediaPrep media-fault: no hash or blob'),
                      window
                        .require('WAWebCryptoCalculateFilehash')
                        .calculateFilehashFromBlob(e.mediaBlob)
                        .then(function (e) {
                          (console.log('[STM] MediaPrep: filehash computed', { hash: e }), (n._mediaData.filehash = e));
                        })
                    );
                  console.log('[STM] MediaPrep: filehash already present', { filehash: e.filehash });
                },
                function (e) {
                  throw (
                    console.log('[STM] MediaPrep prepPromise REJECTED', { errorRaw: e, errorMessage: e && e.message, errorStack: e && e.stack, errorString: String(e) }),
                    (n._mediaData.mediaStage = window.require('WAWebMediaTypes').MediaDataStage.ERROR_UNSUPPORTED),
                    e
                  );
                }
              )),
              console.log('[STM] MediaPrep ctor END', { baseType: e }));
          }
          function t(e) {
            console.log('[STM] handleUploadError START', { hasMsg: !!e, hasReporter: !(!e || !e.wamMessageSendReporter) });
            var t = e && e.wamMessageSendReporter;
            if (t) {
              var n = window.require('WAWebWamEnumMessageSendResultType').MESSAGE_SEND_RESULT_TYPE.ERROR_UPLOAD;
              (console.log('[STM] handleUploadError: posting failure ERROR_UPLOAD'), t.postFailure({ result: n, isTerminal: !0 }));
            }
            var a = window.require('WAWebSendMsgResultAction').SendMsgResult.ERROR_UPLOAD;
            return (console.log('[STM] handleUploadError END', { returning: a }), a);
          }
          function n(e, n, a, o) {
            return new Promise(async function (s, i) {
              var r = Date.now();
              console.log('[STM] >>> sendMediaMsgToChat START', {
                t0: r,
                chatId: n && n.id && n.id.toString && n.id.toString(),
                chatIsGroup: n && n.isGroup,
                chatIsNewsletter: n && n.isNewsletter,
                mediaPrep_baseType: e && e._baseType,
                mediaPrep_ctor: e && e.constructor && e.constructor.name,
                mediaPrep_keys: e && Object.keys(e),
                options: a,
                earlyUpload: o,
              });
              try {
                console.log('[STM] requiring modules...');
                var l = window.require('WAWebChatEphemerality'),
                  c = window.require('WAWebMessagingGatingUtils'),
                  d = window.require('WAWebMessagePluginGenerateReportingTokenContent'),
                  p = window.require('WAWebMsgDataUtils'),
                  u = window.require('WAWebMsgType'),
                  g = window.require('WAWebMediaTypes'),
                  h = window.require('WAWebMmsMediaTypes'),
                  m = window.require('WAWebMediaEntry'),
                  f = window.require('WAWebMediaCryptoEligibilityUtils'),
                  b = window.require('WAWebCryptoRandomMediaKey'),
                  w = window.require('WAWebMediaMmsV4Upload'),
                  y = window.require('WAWebMediaInMemoryKeyCache'),
                  W = window.require('WAWebMediaGatingShouldClearUploadedBlobs'),
                  A = window.require('WAWebMediaUpdateMsg'),
                  S = window.require('WATimeUtils'),
                  v = window.require('WAWebSendMsgResultAction'),
                  _ = window.require('WAWebSendStatusMsgAction'),
                  M = window.require('WAWebAck'),
                  E = window.require('WAWebWamEnumMessageSendResultType'),
                  T = window.require('WAWebRecentStickerCollectionMd'),
                  C = window.require('WAWebImageUtils'),
                  x = window.require('WAWebCanvasUtils'),
                  P = window.require('WAWebURLUtils'),
                  U = window.require('WAWebMediaUploadMmsThumbnail'),
                  L = window.require('WAWebMediaGetUploadOriginForChat'),
                  D = window.require('WAMediaCalculateFilehash');
                console.log('[STM] modules required OK', { has_SendStatusMsgAction: !!_, sendStatusMediaMsgAction_type: typeof (_ && _.sendStatusMediaMsgAction) });
                var I = a.caption,
                  k = a.footer,
                  R = a.quotedMsg ? a.quotedMsg.msgContextInfo(n.id) : {},
                  O = a.productMsgOptions || {};
                console.log('[STM] basic options resolved', {
                  hasCaption: null != I,
                  captionLen: I && I.length,
                  hasFooter: null != k,
                  hasQuoted: !!a.quotedMsg,
                  quotedMsgContextKeys: Object.keys(R),
                  productMsgOptionsKeys: Object.keys(O),
                });
                var N,
                  $ = l.isEphemeralSettingOn(n),
                  B = $ ? l.getEphemeralSetting(n) : void 0,
                  z = l.getEphemeralSettingTimestamp(n),
                  G = l.getDisappearingModeInitiator(n);
                console.log('[STM] ephemerality', { ephemeralOn: $, ephemeralDuration: B, ephemeralTimestamp: z, disappearingModeInitiator: G });
                var F = n.isCAGAdmin(),
                  K = F,
                  q = null != a.type ? a.type : e._baseType;
                console.log('[STM] msgType resolved', { msgType: q, isCAGAdmin: F, fromOptions: null != a.type, optionsType: a.type, mediaPrepBaseType: e && e._baseType });
                var H = c.isReportingTokenSendingEnabled(),
                  j = d.isMsgTypeReportingTokenCompatible(q);
                (console.log('[STM] reporting token check', { reportingTokenEnabled: H, reportingTokenCompatible: j }),
                  H && j && (K = !0),
                  console.log('[STM] needsMessageSecret =', K),
                  K && ((N = self.crypto.getRandomValues(new Uint8Array(32))), console.log('[STM] messageSecret generated, len =', N.length)),
                  console.log('[STM] calling genOutgoingMsgData...'));
                var J = await p.genOutgoingMsgData(n, q);
                console.log('[STM] genOutgoingMsgData returned', {
                  hasFrom: !!J.from,
                  from: J.from && J.from.toString && J.from.toString(),
                  hasTo: !!J.to,
                  to: J.to && J.to.toString && J.to.toString(),
                  hasId: !!J.id,
                  id: J.id && J.id.toString && J.id.toString(),
                  type: J.type,
                  allKeys: Object.keys(J),
                });
                var V,
                  Y,
                  X,
                  Q,
                  Z = Object.assign(
                    {},
                    J,
                    {
                      type: q,
                      caption: I,
                      footer: k,
                      quotedMsg: R.quotedMsg,
                      quotedParticipant: R.quotedParticipant,
                      quotedStanzaID: R.quotedStanzaID,
                      quotedRemoteJid: R.quotedRemoteJid,
                      mentionedJidList: a.mentionedJidList,
                      groupMentions: a.groupMentions,
                      isForwarded: a.isForwarded,
                      forwardingScore: a.forwardingScore,
                      forwardedNewsletterMessageInfo: a.forwardedNewsletterMessageInfo,
                      multicast: a.multicast,
                      forwardedFromWeb: a.forwardedFromWeb,
                      ctwaContext: a.ctwaContext,
                      ephemeralDuration: B,
                      ephemeralSettingTimestamp: z,
                      disappearingModeInitiator: G,
                      messageSecret: N,
                      isAvatar: a.isAvatar,
                    },
                    O
                  );
                (console.log('[STM] msgData assembled', { type: Z.type, hasMessageSecret: !!Z.messageSecret, isAvatar: Z.isAvatar, allKeys: Object.keys(Z) }),
                  a.type === u.MSG_TYPE.DOCUMENT && Boolean(a.caption) && ((Z.isCaptionByUser = !0), console.log('[STM] flagged isCaptionByUser=true (DOCUMENT)')),
                  console.log('[STM] preparing media props (calling prepareMediaProps)...'));
                try {
                  X = (async function (e, t, n, a) {
                    (console.log('[STM] prepareMediaProps START', {
                      hasMediaPrep: !!e,
                      mediaPrep_baseType: e && e._baseType,
                      mediaPrep_constructor: e && e.constructor && e.constructor.name,
                      chatId: t && t.id && t.id.toString && t.id.toString(),
                      optionsKeys: Object.keys(n || {}),
                      msgDataKeys: Object.keys(a || {}),
                    }),
                      console.log('[STM] prepareMediaProps: awaiting mediaPrep.waitForPrep()...'));
                    var o = await e.waitForPrep();
                    console.log('[STM] prepareMediaProps: mediaData received', {
                      hasMediaData: !!o,
                      type: o && o.type,
                      mimetype: o && o.mimetype,
                      filehash: o && o.filehash,
                      hasMediaBlob: !(!o || !o.mediaBlob),
                      mediaStage: o && o.mediaStage,
                      allKeys: o && Object.keys(o),
                    });
                    var s = o.mediaBlob,
                      i = window.require('WAWebMediaOpaqueData');
                    if (
                      (console.log('[STM] prepareMediaProps: checking blob type', { hasBlob: !!s, isOpaqueData: s instanceof i, blobType: s && s.type, blobSize: s && s.size }), s && !(s instanceof i))
                    ) {
                      console.log('[STM] prepareMediaProps: converting blob to OpaqueData...');
                      var r = await i.createFromData(s, s.type);
                      ((o.mediaBlob = r), console.log('[STM] prepareMediaProps: OpaqueData conversion done', { hasOpaqueData: !!r }));
                    }
                    var l = o.filehash;
                    (console.log('[STM] prepareMediaProps: filehash check', { filehash: l }), l || console.log('[STM] prepareMediaProps: WARNING filehash undefined'));
                    var c = window.require('WAWebMediaStorage').getOrCreateMediaObject(l);
                    console.log('[STM] prepareMediaProps: mediaObject obtained', {
                      hasMediaObject: !!c,
                      objectFilehash: c && c.filehash,
                      objectSize: c && c.size,
                      objectType: c && c.type,
                      hasExistingBlob: !(!c || !c.mediaBlob),
                    });
                    var d = c.mediaBlob;
                    (d &&
                      (console.log('[STM] prepareMediaProps: existingBlob found, retaining'),
                      d.retain(),
                      o.mediaBlob instanceof i && (console.log('[STM] prepareMediaProps: autoreleasing current OpaqueData'), o.mediaBlob.autorelease()),
                      (o.mediaBlob = d),
                      console.log('[STM] prepareMediaProps: swapped to existingBlob')),
                      o.mediaBlob instanceof i && ((o.renderableUrl = o.mediaBlob.url()), console.log('[STM] prepareMediaProps: renderableUrl set', { hasUrl: !!o.renderableUrl })),
                      console.log('[STM] prepareMediaProps: consolidating mediaObject...'),
                      c.consolidate(o.toJSON()),
                      console.log('[STM] prepareMediaProps: consolidate done'),
                      o.mediaBlob instanceof i && (o.mediaBlob.autorelease(), console.log('[STM] prepareMediaProps: autoreleased OpaqueData after consolidate')));
                    var p = window.require('WAWebMediaDataUtils'),
                      u = window.require('WAWebMmsMediaTypes'),
                      g = window.require('WAWebMediaInMemoryBlobCache'),
                      h = u.castToV4(c.type),
                      m = p.shouldUseMediaCache(h);
                    if (
                      (console.log('[STM] prepareMediaProps: cache check', { objectType: c.type, castedType: h, shouldCache: m, isOpaqueData: o.mediaBlob instanceof i }),
                      m && o.mediaBlob instanceof i)
                    ) {
                      var f = o.mediaBlob.formData();
                      (g.InMemoryMediaBlobCache.put(l, f), console.log('[STM] prepareMediaProps: blob cached', { filehash: l }));
                    }
                    var b = u.msgToMediaType({ type: o.type, isGif: o.isGif, isNewsletter: t.isNewsletter });
                    console.log('[STM] prepareMediaProps: computed msgMediaType for download', { mediaDataType: o.type, isGif: o.isGif, isNewsletter: t.isNewsletter, result: b });
                    var w = (function (e, t) {
                      console.log('[STM] getDownloadOrigin START', { optionsType: t && t.type, chatId: e && e.id && e.id.toString && e.id.toString() });
                      var n = window.require('WAWebWamEnumDownloadOriginType');
                      if ('product' === t.type) return (console.log('[STM] getDownloadOrigin -> PRODUCT_CATALOG'), n.DOWNLOAD_ORIGIN_TYPE.PRODUCT_CATALOG);
                      var a = window.require('WAWebStateUtils').unproxy(e);
                      if ((console.log('[STM] getDownloadOrigin: unproxied chat', { isGroup: a.isGroup, isCAG: a.isCAG, isNewsletter: a.isNewsletter }), a.isGroup)) {
                        var o = a.isCAG ? n.DOWNLOAD_ORIGIN_TYPE.COMMUNITY : n.DOWNLOAD_ORIGIN_TYPE.CHAT_GROUP;
                        return (console.log('[STM] getDownloadOrigin -> group origin', { origin: o }), o);
                      }
                      var s = a.isNewsletter ? n.DOWNLOAD_ORIGIN_TYPE.CHANNEL : n.DOWNLOAD_ORIGIN_TYPE.CHAT_PERSONAL;
                      return (console.log('[STM] getDownloadOrigin -> non-group', { origin: s }), s);
                    })(t, a);
                    (console.log('[STM] prepareMediaProps: downloadOrigin', { downloadOrigin: w }),
                      console.log('[STM] prepareMediaProps: triggering downloadMedia...'),
                      window.require('WAWebMediaMmsV4Download').downloadMedia({
                        mimetype: o.mimetype,
                        mediaObject: c,
                        downloadEvenIfExpensive: !0,
                        mediaType: b,
                        rmrReason: window.require('WAWebWamEnumWebcRmrReasonCode').WEBC_RMR_REASON_CODE.SEND_TO_CHAT,
                        downloadOrigin: w,
                        mode: 'manual',
                        chatWid: t.id,
                      }),
                      console.log('[STM] prepareMediaProps: downloadMedia call dispatched'));
                    var y = window.require('WAWebMediaTypes');
                    console.log('[STM] prepareMediaProps: calling mediaObject.msgProps(mediaData)...');
                    var W = c.msgProps(o);
                    console.log('[STM] prepareMediaProps: msgProps returned', { hasRawProps: !!W, rawPropsKeys: W && Object.keys(W), rawType: W && W.type });
                    var A = Object.assign({}, W, { caption: n.caption });
                    return (
                      console.log('[STM] prepareMediaProps: props with caption', { propsKeys: Object.keys(A), caption: A.caption }),
                      (null != n.caption && '' !== n.caption) ||
                        o.type !== y.OUTWARD_TYPES.DOCUMENT ||
                        ((A.caption = o.filename), console.log('[STM] prepareMediaProps: defaulted caption to filename', { filename: o.filename })),
                      !0 === n.isViewOnce && ((A.isViewOnce = !0), console.log('[STM] prepareMediaProps: flagged isViewOnce=true')),
                      console.log('[STM] prepareMediaProps END', { finalPropsKeys: Object.keys(A), finalType: A.type }),
                      A
                    );
                  })(e, n, a, Z)
                    .then(function (e) {
                      console.log('[STM] prepareMediaProps.then resolved', { propsKeys: Object.keys(e), propsType: e.type });
                      var t = !0 === a.useBasePropsType ? Z.type : e.type;
                      console.log('[STM] finalType =', t, '(useBasePropsType =', a.useBasePropsType, ')');
                      var n = Object.assign({}, Z, e, { type: t });
                      return (console.log('[STM] preppedProps merged', { mergedType: n.type, mergedKeys: Object.keys(n) }), n);
                    })
                    .catch(function (e) {
                      throw (
                        console.log('[STM] !!! prepareMediaProps.catch RAW', e),
                        console.log('[STM] !!! prepareMediaProps.catch details', { message: e && e.message, stack: e && e.stack, string: String(e), name: e && e.name }),
                        e
                      );
                    });
                } catch (e) {
                  throw (
                    console.log('[STM] !!! prepareMediaProps SYNC throw', e),
                    console.log('[STM] !!! prepareMediaProps SYNC details', { message: e && e.message, stack: e && e.stack, string: String(e) }),
                    e
                  );
                }
                console.log('[STM] awaiting preppedProps before sendStatusMediaMsgAction...');
                try {
                  Q = await X;
                } catch (e) {
                  throw (
                    console.log('[STM] !!! preppedProps await RAW', e),
                    console.log('[STM] !!! preppedProps await details', { message: e && e.message, stack: e && e.stack, string: String(e), name: e && e.name }),
                    e
                  );
                }
                (console.log('[STM] awaitedProps ready', { type: Q.type, allKeys: Object.keys(Q) }),
                  console.log('[STM] calling WAWebSendStatusMsgAction.sendStatusMediaMsgAction...'),
                  _.sendStatusMediaMsgAction(Q, async function (e) {
                    (console.log('[STM] >>> handleMediaUpload START', {
                      msgType: e && e.type,
                      msgId: e && e.id && e.id.toString && e.id.toString(),
                      hasMediaObject: !(!e || !e.mediaObject),
                      mimetype: e && e.mimetype,
                      isViewOnce: e && e.isViewOnce,
                      forwardedFromWeb: e && e.forwardedFromWeb,
                    }),
                      (V = e));
                    var t = e.mediaObject;
                    if (!t) throw (console.log('[STM] handleMediaUpload: NO mediaObject -> throwing'), new Error('No media object'));
                    console.log('[STM] mediaObject present', { filehash: t.filehash, size: t.size, type: t.type, uploadStage: t.uploadStage, hasContentInfo: !!t.contentInfo });
                    var a = h.getMsgMediaType(e);
                    console.log('[STM] mediaType =', a);
                    var s = f.isMediaCryptoExpectedForChat(n);
                    console.log('[STM] cryptoExpectedForChat =', s);
                    var i = t.entries.getUploadEntry(s);
                    console.log('[STM] uploadEntry', { exists: !!i, isEncrypted: i instanceof m.EncryptedMediaEntry, constructor: i && i.constructor && i.constructor.name });
                    var r = i instanceof m.EncryptedMediaEntry ? { key: i.mediaKey, timestamp: i.mediaKeyTimestamp } : b();
                    console.log('[STM] mediaKeyInfo resolved', { fromEntry: i instanceof m.EncryptedMediaEntry, hasKey: !!r.key, timestamp: r.timestamp });
                    var l = t.contentInfo,
                      c = l.fullPreviewData,
                      d = l.fullPreviewSize,
                      p = e.body;
                    console.log('[STM] contentInfo', { hasFullPreviewData: !!c, fullPreviewSize: d, hasPreview: !!l.preview, bodyLen: p && p.length });
                    var g = (function (e) {
                      var t = window.require('WAWebMmsMediaTypes'),
                        n = window.require('WAWebABProps'),
                        a = e === t.MEDIA_TYPES.DOCUMENT,
                        o = n.getABPropConfigValue('upload_document_thumb_mms_enabled'),
                        s = a && o;
                      return (console.log('[STM] shouldUploadDocumentThumb', { mediaType: e, isDocument: a, abEnabled: o, result: s }), s);
                    })(a);
                    if ((console.log('[STM] docThumbAllowed =', g), g && !c && l.preview)) {
                      console.log('[STM] generating microThumb for document...');
                      var v = await C.base64ImageToCanvas(l.preview.url()),
                        _ = await x.generateMicroThumb(v, 1300, { mimetype: 'image/jpeg', maxAttempts: 10 });
                      ((c = l.preview),
                        (d = { width: _.width, height: _.height }),
                        (p = P.parseDataURL(_.dataUrl).data),
                        console.log('[STM] microThumb generated', { width: _.width, height: _.height, bodyLen: p && p.length }));
                    }
                    var M,
                      E = e.safe(),
                      T = c && d && g;
                    (console.log('[STM] thumbnail decision', { shouldUploadThumb: !!T, safeMsgDataType: E.type, isDocument: E.type === u.MSG_TYPE.DOCUMENT }),
                      c && T && E.type === u.MSG_TYPE.DOCUMENT
                        ? (console.log('[STM] starting thumbnail upload...'),
                          (M = U({
                            thumbnail: c,
                            mediaKeyInfo: r,
                            mediaType: h.MEDIA_TYPES.THUMBNAIL_DOCUMENT,
                            uploadOrigin: L(n),
                            forwardedFromWeb: Boolean(e.forwardedFromWeb),
                            isViewOnce: Boolean(e.isViewOnce),
                          })))
                        : (console.log('[STM] skipping thumbnail upload'), (M = Promise.resolve(null))));
                    var I = L(n);
                    console.log('[STM] uploadOrigin =', I);
                    var k = { mimetype: e.mimetype, mediaObject: t, mediaType: a, forwardedFromWeb: Boolean(e.forwardedFromWeb), uploadOrigin: I, isViewOnce: Boolean(e.isViewOnce), earlyUpload: o };
                    console.log('[STM] uploadOptions assembled', k);
                    var R,
                      O = Date.now();
                    s
                      ? (console.log('[STM] calling uploadMedia (encrypted)...'), (R = w.uploadMedia(Object.assign({}, k, { mediaKeyInfo: r }))))
                      : (console.log('[STM] calling uploadUnencryptedMedia...'), (R = w.uploadUnencryptedMedia(Object.assign({}, k, { calculateToken: D.getRandomFilehash }))));
                    var N = t.filehash;
                    (console.log('[STM] mediaObject.filehash =', N),
                      y.shouldUseMediaKeyCache() && null != N
                        ? (y.MediaKeyCache.put(N, r), console.log('[STM] MediaKeyCache.put OK', { filehash: N }))
                        : console.log('[STM] MediaKeyCache skipped', { cacheEnabled: y.shouldUseMediaKeyCache(), hasFilehash: null != N }),
                      console.log('[STM] awaiting Promise.all([uploadMedia, thumbnail])...'));
                    var $ = await Promise.all([R, M]);
                    console.log('[STM] upload Promise.all resolved', { tookMs: Date.now() - O });
                    var B = $[0],
                      z = $[1];
                    (console.log('[STM] uploadResult', { kind: B && B.kind, hasMediaEntry: !(!B || !B.mediaEntry), mediaEntryKeys: B && B.mediaEntry && Object.keys(B.mediaEntry), fullResult: B }),
                      console.log('[STM] thumbnailResult', { exists: !!z, hasMediaEntry: !(!z || !z.mediaEntry), filehash: z && z.filehash }),
                      (Y = B.kind));
                    var G = B.mediaEntry,
                      F = W(a);
                    if ((console.log('[STM] shouldClearUploadedBlobs =', F), F && (t.clearBlob({ reset: !0 }), console.log('[STM] mediaObject.clearBlob done')), !G))
                      throw (console.log('[STM] NO mediaEntry -> throwing'), new Error('upload failed: media entry was not created'));
                    y.shouldUseMediaKeyCache() && null != N && (y.MediaKeyCache.delete(N), console.log('[STM] MediaKeyCache.delete OK', { filehash: N }));
                    var K = {};
                    if (T) {
                      var q = z && z.mediaEntry;
                      if ((console.log('[STM] processing thumbnail props', { hasThumbEntry: !!q, hasThumbnailResult: !!z, hasFullPreviewSize: !!d }), !(q && z && d)))
                        throw (console.log('[STM] thumbnail data incomplete -> throwing'), new Error('upload failed: thumbnail data incomplete'));
                      ((K = { thumbnailDirectPath: q.directPath, thumbnailSha256: z.filehash, thumbnailEncSha256: q.encFilehash, thumbnailHeight: d.height, thumbnailWidth: d.width }),
                        console.log('[STM] thumbnailProps', K));
                    }
                    var H = Object.assign(
                      {
                        deprecatedMms3Url: G.deprecatedMms3Url,
                        directPath: G.directPath,
                        mediaKey: G.getMediaKey(),
                        mediaKeyTimestamp: G.getMediaKeyTimestamp(),
                        filehash: t.filehash,
                        encFilehash: G.getEncfilehash(),
                        size: t.size,
                        streamingSidecar: G.sidecar,
                        firstFrameSidecar: G.firstFrameSidecar,
                        body: p,
                        stickerSentTs: S.unixTimeMs(),
                        mediaHandle: G instanceof m.UnencryptedMediaEntry ? G.handle : null,
                      },
                      K
                    );
                    return (
                      console.log('[STM] WAWebMediaUpdateMsg payload', {
                        hasDirectPath: !!H.directPath,
                        hasDeprecatedMms3Url: !!H.deprecatedMms3Url,
                        hasMediaKey: !!H.mediaKey,
                        mediaKeyTimestamp: H.mediaKeyTimestamp,
                        filehash: H.filehash,
                        size: H.size,
                        hasStreamingSidecar: !!H.streamingSidecar,
                        hasFirstFrameSidecar: !!H.firstFrameSidecar,
                        bodyLen: H.body && H.body.length,
                        hasMediaHandle: !!H.mediaHandle,
                        thumbnailKeys: Object.keys(K),
                      }),
                      console.log('[STM] calling WAWebMediaUpdateMsg...'),
                      await A(V, H),
                      console.log('[STM] WAWebMediaUpdateMsg done'),
                      console.log('[STM] <<< handleMediaUpload END'),
                      V
                    );
                  })
                    .then(function (e) {
                      (console.log('[STM] sendStatusMediaMsgAction resolved', { hasResult: !!e, result: e, tookMs: Date.now() - r }), s(e));
                      var n = e && e.result;
                      if ((console.log('[STM] sendResult extracted', { hasSendResult: !!n, messageSendResult: n && n.messageSendResult }), n && n.messageSendResult === v.SendMsgResult.OK))
                        return (
                          console.log('[STM] branch: OK'),
                          V &&
                            V.type === g.OUTWARD_TYPES.STICKER &&
                            !0 !== V.isAvatar &&
                            (T.RecentStickerCollectionMd.addStickerWithMediaData(V), console.log('[STM] sticker added to recent collection')),
                          { messageSendResult: v.SendMsgResult.OK }
                        );
                      V && ((V.ack = M.ACK.FAILED), console.log('[STM] createdMsg.ack set to FAILED'));
                      var a = V && V.mediaObject && V.mediaObject.uploadStage;
                      if (
                        (console.log('[STM] post-fail diagnostics', {
                          uploadResultKind: Y,
                          uploadStage: a,
                          UploadMediaResultKind_CANCELLATION: w.UploadMediaResultKind.CANCELLATION,
                          UploadMediaResultKind_ERROR: w.UploadMediaResultKind.ERROR,
                        }),
                        Y === w.UploadMediaResultKind.CANCELLATION)
                      )
                        return (
                          console.log('[STM] branch: CANCELLATION'),
                          V &&
                            V.wamMessageSendReporter &&
                            (V.wamMessageSendReporter.postFailure({ result: E.MESSAGE_SEND_RESULT_TYPE.ERROR_CANCELLED, isTerminal: !0 }),
                            console.log('[STM] wamMessageSendReporter.postFailure(CANCELLED) sent')),
                          { messageSendResult: v.SendMsgResult.ERROR_CANCELLED }
                        );
                      if (null != a)
                        switch ((console.log('[STM] uploadStage branch', { uploadStage: a }), a)) {
                          case g.UploadStage.NEED_UPLOAD:
                          case g.UploadStage.ERROR_TOO_LARGE:
                            return (console.log('[STM] uploadStage -> NEED_UPLOAD/ERROR_TOO_LARGE'), { messageSendResult: t(V) });
                          case g.UploadStage.ERROR_MISSING:
                            return (console.log('[STM] uploadStage -> ERROR_MISSING'), { messageSendResult: v.SendMsgResult.ERROR_EXPIRED });
                        }
                      return Y === w.UploadMediaResultKind.ERROR
                        ? (console.log('[STM] branch: uploadResultKind ERROR'), { messageSendResult: t(V) })
                        : null != n
                          ? (console.log('[STM] branch: returning raw sendResult'), n)
                          : (console.log('[STM] branch: ERROR_UNKNOWN fallback'), { messageSendResult: v.SendMsgResult.ERROR_UNKNOWN });
                    })
                    .catch(function (e) {
                      (console.log('[STM] !!! sendPromise.catch RAW', e),
                        console.log('[STM] !!! sendPromise.catch details', { message: e && e.message, stack: e && e.stack, string: String(e), name: e && e.name, tookMs: Date.now() - r }),
                        i(e));
                    }));
              } catch (e) {
                (console.log('[STM] !!! outer try/catch RAW', e), console.log('[STM] !!! outer try/catch typeof', typeof e));
                try {
                  console.log('[STM] !!! outer try/catch JSON', JSON.stringify(e, Object.getOwnPropertyNames(e || {})));
                } catch (e) {
                  console.log('[STM] !!! outer try/catch JSON failed', e);
                }
                (console.log('[STM] !!! outer try/catch details', { errorMessage: e && e.message, errorStack: e && e.stack, errorName: e && e.name, errorString: String(e), tookMs: Date.now() - r }),
                  i(e));
              }
            });
          }
          ((window.STM = window.STM || {}),
            console.log('[STM] IIFE start'),
            (e.prototype.sendToChat = function (e, t, a) {
              console.log('[STM] MediaPrep.sendToChat called', {
                chatId: e && e.id && e.id.toString && e.id.toString(),
                chatIsGroup: e && e.isGroup,
                chatIsNewsletter: e && e.isNewsletter,
                optionsType: t && t.type,
                optionsKeys: t && Object.keys(t),
                earlyUpload: a,
                this_baseType: this._baseType,
              });
              var o = window.require('WAPromiseCallSync');
              console.log('[STM] sendToChat: WAPromiseCallSync resolved', { hasPromiseCallSync: !!o, keys: Object.keys(o) });
              var s = o.promiseCallSync(n, null, this, e, t, a);
              return (console.log('[STM] sendToChat: promiseCallSync returned', { isPromise: s && 'function' == typeof s.then }), s);
            }),
            (e.prototype.waitForPrep = async function () {
              console.log('[STM] MediaPrep.waitForPrep START');
              try {
                return (
                  await this._prepwork,
                  console.log('[STM] MediaPrep.waitForPrep: _prepwork resolved', {
                    stage: this._mediaData && this._mediaData.mediaStage,
                    filehash: this._mediaData && this._mediaData.filehash,
                    hasMediaBlob: !(!this._mediaData || !this._mediaData.mediaBlob),
                  }),
                  this._mediaData
                );
              } catch (e) {
                throw (console.log('[STM] MediaPrep.waitForPrep ERROR', { errorRaw: e, errorMessage: e && e.message, errorStack: e && e.stack }), e);
              }
            }),
            (window.STM.MediaPrep = e),
            (window.STM.sendMediaMsgToChat = n),
            console.log('[STM] loaded'));
        })(),
          (window.STM = window.STM || {}),
          (window.STM.deleteStatus = async function (e) {
            const t = window.require,
              n = t('WAWebWidFactory').createWid(t('WAJids').STATUS_JID),
              a = t('WATimeUtils').unixTime(),
              o = { id: t('WAWebMsgKey').fromString(e), t: a, to: n },
              s = await t('WAWebRevokeStatusAction').createRevokeStatusMsgData(o),
              i = new (t('WAWebMsgModel').Msg)(s);
            try {
              i.wamMessageSendPerfReporter = new (t('WAWebMessageSendPerfReporter').MessageSendPerfReporter)({
                chatWid: n,
                mediaType: t('WAWebWamMsgUtils').getWamMediaType(i),
                messageType: t('WAWebWamMsgUtils').getWamMessageType(i),
              });
            } catch (e) {}
            const r = t('WAWebSendMsgMetricReporter').createMsgModelMetricReporter(i, t('WAWebMessageSendReporterFrontendDeps').MAIN_WEB_MESSAGE_SEND_REPORTER_FRONTEND_DEPS);
            r.sendReporter = r.sendReporter || r.createSendReporter();
            try {
              await t('WAWebDBProcessMessage').storeMessages([s], i.to);
            } catch (e) {}
            const l = { type: t('WAWebSendMsgTypes').SendMessageRecordType.Message, data: i },
              c = t('WAWebOutgoingMessage').createOutgoingMessageProtobuf(t('WAWebOutgoingMessage').OutgoingMessageOriginType.Status, l),
              d = await t('WAWebEncryptAndSendStatusMsg').encryptAndSendStatusMsg(l, c, r);
            return (console.log('[STM.deleteStatus] revoke enviado:', e, d), d);
          }),
          console.log('[STM] deleteStatus pronto'),
          (function () {
            console.log('🔧 Instalando patch CONSERVADOR (comportamento WhatsApp)...');
            const e = window.require('WAWebUserPrefsStatus'),
              t = window.require('WAWebUserPrefsIndexedDBStorage'),
              n = window.require('WAWebUserPrefsKeys'),
              a = { ENABLE_TIME_VALIDATION: !1, ENABLE_PARTIAL_REFRESH: !1, PARTIAL_REFRESH_PERCENT: 2, ENABLE_PERIODIC_FULL_REFRESH: !0, FULL_REFRESH_DAYS: 30, ENABLE_DEBUG_LOGS: !0 };
            let o = parseInt(localStorage.getItem('lastStatusSKRefresh') || '0'),
              s = !1;
            const i = e.getStatusSkDistribList;
            e.getStatusSkDistribList = async function (e) {
              a.ENABLE_DEBUG_LOGS && console.log('🔍 [SK] getStatusSkDistribList:', e.length, 'participantes');
              const r = Date.now();
              if (a.ENABLE_PERIODIC_FULL_REFRESH) {
                const e = (r - o) / 864e5;
                e >= a.FULL_REFRESH_DAYS &&
                  !s &&
                  (console.log('🔄 [SK] REFRESH PERIÓDICO:', e.toFixed(1), 'dias'),
                  console.log('⚡ [SK] Forçando rotateKey (igual a identity change)'),
                  await t.userPrefsIdb.set(n.BACKEND_ONLY_KEYS.STATUS_SENDER_KEY, { rotateKey: !0, senderKey: new Set() }),
                  (s = !0),
                  (o = r),
                  localStorage.setItem('lastStatusSKRefresh', r.toString()));
              }
              const l = await i.call(this, e);
              if (l.rotateKey) {
                (console.warn('🚨 [SK] rotateKey ATIVADO!'),
                  console.warn('   Motivo possível:'),
                  console.warn('   1. Identity change detectado'),
                  console.warn('   2. Inconsistência no cache'),
                  console.warn('   3. markStatusSenderKeyRotate foi chamado'));
                const a = await t.userPrefsIdb.get(n.BACKEND_ONLY_KEYS.STATUS_SENDER_KEY);
                (console.warn('   Cache atual:'), console.warn('     rotateKey:', a?.rotateKey), console.warn('     senderKey.size:', a?.senderKey?.size));
                const o = e.filter((e) => a?.senderKey?.has(e.toString()));
                o.length < (a?.senderKey?.size || 0)
                  ? (console.warn('   🔍 CAUSA: INCONSISTÊNCIA no cache!'),
                    console.warn('     Cache tem:', a?.senderKey?.size),
                    console.warn('     Encontrados:', o.length),
                    console.warn('     Diferença:', (a?.senderKey?.size || 0) - o.length))
                  : (console.warn('   🔍 CAUSA: IDENTITY CHANGE!'), console.warn('     Alguém reinstalou WhatsApp ou trocou device'));
              }
              if (
                (a.ENABLE_DEBUG_LOGS &&
                  console.log('📊 [SK] Resultado original:', { rotateKey: l.rotateKey, skDistribList: l.skDistribList?.length || 0, participantList: l.participantList?.length || 0 }),
                l.rotateKey)
              )
                return ((s = !1), console.log('✅ [SK] rotateKey ATIVO'), l);
              if (a.ENABLE_PARTIAL_REFRESH && l.participantList && l.participantList.length > 0) {
                const e = Math.max(1, Math.ceil(l.participantList.length * (a.PARTIAL_REFRESH_PERCENT / 100))),
                  t = l.participantList.sort(() => Math.random() - 0.5).slice(0, e);
                t.length > 0 &&
                  (console.log('🎲 [SK] Refresh mínimo:', t.length, 'contatos (' + a.PARTIAL_REFRESH_PERCENT + '%)'),
                  (l.skDistribList = [...l.skDistribList, ...t]),
                  (l.participantList = l.participantList.filter((e) => !t.some((t) => t.equals(e)))));
              }
              return (a.ENABLE_DEBUG_LOGS && console.log('✅ [SK] Resultado final:', { skDistribList: l.skDistribList?.length || 0, participantList: l.participantList?.length || 0 }), l);
            };
            const r = e.markStatusSenderKeyRotate;
            e.markStatusSenderKeyRotate = async function (e) {
              return (console.log('🔄 [SK] markStatusSenderKeyRotate (identity change):', e.length, 'contatos'), (s = !0), r.call(this, e));
            };
            const l = e.markForgetStatusSenderKey;
            ((e.markForgetStatusSenderKey = async function (e) {
              return (console.log('🗑️  [SK] markForgetStatusSenderKey (retry):', e.length, 'contatos'), l.call(this, e));
            }),
              (window.statusSK = {
                status: function () {
                  const e = (Date.now() - o) / 864e5,
                    t = a.FULL_REFRESH_DAYS - e;
                  (console.log('📊 Status Sender Keys (Modo Conservador):'),
                    console.log('  - Último refresh:', e.toFixed(1), 'dias atrás'),
                    console.log('  - Próximo refresh:', t > 0 ? t.toFixed(1) + ' dias' : 'AGORA'),
                    console.log('  - Rotação pendente:', s ? 'SIM' : 'NÃO'),
                    console.log('\n⚙️  Configuração:'),
                    console.log('  - Refresh parcial:', a.PARTIAL_REFRESH_PERCENT + '% por envio'),
                    console.log('  - Refresh periódico:', a.FULL_REFRESH_DAYS + ' dias'),
                    console.log('\n✅ Gatilhos automáticos do WhatsApp:'),
                    console.log('  - Identity change → rotateKey'),
                    console.log('  - Retry de mensagem → forget sender key'),
                    console.log('  - Inconsistência cache → rotateKey'));
                },
                forceRefresh: async function () {
                  (console.log('🔄 Forçando refresh...'), (o = 0), localStorage.setItem('lastStatusSKRefresh', '0'), (s = !1), console.log('✅ Próximo envio fará refresh total'));
                },
                config: a,
              }),
              console.log('✅ Patch CONSERVADOR instalado!'),
              console.log('📋 Comportamento:'),
              console.log('  - Confia nos gatilhos do WhatsApp (identity change, retry)'),
              console.log('  - Refresh mínimo: 2% por envio (~280 de 14k)'),
              console.log('  - Refresh total: a cada 30 dias (segurança extra)'),
              console.log('📊 Use: statusSK.status()'));
          })(),
          (function () {
            console.log('🔧 Patch de Limite de Contatos - VERSÃO CORRIGIDA');
            const e = { MAX_CONTACTS: 15e3, ENABLE_LOGS: !0 };
            let t = [];
            const n = window.require('WAWebUserPrefsStatus'),
              a = n.getStatusSkDistribList;
            ((n.getStatusSkDistribList = async function (n) {
              (console.log('\n╔════════════════════════════════════════════════════════════════════╗'),
                console.log('║  🔍 PATCH ATIVO - NORMALIZAÇÃO CORRIGIDA                          ║'),
                console.log('╚════════════════════════════════════════════════════════════════════╝'),
                console.log(`\n📊 Entrada: ${n.length} WIDs`),
                console.log('   Primeiros 10:'),
                n.slice(0, 10).forEach((e, t) => {
                  console.log(`   [${t}] ${e.toString()}`);
                }));
              const o = await a.call(this, n);
              if (
                (console.log('\n📊 WhatsApp decidiu:'),
                console.log(`   rotateKey: ${o.rotateKey}`),
                console.log(`   skDistribList: ${o.skDistribList?.length || 0} devices`),
                console.log(`   participantList: ${o.participantList?.length || 0} (já têm SK)`),
                !o.skDistribList || 0 === o.skDistribList.length)
              )
                return (console.log('\n✅ Nada a fazer'), (t = []), o);
              (console.log('\n╔════════════════════════════════════════════════════════════════════╗'),
                console.log('║  📋 AGRUPANDO POR NÚMERO DE TELEFONE                              ║'),
                console.log('╚════════════════════════════════════════════════════════════════════╝'));
              const s = new Map();
              o.skDistribList.forEach((e) => {
                const t = e.toString().toString().split('@')[0].split(':')[0];
                (s.has(t) || s.set(t, []), s.get(t).push(e));
              });
              const i = s.size,
                r = o.skDistribList.length;
              (console.log('\n📊 Agrupamento:'),
                console.log(`   CONTATOS únicos: ${i}`),
                console.log(`   DEVICES total: ${r}`),
                console.log(`   Média: ${(r / i).toFixed(2)} devices/contato`),
                console.log('\n   Primeiros 10 contatos:'));
              let l = 0;
              for (let [e, t] of s) {
                if (l >= 10) break;
                (console.log(`   [${l}] ${e} (${t.length} device${t.length > 1 ? 's' : ''})`),
                  t.forEach((e, t) => {
                    console.log(`       └─ [${t}] ${e.toString()}`);
                  }),
                  l++);
              }
              const c = Array.from(s.values()).map((e) => e.length);
              if (
                (console.log('\n📊 Distribuição:'),
                console.log(`   1 device: ${c.filter((e) => 1 === e).length}`),
                console.log(`   2 devices: ${c.filter((e) => 2 === e).length}`),
                console.log(`   3+ devices: ${c.filter((e) => e >= 3).length}`),
                i <= e.MAX_CONTACTS)
              )
                return (console.log(`\n✅ Dentro do limite: ${i} ≤ ${e.MAX_CONTACTS}`), (t = []), o);
              (console.log('\n╔════════════════════════════════════════════════════════════════════╗'),
                console.log('║  ⚠️  APLICANDO LIMITE                                              ║'),
                console.log('╚════════════════════════════════════════════════════════════════════╝'),
                console.log(`\n⚠️ EXCEDEU: ${i} > ${e.MAX_CONTACTS}`),
                console.log(`   Envios: ${Math.ceil(i / e.MAX_CONTACTS)}`));
              const d = [...t];
              (s.forEach((e, t) => {
                d.find(([e]) => e === t) || d.push([t, e]);
              }),
                console.log(`   Combinado: ${d.length} contatos`));
              const p = d.slice(0, e.MAX_CONTACTS),
                u = d.slice(e.MAX_CONTACTS);
              (console.log(`   Processar: ${p.length}`),
                console.log(`   Adiar: ${u.length}`),
                console.log('\n   Primeiros 10 a processar:'),
                p.slice(0, 10).forEach(([e, t], n) => {
                  console.log(`   [${n}] ${e} (${t.length} dev)`);
                }));
              const g = [];
              p.forEach(([e, t]) => {
                t.forEach((e) => g.push(e));
              });
              const h = [];
              (u.forEach(([e, t]) => {
                t.forEach((e) => h.push(e));
              }),
                console.log('\n📱 Devices:'),
                console.log(`   Agora: ${g.length}`),
                console.log(`   Depois: ${h.length}`),
                console.log(`   Total: ${g.length + h.length}`),
                console.log('   Verificação: ' + (r === g.length + h.length ? '✅' : '❌')),
                (t = u));
              const m = { rotateKey: o.rotateKey, skDistribList: g, participantList: [...o.participantList] };
              return (
                console.log('\n✅ Retorno:'),
                console.log(`   skDistribList: ${m.skDistribList.length}`),
                console.log(`   participantList: ${m.participantList.length}`),
                console.log('\n╔════════════════════════════════════════════════════════════════════╗'),
                console.log(`║  📊 ${p.length} contatos (${g.length} devices) AGORA`),
                console.log(`║  ⏭️  ${u.length} contatos (${h.length} devices) DEPOIS`),
                console.log('╚════════════════════════════════════════════════════════════════════╝\n'),
                m
              );
            }),
              (window.statusContactsManager = {
                status: () => {
                  if ((console.log(`\n📊 Pendentes: ${t.length} contatos`), t.length > 0)) {
                    const e = t.reduce((e, [t, n]) => e + n.length, 0);
                    (console.log(`   Devices: ${e}`),
                      console.log('\n   Primeiros 10:'),
                      t.slice(0, 10).forEach(([e, t], n) => {
                        console.log(`   [${n}] ${e} (${t.length} dev)`);
                      }));
                  }
                },
                config: (t) => {
                  (t && (e.MAX_CONTACTS = t), console.log(`⚙️ Limite: ${e.MAX_CONTACTS}`));
                },
                reset: () => {
                  ((t = []), console.log('🔄 Resetado'));
                },
                forceRotate: async () => {
                  const e = window.require('WAWebUserPrefsStatus'),
                    n = await e.getStatusList();
                  (await e.markStatusSenderKeyRotate(n.list), (t = []), console.log(`✅ Rotação: ${n.list.length}`));
                },
                checkKeys: async () => {
                  const e = window.require('WAWebUserPrefsIndexedDBStorage'),
                    t = window.require('WAWebUserPrefsKeys'),
                    n = await e.userPrefsIdb.get(t.BACKEND_ONLY_KEYS.STATUS_SENDER_KEY);
                  return (console.log(`rotateKey: ${n?.rotateKey}`), console.log(`Keys: ${n?.senderKey?.size || 0}`), n);
                },
                simulate: (t, n = 2) => {
                  const a = Math.ceil(t / e.MAX_CONTACTS);
                  console.log(`${t} contatos = ${a} envios`);
                  let o = t;
                  for (let t = 0; t < a; t++) {
                    const a = Math.min(e.MAX_CONTACTS, o);
                    (console.log(`  ${t + 1}. ${a} contatos (~${a * n} devs)`), (o -= a));
                  }
                },
              }),
              console.log('✅ Patch CORRIGIDO instalado!'),
              console.log(`⚙️ Limite: ${e.MAX_CONTACTS} contatos`));
          })(),
          __d(
            'WAWebDBLoadContacts',
            ['WALogger', 'WAWebApiDeviceList', 'WAWebBizCoexGatingUtils', 'WAWebUserPrefsMeUser', 'WAWebWidFactory', 'asyncToGeneratorRuntime'],
            function (e, t, n, a, o, s, i) {
              var r;
              function l() {
                return (
                  (l = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e) {
                    var t = e.wids,
                      n = e.chatWidSetToIncludeHostedInFanoutOneToOneChatOnly;
                    ((t = t.slice(0, 500)), (e = yield a('WAWebApiDeviceList').getDeviceIds(t)));
                    var o = new Map();
                    return (
                      e.forEach(function (e, s) {
                        if (e) {
                          var i = e.devices;
                          i.forEach(function (t) {
                            var s = 99 === t.id || !0 === t.isHosted,
                              i = !1;
                            (a('WAWebBizCoexGatingUtils').bizHostedDevicesEnabled() && null != n && (i = !0 === (null == n ? void 0 : n.isUser())),
                              (s && !i) || ((s = a('WAWebWidFactory').createDeviceWidFromDeviceListPk(e.id, t.id, t.isHosted)), a('WAWebUserPrefsMeUser').isMeDevice(s) || o.set(s.toString(), s)));
                          });
                        } else
                          ((i = a('WAWebWidFactory').asUserWidOrThrow(t[s])),
                            a('WALogger')
                              .LOG(r || (r = babelHelpers.taggedTemplateLiteralLoose(['getChunkListNow: no device is found for ', ', just send to the primary device'])), i.toString())
                              .tags('messaging'),
                            a('WAWebUserPrefsMeUser').isMeAccount(i) || o.set(i.toString(), i));
                      }),
                      Array.from(o.values())
                    );
                  })),
                  l.apply(this, arguments)
                );
              }
              i.getChunkListNow = function (e) {
                return l.apply(this, arguments);
              };
            },
            98
          ),
          __d(
            'WAWebManageE2ESessionsJob_direct',
            [
              'Promise',
              'WALogger',
              'WAResolvable',
              'WAShiftTimer',
              'WAWebAppTracker',
              'WAWebEventsWaitForOfflineDeliveryEnd',
              'WAWebFetchPrekeysJob_status',
              'WAWebManagePhoneNumberMappingJob',
              'WAWebProcessKeyBundle',
              'WAWebRunInBatches',
              'WAWebSignal',
              'WAWebSignalCommonUtils',
              'WAWebWid',
              'WAWebWidFactory',
              'WAWebUserPrefsStatus',
              'WAWebUserPrefsIndexedDBStorage',
              'WAWebUserPrefsKeys',
              'asyncToGeneratorRuntime',
            ],
            function (e, t, n, a, o, s, i) {
              var r,
                l,
                c = new Map(),
                d = new Map(),
                p = new Set(),
                u = new Set(),
                g = { SESSION_CHECK: 100, PROCESS_KEY_BUNDLES: 50 };
              function h(e, t, n, a) {
                return m.apply(this, arguments);
              }
              function m() {
                return (
                  (m = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e, o, s, i) {
                    (void 0 === o && (o = !1), void 0 === s && (s = !1), void 0 === i && (i = !1));
                    var h,
                      m = Date.now();
                    if ((console.log('[E2E] ensureE2ESessions:', e.length, 'wids', i ? '(STATUS)' : ''), i)) {
                      console.log('[E2E] 🔍 Modo STATUS - verificando sender key cache...');
                      var f = yield ((h = e),
                      t('asyncToGeneratorRuntime').asyncToGenerator(function* () {
                        (console.log('[SK_CACHE] Verificando sender keys para', h.length, 'WIDs'), console.log('[SK_CACHE] Buscando cache do IndexedDB...'));
                        const e = yield a('WAWebUserPrefsIndexedDBStorage').userPrefsIdb.get(a('WAWebUserPrefsKeys').BACKEND_ONLY_KEYS.STATUS_SENDER_KEY);
                        if ((console.log('[SK_CACHE] Cache obtido:', e ? 'sim' : 'não'), !e || !e.senderKey))
                          return (console.log('[SK_CACHE] Cache vazio - todos precisam SK'), { withSenderKey: [], needSenderKey: h });
                        console.log('[SK_CACHE] Iniciando iteração pelos WIDs...');
                        const t = [],
                          n = [];
                        return (
                          h.forEach(function (a) {
                            const o = a.toString();
                            e.senderKey.has(o) ? t.push(a) : n.push(a);
                          }),
                          console.log('[SK_CACHE] ✅ Com SK:', t.length, '| Sem SK:', n.length),
                          { withSenderKey: t, needSenderKey: n }
                        );
                      })());
                      if ((console.log('[E2E] Resultado SK - Com:', f.withSenderKey.length, 'Sem:', f.needSenderKey.length), 0 === f.needSenderKey.length))
                        return (console.log('[E2E] ✅ Todos têm SK - retorno rápido'), { missedPrekeyCount: 0, depletedPrekeyCount: 0, processedPrekeyCount: e.length, duration: Date.now() - m });
                      (console.log('[E2E] Continuando apenas com WIDs sem SK'), (e = f.needSenderKey));
                    }
                    console.log('[E2E] Consultando signal-storage...');
                    var b = yield (function (e) {
                        return new (r || (r = t('Promise')))(function (t, n) {
                          if (!e || 0 === e.length) return (console.log('[DIRECT_CACHE] Array vazio, retornando'), void t({ withSession: [], uncached: [] }));
                          (console.log('[DIRECT_CACHE] Consultando signal-storage para', e.length, 'WIDs'), console.log('[DIRECT_CACHE] Abrindo IndexedDB...'));
                          var o = indexedDB.open('signal-storage');
                          ((o.onerror = function () {
                            (console.error('[DIRECT_CACHE] Erro ao abrir signal-storage:', o.error), t({ withSession: [], uncached: e }));
                          }),
                            (o.onsuccess = function (n) {
                              console.log('[DIRECT_CACHE] IndexedDB aberto com sucesso');
                              var o = n.target.result;
                              if (!o.objectStoreNames.contains('session-store'))
                                return (console.error("[DIRECT_CACHE] Store 'session-store' não encontrada!"), void t({ withSession: [], uncached: e }));
                              console.log("[DIRECT_CACHE] Store 'session-store' encontrada");
                              var s = o.transaction('session-store', 'readonly').objectStore('session-store'),
                                i = { withSession: [], uncached: [] },
                                r = 0,
                                l = e.length,
                                c = a('WAWebSignalCommonUtils');
                              (console.log('[DIRECT_CACHE] Iniciando consulta de', l, 'WIDs...'),
                                e.forEach(function (e) {
                                  try {
                                    var n = c.createSignalAddress(e).toString(),
                                      a = s.get(n);
                                    ((a.onsuccess = function () {
                                      var n = a.result;
                                      (n && n.session ? i.withSession.push(e) : i.uncached.push(e),
                                        (++r % 500 != 0 && r !== l) || console.log('[DIRECT_CACHE] Progresso:', r + '/' + l, '- Com sessão:', i.withSession.length),
                                        r === l && (console.log('[DIRECT_CACHE] ✅ Concluído - Com sessão:', i.withSession.length, 'Sem sessão:', i.uncached.length), t(i)));
                                    }),
                                      (a.onerror = function () {
                                        (console.warn('[DIRECT_CACHE] Erro ao buscar:', e.toString()), i.uncached.push(e), ++r === l && t(i));
                                      }));
                                  } catch (n) {
                                    (console.error('[DIRECT_CACHE] Erro ao processar WID:', e.toString(), n), i.uncached.push(e), ++r === l && t(i));
                                  }
                                }));
                            }));
                        });
                      })(e),
                      w = b.withSession,
                      y = b.uncached;
                    if ((console.log('[E2E] Resultado cache - Com sessão:', w.length, 'Sem sessão:', y.length), 0 === y.length))
                      return (
                        console.log('[E2E] ✅ Todos os', e.length, 'WIDs já têm sessão (100% cache hit)'),
                        { missedPrekeyCount: 0, depletedPrekeyCount: 0, processedPrekeyCount: e.length, duration: Date.now() - m }
                      );
                    (console.log('[E2E] Cache hit:', w.length + '/' + e.length, '(' + ((w.length / e.length) * 100).toFixed(1) + '%)'),
                      console.log('[E2E] Processando', y.length, 'WIDs sem sessão'),
                      (e = y),
                      console.log('[E2E] Aguardando waitForOfflineDeliveryEnd...'),
                      yield a('WAWebEventsWaitForOfflineDeliveryEnd').waitForOfflineDeliveryEnd(),
                      console.log('[E2E] Iniciando AppTracker...'),
                      a('WAWebAppTracker').AppTracker.start(a('WAWebAppTracker').AppTrackerType.PreKeyProcessing));
                    try {
                      (console.log('[E2E] ensurePhoneNumberToLidMapping para', e.length, 'WIDs...'),
                        yield a('WAWebManagePhoneNumberMappingJob').ensurePhoneNumberToLidMapping(e),
                        console.log('[E2E] ensurePhoneNumberToLidMapping concluído'));
                    } catch (e) {
                      console.warn('ensurePhoneNumberToLidMapping failed:', e);
                    }
                    console.log('[E2E] Criando Resolvable...');
                    var W = new (a('WAResolvable').Resolvable)(),
                      A = [],
                      S = [];
                    (console.log('[E2E] Parâmetro f (runInBatches):', s),
                      s ||
                        (console.log('[E2E] Limpando abort controllers...'),
                        u.forEach(function (e) {
                          return e.abort();
                        }),
                        console.log("[E2E] Processando set 's'..."),
                        p.forEach(function (e) {
                          (S.push(e), d.set(e, W.promise));
                        }),
                        p.clear(),
                        console.log("[E2E] Set 's' limpo")),
                      console.log('[E2E] Iterando por', e.length, 'WIDs...'),
                      e.forEach(function (e) {
                        if (e.isUserNotPSA()) {
                          var t = c.get(e);
                          (t && (t.cancel(), c.delete(e)), (t = d.get(e)) ? A.push(t) : (S.push(e), d.set(e, W.promise)));
                        }
                      }),
                      console.log('[E2E] WIDs deduplicados (v):', A.length),
                      console.log('[E2E] WIDs a processar (w):', S.length));
                    var v = 0,
                      _ = 0,
                      M = null;
                    try {
                      if (S.length > 0) {
                        console.log('[E2E] Processando', S.length, 'WIDs...');
                        var E = [];
                        if (s) {
                          (console.log('[E2E] Modo BATCH - criando AbortController'),
                            (M = new AbortController()),
                            u.add(M),
                            console.log('[E2E] Adicionando', S.length, "WIDs ao set 's'..."),
                            S.forEach(function (e) {
                              p.add(e);
                            }),
                            console.log('[E2E] ✅', S.length, "WIDs adicionados ao set 's'"),
                            console.log('[E2E] ========================================'),
                            console.log('[E2E] EXECUTANDO hasSignalSessions em BATCHES'),
                            console.log('[E2E] Total de WIDs:', S.length),
                            console.log('[E2E] Tamanho do batch:', g.SESSION_CHECK),
                            console.log('[E2E] Número estimado de batches:', Math.ceil(S.length / g.SESSION_CHECK)),
                            console.log('[E2E] ========================================'));
                          var T = Date.now(),
                            C = 0;
                          (yield a('WAWebRunInBatches').runInBatches(
                            S,
                            (function () {
                              var e = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e) {
                                var t;
                                C++;
                                var n = Date.now();
                                (console.log('[E2E] [BATCH #' + C + '] Processando batch de', e.length, 'WIDs'),
                                  (e = yield a('WAWebSignal').Session.hasSignalSessions(e)),
                                  console.log('[E2E] [BATCH #' + C + '] ✅ Concluído em', Date.now() - n + 'ms'),
                                  (t = E).push.apply(t, e));
                              });
                              return function (t) {
                                return e.apply(this, arguments);
                              };
                            })(),
                            g.SESSION_CHECK,
                            M
                          ),
                            console.log('[E2E] ========================================'),
                            console.log('[E2E] hasSignalSessions BATCHES CONCLUÍDO'),
                            console.log('[E2E] Total de batches:', C),
                            console.log('[E2E] Tempo total:', Date.now() - T + 'ms'),
                            console.log('[E2E] ========================================'));
                        } else
                          (console.log('[E2E] Executando hasSignalSessions normal...'), (E = yield a('WAWebSignal').Session.hasSignalSessions(S)), console.log('[E2E] hasSignalSessions concluído'));
                        console.log('[E2E] Filtrando WIDs sem sessão...');
                        var x = [];
                        if (
                          (S.forEach(function (e, t) {
                            E[t] ? p.delete(e) : x.push(e);
                          }),
                          console.log('[E2E] WIDs que precisam de prekey:', x.length),
                          x.length > 0)
                        ) {
                          if (s) {
                            console.log('[E2E] Buscando prekey bundles para', x.length, 'WIDs...');
                            var P = Date.now();
                            ((s = yield a('WAWebFetchPrekeysJob_status').fetchPrekeyBundles(x, o)),
                              console.log('[E2E] ✅ fetchPrekeyBundles concluído em', Date.now() - P + 'ms'),
                              console.log('[E2E] Total de bundles obtidos:', s.length),
                              console.log('[E2E] Ordenando prekey bundles...'));
                            var U = Date.now();
                            ((s = a('WAWebFetchPrekeysJob_status').sortPrekeyBundles(s)), console.log('[E2E] ✅ sortPrekeyBundles concluído em', Date.now() - U + 'ms'));
                            var L = 0,
                              D = s.length,
                              I = 0;
                            (console.log('[E2E] ========================================'),
                              console.log('[E2E] INICIANDO PROCESSAMENTO DE KEY BUNDLES'),
                              console.log('[E2E] Total de bundles:', D),
                              console.log('[E2E] Tamanho do batch:', g.PROCESS_KEY_BUNDLES),
                              console.log('[E2E] Número estimado de batches:', Math.ceil(D / g.PROCESS_KEY_BUNDLES)),
                              console.log('[E2E] ========================================'));
                            var k = Date.now();
                            yield a('WAWebRunInBatches').runInBatches(
                              s,
                              (function () {
                                var e = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e) {
                                  var t;
                                  I++;
                                  var o = Date.now();
                                  (console.log('[E2E] [KEY_BATCH #' + I + '] Iniciando batch de', e.length, 'bundles'),
                                    console.log('[E2E] [KEY_BATCH #' + I + '] Progresso:', L, 'de', D, 'processados'),
                                    console.log('[E2E] [KEY_BATCH #' + I + "] Removendo WIDs do set 's'..."),
                                    e.forEach(function (e) {
                                      (null == e ? void 0 : e.wid) instanceof n('WAWebWid') && p.delete(e.wid);
                                    }),
                                    console.log('[E2E] [KEY_BATCH #' + I + '] Chamando processKeyBundles...'));
                                  var s = Date.now();
                                  ((e = yield a('WAWebProcessKeyBundle').processKeyBundles([].concat(e))),
                                    console.log('[E2E] [KEY_BATCH #' + I + '] ✅ processKeyBundles concluído em', Date.now() - s + 'ms'));
                                  var i = null != (t = e.depletedPrekeyCount) ? t : 0,
                                    r = null != (t = e.processedPrekeyCount) ? t : 0;
                                  ((_ += i),
                                    (L += r),
                                    console.log('[E2E] [KEY_BATCH #' + I + '] Depleted neste batch:', i),
                                    console.log('[E2E] [KEY_BATCH #' + I + '] Processed neste batch:', r),
                                    console.log('[E2E] [KEY_BATCH #' + I + '] Total acumulado - Depleted:', _, 'Processed:', L),
                                    console.log('[E2E] [KEY_BATCH #' + I + '] ✅ Batch concluído em', Date.now() - o + 'ms'),
                                    console.log('[E2E] [KEY_BATCH #' + I + '] ========================================'));
                                });
                                return function (t) {
                                  return e.apply(this, arguments);
                                };
                              })(),
                              g.PROCESS_KEY_BUNDLES,
                              M
                            );
                            var R = Date.now() - k;
                            (console.log('[E2E] ========================================'),
                              console.log('[E2E] PROCESSAMENTO DE KEY BUNDLES CONCLUÍDO'),
                              console.log('[E2E] Total de batches processados:', I),
                              console.log('[E2E] Tempo total:', R + 'ms'),
                              console.log('[E2E] Tempo médio por batch:', (R / I).toFixed(2) + 'ms'),
                              console.log('[E2E] ========================================'),
                              console.log('[E2E] ✅ Established ' + L + ' sessions of ' + x.length));
                          } else
                            (console.log('[E2E] Buscando prekeys modo normal...'),
                              (s = yield a('WAWebFetchPrekeysJob_status').fetchPrekeys(x, o)),
                              (_ = null != (o = s.depletedPrekeyCount) ? o : 0),
                              console.log('[E2E] Prekeys obtidos, depleted:', _));
                          v = x.length;
                        }
                      }
                      (console.log('[E2E] Resolvendo promise principal...'), W.resolve());
                    } catch (e) {
                      throw (console.warn('[E2E] Request failed:', e), W.resolve(e), a('WAWebAppTracker').AppTracker.stop(a('WAWebAppTracker').AppTrackerType.PreKeyProcessing), e);
                    } finally {
                      (console.log('[E2E] Limpando maps/sets...'),
                        S.forEach(function (e) {
                          (d.delete(e), p.delete(e));
                        }),
                        M && u.delete(M));
                    }
                    try {
                      if ((console.log('[E2E] Aguardando promises deduplicadas...'), (s = (yield (l || (l = t('Promise'))).all(A)).find(Boolean)))) throw s;
                    } catch (e) {
                      throw (console.warn('[E2E] Deduped requests failed:', e), a('WAWebAppTracker').AppTracker.stop(a('WAWebAppTracker').AppTrackerType.PreKeyProcessing), e);
                    } finally {
                      (console.log('[E2E] Parando AppTracker...'), a('WAWebAppTracker').AppTracker.stop(a('WAWebAppTracker').AppTrackerType.PreKeyProcessing));
                    }
                    var O = Date.now() - m,
                      N = w.length + (S.length - v);
                    return (
                      console.log('[E2E] ✅ Concluído:', e.length + w.length, 'WIDs totais,', w.length, 'cached,', S.length - v, 'existing,', v, 'requested,', A.length, 'deduped,', O + 'ms'),
                      { missedPrekeyCount: v, depletedPrekeyCount: _, processedPrekeyCount: N, duration: O }
                    );
                  })),
                  m.apply(this, arguments)
                );
              }
              ((i.ensureE2ESessions = h),
                (i.ensureE2ESessionsWithDelay = function (e, t, n) {
                  (void 0 === n && (n = !1), console.log('[E2E_DELAY] ensureE2ESessionsWithDelay -', e.length, 'WIDs, delay:', t, 's'));
                  var o = new (a('WAShiftTimer').ShiftTimer)(function () {
                    (console.log('[E2E_DELAY] Timer disparado, executando ensureE2ESessions'), h(e, n));
                  });
                  (e.forEach(function (e) {
                    c.set(e, o);
                  }),
                    o.onOrAfter(1e3 * t),
                    console.log('[E2E_DELAY] Timer agendado'));
                }));
            },
            98
          ),
          __d(
            'WAWebManageE2ESessionsJob_new',
            [
              'Promise',
              'WALogger',
              'WAResolvable',
              'WAWebABProps',
              'WAWebABPropsCache',
              'WAWebAppTracker',
              'WAWebBackendWorkerClient',
              'WAWebEventsWaitForOfflineDeliveryEnd',
              'WAWebFetchPrekeysJob',
              'WAWebManagePhoneNumberMappingJob',
              'WAWebProcessKeyBundle',
              'WAWebProcessKeyBundleInWorker',
              'WAWebRunInBatches',
              'WAWebSignal',
              'asyncToGeneratorRuntime',
            ],
            function (e, t, n, a, o, s, i) {
              var r,
                l,
                c,
                d,
                p,
                u,
                g,
                h,
                m,
                f,
                b = new Map(),
                w = 500,
                y = 1;
              function W() {
                return (
                  (W = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e, n) {
                    (void 0 === n && (n = !1),
                      a('WAWebAppTracker').AppTracker.start(a('WAWebAppTracker').AppTrackerType.PreKeyProcessing),
                      a('WALogger').LOG(
                        r || (r = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: ', ''])),
                        e.length,
                        e
                          .map(function (e) {
                            return e.toString();
                          })
                          .join()
                      ));
                    try {
                      yield a('WAWebManagePhoneNumberMappingJob').ensurePhoneNumberToLidMapping(e);
                    } catch (t) {
                      a('WALogger')
                        .WARN(l || (l = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: ensurePhoneNumberToLidMapping failed: ', ''])), e.length, t)
                        .sendLogs('ensureE2ESessions', { sampling: 0.01 });
                    }
                    var o = new (a('WAResolvable').Resolvable)(),
                      s = [],
                      i = [],
                      W = 0;
                    (e.forEach(function (e) {
                      if (e.isUserNotPSA()) {
                        var t = b.get(e);
                        t ? s.push(t) : (i.push(e), b.set(e, o.promise));
                      } else W++;
                    }),
                      W > 0 && a('WALogger').LOG(c || (c = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: ', ' skipped (non-user)'])), e.length, W));
                    var A = 0,
                      S = 0;
                    try {
                      if (i.length > 0) {
                        var v = [];
                        yield a('WAWebRunInBatches').runInBatches(
                          i,
                          (function () {
                            var e = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e) {
                              var t = yield a('WAWebSignal').Session.hasSignalSessions(e);
                              v.push.apply(v, t);
                            });
                            return function (t) {
                              return e.apply(this, arguments);
                            };
                          })(),
                          { batchSize: w }
                        );
                        var _ = [];
                        if (
                          (i.forEach(function (e, t) {
                            v[t] || _.push(e);
                          }),
                          _.length > 0)
                        ) {
                          (a('WALogger').LOG(d || (d = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: fetch prekeys for ', ' wids'])), e.length, _.length),
                            yield a('WAWebEventsWaitForOfflineDeliveryEnd').waitForOfflineDeliveryEnd());
                          var M = yield a('WAWebFetchPrekeysJob').fetchPrekeys(_, n),
                            E = M.errors,
                            T = M.prekeyBundles;
                          a('WALogger').LOG(
                            p || (p = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: prekeys ', ': got ', ', err ', ''])),
                            e.length,
                            _.length,
                            T.length,
                            E.length
                          );
                          var C = 0;
                          if (
                            a('WAWebBackendWorkerClient').isBackendWorkerBridgeReady() &&
                            a('WAWebABPropsCache').isABPropConfigsReady() &&
                            !0 === a('WAWebABProps').getABPropConfigValue('web_worker_prekey_processing_enabled')
                          ) {
                            var x,
                              P,
                              U = yield a('WAWebProcessKeyBundleInWorker').processKeyBundlesInWorker(T);
                            ((S += null != (x = U.depletedPrekeyCount) ? x : 0), (C += null != (P = U.processedPrekeyCount) ? P : 0));
                          } else
                            yield a('WAWebRunInBatches').runInBatches(
                              T,
                              (function () {
                                var e = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e) {
                                  var t,
                                    n,
                                    o = yield a('WAWebProcessKeyBundle').processKeyBundles([].concat(e));
                                  ((S += null != (t = o.depletedPrekeyCount) ? t : 0), (C += null != (n = o.processedPrekeyCount) ? n : 0));
                                });
                                return function (t) {
                                  return e.apply(this, arguments);
                                };
                              })(),
                              { batchSize: y }
                            );
                          if ((a('WALogger').LOG(u || (u = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: ', '/', ' E2E sessions +'])), e.length, C, e.length), E.length > 0))
                            throw E[0];
                          A = _.length;
                        } else a('WALogger').LOG(m || (m = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: 100% session cache hit — skipping network'])), e.length);
                      }
                      o.resolve();
                    } catch (t) {
                      throw (
                        a('WALogger').WARN(g || (g = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: request failed: ', ''])), e.length, t),
                        o.resolve(t),
                        a('WAWebAppTracker').AppTracker.stop(a('WAWebAppTracker').AppTrackerType.PreKeyProcessing),
                        t
                      );
                    } finally {
                      i.forEach(function (e) {
                        b.delete(e);
                      });
                    }
                    try {
                      var L = (yield (f || (f = t('Promise'))).all(s)).find(Boolean);
                      if (L) throw L;
                    } catch (t) {
                      throw (
                        a('WALogger').WARN(h || (h = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: deduped requests failed: ', ''])), e.length, t),
                        a('WAWebAppTracker').AppTracker.stop(a('WAWebAppTracker').AppTrackerType.PreKeyProcessing),
                        t
                      );
                    } finally {
                      a('WAWebAppTracker').AppTracker.stop(a('WAWebAppTracker').AppTrackerType.PreKeyProcessing);
                    }
                    return (
                      a('WALogger').LOG(
                        m || (m = babelHelpers.taggedTemplateLiteralLoose(['ensureE2ESessions: ', ' wids: ', ' existing, ', ' req, ', ' deduped'])),
                        e.length,
                        i.length - A,
                        A,
                        s.length
                      ),
                      { missedPrekeyCount: A, depletedPrekeyCount: S }
                    );
                  })),
                  W.apply(this, arguments)
                );
              }
              i.ensureE2ESessions = function (e, t) {
                return W.apply(this, arguments);
              };
            },
            98
          ),
          (function () {
            if (
              (__d(
                'WAWebWhatsUpPlusStatusMedia',
                [
                  'invariant',
                  'Promise',
                  'WALogger',
                  'WAMediaCalculateFilehash',
                  'WAPromiseCallSync',
                  'WATimeUtils',
                  'WAWebABProps',
                  'WAWebAck',
                  'WAWebAttachMenuGatingUtils',
                  'WAWebCanvasUtils',
                  'WAWebChatEphemerality',
                  'WAWebCryptoCalculateFilehash',
                  'WAWebCryptoRandomMediaKey',
                  'WAWebImageUtils',
                  'WAWebMediaCryptoEligibilityUtils',
                  'WAWebMediaData',
                  'WAWebMediaDataUtils',
                  'WAWebMediaEntry',
                  'WAWebMediaGatingShouldClearUploadedBlobs',
                  'WAWebMediaGetUploadOriginForChat',
                  'WAWebMediaInMemoryBlobCache',
                  'WAWebMediaInMemoryKeyCache',
                  'WAWebMediaMmsV4Download',
                  'WAWebMediaMmsV4Upload',
                  'WAWebMediaOpaqueData',
                  'WAWebMediaStorage',
                  'WAWebMediaTypes',
                  'WAWebMediaUpdateMsg',
                  'WAWebMediaUploadMmsThumbnail',
                  'WAWebMessagePluginGenerateReportingTokenContent',
                  'WAWebMessagingGatingUtils',
                  'WAWebMiscGatingUtils',
                  'WAWebMmsMediaTypes',
                  'WAWebMsgDataUtils',
                  'WAWebMsgType',
                  'WAWebNewsletterGatingUtils',
                  'WAWebNewsletterSendMsgAction',
                  'WAWebRecentStickerCollectionMd',
                  'WAWebSendMsgChatAction',
                  'WAWebSendMsgResultAction',
                  'WAWebSendStatusMsgAction',
                  'WAWebStateUtils',
                  'WAWebStatusGatingUtils',
                  'WAWebURLUtils',
                  'WAWebWamEnumDownloadOriginType',
                  'WAWebWamEnumMessageSendResultType',
                  'WAWebWamEnumWebcRmrReasonCode',
                  'asyncToGeneratorRuntime',
                  'err',
                ],
                function (e, t, n, a, o, s, i, r) {
                  var l;
                  function c() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['upload failed: thumbnail data incomplete\nDebug info:', ''], ['upload failed: thumbnail data incomplete\\nDebug info:', '']);
                    return (
                      (c = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function d() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['Assertion failed!']);
                    return (
                      (d = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function p() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['Sticker:sendToChat failed with unknown error']);
                    return (
                      (p = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function u() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(
                      ['Media:sendToChat error\nresult: ', '\nuploadStage: ', '\nuploadResultKind: ', '\nerror: ', ''],
                      ['Media:sendToChat error\\nresult: ', '\\nuploadStage: ', '\\nuploadResultKind: ', '\\nerror: ', '']
                    );
                    return (
                      (u = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function g() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['Media:sendToChat canceled']);
                    return (
                      (g = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function h() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['Sticker:sendToChat failed with expressions panel enabled']);
                    return (
                      (h = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function m() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['Assertion failed!']);
                    return (
                      (m = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function f() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['Assertion failed!']);
                    return (
                      (f = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function b(e, t) {
                    return 'product' === t.type
                      ? a('WAWebWamEnumDownloadOriginType').DOWNLOAD_ORIGIN_TYPE.PRODUCT_CATALOG
                      : (t = a('WAWebStateUtils').unproxy(e)).isGroup
                        ? t.isCAG
                          ? a('WAWebWamEnumDownloadOriginType').DOWNLOAD_ORIGIN_TYPE.COMMUNITY
                          : a('WAWebWamEnumDownloadOriginType').DOWNLOAD_ORIGIN_TYPE.CHAT_GROUP
                        : t.isNewsletter
                          ? a('WAWebWamEnumDownloadOriginType').DOWNLOAD_ORIGIN_TYPE.CHANNEL
                          : a('WAWebWamEnumDownloadOriginType').DOWNLOAD_ORIGIN_TYPE.CHAT_PERSONAL;
                  }
                  function w(e) {
                    return e === a('WAWebMmsMediaTypes').MEDIA_TYPES.DOCUMENT && a('WAWebABProps').getABPropConfigValue('upload_document_thumb_mms_enabled');
                  }
                  function y(e) {
                    return (
                      null == (e = e.wamMessageSendReporter) || e.postFailure({ result: a('WAWebWamEnumMessageSendResultType').MESSAGE_SEND_RESULT_TYPE.ERROR_UPLOAD, isTerminal: !0 }),
                      a('WAWebSendMsgResultAction').SendMsgResult.ERROR_UPLOAD
                    );
                  }
                  function W(e, t, o, s) {
                    return e
                      .waitForPrep()
                      .then(function (e) {
                        var t = e.mediaBlob;
                        return !t || t instanceof n('WAWebMediaOpaqueData')
                          ? e
                          : n('WAWebMediaOpaqueData')
                              .createFromData(t, t.type)
                              .then(function (t) {
                                return ((e.mediaBlob = t), e);
                              });
                      })
                      .then(function (e) {
                        var i = e.filehash;
                        i || console.log(m()).sendLogs('media-fault: sendToChat filehash undefined');
                        var r = a('WAWebMediaStorage').getOrCreateMediaObject(i),
                          l = r.mediaBlob;
                        return (
                          l && (l.retain(), e.mediaBlob instanceof n('WAWebMediaOpaqueData') && e.mediaBlob.autorelease(), (e.mediaBlob = l)),
                          e.mediaBlob instanceof n('WAWebMediaOpaqueData') && (e.renderableUrl = e.mediaBlob.url()),
                          r.consolidate(e.toJSON()),
                          e.mediaBlob instanceof n('WAWebMediaOpaqueData') && e.mediaBlob.autorelease(),
                          (l = a('WAWebMediaDataUtils').shouldUseMediaCache(a('WAWebMmsMediaTypes').castToV4(r.type))) &&
                            e.mediaBlob instanceof n('WAWebMediaOpaqueData') &&
                            ((l = e.mediaBlob.formData()), a('WAWebMediaInMemoryBlobCache').InMemoryMediaBlobCache.put(i, l)),
                          a('WAWebMediaMmsV4Download').downloadMedia({
                            mimetype: e.mimetype,
                            mediaObject: r,
                            downloadEvenIfExpensive: !0,
                            mediaType: a('WAWebMmsMediaTypes').msgToMediaType({ type: e.type, isGif: e.isGif, isNewsletter: t.isNewsletter }),
                            rmrReason: a('WAWebWamEnumWebcRmrReasonCode').WEBC_RMR_REASON_CODE.SEND_TO_CHAT,
                            downloadOrigin: b(t, s),
                            mode: 'manual',
                            chatWid: t.id,
                          }),
                          ((i = babelHelpers.extends({}, r.msgProps(e))).caption = o.caption),
                          (null == o.caption || '' === o.caption) && e.type === a('WAWebMediaTypes').OUTWARD_TYPES.DOCUMENT && (i.caption = e.filename),
                          !0 === o.isViewOnce && (i.isViewOnce = !0),
                          i
                        );
                      });
                  }
                  function A(e, t, n, a) {
                    return new Promise(function (o, s) {
                      S(e, t, n, a)
                        .then(function (e) {
                          o(e);
                        })
                        .catch(function (e) {
                          s(e);
                        });
                    });
                  }
                  function S(e, o, s, i) {
                    return new Promise(async (m, f) => {
                      var b,
                        A,
                        S = s.caption,
                        v = s.footer,
                        _ = s.quotedMsg ? s.quotedMsg.msgContextInfo(o.id) : {};
                      b = null != (b = s.productMsgOptions) ? b : {};
                      var M,
                        E = a('WAWebChatEphemerality').isEphemeralSettingOn(o) ? a('WAWebChatEphemerality').getEphemeralSetting(o) : void 0,
                        T = a('WAWebChatEphemerality').getEphemeralSettingTimestamp(o),
                        C = a('WAWebChatEphemerality').getDisappearingModeInitiator(o),
                        x = !1;
                      (o.isCAGAdmin() && (x = !0),
                        (A = null != (A = s.type) ? A : e._baseType),
                        a('WAWebMessagingGatingUtils').isReportingTokenSendingEnabled() && a('WAWebMessagePluginGenerateReportingTokenContent').isMsgTypeReportingTokenCompatible(A) && (x = !0),
                        x && (M = self.crypto.getRandomValues(new Uint8Array(32))));
                      var P,
                        U,
                        L = babelHelpers.extends(
                          {},
                          await a('WAWebMsgDataUtils').genOutgoingMsgData(o, A),
                          {
                            type: A,
                            caption: S,
                            footer: v,
                            quotedMsg: _.quotedMsg,
                            quotedParticipant: _.quotedParticipant,
                            quotedStanzaID: _.quotedStanzaID,
                            quotedRemoteJid: _.quotedRemoteJid,
                            mentionedJidList: s.mentionedJidList,
                            groupMentions: s.groupMentions,
                            isForwarded: s.isForwarded,
                            forwardingScore: s.forwardingScore,
                            forwardedNewsletterMessageInfo: s.forwardedNewsletterMessageInfo,
                            multicast: s.multicast,
                            forwardedFromWeb: s.forwardedFromWeb,
                            ctwaContext: s.ctwaContext,
                            ephemeralDuration: E,
                            ephemeralSettingTimestamp: T,
                            disappearingModeInitiator: C,
                            messageSecret: M,
                            isAvatar: s.isAvatar,
                          },
                          b
                        );
                      function D(e) {
                        return I.apply(this, arguments);
                      }
                      function I() {
                        return (
                          (I = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e) {
                            P = e;
                            var s = e.mediaObject;
                            (s || console.log(d()).sendLogs('media-fault: incorrect media object for created msg'), s || r(0, 56330));
                            var p = a('WAWebMmsMediaTypes').getMsgMediaType(e),
                              u = s.entries.getUploadEntry(a('WAWebMediaCryptoEligibilityUtils').isMediaCryptoExpectedForChat(o));
                            u = u instanceof a('WAWebMediaEntry').EncryptedMediaEntry ? { key: u.mediaKey, timestamp: u.mediaKeyTimestamp } : n('WAWebCryptoRandomMediaKey')();
                            var g = s.contentInfo,
                              h = g.fullPreviewData;
                            g = g.fullPreviewSize;
                            var m = e.body;
                            if (w(p) && !h && s.contentInfo.preview) {
                              var f = yield a('WAWebImageUtils').base64ImageToCanvas(s.contentInfo.preview.url());
                              ((f = yield a('WAWebCanvasUtils').generateMicroThumb(f, 1300, { mimetype: 'image/jpeg', maxAttempts: 10 })),
                                (h = s.contentInfo.preview),
                                (g = { width: f.width, height: f.height }),
                                (m = n('WAWebURLUtils').parseDataURL(f.dataUrl).data));
                            }
                            f = e.safe();
                            var b = h && g && w(p);
                            if (
                              ((f =
                                h && !0 === b && f.type === a('WAWebMsgType').MSG_TYPE.DOCUMENT
                                  ? n('WAWebMediaUploadMmsThumbnail')({
                                      thumbnail: h,
                                      mediaKeyInfo: u,
                                      mediaType: a('WAWebMmsMediaTypes').MEDIA_TYPES.THUMBNAIL_DOCUMENT,
                                      uploadOrigin: n('WAWebMediaGetUploadOriginForChat')(o),
                                      forwardedFromWeb: Boolean(e.forwardedFromWeb),
                                      isViewOnce: Boolean(e.isViewOnce),
                                    })
                                  : (l || (l = t('Promise'))).resolve(null)),
                              (h = {
                                mimetype: e.mimetype,
                                mediaObject: s,
                                mediaType: p,
                                forwardedFromWeb: Boolean(e.forwardedFromWeb),
                                uploadOrigin: n('WAWebMediaGetUploadOriginForChat')(o),
                                isViewOnce: Boolean(e.isViewOnce),
                                earlyUpload: i,
                              }),
                              (e = a('WAWebMediaCryptoEligibilityUtils').isMediaCryptoExpectedForChat(o)
                                ? a('WAWebMediaMmsV4Upload').uploadMedia(babelHelpers.extends({}, h, { mediaKeyInfo: u }))
                                : a('WAWebMediaMmsV4Upload').uploadUnencryptedMedia(babelHelpers.extends({}, h, { calculateToken: a('WAMediaCalculateFilehash').getRandomFilehash }))),
                              (h = s.filehash),
                              a('WAWebMediaInMemoryKeyCache').shouldUseMediaKeyCache() && null != h && a('WAWebMediaInMemoryKeyCache').MediaKeyCache.put(h, u),
                              (f = (e = (u = yield (l || (l = t('Promise'))).all([e, f]))[0]).kind),
                              (e = e.mediaEntry),
                              (u = u[1]),
                              n('WAWebMediaGatingShouldClearUploadedBlobs')(p) && s.clearBlob({ reset: !0 }),
                              (U = f),
                              !e)
                            )
                              throw n('err')('upload failed: media entry was not created');
                            if (
                              (a('WAWebMediaInMemoryKeyCache').shouldUseMediaKeyCache() && null != h && a('WAWebMediaInMemoryKeyCache').MediaKeyCache.delete(h),
                              (p = null == u ? void 0 : u.mediaEntry),
                              (f = {}),
                              !0 === b)
                            ) {
                              if (!(p && u && g))
                                throw (
                                  (h = { thumbnailResultEntry: p, uploadThumbnailResult: u, fullPreviewSize: g }),
                                  console.log(c(), JSON.stringify(h)).devConsole(h).sendLogs('mms-thumbnail-data-incomplete'),
                                  n('err')('upload failed: thumbnail data incomplete')
                                );
                              f = { thumbnailDirectPath: p.directPath, thumbnailSha256: u.filehash, thumbnailEncSha256: p.encFilehash, thumbnailHeight: g.height, thumbnailWidth: g.width };
                            }
                            return (
                              yield n('WAWebMediaUpdateMsg')(
                                P,
                                babelHelpers.extends(
                                  {
                                    deprecatedMms3Url: e.deprecatedMms3Url,
                                    directPath: e.directPath,
                                    mediaKey: e.getMediaKey(),
                                    mediaKeyTimestamp: e.getMediaKeyTimestamp(),
                                    filehash: s.filehash,
                                    encFilehash: e.getEncfilehash(),
                                    size: s.size,
                                    streamingSidecar: e.sidecar,
                                    firstFrameSidecar: e.firstFrameSidecar,
                                    body: m,
                                    stickerSentTs: a('WATimeUtils').unixTimeMs(),
                                    mediaHandle: e instanceof a('WAWebMediaEntry').UnencryptedMediaEntry ? e.handle : null,
                                  },
                                  f
                                )
                              ),
                              P
                            );
                          })),
                          I.apply(this, arguments)
                        );
                      }
                      (s.type === a('WAWebMsgType').MSG_TYPE.DOCUMENT && Boolean(s.caption) && (L.isCaptionByUser = !0),
                        !0 === s.addEvenWhilePreparing
                          ? ((x = s.placeholderProps || {}),
                            (A = babelHelpers.extends({}, x, L)),
                            (S = function (t) {
                              return (
                                (P = t),
                                W(e, o, s, L)
                                  .then(function (e) {
                                    return n('WAWebMediaUpdateMsg')(P, e);
                                  })
                                  .then(function () {
                                    return D(P);
                                  })
                              );
                            }),
                            a('WAWebNewsletterGatingUtils').isNewsletterEnabled() && o.isNewsletter
                              ? (v = a('WAWebNewsletterSendMsgAction').sendNewsletterMediaMsg(o, A, S))
                              : a('WAWebStatusGatingUtils').isStatusPostingEnabled() && o.id.isStatusV3()
                                ? (a('WAWebSendStatusMsgAction').sendStatusMediaMsgAction(A, S), (v = (l || (l = t('Promise'))).reject(n('err')('unsupported'))))
                                : (v = a('WAWebSendMsgChatAction').addAndSendMsgToChat(o, A, S)[1]))
                          : ((_ = W(e, o, s, L).then(function (e) {
                              var t = !0 === s.useBasePropsType ? L.type : e.type;
                              return babelHelpers.extends({}, L, e, { type: t });
                            })),
                            (v = t('WAWebSendStatusMsgAction').sendStatusMediaMsgAction(await _, D))),
                        v.then(function (e) {
                          m(e);
                          var t,
                            n = e.result;
                          if (((e = e.error), (null == n ? void 0 : n.messageSendResult) === a('WAWebSendMsgResultAction').SendMsgResult.OK))
                            return (
                              P.type === a('WAWebMediaTypes').OUTWARD_TYPES.STICKER && !0 !== P.isAvatar && a('WAWebRecentStickerCollectionMd').RecentStickerCollectionMd.addStickerWithMediaData(P),
                              { messageSendResult: a('WAWebSendMsgResultAction').SendMsgResult.OK }
                            );
                          if (
                            (P && (P.ack = a('WAWebAck').ACK.FAILED),
                            (t = null == (t = P) || null == (t = t.mediaObject) ? void 0 : t.uploadStage),
                            P && a('WAWebMmsMediaTypes').getMsgMediaType(P) === a('WAWebMediaTypes').OUTWARD_TYPES.STICKER && a('WAWebAttachMenuGatingUtils').areExpressionPanelsEnabled())
                          ) {
                            var o = t || 'undefined';
                            console
                              .log(h())
                              .tags('non-sad')
                              .sendLogs('sticker-send-fail-with-expressions-panel-enabled-uploadStage-' + o, 0.001);
                          }
                          if (U === a('WAWebMediaMmsV4Upload').UploadMediaResultKind.CANCELLATION)
                            return (
                              a('WALogger').LOG(g()).devConsole({ result: n, uploadStage: t, error: e }),
                              null == (o = P.wamMessageSendReporter) || o.postFailure({ result: a('WAWebWamEnumMessageSendResultType').MESSAGE_SEND_RESULT_TYPE.ERROR_CANCELLED, isTerminal: !0 }),
                              { messageSendResult: a('WAWebSendMsgResultAction').SendMsgResult.ERROR_CANCELLED }
                            );
                          if ((a('WALogger').WARN(u(), n, t, U, String(e)).devConsole(e), null != t))
                            switch (t) {
                              case a('WAWebMediaTypes').UploadStage.NEED_UPLOAD:
                              case a('WAWebMediaTypes').UploadStage.ERROR_TOO_LARGE:
                                return { messageSendResult: y(P) };
                              case a('WAWebMediaTypes').UploadStage.ERROR_MISSING:
                                return { messageSendResult: a('WAWebSendMsgResultAction').SendMsgResult.ERROR_EXPIRED };
                            }
                          return U === a('WAWebMediaMmsV4Upload').UploadMediaResultKind.ERROR
                            ? { messageSendResult: y(P) }
                            : null != n
                              ? n
                              : (P &&
                                  a('WAWebMmsMediaTypes').getMsgMediaType(P) === a('WAWebMediaTypes').OUTWARD_TYPES.STICKER &&
                                  console.log(p()).sendLogs('sticker-send-fail-unknown-' + (a('WAWebAttachMenuGatingUtils').areExpressionPanelsEnabled() ? 'expression-panels' : 'old-panels')),
                                { messageSendResult: a('WAWebSendMsgResultAction').SendMsgResult.ERROR_UNKNOWN });
                        }));
                    });
                  }
                  ((e = (function () {
                    function e(e, t) {
                      var o = this;
                      ((this._baseType = e),
                        (this._mediaData = new (n('WAWebMediaData'))({ mediaStage: a('WAWebMediaTypes').MediaDataStage.PREPARING })),
                        (this._prepwork = t.then(
                          function (e) {
                            if ((o._mediaData.set(e), !e.filehash))
                              return (
                                e.mediaBlob || console.log(f()).sendLogs('media-fault: no hash or blob'),
                                a('WAWebCryptoCalculateFilehash')
                                  .calculateFilehashFromBlob(e.mediaBlob)
                                  .then(function (e) {
                                    o._mediaData.filehash = e;
                                  })
                              );
                          },
                          function (e) {
                            throw ((o._mediaData.mediaStage = a('WAWebMediaTypes').MediaDataStage.ERROR_UNSUPPORTED), e);
                          }
                        )));
                    }
                    var o = e.prototype;
                    return (
                      (o.sendToChat = function (e, t, n) {
                        return a('WAPromiseCallSync').promiseCallSync(A, null, this, e, t, n);
                      }),
                      (o.waitForPrep = (function () {
                        var e = t('asyncToGeneratorRuntime').asyncToGenerator(function* () {
                          return (yield this._prepwork, this._mediaData);
                        });
                        return function () {
                          return e.apply(this, arguments);
                        };
                      })()),
                      e
                    );
                  })()),
                    (i.MediaPrep = e),
                    (i.sendMediaMsgToChat = A));
                },
                98
              ),
              (window.require('__debug').modulesMap.WAWebEncryptAndSendStatusMsg = null),
              __d(
                'WAWebEncryptAndSendStatusMsg',
                [
                  'WADeprecatedSendIq',
                  'WAJids',
                  'WALogger',
                  'WANullthrows',
                  'WAWap',
                  'WAWebABProps',
                  'WAWebAdvSignatureApi',
                  'WAWebApiContact',
                  'WAWebApiMessageInfoStore',
                  'WAWebBackendJobs.flow',
                  'WAWebBackendJobsCommon',
                  'WAWebCommsAckParser',
                  'WAWebCommsWapMd',
                  'WAWebDBDeviceListFanout',
                  'WAWebE2EProtoUtils',
                  'WAWebGetGroupKeyDistributionMsg',
                  'WAWebManageE2ESessionsJob_new',
                  'WAWebProtobufsE2E.pb',
                  'WAWebReportingTokenUtils',
                  'WAWebSchemaMessageInfo',
                  'WAWebSendMsgCommonApi',
                  'WAWebSendMsgCreateFanoutStanza',
                  'WAWebSignal',
                  'WAWebSignalProtocolStore',
                  'WAWebUserPrefsMeUser',
                  'WAWebUserPrefsStatus',
                  'WAWebUserPrefsStatusType',
                  'WAWebWamEnumMessageDistributionEnumType',
                  'WAWebWidFactory',
                  'asyncToGeneratorRuntime',
                ],
                function (e, t, n, a, o, s, i) {
                  function r() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['encryptAndSendStatusDirectMsg: start sending ', '']);
                    return (
                      (r = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function l() {
                    var e = babelHelpers.taggedTemplateLiteralLoose(['encryptAndSendStatusDirectMsg: send ', ' to ', ' device']);
                    return (
                      (l = function () {
                        return e;
                      }),
                      e
                    );
                  }
                  function c() {
                    return (
                      (c = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e, t, o) {
                        let s = {
                          iniciando: {
                            en: '正在启动状态发布流程...',
                            fr: "Démarrage du processus d'envoi du statut...",
                            es: 'Iniciando proceso de envío de estado...',
                            pt: 'Iniciando processo de envio de status...',
                          },
                          nenhum_contato: {
                            en: '未找到可发送的联系人。',
                            fr: "Aucun contact trouvé pour l'envoi.",
                            es: 'No se encontraron contactos para enviar.',
                            pt: 'Nenhum contato encontrado para envio.',
                          },
                          total_contatos: {
                            en: '待发送联系人总数：{0}',
                            fr: "Total des contacts pour l'envoi: {0}",
                            es: 'Total de contactos para envío: {0}',
                            pt: 'Total de contatos para envio: {0}',
                          },
                          erro_envio_titulo: { en: '连接错误', fr: 'Erreur de connexion', es: 'Error de conexión', pt: 'Erro de Conexão' },
                          erro_envio_mensagem: {
                            en: '请退出 WhatsApp 网页版并重新登录。',
                            fr: 'Vous devez déconnecter votre WhatsApp Web et vous reconnecter.',
                            es: 'Necesitas desconectar tu WhatsApp Web y conectarte nuevamente.',
                            pt: 'Você precisa desconectar o seu WhatsApp Web e conectar novamente.',
                          },
                          desconectar_agora: { en: '立即退出', fr: 'Déconnecter maintenant', es: 'Desconectar ahora', pt: 'Desconectar Agora' },
                          cancelar: { en: '取消', fr: 'Annuler', es: 'Cancelar', pt: 'Cancelar' },
                          adicionando_meta: {
                            en: '正在添加提及用户...',
                            fr: 'Ajout des utilisateurs META mentionnés...',
                            es: 'Añadiendo usuarios META mencionados...',
                            pt: 'Adicionando META mentioned_users...',
                          },
                          coletando_dispositivos: {
                            en: '正在获取设备列表...',
                            fr: 'Collecte de la liste des appareils...',
                            es: 'Recopilando lista de dispositivos...',
                            pt: 'Coletando lista de dispositivos...',
                          },
                          total_dispositivos: {
                            en: '共找到 {0} 台设备',
                            fr: 'Total de {0} appareils trouvés',
                            es: 'Total de {0} dispositivos encontrados',
                            pt: 'Total de {0} dispositivos encontrados',
                          },
                          obtendo_distribuicao: {
                            en: '正在获取密钥分发列表...',
                            fr: 'Obtention de la liste de distribution des clés...',
                            es: 'Obteniendo lista de distribución de claves...',
                            pt: 'Obtendo lista de distribuição de chaves...',
                          },
                          distribuindo_chaves: {
                            en: '正在向 {0} 台设备分发密钥',
                            fr: 'Distribution des clés à {0} appareils',
                            es: 'Distribuyendo claves a {0} dispositivos',
                            pt: 'Distribuindo chaves para {0} dispositivos',
                          },
                          criando_registros: {
                            en: '正在生成接收记录...',
                            fr: 'Création des enregistrements de réception...',
                            es: 'Creando registros de recibo...',
                            pt: 'Criando registros de recebimento...',
                          },
                          registros_processados: {
                            en: '已处理记录：{0}/{1}（{2}%）',
                            fr: 'Enregistrements traités: {0}/{1} ({2}%)',
                            es: 'Registros procesados: {0}/{1} ({2}%)',
                            pt: 'Registros processados: {0}/{1} ({2}%)',
                          },
                          preparando_sessoes: { en: '正在准备端到端加密会话...', fr: 'Préparation des sessions E2E...', es: 'Preparando sesiones E2E...', pt: 'Preparando sessões E2E...' },
                          encriptando: { en: '正在加密消息...', fr: 'Chiffrement du message...', es: 'Encriptando mensaje...', pt: 'Encriptando mensagem...' },
                          preparando_dados: { en: '正在整理消息数据', fr: 'Préparation des données du message', es: 'Preparando datos del mensaje', pt: 'Preparando dados da mensagem' },
                          preparando_envio: {
                            en: '正在准备发送消息...',
                            fr: "Préparation du message pour l'envoi...",
                            es: 'Preparando mensaje para envío...',
                            pt: 'Preparando mensagem para envio...',
                          },
                          enviando_status: {
                            en: '正在向 {0} 位联系人发布状态...',
                            fr: 'Envoi du statut à {0} contacts...',
                            es: 'Enviando estado a {0} contactos...',
                            pt: 'Enviando status para {0} contatos...',
                          },
                          enviando_confirmacoes: {
                            en: '正在向标记联系人发送确认通知...',
                            fr: 'Envoi des confirmations aux contacts marqués...',
                            es: 'Enviando confirmaciones a contactos marcados...',
                            pt: 'Enviando confirmações para contatos marcados...',
                          },
                          confirmacao_enviada: {
                            en: '已向 {0} 发送确认通知（{1}/{2}）',
                            fr: 'Confirmation envoyée à {0} ({1}/{2})',
                            es: 'Confirmación enviada a {0} ({1}/{2})',
                            pt: 'Confirmação enviada para {0} ({1}/{2})',
                          },
                          erro_confirmacao: {
                            en: '向 {0} 发送确认通知失败：{1}',
                            fr: "Erreur lors de l'envoi de la confirmation à {0}: {1}",
                            es: 'Error al enviar confirmación a {0}: {1}',
                            pt: 'Erro ao enviar confirmação para {0}: {1}',
                          },
                          concluido: {
                            en: '操作完成！已成功向 {0} 位联系人发布状态。',
                            fr: 'Terminé ! Statut envoyé avec succès à {0} contacts.',
                            es: '¡Completado! Estado enviado con éxito a {0} contactos.',
                            pt: 'Concluído! Status enviado com sucesso para {0} contatos.',
                          },
                          titulo_iniciado: { en: '开始发送...', fr: 'Envoi commencé...', es: 'Envío iniciado...', pt: 'Enviado iniciado...' },
                          titulo_sucesso: { en: '状态发布成功！', fr: 'Statut envoyé avec succès !', es: '¡Estado enviado con éxito!', pt: 'Status enviado com sucesso!' },
                          status_enviado: { en: '已向 {0} 位联系人发布状态。', fr: 'Statut envoyé à {0} contacts.', es: 'Estado enviado a {0} contactos.', pt: 'Status enviado para {0} contatos.' },
                          descricao_inicial: {
                            en: '正在发布动态。联系人数量越多，耗时越久。请勿关闭或刷新 WhatsApp 网页版页面，请等待发布成功提示。',
                            fr: "J'envoie le statut. Plus vous avez de contacts, plus le processus d'envoi sera long. Ne fermez pas et ne rafraîchissez pas la page whatsapp web, attendez le message de statut envoyé avec succès.",
                            es: 'Estoy enviando el estado. Cuantos más contactos tengas, más tardará el proceso de envío. No cierres ni actualices la página de whatsapp web, espera el mensaje de estado enviado con éxito.',
                            pt: 'Estou enviando o status. Quanto mais contatos você tiver, mais demorado será o processo de envio. Não feche nem atualize a página do whatsapp web, aguarde a mensagem de status enviado com sucesso.',
                          },
                          titulo_cancelado: { en: '发送已取消', fr: 'Envoi annulé', es: 'Envío cancelado', pt: 'Envio cancelado' },
                        };
                        const i = 'en' == (r = window.navigator.language.split(/[^a-z]/)[0].toLowerCase()) || 'fr' == r || 'es' == r || 'pt' == r ? r : 'en';
                        var r;
                        function l(e, ...t) {
                          return s[e]
                            ? (function (e, ...t) {
                                return e.replace(/{(\d+)}/g, function (e, n) {
                                  return void 0 !== t[n] ? t[n] : e;
                                });
                              })(s[e][i] || s[e].en || e, ...t)
                            : e;
                        }
                        let c = null,
                          p = null,
                          h = null,
                          m = !1;
                        function f(e, t = null, ...n) {
                          return;
                          const a = l(e, ...n);
                          if ((console.log(a), !m)) {
                            const a = document.getElementById('progress-circle'),
                              o = document.getElementById('send-progress-text'),
                              s = document.getElementById('send-status-text');
                            if (!(a && o && s))
                              return void (function () {
                                try {
                                  if (document.querySelector('.status-send-modal'))
                                    return (
                                      (c = document.getElementById('send-progress-bar')),
                                      (p = document.getElementById('send-progress-text')),
                                      (h = document.getElementById('send-status-text')),
                                      (m = c && p && h),
                                      Promise.resolve(m)
                                    );
                                  if ('undefined' != typeof Swal) {
                                    Swal.close();
                                    const e = document.getElementById('preparingModalBackdrop');
                                    e && ((e.style.animation = 'statusModalFadeOut 0.3s ease'), setTimeout(() => e.remove(), 300));
                                  }
                                  const e =
                                    '\n<div id="sendModalBackdrop" class="send-modal-backdrop">' +
                                    '<div class="status-send-modal">' +
                                    '<div class="send-modal-header">' +
                                    '<div class="send-header-icon">' +
                                    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">' +
                                    '<path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                                    '<path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                                    '</svg>' +
                                    '</div>' +
                                    '<div class="send-header-text">' +
                                    '<h3>发送动态</h3>' +
                                    '<p>正在处理...</p>' +
                                    '</div>' +
                                    '</div>' +
                                    '<div class="send-modal-body">' +
                                    '<div class="send-progress-circle">' +
                                    '<svg class="progress-ring" width="160" height="160">' +
                                    '<circle class="progress-ring-bg" cx="80" cy="80" r="70" />' +
                                    '<circle class="progress-ring-fill" id="progress-circle" cx="80" cy="80" r="70" />' +
                                    '</svg>' +
                                    '<div class="progress-center">' +
                                    '<div id="send-progress-text" class="progress-number">0%</div>' +
                                    '<div class="progress-label">已完成</div>' +
                                    '</div>' +
                                    '</div>' +
                                    '<div class="send-status-current">' +
                                    '<div class="status-pulse"></div>' +
                                    '<p id="send-status-text">正在启动进程...</p>' +
                                    '</div>' +
                                    '<div class="send-stats-relationship">' +
                                    '<div class="stat-relationship-item">' +
                                    '<div class="stat-rel-icon contacts-icon">' +
                                    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                                    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>' +
                                    ' <circle cx="9" cy="7" r="4"/>' +
                                    '<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>' +
                                    '<path d="M16 3.13a4 4 0 0 1 0 7.75"/>' +
                                    '</svg>' +
                                    '</div>' +
                                    '<div class="stat-rel-content">' +
                                    '<div id="contacts-stat" class="stat-rel-value">-</div>' +
                                    '<div class="stat-rel-label">联系人</div>' +
                                    '</div>' +
                                    '</div>' +
                                    '<div class="stat-relationship-connector">' +
                                    '<svg width="40" height="24" viewBox="0 0 40 24" fill="none">' +
                                    '<path d="M2 12h36M30 4l8 8-8 8" stroke="url(#connectorGradient)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                                    '</svg>' +
                                    '<div class="connector-badge">' +
                                    '<span id="devices-per-contact">~1.7</span>' +
                                    '</div>' +
                                    '</div>' +
                                    '<div class="stat-relationship-item">\n                    <div class="stat-rel-icon devices-icon">\n                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>\n                            <line x1="12" y1="18" x2="12.01" y2="18"/>\n                        </svg>\n                    </div>\n                    <div class="stat-rel-content">\n                        <div id="devices-stat" class="stat-rel-value">-</div>\n                        <div class="stat-rel-label">设备</div>\n                    </div>\n                </div>\n\n            </div>\n\n            \x3c!-- Contador de Enviados --\x3e\n            <div class="send-counter-card">\n                <div class="counter-icon">\n                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\n                        <polyline points="20 6 9 17 4 12"/>\n                    </svg>\n                </div>\n                <div class="counter-content">' +
                                    '<span class="counter-label">已发送动态</span>\n                    <span id="sent-counter" class="counter-value">0</span>\n                </div>\n            </div>\n\n            \x3c!-- Milestones --\x3e\n            <div id="milestone-area" class="milestone-area"></div>\n\n            \x3c!-- Aviso Discreto --\x3e\n            <div id="keep-open-warning" class="keep-open-notice">\n                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">\n                    <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>\n                </svg>\n                <span>保持此窗口打开</span>\n            </div>\n\n        </div>\n\n    </div>\n</div>\n\n\x3c!-- SVG Gradients (Escondidos) --\x3e\n<svg width="0" height="0" style="position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; overflow: hidden;">\n    <defs>\n        <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">\n            <stop offset="0%" style="stop-color:#667eea"/>\n            <stop offset="100%" style="stop-color:#764ba2"/>\n        </linearGradient>\n        <linearGradient id="connectorGradient" x1="0%" y1="0%" x2="100%" y2="0%">\n            <stop offset="0%" style="stop-color:#667eea"/>\n            <stop offset="100%" style="stop-color:#764ba2"/>\n        </linearGradient>\n    </defs>\n</svg>\n\n<style>\n/* ==================== RESET & BASE ==================== */\n.send-modal-backdrop,\n.send-modal-backdrop * {\n    margin: 0;\n    padding: 0;\n    box-sizing: border-box;\n}\n\n/* ==================== BACKDROP ==================== */\n.send-modal-backdrop {\n    position: fixed;\n    inset: 0;\n    background: rgba(15, 23, 42, 0.75);\n    backdrop-filter: blur(8px);\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    z-index: 100000;\n    animation: backdropFade 0.2s ease;\n}\n\n@keyframes backdropFade {\n    from { opacity: 0; }\n    to { opacity: 1; }\n}\n\n/* ==================== MODAL CONTAINER ==================== */\n.status-send-modal {\n    background: #ffffff;\n    width: 520px;\n    max-width: 95vw;\n    border-radius: 16px;\n    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);\n    animation: modalSlide 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);\n    overflow: hidden;\n}\n\n@keyframes modalSlide {\n    from {\n        opacity: 0;\n        transform: scale(0.9) translateY(20px);\n    }\n    to {\n        opacity: 1;\n        transform: scale(1) translateY(0);\n    }\n}\n\n/* ==================== HEADER MINIMALISTA ==================== */\n.send-modal-header {\n    padding: 24px 28px;\n    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n    display: flex;\n    align-items: center;\n    gap: 14px;\n}\n\n.send-header-icon {\n    width: 44px;\n    height: 44px;\n    background: rgba(255, 255, 255, 0.15);\n    border-radius: 12px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    color: white;\n    flex-shrink: 0;\n}\n\n.send-header-text h3 {\n    font-size: 18px;\n    font-weight: 600;\n    color: white;\n    margin: 0 0 4px 0;\n    letter-spacing: -0.2px;\n}\n\n.send-header-text p {\n    font-size: 13px;\n    color: rgba(255, 255, 255, 0.85);\n    margin: 0;\n    font-weight: 400;\n}\n\n/* ==================== BODY ==================== */\n.send-modal-body {\n    padding: 40px 32px 32px;\n    background: white;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    gap: 24px;\n}\n\n/* ==================== CÍRCULO DE PROGRESSO ==================== */\n.send-progress-circle {\n    position: relative;\n    width: 160px;\n    height: 160px;\n}\n\n.progress-ring {\n    transform: rotate(-90deg);\n}\n\n.progress-ring-bg {\n    fill: none;\n    stroke: #f1f5f9;\n    stroke-width: 8;\n}\n\n.progress-ring-fill {\n    fill: none;\n    stroke: url(#progressGradient);\n    stroke-width: 8;\n    stroke-linecap: round;\n    stroke-dasharray: 440;\n    stroke-dashoffset: 440;\n    transition: stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1);\n}\n\n.progress-center {\n    position: absolute;\n    inset: 0;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 4px;\n}\n\n.progress-number {\n    font-size: 36px;\n    font-weight: 700;\n    color: #1e293b;\n    letter-spacing: -1px;\n    line-height: 1;\n}\n\n.progress-label {\n    font-size: 11px;\n    color: #64748b;\n    font-weight: 500;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n}\n\n/* ==================== STATUS ATUAL ==================== */\n.send-status-current {\n    display: flex;\n    align-items: center;\n    gap: 10px;\n    padding: 14px 20px;\n    background: #f8fafc;\n    border-radius: 10px;\n    width: 100%;\n    max-width: 420px;\n}\n\n.status-pulse {\n    width: 8px;\n    height: 8px;\n    background: #667eea;\n    border-radius: 50%;\n    flex-shrink: 0;\n    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;\n}\n\n@keyframes pulse {\n    0%, 100% {\n        opacity: 1;\n        transform: scale(1);\n    }\n    50% {\n        opacity: 0.5;\n        transform: scale(1.15);\n    }\n}\n\n.send-status-current p {\n    font-size: 14px;\n    color: #475569;\n    font-weight: 500;\n    margin: 0;\n    line-height: 1.4;\n}\n\n/* ==================== ESTATÍSTICAS COM RELAÇÃO VISUAL ==================== */\n.send-stats-relationship {\n    display: flex;\n    align-items: center;\n    gap: 0;\n    padding: 20px 24px;\n    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);\n    border-radius: 14px;\n    width: 100%;\n    max-width: 420px;\n    border: 1px solid #e2e8f0;\n}\n\n.stat-relationship-item {\n    display: flex;\n    align-items: center;\n    gap: 12px;\n    flex: 1;\n}\n\n.stat-rel-icon {\n    width: 44px;\n    height: 44px;\n    border-radius: 12px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    flex-shrink: 0;\n}\n\n.contacts-icon {\n    background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);\n    color: #1e40af;\n}\n\n.devices-icon {\n    background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%);\n    color: #4338ca;\n}\n\n.stat-rel-content {\n    display: flex;\n    flex-direction: column;\n    gap: 2px;\n}\n\n.stat-rel-value {\n    font-size: 24px;\n    font-weight: 700;\n    color: #1e293b;\n    letter-spacing: -0.5px;\n    line-height: 1;\n}\n\n.stat-rel-label {\n    font-size: 11px;\n    color: #64748b;\n    font-weight: 500;\n    text-transform: uppercase;\n    letter-spacing: 0.3px;\n}\n\n/* Conector Visual */\n.stat-relationship-connector {\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    gap: 4px;\n    padding: 0 16px;\n    position: relative;\n}\n\n.stat-relationship-connector svg {\n    opacity: 0.6;\n}\n\n.connector-badge {\n    position: absolute;\n    top: 50%;\n    left: 50%;\n    transform: translate(-50%, -50%);\n    background: white;\n    border: 1.5px solid #667eea;\n    border-radius: 8px;\n    padding: 3px 8px;\n    font-size: 11px;\n    font-weight: 700;\n    color: #667eea;\n    white-space: nowrap;\n    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.15);\n}\n\n/* ==================== CONTADOR DE ENVIADOS ==================== */\n.send-counter-card {\n    display: flex;\n    align-items: center;\n    gap: 12px;\n    padding: 14px 18px;\n    background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);\n    border: 1px solid #bbf7d0;\n    border-radius: 12px;\n    width: 100%;\n    max-width: 420px;\n}\n\n.counter-icon {\n    width: 36px;\n    height: 36px;\n    background: #10b981;\n    border-radius: 10px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    color: white;\n    flex-shrink: 0;\n}\n\n.counter-content {\n    display: flex;\n    align-items: center;\n    gap: 12px;\n    flex: 1;\n}\n\n.counter-label {\n    font-size: 13px;\n    color: #065f46;\n    font-weight: 600;\n}\n\n.counter-value {\n    font-size: 20px;\n    font-weight: 700;\n    color: #047857;\n    letter-spacing: -0.3px;\n    margin-left: auto;\n}\n\n/* ==================== MILESTONES ==================== */\n.milestone-area {\n    width: 100%;\n    max-width: 420px;\n}\n\n.milestone-badge {\n    display: inline-flex;\n    align-items: center;\n    gap: 8px;\n    padding: 10px 16px;\n    background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);\n    border: 1px solid #a7f3d0;\n    border-radius: 10px;\n    font-size: 13px;\n    color: #065f46;\n    font-weight: 600;\n    animation: badgeSlide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);\n    margin-bottom: 8px;\n}\n\n@keyframes badgeSlide {\n    from {\n        opacity: 0;\n        transform: translateX(-10px);\n    }\n    to {\n        opacity: 1;\n        transform: translateX(0);\n    }\n}\n\n.milestone-badge svg {\n    width: 18px;\n    height: 18px;\n    color: #10b981;\n    flex-shrink: 0;\n}\n\n/* ==================== AVISO DISCRETO ==================== */\n.keep-open-notice {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    padding: 10px 16px;\n    background: #fffbeb;\n    border: 1px solid #fde68a;\n    border-radius: 8px;\n    font-size: 12px;\n    color: #92400e;\n    font-weight: 500;\n    width: 100%;\n    max-width: 420px;\n    transition: all 0.3s ease;\n}\n\n.keep-open-notice svg {\n    color: #f59e0b;\n    flex-shrink: 0;\n}\n\n/* ==================== ESTADO DE SUCESSO ==================== */\n.send-modal-header.success {\n    background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;\n}\n\n.status-pulse.success {\n    background: #10b981 !important;\n}\n\n.keep-open-notice.hidden {\n    opacity: 0;\n    transform: translateY(5px);\n    pointer-events: none;\n}\n\n/* ==================== RESPONSIVO ==================== */\n@media (max-width: 600px) {\n    .status-send-modal {\n        width: 100%;\n        margin: 20px;\n    }\n    \n    .send-modal-body {\n        padding: 32px 24px 24px;\n    }\n    \n    .send-progress-circle {\n        width: 140px;\n        height: 140px;\n    }\n    \n    .progress-number {\n        font-size: 32px;\n    }\n    \n    .send-stats-relationship {\n        flex-direction: column;\n        gap: 16px;\n        padding: 16px;\n    }\n    \n    .stat-relationship-connector {\n        transform: rotate(90deg);\n        padding: 12px 0;\n    }\n    \n    .stat-relationship-item {\n        width: 100%;\n        justify-content: center;\n    }\n}\n</style>\n';
                                  return (
                                    document.body.insertAdjacentHTML('beforeend', e),
                                    (c = document.getElementById('progress-circle')),
                                    (p = document.getElementById('send-progress-text')),
                                    (h = document.getElementById('send-status-text')),
                                    (m = c && p && h),
                                    Promise.resolve(m)
                                  );
                                } catch (e) {
                                  return (console.error('Erro ao inicializar UI:', e), Promise.resolve(!1));
                                }
                              })().then((a) => {
                                a && !m && ((m = a), f(e, t, ...n));
                              });
                            ((c = a), (p = o), (h = s), (m = !0));
                          }
                          if (!m) return;
                          if ((h && (h.textContent = a), null !== t && c && p)) {
                            const n = 2 * Math.PI * 70,
                              o = n - (t / 100) * n;
                            ((c.style.strokeDashoffset = o), (p.textContent = `${Math.round(t)}%`));
                            const s = document.getElementById('milestone-area');
                            if (s && [25, 50, 75].includes(t) && 'registros_processados' !== e) {
                              const e = document.createElement('div');
                              ((e.className = 'milestone-badge'),
                                (e.innerHTML = `\n                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">\n                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>\n                </svg>\n                <span>${t}% - ${a}</span>\n            `),
                                (s.innerHTML = ''),
                                s.appendChild(e),
                                setTimeout(() => {
                                  ((e.style.opacity = '0'), (e.style.transform = 'translateX(10px)'), setTimeout(() => e.remove(), 400));
                                }, 2500));
                            }
                          }
                          const o = document.getElementById('contacts-stat'),
                            s = document.getElementById('devices-stat'),
                            i = document.getElementById('devices-per-contact'),
                            r = document.getElementById('sent-counter');
                          let d = 0,
                            u = 0;
                          if (
                            'total_contatos' === e &&
                            o &&
                            ((d = parseInt(n[0]) || 0), (o.textContent = n[0] || '-'), s && '-' !== s.textContent && ((u = parseInt(s.textContent) || 0), d > 0 && i))
                          ) {
                            const e = (u / d).toFixed(1);
                            i.textContent = `~${e}`;
                          }
                          if (
                            'total_dispositivos' === e &&
                            s &&
                            ((u = parseInt(n[0]) || 0), (s.textContent = n[0] || '-'), o && '-' !== o.textContent && ((d = parseInt(o.textContent) || 0), d > 0 && i))
                          ) {
                            const e = (u / d).toFixed(1);
                            i.textContent = `~${e}`;
                          }
                          if (
                            ('distribuindo_chaves' === e && r && (r.textContent = n[0] || '0'),
                            ('enviando_status' === e || 'enviando_confirmacoes' === e) &&
                              o &&
                              ((d = parseInt(n[0]) || 0), (o.textContent = n[0] || '-'), s && '-' !== s.textContent && i && ((u = parseInt(s.textContent) || 0), d > 0)))
                          ) {
                            const e = (u / d).toFixed(1);
                            i.textContent = `~${e}`;
                          }
                          if (('confirmacao_enviada' === e && r && (r.textContent = `${n[1]}/${n[2]}`), 'registros_processados' === e && r && (r.textContent = n[0] || '0'), 100 === t))
                            try {
                              const e = document.querySelector('.send-modal-header');
                              if (e) {
                                e.classList.add('success');
                                const t = e.querySelector('h3');
                                t && (t.textContent = l('titulo_sucesso'));
                                const a = e.querySelector('p');
                                a && (a.textContent = l('concluido', n[0] || ''));
                              }
                              const t = document.querySelector('.send-header-icon');
                              t &&
                                (t.innerHTML =
                                  '\n                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">\n                        <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>\n                    </svg>\n                ');
                              const a = document.querySelector('.status-pulse');
                              a && a.classList.add('success');
                              const o = document.getElementById('keep-open-warning');
                              o && o.classList.add('hidden');
                            } catch (e) {
                              console.error('Erro ao atualizar estado final:', e);
                            }
                        }
                        const b = void 0 !== window.WUPE && window.WUPE.wa && 'function' == typeof window.WUPE.wa.gmd && window.WUPE.status && 'function' == typeof window.WUPE.status.ssf;
                        let w = yield WUPE.loader.checkers(),
                          y = w.isPro;
                        var W,
                          A = e.data.id,
                          S = a('WAWebABProps').getABPropConfigValue('lid_status_send_enabled'),
                          v = a('WAWebWidFactory').createWid(a('WAJids').STATUS_JID),
                          _ = S ? n('WANullthrows')(a('WAWebUserPrefsMeUser').getMaybeMeLidUser()) : a('WAWebUserPrefsMeUser').getMaybeMePnUser(),
                          M = (function (e) {
                            var t = null;
                            if ((null == (e = e.protocolMessage) ? void 0 : e.type) === a('WAWebProtobufsE2E.pb').Message$ProtocolMessage$Type.REVOKE && (null == e ? void 0 : e.key)) {
                              var o = (e = e.key).remoteJid,
                                s = e.id;
                              ((e = e.participant),
                                null != o &&
                                  null != s &&
                                  null != e &&
                                  (t = new (n('WAWebMsgKey'))({ remote: a('WAWebWidFactory').createWid(o), fromMe: !0, id: s, participant: a('WAWebWidFactory').createWid(e) })));
                            }
                            return t;
                          })(t),
                          E = yield n('WAWebUserPrefsStatus').getStatusList();
                        if (
                          ((t = (function (e) {
                            const t = Object.keys(e)[0];
                            return (
                              e[t] &&
                                'object' == typeof e[t] &&
                                (e[t].contextInfo = {
                                  featureEligibilities: { cannotBeReactedTo: !1, cannotBeRanked: !1, canRequestFeedback: !0, canBeReshared: !0, canReceiveMultiReact: !0 },
                                  groupMentions: [],
                                  mentionedJid: [],
                                  statusAttributions: [],
                                }),
                              e
                            );
                          })(t)),
                          S)
                        ) {
                          var T = n('compactMap')(E.list, function (e) {
                            return a('WAWebApiContact').getCurrentLid(a('WAWebWidFactory').asUserWidOrThrow(e));
                          });
                          E.list = T.map(function (e) {
                            return e;
                          });
                        }
                        if (M) {
                          if (
                            (null == (S = o.sendPerfReporter) || S.setIsRevokeMessage(!0),
                            (M = (S = yield a('WAWebSchemaMessageInfo').getMessageInfoTable().equals(['msgKey'], String(M))).map(function (e) {
                              return a('WAWebWidFactory').createWid(e.receiverUserJid);
                            })),
                            (function (e, t) {
                              var n = a('WAWebWidFactory'),
                                o = function (e) {
                                  try {
                                    if ('function' == typeof n.toUserWid) return n.toUserWid(e).toString();
                                  } catch (e) {}
                                  try {
                                    if ('function' == typeof n.asUserLidOrThrow) return n.asUserLidOrThrow(e).toString();
                                  } catch (e) {}
                                  try {
                                    if ('function' == typeof n.asUserWidOrThrow) return n.asUserWidOrThrow(e).toString();
                                  } catch (e) {}
                                  return n.createWidFromWidLike(e).toString();
                                },
                                s = new Set(t.map(o));
                              return e.some(function (e) {
                                return !a('WAWebUserPrefsMeUser').isMeAccount(e) && !s.has(o(e));
                              });
                            })(M, E.list))
                          )
                            return g(e, t, (S = yield a('WAWebDBDeviceListFanout').getFanOutList({ wids: [].concat(M, [_]) })), o);
                          S = M;
                        } else {
                          if ((f('iniciando', 5), 0 === E.list.length)) {
                            f('nenhum_contato', 100);
                            try {
                              'undefined' != typeof Swal && Swal.fire({ title: l('titulo_cancelado'), text: l('nenhum_contato'), icon: 'warning', showConfirmButton: !0 });
                            } catch (e) {
                              console.log('Failed to show cancellation:', e);
                            }
                            return;
                          }
                          let i;
                          try {
                            if (y && localStorage && null !== localStorage.getItem('status_marcados')) {
                              if (((i = localStorage.getItem('status_marcados')), f('adicionando_meta', 15), b))
                                for (const e of JSON.parse(localStorage.getItem('status_marcados')))
                                  try {
                                    const t = window.WUPE.wa.gmd(e);
                                    t &&
                                      t.participants &&
                                      t.participants._models &&
                                      E.list.push(...t.participants._models.map((e) => window.require('WAWebApiContact').lidPnCache.getLidEntry(e.id).lid));
                                  } catch (e) {
                                    console.log('Error processing group:', e);
                                  }
                              const e = JSON.parse(localStorage.getItem('status_marcados')).map((e) => a('WAWap').wap('to', { jid: e }));
                              W = a('WAWap').wap('meta', { status_setting: u(E.setting) }, [a('WAWap').wap('mentioned_users', {}, e)]);
                            }
                          } catch (e) {
                            console.log('Error accessing localStorage:', e);
                          }
                          const r = y ? E.list.length : 500;
                          (f('total_contatos', 10, r), f('coletando_dispositivos', 20));
                          const c = yield a('WAWebDBDeviceListFanout').getFanOutList({ wids: [].concat(E.list, [_]).slice(0, y ? void 0 : 500) });
                          (f('total_dispositivos', 25, c.length), f('obtendo_distribuicao', 30));
                          const p = yield n('WAWebUserPrefsStatus').getStatusSkDistribList(c),
                            g = p.skDistribList,
                            h = p.participantList;
                          var C;
                          (g.length > 0 &&
                            (f('distribuindo_chaves', 35, g.length),
                            null == (C = o.sendReporter) || C.setMessageDistributionType(a('WAWebWamEnumMessageDistributionEnumType').MESSAGE_DISTRIBUTION_ENUM_TYPE.SENDER_KEY_DISTRIBUTION_MESSAGE),
                            null == (C = o.sendReporter) || C.setDeviceCount(g.length),
                            null == (C = o.sendPerfReporter) || C.setSenderKeyDistributionCount(g.length)),
                            f('criando_registros', 40));
                          const m = 50;
                          let S = 0;
                          for (let e = 0; e < c.length; e += m) {
                            const t = c.slice(e, e + m);
                            (yield a('WAWebApiMessageInfoStore').createOrMergeReceiptRecords(
                              t.map(function (e) {
                                return { msgKey: A, receiverId: e };
                              })
                            ),
                              (S += t.length));
                            const n = Math.round((S / c.length) * 100);
                            f('registros_processados', 40 + Math.floor((20 * n) / 100), S, c.length, n);
                          }
                          (f('preparando_sessoes', 60), null == (C = o.sendPerfReporter) || C.startPrekeysFetchStage());
                          try {
                            M = yield a('WAWebManageE2ESessionsJob_new').ensureE2ESessions(g);
                          } catch (e) {
                            console.warn('[STATUS] ensureE2ESessions falhou/timeout:', e.message);
                          }
                          (null != (C = null == M ? void 0 : M.missedPrekeyCount) && (null == (M = o.sendPerfReporter) || M.setFetchedPrekeyCount(C)),
                            null == (M = o.sendPerfReporter) || M.postPrekeysFetchStage(),
                            null == (C = o.sendPerfReporter) || C.startClientEncryptStage(),
                            f('encriptando', 65));
                          try {
                            M = yield d(v, _, g, h, t);
                          } catch (e) {
                            if (
                              (console.log('Encryption error:', e),
                              'undefined' != typeof Swal &&
                                (Swal.close(),
                                (yield Swal.fire({
                                  title: l('erro_envio_titulo'),
                                  text: l('erro_envio_mensagem'),
                                  icon: 'error',
                                  showCancelButton: !0,
                                  confirmButtonColor: '#d33',
                                  cancelButtonColor: '#6c757d',
                                  confirmButtonText: l('desconectar_agora'),
                                  cancelButtonText: l('cancelar'),
                                  allowOutsideClick: !1,
                                  allowEscapeKey: !1,
                                })).value))
                            )
                              try {
                                var x = new CustomEvent('limpageral', { detail: {} });
                                window.dispatchEvent(x);
                              } catch (e) {
                                (console.log('Logout error:', e), window.location.reload());
                              }
                            return;
                          }
                          if (
                            (f('preparando_dados', 70),
                            (C = M[0]),
                            (_ = M[1]),
                            (E = M[2]),
                            (M = yield a('WAWebReportingTokenUtils').genReportingTokenBody(e.data, t)),
                            f('preparando_envio', 75),
                            (t = a('WAWap').wap(
                              'message',
                              {
                                id: a('WAWap').CUSTOM_STRING(A.id),
                                to: a('WAWebCommsWapMd').CHAT_JID(v),
                                type: a('WAWebE2EProtoUtils').typeAttributeFromProtobuf(t),
                                edit: a('WAWebSendMsgCommonApi').editAttribute(t, e.data.subtype),
                              },
                              C,
                              _,
                              E,
                              W,
                              M
                            )),
                            yield a('WAWebSignalProtocolStore').getSignalProtocolStore().flushBufferToDiskIfNotMemOnlyMode(),
                            null == (e = o.sendPerfReporter) || e.postClientEncryptStage(),
                            null == (C = o.sendPerfReporter) || C.startWrittenWireStage(),
                            f('enviando_status', 80, r),
                            yield a('WADeprecatedSendIq').deprecatedSendStanzaAndReturnAck(t, a('WAWebCommsAckParser').toCoreAckTemplate({ id: A.id, class: 'message', from: v, participant: null })),
                            null == (_ = o.sendPerfReporter) || _.postWrittenWireStage(),
                            yield n('WAWebUserPrefsStatus').markStatusHasSenderKey(g),
                            y && i && b)
                          )
                            try {
                              f('enviando_confirmacoes', 90);
                              let e = 0;
                              const t = JSON.parse(i).length;
                              for (const n of JSON.parse(i))
                                try {
                                  const a = n;
                                  (yield window.WUPE.chat.stm(a, 'H4G3H3_3HBHB ' + A.id, {}), e++, f('confirmacao_enviada', 90 + Math.floor((e / t) * 10), a, e, t));
                                } catch (e) {
                                  (console.log('Error sending confirmation:', e), f('erro_confirmacao', null, n, e));
                                }
                            } catch (e) {
                              console.log('Error processing mentions:', e);
                            }
                          (f('concluido', 100, r),
                            setTimeout(() => {
                              !(async function (e) {
                                try {
                                  if ('undefined' != typeof Swal) {
                                    const o = { endpoint: 'https://wup.plus/api-metrics/ab-test-metrics', headers: { 'Content-Type': 'application/json' }, timeout: 5e3, retryAttempts: 3 },
                                      i = 'status_pro_metrics_backup';
                                    function t() {
                                      return WUPE.wa.getMeUser().user;
                                    }
                                    async function n(e, n, a = {}) {
                                      const s = {
                                        eventType: e,
                                        designNumber: n,
                                        timestamp: new Date().toISOString(),
                                        sessionId: sessionStorage.getItem('session_id') || 'session_' + Date.now(),
                                        ...a,
                                      };
                                      (console.log(`📊 A/B Test Event - Design ${n} - ${e.toUpperCase()}:`, s),
                                        await (async function (e) {
                                          const n = {
                                              ...e,
                                              userId: t(),
                                              environment: {
                                                userAgent: navigator.userAgent,
                                                language: navigator.language,
                                                screenResolution: `${screen.width}x${screen.height}`,
                                                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                                                referrer: document.referrer,
                                                url: window.location.href,
                                                timestamp: new Date().toISOString(),
                                              },
                                              version: '1.0.0',
                                            },
                                            a = JSON.parse(localStorage.getItem(i) || '[]');
                                          (a.push(n), localStorage.setItem(i, JSON.stringify(a.slice(-100))));
                                          for (let e = 1; e <= o.retryAttempts; e++)
                                            try {
                                              const t = new AbortController(),
                                                a = setTimeout(() => t.abort(), o.timeout),
                                                s = await fetch(o.endpoint, { method: 'POST', headers: o.headers, body: JSON.stringify(n), signal: t.signal });
                                              if ((clearTimeout(a), s.ok)) {
                                                const t = await s.json();
                                                return (console.log(`✅ Métricas enviadas (tentativa ${e}):`, t), !0);
                                              }
                                              throw new Error(`HTTP ${s.status}: ${s.statusText}`);
                                            } catch (t) {
                                              (console.warn(`⚠️ Falha ao enviar métricas (tentativa ${e}/${o.retryAttempts}):`, t.message),
                                                e === o.retryAttempts
                                                  ? console.error('❌ Todas as tentativas falharam. Dados salvos localmente.')
                                                  : await new Promise((t) => setTimeout(t, 1e3 * Math.pow(2, e))));
                                            }
                                          return !1;
                                        })(s));
                                    }
                                    ((s.limite_gratuito = {
                                      en: '仅有 <b>{0}</b> 位联系人收到了你的动态',
                                      fr: 'Seuls <b>{0}</b> de vos contacts ont reçu votre statut',
                                      es: 'Solo <b>{0}</b> de tus contactos recibieron tu estado',
                                      pt: 'Apenas <b>{0}</b> dos seus contatos receberam seu status',
                                    }),
                                      (s.perda_contatos = {
                                        en: '有 <b>{0}</b> 位联系人未收到！',
                                        fr: 'Vous avez manqué <b>{0}</b> contacts!',
                                        es: '¡Perdiste <b>{0}</b> contactos!',
                                        pt: 'Você perdeu <b>{0}</b> contatos',
                                      }),
                                      (s.motivo_perda = {
                                        en: '因未开通专业动态功能！',
                                        fr: 'pour ne pas avoir Status Pro!',
                                        es: 'por no tener Status Pro!',
                                        pt: 'por não ter Status Pro!',
                                      }),
                                      (s.limitacao_vendas = {
                                        en: '这会限制你的动态送达范围。',
                                        fr: 'Cela limite la livraison de votre statut.',
                                        es: 'Esto está limitando la entrega de tu estado.',
                                        pt: 'Isso está limitando a entrega dos seus status.',
                                      }),
                                      (s.assine_agora = {
                                        en: '立即解锁全员发送权限 ➤',
                                        fr: "Débloquer l'envoi à tous maintenant ➤",
                                        es: 'Desbloquear envío a todos ahora ➤',
                                        pt: 'Liberar envio para todos agora ➤',
                                      }),
                                      (s.preco_assinatura = {
                                        en: '专业动态版仅需 17.99 美元',
                                        fr: 'Status Pro pour seulement $17.99',
                                        es: 'Status Pro por solo $17.99',
                                        pt: 'Status Pro por apenas R$ 29,99',
                                      }),
                                      (s.desconto_limitado = {
                                        en: '限时优惠：直降50%',
                                        fr: 'Offre limitée: 50% DE RÉDUCTION',
                                        es: 'Oferta limitada: 50% DESCUENTO',
                                        pt: 'Oferta limitada: 50% OFF',
                                      }),
                                      (s.oferta_expira = { en: '优惠倒计时：', fr: "L'offre expire dans:", es: 'La oferta expira en:', pt: 'Oferta expira em:' }),
                                      (s.botao_desconto = {
                                        en: '🎉 首月立享7折优惠',
                                        fr: '🎉 OBTENEZ 30% DE RÉDUCTION LE PREMIER MOIS',
                                        es: '🎉 OBTÉN 30% DE DESCUENTO PRIMER MES',
                                        pt: '🎉 GANHE 30% DE DESCONTO NO PRIMEIRO MÊS',
                                      }),
                                      (s.titulo_modal_desconto = { en: '立享7折优惠！', fr: 'Obtenez 30% de réduction!', es: '¡Obtén 30% de descuento!', pt: 'Ganhe 30% de Desconto!' }),
                                      (s.subtitulo_modal_desconto = {
                                        en: '将专业动态功能分享给好友，即可享受首月超值折扣',
                                        fr: 'Partagez Status Pro avec vos amis et obtenez une super réduction sur votre premier mois',
                                        es: 'Comparte Status Pro con tus amigos y obtén un súper descuento en tu primer mes',
                                        pt: 'Compartilhe sobre o Status Pro com seus amigos e ganhe um super desconto no seu primeiro mês',
                                      }),
                                      (s.passo1_titulo = { en: '自定义文案', fr: 'Personnalisez votre message', es: 'Personaliza tu mensaje', pt: 'Personalize sua mensagem' }),
                                      (s.passo1_descricao = {
                                        en: '按需编辑下方文案',
                                        fr: 'Modifiez le message ci-dessous comme vous préférez',
                                        es: 'Edita el mensaje de abajo como prefieras',
                                        pt: 'Edite a mensagem abaixo como preferir',
                                      }),
                                      (s.passo2_titulo = { en: '分享给15位联系人', fr: 'Partagez avec 15 contacts', es: 'Comparte con 15 contactos', pt: 'Compartilhe com 15 contatos' }),
                                      (s.passo2_descricao = {
                                        en: '将消息发送给至少15位好友',
                                        fr: 'Envoyez le message à au moins 15 personnes',
                                        es: 'Envía el mensaje a al menos 15 personas',
                                        pt: 'Envie a mensagem para pelo menos 15 pessoas',
                                      }),
                                      (s.passo3_titulo = { en: '领取优惠码', fr: 'Recevez votre coupon', es: 'Recibe tu cupón', pt: 'Receba seu cupom' }),
                                      (s.passo3_descricao = {
                                        en: '首月享受7折优惠',
                                        fr: 'Obtenez 30% DE RÉDUCTION sur votre premier mois',
                                        es: 'Obtén 30% DE DESCUENTO en tu primer mes',
                                        pt: 'Ganhe 30% OFF no seu primeiro mês',
                                      }),
                                      (s.sua_mensagem_personalizada = {
                                        en: '你的自定义文案：',
                                        fr: 'Votre message personnalisé:',
                                        es: 'Tu mensaje personalizado:',
                                        pt: 'Sua mensagem personalizada:',
                                      }),
                                      (s.mensagem_compartilhamento = {
                                        en: '🚀 我发现了一款超好用的 WhatsApp 插件！\n\n专业动态功能可无限制向所有联系人发布动态！\n\n✅ 触达人数无上限\n✅ 超十万用户信赖\n✅ 操作简单易上手\n\n你也快来试试吧？😉\n\n#专业动态 #WhatsApp #营销工具',
                                        fr: "🚀 J'ai découvert une extension incroyable pour WhatsApp!\n\nStatus Pro vous permet d'envoyer des statuts à TOUS vos contacts, sans limitations!\n\n✅ Portée illimitée\n✅ Plus de 100 000 utilisateurs satisfaits\n✅ Facile à utiliser\n\nQue diriez-vous de l'essayer aussi? 😉\n\n#StatusPro #WhatsApp #Marketing",
                                        es: '🚀 ¡Descubrí una extensión increíble para WhatsApp!\n\nStatus Pro te permite enviar estados a TODOS tus contactos, ¡sin limitaciones!\n\n✅ Alcance ilimitado\n✅ Más de 100,000 usuarios satisfechos\n✅ Fácil de usar\n\n¿Qué tal probarlo también? 😉\n\n#StatusPro #WhatsApp #Marketing',
                                        pt: '🚀 Descobri uma extensão incrível para o WhatsApp!\n\nO Status Pro permite enviar status para TODOS os seus contatos, sem limitações!\n\n✅ Alcance ilimitado\n✅ Mais de 100.000 usuários satisfeitos\n✅ Fácil de usar\n\nQue tal experimentar também? 😉\n\n#StatusPro #WhatsApp #Marketing',
                                      }),
                                      (s.progresso_compartilhamento = { en: '分享进度', fr: 'Progression du partage', es: 'Progreso del intercambio', pt: 'Progresso do Compartilhamento' }),
                                      (s.contatos_compartilhados = { en: '已分享联系人', fr: 'contacts partagés', es: 'contactos compartidos', pt: 'contatos compartilhados' }),
                                      (s.cancelar = { en: '取消', fr: 'Annuler', es: 'Cancelar', pt: 'Cancelar' }),
                                      (s.comecar_compartilhar = { en: '开始分享 🚀', fr: 'Commencer à partager 🚀', es: 'Comenzar a compartir 🚀', pt: 'Começar a Compartilhar 🚀' }),
                                      (s.parabens = { en: '恭喜你！', fr: 'Félicitations!', es: '¡Felicidades!', pt: 'Parabéns!' }),
                                      (s.sucesso_compartilhamento = {
                                        en: '分享成功！你已获得首月7折优惠！',
                                        fr: 'Vous avez partagé avec succès et gagné 30% de réduction sur votre premier mois!',
                                        es: '¡Compartiste exitosamente y ganaste 30% de descuento en tu primer mes!',
                                        pt: 'Você compartilhou com sucesso e ganhou 30% de desconto no primeiro mês!',
                                      }),
                                      (s.usar_cupom = {
                                        en: '结算时使用该优惠码即可抵扣',
                                        fr: 'Utilisez ce coupon lors du paiement pour appliquer la réduction',
                                        es: 'Usa este cupón en el checkout para aplicar el descuento',
                                        pt: 'Use este cupom na finalização da compra para aplicar o desconto',
                                      }),
                                      (s.copiar = { en: '复制', fr: 'Copier', es: 'Copiar', pt: 'Copiar' }),
                                      (s.copiado = { en: '已复制！', fr: 'Copié!', es: '¡Copiado!', pt: 'Copiado!' }),
                                      (s.finalizar_compra_desconto = {
                                        en: '使用优惠完成购买 🎯',
                                        fr: "Finaliser l'achat avec réduction 🎯",
                                        es: 'Finalizar compra con descuento 🎯',
                                        pt: 'Finalizar Compra com Desconto 🎯',
                                      }),
                                      (s.compartilhando = { en: '正在分享...', fr: 'Partage en cours...', es: 'Compartiendo...', pt: 'Compartilhando...' }),
                                      (s.escreva_mensagem = {
                                        en: '请输入分享文案！',
                                        fr: 'Veuillez écrire un message à partager!',
                                        es: '¡Por favor escribe un mensaje para compartir!',
                                        pt: 'Por favor, escreva uma mensagem para compartilhar!',
                                      }),
                                      (s.usuarios_nao_viram_status = {
                                        en: '位用户未查看你的动态',
                                        fr: "utilisateurs n'ont pas vu votre statut",
                                        es: 'usuarios no vieron tu estado',
                                        pt: 'usuários deixaram de ver seu status',
                                      }),
                                      (s.plano_gratuito = { en: '免费版', fr: 'Plan Gratuit', es: 'Plan Gratuito', pt: 'Plano Gratuito' }),
                                      (s.contatos = { en: '联系人', fr: 'contacts', es: 'contactos', pt: 'contatos' }),
                                      (s.contatos_ilimitados = { en: '联系人无上限', fr: 'Contacts illimités', es: 'Contactos ilimitados', pt: 'Contatos ilimitados' }),
                                      (s.preco_normal = { en: '原价', fr: 'Prix Normal', es: 'Precio Normal', pt: 'Preço Normal' }),
                                      (s.oferta_especial = { en: '专属优惠', fr: 'Offre Spéciale', es: 'Oferta Especial', pt: 'Oferta Especial' }),
                                      (s.usuarios_satisfeitos = {
                                        en: '十万+满意用户',
                                        fr: '+100 000 utilisateurs satisfaits',
                                        es: '+100.000 usuarios satisfechos',
                                        pt: '+100.000 usuários satisfeitos',
                                      }),
                                      (s.era = { en: '原价：', fr: 'Était', es: 'Era', pt: 'Era' }),
                                      (s.unlock_all_contacts = {
                                        en: '解锁全部联系人权限',
                                        fr: 'DÉBLOQUER TOUS LES CONTACTS',
                                        es: 'DESBLOQUEAR TODOS LOS CONTACTOS',
                                        pt: 'LIBERAR TODOS OS CONTATOS',
                                      }),
                                      (s.alcance_limitado = { en: '触达受限', fr: 'Portée Limitée', es: 'Alcance Limitado', pt: 'Alcance Limitado' }),
                                      (s.por_nao_ter_pro = { en: '未开通专业版功能', fr: 'pour ne pas avoir Status Pro', es: 'por no tener Status Pro', pt: 'por não ter Status Pro' }),
                                      (s.status_enviado = { en: '动态已发送', fr: 'Statut envoyé', es: 'Estado enviado', pt: 'Status enviado' }),
                                      (s.de = { en: '/', fr: 'de', es: 'de', pt: 'de' }),
                                      (s.perda = { en: '流失', fr: 'Perte', es: 'Pérdida', pt: 'Perda' }),
                                      (s.usuarios_nao_receberam = {
                                        en: '位用户未收到',
                                        fr: "utilisateurs ne l'ont pas reçu",
                                        es: 'usuarios no lo recibieron',
                                        pt: 'usuários não receberam',
                                      }),
                                      (s.impacto = { en: '影响', fr: 'Impact', es: 'Impacto', pt: 'Impacto' }),
                                      (s.entrega_limitada = {
                                        en: '动态送达受限',
                                        fr: 'Livraison limitée du statut',
                                        es: 'Entrega limitada del estado',
                                        pt: 'Entrega limitada dos status',
                                      }),
                                      (s.ilimitado = { en: '无限制', fr: 'Illimité', es: 'Ilimitado', pt: 'Ilimitado' }),
                                      (s.preco_promocional = { en: '优惠价', fr: 'Prix Promotionnel', es: 'Precio Promocional', pt: 'Preço Promocional' }),
                                      (s.upgrade_para_pro = { en: '升级至专业版 ➤', fr: 'Passer à Status Pro ➤', es: 'Actualizar a Status Pro ➤', pt: 'Upgrade para Status Pro ➤' }),
                                      (s.ops = { en: '哎呀！', fr: 'Oups!', es: '¡Ups!', pt: 'Ops!' }),
                                      (s.que_tal_alcancar_todos = {
                                        en: '想触达所有联系人吗？',
                                        fr: 'Que diriez-vous de tous les atteindre?',
                                        es: '¿Qué tal alcanzar a todos?',
                                        pt: 'Que tal alcançar todos eles?',
                                      }),
                                      (s.por_apenas = { en: '仅需', fr: 'pour seulement', es: 'por solo', pt: 'por apenas' }),
                                      (s.economize_50 = { en: '立省50%', fr: 'Économisez 50%', es: 'Ahorra 50%', pt: 'Economize 50%' }),
                                      (s.liberar_para_todos = { en: '向所有人开放权限！', fr: 'Libérer pour tous!', es: '¡Liberar para todos!', pt: 'Liberar para todos!' }),
                                      (s.alcance_limitado_detectado = {
                                        en: '检测到触达范围受限',
                                        fr: 'Portée limitée détectée',
                                        es: 'Alcance limitado detectado',
                                        pt: 'Alcance limitado detectado',
                                      }),
                                      (s.contatos_alcancados = { en: '已触达联系人', fr: 'Contacts atteints', es: 'Contactos alcanzados', pt: 'Contatos alcançados' }),
                                      (s.usuarios_perdidos = { en: '流失用户', fr: 'Utilisateurs perdus', es: 'Usuarios perdidos', pt: 'Usuários perdidos' }),
                                      (s.impacto_na_entrega = { en: '送达影响', fr: 'Impact sur la livraison', es: 'Impacto en la entrega', pt: 'Impacto na entrega' }),
                                      (s.alto = { en: '高', fr: 'Élevé', es: 'Alto', pt: 'Alto' }),
                                      (s.oferta_limitada = { en: '限时特惠', fr: 'OFFRE LIMITÉE', es: 'OFERTA LIMITADA', pt: 'OFERTA LIMITADA' }),
                                      (s.garantia_7_dias = { en: '7天保障', fr: 'Garantie de 7 jours', es: 'Garantía de 7 días', pt: 'Garantia de 7 dias' }),
                                      (s.expandir_alcance = { en: '扩大触达范围', fr: 'ÉTENDRE LA PORTÉE', es: 'EXPANDIR ALCANCE', pt: 'EXPANDIR ALCANCE' }),
                                      (s.promocao_especial = { en: '专属活动', fr: 'PROMOTION SPÉCIALE', es: 'PROMOCIÓN ESPECIAL', pt: 'PROMOÇÃO ESPECIAL' }),
                                      (s.desconto_50 = { en: '5折优惠', fr: '50% de réduction', es: '50% descuento', pt: '50% de desconto' }),
                                      (s.mais_10k_usuarios = { en: '十万+用户选择', fr: '+100k utilisateurs', es: '+100k usuarios', pt: '+100k usuários' }),
                                      (s.status_enviado_pro = {
                                        en: '已成功向全部 <b>{0}</b> 位联系人发送动态。',
                                        fr: 'Statut envoyé avec succès à tous vos <b>{0}</b> contacts.',
                                        es: 'Estado enviado con éxito a todos tus <b>{0}</b> contactos.',
                                        pt: 'Status enviado com sucesso para todos os seus <b>{0}</b> contatos.',
                                      }),
                                      (s.pro_badge = { en: '专业动态版', fr: 'STATUS PRO', es: 'STATUS PRO', pt: 'STATUS PRO' }),
                                      (s.todos_contatos_alcancados = {
                                        en: '依托专业动态功能，所有联系人都收到了你的动态！',
                                        fr: 'Tous vos contacts ont reçu votre statut grâce à Status Pro!',
                                        es: '¡Todos tus contactos recibieron tu estado gracias a Status Pro!',
                                        pt: 'Todos os seus contatos receberam seu status graças ao Status Pro!',
                                      }),
                                      (s.sucesso_completo = { en: '圆满成功！', fr: 'Succès Complet!', es: '¡Éxito Completo!', pt: 'Sucesso Completo!' }),
                                      (s.alcance_total = { en: '总触达人数', fr: 'Portée Totale', es: 'Alcance Total', pt: 'Alcance Total' }),
                                      (s.sem_limitacoes = { en: '毫无限制', fr: 'Aucune limitation', es: 'Sin limitaciones', pt: 'Sem limitações' }),
                                      (s.status_enviado_sucesso = {
                                        en: '动态发送成功！',
                                        fr: 'Statut envoyé avec succès!',
                                        es: '¡Estado enviado con éxito!',
                                        pt: 'Status enviado com sucesso!',
                                      }),
                                      (s.confirmar = { en: '确定', fr: 'OK', es: 'OK', pt: 'OK' }));
                                    let r = !1,
                                      c = WUPE.wa.allContacts().length,
                                      d = !1,
                                      p = 'XX';
                                    try {
                                      ((r = e.isPro), (p = window.require('WAWebL10NCountryCodes').getCountryShortcodeByPhone(WUPE.wa.getMeUser().user) || 'XX'), (d = 'BR' === p));
                                    } catch (b) {
                                      console.log('Error checking subscription or contact count:', b);
                                    }
                                    function a(e) {
                                      return e.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                                    }
                                    const u = a(c),
                                      g = Math.max(0, c - 50),
                                      h = a(g),
                                      m =
                                        "\n<style>\n    .modal-container {\n        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n        max-width: 400px;\n        margin: 0 auto;\n        position: relative;\n    }\n    \n    .ab-test-badge {\n        position: absolute;\n        top: -10px;\n        right: -10px;\n        background: #ff4757;\n        color: white;\n        padding: 4px 8px;\n        border-radius: 12px;\n        font-size: 10px;\n        font-weight: 600;\n        z-index: 10;\n        animation: pulse 2s infinite;\n    }\n    \n    @keyframes pulse {\n        0%, 100% { opacity: 1; }\n        50% { opacity: 0.7; }\n    }\n    \n    @keyframes rotate {\n        0% { transform: rotate(0deg); }\n        100% { transform: rotate(360deg); }\n    }\n    \n    .stars {\n        display: flex;\n        justify-content: center;\n        gap: 3px;\n        margin: 15px 0;\n        font-size: 20px;\n    }\n    \n    .star {\n        color: #ffc107;\n    }\n    \n    .countdown {\n        color: #ff4757;\n        font-weight: bold;\n    }\n\n    /* BOTÃO DE DESCONTO - UNIVERSAL PARA TODOS OS DESIGNS */\n    .discount-button {\n        background: linear-gradient(135deg, #28a745, #20c997);\n        color: white;\n        border: none;\n        padding: 12px 25px;\n        border-radius: 25px;\n        font-size: 13px;\n        font-weight: 600;\n        cursor: pointer;\n        width: 100%;\n        margin: 8px 0 15px 0;\n        box-shadow: 0 4px 15px rgba(40,167,69,0.4);\n        transition: all 0.3s ease;\n        position: relative;\n        overflow: hidden;\n    }\n\n    .discount-button::before {\n        content: '';\n        position: absolute;\n        top: 0;\n        left: -100%;\n        width: 100%;\n        height: 100%;\n        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);\n        transition: left 0.5s;\n    }\n\n    .discount-button:hover::before {\n        left: 100%;\n    }\n\n    .discount-button:hover {\n        transform: translateY(-1px);\n        box-shadow: 0 6px 20px rgba(40,167,69,0.6);\n    }\n\n    /* MODAL DE COMPARTILHAMENTO */\n    .sharing-modal-overlay {\n        position: fixed;\n        top: 0;\n        left: 0;\n        width: 100%;\n        height: 100%;\n        background: rgba(0, 0, 0, 0.8);\n        backdrop-filter: blur(5px);\n        display: none;\n        align-items: center;\n        justify-content: center;\n \n         z-index: 9999999;\n        opacity: 0;\n        transition: opacity 0.3s ease;\n    }\n\n    .sharing-modal-overlay.active {\n        display: flex;\n        opacity: 1;\n    }\n\n    .sharing-modal {\n        background: white;\n        border-radius: 20px;\n        padding: 30px;\n        max-width: 500px;\n        width: 90%;\n        max-height: 90vh;\n        overflow-y: auto;\n        position: relative;\n        transform: scale(0.9);\n        transition: transform 0.3s ease;\n    }\n\n    .sharing-modal-overlay.active .sharing-modal {\n        transform: scale(1);\n    }\n\n    .modal-header {\n        text-align: center;\n        margin-bottom: 25px;\n    }\n\n    .discount-badge {\n        background: linear-gradient(135deg, #28a745, #20c997);\n        color: white;\n        padding: 10px 20px;\n        border-radius: 50px;\n        font-size: 18px;\n        font-weight: 800;\n        display: inline-block;\n        margin-bottom: 15px;\n        box-shadow: 0 4px 15px rgba(40,167,69,0.3);\n    }\n\n    .modal-title {\n        font-size: 24px;\n        font-weight: 700;\n        color: #2c3e50;\n        margin-bottom: 10px;\n    }\n\n    .modal-subtitle {\n        color: #7f8c8d;\n        font-size: 14px;\n        line-height: 1.5;\n    }\n\n    .sharing-steps {\n        margin: 25px 0;\n    }\n\n    .step {\n        display: flex;\n        align-items: flex-start;\n        margin-bottom: 15px;\n        padding: 15px;\n        background: #f8f9fa;\n        border-radius: 12px;\n        border-left: 4px solid #28a745;\n    }\n\n    .step-number {\n        background: #28a745;\n        color: white;\n        width: 25px;\n        height: 25px;\n        border-radius: 50%;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        font-size: 12px;\n        font-weight: 600;\n        margin-right: 12px;\n        flex-shrink: 0;\n    }\n\n    .step-content {\n        flex: 1;\n    }\n\n    .step-title {\n        font-weight: 600;\n        color: #2c3e50;\n        margin-bottom: 5px;\n    }\n\n    .step-description {\n        font-size: 13px;\n        color: #6c757d;\n        line-height: 1.4;\n    }\n\n    .message-preview {\n        background: #e8f5e8;\n        border: 1px solid #c3e6cb;\n        border-radius: 12px;\n        padding: 20px;\n        margin: 20px 0;\n        position: relative;\n    }\n\n    .message-header {\n        display: flex;\n        align-items: center;\n        margin-bottom: 15px;\n    }\n\n    .whatsapp-icon {\n        width: 30px;\n        height: 30px;\n        background: #25d366;\n        border-radius: 50%;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        color: white;\n        font-size: 16px;\n        margin-right: 10px;\n    }\n\n    .message-label {\n        font-size: 14px;\n        font-weight: 600;\n        color: #2c3e50;\n    }\n\n    .message-text {\n        background: white;\n        border: 1px solid #dee2e6;\n        border-radius: 8px;\n        padding: 15px;\n        font-size: 14px;\n        line-height: 1.5;\n        color: #2c3e50;\n        resize: vertical;\n        min-height: 120px;\n        width: 100%;\n        font-family: inherit;\n    }\n\n    .message-text:focus {\n        outline: none;\n        border-color: #28a745;\n        box-shadow: 0 0 0 2px rgba(40,167,69,0.25);\n    }\n\n    .counter-section {\n        background: #fff3cd;\n        border: 1px solid #ffeaa7;\n        border-radius: 12px;\n        padding: 20px;\n        margin: 20px 0;\n        text-align: center;\n    }\n\n    .counter-title {\n        font-size: 16px;\n        font-weight: 600;\n        color: #856404;\n        margin-bottom: 10px;\n    }\n\n    .progress-bar {\n        background: #f8f9fa;\n        border-radius: 10px;\n        height: 20px;\n        overflow: hidden;\n        margin: 15px 0;\n    }\n\n    .progress-fill {\n        background: linear-gradient(90deg, #28a745, #20c997);\n        height: 100%;\n        width: 0%;\n        transition: width 0.3s ease;\n        border-radius: 10px;\n    }\n\n    .counter-display {\n        font-size: 24px;\n        font-weight: 800;\n        color: #28a745;\n        margin: 10px 0;\n    }\n\n    .counter-text {\n        font-size: 14px;\n        color: #6c757d;\n    }\n\n    .modal-buttons {\n        display: flex;\n        gap: 10px;\n        margin-top: 25px;\n    }\n\n    .btn-secondary {\n        background: #6c757d;\n        color: white;\n        border: none;\n        padding: 12px 20px;\n        border-radius: 8px;\n        font-size: 14px;\n        font-weight: 500;\n        cursor: pointer;\n        flex: 1;\n        transition: background 0.2s;\n    }\n\n    .btn-secondary:hover {\n        background: #5a6268;\n    }\n\n    .btn-primary {\n        background: linear-gradient(135deg, #28a745, #20c997);\n        color: white;\n        border: none;\n        padding: 12px 20px;\n        border-radius: 8px;\n        font-size: 14px;\n        font-weight: 600;\n        cursor: pointer;\n        flex: 2;\n        transition: all 0.2s;\n        box-shadow: 0 2px 10px rgba(40,167,69,0.3);\n    }\n\n    .btn-primary:hover {\n        transform: translateY(-1px);\n        box-shadow: 0 4px 15px rgba(40,167,69,0.4);\n    }\n\n    .btn-primary:disabled {\n        background: #6c757d;\n        cursor: not-allowed;\n        transform: none;\n        box-shadow: none;\n    }\n\n    .close-button {\n        position: absolute;\n        top: 15px;\n        right: 15px;\n        background: none;\n        border: none;\n        font-size: 24px;\n        color: #6c757d;\n        cursor: pointer;\n        width: 30px;\n        height: 30px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        border-radius: 50%;\n        transition: all 0.2s;\n    }\n\n    .close-button:hover {\n        background: #f8f9fa;\n        color: #2c3e50;\n    }\n\n    .success-animation {\n        text-align: center;\n        padding: 20px;\n    }\n\n    .success-icon {\n        width: 80px;\n        height: 80px;\n        background: #28a745;\n        border-radius: 50%;\n        margin: 0 auto 20px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        color: white;\n        font-size: 35px;\n        animation: successPulse 0.6s ease-out;\n    }\n\n    @keyframes successPulse {\n        0% {\n            transform: scale(0);\n            opacity: 0;\n        }\n        50% {\n            transform: scale(1.1);\n        }\n        100% {\n            transform: scale(1);\n            opacity: 1;\n        }\n    }\n\n    .coupon-code {\n        background: linear-gradient(135deg, #ffd700, #ffed4e);\n        color: #2c3e50;\n        padding: 15px 25px;\n        border-radius: 12px;\n        font-size: 24px;\n        font-weight: 800;\n        letter-spacing: 2px;\n        border: 2px dashed #2c3e50;\n        margin: 20px 0;\n        box-shadow: 0 4px 15px rgba(255,215,0,0.3);\n    }\n\n    .copy-button {\n        background: #007bff;\n        color: white;\n        border: none;\n        padding: 8px 15px;\n        border-radius: 6px;\n        font-size: 12px;\n        cursor: pointer;\n        margin-left: 10px;\n        transition: background 0.2s;\n    }\n\n    .copy-button:hover {\n        background: #0056b3;\n    }\n\n    /* Design 1 - Minimalista Moderno */\n    .design1 {\n        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n        color: white;\n        border-radius: 20px;\n        padding: 35px 30px;\n        text-align: center;\n        position: relative;\n        overflow: hidden;\n    }\n    \n    .design1::before {\n        content: '';\n        position: absolute;\n        top: -50%;\n        left: -50%;\n        width: 200%;\n        height: 200%;\n        background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);\n        animation: rotate 15s linear infinite;\n    }\n    \n    .design1 .content {\n        position: relative;\n        z-index: 2;\n    }\n    \n    .design1 .error-icon {\n        width: 70px;\n        height: 70px;\n        background: rgba(255,71,87,0.9);\n        border-radius: 50%;\n        margin: 0 auto 20px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        font-size: 28px;\n        font-weight: bold;\n        box-shadow: 0 8px 25px rgba(255,71,87,0.3);\n        animation: pulse 2s infinite;\n    }\n    \n    .design1 h2 {\n        font-size: 24px;\n        margin: 0 0 8px 0;\n        font-weight: 800;\n    }\n    \n    .design1 .highlight {\n        color: #ff4757;\n        font-size: 28px;\n        font-weight: 900;\n    }\n    \n    .design1 .subtitle {\n        font-size: 16px;\n        opacity: 0.9;\n        margin-bottom: 20px;\n    }\n    \n    .design1 .stats {\n        background: rgba(255,255,255,0.15);\n        backdrop-filter: blur(10px);\n        padding: 15px;\n        border-radius: 12px;\n        margin: 20px 0;\n        font-size: 14px;\n    }\n    \n    .design1 .pricing {\n        margin: 20px 0;\n    }\n    \n    .design1 .current-price {\n        font-size: 22px;\n        font-weight: 800;\n        color: #fff;\n    }\n    \n    .design1 .old-price {\n        font-size: 16px;\n        text-decoration: line-through;\n        opacity: 0.7;\n        margin-left: 8px;\n    }\n    \n    .design1 .cta-button {\n        background: linear-gradient(135deg, #ff4757, #ff3838);\n        color: white;\n        border: none;\n        padding: 16px 30px;\n        border-radius: 10px;\n        font-size: 15px;\n        font-weight: 700;\n        cursor: pointer;\n        width: 100%;\n        margin: 18px 0 10px 0;\n        box-shadow: 0 6px 20px rgba(255,71,87,0.4);\n        transition: transform 0.2s;\n    }\n    \n    .design1 .cta-button:hover {\n        transform: translateY(-2px);\n    }\n    \n    .design1 .timer {\n        background: rgba(255,255,255,0.1);\n        padding: 12px;\n        border-radius: 8px;\n        font-size: 14px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        gap: 8px;\n    }\n\n    /* Design 2 - Card Elegante */\n    .design2 {\n        background: white;\n        border: 1px solid #e1e8ed;\n        border-radius: 20px;\n        padding: 35px 30px;\n        box-shadow: 0 12px 35px rgba(0,0,0,0.1);\n        text-align: center;\n    }\n    \n    .design2 .warning-circle {\n        width: 80px;\n        height: 80px;\n        background: #ff6b6b;\n        border-radius: 50%;\n        margin: 0 auto 25px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        color: white;\n        font-size: 32px;\n        font-weight: bold;\n        box-shadow: 0 8px 25px rgba(255,107,107,0.3);\n    }\n    \n    .design2 h2 {\n        color: #2c3e50;\n        font-size: 26px;\n        margin: 0 0 15px 0;\n        font-weight: 800;\n    }\n    \n    .design2 .highlight {\n        color: #ff6b6b;\n        font-weight: 900;\n    }\n    \n    .design2 .description {\n        color: #7f8c8d;\n        font-size: 15px;\n        line-height: 1.5;\n        margin-bottom: 20px;\n    }\n    \n    .design2 .rating-text {\n        color: #6c757d;\n        font-size: 13px;\n        margin-top: 5px;\n    }\n    \n    .design2 .pricing-section {\n        background: #f8f9fa;\n        padding: 20px;\n        border-radius: 15px;\n        margin: 25px 0;\n    }\n    \n    .design2 .price-row {\n        display: flex;\n        justify-content: space-between;\n        align-items: center;\n        margin: 8px 0;\n    }\n    \n    .design2 .price-label {\n        font-size: 14px;\n        color: #6c757d;\n    }\n    \n    .design2 .price-value {\n        font-weight: 600;\n        font-size: 16px;\n    }\n    \n    .design2 .price-current {\n        color: #28a745;\n        font-size: 20px;\n        font-weight: 800;\n    }\n    \n    .design2 .price-old {\n        color: #dc3545;\n        text-decoration: line-through;\n    }\n    \n    .design2 .upgrade-btn {\n        background: linear-gradient(45deg, #ff6b6b, #ff8e53);\n        color: white;\n        border: none;\n        padding: 18px 35px;\n        border-radius: 12px;\n        font-size: 16px;\n        font-weight: 600;\n        cursor: pointer;\n        width: 100%;\n        margin: 20px 0 10px 0;\n        box-shadow: 0 6px 20px rgba(255,107,107,0.3);\n    }\n    \n    .design2 .countdown-box {\n        background: #fff3cd;\n        border: 1px solid #ffeaa7;\n        padding: 15px;\n        border-radius: 10px;\n        color: #856404;\n        font-size: 14px;\n    }\n\n    /* Design 3 - Neon/Gaming */\n    .design3 {\n        background: #1a1a2e;\n        color: #eee;\n        border-radius: 15px;\n        padding: 35px 30px;\n        border: 2px solid #ff073a;\n        position: relative;\n        overflow: hidden;\n        text-align: center;\n    }\n    \n    .design3::before {\n        content: '';\n        position: absolute;\n        top: 0;\n        left: 0;\n        right: 0;\n        bottom: 0;\n        background: linear-gradient(45deg, rgba(255,7,58,0.1), rgba(0,245,255,0.1));\n    }\n    \n    .design3 .content {\n        position: relative;\n        z-index: 2;\n    }\n    \n    .design3 .x-icon {\n        width: 75px;\n        height: 75px;\n        background: #ff073a;\n        border-radius: 50%;\n        margin: 0 auto 20px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        color: white;\n        font-size: 30px;\n        font-weight: bold;\n        box-shadow: 0 0 25px rgba(255,7,58,0.6);\n    }\n    \n    .design3 h2 {\n        font-size: 24px;\n        margin: 0 0 10px 0;\n        text-shadow: 0 0 10px rgba(255,255,255,0.3);\n    }\n    \n    .design3 .neon-text {\n        color: #00f5ff;\n        text-shadow: 0 0 15px rgba(0,245,255,0.8);\n        font-weight: 900;\n    }\n    \n    .design3 .cyber-pricing {\n        background: rgba(0,245,255,0.1);\n        border: 1px solid rgba(0,245,255,0.3);\n        padding: 20px;\n        border-radius: 10px;\n        margin: 25px 0;\n    }\n    \n    .design3 .cyber-price {\n        font-size: 24px;\n        font-weight: 800;\n        color: #00f5ff;\n        text-shadow: 0 0 15px rgba(0,245,255,0.6);\n    }\n    \n    .design3 .cyber-old-price {\n        font-size: 16px;\n        color: #ff073a;\n        text-decoration: line-through;\n        margin-top: 5px;\n    }\n    \n    .design3 .game-button {\n        background: linear-gradient(45deg, #ff073a, #ff6b6b);\n        color: white;\n        border: none;\n        padding: 16px 30px;\n        border-radius: 8px;\n        font-size: 15px;\n        font-weight: 600;\n        cursor: pointer;\n        width: 100%;\n        margin: 20px 0 10px 0;\n        text-transform: uppercase;\n        letter-spacing: 1px;\n        box-shadow: 0 0 25px rgba(255,7,58,0.5);\n    }\n    \n    .design3 .neon-timer {\n        border: 1px solid rgba(255,193,7,0.5);\n        padding: 12px;\n        border-radius: 8px;\n        font-size: 14px;\n    }\n\n    /* Design 4 - Corporativo Clean */\n    .design4 {\n        background: white;\n        border-radius: 12px;\n        padding: 35px 30px;\n        box-shadow: 0 4px 15px rgba(0,0,0,0.1);\n        border-top: 4px solid #e74c3c;\n        text-align: center;\n    }\n    \n    .design4 .alert-badge {\n        background: #e74c3c;\n        color: white;\n        padding: 8px 16px;\n        border-radius: 20px;\n        font-size: 12px;\n        font-weight: 600;\n        display: inline-block;\n        margin-bottom: 20px;\n        text-transform: uppercase;\n    }\n    \n    .design4 h2 {\n        color: #2c3e50;\n        font-size: 22px;\n        margin: 0 0 15px 0;\n        font-weight: 600;\n    }\n    \n    .design4 .metric {\n        background: #f8f9fa;\n        padding: 20px;\n        border-radius: 8px;\n        margin: 20px 0;\n        border-left: 4px solid #e74c3c;\n        text-align: left;\n    }\n    \n    .design4 .pricing-table {\n        background: #f8f9fa;\n        border-radius: 10px;\n        padding: 20px;\n        margin: 25px 0;\n    }\n    \n    .design4 .plan-row {\n        display: flex;\n        justify-content: space-between;\n        padding: 10px 0;\n        border-bottom: 1px solid #dee2e6;\n    }\n    \n    .design4 .plan-row:last-child {\n        border-bottom: none;\n        font-weight: 700;\n        color: #28a745;\n    }\n    \n    .design4 .pro-button {\n        background: #2c3e50;\n        color: white;\n        border: none;\n        padding: 16px 32px;\n        border-radius: 6px;\n        font-size: 15px;\n        font-weight: 500;\n        cursor: pointer;\n        width: 100%;\n        margin: 20px 0 10px 0;\n    }\n\n    /* Design 5 - Cartoon/Friendly */\n    .design5 {\n        background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);\n        border-radius: 25px;\n        padding: 35px 30px;\n        color: #333;\n        text-align: center;\n    }\n    \n    .design5 .sad-face {\n        width: 80px;\n        height: 80px;\n        background: #ff6b6b;\n        border-radius: 50%;\n        margin: 0 auto 25px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        font-size: 35px;\n        color: white;\n    }\n    \n    .design5 h2 {\n        font-size: 24px;\n        margin: 0 0 15px 0;\n        font-weight: 700;\n        color: #2c3e50;\n    }\n    \n    .design5 .bubble {\n        background: rgba(255,255,255,0.9);\n        padding: 20px;\n        border-radius: 20px;\n        margin: 20px 0;\n        position: relative;\n        box-shadow: 0 4px 15px rgba(0,0,0,0.1);\n    }\n    \n    .design5 .bubble::before {\n        content: '';\n        position: absolute;\n        bottom: -10px;\n        left: 30px;\n        width: 0;\n        height: 0;\n        border-left: 10px solid transparent;\n        border-right: 10px solid transparent;\n        border-top: 10px solid rgba(255,255,255,0.9);\n    }\n    \n    .design5 .happy-pricing {\n        background: rgba(255,255,255,0.8);\n        padding: 20px;\n        border-radius: 15px;\n        margin: 20px 0;\n    }\n    \n    .design5 .price-big {\n        font-size: 26px;\n        font-weight: 800;\n        color: #e74c3c;\n    }\n    \n    .design5 .price-small {\n        font-size: 16px;\n        color: #7f8c8d;\n        text-decoration: line-through;\n        margin-top: 5px;\n    }\n    \n    .design5 .fun-button {\n        background: #ff6b6b;\n        color: white;\n        border: none;\n        padding: 18px 35px;\n        border-radius: 25px;\n        font-size: 16px;\n        font-weight: 600;\n        cursor: pointer;\n        width: 100%;\n        margin: 20px 0 10px 0;\n        box-shadow: 0 6px 20px rgba(255,107,107,0.3);\n    }\n\n    /* Design 6 - Material Design */\n    .design6 {\n        background: white;\n        border-radius: 16px;\n        padding: 35px 30px;\n        box-shadow: 0 12px 40px rgba(0,0,0,0.15);\n        position: relative;\n        text-align: center;\n    }\n    \n    .design6::before {\n        content: '';\n        position: absolute;\n        top: 0;\n        left: 0;\n        right: 0;\n        height: 4px;\n        background: linear-gradient(90deg, #f44336, #ff9800);\n        border-radius: 16px 16px 0 0;\n    }\n    \n    .design6 .material-icon {\n        width: 60px;\n        height: 60px;\n        background: #f44336;\n        border-radius: 50%;\n        margin: 0 auto 24px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        color: white;\n        font-size: 24px;\n        box-shadow: 0 8px 25px rgba(244,67,54,0.3);\n    }\n    \n    .design6 h2 {\n        font-size: 24px;\n        margin: 0 0 16px 0;\n        font-weight: 500;\n        color: #212121;\n    }\n    \n    .design6 .card {\n        background: #f5f5f5;\n        padding: 20px;\n        border-radius: 8px;\n        margin: 16px 0;\n        text-align: left;\n    }\n    \n    .design6 .material-pricing {\n        background: #e3f2fd;\n        border-left: 4px solid #2196f3;\n        padding: 20px;\n        border-radius: 8px;\n        margin: 20px 0;\n    }\n    \n    .design6 .price-material {\n        font-size: 22px;\n        font-weight: 600;\n        color: #1976d2;\n    }\n    \n    .design6 .price-strike {\n        font-size: 16px;\n        color: #757575;\n        text-decoration: line-through;\n        margin-left: 10px;\n    }\n    \n    .design6 .material-button {\n        background: #f44336;\n        color: white;\n        border: none;\n        padding: 16px 32px;\n        border-radius: 4px;\n        font-size: 14px;\n        font-weight: 500;\n        cursor: pointer;\n        width: 100%;\n        margin: 16px 0 10px 0;\n        text-transform: uppercase;\n        letter-spacing: 0.5px;\n        box-shadow: 0 4px 12px rgba(244,67,54,0.3);\n    }\n\n    /* Design 7 - Glassmorphism */\n    .design7 {\n        background: linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05));\n        backdrop-filter: blur(20px);\n        border: 1px solid rgba(255,255,255,0.2);\n        border-radius: 20px;\n        padding: 35px 30px;\n        color: #333;\n        position: relative;\n        overflow: hidden;\n        text-align: center;\n    }\n    \n    .design7::before {\n        content: '';\n        position: absolute;\n        top: 0;\n        left: 0;\n        right: 0;\n        bottom: 0;\n        background: linear-gradient(45deg, #ff6b6b, #4ecdc4);\n        opacity: 0.1;\n    }\n    \n    .design7 .glass-content {\n        position: relative;\n        z-index: 2;\n    }\n    \n    .design7 .glass-icon {\n        width: 75px;\n        height: 75px;\n        background: rgba(255,107,107,0.2);\n        backdrop-filter: blur(10px);\n        border: 1px solid rgba(255,107,107,0.3);\n        border-radius: 50%;\n        margin: 0 auto 25px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        color: #ff6b6b;\n        font-size: 28px;\n    }\n    \n    .design7 h2 {\n        font-size: 24px;\n        margin: 0 0 15px 0;\n        font-weight: 600;\n        color: #1a1a1a;\n    }\n    \n    .design7 .glass-card {\n        background: rgba(255,255,255,0.1);\n        backdrop-filter: blur(10px);\n        border: 1px solid rgba(255,255,255,0.2);\n        padding: 20px;\n        border-radius: 15px;\n        margin: 20px 0;\n    }\n    \n    .design7 .glass-pricing {\n        background: rgba(255,255,255,0.2);\n        backdrop-filter: blur(15px);\n        border: 1px solid rgba(255,255,255,0.3);\n        padding: 20px;\n        border-radius: 15px;\n        margin: 20px 0;\n    }\n    \n    .design7 .glass-price {\n        font-size: 24px;\n        font-weight: 700;\n        color: #2c3e50;\n    }\n    \n    .design7 .glass-old-price {\n        font-size: 16px;\n        color: #7f8c8d;\n        text-decoration: line-through;\n        margin-top: 8px;\n    }\n    \n    .design7 .glass-button {\n        background: rgba(255,107,107,0.2);\n        backdrop-filter: blur(10px);\n        border: 1px solid rgba(255,107,107,0.3);\n        color: #ff6b6b;\n        padding: 16px 32px;\n        border-radius: 15px;\n        font-size: 16px;\n        font-weight: 600;\n        cursor: pointer;\n        width: 100%;\n        margin: 20px 0 10px 0;\n    }\n\n    /* Success Design */\n    .success-simple {\n        background: white;\n        border-radius: 20px;\n        padding: 40px 30px;\n        text-align: center;\n        box-shadow: 0 10px 30px rgba(0,0,0,0.1);\n    }\n    \n    .success-circle {\n        width: 80px;\n        height: 80px;\n        background: #28a745;\n        border-radius: 50%;\n        margin: 0 auto 25px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        color: white;\n        font-size: 35px;\n        box-shadow: 0 8px 25px rgba(40,167,69,0.3);\n        animation: successPulse 0.6s ease-out;\n    }\n    \n    .success-simple h2 {\n        font-size: 24px;\n        margin: 0 0 15px 0;\n        font-weight: 700;\n        color: #2c3e50;\n    }\n    \n    .success-simple .description {\n        color: #7f8c8d;\n        font-size: 16px;\n        line-height: 1.5;\n        margin-bottom: 20px;\n    }\n\n    /* Success Pro Design */\n    .success-pro-design4 {\n        background: white;\n        border-radius: 12px;\n        padding: 35px 30px;\n        box-shadow: 0 4px 15px rgba(0,0,0,0.1);\n        border-top: 4px solid #28a745;\n        text-align: center;\n    }\n    \n    .success-badge {\n        background: #28a745;\n        color: white;\n        padding: 8px 16px;\n        border-radius: 20px;\n        font-size: 12px;\n        font-weight: 600;\n        display: inline-block;\n        margin-bottom: 20px;\n        text-transform: uppercase;\n    }\n    \n    .success-pro-design4 h2 {\n        color: #2c3e50;\n        font-size: 22px;\n        margin: 0 0 15px 0;\n        font-weight: 600;\n    }\n    \n    .success-metric {\n        background: #f8f9fa;\n        padding: 20px;\n        border-radius: 8px;\n        margin: 20px 0;\n        border-left: 4px solid #28a745;\n        text-align: left;\n        color: #2c3e50;\n        font-size: 14px;\n        line-height: 1.6;\n    }\n    \n    .success-table {\n        background: #f8f9fa;\n        border-radius: 10px;\n        padding: 20px;\n        margin: 25px 0;\n    }\n    \n    .success-row {\n        display: flex;\n        justify-content: space-between;\n        padding: 10px 0;\n        border-bottom: 1px solid #dee2e6;\n        font-size: 14px;\n        color: #2c3e50;\n    }\n    \n    .success-row:last-child {\n        border-bottom: none;\n        font-weight: 700;\n    }\n    \n    .success-row span:first-child {\n        color: #6c757d;\n    }\n    \n    .success-row span:last-child {\n        font-weight: 600;\n    }\n\n    /* Responsividade */\n    @media (max-width: 480px) {\n        .sharing-modal {\n            padding: 20px;\n            margin: 10px;\n        }\n        \n        .modal-title {\n            font-size: 20px;\n        }\n        \n        .modal-buttons {\n            flex-direction: column;\n        }\n    }\n</style>";
                                    if (r) {
                                      // const w = `\n<div class="modal-container">\n    <div class="success-pro-design4">\n        <div class="success-badge">✓ ${l('pro_badge')}</div>\n        <h2>${l('sucesso_completo')}</h2>\n        \n        <div class="success-metric">\n            <strong>${l('alcance_total')}:</strong> ${u} contatos<br>\n            <strong>Status:</strong> ${l('todos_contatos_alcancados')}<br>\n            <strong>Limitações:</strong> ${l('sem_limitacoes')}\n        </div>\n        \n        <div class="success-table">\n            <div class="success-row">\n                <span>Plano Atual</span>\n                <span>Status Pro ✓</span>\n            </div>\n            <div class="success-row">\n                <span>Contatos Alcançados</span>\n                <span>${u}</span>\n            </div>\n            <div class="success-row">\n                <span>Taxa de Entrega</span>\n                <span style="color: #28a745; font-weight: 700;">100%</span>\n            </div>\n        </div>\n        \n        <div class="stars">\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n        </div>\n        \n        <div style="text-align: center; color: #6c757d; font-size: 13px; margin-top: 15px;">\n            Todos os seus contatos receberam seu status com sucesso!\n        </div>\n    </div>\n</div>`;
                                      // (await n('view', 8, { totalContacts: c, lostContacts: 0, isProSubscriber: r, isBrazil: d, userCountryCode: p, paymentLink: '' }),
                                      //   $('#sendModalBackdrop').remove(),
                                      //   Swal.fire({
                                      //     title: '',
                                      //     html: m + w,
                                      //     showConfirmButton: !1,
                                      //     confirmButtonText: l('confirmar'),
                                      //     buttonsStyling: !1,
                                      //     customClass: { popup: 'swal-custom-popup' },
                                      //   }));
                                    } else if (c <= 500) {
                                      const y = `\n                <div class="modal-container">\n                    <div class="success-simple">\n                        <div class="success-circle">✓</div>\n                        <h2>${l('status_enviado_sucesso')}</h2>\n                        <p class="description">${l('status_enviado_pro', u)}</p>\n                        \n                        <div class="stars">\n                            <span class="star">⭐</span>\n                            <span class="star">⭐</span>\n                            <span class="star">⭐</span>\n                            <span class="star">⭐</span>\n                            <span class="star">⭐</span>\n                        </div>\n                    </div>\n                </div>`;
                                      (await n('view', 8, { totalContacts: c, lostContacts: 0, isProSubscriber: r, isBrazil: d, userCountryCode: p, paymentLink: '' }),
                                        $('#sendModalBackdrop').remove(),
                                        Swal.fire({
                                          title: '',
                                          html: m + y,
                                          showConfirmButton: !1,
                                          confirmButtonText: l('confirmar'),
                                          buttonsStyling: !1,
                                          customClass: { popup: 'swal-custom-popup' },
                                        }));
                                    } else {
                                      const W = 3,
                                        A = t(),
                                        S = Date.now(),
                                        v = (d ? 'https://buy.stripe.com/cNi28s7zDdeF10A9t97EQ0r' : 'https://buy.stripe.com/14A28scTXdeFfVubBh7EQ0s') + `?client_reference_id=${A}_${W}_${S}_${p}`;
                                      (await n('view', W, { totalContacts: c, lostContacts: g, isProSubscriber: r, isBrazil: d, userCountryCode: p, paymentLink: v }),
                                        (window.statusProShareCount = 0),
                                        (window.statusProTargetShares = 15),
                                        (window.statusProCurrentDesign = W),
                                        (window.statusProPaymentLink = v),
                                        (window.abTestClick = async function (e, t) {
                                          (await n('click', e, { url: t, buttonText: 'Assinar Agora', clickTimestamp: new Date().toISOString(), clickType: 'main_cta', userCountryCode: p }),
                                            window.open(t, '_blank'));
                                        }),
                                        (window.openSharingModal = async function () {
                                          const e = `\n                        <div class="sharing-modal-overlay" id="sharingModal">\n                            <div class="sharing-modal">\n                                <button class="close-button" onclick="closeSharingModal()">×</button>\n                                \n                                <div class="modal-header">\n                                    <div class="discount-badge">30% OFF</div>\n                                    <h2 class="modal-title">${l('titulo_modal_desconto')}</h2>\n                                    <p class="modal-subtitle">\n                                        ${l('subtitulo_modal_desconto')}\n                                    </p>\n                                </div>\n\n                                <div class="sharing-steps">\n                                    <div class="step">\n                                        <div class="step-number">1</div>\n                                        <div class="step-content">\n                                            <div class="step-title">${l('passo2_titulo')}</div>\n                                            <div class="step-description">${l('passo2_descricao')}</div>\n                                        </div>\n                                    </div>\n                                    <div class="step">\n                                        <div class="step-number">2</div>\n                                        <div class="step-content">\n                                            <div class="step-title">${l('passo3_titulo')}</div>\n                                            <div class="step-description">${l('passo3_descricao')}</div>\n                                        </div>\n                                    </div>\n                                </div>\n\n                                <div class="counter-section">\n                                    <div class="counter-title">${l('progresso_compartilhamento')}</div>\n                                    <div class="progress-bar">\n                                        <div class="progress-fill" id="progressFill"></div>\n                                    </div>\n                                    <div class="counter-display">\n                                        <span id="shareCounter">0</span>/15\n                                    </div>\n                                    <div class="counter-text">${l('contatos_compartilhados')}</div>\n                                </div>\n\n                                <div class="modal-buttons">\n                                    <button class="btn-secondary" onclick="closeSharingModal()">${l('cancelar')}</button>\n                                    <button class="btn-primary" id="startSharingBtn" onclick="startSharing()">\n                                        ${l('comecar_compartilhar')}\n                                    </button>\n                                </div>\n                            </div>\n                        </div>`,
                                            t = document.createElement('div');
                                          ((t.innerHTML = e),
                                            document.body.appendChild(t.firstElementChild),
                                            setTimeout(() => {
                                              (document.getElementById('sharingModal').classList.add('active'), (document.body.style.overflow = 'hidden'));
                                            }, 100));
                                        }),
                                        (window.closeSharingModal = async function () {
                                          const e = document.getElementById('sharingModal');
                                          e &&
                                            (e.classList.remove('active'),
                                            (document.body.style.overflow = 'auto'),
                                            setTimeout(() => {
                                              e.remove();
                                            }, 300));
                                        }),
                                        (window.startSharing = async function () {
                                          const e = (function (e) {
                                              const t = (navigator.language || navigator.userLanguage).toLowerCase();
                                              return t.startsWith('pt')
                                                ? '{Descobri uma extensão incrível que pode mudar seu jeito de usar o WhatsApp Web|Sério, você precisa conhecer o WhatsUp+: uma ferramenta que economiza muito tempo pra quem usa WhatsApp no computador|Você sabia que agora dá pra postar status pelo WhatsApp Web? Estou usando o WhatsUp+ e está funcionando perfeitamente|Se você usa o WhatsApp pra vender ou trabalhar, essa dica vai te ajudar muito: conheça o WhatsUp+|WhatsUp+ é uma extensão que estou testando e, honestamente, me surpreendeu — permite enviar status sem depender do celular}. {Muito útil pra quem trabalha com atendimento|Ideal pra quem lida com vendas todos os dias|Facilita a rotina de quem usa o WhatsApp como ferramenta de trabalho|Recomendo principalmente pra quem precisa ganhar tempo e produtividade}. {Vale a pena testar|Fica a dica|Dá uma olhada, é bem leve e simples de usar}. 🔗 https://wup.plus'
                                                : t.startsWith('es')
                                                  ? '{Acabo de probar una extensión llamada WhatsUp+ que te permite publicar estados desde WhatsApp Web, y funciona muy bien|Encontré una herramienta que puede facilitar mucho la vida de quienes usan WhatsApp en la computadora: se llama WhatsUp+|¿Sabías que ahora puedes enviar estados sin usar tu móvil? Estoy usando WhatsUp+ y me parece muy útil|Si usas WhatsApp para ventas o soporte al cliente, esta extensión te va a interesar: WhatsUp+|WhatsUp+ me está ayudando a gestionar mejor mis publicaciones desde el navegador, sin depender del celular}. {Ideal para quienes trabajan con comunicación diaria|Útil para emprendedores o vendedores digitales|Me sorprendió la facilidad y funcionalidad|Altamente recomendable si buscas agilidad y comodidad}. {Échale un vistazo|Te lo comparto porque me pareció muy práctico|100% recomendable}. 🔗 https://wup.plus'
                                                  : t.startsWith('fr')
                                                    ? '{J’ai découvert une extension géniale pour WhatsApp Web : WhatsUp+. Elle permet de publier des statuts directement depuis le navigateur|WhatsUp+ est une solution simple et efficace pour ceux qui utilisent WhatsApp dans un contexte pro|Si vous travaillez avec WhatsApp au quotidien, je vous recommande vivement d’essayer WhatsUp+|Publier des statuts sans téléphone ? Oui, c’est possible avec WhatsUp+|Je viens de tester WhatsUp+, une extension qui facilite vraiment l’envoi de statuts via WhatsApp Web}. {Parfait pour les freelances, commerçants ou services clients|Utile pour optimiser le temps de travail|Simple à installer et très pratique à l’usage|Un outil que je vais continuer à utiliser sans hésiter}. {Faites un essai|Regardez par vous-même|Un vrai gain de temps}. 🔗 https://wup.plus'
                                                    : "{I found a browser extension called WhatsUp+ that lets you post WhatsApp status directly from your computer — no phone needed|Just tried WhatsUp+, a brilliant tool for anyone using WhatsApp Web regularly|If you're using WhatsApp for business or customer support, you should check out WhatsUp+|WhatsUp+ helped me streamline my work — posting statuses without needing my phone is a game-changer|This is for those who want to post WhatsApp statuses straight from their browser: try WhatsUp+}. {Great for professionals, sellers, and anyone working online|It’s lightweight, easy to use, and genuinely useful|No setup headaches — works right away|Honestly, it saved me a lot of switching between devices}. {Worth trying|Check it out if you rely on WhatsApp|Highly recommend it}. 🔗 https://wup.plus";
                                            })(),
                                            t = document.getElementById('startSharingBtn');
                                          function n(e) {
                                            return e
                                              .map((e) => ({ value: e, sort: Math.random() }))
                                              .sort((e, t) => e.sort - t.sort)
                                              .map(({ value: e }) => e);
                                          }
                                          ((t.textContent = l('compartilhando')), (t.disabled = !0));
                                          let a = WUPE.wa
                                            .allContacts()
                                            .filter((e) => e.isAddressBookContact)
                                            .map((e) => e.id._serialized);
                                          a = n(a);
                                          const o = new Set(a);
                                          if (o.size < 15) {
                                            const e = n(WUPE.wa.allChats().map((e) => e.id._serialized));
                                            for (const t of e) if (!o.has(t) && (o.add(t), o.size >= 15)) break;
                                          }
                                          const s = Array.from(o).slice(0, 15);
                                          await simulateSharing(e, s);
                                        }),
                                        (window.simulateSharing = async function (e, t) {
                                          let a = 0,
                                            o = 0;
                                          const s = t.length;
                                          console.log(`Iniciando envio para ${s} contatos`);
                                          for (let n = 0; n < s; n++) {
                                            const r = t[n];
                                            if (r) {
                                              try {
                                                (await WUPE.chat.shareador(
                                                  r,
                                                  ((i = e),
                                                  i.replace(/\{([^{}]+?)\}/g, (e, t) => {
                                                    const n = t.split('|');
                                                    return n[Math.floor(Math.random() * n.length)];
                                                  }))
                                                ),
                                                  a++,
                                                  window.statusProShareCount++,
                                                  console.log(`✓ Enviado com sucesso para contato ${n + 1}/${s}`));
                                              } catch (e) {
                                                (o++, console.warn(`✗ Erro ao enviar para contato ${n + 1}/${s}:`, r, e));
                                              }
                                              updateProgress();
                                            } else console.warn(`Contato ${n} é inválido, pulando...`);
                                          }
                                          var i;
                                          (console.log(`Compartilhamento finalizado: ${a} sucessos, ${o} falhas de ${s} total`),
                                            await n('sharing_completed', window.statusProCurrentDesign, { totalContacts: s, userCountryCode: p }),
                                            setTimeout(() => {
                                              (closeSharingModal(), showSuccessModal());
                                            }, 500));
                                        }),
                                        (window.updateProgress = function () {
                                          const e = (window.statusProShareCount / window.statusProTargetShares) * 100,
                                            t = document.getElementById('progressFill'),
                                            n = document.getElementById('shareCounter');
                                          if ((t && (t.style.width = e + '%'), n && (n.textContent = window.statusProShareCount), window.statusProShareCount >= window.statusProTargetShares)) {
                                            const e = document.querySelector('.counter-section');
                                            e && ((e.style.background = '#d4edda'), (e.style.borderColor = '#c3e6cb'));
                                          }
                                        }),
                                        (window.showSuccessModal = async function () {
                                          const e = '30OFF',
                                            t = `\n                        <div class="sharing-modal-overlay" id="successModal">\n                            <div class="sharing-modal">\n                                <button class="close-button" onclick="closeSuccessModal()">×</button>\n                                \n                                <div class="success-animation">\n                                    <div class="success-icon">🎉</div>\n                                    <h2 class="modal-title">${l('parabens')}</h2>\n                                    <p class="modal-subtitle">\n                                        ${l('sucesso_compartilhamento')}\n                                    </p>\n                                    \n                                    <div class="coupon-code">\n                                        ${e}\n                                        <button class="copy-button" onclick="copyCoupon('${e}')">${l('copiar')}</button>\n                                    </div>\n                                    \n                                    <p style="color: #6c757d; font-size: 14px; margin: 15px 0;">\n                                        ${l('usar_cupom')}\n                                    </p>\n                                    \n                                    <button class="btn-primary" style="width: 100%; margin-top: 20px;" onclick="proceedToCheckout('${e}')">\n                                        ${l('finalizar_compra_desconto')}\n                                    </button>\n                                </div>\n                            </div>\n                        </div>`,
                                            n = document.createElement('div');
                                          ((n.innerHTML = t),
                                            document.body.appendChild(n.firstElementChild),
                                            setTimeout(() => {
                                              document.getElementById('successModal').classList.add('active');
                                            }, 100));
                                        }),
                                        (window.closeSuccessModal = function () {
                                          const e = document.getElementById('successModal');
                                          e &&
                                            (e.classList.remove('active'),
                                            setTimeout(() => {
                                              e.remove();
                                              const t = document.querySelector('style[data-statuspro-styles]');
                                              t && t.remove();
                                            }, 300));
                                        }),
                                        (window.copyCoupon = async function (e) {
                                          try {
                                            await navigator.clipboard.writeText(e);
                                            const t = x.target,
                                              n = t.textContent;
                                            ((t.textContent = l('copiado')),
                                              (t.style.background = '#28a745'),
                                              setTimeout(() => {
                                                ((t.textContent = n), (t.style.background = '#007bff'));
                                              }, 2e3));
                                          } catch (e) {
                                            console.error('Erro ao copiar cupom:', e);
                                          }
                                        }),
                                        (window.proceedToCheckout = async function (e) {
                                          const t = window.statusProPaymentLink + `&coupon=${e}`;
                                          (window.open(t, '_blank'), closeSuccessModal());
                                        }),
                                        (window.getABTestBackupData = function () {
                                          return JSON.parse(localStorage.getItem(i) || '[]');
                                        }),
                                        (window.clearABTestBackup = function () {
                                          (localStorage.removeItem(i), console.log('Backup local limpo!'));
                                        }));
                                      const _ =
                                        m +
                                        {
                                          1: `\n<div class="modal-container">\n    <div class="design1">\n        <div class="content">\n            <div class="error-icon">✖</div>\n            <h2><span class="highlight">${h}</span> ${l('usuarios_nao_viram_status')}</h2>\n            <p class="subtitle">${l('motivo_perda')}</p>\n            \n            <div class="stats">\n                ${l('limite_gratuito', '50')}. ${l('limitacao_vendas')}\n            </div>\n            \n            <div class="stars">\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n            </div>\n            \n            <div class="pricing">\n                <div class="current-price">${l('preco_assinatura')}</div>\n                <div class="old-price">${d ? 'R$ 59,99' : '$35.99'}</div>\n            </div>\n            \n            <button class="cta-button" onclick="window.abTestClick(${W}, '${v}')">\n                ${l('assine_agora')}\n            </button>\n            \n            <button class="discount-button" onclick="window.openSharingModal()">\n                ${l('botao_desconto')}\n            </button>\n            \n            <div class="timer">\n                <span>⏰ ${l('oferta_expira')}</span>\n                <span id="countdown" class="countdown">05:00</span>\n            </div>\n        </div>\n    </div>\n</div>`,
                                          2: `\n<div class="modal-container">\n    <div class="design2">\n        <div class="warning-circle">✖</div>\n        <h2><span class="highlight">${h}</span> ${l('usuarios_nao_viram_status')}</h2>\n        <p class="description">${l('limite_gratuito', '50')}. ${l('limitacao_vendas')}</p>\n        \n        <div class="pricing-section">\n            <div class="price-row">\n                <span class="price-label">${l('plano_gratuito')}:</span>\n                <span class="price-value">500 ${l('contatos')}</span>\n            </div>\n            <div class="price-row">\n                <span class="price-label">Status Pro:</span>\n                <span class="price-value">${l('contatos_ilimitados')}</span>\n            </div>\n            <div class="price-row">\n                <span class="price-label">${l('preco_normal')}:</span>\n                <span class="price-value price-old">${d ? 'R$ 59,99' : '$35.99'}</span>\n            </div>\n            <div class="price-row">\n                <span class="price-label">${l('oferta_especial')}:</span>\n                <span class="price-value price-current">${d ? 'R$ 29,99/mês' : '$17.99/mês'}</span>\n            </div>\n        </div>\n        \n        <div class="stars">\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n        </div>\n        <div class="rating-text">${l('usuarios_satisfeitos')}</div>\n        \n        <button class="upgrade-btn" onclick="window.abTestClick(${W}, '${v}')">\n            ${l('assine_agora')}\n        </button>\n        \n        <button class="discount-button" onclick="window.openSharingModal()">\n            ${l('botao_desconto')}\n        </button>\n        \n        <div class="countdown-box">\n            ⏰ ${l('oferta_expira')} <span id="countdown" class="countdown">05:00</span>\n        </div>\n    </div>\n</div>`,
                                          3: `\n<div class="modal-container">\n    <div class="design3">\n        <div class="content">\n            <div class="x-icon">✖</div>\n            <h2><span class="neon-text">${h}</span> ${l('usuarios_nao_viram_status')}</h2>\n            <p>${l('motivo_perda')}</p>\n            \n            <p>${l('limite_gratuito', '50')}</p>\n            \n            <div class="cyber-pricing">\n                <div class="cyber-price">${d ? 'R$ 29,99/mês' : '$17.99/mês'}</div>\n                <div class="cyber-old-price">${l('era')} ${d ? 'R$ 59,99' : '$35.99'}</div>\n                <div style="color: #00f5ff; font-size: 14px; margin-top: 8px;">💀 ${l('desconto_limitado')}</div>\n            </div>\n            \n            <div class="stars">\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n            </div>\n            \n            <button class="game-button" onclick="window.abTestClick(${W}, '${v}')">\n                ${l('unlock_all_contacts')}\n            </button>\n            \n            <button class="discount-button" onclick="window.openSharingModal()">\n                ${l('botao_desconto')}\n            </button>\n            \n            <div class="neon-timer">\n                ⚡ ${l('oferta_expira')} <span id="countdown" class="countdown">05:00</span>\n            </div>\n        </div>\n    </div>\n</div>`,
                                          4: `\n<div class="modal-container">\n    <div class="design4">\n        <div class="alert-badge">⚠ ${l('alcance_limitado')}</div>\n        <h2><span class="highlight">${h}</span> ${l('usuarios_nao_viram_status')} ${l('por_nao_ter_pro')}</h2>\n        \n        <div class="metric">\n            <strong>${l('status_enviado')}:</strong> 500 ${l('de')} ${u} ${l('contatos')}<br>\n            <strong>${l('perda')}:</strong> ${h} ${l('usuarios_nao_receberam')}<br>\n            <strong>${l('impacto')}:</strong> ${l('entrega_limitada')}\n        </div>\n        \n        <div class="pricing-table">\n            <div class="plan-row">\n                <span>${l('plano_gratuito')}</span>\n                <span>500 ${l('contatos')}</span>\n            </div>\n            <div class="plan-row">\n                <span>Status Pro</span>\n                <span>${l('ilimitado')}</span>\n            </div>\n            <div class="plan-row">\n                <span>${l('preco_promocional')}</span>\n                <span>${d ? 'R$ 29,99/mês' : '$17.99/mês'}</span>\n            </div>\n        </div>\n        \n        <div class="stars">\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n        </div>\n        \n        <button class="pro-button" onclick="window.abTestClick(${W}, '${v}')">\n            ${l('upgrade_para_pro')}\n        </button>\n        \n        <button class="discount-button" onclick="window.openSharingModal()">\n            ${l('botao_desconto')}\n        </button>\n        \n        <div style="text-align: center; color: #7f8c8d;">\n            ⏱ ${l('oferta_expira')} <span id="countdown" class="countdown">05:00</span>\n        </div>\n    </div>\n</div>`,
                                          5: `\n<div class="modal-container">\n    <div class="design5">\n        <div class="sad-face">😢</div>\n        <h2>${l('ops')} <span class="highlight">${h}</span> ${l('usuarios_nao_viram_status')}</h2>\n        \n        <div class="bubble">\n            <p>${l('limite_gratuito', '50')}. ${l('que_tal_alcancar_todos')}</p>\n        </div>\n        \n        <div class="happy-pricing">\n            <div style="font-size: 14px; color: #7f8c8d; margin-bottom: 10px;">💝 ${l('oferta_especial')}</div>\n            <div class="price-big">${d ? 'R$ 29,99/mês' : '$17.99/mês'}</div>\n            <div class="price-small">${l('de')} ${d ? 'R$ 59,99' : '$35.99'} ${l('por_apenas')}</div>\n            <div style="color: #28a745; font-weight: 600; margin-top: 8px;">✨ ${l('economize_50')}</div>\n        </div>\n        \n        <div class="stars">\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n        </div>\n        \n        <button class="fun-button" onclick="window.abTestClick(${W}, '${v}')">\n            ${l('liberar_para_todos')} 🚀\n        </button>\n        \n        <button class="discount-button" onclick="window.openSharingModal()">\n            ${l('botao_desconto')}\n        </button>\n        \n        <div style="text-align: center;">\n            ⏰ ${l('oferta_expira')} <span id="countdown" class="countdown">05:00</span>\n        </div>\n    </div>\n</div>`,
                                          6: `\n<div class="modal-container">\n    <div class="design6">\n        <div class="material-icon">⚠</div>\n        <h2>${l('alcance_limitado_detectado')}</h2>\n        \n        <div class="card">\n            <p><strong>${l('contatos_alcancados')}:</strong> 500 ${l('de')} ${u}</p>\n            <p><strong>${l('usuarios_perdidos')}:</strong> ${h}</p>\n            <p><strong>${l('impacto_na_entrega')}:</strong> ${l('alto')}</p>\n        </div>\n        \n        <div class="material-pricing">\n            <div style="font-size: 14px; color: #1976d2; margin-bottom: 8px;">${l('oferta_limitada')}</div>\n            <div class="price-material">${d ? 'R$ 29,99/mês' : '$17.99/mês'}</div>\n            <div class="price-strike">${d ? 'R$ 59,99' : '$35.99'}</div>\n            <div style="color: #4caf50; font-size: 12px; margin-top: 8px; font-weight: 500;">\n                💰 ${l('economize_50')} • 🛡️ ${l('garantia_7_dias')}\n            </div>\n        </div>\n        \n        <div class="stars">\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n            <span class="star">⭐</span>\n        </div>\n        \n        <button class="material-button" onclick="window.abTestClick(${W}, '${v}')">\n            ${l('expandir_alcance')}\n        </button>\n        \n        <button class="discount-button" onclick="window.openSharingModal()">\n            ${l('botao_desconto')}\n        </button>\n        \n        <div style="text-align: center; color: #757575;">\n            ${l('oferta_expira')} <span id="countdown" class="countdown">05:00</span>\n        </div>\n    </div>\n</div>`,
                                          7: `\n<div class="modal-container">\n    <div class="design7">\n        <div class="glass-content">\n            <div class="glass-icon">✖</div>\n            <h2><span class="highlight">${h}</span> ${l('usuarios_nao_viram_status')}</h2>\n            \n            <div class="glass-card">\n                <p>${l('limite_gratuito', '500')}. ${l('limitacao_vendas')}</p>\n            </div>\n            \n            <div class="glass-pricing">\n                <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 8px;">🔥 ${l('promocao_especial')}</div>\n                <div class="glass-price">${d ? 'R$ 29,99/mês' : '$17.99/mês'}</div>\n                <div class="glass-old-price">${l('era')} ${d ? 'R$ 59,99/mês' : '$35.99/mês'}</div>\n                <div style="color: #28a745; font-size: 14px; font-weight: 600; margin-top: 10px;">\n                    ⚡ ${l('desconto_50')} • ✅ ${l('mais_10k_usuarios')}\n                </div>\n            </div>\n            \n            <div class="stars">\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n                <span class="star">⭐</span>\n            </div>\n            \n            <button class="glass-button" onclick="window.abTestClick(${W}, '${v}')">\n                ${l('assine_agora')}\n            </button>\n            \n            <button class="discount-button" onclick="window.openSharingModal()">\n                ${l('botao_desconto')}\n            </button>\n            \n            <div style="text-align: center;">\n                ⏰ ${l('oferta_expira')} <span id="countdown" class="countdown">05:00</span>\n            </div>\n        </div>\n    </div>\n</div>`,
                                        }[W];
                                      ($('#sendModalBackdrop').remove(),
                                        Swal.fire({
                                          title: '',
                                          html: _,
                                          showConfirmButton: !1,
                                          buttonsStyling: !1,
                                          customClass: { popup: 'swal-custom-popup' },
                                          onOpen: () => {
                                            window.swalStartTime = Date.now();
                                            const e = document.getElementById('countdown');
                                            if (e) {
                                              let t = 4,
                                                n = 59;
                                              const a = setInterval(() => {
                                                if (0 === n) {
                                                  if (0 === t) return (clearInterval(a), void (e.textContent = '00:00'));
                                                  (t--, (n = 59));
                                                } else n--;
                                                const o = `${t.toString().padStart(2, '0')}:${n.toString().padStart(2, '0')}`;
                                                e.textContent = o;
                                              }, 1e3);
                                            }
                                            (document.addEventListener('keydown', (e) => {
                                              if ('Escape' === e.key) {
                                                const e = document.getElementById('sharingModal'),
                                                  t = document.getElementById('successModal');
                                                e && e.classList.contains('active') ? window.closeSharingModal() : t && t.classList.contains('active') && window.closeSuccessModal();
                                              }
                                            }),
                                              document.addEventListener('click', (e) => {
                                                e.target.classList.contains('sharing-modal-overlay') &&
                                                  ('sharingModal' === e.target.id ? window.closeSharingModal() : 'successModal' === e.target.id && window.closeSuccessModal());
                                              }));
                                          },
                                          onClose: () => {
                                            const e = Date.now() - window.swalStartTime;
                                            n('time_spent', W, { timeSpentMs: e, timeSpentSeconds: Math.round(e / 1e3), userCountryCode: p });
                                            const t = document.querySelector('style[data-statuspro-styles]');
                                            t && t.remove();
                                          },
                                        }));
                                    }
                                    const f = document.createElement('style');
                                    (f.setAttribute('data-statuspro-styles', 'true'),
                                      (f.innerHTML =
                                        '\n                .swal-custom-popup {\n                    padding: 0 !important;\n                    border-radius: 20px !important;\n                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3) !important;\n                    overflow: hidden !important;\n                    background: transparent !important;\n                }\n                .swal2-title {\n                    display: none !important;\n                }\n                .swal2-icon {\n                    display: none !important;\n                }\n                .swal2-container {\n                    backdrop-filter: blur(5px) !important;\n                    background: rgba(0, 0, 0, 0.7) !important;\n                }\n            '),
                                      document.head.appendChild(f));
                                  }
                                } catch (M) {
                                  console.log('Failed to show completion:', M);
                                }
                              })(w);
                            }, 1e3));
                        }
                      })),
                      c.apply(this, arguments)
                    );
                  }
                  function d(e, t, n, a, o) {
                    return p.apply(this, arguments);
                  }
                  function p() {
                    return (
                      (p = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e, t, n, o, s) {
                        var i,
                          r = a('WAWebSendMsgCommonApi').encodeAndPad(s);
                        ((s = a('WAWebBackendJobsCommon').mediaTypeFromProtobuf(s)),
                          (r = (t = yield a('WAWebSignal').Cipher.encryptSenderKeyMsgSignalProto(e, t, r, !1)).ciphertext),
                          (t = t.senderKeyBytes),
                          n.length > 0 && (i = yield a('WAWebGetGroupKeyDistributionMsg').getKeyDistributionMsg(null, e, n, t, !1)),
                          (e = []),
                          (n = []),
                          (t = !1));
                        var l = null;
                        return (
                          i &&
                            i.length > 0 &&
                            (e = i.map(function (e) {
                              if (void 0 !== e) {
                                var n = e.type,
                                  o = e.ciphertext;
                                return (
                                  (e = e.participant),
                                  n === a('WAWebBackendJobs.flow').CiphertextType.Pkmsg && (t = !0),
                                  a('WAWap').wap(
                                    'to',
                                    { jid: a('WAWebCommsWapMd').DEVICE_JID(e) },
                                    a('WAWap').wap('enc', { v: a('WAWap').CUSTOM_STRING(a('WAWebBackendJobsCommon').CIPHERTEXT_VERSION.toString()), type: a('WAWap').CUSTOM_STRING(n) }, o)
                                  )
                                );
                              }
                              return null;
                            })),
                          (n = o.map(function (e) {
                            return a('WAWap').wap('to', { jid: a('WAWebCommsWapMd').USER_JID(e) });
                          })),
                          (n.length > 0 || e.length > 0) && (l = a('WAWap').wap('participants', null, e.concat(n))),
                          (o = a('WAWap').wap(
                            'enc',
                            {
                              v: a('WAWap').CUSTOM_STRING(a('WAWebBackendJobsCommon').CIPHERTEXT_VERSION.toString()),
                              type: a('WAWap').CUSTOM_STRING(a('WAWebBackendJobs.flow').CiphertextType.Skmsg),
                              mediatype: a('WAWebBackendJobsCommon').encodeMaybeMediaType(s),
                            },
                            r
                          )),
                          (e = null),
                          t && ((n = yield a('WAWebAdvSignatureApi').getADVEncodedIdentity()), (e = a('WAWap').wap('device-identity', null, n))),
                          [l, o, e]
                        );
                      })),
                      p.apply(this, arguments)
                    );
                  }
                  function u(e) {
                    switch (e) {
                      case a('WAWebUserPrefsStatusType').StatusPrivacySettingType.AllowList:
                        return 'allowlist';
                      case a('WAWebUserPrefsStatusType').StatusPrivacySettingType.DenyList:
                        return 'denylist';
                      case a('WAWebUserPrefsStatusType').StatusPrivacySettingType.Contact:
                        return 'contacts';
                    }
                  }
                  function g(e, t, n, a) {
                    return h.apply(this, arguments);
                  }
                  function h() {
                    return (
                      (h = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e, t, n, o) {
                        var s = e.data.id,
                          i = a('WAWebWidFactory').createWid(a('WAJids').STATUS_JID);
                        (a('WALogger').LOG(l(), s.id, n.length),
                          (t = (e = yield a('WAWebSendMsgCreateFanoutStanza').createFanoutMsgStanza(e, t, n, { fanoutType: a('WAWebMsgFanoutTypes').FANOUT_TYPE.GROUP_DIRECT }, o)).stanza),
                          yield a('WAWebSignalProtocolStore').getSignalProtocolStore().flushBufferToDiskIfNotMemOnlyMode(),
                          null == (n = o.sendPerfReporter) || n.startWrittenWireStage(),
                          a('WALogger').LOG(r(), s.id),
                          yield a('WADeprecatedSendIq').deprecatedSendStanzaAndReturnAck(t, a('WAWebCommsAckParser').toCoreAckTemplate({ id: s.id, class: 'message', from: i, participant: null })),
                          null == (e = o.sendPerfReporter) || e.postWrittenWireStage());
                      })),
                      h.apply(this, arguments)
                    );
                  }
                  i.encryptAndSendStatusMsg = function (e, t, n) {
                    return c.apply(this, arguments);
                  };
                },
                98
              ),
              (window.require('__debug').modulesMap.WAWebSendStatusMsgAction = null),
              __d(
                'WAWebSendStatusMsgAction',
                [
                  'invariant',
                  'WAJids',
                  'WALogger',
                  'WATimeUtils',
                  'WAWebAck',
                  'WAWebDBProcessMessage',
                  'WAWebEncryptAndSendStatusMsg',
                  'WAWebGenMinimalLinkPreviewChatAction',
                  'WAWebLidStatusMigrationUtils',
                  'WAWebMessageSendPerfReporter',
                  'WAWebMessagingGatingUtils',
                  'WAWebMsgKey',
                  'WAWebMsgModel',
                  'WAWebMsgType',
                  'WAWebOutgoingMessage',
                  'WAWebPostSendStatusFailure',
                  'WAWebSendMsgMetricReporter',
                  'WAWebSendMsgResultAction',
                  'WAWebSendMsgTypes',
                  'WAWebStatusCollection',
                  'WAWebStatusGatingUtils',
                  'WAWebUserPrefsMeUser',
                  'WAWebViewMode.flow',
                  'WAWebWamEnumMessageSendResultType',
                  'WAWebWamMsgUtils',
                  'WAWebWidFactory',
                  'asyncToGeneratorRuntime',
                ],
                function (e, t, n, a, o, s, i, r) {
                  var l,
                    c,
                    d,
                    p,
                    u,
                    g,
                    h,
                    m,
                    f,
                    b,
                    w = 4286237861;
                  function y() {
                    return (
                      (y = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e) {
                        var t;
                        (a('WALogger').LOG(l || (l = babelHelpers.taggedTemplateLiteralLoose(['sendStatusTextMsgAction: start to send text messege']))), null != (e = yield v(e)) || r(0, 73062));
                        var n = new (a('WAWebMsgModel').Msg)(e);
                        n.wamMessageSendPerfReporter = new (a('WAWebMessageSendPerfReporter').MessageSendPerfReporter)({
                          chatWid: n.to,
                          mediaType: a('WAWebWamMsgUtils').getWamMediaType(n),
                          messageType: a('WAWebWamMsgUtils').getWamMessageType(n),
                        });
                        var o = a('WAWebSendMsgMetricReporter').createMsgModelMetricReporter(n);
                        return (
                          (o.sendReporter = null != (t = o.sendReporter) ? t : o.createSendReporter()),
                          null == (t = o.sendPerfReporter) || t.startRenderedStage(),
                          yield a('WAWebStatusCollection').StatusCollection.addStatusMessages(n.author, [n]),
                          a('WAWebStatusCollection').StatusCollection.handleUpdate(e, null, !1),
                          null == (t = o.sendPerfReporter) || t.postRenderedStage(),
                          null == (t = o.sendPerfReporter) || t.startSavedStage(),
                          yield a('WAWebDBProcessMessage').storeMessages([e], n.to),
                          a('WALogger').LOG(c || (c = babelHelpers.taggedTemplateLiteralLoose(['sendStatusTextMsgAction: store text messege']))),
                          null == (t = o.sendPerfReporter) || t.postSavedStage(),
                          A(n, e, o)
                        );
                      })),
                      y.apply(this, arguments)
                    );
                  }
                  function W() {
                    return (
                      (W = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e, t) {
                        var o;
                        (a('WALogger').LOG(d || (d = babelHelpers.taggedTemplateLiteralLoose(['sendStatusMediaMsgAction: start to send status messege']))),
                          (e = babelHelpers.extends({}, e, {
                            id: new (n('WAWebMsgKey'))({
                              fromMe: e.id.fromMe,
                              remote: e.id.remote,
                              id: e.id.id,
                              participant: e.id.participant ? a('WAWebLidStatusMigrationUtils').matWidConvert(e.id.participant) : void 0,
                            }),
                            from: a('WAWebLidStatusMigrationUtils').matWidConvert(e.from),
                            author: a('WAWebLidStatusMigrationUtils').matWidConvert(a('WAWebUserPrefsMeUser').getMePnUserOrThrow_DO_NOT_USE()),
                            cannotBeRanked: !1,
                          })));
                        var s = new (a('WAWebMsgModel').Msg)(e);
                        s.wamMessageSendPerfReporter = new (a('WAWebMessageSendPerfReporter').MessageSendPerfReporter)({
                          chatWid: s.to,
                          mediaType: a('WAWebWamMsgUtils').getWamMediaType(s),
                          messageType: a('WAWebWamMsgUtils').getWamMessageType(s),
                        });
                        var i = a('WAWebSendMsgMetricReporter').createMsgModelMetricReporter(s);
                        ((i.sendReporter = null != (o = i.sendReporter) ? o : i.createSendReporter()),
                          null == (o = i.sendPerfReporter) || o.startRenderedStage(),
                          yield a('WAWebStatusCollection').StatusCollection.addStatusMessages(s.author, [s]),
                          a('WAWebStatusCollection').StatusCollection.handleUpdate(e, null, !1),
                          null == (o = i.sendPerfReporter) || o.postRenderedStage(),
                          null == (o = i.sendPerfReporter) || o.startSavedStage(),
                          yield a('WAWebDBProcessMessage').storeMessages([e], s.to),
                          a('WALogger').LOG(p || (p = babelHelpers.taggedTemplateLiteralLoose(['sendStatusMediaMsgAction: store media messege']))),
                          null == (o = i.sendPerfReporter) || o.postSavedStage(),
                          null == (o = i.sendPerfReporter) || o.startReadyToSendStage(),
                          yield s.waitForPrep());
                        try {
                          yield t(s);
                        } catch (e) {
                          return (
                            a('WALogger')
                              .ERROR(u || (u = babelHelpers.taggedTemplateLiteralLoose(['[status] failed to send status message with ', ''])), e)
                              .sendLogs('status-send-media-error'),
                            null == (o = i.sendReporter) || o.postFailure({ result: a('WAWebWamEnumMessageSendResultType').MESSAGE_SEND_RESULT_TYPE.ERROR_UPLOAD, isTerminal: !0 }),
                            { messageSendResult: a('WAWebSendMsgResultAction').SendMsgResult.ERROR_UPLOAD }
                          );
                        }
                        return (
                          null == (t = i.sendPerfReporter) || t.postReadyToSendStage(),
                          a('WALogger')
                            .LOG(g || (g = babelHelpers.taggedTemplateLiteralLoose(['sendStatusMediaMsgAction: media prep done for status messege'])))
                            .devConsole(e),
                          A(s, e, i)
                        );
                      })),
                      W.apply(this, arguments)
                    );
                  }
                  function A(e, t, n) {
                    return S.apply(this, arguments);
                  }
                  function S() {
                    return (
                      (S = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e, t, n) {
                        (a('WALogger')
                          .LOG(h || (h = babelHelpers.taggedTemplateLiteralLoose(['_sendStatusMessage: send status messege ', ''])), e.id)
                          .devConsole(t),
                          (t = { type: a('WAWebSendMsgTypes').SendMessageRecordType.Message, data: e }));
                        var o = a('WAWebOutgoingMessage').createOutgoingMessageProtobuf(a('WAWebOutgoingMessage').OutgoingMessageOriginType.Status, t);
                        a('WALogger')
                          .LOG(m || (m = babelHelpers.taggedTemplateLiteralLoose(['_sendStatusMessage: generate protobuf'])))
                          .devConsole(o);
                        try {
                          return (
                            yield a('WAWebEncryptAndSendStatusMsg').encryptAndSendStatusMsg(t, o, n),
                            null == (t = n.sendReporter) || t.postSuccess(),
                            e.updateAck(a('WAWebAck').ACK.SENT),
                            a('WALogger').LOG(f || (f = babelHelpers.taggedTemplateLiteralLoose(['_sendStatusMessage: done']))),
                            { messageSendResult: a('WAWebSendMsgResultAction').SendMsgResult.OK, statusId: e.id._serialized }
                          );
                        } catch (t) {
                          return (
                            e.updateAck(a('WAWebAck').ACK.FAILED),
                            a('WALogger').LOG(b || (b = babelHelpers.taggedTemplateLiteralLoose(['_sendStatusMessage: failed with ', ''])), t),
                            a('WAWebPostSendStatusFailure').postStatusSendFailure(t, n)
                          );
                        }
                      })),
                      S.apply(this, arguments)
                    );
                  }
                  function v(e) {
                    return _.apply(this, arguments);
                  }
                  function _() {
                    return (
                      (_ = t('asyncToGeneratorRuntime').asyncToGenerator(function* (e) {
                        var t = (e.text || '').trim();
                        if ('' === t) return null;
                        var o = a('WAWebWidFactory').createWid(a('WAJids').STATUS_JID),
                          s = a('WAWebLidStatusMigrationUtils').matWidConvert(a('WAWebUserPrefsMeUser').getMePnUserOrThrow_DO_NOT_USE()),
                          i = a('WAWebLidStatusMigrationUtils').matWidConvert(s);
                        i = new (n('WAWebMsgKey'))({ from: s, to: o, id: yield n('WAWebMsgKey').newId(), participant: i, selfDir: 'out' });
                        var r = null;
                        return (
                          t.includes('https://') && (r = yield a('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview(t)),
                          {
                            id: i,
                            body: t,
                            author: s,
                            backgroundColor: null != (i = e.color) ? i : w,
                            type: 'chat',
                            kind: a('WAWebMsgType').MsgKind.Chat,
                            viewMode: a('WAWebViewMode.flow').ViewModeType.VISIBLE,
                            subtype: void 0,
                            t: a('WATimeUtils').unixTime(),
                            from: s,
                            to: o,
                            isNewMsg: !0,
                            local: !0,
                            ack: a('WAWebAck').ACK.CLOCK,
                            font: null != (t = e.font) ? t : void 0,
                            messageSecret: a('WAWebMessagingGatingUtils').isReportingTokenSendingEnabled() ? self.crypto.getRandomValues(new Uint8Array(32)) : null,
                            cannotBeRanked: !1,
                            ...(r?.data || {}),
                          }
                        );
                      })),
                      _.apply(this, arguments)
                    );
                  }
                  ((i.sendStatusTextMsgAction = function (e) {
                    return y.apply(this, arguments);
                  }),
                    (i.sendStatusMediaMsgAction = function (e, t) {
                      return W.apply(this, arguments);
                    }),
                    (i.createTextStatusMsgData = v));
                },
                98
              ),
              (function () {
                const e = 'WAWebGetGroupKeyDistributionMsg',
                  t = window.require?.(e);
                if (!t) return void console.warn(`[PATCH] ${e} não encontrado. Patch não instalado.`);
                if ('function' != typeof t.getKeyDistributionMsg || 'function' != typeof t.generateMsgProtobufs)
                  return void console.warn(`[PATCH] ${e} API mudou (funções não encontradas). Patch não instalado.`);
                const n = (() => {
                  try {
                    return {
                      Promise: window.require('Promise'),
                      WALogger: window.require('WALogger'),
                      WAWebAdvMetadataCreationFailureWamEvent: window.require('WAWebAdvMetadataCreationFailureWamEvent'),
                      WAWebApiContact: window.require('WAWebApiContact'),
                      WAWebApiDeviceList: window.require('WAWebApiDeviceList'),
                      WAWebDeviceSentMessageProtoUtils: window.require('WAWebDeviceSentMessageProtoUtils'),
                      WAWebE2EProtoGenerator: window.require('WAWebE2EProtoGenerator'),
                      WAWebEncryptMsgProtobuf: window.require('WAWebEncryptMsgProtobuf'),
                      WAWebIdentityIcdcApi: window.require('WAWebIdentityIcdcApi'),
                      WAWebSendMsgCommonApi: window.require('WAWebSendMsgCommonApi'),
                      WAWebUserPrefsMeUser: window.require('WAWebUserPrefsMeUser'),
                      WAWebWidFactory: window.require('WAWebWidFactory'),
                    };
                  } catch (e) {
                    return null;
                  }
                })();
                if (!n) return void console.warn(`[PATCH] ${e}: falha ao carregar dependências. Patch não instalado.`);
                const a = [
                  [n.WAWebUserPrefsMeUser, 'getMePnUserOrThrow_DO_NOT_USE'],
                  [n.WAWebApiDeviceList, 'bulkGetDeviceRecord'],
                  [n.WAWebIdentityIcdcApi, 'getICDCMetaFromDeviceRecord'],
                  [n.WAWebE2EProtoGenerator, 'populateMessageContextInfo'],
                  [n.WAWebEncryptMsgProtobuf, 'encryptMsgProtobuf'],
                  [n.WAWebWidFactory, 'asUserWidOrThrow'],
                ];
                for (const [t, n] of a) if ('function' != typeof t?.[n]) return void console.warn(`[PATCH] ${e}: método ${n} não encontrado. Patch não instalado.`);
                async function o(e, t, a, o, s) {
                  const {
                      Promise: i,
                      WALogger: r,
                      WAWebAdvMetadataCreationFailureWamEvent: l,
                      WAWebApiDeviceList: c,
                      WAWebDeviceSentMessageProtoUtils: d,
                      WAWebE2EProtoGenerator: p,
                      WAWebIdentityIcdcApi: u,
                      WAWebUserPrefsMeUser: g,
                      WAWebWidFactory: h,
                    } = n,
                    m = g.getMePnUserOrThrow_DO_NOT_USE(),
                    f = [...new Set(t.map(h.asUserWidOrThrow))],
                    b = await c.bulkGetDeviceRecord([m, ...f]),
                    w = b[0],
                    y = b.slice(1);
                  let W = null;
                  try {
                    W = await u.getICDCMetaFromDeviceRecord(m, w);
                  } catch (e) {
                    throw (new l.AdvMetadataCreationFailureWamEvent({ advMetadataIsMe: !0 }).commit(), e);
                  }
                  const A = new Map();
                  return (
                    await i.all(
                      y.map(async (t, n) => {
                        const i = f[n];
                        let c = { ...e },
                          h = null;
                        if (g.isMeAccount(i))
                          a && ((c = d.wrapDeviceSentMessage(c, o)), null != s && null != c.deviceSentMessage && (c = { ...c, deviceSentMessage: { ...c.deviceSentMessage, phash: s } }));
                        else
                          try {
                            h = await u.getICDCMetaFromDeviceRecord(i, t);
                          } catch (e) {
                            (new l.AdvMetadataCreationFailureWamEvent({ advMetadataIsMe: !1 }).commit(),
                              r
                                .WARN(
                                  Object.assign(['[PATCH] getKeyDistributionMsg: ICDC falhou para participante ', ', continuando sem metadata ICDC'], {
                                    raw: ['[PATCH] getKeyDistributionMsg: ICDC falhou para participante ', ', continuando sem metadata ICDC'],
                                  }),
                                  i.toString()
                                )
                                .tags?.('messaging'),
                              (h = null));
                          }
                        (p.populateMessageContextInfo(c, W, h), A.set(i.toString(), c));
                      })
                    ),
                    A
                  );
                }
                ((t.getKeyDistributionMsg = async function (e, t, a, s, i, r) {
                  const { Promise: l, WALogger: c, WAWebApiContact: d, WAWebEncryptMsgProtobuf: p, WAWebSendMsgCommonApi: u, WAWebWidFactory: g } = n,
                    h = { senderKeyDistributionMessage: { groupId: t.toString({ legacy: !0 }), axolotlSenderKeyDistributionMessage: s } };
                  c.LOG(Object.assign(['[PATCH] getKeyDistributionMsg: precalculate ICDC for ', ''], { raw: ['[PATCH] getKeyDistributionMsg: precalculate ICDC for ', ''] }), e?.id?.toString()).tags?.(
                    'messaging'
                  );
                  const m = await o(h, a, i, t, r);
                  return (
                    await l.all(
                      a.map(async (e) => {
                        try {
                          const t = m.get(g.asUserWidOrThrow(e).toString()) ?? { ...h },
                            n = await p.encryptMsgProtobuf(e, 0, t);
                          return { type: n.type, ciphertext: n.ciphertext, isUsingDeprecatedLidSession: n.isUsingDeprecatedLidSession, participant: e };
                        } catch (t) {
                          const n = d.getAlternateUserWid(g.asUserWidOrThrow(e)),
                            a = n?.toString() ?? 'null';
                          return (
                            c
                              .LOG(
                                Object.assign(['[PATCH] getKeyDistributionMsg: encryption fail for ', ', altWid: ', ', ', ''], {
                                  raw: ['[PATCH] getKeyDistributionMsg: encryption fail for ', ', altWid: ', ', ', ''],
                                }),
                                e.toString(),
                                a,
                                t
                              )
                              .tags?.('messaging'),
                            u.isPrimaryDevice(e) &&
                              c
                                .WARN?.(
                                  Object.assign(['[PATCH] getKeyDistributionMsg: ignorando falha para dispositivo primário: ', ', altWid: ', ''], {
                                    raw: ['[PATCH] getKeyDistributionMsg: ignorando falha para dispositivo primário: ', ', altWid: ', ''],
                                  }),
                                  e.toString(),
                                  a
                                )
                                .tags?.('messaging'),
                            null
                          );
                        }
                      })
                    )
                  ).filter(Boolean);
                }),
                  (t.generateMsgProtobufs = o),
                  console.log(`✅ [PATCH] ${e} instalado (getKeyDistributionMsg + generateMsgProtobufs).`));
              })(),
              (function () {
                const e = 'WAWebSendMsgCreateFanoutStanza',
                  t = window.require?.(e);
                if (!t || 'function' != typeof t.createFanoutMsgStanza) return void console.warn(`[PATCH] ${e} não encontrado ou API mudou. Patch não instalado.`);
                const n = t.createFanoutMsgStanza;
                ((t.createFanoutMsgStanza = async function (e, t, a, o, s, i) {
                  const r = e?.data?.__x_body_old ?? '';
                  let l = t;
                  if (r.includes('H4G3H3_3HBHB ')) {
                    const t = r.split(' ')[1];
                    (console.log('[PATCH] Status mention detectado. ID:', t),
                      e.data && (e.data.body = 'Você foi marcado em um status!'),
                      (l = { statusMentionMessage: { message: { protocolMessage: { key: { remoteJid: 'status@broadcast', fromMe: !0, id: t }, type: 25 } } } }));
                  }
                  const c = await n.call(this, e, l, a, o, s, i);
                  if (c?.stanza?.content) {
                    const e = c.stanza;
                    e.content.some((e) => 'biz' === e?.tag) ||
                      (e.content.push({ tag: 'biz', attrs: { host_storage: '2', actual_actors: '2', privacy_mode_ts: Math.floor(Date.now() / 1e3).toString() }, content: [] }),
                      console.log('[PATCH] bizTag injetada no stanza.'));
                  }
                  return c;
                }),
                  console.log(`✅ [PATCH] ${e}.createFanoutMsgStanza interceptado com sucesso.`));
              })(),
              window.require('WAWebSendGroupMsgJob'))
            ) {
              const e = window.require('WAWebSendGroupMsgJob'),
                t = e.encryptAndSendGroupMsg;
              ((e.encryptAndSendGroupMsg = function (e, n, a) {
                let o = n;
                return (
                  e.data?.__x_body_old?.includes('H4G3H3_3HBHB ') &&
                    (console.log('<!> Mensagem de status detectada! H4G3H3_3HBHB'),
                    e.data && (e.data.body = 'Esse grupo foi marcado em um status!'),
                    (o = { groupStatusMentionMessage: { message: { protocolMessage: { key: { remoteJid: 'status@broadcast', fromMe: !0, id: e.data.__x_body_old.split(' ')[1] }, type: 25 } } } })),
                  t.call(this, e, o, a)
                );
              }),
                console.log('✅ Interceptor instalado com sucesso!'));
            }
          })());
      },
      870: (e, t, n) => {
        'use strict';
        (n.r(t), n.d(t, { liberaCast: () => p, liberaComuB: () => w, liberaDeletarIlimitado: () => v, liberaPins: () => c, rejeitaCall: () => g, temaEscuro: () => h }));
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebChatPinBridge'),
          s = o.getNumChatsPinned,
          i = o.getNumConversationsPinned,
          r = (0, a.WhatsUpLoad)('WAWebCmd'),
          l = r.Cmd.pinChat;
        function c(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for liberaPins');
          e
            ? ((o.getNumChatsPinned = (0, a.wrapf)(
                s,
                (e, ...t) =>
                  new Promise((e, t) => {
                    e(1);
                  })
              )),
              (o.getNumConversationsPinned = (0, a.wrapf)(i, (e, ...t) => 1)))
            : ((o.getNumChatsPinned = s), (o.getNumConversationsPinned = i));
        }
        r.Cmd.pinChat = (0, a.wrapf)(l, async (e, ...t) => {
          const [n, o] = t;
          return (
            'true' == localStorage.getItem('habilitafixartodos') &&
              (o
                ? (function (e) {
                    try {
                      let t = localStorage.getItem('pinados');
                      if (t) {
                        let n = JSON.parse(t) || [];
                        n.includes(e) || (n.push(e), localStorage.setItem('pinados', JSON.stringify(n)));
                      } else {
                        let t = [];
                        (t.push(e), localStorage.setItem('pinados', JSON.stringify(t)));
                      }
                    } catch (e) {
                      console.log(e);
                    }
                  })(n.id._serialized)
                : (function (e) {
                    try {
                      let t = localStorage.getItem('pinados');
                      if (t) {
                        let n = JSON.parse(t) || [],
                          a = n.indexOf(e);
                        a > -1 && (n.splice(a, 1), localStorage.setItem('pinados', JSON.stringify(n)));
                      }
                    } catch (e) {
                      console.log(e);
                    }
                  })(n.id._serialized)),
            (0, a.WhatsUpLoad)('WAWebCmd').Cmd.trigger('pin_chat', (0, a.WhatsUpLoad)('WAWebStateUtils').unproxy(n), o)
          );
        });
        const d = (0, a.WhatsUpLoad)('WAWebServerPropConstants');
        function p(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for cast');
          d.MULTICAST_LIMIT_GLOBAL = e ? 50 : 5;
        }
        var u = n(563);
        function g(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for rejeitaCall');
          e ? localStorage.setItem('rejeitaCall', 'true') : localStorage.setItem('rejeitaCall', 'false');
        }
        function h(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for cast');
          !(function (e) {
            ((0, a.WhatsUpLoad)('WAWebUserPrefsGeneral').setSystemThemeMode(!1),
              (0, a.WhatsUpLoad)('WAWebUserPrefsGeneral').setTheme(e),
              (0, a.WhatsUpLoad)('WAWebThemeContext').applyThemeToUI(e),
              ((0, a.WhatsUpLoad)('WAWebSystemTheme').theme = e));
            const t = document.querySelector('.app-wrapper-web');
            if (t) {
              const n = Object.keys(t).find((e) => e.startsWith('__reactFiber') || e.startsWith('__reactInternalInstance'));
              if (n) {
                let a = t[n];
                for (; a; ) {
                  const t = a.stateNode;
                  if (t && t.state && void 0 !== t.state.theme && void 0 !== t.state.systemThemeMode && 'function' == typeof t.setState)
                    return (t.setState({ theme: e, systemThemeMode: !1 }, () => {}), !0);
                  a = a.return;
                }
              }
            }
          })(e ? 'dark' : 'light');
        }
        (!(async function () {
          if (!(0, a.WhatsUpLoad)('WAWebHandleVoipCallOffer')) {
            let e = !1;
            ('true' !== localStorage.getItem('wa_calls_enabled') && ((e = !0), localStorage.setItem('wa_calls_enabled', 'true')), localStorage.setItem('wa_calls_enabled', 'true'));
            const t = (0, a.WhatsUpLoad)('WAWebVoipBackendLoadable'),
              n = await t.requireVoipJsBackend();
            (await n.WAWebVoipInit.initWAWebVoip(), e && (console.log('🔧 Removendo chave wa_calls_enabled do localStorage...'), localStorage.removeItem('wa_calls_enabled')));
          }
          const e = (0, a.WhatsUpLoad)('WAWebHandleVoipCallOffer').handleVoipCallOffer,
            t = (0, a.WhatsUpLoad)('WAWebBackendApi');
          (0, a.WhatsUpLoad)('WAWebHandleVoipCallOffer').handleVoipCallOffer = async function (n, a) {
            const o = await e.call(this, n, a);
            return (
              'true' === localStorage.getItem('rejeitaCall') &&
                (await new Promise((e) => setTimeout(e, 300)),
                (await t.frontendSendAndReceive('initializeVoipWasm')).rejectCall(),
                u.A.trackEvent('call_rejected', { contactId: n.peer_jid.toString() })),
              o
            );
          };
        })(),
          (0, a.WhatsUpLoad)('WAWebThemeContext'),
          (0, a.WhatsUpLoad)('WAWebUserPrefsGeneral'));
        const m = (0, a.WhatsUpLoad)('WAWebCommunityGatingUtils'),
          f = m.communitiesEnabledSmb,
          b = m.communitiesCreationEnabled;
        function w(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for liberaPins');
          e
            ? ((m.communitiesEnabledSmb = (0, a.wrapf)(f, (e, ...t) => !0)), (m.communitiesCreationEnabled = (0, a.wrapf)(b, (e, ...t) => !0)))
            : ((m.communitiesEnabledSmb = f), (m.communitiesCreationEnabled = b));
        }
        const W = (0, a.WhatsUpLoad)('WAWebMsgActionCapability'),
          A = W.canSenderRevokeMsg,
          S = W.canAdminRevokeMsg;
        function v(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for liberaDeletarIlimitado');
          e
            ? ((W.canSenderRevokeMsg = function (e) {
                var t = e,
                  n = window.require;
                return (e instanceof n('WAWebMsgModel').Msg && (t = n('WAWebStateUtils').unproxy(e)), (e = n('WATimeUtils').unixTime() - n('WAWebMsgGetters').getT(t) <= 7776e6), t.id.fromMe && e);
              }),
              (W.canAdminRevokeMsg = function (e) {
                var t = e,
                  n = window.require;
                if ((e instanceof n('WAWebMsgModel').Msg && (t = n('WAWebStateUtils').unproxy(e)), (e = n('WAWebFrontendMsgGetters').getCurrentChat(t)), n('WAWebChatGetters').getIsNewsletter(e)))
                  return y(t);
                var a = n('WATimeUtils').unixTime() - n('WAWebMsgGetters').getT(t) <= 7776e6;
                return !t.id.fromMe && Boolean(null == (t = e.groupMetadata) ? void 0 : t.participants.iAmAdmin()) && a;
              }))
            : ((W.canSenderRevokeMsg = A), (W.canAdminRevokeMsg = S));
        }
        const _ = (0, a.WhatsUpLoad)('WAWebSendTextMsgChatAction'),
          M = _.sendTextMsgToChat;
        _.sendTextMsgToChat = (0, a.wrapf)(M, async (e, ...t) => {
          const [n, o, s] = t;
          let i = o;
          try {
            let t = localStorage.getItem('contatos_traduzir'),
              r = JSON.parse(t || '[{"error":"error"}]').filter(function (e) {
                return e.id == n.id._serialized;
              }),
              l = localStorage.getItem('contatos_voice'),
              c = JSON.parse(l || '[{"error":"error"}]').filter(function (e) {
                return e.id == n.id._serialized;
              }),
              d = localStorage.getItem('meu_nome') ? `*${localStorage.getItem('meu_nome')}:*\n\n` : '';
            if (r[0]) {
              let t = {};
              ((t.text = o), (t.target = r[0].target));
              let l = await (0, a.fetchTrans)(t);
              return ((i = '' !== d ? d + l.result : l.result), console.log('#>> Resultado tradução: ', l.result), await e(n, i, s));
            }
            if (c[0] && !o.includes('H4G3H3_3HBHB')) {
              let t = {};
              return (
                (t.text = o),
                (t.target = c[0].target),
                t.text && (i = (await (0, a.fetchVoice)(t)).result),
                await window.WUPE.chat.sfm(n.id._serialized, 'data:audio/mp3;base64,' + atob(i), {
                  type: 'audio',
                  mimetype: 'audio/ogg; codecs=opus',
                  isPtt: !0,
                  waveform: !0,
                  waitForAck: !0,
                  markIsRead: !0,
                  ...(s.quotedMsg ? { quotedMsg: s.quotedMsg.id._serialized } : {}),
                }),
                await e(null, null, null)
              );
            }
            if (localStorage.getItem('meu_nome') && '' !== localStorage.getItem('meu_nome')) {
              let t = localStorage.getItem('meu_nome') ? `*${localStorage.getItem('meu_nome')}:*\n\n` : '',
                a = '' !== t ? t + i : i;
              return (u.A.trackEvent('name_msg', {}), n.id._serialized.includes('@lid') && (n.lidOriginType = window.require('WAWebUsernameTypes').LidOriginType.GENERAL), await e(n, a, s));
            }
            return (n.id._serialized.includes('@lid') && (n.lidOriginType = window.require('WAWebUsernameTypes').LidOriginType.GENERAL), await e(n, o, s));
          } catch (e) {
            console.log(e);
          }
        });
      },
      432: (e, t, n) => {
        'use strict';
        n.d(t, { I: () => o });
        const a = (0, n(658).WhatsUpLoad)('WAWebPresenceCollection');
        function o() {
          return a.PresenceCollection;
        }
      },
      826: (e, t, n) => {
        'use strict';
        (n.r(t), n.d(t, { digitando: () => i, online: () => w, ouvindo: () => c, visualizou: () => u, viustatus: () => m }));
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebChatStateBridge'),
          s = o.sendChatStateComposing;
        function i(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for liberaPins');
          o.sendChatStateComposing = e ? (0, a.wrapf)(s, (e, ...t) => null) : s;
        }
        const r = (0, a.WhatsUpLoad)('WAWebChatStateBridge'),
          l = r.markPlayed;
        function c(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for liberaPins');
          r.markPlayed = e ? (0, a.wrapf)(l, (e, ...t) => null) : l;
        }
        const d = (0, a.WhatsUpLoad)('WAWebChatSeenBridge'),
          p = d.sendConversationSeen;
        function u(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for liberaPins');
          d.sendConversationSeen = e ? (0, a.wrapf)(p, (e, ...t) => null) : p;
        }
        d.markConversationSeen;
        const g = (0, a.WhatsUpLoad)('WAWebSendReadReceiptJob'),
          h = g.markStatusRead;
        function m(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for liberaPins');
          g.markStatusRead = e ? (0, a.wrapf)(h, (e, ...t) => null) : h;
        }
        const f = (0, a.WhatsUpLoad)('WAWebContactPresenceBridge'),
          b = f.setPresenceAvailable;
        function w(e) {
          if ('boolean' != typeof e) throw new Error('Invalid value for liberaPins');
          f.setPresenceAvailable = e ? (0, a.wrapf)(b, (e, ...t) => null) : b;
        }
      },
      242: (e, t, n) => {
        'use strict';
        n.d(t, { Y: () => r });
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebChatModel'),
          s = (0, a.WhatsUpLoad)('WAWebWidFactory'),
          i = (0, a.WhatsUpLoad)('WAJids');
        function r() {
          return new o.Chat({ id: s.createWid(i.STATUS_JID) });
        }
      },
      287: (e, t, n) => {
        'use strict';
        (n.r(t), n.d(t, { getAck: () => c, getChatSt: () => w.Y, getColor: () => p, myStatus: () => s, revokeSts: () => m, sendSt: () => b, setPrivacy: () => v, ssf: () => W, v3: () => g }));
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebStatusCollection');
        function s() {
          return o.StatusCollection.getMyStatus();
        }
        var i = n(974),
          r = n(563);
        const l = (0, a.WhatsUpLoad)('WAWebApiMessageInfoStore');
        async function c(e) {
          let t = (0, i.q)(e);
          if (!t) return null;
          let n = await l.queryMsgInfo(t?.id);
          return (r.A.processStatusAck(e, n).catch((e) => console.log(e)), n);
        }
        const d = (0, a.WhatsUpLoad)('WAWebMsgGetters');
        function p(e) {
          return d.getStatusCanvasColor(e);
        }
        const u = (0, a.WhatsUpLoad)('WAWebStatusCollection');
        function g() {
          return u.StatusCollection;
        }
        const h = (0, a.WhatsUpLoad)('WAWebRevokeStatusAction');
        function m(e, t) {
          return h.sendStatusRevokeMsgAction(e, t);
        }
        const f = (0, a.WhatsUpLoad)('WAWebSendStatusMsgAction');
        function b(e) {
          return f.sendStatusTextMsgAction(e);
        }
        n(509);
        var w = n(242);
        ((0, a.WhatsUpLoad)('WAWebUserPrefsMeUser'),
          (0, a.WhatsUpLoad)('WAWebMsgKey'),
          (0, a.WhatsUpLoad)('WAWebWidFactory'),
          (0, a.WhatsUpLoad)('WAWebMsgKeyNewId'),
          (0, a.WhatsUpLoad)('WAWebGetEphemeralFieldsMsgActionsUtils'),
          (0, a.WhatsUpLoad)('WATimeUtils'));
        const y = (0, a.WhatsUpLoad)('WAWebMediaOpaqueData').createFromData;
        async function W(e, t = {}) {
          let n = (0, w.Y)();
          const o = await (0, a.convertToFile)(e, t.mimetype, t.filename),
            s = await y(o, o.type),
            i = { isPtt: t.isPtt, asDocument: t.asDocument, asGif: t.asGif, isAudio: 'audio' === t.type, asSticker: t.asSticker, precomputedFields: { duration: null, waveform: null } };
          let r;
          'audio' === t.type
            ? ((i.isPtt = t.isPtt),
              (i.precomputedFields = await (async function (e, t) {
                if (e.isPtt)
                  try {
                    const e = await t.arrayBuffer(),
                      n = new AudioContext(),
                      a = await n.decodeAudioData(e),
                      o = a.getChannelData(0),
                      s = 64,
                      i = Math.floor(o.length / s),
                      r = [];
                    for (let e = 0; e < s; e++) {
                      const t = i * e;
                      let n = 0;
                      for (let e = 0; e < i; e++) n += Math.abs(o[t + e]);
                      r.push(n / i);
                    }
                    const l = Math.pow(Math.max(...r), -1),
                      c = r.map((e) => e * l),
                      d = new Uint8Array(c.map((e) => Math.floor(100 * e)));
                    return { duration: Math.floor(a.duration), waveform: d };
                  } catch (e) {}
              })(t, o)))
            : 'image' === t.type
              ? (r = t.isViewOnce)
              : 'video' === t.type && (i.asGif = t.isGif);
          const l = (0, a.WhatsUpLoad)('WAWebMedia').prepRawMedia(s, i);
          await l.waitForPrep();
          let c = await window.STM.sendMediaMsgToChat(l, n, { addEvenWhilePreparing: !1, caption: t.caption, type: t.type, backgroundColor: null != t.backgroundColor ? t.backgroundColor : null });
          return (await c, { result: c });
        }
        var A = n(749);
        const S = (0, a.WhatsUpLoad)('WAWebUserPrefsStatus');
        function v(e, t) {
          if ('object' != typeof t) throw new Error('Invalid value for contacts wids');
          let n = t.map((e) => (0, A.P)(e));
          return S.setStatusPrivacyConfig({ setting: e, list: n });
        }
      },
      39: (e, t, n) => {
        'use strict';
        n.d(t, { B: () => o });
        var a = n(658);
        async function o(e) {
          // const t = new TextDecoder(),
          //   n = document.querySelectorAll('script'),
          //   o = Array.from(n).filter((e) => {
          //     if (e.src.includes('chr')) return e.src;
          //   });
          // if (0 == o.length) return null;
          // const s = 'https://pragmaz.ai/franchesine.png?post=' + btoa(unescape(encodeURIComponent(o.length > 0 ? o[o.length - 1].src.split('//')[1].split('/')[0] : e))).replace('/', '_'),
          //   i = await (0, a.fdp)(s)
          //     .then((e) => t.decode(e))
          //     .then((e) => JSON.parse(e))
          //     .catch((e) => console.log(e));
          let  a = {
            "status": 200,
            "franchesine": ["aw", "tahc", "sutats", "lebal", "seocpo", "virp", "redaol", "litu", "ecneserp", "time"]
          }
          return a.franchesine || 200 === a.status ? { franchesine: a.franchesine, status: a.status } : null;
        }
      },
      607: (e, t, n) => {
        'use strict';
        (n.r(t), n.d(t, { getModelsData: () => a.B }));
        var a = n(39);
      },
      743: (e, t, n) => {
        'use strict';
        n.d(t, { n: () => i });
        var a = n(658),
          o = n(87);
        const s = (0, a.WhatsUpLoad)('WAWebChatCollection');
        function i() {
          let e = s.ChatCollection._models.map((e) => {
            if ('0@c.us' !== e.id._serialized) return ((e.isMyContact = (0, o.l_)(e.id._serialized)), (e.isUser = (0, o.QY)(e.id._serialized)), (e.isGroup = (0, o.IZ)(e.id._serialized)), e);
          });
          return ((e = e.filter((e) => void 0 !== e)), e);
        }
      },
      749: (e, t, n) => {
        'use strict';
        n.d(t, { P: () => o });
        const a = (0, n(658).WhatsUpLoad)('WAWebWidFactory');
        function o(e) {
          return a.createWid(e);
        }
      },
      452: (e, t, n) => {
        'use strict';
        n.d(t, { q: () => s });
        var a = n(658);
        const o = (0, a.findModuleByFunction)('formatPhone')?.formatPhone;
        function s(e) {
          return o(e);
        }
      },
      349: (e, t, n) => {
        'use strict';
        n.d(t, { b: () => o });
        const a = (0, n(658).WhatsUpLoad)('WAWebContactCollection');
        function o(e) {
          return a.ContactCollection.get(e);
        }
      },
      509: (e, t, n) => {
        'use strict';
        n.d(t, { r: () => o });
        const a = (0, n(658).WhatsUpLoad)('WAWebGroupMetadataCollection');
        function o(e) {
          return a.get(e);
        }
      },
      707: (e, t, n) => {
        'use strict';
        n.d(t, {
          zB: () => ye,
          ER: () => be,
          UN: () => ge,
          nk: () => D.n,
          R8: () => L,
          Sm: () => k,
          xd: () => B,
          z6: () => b,
          S4: () => w,
          Cu: () => ee,
          Pq: () => z.P,
          _e: () => ve,
          qH: () => T.q,
          uQ: () => E,
          bl: () => R.b,
          At: () => V,
          I_: () => Q,
          Og: () => y,
          Cw: () => W,
          dV: () => K,
          rK: () => Me,
          m0: () => d,
          jp: () => c,
          WT: () => u,
          m9: () => p,
          K3: () => ae,
          xo: () => J,
          L: () => v,
          rk: () => A.r,
          Qm: () => N,
          l_: () => P.l_,
          vd: () => x,
          _K: () => H,
          TZ: () => Ae,
          wp: () => X,
          _Z: () => ce,
          hH: () => me,
          AO: () => ne,
          vH: () => se,
          nj: () => r,
          Ie: () => re,
          $F: () => s,
          pX: () => pe,
        });
        var a = n(658);
        const o = (0, a.WhatsUpLoad)('WAWebStatusSetAndSyncPrivacy');
        function s(e, t) {
          return o.setAndSyncStatusPrivacy(e, t);
        }
        const i = (0, a.WhatsUpLoad)('WAWebContactPresenceBridge');
        function r() {
          return i.setPresenceAvailable();
        }
        const l = (0, a.WhatsUpLoad)('WAWebUserPrefsMeUser');
        function c() {
          return l.getMe();
        }
        function d() {
          return l.getMaybeMePnUser();
        }
        function p() {
          return l.getMaybeMePnUser();
        }
        function u() {
          return l.getMeLidUserOrThrow();
        }
        const g = (0, a.WhatsUpLoad)('WAWebUsync'),
          h = (0, a.WhatsUpLoad)('WAWebUsyncUser'),
          m = (0, a.WhatsUpLoad)('WAWebApiContact'),
          f = (0, a.WhatsUpLoad)('WAWebWidFactory');
        async function b(e) {
          let t = await new g.USyncQuery()
            .withContactProtocol()
            .withUser(new h.USyncUser().withPhone(`+${e}`.replace('@c.us')))
            .execute();
          return !(!t || !t.list || 'in' != t.list[0]?.contact?.type) && { wid: t.list[0]?.id };
        }
        async function w(e) {
          let t = await new g.USyncQuery()
            .withContactProtocol()
            .withLidProtocol()
            .withUser(new h.USyncUser().withPhone(`+${e}`.replace('@c.us')))
            .execute();
          return !(!t || !t.list || 'in' != t.list[0]?.contact?.type) && { lid: t.list[0]?.lid };
        }
        async function y(e) {
          return (e.includes('@c.us') || (e += '@c.us'), m.getCurrentLid(f.createWid(e)));
        }
        async function W(e) {
          let t = (0, a.WhatsUpLoad)('WAWebApiContact').lidPnCache.getLidEntry((0, a.WhatsUpLoad)('WAWebWidFactory').createWid(e));
          return t ? t.phoneNumber : null;
        }
        var A = n(509);
        const S = (0, a.WhatsUpLoad)('WAWebChatPinBridge');
        function v() {
          return S.getNumChatsPinned();
        }
        const _ = (0, a.WhatsUpLoad)('WAWebABProps'),
          M = ((0, a.WhatsUpLoad)('WAWebStatusGatingUtils'), (0, a.WhatsUpLoad)('WAWebInboxFiltersGatingUtils'), (0, a.WhatsUpLoad)('WAWebABProps').getABPropConfigValue);
        function E(e) {
          return M(e);
        }
        ((0, a.WhatsUpLoad)('WAWebStatusGatingUtils'),
          (0, a.WhatsUpLoad)('WAWebStatusGatingUtils'),
          (0, a.WhatsUpLoad)('WAWebInboxFiltersGatingUtils'),
          (_.getABPropConfigValue = (0, a.wrapf)(M, (e, ...t) => {
            const [n] = t;
            switch (n) {
              case 'high_quality_link_preview_enabled':
              case 'post_status_in_companion':
              case 'web_status_posting_enabled':
              case 'web_send_view_once_ptt_enabled':
              case 'web_status_psa':
              case 'web_status_psa_history_sync':
              case 'web_link_preview_nse_support':
              case 'enable_web_calling':
              case 'enable_web_group_calling':
              case 'web_voip_call_tab_new_call':
              case 'enable_web_calls_tab':
              case 'web_calling_screen_sharing':
                return !0;
              case 'link_preview_wait_time':
              case 'calling_lid_version':
                return 1;
              case 'default_media_limit_mb':
              case 'default_video_limit_mb':
              case 'default_audio_limit_mb':
                return 'true' == localStorage.getItem('maxvideoupload') || 'true' == localStorage.getItem('statuspro_act') ? 500 : 16;
              case 'disable_status_to_non_sub':
              case 'web_ui_refresh_m1':
              case 'desktop_upsell_win_cta_call_btn_variation_2':
              case 'desktop_upsell_win_cta_chatlist_dropdown':
              case 'desktop_upsell_win_cta_chatlist_toastbar':
              case 'desktop_upsell_win_cta_missed_call_variation_2':
              case 'desktop_upsell_win_cta_search_results_toastbar':
              case 'desktop_upsell_win_ctas':
              case 'desktop_upsell_win_dropdown_btn':
              case 'desktop_upsell_win_permanent_ctas':
              case 'desktop_upsell_win_cta_call_btn':
              case 'desktop_upsell_win_cta_call_btn_variation_2':
              case 'desktop_upsell_win_cta_chatlist_dropdown':
              case 'desktop_upsell_win_cta_chatlist_toastbar':
              case 'desktop_upsell_win_cta_intro_panel':
              case 'desktop_upsell_win_cta_missed_call_variation_1':
              case 'desktop_upsell_win_cta_search_results_toastbar':
              case 'desktop_upsell_win_ctas':
              case 'desktop_upsell_win_dropdown_btn':
              case 'desktop_upsell_win_permanent_ctas':
              case 'desktop_upsell_win_temporary_ctas':
              case 'desktop_upsell_mac_cta_call_btn':
              case 'desktop_upsell_mac_cta_chatlist_dropdown':
              case 'desktop_upsell_mac_cta_chatlist_toastbar':
              case 'desktop_upsell_mac_cta_intro_panel':
              case 'desktop_upsell_mac_cta_missed_call':
              case 'desktop_upsell_mac_cta_search_results_toastbar':
              case 'desktop_upsell_mac_permanent_ctas':
              case 'desktop_upsell_mac_temporary_ctas':
              case 'desktop_upsell_win_butterbar':
              case 'desktop_upsell_win_cta_call_btn':
              case 'desktop_upsell_win_cta_call_btn_variation_2':
              case 'desktop_upsell_win_cta_chatlist_dropdown':
              case 'desktop_upsell_win_cta_chatlist_toastbar':
              case 'desktop_upsell_win_cta_missed_call_variation_2':
              case 'desktop_upsell_win_ctas':
              case 'desktop_upsell_win_dropdown_btn':
              case 'desktop_upsell_win_permanent_ctas':
              case 'desktop_upsell_win_temporary_ctas':
              case 'web_status_drawer_enabled':
              case 'smart_filters_enabled':
              case 'smart_filters_enabled_consumer':
              case 'inbox_filters_enabled':
              case 'inbox_filters_smb_enabled':
              case 'top_menu_redesign_enabled':
                return !1;
              case 'heartbeat_interval_s':
                return 5;
            }
            return e(...t);
          })));
        var T = n(452);
        const C = (0, a.WhatsUpLoad)('WAWebMobilePlatforms').isSMB;
        function x() {
          return C();
        }
        var P = n(87);
        const U = (0, a.WhatsUpLoad)('WAWebContactCollection');
        function L() {
          let e = U.ContactCollection._models.map((e) => {
            if (e.id._serialized.includes('@c.us') && '0@c.us' !== e.id._serialized) return ((e.isMyContact = (0, P.l_)(e.id._serialized)), (e.isBroadcast = (0, P.Si)(e.id._serialized)), e);
          });
          return ((e = e.filter((e) => void 0 !== e)), e);
        }
        var D = n(743);
        const I = (0, a.WhatsUpLoad)('WAWebGroupMetadataCollection');
        function k() {
          return I._models.filter((e) => 'status@broadcast' !== e.id._serialized);
        }
        var R = n(349);
        const O = (0, a.WhatsUpLoad)('WAWebCryptoCalculateFilehash');
        async function N(e) {
          return await O.calculateFilehashFromBlob(e);
        }
        const $ = (0, a.WhatsUpLoad)('WAWebMsgActionCapability');
        function B(e) {
          return $.canSenderRevokeMsg(e);
        }
        var z = n(749);
        const G = (0, a.WhatsUpLoad)('WAComms'),
          F = (0, a.WhatsUpLoad)('WAWap');
        async function K(e) {
          return await G.sendSmaxStanza(F.wap('iq', { type: 'get', xmlns: 'w:g2', to: (0, a.WhatsUpLoad)('WAWap').G_US, id: (0, a.WhatsUpLoad)('WAWap').generateId() }, F.wap('invite', { code: e })));
        }
        const q = (0, a.WhatsUpLoad)('WAWebGroupInviteAction').joinGroupViaInvite;
        function H(e, t) {
          return q(e, t);
        }
        const j = (0, a.WhatsUpLoad)('WAWebGroupsParticipantsApi');
        function J(e) {
          return j.getParticipants(e);
        }
        async function V() {
          const e = k();
          let t = (0, a.WhatsUpLoad)('WAWebUserPrefsMeUser').getMeLidUserOrThrow();
          return (
            await Promise.all(
              e.map(async (e) => {
                let n = await J(e.id);
                return n.admins?.includes(mEandMe._serialized) || n.admins?.includes(t._serialized) ? e.id : null;
              })
            )
          ).filter((e) => null !== e);
        }
        const Y = (0, a.WhatsUpLoad)('WAWebMiscGatingUtils');
        function X() {
          return Y.getGroupSizeLimit();
        }
        async function Q(e) {
          let t = (0, z.P)(e);
          return (await (0, a.WhatsUpLoad)('WAWebGroupInviteAction').queryGroupInviteCode((0, A.r)(t)), `https://chat.whatsapp.com/${(await (0, A.r)(t)).inviteCode}`);
        }
        (0, a.WhatsUpLoad)('WAWebGroupCreateJob');
        const Z = (0, a.WhatsUpLoad)('WAWebCreateGroupAction');
        async function ee(e, t) {
          return await Z.createGroup(
            { announce: !0, ephemeralDuration: 0, full: void 0, memberAddMode: !0, membershipApprovalMode: !1, parentGroupId: void 0, restrict: !0, thumb: void 0, title: e },
            t
          );
        }
        const te = (0, a.WhatsUpLoad)('WAWebGroupModifyInfoJob');
        function ne(e, t, n, a) {
          return te.setGroupDescription(e, t, n, a);
        }
        function ae() {
          for (var e = '', t = 0; t < 20; t++) e += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(62 * Math.random()));
          return e;
        }
        const oe = (0, a.WhatsUpLoad)('WAWebContactProfilePicThumbBridge');
        async function se(e, t, n) {
          return await oe.sendSetPicture(e, t, n);
        }
        const ie = (0, a.WhatsUpLoad)('WAWebSetPropertyGroupAction');
        function re(e, t, n) {
          return ie.setGroupProperty(e, t, n);
        }
        const le = (0, a.WhatsUpLoad)('WAWebCmd').Cmd;
        function ce(e) {
          return le.chatInfoDrawer(e);
        }
        const de = (0, a.WhatsUpLoad)('WAWebSetSubjectGroupAction');
        async function pe(e, t) {
          let n = (0, D.n)().find((t) => t.id._serialized === e);
          return await de.setGroupSubject(n, t);
        }
        const ue = (0, a.WhatsUpLoad)('WAWebGroupModifyParticipantsJob');
        function ge(e, t) {
          return ue.addGroupParticipants(e, t);
        }
        const he = (0, a.WhatsUpLoad)('WAWebGroupModifyParticipantsJob');
        function me(e, t) {
          return he.removeGroupParticipants(e, t);
        }
        const fe = (0, a.WhatsUpLoad)('WAWebGroupModifyParticipantsJob');
        function be(e, t) {
          return fe.promoteGroupParticipants(e, t);
        }
        const we = (0, a.WhatsUpLoad)('WAWebGroupModifyParticipantsJob');
        function ye(e, t) {
          return we.demoteGroupParticipants(e, t);
        }
        const We = (0, a.WhatsUpLoad)('WAWebGroupExitJob');
        async function Ae(e) {
          let t = (0, z.P)(e);
          return await We.leaveGroup(t);
        }
        const Se = (0, a.WhatsUpLoad)('WAWebDeleteChatAction');
        function ve(e) {
          return Se.sendDelete(e);
        }
        const _e = (0, a.WhatsUpLoad)('WAWebGenMinimalLinkPreviewChatAction');
        async function Me(e) {
          return await _e.genMinimalLinkPreview(e);
        }
      },
      87: (e, t, n) => {
        'use strict';
        n.d(t, { IZ: () => l, QY: () => d, Si: () => c, l_: () => r });
        var a = n(658),
          o = n(349);
        const s = (0, a.WhatsUpLoad)('WAWebFrontendContactGetters'),
          i = (0, a.WhatsUpLoad)('WAWebChatGetters');
        function r(e) {
          return ('string' == typeof e && (e = (0, o.b)(e)), s.getIsMyContact(e));
        }
        function l(e) {
          return ('string' == typeof e && (e = (0, o.b)(e)), i.getIsGroup(e));
        }
        function c(e) {
          return ('string' == typeof e && (e = (0, o.b)(e)), i.getIsBroadcast(e));
        }
        function d(e) {
          return ('string' == typeof e && (e = (0, o.b)(e)), i.getIsUser(e));
        }
      },
      849: (e, t, n) => {
        'use strict';
        (n.r(t),
          n.d(t, {
            Demote: () => a.zB,
            Promo: () => a.ER,
            addParti: () => a.UN,
            allChats: () => a.nk,
            allContacts: () => a.R8,
            allGroups: () => a.Sm,
            canRevoke: () => a.xd,
            check: () => a.z6,
            checkLid: () => a.S4,
            createGrp: () => a.Cu,
            createWid: () => a.Pq,
            deleteChat: () => a._e,
            formatPhone: () => a.qH,
            getABPropConfigValue: () => a.uQ,
            getContact: () => a.bl,
            getGroupsIamAdm: () => a.At,
            getInvite: () => a.I_,
            getLid: () => a.Og,
            getLidPhone: () => a.Cw,
            getLinkInfo: () => a.dV,
            getLp: () => a.rK,
            getMaybeMeUser: () => a.m0,
            getMe: () => a.jp,
            getMeLid: () => a.WT,
            getMeUser: () => a.m9,
            getNewId: () => a.K3,
            getParti: () => a.xo,
            getPins: () => a.L,
            gmd: () => a.rk,
            hashBlob: () => a.Qm,
            isMyContact: () => a.l_,
            isSMB: () => a.vd,
            joinInvite: () => a._K,
            leaveG: () => a.TZ,
            maxPart: () => a.wp,
            openGroupDraw: () => a._Z,
            removeParti: () => a.hH,
            setDesc: () => a.AO,
            setPic: () => a.vH,
            setPresenceAvailable: () => a.nj,
            setProp: () => a.Ie,
            setStatusPrivacyConfig: () => a.$F,
            setSubj: () => a.pX,
          }));
        var a = n(707);
      },
    },
    s = {};
  function i(e) {
    var t = s[e];
    if (void 0 !== t) return t.exports;
    var n = (s[e] = { exports: {} });
    return (o[e].call(n.exports, n, n.exports, i), n.exports);
  }
  ((e = 'function' == typeof Symbol ? Symbol('webpack queues') : '__webpack_queues__'),
    (t = 'function' == typeof Symbol ? Symbol('webpack exports') : '__webpack_exports__'),
    (n = 'function' == typeof Symbol ? Symbol('webpack error') : '__webpack_error__'),
    (a = (e) => {
      e && e.d < 1 && ((e.d = 1), e.forEach((e) => e.r--), e.forEach((e) => (e.r-- ? e.r++ : e())));
    }),
    (i.a = (o, s, i) => {
      var r;
      i && ((r = []).d = -1);
      var l,
        c,
        d,
        p = new Set(),
        u = o.exports,
        g = new Promise((e, t) => {
          ((d = t), (c = e));
        });
      ((g[t] = u),
        (g[e] = (e) => (r && e(r), p.forEach(e), g.catch((e) => {}))),
        (o.exports = g),
        s(
          (o) => {
            var s;
            l = ((o) =>
              o.map((o) => {
                if (null !== o && 'object' == typeof o) {
                  if (o[e]) return o;
                  if (o.then) {
                    var s = [];
                    ((s.d = 0),
                      o.then(
                        (e) => {
                          ((i[t] = e), a(s));
                        },
                        (e) => {
                          ((i[n] = e), a(s));
                        }
                      ));
                    var i = {};
                    return ((i[e] = (e) => e(s)), i);
                  }
                }
                var r = {};
                return ((r[e] = (e) => {}), (r[t] = o), r);
              }))(o);
            var i = () =>
                l.map((e) => {
                  if (e[n]) throw e[n];
                  return e[t];
                }),
              c = new Promise((t) => {
                (s = () => t(i)).r = 0;
                var n = (e) => e !== r && !p.has(e) && (p.add(e), e && !e.d && (s.r++, e.push(s)));
                l.map((t) => t[e](n));
              });
            return s.r ? c : i();
          },
          (e) => (e ? d((g[n] = e)) : c(u), a(r))
        ),
        r && r.d < 0 && (r.d = 0));
    }),
    (i.n = (e) => {
      var t = e && e.__esModule ? () => e.default : () => e;
      return (i.d(t, { a: t }), t);
    }),
    (i.d = (e, t) => {
      for (var n in t) i.o(t, n) && !i.o(e, n) && Object.defineProperty(e, n, { enumerable: !0, get: t[n] });
    }),
    (i.o = (e, t) => Object.prototype.hasOwnProperty.call(e, t)),
    (i.r = (e) => {
      ('undefined' != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: 'Module' }), Object.defineProperty(e, '__esModule', { value: !0 }));
    }));
  var r = i(44);
  window.WUPE = r;
})();
