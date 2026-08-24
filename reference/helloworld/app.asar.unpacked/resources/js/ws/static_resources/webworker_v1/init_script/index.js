self.window = self;
function doImportScripts(e) {
  if (self.trustedTypes && self.trustedTypes.createPolicy) {
    var t = self.trustedTypes.createPolicy("workerPolicy", {
      createScriptURL: function(e) {
        return e
      }
    });
    importScripts(t.createScriptURL(e))
  } else
    importScripts(e)
}
function generateWorkerID() {
  var e = Math.floor(Math.random() * Math.pow(36, 6))
    , t = e.toString(36);
  return "0".repeat(6 - t.length) + t
}
if ("SharedWorkerGlobalScope"in self && self instanceof self.SharedWorkerGlobalScope) {
  var portsBuffer = []
    , messageBuffer = []
    , unsubscribeCleanupFunctions = []
    , hasRun = !1
    , initAttemptCount = 0;
  self.setTimeout(function() {
    if (!hasRun) {
      try {
        var e;
        (e = portsBuffer[0]) == null || e.postMessage({
          type: "self-terminate",
          response: {
            from: "init-v1"
          }
        })
      } catch (e) {}
      self.close()
    }
  }, 3e5),
    self.shared_worker_bootstrap_buffer = function() {
      for (hasRun = !0; unsubscribeCleanupFunctions.length; )
        try {
          var e = unsubscribeCleanupFunctions.pop();
          e()
        } catch (e) {}
      var a = portsBuffer
        , i = messageBuffer;
      return messageBuffer = [],
        portsBuffer = [],
        {
          ports: a,
          messages: i
        }
    }
  ;
  var connectListener = function(e) {
    self.worker_id == null && (self.worker_id = generateWorkerID());
    var l = {}
      , s = e.ports[0];
    s.postMessage({
      type: "connection-ack",
      response: {
        from: "initScript",
        workerID: self.worker_id
      }
    });
    var u = function(e) {
      l.c || (l.c = !0,
        s.postMessage({
          type: "worker-init-mark",
          response: {
            point: "c"
          }
        }));
      var o = e.data;
      if (typeof o == "object" && (o == null ? void 0 : o.type) === "execute-worker") {
        l.d || (l.d = !0,
          s.postMessage({
            type: "worker-init-mark",
            response: {
              point: "d"
            }
          }));
        var a = o.args instanceof Array ? o.args : null;
        if (a == null || typeof a[0] != "object")
          return;
        var i = a[0]
          , u = a[1];
        u === !0 && (self.__DEV__ = 1),
          messageBuffer.push({
            e,
            port: s
          }),
        l.e || (l.e = !0,
          s.postMessage({
            type: "worker-init-mark",
            response: {
              point: "e"
            }
          }));
        try {
          doImportScripts(i.url),
            s.postMessage({
              type: "execute-worker-imports",
              response: {
                attempts: ++initAttemptCount
              }
            })
        } catch (e) {
          s.postMessage({
            type: "execute-worker-imports",
            response: {
              err: e.message,
              attempts: ++initAttemptCount
            }
          })
        }
      } else
        messageBuffer.push({
          e,
          port: s
        })
    };
    l.a || (l.a = !0,
      s.postMessage({
        type: "worker-init-mark",
        response: {
          point: "a"
        }
      })),
      s.addEventListener("message", u),
      unsubscribeCleanupFunctions.push(function() {
        return s.removeEventListener("message", u)
      }),
      s.start(),
      portsBuffer.push(s),
    l.b || (l.b = !0,
      s.postMessage({
        type: "worker-init-mark",
        response: {
          point: "b"
        }
      }))
  };
  self.addEventListener("connect", connectListener),
    unsubscribeCleanupFunctions.push(function() {
      return self.removeEventListener("connect", connectListener)
    })
} else {
  var initMessageHandler = function(e) {
    var r = e.data;
    if (typeof r == "object" && (r == null ? void 0 : r.type) === "sr-init" && typeof r.bundleUrl == "string" && typeof r.resource == "object") {
      if (r.isDev === !0 && (self.__DEV__ = !0),
      r.logImportScriptsErrors === !0)
        try {
          doImportScripts(r.bundleUrl),
            self.postMessage({
              type: "importScripts_success"
            })
        } catch (e) {
          var o = self.performance && self.performance.getEntriesByName && self.performance.getEntriesByName(r.bundleUrl)
            , a = o && o[0];
          throw self.postMessage({
            type: "importScripts_error",
            source: "init_script",
            error_msg: e && e.message,
            error_code: e && (e == null ? void 0 : e.code),
            error_name: e && (e == null ? void 0 : e.name),
            stack: e && e.stack,
            perfEntry: a ? {
              responseStatus: a.responseStatus,
              encodedBodySize: a.encodedBodySize,
              transferSize: a.transferSize,
              duration: a.duration
            } : null
          }),
            e
        }
      else
        doImportScripts(r.bundleUrl);
      if (r.doNotStartBundle !== !0) {
        var i;
        StartBundle.apply(void 0, [r.resource].concat((i = r.initArgs) != null ? i : []))
      }
      self.removeEventListener("message", initMessageHandler)
    }
  };
  self.addEventListener("message", initMessageHandler)
}
