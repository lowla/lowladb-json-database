/**
 * Created by michael on 10/10/14.
 */

testUtils.eachDatastore(function (dsName) {
  'use strict';

  describe('LowlaDB Sync (' + dsName + ')', function () {
    beforeEach(testUtils.setUpFn(dsName));
    afterEach(testUtils.tearDownFn());

    var coll;
    var getJSON;
    beforeEach(function () {
      coll = lowla.collection('dbName', 'collectionOne');
      getJSON = testUtils.sandbox.stub(LowlaDB.utils, 'getJSON');
      lowla.sync('http://lowla.io/', {pollFrequency: -1});
    });

    var makeChangesResponse = function () {
      var args = Array.prototype.slice.call(arguments);
      var seq = 2;
      if (args.length && typeof(args[0]) === 'number') {
        seq = args[0];
        args.shift();
      }

      var answer = {atoms: [], sequence: seq};
      args.map(function (id) {
        var clientNs = 'dbName.collectionOne';
        if (-1 !== id.indexOf('$')) {
          clientNs = id.substring(0, id.indexOf('$'));
        }
        else {
          id = clientNs + '$' + id;
        }

        answer.atoms.push({
          sequence: seq - 1,
          id: id,
          version: 1,
          clientNs: clientNs,
          deleted: false
        });
      });

      return answer;
    };

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
          deleted: !!obj._deleted
        });
        if (!obj._deleted) {
          answer.push(obj);
        }
      });
      return answer;
    };

    it('fails with missing sync URLs', function () {
      var fn = function () {
        lowla.sync();
      };
      fn.should.throw(/Invalid server URL/);
    });

    describe('Pull', function () {
      it('requests changes from sequence 0', function () {
        getJSON.returns(Promise.resolve({}));
        testUtils.sandbox.stub(lowla._syncCoordinator, 'processChanges').returns(Promise.resolve({}));
        return lowla._syncCoordinator.fetchChanges()
          .then(function () {
            getJSON.callCount.should.equal(1);
            getJSON.getCall(0).should.have.been.calledWith('http://lowla.io/_lowla/changes?seq=0');
          });
      });

      it('processes responses from the Syncer', function () {
        var processChanges = lowla._syncCoordinator.processChanges = testUtils.sandbox.stub();
        getJSON.returns(Promise.resolve(makeChangesResponse()));
        var promise = lowla._syncCoordinator.fetchChanges();
        return promise.then(function () {
          processChanges.callCount.should.equal(1);
          processChanges.getCall(0).should.have.been.calledWith({atoms: [], sequence: 2});
        });
      });

      it('can process an empty response', function () {
        return lowla._syncCoordinator.processChanges({sequence: 1, atoms: []})
          .then(function (arg) {
            should.not.exist(arg);
          });
      });

      it('requests changes from Adapter', function () {
        getJSON.returns(Promise.resolve({}));
        var objId = 'dbName.collectionOne$1234';
        return lowla._syncCoordinator.processChanges(makeChangesResponse(objId))
          .then(function () {
            getJSON.callCount.should.equal(1);
            getJSON.getCall(0).should.have.been.calledWith('http://lowla.io/_lowla/pull', {ids: [objId]});
          });
      });

      it('processes responses from the Adapter', function () {
        var pullResponse = makeAdapterResponse({_id: '1234', a: 1, b: 22, text: 'Received', _version: 1});
        getJSON.returns(Promise.resolve(pullResponse));
        var processPull = lowla._syncCoordinator.processPull = testUtils.sandbox.stub();
        var changesResponse = makeChangesResponse('1234');
        changesResponse.sequence = 7;
        var promise = lowla._syncCoordinator.processChanges(changesResponse);
        return promise.then(function (newSeq) {
          processPull.callCount.should.equal(1);
          processPull.getCall(0).should.have.been.calledWith(pullResponse);
          newSeq.should.equal(7);
        });
      });

      it('updates the datastore with pull response', function () {
        var pullResponse = makeAdapterResponse({_id: '1234', a: 1, b: 22, text: 'Received', _version: 1});
        return lowla._syncCoordinator.processPull(pullResponse)
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

      it('can import fields with null values', function () {
        var pullResponse = makeAdapterResponse({_id: '1234', a: 1, b: null, _version: 1});
        return lowla._syncCoordinator.processPull(pullResponse)
          .then(function () {
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            arr[0].a.should.equal(1);
            should.equal(arr[0].b, null);
          });
      });

      it('deletes documents based on pull response', function () {
        var pullResponse = makeAdapterResponse({_id: '1234', a: 1, _version: 1});
        return lowla._syncCoordinator.processPull(pullResponse)
          .then(function () {
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            pullResponse = makeAdapterResponse({_id: '1234', _deleted: true, _version: 2});
            return lowla._syncCoordinator.processPull(pullResponse);
          })
          .then(function () {
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.should.have.length(0);
            return lowla._syncCoordinator.collectPushData([]);
          })
          .then(function (payload) {
            should.not.exist(payload);
          });
      });

      it('skips modified documents from pull response', function () {
        return coll.insert({_id: '1234', a: 1})
          .then(function () {
            var pullResponse = makeAdapterResponse({_id: '1234', a: 2, _version: 2});
            return lowla._syncCoordinator.processPull(pullResponse);
          })
          .then(function () {
            return coll.find({}).toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            arr[0].a.should.equal(1);

            var pullResponse = makeAdapterResponse(({_id: '1234', _deleted: true, _version: 3}));
            return lowla._syncCoordinator.processPull(pullResponse);
          })
          .then(function () {
            return coll.find({}).toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            arr[0].a.should.equal(1);
          });
      });

      it('does not store push data for pull responses', function () {
        var pullResponse = makeAdapterResponse({_id: '1234', a: 1, b: 22, text: 'Received', _version: 1});
        return lowla._syncCoordinator.processPull(pullResponse)
          .then(function () {
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (pushPayload) {
            should.not.exist(pushPayload);
          });
      });

      it('can update multiple documents from pull response', function () {
        var pullResponse = makeAdapterResponse(
          {_id: '1234', a: 1, b: 22, text: 'Received', _version: 1},
          {_id: '2345', a: 2, b: 33, _version: 1}
        );
        return lowla._syncCoordinator.processPull(pullResponse)
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
        // 132215400000 = 1974-Mar-11
        var pullResponse = makeAdapterResponse({_id: '1234', a: 1, date: {_bsonType: 'Date', millis: 132215400000}});
        return lowla._syncCoordinator.processPull(pullResponse)
          .then(function () {
            return coll.findOne({_id: '1234'});
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
        var pullResponse = makeAdapterResponse({
          _id: '1234',
          a: 1,
          date: {_bsonType: 'NotADate', millis: 132215400000}
        }); // 1974-Mar-11
        var fn = function () {
          lowla._syncCoordinator.processPull(pullResponse);
        };
        fn.should.throw(Error, /Unexpected BSON type: NotADate/);
      });

      it('should convert types in subdocuments', function () {
        var pullResponse = makeAdapterResponse({
          _id: '1234',
          a: 1,
          subDoc: {b: 2, date: {_bsonType: 'Date', millis: 132215400000}}
        }); // 1974-Mar-11
        return lowla._syncCoordinator.processPull(pullResponse)
          .then(function () {
            return coll.findOne({_id: '1234'});
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
        var pullResponse = makeAdapterResponse({
          _id: '1234', a: 1, dates: [
            {_bsonType: 'Date', millis: 132215400000}, // 1974-Mar-11
            {_bsonType: 'Date', millis: -69183000000}  // 1967-Oct-23
          ]
        });
        return lowla._syncCoordinator.processPull(pullResponse)
          .then(function () {
            return coll.findOne({_id: '1234'});
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
        var pullResponse = makeAdapterResponse({
          _id: '1234',
          a: 1,
          val: {_bsonType: 'Binary', type: 0, encoded: 'RW5jb2RlZCBTdHJpbmc='}
        }); // 'Encoded String'
        return lowla._syncCoordinator.processPull(pullResponse)
          .then(function () {
            return coll.findOne({_id: '1234'});
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

      it('pulls multiple documents ten at a time', function () {
        var changes = makeChangesResponse('1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
          '11', '12', '13', '14', '15');
        getJSON.onFirstCall().returns(Promise.resolve(makeAdapterResponse({_id: '1'}, {_id: '2'}, {_id: '3'},
          {_id: '4'}, {_id: '5'}, {_id: '6'}, {_id: '7'}, {_id: '8'}, {_id: '9'}, {_id: '10'})));
        getJSON.onSecondCall().returns(Promise.resolve(makeAdapterResponse({_id: '11'}, {_id: '12'}, {_id: '13'},
          {_id: '14'}, {_id: '15'})));

        var processPull = testUtils.sandbox.spy(lowla._syncCoordinator, 'processPull');
        return lowla._syncCoordinator.processChanges(changes)
          .then(function () {
            getJSON.callCount.should.equal(2);
            getJSON.args[0][1].ids.length.should.equal(10);
            getJSON.args[1][1].ids.length.should.equal(5);
            processPull.callCount.should.equal(2);
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.length.should.equal(15);
          });
      });

      it('re-pulls documents it did not receive from a pull request', function () {
        var changes = makeChangesResponse('1', '2', '3', '4');
        getJSON.onFirstCall().returns(Promise.resolve(makeAdapterResponse({_id: '1'}, {_id: '3'})));
        getJSON.onSecondCall().returns(Promise.resolve(makeAdapterResponse({_id: '2'}, {_id: '4'})));
        return lowla._syncCoordinator.processChanges(changes)
          .then(function () {
            getJSON.callCount.should.equals(2);
            getJSON.args[0][1].ids.length.should.equal(4);
            getJSON.args[1][1].ids.length.should.equal(2);
            getJSON.args[1][1].ids[0].should.equal('dbName.collectionOne$2');
            getJSON.args[1][1].ids[1].should.equal('dbName.collectionOne$4');
          });
      });

      it('does not change sequence if all changed IDs are not pulled', function () {
        var changes = makeChangesResponse(5, '1', '2', '3', '4');
        getJSON.onFirstCall().returns(Promise.resolve(makeAdapterResponse({_id: '1'}, {_id: '3'})));
        getJSON.onSecondCall().returns(Promise.resolve([]));
        return lowla._metadata({sequence: 3})
          .then(function () {
            return lowla._syncCoordinator.processChanges(changes);
          })
          .then(function () {
            getJSON.callCount.should.equals(2);
            getJSON.args[0][1].ids.length.should.equal(4);
            getJSON.args[1][1].ids.length.should.equal(2);
            getJSON.args[1][1].ids[0].should.equal('dbName.collectionOne$2');
            getJSON.args[1][1].ids[1].should.equal('dbName.collectionOne$4');
            return lowla._metadata();
          })
          .then(function (doc) {
            doc.sequence.should.equal(4);
          });
      });

      it('does not change sequence if any changed IDs are not pulled', function () {
        var changes = makeChangesResponse(25, '1', '2', '3', '4');
        getJSON.onFirstCall().returns(Promise.resolve([]));
        return lowla._metadata({sequence: 17})
          .then(function () {
            return lowla._syncCoordinator.processChanges(changes);
          })
          .then(function () {
            getJSON.callCount.should.equals(1);
            return lowla._metadata();
          })
          .then(function (doc) {
            doc.sequence.should.equal(17);
          });
      });
    });

    describe('Push', function () {
      it('computes payload for new documents', function () {
        var objId;
        return coll.insert({a: 1, b: 2})
          .then(function (obj) {
            objId = obj._id;
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            payload.documents.should.have.length(1);
            payload.documents[0]._lowla.id.should.equal('dbName.collectionOne$' + objId);
            should.not.exist(payload.documents[0]._lowla.version);
            should.not.exist(payload.documents[0]._lowla.deleted);
            payload.documents[0].ops.should.deep.equal({
              $set: {
                'a': 1,
                'b': 2
              }
            });
          });
      });

      it('computes correct payload for new documents subsequently modified', function () {
        var objId;
        return coll.insert({a: 1})
          .then(function (obj) {
            objId = obj._id;
            return coll.findAndModify({a: 1}, {$set: {b: 22}});
          })
          .then(function (obj) {
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            payload.documents.should.have.length(1);
            payload.documents[0]._lowla.id.should.equal('dbName.collectionOne$' + objId);
            should.not.exist(payload.documents[0]._lowla.version);
            should.not.exist(payload.documents[0]._lowla.deleted);
            payload.documents[0].ops.should.deep.equal({
              $set: {
                'a': 1,
                'b': 22
              }
            });
          });
      });

      it('can clear pending changes', function () {
        var objId;
        return coll.insert({a: 1})
          .then(function (obj) {
            objId = obj._id;
            return lowla._syncCoordinator.clearPushData();
          })
          .then(function () {
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            should.not.exist(payload);
          });
      });

      it('can compute payload for modified documents', function () {
        var objId;
        return coll.insert({a: 1})
          .then(function (obj) {
            objId = obj._id;
            return lowla._syncCoordinator.clearPushData();
          })
          .then(function () {
            return coll.findAndModify({a: 1}, {$set: {b: 2}});
          })
          .then(function () {
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            payload.documents.should.have.length(1);
            payload.documents[0].ops.should.deep.equal({
              $set: {b: 2}
            });
          });
      });

      it('will not create payload for a modified document that is reverted', function () {
        return coll.insert({_id: '1234', a: 1, b: 2, c: 3, d: 4, deep: {b: 5}})
          .then(function () {
            return lowla._syncCoordinator.clearPushData();
          })
          .then(function () {
            return coll.findAndModify({_id: '1234'}, {$set: {a: 2, deep: 'f'}});
          })
          .then(function () {
            return coll.findAndModify({_id: '1234'}, {$set: {a: 11, x: 10}});
          })
          .then(function () {
            return coll.findAndModify({_id: '1234'}, {$unset: {d: true}});
          })
          .then(function () {
            return coll.findAndModify({_id: '1234'}, {$unset: {x: true}});
          })
          .then(function () {
            return coll.findAndModify({_id: '1234'}, {$set: {a: 1, d: 4}});
          })
          .then(function () {
            return coll.findAndModify({_id: '1234'}, {$set: {deep: {b: 5}}});
          })
          .then(function () {
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            should.not.exist(payload);
          });
      });

      it('can compute payload for deleted documents', function () {
        return coll.insert({_id: '1234', a: 1, _version: 2})
          .then(function () {
            return lowla._syncCoordinator.clearPushData();
          })
          .then(function () {
            return coll.remove({_id: '1234'});
          })
          .then(function () {
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            payload.documents.should.have.length(1);
            payload.documents[0]._lowla.id.should.equal('dbName.collectionOne$1234');
            payload.documents[0]._lowla.version.should.equal(2);
            payload.documents[0]._lowla.deleted.should.equal(true);
          });
      });

      it('will send deletes on push if local document was never sent', function () {
        return coll.insert({_id: '1234', a: 1})
          .then(function () {
            return coll.remove({_id: '1234'});
          })
          .then(function () {
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            // Lowla should still send deletes for new documents it removed before pushing; it is up to the server to
            // ignore these "empty" deletes.
            // This behavior is necessary to properly handle a case where a new document is sent to the server and is
            // deleted before the Push response is returned.
            payload.documents.should.have.length(1);
            payload.documents[0]._lowla.id.should.equal('dbName.collectionOne$1234');
            payload.documents[0]._lowla.deleted.should.equal(true);
          });
      });

      it('can process a push response from adapter', function () {
        var pushResponse = makeAdapterResponse({_id: '1234', a: 2, b: 5});
        return lowla._syncCoordinator.processPushResponse(pushResponse)
          .then(function (ids) {
            ids.should.have.length(1);
            ids[0].should.equal('dbName.collectionOne$1234');
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            arr[0]._id.should.equal('1234');
          });
      });

      it('can process a push response that switches the ID of the document', function () {
        var pushResponse = makeAdapterResponse({_id: '123456', a: 2, b: 5});
        pushResponse[0].clientId = 'dbName.collectionOne$1234';
        return coll.insert({_id: '1234', a: 2, b: 5})
          .then(function () {
            return lowla._syncCoordinator.clearPushData();
          })
          .then(function () {
            return lowla._syncCoordinator.processPushResponse(pushResponse);
          })
          .then(function () {
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            arr[0]._id.should.equal('123456');
          });
      });

      it('can process a delete in push response', function () {
        return coll.insert({_id: 'deleteFromPush', a: 1})
          .then(function () {
            var pushResponse = makeAdapterResponse({_id: 'deleteFromPush', _deleted: true, _version: 2});
            getJSON.returns(Promise.resolve(pushResponse));
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            return coll.find({}).toArray();
          })
          .then(function (arr) {
            arr.should.have.length(0);
            return lowla._syncCoordinator.collectPushData([]);
          })
          .then(function (payload) {
            should.not.exist(payload);
          });
      });

      it('can perform a full push operation', function () {
        var objId;
        return coll.insert({a: 1})
          .then(function (obj) {
            objId = obj._id;
            var pushResponse = makeAdapterResponse({_id: objId, a: 1});
            getJSON.returns(Promise.resolve(pushResponse));
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            return coll.findOne({a: 1});
          })
          .then(function (doc) {
            should.exist(doc);
            doc._id.should.equal(objId);
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            should.not.exist(payload);
          });
      });

      it('can perform a full push operation where ID changes on response', function () {
        var objId;
        return coll.insert({a: 1})
          .then(function (obj) {
            objId = obj._id;
            var pushResponse = makeAdapterResponse({_id: objId + 'New', a: 1});
            pushResponse[0].clientId = 'dbName.collectionOne$' + objId;
            getJSON.returns(Promise.resolve(pushResponse));
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            return coll.find({}).toArray();
          })
          .then(function (arr) {
            arr.should.have.length(1);
            var doc = arr[0];
            doc._id.should.equal(objId + 'New');
            return lowla._syncCoordinator.collectPushData();
          })
          .then(function (payload) {
            should.not.exist(payload);
          });
      });

      it('will not overwrite documents from pull response if modified locally', function () {
        getJSON.restore();
        getJSON = testUtils.sandbox.stub(LowlaDB.utils, 'getJSON', function () {
          return coll.findAndModify({_id: '1234'}, {$set: {a: 5}})
            .then(function (obj) {
              return makeAdapterResponse({_id: '1234', a: 3});
            });
        });

        return coll.insert({_id: '1234', a: 1})
          .then(function () {
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            return coll.findOne({_id: '1234'});
          })
          .then(function (obj) {
            obj.a.should.equal(5);
            return lowla._syncCoordinator.collectPushData([]);
          })
          .then(function (payload) {
            payload.documents.should.have.length(1);
            payload.documents[0]._lowla.id.should.equal('dbName.collectionOne$1234');
            payload.documents[0].ops.$set.a.should.equal(5);
          });
      });

      it('will overwrite modified documents on the second pull', function () {
        getJSON.restore();
        getJSON = testUtils.sandbox.stub(LowlaDB.utils, 'getJSON', function () {
          getJSON.restore();
          testUtils.sandbox.stub(LowlaDB.utils, 'getJSON').returns(Promise.resolve(makeAdapterResponse({
            _id: '1234',
            a: 7
          })));

          return coll.findAndModify({_id: '1234'}, {$set: {a: 5}})
            .then(function () {
              return makeAdapterResponse({_id: '1234', a: 3});
            });
        });
        return coll.insert({_id: '1234', a: 1})
          .then(function () {
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            return coll.findOne({_id: '1234'});
          })
          .then(function (obj) {
            obj.a.should.equal(5);
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            return coll.findOne({_id: '1234'});
          })
          .then(function (obj) {
            obj.a.should.equal(7);
          });
      });

      it('will not recreate documents that were removed before pull response', function () {
        getJSON.restore();
        getJSON = testUtils.sandbox.stub(LowlaDB.utils, 'getJSON', function () {
          return coll.remove({_id: '1234'})
            .then(function (obj) {
              return makeAdapterResponse({_id: '1234', a: 3});
            });
        });

        return coll.insert({_id: '1234', a: 1})
          .then(function () {
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            return coll.findOne({_id: '1234'});
          })
          .then(function (obj) {
            should.not.exist(obj);
            return lowla._syncCoordinator.collectPushData([]);
          })
          .then(function (payload) {
            payload.documents.should.have.length(1);
            payload.documents[0]._lowla.id.should.equal('dbName.collectionOne$1234');
            payload.documents[0]._lowla.deleted.should.equal(true);
          });
      });
    });

    describe('Events', function () {
      it('fires events during sync', function (done) {
        var syncBegin = testUtils.sandbox.stub();
        var syncEnd = testUtils.sandbox.stub();
        var pushBegin = testUtils.sandbox.stub();
        var pushEnd = testUtils.sandbox.stub();
        var pullBegin = testUtils.sandbox.stub();
        var pullEnd = testUtils.sandbox.stub();
        lowla.on('syncBegin', syncBegin);
        lowla.on('syncEnd', syncEnd);
        lowla.on('pushBegin', pushBegin);
        lowla.on('pushEnd', pushEnd);
        lowla.on('pullBegin', pullBegin);
        lowla.on('pullEnd', pullEnd);
        lowla.on('syncEnd', function () {
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
          .then(function (obj) {
            var objId = obj._id;
            getJSON.onFirstCall().returns(Promise.resolve(makeAdapterResponse({_id: objId, a: 1})));
            getJSON.onSecondCall().returns(Promise.resolve(makeChangesResponse(2, objId)));
            getJSON.onThirdCall().returns(Promise.resolve(makeAdapterResponse({_id: objId, a: 1})));

            lowla.sync('http://lowla.io', {pollFrequency: 0});
          })
          .catch(done);
      });

      it('fires pullEnd after an error', function () {
        // silence the console message
        var log = testUtils.sandbox.stub(console, 'log');

        var pullEnd = testUtils.sandbox.stub();
        lowla.on('pullEnd', pullEnd);
        var changes = makeChangesResponse('dbName.collectionOne$1234');
        getJSON.onFirstCall().returns(Promise.resolve(changes));
        getJSON.onSecondCall().throws(Error('Bad request'));
        return lowla._syncCoordinator.fetchChanges()
          .then(function () {
            pullEnd.callCount.should.equal(1);
            log.callCount.should.equal(1);
          });
      });

      it('fires pushEnd after an error', function () {
        // silence the console message
        var log = testUtils.sandbox.stub(console, 'log');

        var pushEnd = testUtils.sandbox.stub();
        lowla.on('pushEnd', pushEnd);
        getJSON.throws(Error('Bad request'));
        return coll.insert({a: 1})
          .then(function () {
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            pushEnd.callCount.should.equal(1);
            log.callCount.should.equal(1);
          });
      });
    });

    describe('Socket.IO', function () {
      var mockIo;
      var mockSocket;
      var debounce;
      var pushPullFn;

      beforeEach(function () {
        mockSocket = {
          on: testUtils.sandbox.stub()
        };

        mockIo = {
          connect: testUtils.sandbox.stub().returns(mockSocket)
        };

        debounce = testUtils.sandbox.stub(LowlaDB.utils, 'debounce');
        pushPullFn = testUtils.sandbox.stub();
        debounce.returns(pushPullFn);

        testUtils.sandbox.stub(LowlaDB.SyncCoordinator.prototype, 'pushChanges').returns(Promise.resolve({}));
        testUtils.sandbox.stub(LowlaDB.SyncCoordinator.prototype, 'fetchChanges').returns(Promise.resolve({}));

        return lowla.sync('http://lowla.io', {io: mockIo});
      });

      it('registers for Socket.IO events', function () {
        mockSocket.on.callCount.should.equal(2);
        mockSocket.on.getCall(0).args[0].should.equal('changes');
        mockSocket.on.getCall(0).args[1].should.be.a('function');
        mockSocket.on.getCall(1).args[0].should.equal('reconnect');
        mockSocket.on.getCall(1).args[1].should.be.a('function');
        debounce.callCount.should.equal(1);
      });

      it('invokes pushPull on changes event', function () {
        pushPullFn.callCount.should.equal(0);
        mockSocket.on.getCall(0).args[1]();
        pushPullFn.callCount.should.equal(1);
      });

      it('invokes pushPull on reconnect event', function () {
        pushPullFn.callCount.should.equal(0);
        mockSocket.on.getCall(1).args[1]();
        pushPullFn.callCount.should.equal(1);
      });
    });

    describe('Chunking', function () {
      it('pushes ten documents at a time', function () {
        var promises = [];
        for (var a = 1; a <= 25; a++) {
          promises.push(coll.insert({a: a}));
        }

        var seenIDs = [];
        LowlaDB.utils.getJSON.restore();
        getJSON = testUtils.sandbox.stub(LowlaDB.utils, 'getJSON', function (url, payload) {
          var docs = [];
          payload.documents.forEach(function (doc) {
            docs.push({_id: doc._lowla.id});
            if (-1 === seenIDs.indexOf(doc._lowla.id)) {
              seenIDs.push(doc._lowla.id);
            }
          });
          return Promise.resolve(makeAdapterResponse(docs));
        });

        return Promise.all(promises)
          .then(function () {
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            getJSON.callCount.should.equal(3);
            getJSON.args[0][1].documents.should.have.length(10);
            getJSON.args[1][1].documents.should.have.length(10);
            getJSON.args[2][1].documents.should.have.length(5);
            seenIDs.should.have.length(25);
          });
      });

      it('only attempts to send a document once per push', function () {
        var promises = [];
        for (var a = 1; a <= 15; a++) {
          promises.push(coll.insert({a: a}));
        }

        var seenIDs = [];
        var skipID = null;
        LowlaDB.utils.getJSON.restore();
        getJSON = testUtils.sandbox.stub(LowlaDB.utils, 'getJSON', function (url, payload) {
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
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            getJSON.callCount.should.equal(2);
            getJSON.args[0][1].documents.should.have.length(10);
            getJSON.args[1][1].documents.should.have.length(5);

            getJSON.reset();
            return lowla._syncCoordinator.pushChanges();
          })
          .then(function () {
            getJSON.callCount.should.equal(1);
            getJSON.args[0][1].documents.should.have.length(1);
            getJSON.args[0][1].documents[0]._lowla.id.should.equal(skipID);
          });
      });
    });

    describe('Load', function () {
      it('can load documents from an object', function () {
        var resp = makeAdapterResponse({_id: '1234', a: 1}, {_id: '2345', a: 2}, {_id: '3456', a: 3});
        return lowla.load({sequence: 5, documents: [resp]})
          .then(function () {
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.length.should.equal(3);
            return lowla._metadata();
          })
          .then(function (metaDoc) {
            metaDoc.sequence.should.equal(5);
          });
      });

      it('can load many documents from a url', function () {
        var payload = {sequence: 22, documents: []};
        var docs = [];
        for (var i = 1; i <= 25; i++) {
          docs.push({_id: 'fakeId' + i, i: i});
          if (docs.length === 10) {
            payload.documents.push(makeAdapterResponse(docs));
            docs = [];
          }
        }
        if (docs.length) {
          payload.documents.push(makeAdapterResponse(docs));
        }

        payload.documents[0].should.have.length(20);
        payload.documents[1].should.have.length(20);
        payload.documents[2].should.have.length(10);

        getJSON.returns(Promise.resolve(payload));

        return lowla.load('http://lowla.io/my-data.json')
          .then(function () {
            return coll.find().toArray();
          })
          .then(function (arr) {
            arr.length.should.equal(25);
            return lowla._metadata();
          })
          .then(function (metaDoc) {
            metaDoc.sequence.should.equal(22);
          });
      });

      it('invokes a given callback', function (done) {
        var resp = makeAdapterResponse({_id: '1234', a: 1}, {_id: '2345', a: 2}, {_id: '3456', a: 3});
        return lowla.load({sequence: 5, documents: [resp]}, testUtils.cb(done, function (err, res) {
          should.not.exist(err);
          res.should.equal(5);
        }))
          .then(null, done);
      });

      it('fails appropriately when URL is unavailable', function (done) {
        getJSON.throws(Error('Invalid URL'));
        lowla.load('http://lowla.io/my-data.json')
          .should.eventually.be.rejectedWith(Error, /Invalid URL/)
          .then(function () {
            lowla.load('http://lowla.io/my-data.json', testUtils.cb(done, function (err, seq) {
              should.not.exist(seq);
              err.should.match(/Invalid URL/);
            }));
          })
          .then(null, done);
      });

    });
  });
});
