(function(LowlaDB) {
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
  Collection.prototype._removeDocument = _removeDocument;
  Collection.prototype._removeDocumentInTx = _removeDocumentInTx;

  return LowlaDB;
  ///////////////

  function Collection(lowla, dbName, collectionName) {
    this.dbName = dbName;
    this.collectionName = collectionName;
    this.lowla = lowla;
    this.datastore = lowla.datastore;
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
            if (operations[i].hasOwnProperty(j2) && obj.hasOwnProperty(j2)) {
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
      coll.datastore.transact(doUpdate, resolve, reject);
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
    savedCallback = savedCallback || function(){};
    var coll = this;
    obj._id = obj._id || generateId();
    var lowlaID = coll.dbName + '.' + coll.collectionName + '$' + obj._id;

    coll.lowla.emit('_saveHook', obj, lowlaID);

    if (flagEight) {
      saveOnly(tx);
    }
    else {
      updateWithMeta(tx, lowlaID, saveOnly);
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

  function _removeDocument(lowlaID, flagEight) {
    /*jshint validthis:true */
    var coll = this;
    return new Promise(function(resolve, reject) {
      coll.datastore.transact(doUpdate, resolve, reject);
      function doUpdate(tx) {
        coll._removeDocumentInTx(tx, lowlaID, flagEight);
      }
    });
  }

  function _removeDocumentInTx(tx, lowlaID, flagEight, removedCallback) {
    removedCallback = removedCallback || function(){};
    if (flagEight) {
      removeOnly(tx);
    }
    else {
      updateWithMeta(tx, lowlaID, removeOnly);
    }

    function removeOnly(metaDoc, tx) {
      if (tx === undefined) {
        tx = metaDoc;
      }
      tx.remove(lowlaID, objRemoved);
    }

    function objRemoved() {
      removedCallback();
    }
  }

  function updateWithMeta(tx, lowlaID, nextFn) {
    tx.load("$metadata", checkMeta);

    function checkMeta(metaDoc, tx) {
      if (!metaDoc || !metaDoc.changes || !metaDoc.changes[lowlaID]) {
        tx.load(lowlaID, updateMetaChanges);
      }
      else {
        nextFn(metaDoc, tx);
      }

      function updateMetaChanges(oldDoc, tx) {
        oldDoc = oldDoc || {};
        metaDoc = metaDoc || {changes: {}};
        metaDoc.changes = metaDoc.changes || {};
        metaDoc.changes[lowlaID] = oldDoc;
        tx.save("$metadata", metaDoc, nextFn);
      }
    }
  }

  function insert(arg, callback) {
    /*jshint validthis:true */
    var coll = this;
    var savedDoc = [];
    return new Promise(function(resolve, reject) {
      var docs = LowlaDB.utils.isArray(arg) ? arg : [ arg ];
      docs.forEach(function(doc) {
        LowlaDB.utils.keys(doc).forEach(function(key) {
          if (key.substring(0, 1) === '$') {
            reject(Error('The dollar ($) prefixed field ' + key + ' is not valid'));
          }
        });
      });

      coll.datastore.transact(doInsert, resolve, reject);

      function doInsert(tx) {
        var curInsert = 0;
        coll._updateDocumentInTx(tx, docs[curInsert], false, nextDoc);

        function nextDoc(saved) {
          savedDoc.push(saved);
          ++curInsert;
          if (curInsert < docs.length) {
            coll._updateDocumentInTx(tx, docs[curInsert], false, nextDoc);
          }
        }
      }
    })
      .then(function() {
        if (!LowlaDB.utils.isArray(arg)) {
          savedDoc = savedDoc.length ? savedDoc[0] : null;
        }
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
    var coll = this;
    return Promise.resolve()
      .then(function() {
        return LowlaDB.Cursor(coll, filter).limit(1).toArray();
      })
      .then(function(arr) {
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
      coll.datastore.transact(doFind, resolve, reject);

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
        if (callback) {
          callback(null, savedObj);
        }
        return savedObj;
      }, function(err) {
        if (callback) {
          callback(err);
        }
        throw err;
      });
  }

  function remove(filter, callback) {
    /*jshint validthis:true */
    var coll = this;

    if (typeof(filter) === 'function') {
      callback = filter;
      filter = {};
    }

    return Promise.resolve()
      .then(function() {
        return coll.find(filter).toArray();
      })
      .then(function(arr) {
        var countRemoved = 0;
        return new Promise(function (resolve, reject) {
          if (0 === arr.length) {
            resolve(0);
            return;
          }

          coll.datastore.transact(txFn, resolve, reject);

          function txFn(tx) {
            arr.map(function (doc) {
              var lowlaID = coll.dbName + '.' + coll.collectionName + '$' + doc._id;
              coll.lowla.emit('_saveHook', null, lowlaID);
              coll._removeDocumentInTx(tx, lowlaID, false, function () {
                countRemoved = countRemoved + 1;
              });
            });
          }
        })
          .then(function () {
            LowlaDB.Cursor.notifyLive(coll);
            return countRemoved;
          });
      })
      .then(function(count) {
        if (callback) {
          callback(null, count);
        }
        return count;
      }, function(err) {
        if (callback) {
          callback(err);
        }
        throw err;
      });
  }

  function count(query, callback) {
    /*jshint validthis:true */
    if (typeof(query) === 'function') {
      callback = query;
      query = {};
    }

    return this.find(query).count(callback);
  }
})(LowlaDB);