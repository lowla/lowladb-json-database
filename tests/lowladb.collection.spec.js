describe('LowlaDB Collection', function() {
  beforeEach(testUtils.setUp);
  afterEach(testUtils.tearDown);

  describe('insert()', function() {
    it('can create documents', function(done) {
      var coll = LowlaDB.collection('dbName', 'CollName');
      coll.insert({a: 1})
        .then(function(doc) {
          should.exist(doc);
          should.exist(doc._id);
          doc.a.should.equal(1);
        })
        .then(function() {
          coll.insert({b: 2}, testUtils.cb(done, function(err, doc) {
            should.not.exist(err);
            should.exist(doc);
            doc.b.should.equal(2);
          }));
        })
        .then(null, done);
    });

    it('can insert multiple documents at once', function(done) {
      var coll = LowlaDB.collection('dbName', 'CollName');
      coll.insert([{a: 1}, {b: 2}])
        .then(function(docs) {
          docs.should.be.a('array');
          docs.should.have.length(2);
          docs[0].a.should.equal(1);
          docs[1].b.should.equal(2);
          should.not.exist(docs._id);
          should.exist(docs[0]._id);
          should.exist(docs[1]._id);
        })
        .then(function() {
          coll.insert([{c:3}, {d:4}], testUtils.cb(done, function(err, docs) {
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

    it('prevents inserting $field names', function(done) {
      var coll = LowlaDB.collection('dbName', 'CollName');
      coll.insert({$field: 1})
        .then(function() {
          done(Error('Promise should not have resolved successfully'));
        }, function(err) {
          should.exist(err);
          err.should.match(/\$field/);
        })
        .then(function() {
          coll.insert({$field2: 1}, testUtils.cb(done, function(err, doc) {
            should.exist(err);
            should.not.exist(doc);
            err.should.match(/\$field2/);
          }));
        })
        .then(null, done);
    });
  });

  describe('find()', function() {
    it('with no documents in datastore works without error', function(done) {
      var coll = LowlaDB.collection('dbName', 'CollName');
      coll.find({}).toArray()
        .then(function(docs) {
          should.exist(docs);
          docs.should.have.length(0);
        })
        .then(function() {
          coll.find({}).toArray(testUtils.cb(done, function(err, docs) {
            should.not.exist(err);
            should.exist(docs);
            docs.should.have.length(0);
          }));
        })
        .then(null, done);
    });

    it('with no matching documents works without error', function(done) {
      var coll = LowlaDB.collection('dbName', 'CollName');
      coll.insert([{a: 1}, {b: 2}])
        .then(function(docs) {
          docs.should.have.length(2);
          return coll.find({a:2}).toArray();
        })
        .then(function(docs) {
          should.exist(docs);
          docs.should.have.length(0);
        })
        .then(function() {
          coll.find({a:2}).toArray(testUtils.cb(done, function(err, docs) {
            should.not.exist(err);
            should.exist(docs);
            docs.should.have.length(0);
          }));
        })
        .then(null, done);
    });
  });

  describe('Errors via Promise API', function() {
    it('prevents replacement updates with $field names', function () {
      var coll = LowlaDB.collection('dbName', 'TestCollection');
      return coll
        .insert({a: 1})
        .then(function (obj) {
          return coll
            .findAndModify({_id: obj._id}, {$badField: 2})
            .should.eventually.be.rejectedWith(Error, /\$badField/);
        });
    });

    it('prevents update operations on $field names', function () {
      var coll = LowlaDB.collection('dbName', 'TestCollection');
      return coll
        .insert({a: 1})
        .then(function (obj) {
          return coll
            .findAndModify({_id: obj._id}, {$set: {$badName: 3}})
            .should.eventually.be.rejectedWith(Error, /\$badName/);
        });
    });
  });

  describe('Errors via Callback API', function() {
    it('prevents replacement updates with $field names', function (done) {
      var coll = LowlaDB.collection('dbName', 'TestCollection');
      return coll
        .insert({a: 1})
        .then(function (obj) {
          coll.findAndModify({_id: obj._id}, {$badField: 2}, testUtils.cb(done, function(err, obj) {
            should.exist(err);
            should.not.exist(obj);
            err.should.match(/\$badField/);
          }));
        });
    });
  });
});