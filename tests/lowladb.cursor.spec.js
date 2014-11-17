testUtils.eachDatastore(function(dsName) {
  describe('LowlaDB Cursor (' + dsName + ')', function () {
    beforeEach(testUtils.setUpFn(dsName));
    afterEach(testUtils.tearDownFn(dsName));

    var coll, coll2;
    beforeEach(function () {
      coll = lowla.collection('dbName', 'TestColl');
      coll2 = lowla.collection('dbName', 'OtherColl');

      return Promise.all([
        coll.insert([{a: 1}, {a: 2}, {a: 3}]),
        coll2.insert([{b: 7, c: 'a', x: 1, s: 5}, {b: 12, c: 'q', y: 2, s: 5}, {b: 3, c: 'f', z: 3, s: 5}])
      ]);
    });

    describe('Constructor', function () {
      it('sets default options', function () {
        var check = new LowlaDB.Cursor(coll, {});
        check._options.should.deep.equal({sort: null, limit: 0, showPending: false});
      });

      it('merges provided options with defaults', function () {
        var check = new LowlaDB.Cursor(coll, {}, {limit: 10});
        check._options.should.deep.equal({sort: null, limit: 10, showPending: false});
      });
    });

    describe('toArray()', function () {
      it('can find no matching documents', function (done) {
        var cursor = coll.find({z: 1});
        cursor
          .toArray()
          .then(function (arr) {
            arr.should.have.length(0);
            cursor.toArray(testUtils.cb(done, function (err, arr) {
              should.not.exist(err);
              arr.should.have.length(0);
            }));
          });
      });

      it('only finds documents in the correct collection', function () {
        return coll
          .find()
          .toArray()
          .then(function (arr) {
            arr.should.have.length(3);
            should.exist(arr[0].a);
            should.exist(arr[1].a);
            should.exist(arr[2].a);
          });
      });

      it('fails when filter errors', function (done) {
        testUtils.sandbox.stub(LowlaDB.Cursor.prototype, '_applyFilter').throws(Error('Invalid filter'));
        coll
          .find()
          .toArray()
          .should.eventually.be.rejectedWith(Error, 'Invalid filter');

        coll.find().toArray(testUtils.cb(done, function (err, arr) {
          should.exist(err);
          should.not.exist(arr);
          err.should.match(/Invalid filter/);
        }));
      });
    });

    describe('each()', function () {
      it('can enumerate documents', function (done) {
        var docs = [];
        coll.find().each(function (err, doc) {
          docs.push(doc);
        });

        setTimeout(checkDocs, 1);

        function checkDocs() {
          if (3 === docs.length) {
            try {
              docs[0].should.not.equal(docs[1]);
              docs[0].should.not.equal(docs[2]);
              docs[1].should.not.equal(docs[2]);
              done();
            }
            catch (e) {
              done(e);
            }
          }
          else {
            setTimeout(checkDocs, 1);
          }
        }
      });

      it('does nothing with no callback', function (done) {
        try {
          coll.find().each();
          done();
        }
        catch (e) {
          done(e);
        }
      });

      it('fails when filter errors', function (done) {
        testUtils.sandbox.stub(LowlaDB.Cursor.prototype, '_applyFilter').throws(Error('Invalid filter'));
        coll.find().each(function (err, doc) {
          try {
            should.exist(err);
            err.should.match(/Invalid filter/);
            done();
          }
          catch (e) {
            done(e);
          }
        });
      });
    });

    describe('sort()', function () {
      it('can sort numbers', function () {
        return coll2
          .find()
          .sort('b')
          .toArray()
          .then(function (arr) {
            arr.should.have.length(3);
            arr[0].b.should.equal(3);
            arr[1].b.should.equal(7);
            arr[2].b.should.equal(12);
          });
      });

      it('can sort text', function () {
        return coll2
          .find()
          .sort('c')
          .toArray()
          .then(function (arr) {
            arr.should.have.length(3);
            arr[0].c.should.equal('a');
            arr[1].c.should.equal('f');
            arr[2].c.should.equal('q');
          });
      });

      it('can sort in descending order', function () {
        return coll2
          .find()
          .sort([['b', -1]])
          .toArray()
          .then(function (arr) {
            arr.should.have.length(3);
            arr[0].b.should.equal(12);
            arr[1].b.should.equal(7);
            arr[2].b.should.equal(3);
          });
      });

      it('can sort documents without the sort criteria', function () {
        return coll2
          .find()
          .sort('x')
          .toArray()
          .then(function (arr) {
            arr.should.have.length(3);
            arr[2].x.should.equal(1);

            return coll2
              .find()
              .sort('y')
              .toArray();
          })
          .then(function (arr) {
            arr.should.have.length(3);
            arr[2].y.should.equal(2);
          });
      });

      it('can sort documents with the same sort value', function () {
        return coll2
          .find()
          .sort([['s', 1], 'b'])
          .toArray()
          .then(function (arr) {
            arr.should.have.length(3);
            arr[0].b.should.equal(3);
            arr[1].b.should.equal(7);
            arr[2].b.should.equal(12);
          });
      });
    });

    describe('limit()', function () {
      it('can limit sorted documents', function () {
        return coll
          .find({})
          .sort('a')
          .limit(2)
          .toArray()
          .then(function (arr) {
            arr.should.have.length(2);
            arr[0].a.should.equal(1);
            arr[1].a.should.equal(2);

            return coll.find({}).limit(1).sort([['a', -1]]).toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            arr[0].a.should.equal(3);
          });
      });
    });

    describe('showPending()', function () {
      it('sets modified documents as pending sync', function () {
        return coll
          .find()
          .showPending()
          .toArray()
          .then(function (arr) {
            should.exist(arr);
            arr.length.should.equal(3);
            arr[0].$pending.should.equal(true);
            arr[1].$pending.should.equal(true);
            arr[2].$pending.should.equal(true);
          });
      });
    });

    describe('count()', function () {
      it('can count the documents', function () {
        return coll
          .find()
          .count()
          .then(function (count) {
            count.should.equal(3);
            return coll.find({a: 2}).count();
          })
          .then(function (count) {
            count.should.equal(1);
            return coll.find({}).limit(2).count(true);
          })
          .then(function (count) {
            count.should.equal(2);
            return coll.find().limit(20).count(true);
          })
          .then(function (count) {
            count.should.equal(3);
            return coll.find().limit(2).count(false);
          })
          .then(function (count) {
            count.should.equal(3);
          });
      });

      it('provides count via callback', function (done) {
        coll
          .find()
          .count(testUtils.cb(done, function (err, count) {
            should.not.exist(err);
            count.should.equal(3);
          }));
      });

      it('supports both arguments to count', function (done) {
        coll
          .find()
          .limit(2)
          .count(true, testUtils.cb(done, function (err, count) {
            should.not.exist(err);
            count.should.equal(2);
          }));
      });

      it('fails when filter errors', function (done) {
        testUtils.sandbox.stub(LowlaDB.Cursor.prototype, '_applyFilter').throws(Error('Invalid filter'));
        coll
          .find()
          .count()
          .should.eventually.be.rejectedWith(Error, /Invalid filter/)
          .then(function () {
            coll.find().count(testUtils.cb(done, function (err, count) {
              should.not.exist(count);
              err.should.match(/Invalid filter/);
            }));
          })
          .then(null, done);
      });
    });

    describe('on()', function () {
      it('can watch for changes on collections', function () {
        var wrappedCallback = null;

        var callback = function (err, cursor) {
          wrappedCallback(err, cursor);
        };

        return Promise.resolve()
          .then(function () {
            return new Promise(function (resolve, reject) {
              wrappedCallback = function (err, cursor) {
                cursor.toArray().then(function (arr) {
                  try {
                    arr.should.have.length(3);
                    resolve();
                  }
                  catch (err) {
                    reject(err);
                  }
                });
              };

              coll.find({}).sort('a').on(callback);
            });
          })
          .then(function () {
            return new Promise(function (resolve, reject) {
              wrappedCallback = function (err, cursor) {
                cursor.toArray().then(function (arr) {
                  try {
                    arr.should.have.length(3);
                    arr[0].b.should.equal(5);
                    resolve();
                  }
                  catch (e) {
                    reject(e);
                  }
                });
              };

              coll.findAndModify({a: 1}, {$set: {b: 5}});
            });
          });
      });
    });
  });
});
