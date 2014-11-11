var testUtils = (function() {
  var service = {
    setUp: setUp,
    tearDown: tearDown,
    cb: makeCb
  };
  return service;

  function setUp(done) {
    var req = indexedDB.deleteDatabase( "lowla" );
    req.onsuccess = function () {
      done();
    };

    req.onerror = function () {
      done('failed to delete db in beforeEach');
    };
  }

  function tearDown() {
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
})();
