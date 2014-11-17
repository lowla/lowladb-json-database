/**
 * Created by michael on 11/13/14.
 */

(function(LowlaDB) {
  var data = {};

  // Public API
  MemoryDatastore.prototype.scanDocuments = scanDocuments;
  MemoryDatastore.prototype.transact = transact;
  MemoryDatastore.prototype.loadDocument = loadDocument;
  MemoryDatastore.prototype.updateDocument = updateDocument;
  MemoryDatastore.prototype.close = close;

  LowlaDB.registerDatastore('Memory', new MemoryDatastore());
  return LowlaDB;
  ///////////////

  function MemoryDatastore() {
    if (!(this instanceof MemoryDatastore)) {
      return new MemoryDatastore();
    }
  }

  function _copyObj(obj) {
    if (obj) {
      var copy = {};
      LowlaDB.utils.keys(obj).forEach(function(key) {
        copy[key] = obj[key];
      });
      obj = copy;
    }

    return obj;
  }

  function close() {
    data = {};
  }

  function updateDocument(lowlaID, doc, doneFn) {
    data[lowlaID] = doc;
    doneFn(doc);
  }

  function loadDocument(lowlaID, docFn) {
    if (typeof(docFn) === 'object') {
      docFn = docFn.document || function () {};
    }

    var doc = _copyObj(data[lowlaID]);
    docFn(doc);
  }

  function scanDocuments(docFn, doneFn) {
    if (typeof(docFn) === 'object') {
      doneFn = docFn.done || function () {
      };
      docFn = docFn.document || function () {
      };
    }

    LowlaDB.utils.keys(data).forEach(function(key) {
      docFn(key, _copyObj(data[key]));
    });

    doneFn();
  }

  function remove(lowlaID, doneFn) {
    delete data[lowlaID];
    doneFn();
  }

  function transact(callback, doneCallback, errCallback) {
    errCallback = errCallback || function(){};
    var txWrapper = {
      errCb: errCallback,
      load: loadInTx,
      save: saveInTx,
      scan: scanInTx,
      remove: removeInTx
    };

    try {
      setTimeout(function() {
        doneCallback();
      }, 0);

      callback(txWrapper);
    }
    catch (e) {
      errCallback(e);
    }
    /////////////////

    function loadInTx(lowlaID, loadCallback) {
      loadDocument(lowlaID, function(doc) {
        if (loadCallback) {
          loadCallback(doc, txWrapper);
        }
      });
    }

    function saveInTx(lowlaID, doc, saveCallback) {
      updateDocument(lowlaID, doc, function(doc) {
        if (saveCallback) {
          saveCallback(doc, txWrapper);
        }
      });
    }

    function scanInTx(scanCallback, scanDoneCallback) {
      scanDocuments(function(lowlaID, doc) {
        if (scanCallback) {
          scanCallback(lowlaID, doc, txWrapper);
        }
      }, function() {
        if (scanDoneCallback) {
          scanDoneCallback(txWrapper);
        }
      });
    }

    function removeInTx(lowlaID, removeDoneCallback) {
      remove(lowlaID, function() {
        if (removeDoneCallback) {
          removeDoneCallback(txWrapper);
        }
      });
    }
  }
})(LowlaDB);