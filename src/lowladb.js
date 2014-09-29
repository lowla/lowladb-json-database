/**
 * Created by michael on 9/22/14.
 */

(function() {
  'use strict';

  var indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

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
      if (filter.hasOwnProperty(i) && doc.hasOwnProperty(i)) {
        if (filter[i] !== doc[i]) {
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
          for (var j in operations[i]) {
            if (obj.hasOwnProperty(j)) {
              delete obj[j];
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
    return coll.ready.then(function(db) {
      return new Promise(function(resolve, reject) {

        var trans = db.transaction(["lowla"], "readwrite");
        var store = trans.objectStore("lowla");

        // Get everything in the store;
        var keyRange = IDBKeyRange.lowerBound(0);
        var cursorRequest = store.openCursor(keyRange);

        var data = [ ];

        var clientIdPrefix = coll.dbName + '.' + coll.collectionName + '$';

        cursorRequest.onsuccess = function (e) {
          var result = e.target.result;
          if (!!result == false) {
            resolve(data);
            return;
          }

          if (result.value.clientId.indexOf(clientIdPrefix) == 0 && filterApplies(cursor._filter, result.value.document)) {
            data.push(result.value.document);
          }

          result.continue();
        };

        cursorRequest.onerror = function (e) {
          reject(e);
        };
      });
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
    if (typeof(sort) == 'array' && sort.length % 2) {
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
    })
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

  var Collection = function (dbName, collectionName) {
    if (!indexedDB) {
      throw Error("LowlaDB requires IndexedDB");
    }

    var collection = this;
    this.dbName = dbName;
    this.collectionName = collectionName;

    var coll = this;
    this.ready = new Promise(function (resolve, reject) {
      var request = indexedDB.open("lowla", 1);
      request.onupgradeneeded = function (e) {
        var db = e.target.result;

        e.target.transaction.onerror = indexedDBOnError;

        var store = db.createObjectStore("lowla",
          {keyPath: "clientId"});
      };

      request.onsuccess = function (e) {
        coll.db = e.target.result;
        resolve(coll.db);
      };

      request.onerror = function (e) {
        reject(e);
      }
    });
  };

  Collection.prototype.insert = function(obj, callback) {
    var coll = this;
    return this.ready
      .then(function (db) {
        if (!obj) {
          throw Error("Invalid object");
        }

        return new Promise(function(resolve, reject) {
          obj._id = obj._id || generateId();
          var lowlaID = coll.dbName + '.' + coll.collectionName + '$' + obj._id;

          var trans = db.transaction(["lowla"], "readwrite");
          var store = trans.objectStore("lowla");
          var request = store.put({
            "clientId": lowlaID,
            "document": obj
          });

          trans.oncomplete = function (e) {
            resolve(obj);
          };

          request.onerror = function (e) {
            reject(e);
          };
        });
      })
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
        return new Promise(function(resolve, reject) {
          if (0 == arr.length) {
            resolve(null);
            return;
          }

          var objectStore = coll.db.transaction(["lowla"], "readwrite").objectStore("lowla");
          var obj = mutateObject(arr[0], operations);
          var requestUpdate = objectStore.put(
            {
              clientId: coll.dbName + '.' + coll.collectionName + '$' + obj._id,
              document: obj
            });

          requestUpdate.onerror = function (event) {
            reject(event.target || Error('Error modifying obj'));
          };
          requestUpdate.onsuccess = function (event) {
            resolve(obj);
          };
        });
      });
  };

  Collection.prototype.remove = function(filter) {
    var coll = this;
    return this.find(filter).toArray()
      .then(function(arr) {
        return new Promise(function(resolve, reject) {
          if (0 == arr.length) {
            resolve(0);
            return;
          }

          return Promise.all(arr.map(function(obj) {
            return new Promise(function(resolve, reject) {
              var objId = coll.dbName + '.' + coll.collectionName + '$' + obj._id;
              var request = coll.db.transaction(["lowla"], "readwrite").objectStore("lowla").delete(objId);
              request.onsuccess = function(event) {
                resolve(1);
              };
              request.onerror = function(event) {
                reject(0);
              }
            })
          }))
            .then(function(deleted) {
              resolve(deleted.length);
            })
            .catch(function(err) {
              reject(err);
            });
        })
      })
  };

  var lowlaDB = {
    collection: function(dbName, collectionName) {
      return new Collection(dbName, collectionName);
    },

    sync: function(serverUrl, options) {

    }
  };

  this.LowlaDB = lowlaDB;
}
).call(this);