
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

    it('can find and modify a document', function() {
      return coll.insert({a: 1})
        .then(function(obj) {
          return coll.findAndModify({_id: obj._id}, {$set: { a: 2}} );
        })
        .then(function(newObj) {
          newObj.a.should.equal(2);
        })
        .then(function() {
          return coll.find().toArray();
        })
        .then(function(arr) {
          arr.should.have.length(1);
          arr[0].a.should.equal(2);
        });
    });

    var insertDocuments = function(docs) {
      return Promise.all(docs.map(function(doc) {
        return coll.insert(doc);
      }));
    };

    var insertThreeDocuments = function() {
      return coll.insert({ a: 1})
        .then(function(obj) {
          id1 = obj._id;
          return coll.insert({ a: 2});
        })
        .then(function(obj) {
          id2 = obj._id;
          return coll.insert({ a: 3});
        })
        .then(function(obj) {
          id3 = obj._id;
          return coll.find({}).toArray();
        });
    };

    it('can find and modify the correct document among many documents', function() {
      var id1, id2, id3;
      return coll.insert({ a: 1})
        .then(function(obj) {
          id1 = obj._id;
          return coll.insert({ a: 2});
        })
        .then(function(obj) {
          id2 = obj._id;
          return coll.insert({ a: 3});
        })
        .then(function(obj) {
          id3 = obj._id;
          return coll.find({}).toArray();
        })
        .then(function(arr) {
          arr.should.have.length(3);
          return coll.findAndModify({a: 2}, { $set: { a: 5 }});
        })
        .then(function() {
          return coll.find({_id: id2 }).toArray();
        })
        .then(function(arr) {
          arr.should.have.length(1);
          arr[0].a.should.equal(5);
        });
    });

    it('knows to not modify documents that are missing', function() {
      return coll.insert({a: 1})
        .then(function() {
          return coll.insert({a: 2});
        })
        .then(function() {
          return coll.insert({a: 3});
        })
        .then(function() {
          return coll.findAndModify({x: 22}, {$set: {b: 2}});
        })
        .then(function() {
          return coll.find({}).sort('a').toArray();
        })
        .then(function(arr) {
          arr.should.have.length(3);
          should.not.exist(arr[0].b);
          should.not.exist(arr[1].b);
          should.not.exist(arr[2].b);
        });
    });

    it('can remove a document', function() {
      var id1, id2, id3;
      return coll.insert({a: 1})
        .then(function(obj) {
          id1 = obj._id;
          return coll.insert({a: 2});
        })
        .then(function(obj) {
          id2 = obj._id;
          return coll.insert({a: 3});
        })
        .then(function(obj) {
          id3 = obj._id;
          return coll.remove({a: 2});
        })
        .then(function(count) {
          count.should.equal(1);
          return coll.find({}).sort('a').toArray();
        })
        .then(function(arr) {
          arr.should.have.length(2);
          arr[0].a.should.equal(1);
          arr[1].a.should.equal(3);
        });
    });

    it('can limit the number of returned documents', function() {
      return insertThreeDocuments()
        .then(function() {
          return coll.find({}).limit(1).toArray();
        })
        .then(function(arr) {
          arr.should.have.length(1);
          return coll.find({}).limit(2).toArray();
        })
        .then(function(arr) {
          arr.should.have.length(2);
          return coll.find({}).limit(55).toArray();
        })
        .then(function(arr) {
          arr.should.have.length(3);
        });
    });

    it('can sort documents', function() {
      return insertDocuments([{a: 1}, {a: 20}, {a: 55}, {a: 3}])
        .then(function(arr) {
          arr.should.have.length(4);
          return coll.find({}).sort('a').toArray();
        })
        .then(function(arr) {
          arr.should.have.length(4);
          arr[0].a.should.equal(1);
          arr[1].a.should.equal(3);
          arr[2].a.should.equal(20);
          arr[3].a.should.equal(55);

          return coll.find({}).sort(['a', -1]).toArray();
        })
        .then(function(arr) {
          arr.should.have.length(4);
          arr[0].a.should.equal(55);
          arr[1].a.should.equal(20);
          arr[2].a.should.equal(3);
          arr[3].a.should.equal(1);
        });
    });

    it('can limit sorted documents', function() {
      return insertDocuments([{a: 1}, {a: 20}, {a: 55}, {a: 3}])
        .then(function(arr) {
          arr.should.have.length(4);
          return coll.find({}).sort('a').limit(2).toArray();
        })
        .then(function(arr) {
          arr.should.have.length(2);
          arr[0].a.should.equal(1);
          arr[1].a.should.equal(3);

          return coll.find({}).limit(1).sort(['a', -1]).toArray();
        })
        .then(function(arr) {
          arr.should.have.length(1);
          arr[0].a.should.equal(55);
        });
    });

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

    // TODO - test that findAndModify without ops will preserve the _id
  });
});