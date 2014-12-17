testUtils.eachDatastore(function(dsName) {
  describe('LowlaDB Collection (' + dsName + ')', function () {
    beforeEach(testUtils.setUpFn(dsName));
    afterEach(testUtils.tearDownFn());

    describe('count()', function () {
      it('can count the documents in a collection', function (done) {
        var coll = lowla.collection('dbName', 'TestColl');
        coll
          .insert([{a: 1}, {a: 2}, {a: 3}])
          .then(function () {
            return coll.count();
          })
          .then(function (count) {
            count.should.equal(3);
            return coll.count({a: 2});
          })
          .then(function (count) {
            count.should.equal(1);
            return coll.count({});
          })
          .then(function (count) {
            count.should.equal(3);
            return coll.count({z: 5});
          })
          .then(function (count) {
            count.should.equal(0);
          })
          .then(function () {
            coll.count(testUtils.cb(done, function (err, count) {
              should.not.exist(err);
              count.should.equal(3);
            }));
          })
          .then(null, done);
      });

    });

    describe('insert()', function () {
      it('can insert documents using a custom lowlaId generator', function(done) {
        lowla.close();
        lowla = new LowlaDB({ datastore: dsName, lowlaId: ssnIdGenerator });
        var coll = lowla.collection('dbName', 'CollName');
        var doc = { ssn: '020-43-9853' };
        
        coll
          .insert(doc)
          .then(function() {
            lowla.datastore.loadDocument('dbName.CollName', doc.ssn, testUtils.cb(done, function(foundDoc) {
              should.exist(foundDoc);
              foundDoc.ssn.should.equal(doc.ssn);
            }));
          })
          .then(null, done);
        
        function ssnIdGenerator(coll, doc) {
          return doc.ssn;
        }
      });
      
      it('can create documents', function (done) {
        var coll = lowla.collection('dbName', 'CollName');
        coll.insert({a: 1})
          .then(function (doc) {
            should.exist(doc);
            should.exist(doc._id);
            doc.a.should.equal(1);
          })
          .then(function () {
            coll.insert({b: 2}, testUtils.cb(done, function (err, doc) {
              should.not.exist(err);
              should.exist(doc);
              doc.b.should.equal(2);
            }));
          })
          .then(null, done);
      });

      it('can insert multiple documents at once', function (done) {
        var coll = lowla.collection('dbName', 'CollName');
        coll.insert([{a: 1}, {b: 2}])
          .then(function (docs) {
            docs.should.be.a('array');
            docs.should.have.length(2);
            docs[0].a.should.equal(1);
            docs[1].b.should.equal(2);
            should.not.exist(docs._id);
            should.exist(docs[0]._id);
            should.exist(docs[1]._id);
          })
          .then(function () {
            coll.insert([{c: 3}, {d: 4}], testUtils.cb(done, function (err, docs) {
              should.not.exist(err);
              docs.should.be.a('array');
              docs.should.have.length(2);
              docs[0].c.should.equal(3);
              docs[1].d.should.equal(4);
              should.not.exist(docs._id);
              should.exist(docs[0]._id);
              should.exist(docs[1]._id);
            }));
          })
          .then(null, done);
      });

      it('prevents inserting $field names', function (done) {
        var coll = lowla.collection('dbName', 'CollName');
        coll.insert({$field: 1})
          .then(function () {
            done(Error('Promise should not have resolved successfully'));
          }, function (err) {
            should.exist(err);
            err.should.match(/\$field/);
          })
          .then(function () {
            coll.insert({$field2: 1}, testUtils.cb(done, function (err, doc) {
              should.exist(err);
              should.not.exist(doc);
              err.should.match(/\$field2/);
            }));
          })
          .then(null, done);
      });
    });

    describe('find()', function () {
      it('with no documents in datastore works without error', function (done) {
        var coll = lowla.collection('dbName', 'CollName');
        coll.find({}).toArray()
          .then(function (docs) {
            should.exist(docs);
            docs.should.have.length(0);
          })
          .then(function () {
            coll.find({}).toArray(testUtils.cb(done, function (err, docs) {
              should.not.exist(err);
              should.exist(docs);
              docs.should.have.length(0);
            }));
          })
          .then(null, done);
      });

      it('with no matching documents works without error', function (done) {
        var coll = lowla.collection('dbName', 'CollName');
        coll.insert([{a: 1}, {b: 2}])
          .then(function (docs) {
            docs.should.have.length(2);
            return coll.find({a: 2}).toArray();
          })
          .then(function (docs) {
            should.exist(docs);
            docs.should.have.length(0);
          })
          .then(function () {
            coll.find({a: 2}).toArray(testUtils.cb(done, function (err, docs) {
              should.not.exist(err);
              should.exist(docs);
              docs.should.have.length(0);
            }));
          })
          .then(null, done);
      });

      it('finds a single document among many', function (done) {
        var coll = lowla.collection('dbName', 'CollName');
        coll.insert([{a: 1}, {b: 2}, {c: 3}, {d: 4}])
          .then(function (docs) {
            docs.should.have.length(4);
            return coll.find({c: 3}).toArray();
          })
          .then(function (docs) {
            docs.should.have.length(1);
            docs[0].c.should.equal(3);
          })
          .then(function () {
            coll.find({d: 4}).toArray(testUtils.cb(done, function (err, docs) {
              should.not.exist(err);
              should.exist(docs);
              docs.should.have.length(1);
              docs[0].d.should.equal(4);
            }));
          })
          .then(null, done);
      });

      it('only retrieve documents from the given collection', function () {
        var coll = lowla.collection('dbName', 'One');
        var collTwo = lowla.collection('dbName', 'Two');
        return coll.insert({a: 1})
          .then(function () {
            return collTwo.insert({a: 2});
          })
          .then(function () {
            return coll.find().toArray();
          })
          .then(function (arr) {
            should.exist(arr);
            arr.should.have.length(1);
            arr[0].a.should.equal(1);
          });
      });
    });

    describe('findOne()', function () {
      var coll;
      beforeEach(function () {
        coll = lowla.collection('dbName', 'CollName');
      });

      it('finds nothing without error', function (done) {
        coll.findOne({a: 1})
          .then(function (doc) {
            should.not.exist(doc);
          })
          .then(function () {
            coll.findOne({a: 2}, testUtils.cb(done, function (err, doc) {
              should.not.exist(err);
              should.not.exist(doc);
            }));
          })
          .then(null, done);
      });

      it('finds a single document', function (done) {
        coll.insert({a: 1})
          .then(function () {
            return coll.findOne({a: 1});
          })
          .then(function (doc) {
            should.exist(doc);
            doc.a.should.equal(1);
          })
          .then(function () {
            coll.findOne({a: 1}, testUtils.cb(done, function (err, doc) {
              should.not.exist(err);
              doc.a.should.equal(1);
            }));
          })
          .then(null, done);
      });

      it('finds a single document when many match', function (done) {
        coll.insert([{a: 1, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}])
          .then(function () {
            return coll.findOne({a: 1});
          })
          .then(function (doc) {
            should.exist(doc);
            doc.a.should.equal(1);
          })
          .then(function () {
            coll.findOne({a: 1}, testUtils.cb(done, function (err, doc) {
              should.not.exist(err);
              doc.a.should.equal(1);
              should.exist(doc.b);
            }));
          })
          .then(null, done);
      });

      it('fails when filter errors', function (done) {
        coll.insert({a: 1})
          .then(function () {
            testUtils.sandbox.stub(LowlaDB.Cursor.prototype, '_applyFilter').throws(Error('Invalid filter'));
            return coll.findOne({a: 1}).should.eventually.rejectedWith(Error, /Invalid filter/);
          })
          .then(function () {
            coll.findOne({a: 1}, testUtils.cb(done, function (err, doc) {
              should.exist(err);
              err.should.match(/Invalid filter/);
              should.not.exist(doc);
            }));
          })
          .then(null, done);
      });
    });

    describe('findAndModify()', function () {
      var coll;

      beforeEach(function () {
        coll = lowla.collection('dbName', 'CollName');
      });

      it('can find and modify a document', function (done) {
        coll.insert([{a: 1}, {b: 2}, {c: 3}])
          .then(function () {
            return coll.findAndModify({a: 1}, {$set: {a: 2}});
          })
          .then(function (newObj) {
            newObj.a.should.equal(2);
          })
          .then(function () {
            coll.findAndModify({a: 2}, {$set: {a: 3}}, testUtils.cb(done, function (err, newObj) {
              should.not.exist(err);
              newObj.a.should.equal(3);
            }));
          })
          .then(null, done);
      });

      it('supports $unset operations', function () {
        return coll.insert({a: 1, b: 2, c: 3})
          .then(function () {
            return coll.findAndModify({a: 1}, {$unset: {b: ""}});
          })
          .then(function (obj) {
            obj.a.should.equal(1);
            obj.c.should.equal(3);
            should.not.exist(obj.b);

            // Shouldn't matter if the field isn't present
            return coll.findAndModify({a: 1}, {$unset: {notThere: ""}});
          })
          .then(function (obj) {
            obj.a.should.equal(1);
            obj.c.should.equal(3);
            should.not.exist(obj.b);
            should.not.exist(obj.notThere);
          });
      });

      it('does not modify other documents when filter finds no documents', function () {
        return coll.insert([{a: 1}, {a: 2}, {a: 3}])
          .then(function () {
            return coll.findAndModify({x: 22}, {$set: {b: 2}});
          })
          .then(function () {
            return coll.find({}).sort('a').toArray();
          })
          .then(function (arr) {
            arr.should.have.length(3);
            should.not.exist(arr[0].b);
            should.not.exist(arr[1].b);
            should.not.exist(arr[2].b);
          });
      });

      it('preserves existing ids when performing full document updates', function () {
        var docId;
        return coll.insert({a: 1})
          .then(function (doc) {
            docId = doc._id;
            return coll.findAndModify({a: 1}, {a: 2, b: 3});
          })
          .then(function () {
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.length.should.equal(1);
            arr[0]._id.should.equal(docId);
          });
      });

      it('can find and modify the correct document among many documents', function () {
        var id2;
        return coll.insert([{a: 1}, {a: 2}, {a: 3}])
          .then(function (arr) {
            arr[1].a.should.equal(2);
            id2 = arr[1]._id;
            arr.should.have.length(3);
            return coll.findAndModify({a: 2}, {$set: {a: 5}});
          })
          .then(function () {
            return coll.find({_id: id2}).toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            arr[0].a.should.equal(5);
          });
      });

      it('prevents replacement updates with $field names', function (done) {
        coll
          .insert({a: 1})
          .then(function (obj) {
            return coll
              .findAndModify({_id: obj._id}, {$badField: 2})
              .should.eventually.be.rejectedWith(Error, /\$badField/);
          })
          .then(function () {
            coll.findAndModify({a: 1}, {$badField2: 2}, testUtils.cb(done, function (err, obj) {
              should.not.exist(obj);
              err.should.match(/\$badField2/);
            }));
          })
          .then(null, done);
      });

      it('prevents update operations on $field names', function (done) {
        coll
          .insert({a: 1})
          .then(function (obj) {
            return coll
              .findAndModify({_id: obj._id}, {$set: {$badName: 3}})
              .should.eventually.be.rejectedWith(Error, /\$badName/);
          })
          .then(function () {
            coll.findAndModify({a: 1}, {$set: {$badName2: 3}}, testUtils.cb(done, function (err, obj) {
              should.not.exist(obj);
              err.should.match(/\$badName2/);
            }));
          })
          .then(null, done);
      });

      it('prevents mixing operations with fields', function (done) {
        coll
          .insert({a: 1})
          .then(function () {
            return coll
              .findAndModify({a: 1}, {$set: {b: 2}, c: 3})
              .should.eventually.be.rejectedWith(Error, /Can not mix/);
          })
          .then(function () {
            coll.findAndModify({a: 1}, {$set: {b: 3}, c: 4}, testUtils.cb(done, function (err, obj) {
              should.not.exist(obj);
              err.should.match(/Can not mix/);
            }));
          })
          .then(null, done);
      });
    });

    describe('remove()', function () {
      var coll;
      beforeEach(function () {
        coll = lowla.collection('dbName', 'CollName');
      });

      it('can remove a document', function (done) {
        coll
          .insert([{a: 1}, {a: 2}, {a: 3}])
          .then(function () {
            return coll.remove({a: 2});
          })
          .then(function (count) {
            count.should.equal(1);
            return coll.find({}).sort('a').toArray();
          })
          .then(function (arr) {
            arr.should.have.length(2);
            arr[0].a.should.equal(1);
            arr[1].a.should.equal(3);
          })
          .then(function () {
            coll.remove({a: 3}, testUtils.cb(done, function (err, count) {
              should.not.exist(err);
              count.should.equal(1);
            }));
          })
          .then(null, done);
      });

      it('can remove zero documents', function () {
        return coll
          .insert([{a: 1}, {b: 2}, {c: 3}])
          .then(function () {
            return coll.remove({d: 4});
          })
          .then(function (count) {
            count.should.equal(0);
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.should.have.length(3);
          });
      });

      it('can remove all documents', function () {
        return coll
          .insert([{a: 1}, {b: 2}, {c: 3}])
          .then(function () {
            return coll.remove();
          })
          .then(function (count) {
            count.should.equal(3);
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.should.have.length(0);
          });
      });

      it('fails when filter errors', function (done) {
        coll.insert({a: 1})
          .then(function () {
            testUtils.sandbox.stub(LowlaDB.Cursor.prototype, '_applyFilter').throws(Error('Invalid filter'));
            return coll.remove({b: 2}).should.eventually.rejectedWith(Error, /Invalid filter/);
          })
          .then(function () {
            coll.remove({c: 3}, testUtils.cb(done, function (err, doc) {
              should.exist(err);
              err.should.match(/Invalid filter/);
              should.not.exist(doc);
            }));
          })
          .then(null, done);
      });

      it('works with only callback argument', function (done) {
        coll
          .insert([{a: 1}, {a: 2}])
          .then(function () {
            coll.remove(testUtils.cb(done, function (err, count) {
              should.not.exist(err);
              count.should.equal(2);
            }));
          });
      });
    });

  });
});