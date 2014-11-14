var testUtils = (function() {
  var service = {
    setUp: setUp,
    tearDown: tearDown,
    cb: makeCb,
    sandbox: undefined,
    eachDatastore: eachDatastore
  };
  return service;

  function setUp(done) {
    service.sandbox = sinon.sandbox.create();
    var req = indexedDB.deleteDatabase( "lowla" );
    req.onsuccess = function () {
      done();
    };

    req.onerror = function () {
      done('failed to delete db in beforeEach');
    };
  }

  function tearDown() {
    if (service.sandbox) {
      service.sandbox.restore();
      service.sandbox = undefined;
    }
    LowlaDB.close();
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
    LowlaDB.utils.keys(LowlaDB.datastores).forEach(fn);
  }

})();
