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
        if (typeof obj[key] === 'object') {
          copy[key] = _copyObj(obj[key]);
        }
        else {
          copy[key] = obj[key];
        }
      });
      obj = copy;
    }

    return obj;
  }

  function close() {
    data = {};
  }

  function updateDocument(clientNs, lowlaID, doc, doneFn) {
    data[clientNs + "$" + lowlaID] = {
      clientNs: clientNs,
      lowlaId: lowlaID,
      document: doc
    };
    doneFn(doc);
  }

  function loadDocument(clientNs, lowlaID, docFn) {
    if (typeof(docFn) === 'object') {
      docFn = docFn.document || function () {};
    }

    var doc = data[clientNs + '$' + lowlaID];
    if (doc) {
      docFn(_copyObj(doc.document));
    }
    else {
      docFn(doc);
    }
  }

  function scanDocuments(docFn, doneFn) {
    if (typeof(docFn) === 'object') {
      doneFn = docFn.done || function () {
      };
      docFn = docFn.document || function () {
      };
    }

    LowlaDB.utils.keys(data).forEach(function(key) {
      docFn(_copyObj(data[key]));
    });

    doneFn();
  }

  function remove(clientNs, lowlaID, doneFn) {
    delete data[clientNs + "$" + lowlaID];
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

    function loadInTx(clientNs, lowlaID, loadCallback) {
      loadDocument(clientNs, lowlaID, function(doc) {
        if (loadCallback) {
          loadCallback(doc, txWrapper);
        }
      });
    }

    function saveInTx(clientNs, lowlaID, doc, saveCallback) {
      updateDocument(clientNs, lowlaID, doc, function(doc) {
        if (saveCallback) {
          saveCallback(doc, txWrapper);
        }
      });
    }

    function scanInTx(scanCallback, scanDoneCallback) {
      scanDocuments(function(doc) {
        if (scanCallback) {
          scanCallback(doc, txWrapper);
        }
      }, function() {
        if (scanDoneCallback) {
          scanDoneCallback(txWrapper);
        }
      });
    }

    function removeInTx(clientNs, lowlaID, removeDoneCallback) {
      remove(clientNs, lowlaID, function() {
        if (removeDoneCallback) {
          removeDoneCallback(txWrapper);
        }
      });
    }
  }
})(LowlaDB);