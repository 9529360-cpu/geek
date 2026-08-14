var Mutex = function (lifo) {
  ((this.lifo = lifo || !1), (this.locked = !1), (this.waitingQueue = []));
};
((Mutex.prototype.lock = function (callback) {
  this.locked ? this.waitingQueue.push(callback) : ((this.locked = !0), setTimeout(callback, 0));
}),
  (Mutex.prototype.unlock = function () {
    var callback;
    this.waitingQueue.length ? ((callback = this.lifo ? this.waitingQueue.pop() : this.waitingQueue.shift()), setTimeout(callback, 0)) : (this.locked = !1);
  }));
