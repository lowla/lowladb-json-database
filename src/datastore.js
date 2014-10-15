/**
 * Created by michael on 10/15/14.
 */

var LowlaDB = (function(LowlaDB) {

  var indexedDB = this.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
  var Datastore = function() {
    if (!(this instanceof Datastore)) {
      return new Datastore();
    }
  };

  var _ready = false;
  var db = function() {
    if (!_ready) {
      if (!indexedDB) {
        throw Error('Unable to identify IndexedDB instance');
      }

      _ready = new Promise(function (resolve, reject) {
        var request = indexedDB.open("lowla", 1);
        request.onupgradeneeded = function (e) {
          var db = e.target.result;

          e.target.transaction.onerror = reject;

          var store = db.createObjectStore("lowla",
            {keyPath: "clientId"});
        };

        request.onsuccess = function (e) {
          resolve(e.target.result);
        };

        request.onerror = function (e) {
          reject(e);
        };
      });
    }

    return _ready;
  };

  Datastore.prototype.scanDocuments = function(docFn, doneFn, errFn) {
    db().then(function(db) {
      if (typeof(docFn) === 'object') {
        doneFn = docFn.done || function () {
        };
        docFn = docFn.document || function () {
        };
        errFn = docFn.error || function (err) { throw err; };
      }

      var trans = db.transaction(["lowla"], "readwrite");
      var store = trans.objectStore("lowla");

      // Get everything in the store;
      var keyRange = IDBKeyRange.lowerBound(0);
      var cursorRequest = store.openCursor(keyRange);

      cursorRequest.onsuccess = function (e) {
        var result = e.target.result;
        if (!result) {
          doneFn();
          return;
        }

        docFn(result.value.clientId, result.value.document);
        result.continue();
      };

      cursorRequest.onerror = function (e) {
        errFn(e);
      };
    });
  };

  Datastore.prototype.updateDocument = function(clientId, doc, doneFn, errorFn) {
    db().then(function (db) {
      var trans = db.transaction(["lowla"], "readwrite");
      var store = trans.objectStore("lowla");
      var request = store.put({
        "clientId": clientId,
        "document": doc
      });

      trans.oncomplete = function (e) {
        if (doneFn) {
          doneFn(doc);
        }
      };

      request.onerror = function (e) {
        if (errorFn) {
          errorFn(e);
        }
      };
    });
  };

  Datastore.prototype.deleteDocument = function(clientId, doneFn, errorFn) {
    if (typeof doneFn === 'object') {
      errorFn = doneFn.error || function(e) { throw e; };
      doneFn = doneFn.done || function() { };
    }

    db().then(function(db) {
      var request = db.transaction(["lowla"], "readwrite").objectStore("lowla").delete(clientId);
      request.onsuccess = function(event) {
        doneFn();
      };
      request.onerror = function(event) {
        errorFn();
      };
    });
  };

  Datastore.prototype.close = function() {
    if (_ready) {
      return _ready.then(function(db) {
        _ready = false;
        db.close();
      });
    }
  };

  LowlaDB.Datastore = new Datastore();

  return LowlaDB;
})(LowlaDB || {});