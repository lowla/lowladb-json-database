/**
 * Created by michael on 10/15/14.
 */

(function(LowlaDB) {

  var indexedDB = this.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
  var Datastore = function() {
    if (!(this instanceof Datastore)) {
      return new Datastore();
    }
  };

  Datastore._makeKey = _makeKey;
  
  function _makeKey(clientNs, lowlaId) {
    return clientNs + '$' + lowlaId;
  }

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

          db.createObjectStore("lowla");
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
        errFn = docFn.error || function (err) { throw err; };
        docFn = docFn.document || function () {
        };
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

        docFn(result.value);
        result.continue();
      };

      cursorRequest.onerror = function (e) {
        errFn(e);
      };
    });
  };

  Datastore.prototype.transact = function(callback, doneCallback, errCallback) {
    errCallback = errCallback || function(){};

    db().then(function(db) {
      var tx = db.transaction(["lowla"], "readwrite");
      tx.oncomplete = function(evt) {
        doneCallback();
      };
      tx.onerror = function(e) {
        errCallback(e);
      };

      var txWrapper = {
        errCb: errCallback,
        load: loadInTx,
        save: saveInTx,
        scan: scanInTx,
        remove: removeInTx
      };

      try {
        callback(txWrapper);
      }
      catch (err) {
        errCallback(err);
      }
      ////////////////////

      function loadInTx(clientNs, lowlaId, loadCallback, loadErrCallback) {
        loadErrCallback = loadErrCallback || errCallback;
        var store = tx.objectStore("lowla");
        var keyRange = IDBKeyRange.only(_makeKey(clientNs, lowlaId));
        var request = store.openCursor(keyRange);
        request.onsuccess = function (evt) {
          var doc = evt.target.result ? evt.target.result.value.document : null;
          loadCallback(doc, txWrapper);
        };
        request.onerror = loadErrCallback;
      }

      function saveInTx(clientNs, lowlaId, doc, saveCallback, saveErrCallback) {
        saveErrCallback = saveErrCallback || errCallback;
        var store = tx.objectStore("lowla");
        var request = store.put({
          "clientNs": clientNs,
          "lowlaId": lowlaId,
          "document": doc
        }, _makeKey(clientNs, lowlaId));

        request.onsuccess = function (e) {
          if (saveCallback) {
            saveCallback(doc, txWrapper);
          }
        };

        request.onerror = function (e) {
          saveErrCallback(e);
        };
      }

      function scanInTx(scanCallback, scanDoneCallback, scanErrCallback) {
        scanErrCallback = scanErrCallback || errCallback;
        var store = tx.objectStore("lowla");
        var keyRange = IDBKeyRange.lowerBound(0);
        var request = store.openCursor(keyRange);

        request.onsuccess = function (e) {
          var result = e.target.result;
          if (!result) {
            scanDoneCallback(txWrapper);
            return;
          }

          scanCallback(result.value, txWrapper);
          result.continue();
        };

        request.onerror = function (e) {
          scanErrCallback(e);
        };
      }

      function removeInTx(clientNs, lowlaId, removeDoneCallback, removeErrCallback) {
        removeErrCallback = removeErrCallback || errCallback;
        var request = tx.objectStore("lowla").delete(_makeKey(clientNs, lowlaId));
        request.onsuccess = function() {
          if (removeDoneCallback) {
            removeDoneCallback(txWrapper);
          }
        };
        request.onerror = removeErrCallback;
      }
    });

  };

  Datastore.prototype.loadDocument = function(clientNs, lowlaId, docFn, errFn) {
    db().then(function(db) {
      if (typeof(docFn) === 'object') {
        errFn = docFn.error || function (err) { throw err; };
        docFn = docFn.document || function () {
        };
      }

      var trans = db.transaction(["lowla"], "readwrite");
      var store = trans.objectStore("lowla");

      var keyRange = IDBKeyRange.only(_makeKey(clientNs, lowlaId));
      var cursorRequest = store.openCursor(keyRange);

      cursorRequest.onsuccess = function (e) {
        var result = e.target.result;
        if (!result) {
          docFn(null);
        }
        else {
          docFn(result.value.document);
        }
      };

      cursorRequest.onerror = function (e) {
        errFn(e);
      };
    });
  };

  Datastore.prototype.updateDocument = function(clientNs, lowlaId, doc, doneFn, errorFn) {
    db().then(function (db) {
      var trans = db.transaction(["lowla"], "readwrite");
      var store = trans.objectStore("lowla");
      var request = store.put({
        "clientNs": clientNs,
        "lowlaId": lowlaId,
        "document": doc
      }, _makeKey(clientNs, lowlaId));

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

  Datastore.prototype.close = function() {
    if (_ready) {
      return _ready.then(function(db) {
        _ready = false;
        db.close();
      });
    }
  };

  Datastore.prototype.countAll = function(clientNs, doneFn, errFn) {
    db().then(function(db) {
      var trans = db.transaction(["lowla"], "readwrite");
      var store = trans.objectStore("lowla");
      var keyRange = IDBKeyRange.bound(clientNs + '$', clientNs + '%', false, true);
      var request = store.count(keyRange);
      request.onsuccess = function() {
        doneFn(request.result);
      };
      if (errFn) {
        request.onerror = function(e) {
          errFn(e);
        };
      }
    });
  };
  
  LowlaDB.registerDatastore('IndexedDB', new Datastore());

  return LowlaDB;
})(LowlaDB);