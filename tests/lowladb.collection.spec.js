describe('LowlaDB Collection', function() {
  beforeEach(testUtils.setUp);
  afterEach(testUtils.tearDown);

  it('prevents inserting $field names', function() {
    var coll = LowlaDB.collection('dbName', 'TestCollection');
    return coll.insert({$field: 1}).should.eventually.be.rejectedWith(Error, /\$field/);
  });

  it('prevents replacement updates with $field names', function() {
    var coll = LowlaDB.collection('dbName', 'TestCollection');
    return coll
      .insert({a: 1})
      .then(function(obj) {
        return coll
          .findAndModify({_id: obj._id}, {$badField: 2})
          .should.eventually.be.rejectedWith(Error, /\$badField/);
      });
  });

  it('prevents update operations on $field names', function() {
    var coll = LowlaDB.collection('dbName', 'TestCollection');
    return coll
      .insert({a: 1})
      .then(function(obj) {
        return coll
          .findAndModify({_id: obj._id}, {$set: { $badName: 3 }})
          .should.eventually.be.rejectedWith(Error, /\$badName/);
      });
  });
});