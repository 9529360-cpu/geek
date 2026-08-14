var Majordomo = function (t, i, o, a) {
  ((this.inputNudge = 'msg.majordomo.input.nudge'),
    (this.outputNudge = 'msg.majordomo.output.nudge'),
    (this.inputData = 'msg.majordomo.input.data'),
    (this.outputData = 'msg.majordomo.output.data'),
    (this.inputId = 'xml.majordomo.input.data'),
    (this.outputId = 'xml.majordomo.output.data'),
    (this.origin = o),
    (this.allowance = a),
    (this.asClient = i),
    (this.context = t));
};
((Majordomo.prototype.setUpListener = function (t) {
  var i = (this.asClient && this.outputNudge) || this.inputNudge,
    o = (this.asClient && this.outputData) || this.inputData,
    a = this;
  this.context.addEventListener(
    'message',
    function (e) {
      (a.allowance && e.origin != a.allowance) || (e.data == i ? t() : e.data == o && t(a.unserializeData.call(a)));
    },
    !1
  );
}),
  (Majordomo.prototype.sendNudge = function () {
    var t = (this.asClient && this.inputNudge) || this.outputNudge;
    this.context.postMessage(t, this.origin);
  }),
  (Majordomo.prototype.sendData = function (t) {
    var i = (this.asClient && this.inputData) || this.outputData;
    (this.serializeData(t), this.context.postMessage(i, this.origin));
  }),
  (Majordomo.prototype.serializeData = function (t) {
    var i = document.createElement('xml');
    ((i.id = (this.asClient && this.inputId) || this.outputId), (i.style.display = 'none'), (i.innerHTML = JSON.stringify(t)), document.body.appendChild(i));
  }),
  (Majordomo.prototype.unserializeData = function () {
    var t = document.getElementById((this.asClient && this.outputId) || this.inputId),
      i = JSON.parse(t.innerHTML);
    return (t.remove(), i);
  }));
