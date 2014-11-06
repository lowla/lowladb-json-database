var testUtils = (function() {
  var service = {
    setUp: setUp,
    tearDown: tearDown
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
})();
