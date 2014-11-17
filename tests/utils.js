var testUtils = (function() {
  var service = {
    setUpFn: setUpFn,
    tearDownFn: tearDownFn,
    cb: makeCb,
    sandbox: undefined,
    eachDatastore: eachDatastore
  };
  return service;

  function setUpFn(dsName) {
    return function setUp(done) {
      window.lowla = new LowlaDB({ datastore: dsName });

      service.sandbox = sinon.sandbox.create();
      var req = indexedDB.deleteDatabase("lowla");
      req.onsuccess = function () {
        done();
      };

      req.onerror = function () {
        done('failed to delete db in beforeEach');
      };
    }
  }

  function tearDownFn() {
    return function tearDown() {
      if (service.sandbox) {
        service.sandbox.restore();
        service.sandbox = undefined;
      }
      lowla.close();
    }
  }

  function makeCb(done, fn) {
    return function(err, obj) {
      try {
        fn(err, obj);
        done();
      }
      catch (e) {
        done(e);
      }
    }
  }

  function eachDatastore(fn) {
    LowlaDB.utils.keys(LowlaDB._datastores).forEach(fn);
  }

})();
