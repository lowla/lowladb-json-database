/**
 * Created by michael on 10/10/14.
 */

describe('LowlaDB Sync', function() {
  beforeEach(function(done) {
    var req = indexedDB.deleteDatabase( "lowla" );
    req.onsuccess = function () {
      done();
    };

    req.onerror = function () {
      done('failed to delete db in beforeEach');
    };
  });

  var coll = LowlaDB.collection('dbName', 'collectionOne');
  beforeEach(function() {
    LowlaDB.sync('http://lowla.io/', { pollFrequency: -1 });
  });

  afterEach(function() {
    LowlaDB.close();
  });

  var sandbox;
  var getJSON;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    getJSON = sandbox.stub(LowlaDB.utils, 'getJSON');
  });

  afterEach(function() {
    sandbox.restore();
  });

  var makeAdapterResponse = function () {
    var args = Array.prototype.slice.call(arguments);
    if (args[0] instanceof Array) {
      args = args[0];
    }

    var answer = [];
    args.map(function (obj) {
      var objId = obj._id;
      if (-1 === objId.indexOf('$')) {
        objId = 'dbName.collectionOne$' + objId;
      }
      answer.push({
        id: objId,
        clientNs: 'dbName.collectionOne',
        deleted: obj._deleted ? true : false
      });
      if (!obj._deleted) {
        answer.push(obj);
      }
    });
    return answer;
  };


  describe('Pull', function() {
    it('requests changes from sequence 0', function () {
      getJSON.returns(Promise.resolve({}));
      sandbox.stub(LowlaDB._syncCoordinator, 'processChanges').returns(Promise.resolve({}));
      return LowlaDB._syncCoordinator.fetchChanges()
        .then(function () {
          getJSON.callCount.should.equal(1);
          getJSON.getCall(0).should.have.been.calledWith('http://lowla.io/_lowla/changes?seq=0');
        });
    });

    var makeChangesResponse = function () {
      var args = Array.prototype.slice.call(arguments);
      var answer = { atoms: [], sequence: 1 };
      args.map(function (id) {
        answer.atoms.push({
          sequence: 1,
          id: id,
          version: 1,
          clientNs: id.substring(0, id.indexOf('$')),
          deleted: false
        });
      });

      return {
        obj: answer,
        json: JSON.stringify(answer)
      };
    };

    it('processes responses from the Syncer', function () {
      var processChanges = LowlaDB._syncCoordinator.processChanges = sandbox.stub();
      getJSON.returns(Promise.resolve(makeChangesResponse().obj));
      var promise = LowlaDB._syncCoordinator.fetchChanges();
      return promise.then(function () {
        processChanges.callCount.should.equal(1);
        processChanges.getCall(0).should.have.been.calledWith({ atoms: [], sequence: 1});
      });
    });

    it('requests changes from Adapter', function () {
      getJSON.returns(Promise.resolve({}));
      return LowlaDB._syncCoordinator.processChanges(makeChangesResponse('dbName.collectionOne$1234').obj)
        .then(function () {
          getJSON.callCount.should.equal(1);
          getJSON.getCall(0).should.have.been.calledWith('http://lowla.io/_lowla/pull', { ids: [ 'dbName.collectionOne$1234' ]});
        });
    });

    it('processes responses from the Adapter', function () {
      var pullResponse = makeAdapterResponse({ _id: '1234', a: 1, b: 22, text: 'Received', _version: 1 });
      getJSON.returns(Promise.resolve(pullResponse));
      var processPull = LowlaDB._syncCoordinator.processPull = sandbox.stub();
      var promise = LowlaDB._syncCoordinator.processChanges({ atoms: [ 'dbName.collectionOne$1234' ], sequence: 7 });
      return promise.then(function (newSeq) {
        processPull.callCount.should.equal(1);
        processPull.getCall(0).should.have.been.calledWith(pullResponse);
        newSeq.should.equal(7);
      });
    });

    it('updates the datastore with pull response', function () {
      var pullResponse = makeAdapterResponse({ _id: '1234', a: 1, b: 22, text: 'Received', _version: 1 });
      return LowlaDB._syncCoordinator.processPull(pullResponse)
        .then(function () {
          return coll.find().toArray();
        })
        .then(function (arr) {
          arr.should.have.length(1);
          arr[0].a.should.equal(1);
          arr[0].b.should.equal(22);
          arr[0].text.should.equal('Received');
        });
    });

    it('deletes documents based on pull response', function() {
      var pullResponse = makeAdapterResponse( {_id: '1234', a: 1,  _version: 1});
      return LowlaDB._syncCoordinator.processPull(pullResponse)
        .then(function() {
          return coll.find().toArray();
        })
        .then(function(arr) {
          arr.should.have.length(1);
          pullResponse = makeAdapterResponse( {_id: '1234', _deleted: true, _version: 2});
          return LowlaDB._syncCoordinator.processPull(pullResponse);
        })
        .then(function() {
          return coll.find().toArray();
        })
        .then(function(arr) {
          arr.should.have.length(0);
          return LowlaDB._syncCoordinator.collectPushData([]);
        })
        .then(function(payload) {
          should.not.exist(payload);
        });
    });

    it('does not store push data for pull responses', function() {
      var pullResponse = makeAdapterResponse({ _id: '1234', a: 1, b: 22, text: 'Received', _version: 1 });
      return LowlaDB._syncCoordinator.processPull(pullResponse)
        .then(function () {
          return LowlaDB._syncCoordinator.collectPushData();
        })
        .then(function (pushPayload) {
          should.not.exist(pushPayload);
        });
    });

    it('can update multiple documents from pull response', function () {
      var pullResponse = makeAdapterResponse(
        { _id: '1234', a: 1, b: 22, text: 'Received', _version: 1 },
        { _id: '2345', a: 2, b: 33, _version: 1 }
      );
      return LowlaDB._syncCoordinator.processPull(pullResponse)
        .then(function () {
          return coll.find().sort('a').toArray();
        })
        .then(function (arr) {
          arr.should.have.length(2);
          arr[0]._id.should.equal('1234');
          arr[1]._id.should.equal('2345');
        });
    });

    it('can import dates from adapter', function () {
      var pullResponse = makeAdapterResponse({ _id: '1234', a: 1, date: { _bsonType: 'Date', millis: 132215400000 }}); // 1974-Mar-11
      return LowlaDB._syncCoordinator.processPull(pullResponse)
        .then(function () {
          return coll.findOne({ _id: '1234' });
        })
        .then(function (doc) {
          doc.a.should.equal(1);
          doc.date.should.be.an.instanceOf(Date);
          doc.date.getMonth().should.equal(2);
          doc.date.getDate().should.equal(11);
          doc.date.getYear().should.equal(74);
        });
    });

    it('should error when an unknown BSON type is received', function () {
      var pullResponse = makeAdapterResponse({ _id: '1234', a: 1, date: { _bsonType: 'NotADate', millis: 132215400000 }}); // 1974-Mar-11
      var fn = function () {
        LowlaDB._syncCoordinator.processPull(pullResponse);
      };
      fn.should.throw(Error, /Unexpected BSON type: NotADate/);
    });

    it('should convert types in subdocuments', function () {
      var pullResponse = makeAdapterResponse({ _id: '1234', a: 1, subDoc: { b: 2, date: { _bsonType: 'Date', millis: 132215400000 }}}); // 1974-Mar-11
      return LowlaDB._syncCoordinator.processPull(pullResponse)
        .then(function () {
          return coll.findOne({ _id: '1234' });
        })
        .then(function (doc) {
          doc.a.should.equal(1);
          should.exist(doc.subDoc);
          doc.subDoc.date.should.be.an.instanceOf(Date);
          doc.subDoc.date.getMonth().should.equal(2);
          doc.subDoc.date.getDate().should.equal(11);
          doc.subDoc.date.getYear().should.equal(74);
        });
    });

    it('should convert types in array fields', function () {
      var pullResponse = makeAdapterResponse({ _id: '1234', a: 1, dates: [
        { _bsonType: 'Date', millis: 132215400000 }, // 1974-Mar-11
        { _bsonType: 'Date', millis: -69183000000 }  // 1967-Oct-23
      ]});
      return LowlaDB._syncCoordinator.processPull(pullResponse)
        .then(function () {
          return coll.findOne({ _id: '1234' });
        })
        .then(function (doc) {
          doc.a.should.equal(1);
          should.exist(doc.dates);
          doc.dates[0].should.be.an.instanceOf(Date);
          doc.dates[0].getMonth().should.equal(2);
          doc.dates[0].getDate().should.equal(11);
          doc.dates[0].getYear().should.equal(74);
          doc.dates[1].getMonth().should.equal(9);
          doc.dates[1].getDate().should.equal(23);
          doc.dates[1].getYear().should.equal(67);
        });
    });

    it('can import binary data from the adapter', function (done) {
      var pullResponse = makeAdapterResponse({ _id: '1234', a: 1, val: { _bsonType: 'Binary', type: 0, encoded: 'RW5jb2RlZCBTdHJpbmc=' }}); // 'Encoded String'
      return LowlaDB._syncCoordinator.processPull(pullResponse)
        .then(function () {
          return coll.findOne({ _id: '1234' });
        })
        .then(function (doc) {
          doc.a.should.equal(1);
          doc.val.should.be.an.instanceOf(Blob);
          doc.val._lowlaType.should.equal(0);
          var reader = new FileReader();
          reader.addEventListener('loadend', function () {
            reader.result.should.equal('Encoded String');
            done();
          });
          reader.readAsText(doc.val);
        })
        .catch(done);
    });
  });

  describe('Push', function() {
    it('computes payload for new documents', function() {
      var objId;
      return coll.insert({a: 1, b: 2})
        .then(function(obj) {
          objId = obj._id;
          return LowlaDB._syncCoordinator.collectPushData();
        })
        .then(function(payload) {
          payload.documents.should.have.length(1);
          payload.documents[0]._lowla.id.should.equal('dbName.collectionOne$' + objId);
          should.not.exist(payload.documents[0]._lowla.version);
          should.not.exist(payload.documents[0]._lowla.deleted);
          payload.documents[0].ops.should.deep.equal({
            $set: {
              "a": 1,
              "b": 2
            }
          });
        });
    });

    it('computes correct payload for new documents subsequently modified', function() {
      var objId;
      return coll.insert({a: 1})
        .then(function(obj) {
          objId = obj._id;
          return coll.findAndModify({a: 1}, {$set: { b: 22 }});
        })
        .then(function(obj) {
          return LowlaDB._syncCoordinator.collectPushData();
        })
        .then(function(payload) {
          payload.documents.should.have.length(1);
          payload.documents[0]._lowla.id.should.equal('dbName.collectionOne$' + objId);
          should.not.exist(payload.documents[0]._lowla.version);
          should.not.exist(payload.documents[0]._lowla.deleted);
          payload.documents[0].ops.should.deep.equal({
            $set: {
              "a": 1,
              "b": 22
            }
          });
        });
    });

    it('can clear pending changes', function() {
      var objId;
      return coll.insert({a: 1})
        .then(function(obj) {
          objId = obj._id;
          return LowlaDB._syncCoordinator.clearPushData();
        })
        .then(function() {
          return LowlaDB._syncCoordinator.collectPushData();
        })
        .then(function(payload) {
          should.not.exist(payload);
        });
    });

    it('can compute payload for modified documents', function() {
      var objId;
      return coll.insert({a: 1})
        .then(function(obj) {
          objId = obj._id;
          return LowlaDB._syncCoordinator.clearPushData();
        })
        .then(function() {
          return coll.findAndModify({a: 1}, {$set: { b: 2 }});
        })
        .then(function() {
          return LowlaDB._syncCoordinator.collectPushData();
        })
        .then(function(payload) {
          payload.documents.should.have.length(1);
          payload.documents[0].ops.should.deep.equal({
            $set: { b: 2 }
          });
        });
    });

    it('can process a push response from adapter', function() {
      var pushResponse = makeAdapterResponse({_id: '1234', a: 2, b: 5 });
      return LowlaDB._syncCoordinator.processPushResponse(pushResponse)
        .then(function(ids) {
          ids.should.have.length(1);
          ids[0].should.equal('dbName.collectionOne$1234');
          return coll.find().toArray();
        })
        .then(function(arr) {
          arr.should.have.length(1);
          arr[0]._id.should.equal('1234');
        });
    });

    it('can perform a full push operation', function() {
      var objId;
      return coll.insert({a: 1})
        .then(function(obj) {
          objId = obj._id;
          var pushResponse = makeAdapterResponse({_id: objId, a: 1 });
          getJSON.returns(Promise.resolve(pushResponse));
          return LowlaDB._syncCoordinator.pushChanges();
        })
        .then(function() {
          return coll.findOne({a: 1});
        })
        .then(function(doc) {
          should.exist(doc);
          doc._id.should.equal(objId);
          return LowlaDB._syncCoordinator.collectPushData();
        })
        .then(function(payload) {
          should.not.exist(payload);
        });
    });
  });

  describe('Events', function() {
    it('fires events during sync', function(done) {
      var syncBegin = sandbox.stub();
      var syncEnd = sandbox.stub();
      var pushBegin = sandbox.stub();
      var pushEnd = sandbox.stub();
      var pullBegin = sandbox.stub();
      var pullEnd = sandbox.stub();
      LowlaDB.on('syncBegin', syncBegin);
      LowlaDB.on('syncEnd', syncEnd);
      LowlaDB.on('pushBegin', pushBegin);
      LowlaDB.on('pushEnd', pushEnd);
      LowlaDB.on('pullBegin', pullBegin);
      LowlaDB.on('pullEnd', pullEnd);
      LowlaDB.on('syncEnd', function() {
        try {
          syncBegin.callCount.should.equal(1);
          pushBegin.callCount.should.equal(1);
          pushEnd.callCount.should.equal(1);
          pullBegin.callCount.should.equal(1);
          pullEnd.callCount.should.equal(1);
          syncEnd.callCount.should.equal(1);

          syncBegin.should.be.calledBefore(pushBegin);
          pushBegin.should.be.calledBefore(pushEnd);
          pushEnd.should.be.calledBefore(pullBegin);
          pullBegin.should.be.calledBefore(pullEnd);
          pullEnd.should.be.calledBefore(syncEnd);

          done();
        }
        catch (e) {
          done(e);
        }
      });

      coll.insert({a: 1})
        .then(function(obj) {
          var objId = obj._id;
          getJSON.onFirstCall().returns(Promise.resolve(makeAdapterResponse({_id: objId, a: 1})));
          getJSON.onSecondCall().returns(Promise.resolve({sequence: 2, atoms: [ 'dbName.TestCollection$' + objId ]}));
          getJSON.onThirdCall().returns(Promise.resolve(makeAdapterResponse({_id: objId, a: 1})));

          LowlaDB.sync('http://lowla.io', { pollFrequency: 0 });
        })
        .catch(done);
    });
  });

  describe('Chunking', function() {
    it('pushes ten documents at a time', function() {
      var promises = [];
      for (var a = 1; a <= 25; a++) {
        promises.push(coll.insert({a: a}));
      }

      var seenIDs = [];
      LowlaDB.utils.getJSON.restore();
      getJSON = sandbox.stub(LowlaDB.utils, 'getJSON', function(url, payload) {
        var docs = [];
        payload.documents.forEach(function(doc) {
          docs.push({_id: doc._lowla.id});
          if (-1 === seenIDs.indexOf(doc._lowla.id)) {
            seenIDs.push(doc._lowla.id);
          }
        });
        return Promise.resolve(makeAdapterResponse(docs));
      });

      return Promise.all(promises)
        .then(function() {
          return LowlaDB._syncCoordinator.pushChanges();
        })
        .then(function() {
          getJSON.callCount.should.equal(3);
          getJSON.args[0][1].documents.should.have.length(10);
          getJSON.args[1][1].documents.should.have.length(10);
          getJSON.args[2][1].documents.should.have.length(5);
          seenIDs.should.have.length(25);
        });
    });

    it('only attempts to send a document once per push', function() {
      var promises = [];
      for (var a = 1; a <= 15; a++) {
        promises.push(coll.insert({a: a}));
      }

      var seenIDs = [];
      var skipID = null;
      LowlaDB.utils.getJSON.restore();
      getJSON = sandbox.stub(LowlaDB.utils, 'getJSON', function (url, payload) {
        var docs = [];
        payload.documents.forEach(function (doc) {
          if (-1 === seenIDs.indexOf(doc._lowla.id)) {
            seenIDs.push(doc._lowla.id);
          }

          if (doc._lowla.id === skipID) {
            return;
          }

          docs.push({_id: doc._lowla.id});
        });
        return Promise.resolve(makeAdapterResponse(docs));
      });

      return Promise.all(promises)
        .then(function (docs) {
          // Skip the second document
          skipID = 'dbName.collectionOne$' + docs[1]._id;
          return LowlaDB._syncCoordinator.pushChanges();
        })
        .then(function () {
          getJSON.callCount.should.equal(2);
          getJSON.args[0][1].documents.should.have.length(10);
          getJSON.args[1][1].documents.should.have.length(5);

          getJSON.reset();
          return LowlaDB._syncCoordinator.pushChanges();
        })
        .then(function() {
          getJSON.callCount.should.equal(1);
          getJSON.args[0][1].documents.should.have.length(1);
          getJSON.args[0][1].documents[0]._lowla.id.should.equal(skipID);
        });
    });
  });
});

