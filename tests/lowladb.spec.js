
describe('LowlaDB API', function() {

  describe('Events', function() {
    afterEach(function() {
      LowlaDB.off();
    });

    it('can register and receive a single event', function() {
      var cb = sinon.stub();
      LowlaDB.on('myEvent', cb);
      LowlaDB.emit('myEvent');
      cb.callCount.should.equal(1);
      LowlaDB.emit('myEvent');
      cb.callCount.should.equal(2);
    });

    it('can register multiple listeners to one event', function() {
      var cb1 = sinon.stub();
      var cb2 = sinon.stub();
      LowlaDB.on('myEvent', cb1);
      LowlaDB.on('myEvent', cb2);
      LowlaDB.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
      LowlaDB.emit('myEvent');
      cb1.callCount.should.equal(2);
      cb2.callCount.should.equal(2);
    });

    it('can register multiple events', function() {
      var cb1 = sinon.stub();
      var cb2 = sinon.stub();
      LowlaDB.on('myEvent', cb1);
      LowlaDB.on('myEvent2', cb2);
      LowlaDB.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(0);
      LowlaDB.emit('myEvent2');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
    });

    it('can remove a listener from an event', function() {
      var cb1 = sinon.stub();
      var cb2 = sinon.stub();
      LowlaDB.on('myEvent', cb1);
      LowlaDB.on('myEvent', cb2);
      LowlaDB.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
      LowlaDB.off('myEvent', cb1);
      LowlaDB.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(2);
    });

    it('can remove all listeners from an event', function() {
      var cb1 = sinon.stub();
      var cb2 = sinon.stub();
      var cb3 = sinon.stub();
      LowlaDB.on('myEvent', cb1);
      LowlaDB.on('myEvent', cb2);
      LowlaDB.on('myEvent3', cb3);
      LowlaDB.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
      cb3.callCount.should.equal(0);
      LowlaDB.emit('myEvent3');
      cb3.callCount.should.equal(1);
      LowlaDB.off('myEvent');
      LowlaDB.emit('myEvent');
      cb1.callCount.should.equal(1);
      cb2.callCount.should.equal(1);
      cb3.callCount.should.equal(1);
      LowlaDB.emit('myEvent3');
      cb3.callCount.should.equal(2);
    });
  });

});