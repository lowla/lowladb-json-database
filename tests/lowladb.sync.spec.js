/**
 * Created by michael on 10/10/14.
 */

describe('LowlaDB Sync', function() {
  var coll, collTwo;

  beforeEach(function(done) {
    var req = indexedDB.deleteDatabase( "lowla" );
    req.onsuccess = function () {
      done();
    };

    req.onerror = function () {
      done('failed to delete db in beforeEach');
    };
  });

  beforeEach(function() {
    coll = LowlaDB.collection('dbName', 'collectionOne');
    return coll.ready.then(function() {
      collTwo = LowlaDB.collection('dbName', 'collectionTwo');
      return collTwo.ready;
    })
      .then(function() {
        LowlaDB.sync('http://lowla.io/', { pollFrequency: -1 });
      });
  });

  afterEach(function() {
    LowlaDB.close();
  });

  var sandbox;
  var server;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    server = sandbox.useFakeXMLHttpRequest();
  });

  afterEach(function() {
    sandbox.restore();
  });

  it('requests changes from sequence 0', function() {
    LowlaDB._syncCoordinator.fetchChanges();
    server.requests.should.have.length(1);
    server.requests[0].url.should.equal('http://lowla.io/_lowla/changes?seq=0');
  });

  var makeChangesResponse = function() {
    var args = Array.prototype.slice.call(arguments);
    var answer = { atoms: [], sequence: 1 };
    args.map(function(id) {
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

  it('processes responses from the Syncer', function() {
    var processChanges = LowlaDB._syncCoordinator.processChanges = sandbox.stub();
    var promise = LowlaDB._syncCoordinator.fetchChanges();
    server.requests[0].respond(200, {'Content-type':'application/json'}, makeChangesResponse().json);
    return promise.then(function() {
      processChanges.callCount.should.equal(1);
      processChanges.getCall(0).should.have.been.calledWith({ atoms: [], sequence: 1});
    });
  });

  it('requests changes from Adapter', function() {
    LowlaDB._syncCoordinator.processChanges(makeChangesResponse('dbName.collectionOne$1234').obj);
    server.requests.should.have.length(1);
    server.requests[0].url.should.equal('http://lowla.io/_lowla/pull');
    server.requests[0].method.should.equal('POST');
    JSON.parse(server.requests[0].requestBody).should.deep.equal({ ids: [ 'dbName.collectionOne$1234' ]});
  });

  var makePullResponse = function() {
    var args = Array.prototype.slice.call(arguments);
    var answer = [];
    args.map(function(obj) {
      answer.push({
        id: 'dbName.collectionOne$' + obj._id,
        clientNs: 'dbName.collectionOne',
        deleted: obj._deleted ? true : false
      });
      if (!obj._deleted) {
        answer.push(obj);
      }
    });
    return answer;
  };

  it('processes responses from the Adapter', function() {
    var pullResponse = makePullResponse({ _id: '1234', a: 1, b: 22, text: 'Received', _version: 1 });
    var processPull = LowlaDB._syncCoordinator.processPull = sandbox.stub();
    var promise = LowlaDB._syncCoordinator.processChanges({ atoms: [ 'dbName.collectionOne$1234' ], sequence: 1 });
    server.requests[0].respond(200, {'Content-type': 'application/json'}, JSON.stringify(pullResponse));
    return promise.then(function() {
      processPull.callCount.should.equal(1);
      processPull.getCall(0).should.have.been.calledWith(pullResponse);
    });
  });

  it('updates the datastore with pull response', function() {
    var pullResponse = makePullResponse({ _id: '1234', a: 1, b: 22, text: 'Received', _version: 1 });
    return LowlaDB._syncCoordinator.processPull(pullResponse)
      .then(function() {
        return coll.find().toArray();
      })
      .then(function(arr) {
        arr.should.have.length(1);
        arr[0].a.should.equal(1);
        arr[0].b.should.equal(22);
        arr[0].text.should.equal('Received');
      });
  });

  it('can update multiple documents from pull response', function() {
    var pullResponse = makePullResponse(
      { _id: '1234', a: 1, b: 22, text: 'Received', _version: 1 },
      { _id: '2345', a: 2, b: 33, _version: 1 }
    );
    return LowlaDB._syncCoordinator.processPull(pullResponse)
      .then(function() {
        return coll.find().sort('a').toArray();
      })
      .then(function (arr) {
        arr.should.have.length(2);
        arr[0]._id.should.equal('1234');
        arr[1]._id.should.equal('2345');
      });
  });

  it('can import dates from adapter', function() {
    var pullResponse = makePullResponse({ _id: '1234', a: 1, date: { _bsonType: 'Date', millis: 132215400000 }}); // 1974-Mar-11
    return LowlaDB._syncCoordinator.processPull(pullResponse)
      .then(function() {
        return coll.findOne({ _id: '1234' });
      })
      .then(function(doc) {
        doc.a.should.equal(1);
        doc.date.should.be.an.instanceOf(Date);
        doc.date.getMonth().should.equal(2);
        doc.date.getDate().should.equal(11);
        doc.date.getYear().should.equal(74);
      });
  });

  it('should error when an unknown BSON type is received', function() {
    var pullResponse = makePullResponse({ _id: '1234', a: 1, date: { _bsonType: 'NotADate', millis: 132215400000 }}); // 1974-Mar-11
    var fn = function() { LowlaDB._syncCoordinator.processPull(pullResponse); };
    fn.should.throw(Error, /Unexpected BSON type: NotADate/);
  });

  it('should convert types in subdocuments', function() {
    var pullResponse = makePullResponse({ _id: '1234', a: 1, subDoc: { b: 2, date: { _bsonType: 'Date', millis: 132215400000 }}}); // 1974-Mar-11
    return LowlaDB._syncCoordinator.processPull(pullResponse)
      .then(function() {
        return coll.findOne({ _id: '1234' });
      })
      .then(function(doc) {
        doc.a.should.equal(1);
        should.exist(doc.subDoc);
        doc.subDoc.date.should.be.an.instanceOf(Date);
        doc.subDoc.date.getMonth().should.equal(2);
        doc.subDoc.date.getDate().should.equal(11);
        doc.subDoc.date.getYear().should.equal(74);
      });
  });

  it('should convert types in array fields', function() {
    var pullResponse = makePullResponse({ _id: '1234', a: 1, dates: [
      { _bsonType: 'Date', millis: 132215400000 }, // 1974-Mar-11
      { _bsonType: 'Date', millis: -69183000000 }  // 1967-Oct-23
    ]});
    return LowlaDB._syncCoordinator.processPull(pullResponse)
      .then(function() {
        return coll.findOne({ _id: '1234' });
      })
      .then(function(doc) {
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

  it('can import binary data from the adapter', function(done) {
    var pullResponse = makePullResponse({ _id: '1234', a: 1, val: { _bsonType: 'Binary', type: 0, encoded: 'RW5jb2RlZCBTdHJpbmc=' }}); // 'Encoded String'
    return LowlaDB._syncCoordinator.processPull(pullResponse)
      .then(function() {
        return coll.findOne({ _id: '1234' });
      })
      .then(function(doc) {
        doc.a.should.equal(1);
        doc.val.should.be.an.instanceOf(Blob);
        doc.val._lowlaType.should.equal(0);
        var reader = new FileReader();
        reader.addEventListener('loadend', function() {
          reader.result.should.equal('Encoded String');
          done();
        });
        reader.readAsText(doc.val);
      })
      .catch(done);
  });
});

