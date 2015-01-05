/**
 * Created by michael on 10/14/14.
 */

testUtils.eachDatastore(function (dsName) {
  'use strict';

  describe('LowlaDB DB (' + dsName + ')', function () {

    beforeEach(testUtils.setUpFn(dsName));
    afterEach(testUtils.tearDownFn());

    it('should create DB objects', function () {
      var theDB = lowla.db('dbName');
      should.exist(theDB);
    });

    it('can create collections', function () {
      var theDB = lowla.db('dbName');
      var theColl = theDB.collection('TestCollection');
      should.exist(theColl);
    });

    describe('.collectionNames', function () {
      var theDB, coll, collTwo;
      beforeEach(function () {
        theDB = lowla.db('dbName');
        coll = lowla.collection('dbName', 'collectionOne');
        collTwo = lowla.collection('dbName', 'collectionTwo');
        return Promise.all([coll.insert({a: 1}), collTwo.insert({b: 2})]);
      });

      it('can retrieve all collection names', function () {
        return theDB.collectionNames().then(function (names) {
          names.should.have.length(2);
          names[0].name.should.equal('dbName.collectionOne');
          names[1].name.should.equal('dbName.collectionTwo');
        });
      });

      it('can retrieve a specific collection name', function () {
        return theDB.collectionNames('collectionOne').then(function (names) {
          names.should.have.length(1);
          names[0].name.should.equal('dbName.collectionOne');
        });
      });

      it('can return only the collection names', function () {
        return theDB.collectionNames({namesOnly: true}).then(function (names) {
          names.should.have.length(2);
          names[0].should.equal('dbName.collectionOne');
          names[1].should.equal('dbName.collectionTwo');
        });
      });

      it('can return names via callback', function (done) {
        return theDB.collectionNames(function (err, names) {
          if (err) {
            done(err);
            return;
          }

          names.should.have.length(2);
          done();
        });
      });

      it('fails when scanDocuments errors', function (done) {
        testUtils.sandbox.stub(lowla.datastore, 'scanDocuments').throws(Error('Datastore error'));
        theDB
          .collectionNames()
          .should.eventually.be.rejectedWith(Error, /Datastore error/)
          .then(function () {
            theDB.collectionNames(testUtils.cb(done, function (err, names) {
              should.not.exist(names);
              err.should.match(/Datastore error/);
            }));
          })
          .then(null, done);
      });
    });
  });
});
