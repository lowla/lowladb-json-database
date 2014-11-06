/**
 * Created by michael on 9/22/14.
 */

var LowlaDB = (function(LowlaDB) {
  'use strict';

  var generateId = function() {
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
  };


  var mutateObject = function(obj, operations) {
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
  };

  var DB = function (dbName) {
    this.name = dbName;
  };

  DB.prototype.collection = function (collectionName) {
    return new Collection(this.name, collectionName);
  };

  DB.prototype.collectionNames = function () {
    var collection, options, callback;
    var args = Array.prototype.slice.call(arguments, 0);
    while (args.length > 0) {
      var arg = args.pop();
      if (arg instanceof Function) {
        callback = arg;
      }
      else if (typeof(arg) === 'string') {
        collection = arg;
      }
      else if (typeof(arg) === 'object') {
        options = arg;
      }
    }

    options = options || { namesOnly: false };
    collection = collection || '';

    var data = { };
    var dbPrefix = this.name + '.' + collection;
    return new Promise(function(resolve, reject) {
      LowlaDB.Datastore.scanDocuments({
        document: function(clientId) {
          if (clientId.indexOf(dbPrefix) === 0) {
            var dollar = clientId.indexOf('$');
            var fullName = clientId.substring(0, dollar);
            data[fullName] = true;
          }

        },
        done: function() {
          return resolve(data);
        },
        error: reject
      });
    })
      .then(function(data) {
        var answer = [];
        for (var dbCollName in data) {
          if (data.hasOwnProperty(dbCollName)) {
            if (options.namesOnly) {
              answer.push(dbCollName);
            }
            else {
              answer.push({name: dbCollName});
            }
          }
        }

        return answer;
      })
      .then(function(answer) {
        if (callback) {
          callback(null, answer);
        }
        return answer;
      }, function(err) {
        if (callback) {
          callback(err);
        }
        throw err;
      });
  };

  var Collection = function (dbName, collectionName) {
    this.dbName = dbName;
    this.collectionName = collectionName;
  };

  Collection.prototype._updateDocument = function(obj, flagEight) {
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
  };

  Collection.prototype._updateDocumentInTx = function(tx, obj, flagEight, savedCallback) {
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
  };

  Collection.prototype.insert = function(obj, callback) {
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
  };

  Collection.prototype.findOne = function(filter, callback) {
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
  };

  Collection.prototype.find = function(filter) {
    return LowlaDB.Cursor(this, filter);
  };

  Collection.prototype.findAndModify = function(filter, operations, callback) {
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
  };

  Collection.prototype.remove = function(filter) {
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
  };

  Collection.prototype.count = function(query) {
    return this.find(query).count();
  };

  LowlaDB.db = function (dbName) {
    return new DB(dbName);
  };

  LowlaDB.collection = function(dbName, collectionName) {
    return new Collection(dbName, collectionName);
  };

  LowlaDB.sync = function(serverUrl, options) {
    LowlaDB._syncCoordinator = new LowlaDB.SyncCoordinator(serverUrl, options);
    if (options && -1 == options.pollFrequency) {
      return;
    }

    var pushPull = function() {
      LowlaDB.emit('syncBegin');
      return LowlaDB._syncCoordinator.pushChanges()
        .then(function() {
          return LowlaDB._syncCoordinator.fetchChanges();
        })
        .then(function(arg) {
          LowlaDB.emit('syncEnd');
          return arg;
        }, function(err) {
          LowlaDB.emit('syncEnd');
          throw err;
        });
    };

    return pushPull().then(function () {
      if (options && 0 !== options.pollFrequency) {
        var pollFunc = function () {
          pushPull().then(function () {
              setTimeout(pollFunc, options.pollFrequency);
            });
        };

        setTimeout(pollFunc, options.pollFrequency);
      }
    }, function (err) {
      throw err;
    });
  };

  var lowlaEvents = {};
  LowlaDB.on = function(eventName, callback) {
    if (lowlaEvents[eventName]) {
      lowlaEvents[eventName].push(callback);
    }
    else {
      lowlaEvents[eventName] = [ callback ];
    }
  };

  LowlaDB.off = function(eventName, callback) {
    if (!callback) {
      if (!eventName) {
        lowlaEvents = {};
      }
      else {
        delete lowlaEvents[eventName];
      }
    }
    else if (lowlaEvents[eventName]) {
      var index = lowlaEvents[eventName].indexOf(callback);
      if (-1 !== index) {
        lowlaEvents[eventName].splice(index, 1);
      }
    }
  };

  LowlaDB.emit = function(eventName) {
    if (lowlaEvents[eventName]) {
      lowlaEvents[eventName].forEach(function(listener) {
        listener.apply(this);
      });
    }
  };


  LowlaDB.close = function() {
    LowlaDB.Cursor.off();
    LowlaDB.off();
    LowlaDB.Datastore.close();
  };

  return LowlaDB;
}
)(LowlaDB || {});
