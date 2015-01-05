describe('LowlaDB API', function () {
  'use strict';

  describe('Events', function () {
    var lowla;
    beforeEach(function () {
      lowla = new LowlaDB();
    });

    afterEach(function () {
      lowla.off();
      lowla = null;
    });

    it('can register and receive a single event', function () {
      var cb = sinon.stub();
      lowla.on('myEvent', cb);
      lowla.emit('myEvent');
      cb.callCount.should.equal(1);
      lowla.emit('myEvent');
      cb.callCount.should.equal(2);
    });

    it('can register multiple listeners to one event', function () {
      var cb1 = sinon.stub();
      var cb2 = sinon.stub();
      lowla.on('myEvent', cb1);
      lowla.on('myEvent', cb2);
      lowla.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
      lowla.emit('myEvent');
      cb1.callCount.should.equal(2);
      cb2.callCount.should.equal(2);
    });

    it('can register multiple events', function () {
      var cb1 = sinon.stub();
      var cb2 = sinon.stub();
      lowla.on('myEvent', cb1);
      lowla.on('myEvent2', cb2);
      lowla.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(0);
      lowla.emit('myEvent2');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
    });

    it('can remove a listener from an event', function () {
      var cb1 = sinon.stub();
      var cb2 = sinon.stub();
      lowla.on('myEvent', cb1);
      lowla.on('myEvent', cb2);
      lowla.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
      lowla.off('myEvent', cb1);
      lowla.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(2);
    });

    it('can remove all listeners from an event', function () {
      var cb1 = sinon.stub();
      var cb2 = sinon.stub();
      var cb3 = sinon.stub();
      lowla.on('myEvent', cb1);
      lowla.on('myEvent', cb2);
      lowla.on('myEvent3', cb3);
      lowla.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
      cb3.callCount.should.equal(0);
      lowla.emit('myEvent3');
      cb3.callCount.should.equal(1);
      lowla.off('myEvent');
      lowla.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
      cb3.callCount.should.equal(1);
      lowla.emit('myEvent3');
      cb3.callCount.should.equal(2);
    });
  });
});
