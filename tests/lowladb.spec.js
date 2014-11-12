
describe('LowlaDB API', function() {
  it('exists', function() {
    should.exist(LowlaDB);
  });

  describe('Collections', function() {
    var indexedDB = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.oIndexedDB || window.msIndexedDB;
    beforeEach(function(done) {
      var req = indexedDB.deleteDatabase( "lowla" );
      req.onsuccess = function () {
        done();
      };

      req.onerror = function () {
        done('failed to delete db in beforeEach');
      };

      req.onblocked = function () {
        console.log( 'db blocked' );
      };
    });

    var coll = LowlaDB.collection('dbName', 'collectionOne');
    var collTwo = LowlaDB.collection('dbName', 'collectionTwo');

    afterEach(function() {
      LowlaDB.close();
    });

    it('can be created', function() {
      should.exist(coll);
      coll.insert.should.be.a('function');
      coll.find.should.be.a('function');
      coll.findAndModify.should.be.a('function');
    });

    it('can create and retrieve documents', function() {
      return coll.insert({a:1})
        .then(function(obj) {
          should.exist(obj);
          should.exist(obj._id);
          obj.a.should.equal(1);
          return obj._id;
        })
        .then(function(objId) {
          return coll.find({_id: objId}).toArray();
        })
        .then(function(arr) {
          should.exist(arr);
          arr.should.have.length(1);
          return arr[0];
        })
        .then(function(checkObj) {
          checkObj.a.should.equal(1);
        });
    });

    it('only retrieve documents from the given collection', function() {
      return coll.insert({a: 1})
        .then(function() {
          return collTwo.insert({a: 2});
        })
        .then(function() {
          return coll.find().toArray();
        })
        .then(function(arr) {
          should.exist(arr);
          arr.should.have.length(1);
          arr[0].a.should.equal(1);
        });
    });

    var insertDocuments = function(docs) {
      return Promise.all(docs.map(function(doc) {
        return coll.insert(doc);
      }));
    };

    it('can watch for changes on collections', function() {
      var wrappedCallback = null;

      var callback = function(err, cursor) {
        wrappedCallback(err, cursor);
      };

      return insertDocuments([{a: 1}, {a: 2}])
        .then(function(arr) {
          return new Promise(function(resolve, reject) {
            wrappedCallback = function(err, cursor) {
              cursor.toArray().then(function (arr) {
                arr.should.have.length(2);
                resolve();
              });
            };

            coll.find({}).sort('a').on(callback);
          });
        })
        .then(function() {
          return new Promise(function(resolve, reject) {
            wrappedCallback = function(err, cursor) {
              cursor.toArray().then(function (arr) {
                try {
                  arr.should.have.length(2);
                  arr[0].b.should.equal(5);
                  resolve();
                }
                catch (e) {
                  reject(e);
                }
              });
            };

            coll.findAndModify({a: 1}, { $set: { b: 5 } });
          });
        })
        ;
    });
  });
});