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

  var filterApplies = function(filter, doc) {
    for (var i in filter) {
      if (filter.hasOwnProperty(i)) {
        if (!doc.hasOwnProperty(i) || filter[i] !== doc[i]) {
          return false;
        }
      }
    }

    return true;
  };

  var mutateObject = function(obj, operations) {
    var opMode = false;
    for (var i in operations) {
      if (operations.hasOwnProperty(i)) {
        if (i === '$set') {
          opMode = true;
          for (var j in operations[i]) {
            if (operations[i].hasOwnProperty(j)) {
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
        else {
          if (opMode) {
            throw Error('Can not mix operations and values in object updates');
          }
        }
      }
    }
    if (!opMode) {
      return operations;
    }
    else {
      return obj;
    }
  };

  var Cursor = function(collection, filter, options) {
    this._collection = collection;
    this._filter = filter;
    this._options = {
      sort: null,
      limit: 0
    };

    for (var i in options) {
      if (options.hasOwnProperty(i)) {
        this._options[i] = options[i];
      }
    }
  };

  var docCompareFunc = function(sort, a, b) {
    if (a.hasOwnProperty(sort)) {
      if (!b.hasOwnProperty(sort)) {
        return 1;
      }
      else {
        return a[sort] < b[sort] ? -1 : (a[sort] == b[sort] ? 0 : 1);
      }
    }
    else {
      if (!b.hasOwnProperty(sort)) {
        return 0;
      }
      return -1;
    }
  };

  Cursor.prototype._applyFilter = function() {
    var cursor = this;
    var coll = this._collection;
    return new Promise(function(resolve, reject) {
      var data = [];
      var clientIdPrefix = coll.dbName + '.' + coll.collectionName + '$';

      LowlaDB.Datastore.scanDocuments({
        document: function(clientId, doc) {
          if (clientId.indexOf(clientIdPrefix) === 0 && filterApplies(cursor._filter, doc)) {
            data.push(doc);
          }
        },

        done: function() {
          resolve(data);
        },

        error: reject
      });
    })
      .then(function(data) {
        return data.map(LowlaDB.SyncCoordinator.convertSpecialTypes);
      })
      .then(function(data) {
        if (!cursor._options.sort) {
          return data;
        }

        var sort = cursor._options.sort;
        data.sort(function(a,b) {
           if (typeof(sort) == 'string') {
             return docCompareFunc(sort, a, b);
           }
           else if (sort instanceof Array) {
             for (var i = 0; i < sort.length; i += 2) {
               var answer = docCompareFunc(sort[i], a, b);
               if (sort[i+1] < 0) {
                 answer = -answer;
               }
               if (answer) {
                 return answer;
               }
             }

             return 0;
           }
        });

        return data;
      })
      .then(function(data) {
        if (!cursor._options.limit) {
          return data;
        }
        return data.slice(0, cursor._options.limit);
      });
  };

  var liveCursors = {};

  Cursor.prototype.on = function (callback) {
    var coll = this._collection;
    var key = coll.dbName + '.' + coll.collectionName;
    if (!liveCursors[key]) {
      liveCursors[key] = [];
    }
    liveCursors[key].push({ cursor: this, callback: callback });
    callback(null, this);
  };

  var notifyLive = function (coll) {
    var key = coll.dbName + '.' + coll.collectionName;
    if (!liveCursors[key]) {
      return;
    }

    liveCursors[key].forEach(function (watcher) {
      watcher.callback(null, watcher.cursor);
    });
  };

  Cursor.prototype.cloneWithOptions = function(options) {
    var answer = new Cursor(this._collection, this._filter);
    answer._options = this._options;
    for (var i in options) {
      if (options.hasOwnProperty(i)) {
        answer._options[i] = options[i];
      }
    }

    return answer;
  };

  Cursor.prototype.limit = function(amount) {
    return this.cloneWithOptions({ limit: amount });
  };

  Cursor.prototype.sort = function(sort) {
    if (sort instanceof Array && sort.length % 2) {
      throw Error('Invalid sort array, must be pairs');
    }
    return this.cloneWithOptions({ sort: sort });
  };

  Cursor.prototype.each = function(callback) {
    if (!callback) {
      return;
    }

    var data = this._applyFilter();
    data.forEach(function(doc) {
      callback(null, doc);
    });
  };

  Cursor.prototype.toArray = function(callback) {
    var _this = this;
    return this._applyFilter()
      .then(function(filtered) {
        if (callback) {
          callback(null, filtered);
        }
        return filtered;
      }, function(err) {
        if (callback) {
          callback(err);
        }
        throw err;
      });
  };

  var indexedDBOnError = function(e) {
    console.log("IndexedDB Error: " + e);
    throw e;
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

  Collection.prototype._updateIndexedDB = function(obj) {
    var coll = this;
    return new Promise(function(resolve, reject) {
      obj._id = obj._id || generateId();
      var lowlaID = coll.dbName + '.' + coll.collectionName + '$' + obj._id;
      LowlaDB.Datastore.updateDocument(lowlaID, obj, resolve, reject);
    })
      .then(function(doc) {
        notifyLive(coll);
        return doc;
      });

  };

  Collection.prototype.insert = function(obj, callback) {
    return this._updateIndexedDB(obj)
      .then(function(savedObj) {
        if (callback) {
          callback(null, savedObj);
        }
        return savedObj;
      })
      .catch(function(e) {
        if (callback) {
          callback(e);
        }
        throw e;
      });
  };

  Collection.prototype.findOne = function(filter, callback) {
    return new Cursor(this, filter).limit(1).toArray().then(function(arr) {
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
    return new Cursor(this, filter);
  };


  Collection.prototype.findAndModify = function(filter, operations, callback) {
    var coll = this;
    return this.find(filter).toArray()
      .then(function(arr) {
        if (0 === arr.length) {
          return null;
        }

        var obj = mutateObject(arr[0], operations);
        return coll._updateIndexedDB(obj);
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
              notifyLive(coll);
            })
            .catch(function(err) {
              reject(err);
            });
        });
      });
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

    return LowlaDB._syncCoordinator.fetchChanges().then(function () {
      if (options && 0 !== options.pollFrequency) {
        var pollFunc = function () {
          LowlaDB._syncCoordinator.fetchChanges()
            .then(function () {
              setTimeout(pollFunc, options.pollFrequency);
            });
        };

        setTimeout(pollFunc, options.pollFrequency);
      }
    }, function (err) {
      throw err;
    });
  };

  LowlaDB.close = function() {
    LowlaDB.Datastore.close();
  };

  return LowlaDB;
}
)(LowlaDB || {});
