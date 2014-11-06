var LowlaDB = (function(LowlaDB) {
  'use strict';

  LowlaDB.Collection = Collection;

  // Public API
  Collection.prototype.insert = insert;
  Collection.prototype.findOne = findOne;
  Collection.prototype.find = find;
  Collection.prototype.findAndModify = findAndModify;
  Collection.prototype.remove = remove;
  Collection.prototype.count = count;

  // Internal API
  Collection.prototype._updateDocument = _updateDocument;
  Collection.prototype._updateDocumentInTx = _updateDocumentInTx;

  return LowlaDB;
  ///////////////

  function Collection(dbName, collectionName) {
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  function generateId() {
    /*jshint bitwise:false */
    var i, random;
    var uuid = '';

    for (i = 0; i < 32; i++) {
      random = Math.random() * 16 | 0;
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        uuid += '-';
      }
      uuid += (i === 12 ? 4 : (i === 16 ? (random & 3 | 8) : random)).toString(16);
    }

    return uuid;
  }

  function mutateObject(obj, operations) {
    var opMode = false;
    for (var i in operations) {
      if (operations.hasOwnProperty(i)) {
        if (i === '$set') {
          opMode = true;
          for (var j in operations[i]) {
            if (operations[i].hasOwnProperty(j)) {
              if (j.indexOf('$') === 0) {
                throw Error('The dollar ($) prefixed field ' + j + ' is not valid');
              }
              obj[j] = operations[i][j];
            }
          }
        }
        else if (i === '$unset') {
          opMode = true;
          for (var j2 in operations[i]) {
            if (obj.hasOwnProperty(j2)) {
              delete obj[j2];
            }
          }
        }
        else if (i.substring(0, 1) === '$') {
          throw Error(opMode ? 'Unknown modifier: ' + i : 'The dollar ($) prefixed field ' + i + ' is not valid');
        }
        else {
          if (opMode) {
            throw Error('Can not mix operations and values in object updates');
          }
        }
      }
    }
    if (!opMode) {
      if (!operations.hasOwnProperty('_id') && obj.hasOwnProperty('_id')) {
        operations._id = obj._id;
      }
      return operations;
    }
    else {
      return obj;
    }
  }

  function _updateDocument(obj, flagEight) {
    /*jshint validthis:true */
    var coll = this;
    var savedDoc = null;
    return new Promise(function(resolve, reject) {
      LowlaDB.Datastore.transact(doUpdate, resolve, reject);
      function doUpdate(tx) {
        coll._updateDocumentInTx(tx, obj, flagEight, function(doc) {
          savedDoc = doc;
        });
      }
    })
      .then(function() {
        return savedDoc;
      });
  }

  function _updateDocumentInTx(tx, obj, flagEight, savedCallback) {
    /*jshint validthis:true */
    var coll = this;
    obj._id = obj._id || generateId();
    var lowlaID = coll.dbName + '.' + coll.collectionName + '$' + obj._id;

    if (flagEight) {
      saveOnly(tx);
    }
    else {
      updateWithMeta(tx);
    }

    function updateWithMeta(tx) {
      tx.load("$metadata", checkMeta);
    }

    function checkMeta(metaDoc, tx) {
      if (!metaDoc || !metaDoc.changes || !metaDoc.changes[lowlaID]) {
        tx.load(lowlaID, updateMetaChanges);
      }
      else {
        tx.save(lowlaID, obj, objSaved);
      }

      function updateMetaChanges(oldDoc, tx) {
        oldDoc = oldDoc || {};
        metaDoc = metaDoc || { changes: {} };
        metaDoc.changes = metaDoc.changes || {};
        metaDoc.changes[lowlaID] = oldDoc;
        tx.save("$metadata", metaDoc, saveOnly);
      }
    }

    function saveOnly(metaDoc, tx) {
      if (tx === undefined) {
        tx = metaDoc;
      }
      tx.save(lowlaID, obj, objSaved);
    }

    function objSaved(savedDoc) {
      savedCallback(savedDoc);
      LowlaDB.Cursor.notifyLive(coll);
    }
  }

  function insert(obj, callback) {
    /*jshint validthis:true */
    var coll = this;
    var savedDoc = null;
    return new Promise(function(resolve, reject) {
      LowlaDB.utils.keys(obj).forEach(function(key) {
        if (key.substring(0, 1) === '$') {
          reject(Error('The dollar ($) prefixed field ' + key + ' is not valid'));
        }
      });

      LowlaDB.Datastore.transact(doInsert, resolve, reject);

      function doInsert(tx) {
        coll._updateDocumentInTx(tx, obj, false, function(doc) {
          savedDoc = doc;
        });
      }
    })
      .then(function() {
        if (callback) {
          callback(null, savedDoc);
        }
        return savedDoc;
      })
      .catch(function(e) {
        if (callback) {
          callback(e);
        }
        throw e;
      });
  }

  function findOne(filter, callback) {
    /*jshint validthis:true */
    return LowlaDB.Cursor(this, filter).limit(1).toArray().then(function(arr) {
      var obj = (arr && arr.length > 0) ? arr[0] : undefined;
      if (callback) {
        callback(null, obj);
      }
      return obj;
    }, function(err) {
      if (callback) {
        callback(err);
      }
      throw err;
    });
  }

  function find(filter) {
    /*jshint validthis:true */
    return LowlaDB.Cursor(this, filter);
  }

  function findAndModify(filter, operations, callback) {
    /*jshint validthis:true */
    var coll = this;
    var savedObj = null;
    return new Promise(function(resolve, reject) {
      LowlaDB.Datastore.transact(doFind, resolve, reject);

      function doFind(tx) {
        coll.find(filter)._applyFilterInTx(tx, updateDoc);
      }

      function updateDoc(docArr, tx) {
        if (0 === docArr.length) {
          return;
        }

        var obj = mutateObject(docArr[0], operations);
        coll._updateDocumentInTx(tx, obj, false, function(obj) {
          savedObj = obj;
        }, reject);
      }
    })
      .then(function() {
        return savedObj;
      });
  }

  function remove(filter) {
    /*jshint validthis:true */
    var coll = this;
    return this.find(filter).toArray()
      .then(function(arr) {
        return new Promise(function(resolve, reject) {
          if (0 === arr.length) {
            resolve(0);
            return;
          }

          return Promise.all(arr.map(function(obj) {
            return new Promise(function(resolve, reject) {
              var objId = coll.dbName + '.' + coll.collectionName + '$' + obj._id;
              LowlaDB.Datastore.deleteDocument(objId, {
                done: function() { resolve(1); },
                error: function() { reject(0); }
              });
            });
          }))
            .then(function(deleted) {
              resolve(deleted.length);
              LowlaDB.Cursor.notifyLive(coll);
            })
            .catch(function(err) {
              reject(err);
            });
        });
      });
  }

  function count(query) {
    /*jshint validthis:true */
    return this.find(query).count();
  }
})(LowlaDB || {});