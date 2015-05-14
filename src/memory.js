/**
 * Created by michael on 11/13/14.
 */

(function (LowlaDB) {
  'use strict';

  var data = {};

  // Public API
  MemoryDatastore.prototype.scanDocuments = scanDocuments;
  MemoryDatastore.prototype.transact = transact;
  MemoryDatastore.prototype.loadDocument = loadDocument;
  MemoryDatastore.prototype.updateDocument = updateDocument;
  MemoryDatastore.prototype.close = closeDb;
  MemoryDatastore.prototype.countAll = countAll;

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
      LowlaDB.utils.keys(obj).forEach(function (key) {
        if (obj[key] instanceof Array) {
          copy[key] = obj[key].slice();
        }
        else if (typeof obj[key] === 'object') {
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

  function closeDb() {
    data = {};
  }

  function updateDocument(clientNs, lowlaID, doc, doneFn) {
    data[clientNs + '$' + lowlaID] = {
      clientNs: clientNs,
      lowlaId: lowlaID,
      document: doc
    };
    doneFn(doc);
  }

  function loadDocument(clientNs, lowlaID, docFn) {
    if (typeof(docFn) === 'object') {
      docFn = docFn.document || function () { };
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
    transact(
      function (tx) {
        tx.scan(docFn, doneFn);
      },
      function () { },
      function () { }
    );
  }

  function remove(clientNs, lowlaID, doneFn) {
    delete data[clientNs + '$' + lowlaID];
    doneFn();
  }

  function countAll(clientNs, doneFn) {
    var count = 0;
    LowlaDB.utils.keys(data).forEach(function (key) {
      if (data[key].clientNs === clientNs) {
        ++count;
      }
    });
    doneFn(count);
  }

  function transact(callback, doneCallback, errCallback) {
    errCallback = errCallback || function () { };

    var txWrapper = {
      errCb: errCallback,
      load: loadInTx,
      save: saveInTx,
      scan: scanInTx,
      remove: removeInTx
    };

    try {
      setTimeout(function () {
        doneCallback();
      }, 0);

      callback(txWrapper);
    }
    catch (e) {
      errCallback(e);
    }
    /////////////////

    function loadInTx(clientNs, lowlaID, loadCallback) {
      loadDocument(clientNs, lowlaID, function (doc) {
        if (loadCallback) {
          loadCallback(doc, txWrapper);
        }
      });
    }

    function saveInTx(clientNs, lowlaID, doc, saveCallback) {
      updateDocument(clientNs, lowlaID, doc, function (doc) {
        if (saveCallback) {
          saveCallback(doc, txWrapper);
        }
      });
    }

    function scanInTx(scanCallback, scanDoneCallback) {
      if (typeof(scanCallback) === 'object') {
        scanDoneCallback = scanCallback.done || function () {
        };
        scanCallback = scanCallback.document || function () {
        };
      }

      LowlaDB.utils.keys(data).forEach(function (key) {
        scanCallback(_copyObj(data[key]), txWrapper);
      });

      scanDoneCallback(txWrapper);
    }

    function removeInTx(clientNs, lowlaID, removeDoneCallback) {
      remove(clientNs, lowlaID, function () {
        if (removeDoneCallback) {
          removeDoneCallback(txWrapper);
        }
      });
    }
  }
})(LowlaDB);
