/**
 * Created by michael on 9/22/14.
 */

(function(exports) {
  'use strict';

  // Public API
  exports.LowlaDB = LowlaDB;
  LowlaDB.registerDatastore = registerDatastore;

  LowlaDB.prototype.close = close;
  LowlaDB.prototype.collection = collection;
  LowlaDB.prototype.db = db;
  LowlaDB.prototype.emit = emit;
  LowlaDB.prototype.load = load;
  LowlaDB.prototype.on = on;
  LowlaDB.prototype.off = off;
  LowlaDB.prototype.sync = sync;

  // Private API
  LowlaDB._datastores = {};
  LowlaDB._defaultOptions = { datastore: 'IndexedDB' };
  LowlaDB.prototype._metadata = _metadata;
  LowlaDB.prototype._cursorsOff = _cursorsOff;
  LowlaDB.prototype._processLoadPayload = _processLoadPayload;
  LowlaDB.prototype._generateLowlaId = _generateLowlaId;
  
  return LowlaDB;
  ///////////////

  function LowlaDB(options) {
    if (!(this instanceof LowlaDB)) {
      return new LowlaDB(options);
    }

    var config = this.config = {};
    LowlaDB.utils.keys(LowlaDB._defaultOptions).forEach(function(key) {
      config[key] = LowlaDB._defaultOptions[key];
    });
    LowlaDB.utils.keys(options).forEach(function(key) {
      config[key] = options[key];
    });

    this.datastore = LowlaDB._datastores[config.datastore];
    if (!this.datastore) {
      throw Error('Invalid or unavailable datastore: ' + config.datastore);
    }

    this.events = {};
    this.liveCursors = {};
  }

  function registerDatastore(name, datastore) {
    LowlaDB._datastores[name] = datastore;
  }

  function db(dbName) {
    /* jshint validthis: true */
    return new LowlaDB.DB(this, dbName);
  }

  function collection(dbName, collectionName) {
    /* jshint validthis: true */
    return new LowlaDB.Collection(this, dbName, collectionName);
  }

  function sync(serverUrl, options) {
    /* jshint validthis: true */
    var lowla = this;
    options = options || {};
    lowla._syncCoordinator = new LowlaDB.SyncCoordinator(lowla, serverUrl, options);
    if (options && -1 === options.pollFrequency) {
      return;
    }

    var socketIo = (options.io || window.io) && (options.socket || options.socket === undefined);
    if (socketIo && !options.pollFrequency) {
      var theIo = (options.io || window.io);
      var pushPullFn = LowlaDB.utils.debounce(pushPull, 250);
      var socket = theIo.connect(serverUrl);
      socket.on('changes', function() {
        pushPullFn();
      });
      socket.on('reconnect', function() {
        pushPullFn();
      });
      lowla.on('_pending', function() {
        pushPullFn();
      });
    }

    function pushPull() {
      if (lowla._syncing) {
        lowla._pendingSync = true;
        return;
      }

      lowla._syncing = true;
      lowla.emit('syncBegin');
      return lowla._syncCoordinator.pushChanges()
        .then(function() {
          return lowla._syncCoordinator.fetchChanges();
        })
        .then(function(arg) {
          lowla._syncing = false;
          lowla.emit('syncEnd');
          if (lowla._pendingSync) {
            lowla._pendingSync = false;
            return pushPull();
          }
          return arg;
        }, function(err) {
          lowla._syncing = lowla._pendingSync = false;
          lowla.emit('syncEnd');
          throw err;
        });
    }

    return pushPull().then(function () {
      if (options.pollFrequency) {
        var pollFunc = function () {
          pushPull().then(function () {
              setTimeout(pollFunc, options.pollFrequency * 1000);
            });
        };

        setTimeout(pollFunc, options.pollFrequency * 1000);
      }
    }, function (err) {
      throw err;
    });
  }

  function on(eventName, callback) {
    /* jshint validthis: true */
    var lowlaEvents = this.events;
    if (lowlaEvents[eventName]) {
      lowlaEvents[eventName].push(callback);
    }
    else {
      lowlaEvents[eventName] = [ callback ];
    }
  }

  function off(eventName, callback) {
    /* jshint validthis: true */
    var lowlaEvents = this.events;
    if (!callback) {
      if (!eventName) {
        this.events = {};
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
  }

  function emit() {
    /* jshint validthis: true */
    var args = Array.prototype.slice.call(arguments);
    var eventName = args.shift();
    var lowlaEvents = this.events;
    if (lowlaEvents[eventName]) {
      lowlaEvents[eventName].forEach(function(listener) {
        listener.apply(listener, args);
      });
    }
  }

  function close() {
    /* jshint validthis: true */
    this.off();
    this._cursorsOff();
    this.datastore.close();
  }

  function load(urlOrObj, callback) {
    /* jshint validthis: true */
    var lowla = this;
    return Promise.resolve()
      .then(function() {
        if (typeof(urlOrObj) === 'string') {
          return LowlaDB.utils.getJSON(urlOrObj).then(function (payload) {
            return lowla._processLoadPayload(payload);
          });
        }
        else {
          return lowla._processLoadPayload(urlOrObj);
        }
      })
      .then(function(res) {
        if (callback) {
          callback(null, res);
        }
        return res;
      }, function(err) {
        if (callback) {
          callback(err);
        }
        throw err;
      });
  }

  function _processLoadPayload(payload, offset) {
    /* jshint validthis: true */
    var lowla = this;
    if (!offset) {
      offset = 0;
    }

    return LowlaDB.SyncCoordinator._processPullPayload(lowla, lowla.datastore, payload.documents[offset])
      .then(function() {
        ++offset;
        if (offset < payload.documents.length) {
          return lowla._processLoadPayload(payload, offset);
        }
      })
      .then(function() {
        return LowlaDB.SyncCoordinator._updateSequence(lowla, payload.sequence);
      });
  }

  function _metadata(newMeta) {
    /* jshint validthis: true */
    var datastore = this.datastore;
    if (newMeta) {
      return new Promise(function(resolve, reject) {
        datastore.updateDocument("", "$metadata", newMeta, resolve, reject);
      });
    }
    else {
      return new Promise(function (resolve, reject) {
        datastore.loadDocument("", "$metadata", resolve, reject);
      });
    }
  }

  function _cursorsOff() {
    /* jshint validthis: true */
    this.liveCursors = {};
  }
  
  function _generateLowlaId(coll, doc) {
    /* jshint validthis: true */
    if (this.config.lowlaId) {
      return this.config.lowlaId(coll, doc);
    }
    return coll.dbName + '.' + coll.collectionName + '$' + doc._id;    
  }
}
)(typeof(exports) === 'object' ? exports : window);
;(function(LowlaDB) {
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

  function _updateDocument(lowlaId, obj, flagEight, oldDocId) {
    /*jshint validthis:true */
    var coll = this;
    var savedDoc = null;
    return new Promise(function(resolve, reject) {
      coll.datastore.transact(oldDocId ? doRemoveThenUpdate : doUpdate, resolve, reject);

      function doRemoveThenUpdate(tx) {
        coll._removeDocumentInTx(tx, oldDocId, true, function() {
          doUpdate(tx);
        });
      }

      function doUpdate(tx) {
        coll._updateDocumentInTx(tx, lowlaId, obj, flagEight, function(doc) {
          savedDoc = doc;
        });
      }
    })
      .then(function() {
        return savedDoc;
      });
  }

  function _updateDocumentInTx(tx, lowlaId, obj, flagEight, savedCallback) {
    /*jshint validthis:true */
    savedCallback = savedCallback || function(){};
    var coll = this;
    obj._id = obj._id || generateId();
    lowlaId = lowlaId || coll.lowla._generateLowlaId(coll, obj);
    var clientNs = coll.dbName + '.' + coll.collectionName;

    coll.lowla.emit('_saveHook', obj, lowlaId);

    if (flagEight) {
      saveOnly(tx);
    }
    else {
      updateWithMeta(tx, clientNs, lowlaId, saveOnly, obj);
    }

    function saveOnly(metaDoc, tx) {
      if (tx === undefined) {
        tx = metaDoc;
      }
      tx.save(clientNs, lowlaId, obj, objSaved);
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
    
    /*jshint validthis:true */
    var clientNs = this.dbName + '.' + this.collectionName;
    
    if (flagEight) {
      removeOnly(tx);
    }
    else {
      updateWithMeta(tx, clientNs, lowlaID, removeOnly);
    }

    function removeOnly(metaDoc, tx) {
      if (tx === undefined) {
        tx = metaDoc;
      }
      tx.remove(clientNs, lowlaID, objRemoved);
    }

    function objRemoved() {
      removedCallback();
    }
  }

  function isSameObject(oldObj, newObj) {
    var oldKeys = LowlaDB.utils.keys(oldObj);
    var newKeys = LowlaDB.utils.keys(newObj);
    if (oldKeys.length != newKeys.length) {
      return false;
    }

    var answer = true;
    LowlaDB.utils.keys(oldObj).forEach(function(oldKey) {
      if (!answer) {
        return answer;
      }

      if (!newObj.hasOwnProperty(oldKey)) {
        answer = false;
        return answer;
      }

      if (oldObj[oldKey] instanceof Object) {
        if (!(newObj[oldKey] instanceof Object)) {
          answer = false;
          return answer;
        }

        answer = isSameObject(oldObj[oldKey], newObj[oldKey]);
      }
      else {
        answer = JSON.stringify(oldObj[oldKey]) === JSON.stringify(newObj[oldKey]);
      }
    });

    return answer;
  }
  function updateWithMeta(tx, clientNs, lowlaID, nextFn, newDoc) {
    tx.load("", "$metadata", checkMeta);

    function checkMeta(metaDoc, tx) {
      if (!metaDoc || !metaDoc.changes || !metaDoc.changes[lowlaID]) {
        tx.load(clientNs, lowlaID, updateMetaChanges);
      }
      else if (newDoc) {
        if (isSameObject(metaDoc.changes[lowlaID], newDoc)) {
          delete metaDoc.changes[lowlaID];
          tx.save("", "$metadata", metaDoc, nextFn);
        }
        else {
          nextFn(metaDoc, tx);
        }
      }
      else {
        nextFn(metaDoc, tx);
      }

      function updateMetaChanges(oldDoc, tx) {
        oldDoc = oldDoc || {};
        metaDoc = metaDoc || {changes: {}};
        metaDoc.changes = metaDoc.changes || {};
        metaDoc.changes[lowlaID] = oldDoc;
        tx.save("", "$metadata", metaDoc, nextFn);
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
        coll._updateDocumentInTx(tx, null, docs[curInsert], false, nextDoc);

        function nextDoc(saved) {
          savedDoc.push(saved);
          ++curInsert;
          if (curInsert < docs.length) {
            coll._updateDocumentInTx(tx, null, docs[curInsert], false, nextDoc);
          }
        }
      }
    })
      .then(function() {
        coll.lowla.emit('_pending');
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

        var obj = mutateObject(docArr[0].document, operations);
        coll._updateDocumentInTx(tx, docArr[0].lowlaId, obj, false, function(obj) {
          savedObj = obj;
        }, reject);
      }
    })
      .then(function() {
        coll.lowla.emit('_pending');
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
        return coll.find(filter)._applyFilter();
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
              coll.lowla.emit('_saveHook', null, doc.lowlaId);
              coll._removeDocumentInTx(tx, doc.lowlaId, false, function () {
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
        coll.lowla.emit('_pending');
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
})(LowlaDB);;/**
 * Created by michael on 10/15/14.
 */

(function(LowlaDB) {
  'use strict';

  // Public API
  LowlaDB.Cursor = Cursor;

  Cursor.prototype.count = count;
  Cursor.prototype.each = each;
  Cursor.prototype.limit = limit;
  Cursor.prototype.sort = sort;
  Cursor.prototype.showPending = showPending;
  Cursor.prototype.toArray = toArray;

  Cursor.prototype.on = on;
  Cursor.notifyLive = notifyLive;
  Cursor.prototype.cloneWithOptions = cloneWithOptions;

  // Private API
  Cursor.prototype._applyFilter = _applyFilter;
  Cursor.prototype._applyFilterInTx = _applyFilterInTx;

  return LowlaDB;
  ///////////////

  function Cursor(collection, filter, options) {
    if (!(this instanceof Cursor)) {
      return new Cursor(collection, filter, options);
    }

    this._lowla = collection.lowla;
    this._collection = collection;
    this._filter = filter;
    this._options = {
      sort: null,
      limit: 0,
      showPending: false
    };

    for (var i in options) {
      if (options.hasOwnProperty(i)) {
        this._options[i] = options[i];
      }
    }
  }

  function filterApplies(filter, doc) {
    for (var i in filter) {
      if (filter.hasOwnProperty(i)) {
        if (!doc.hasOwnProperty(i) || filter[i] !== doc[i]) {
          return false;
        }
      }
    }

    return true;
  }

  function docCompareFunc(sort, a, b) {
    a = a.document;
    b = b.document;
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
  }

  function _applyFilterInTx(tx, docsCallback) {
    /* jshint validthis:true */
    var data = [];
    var coll = this._collection;
    var clientNs = coll.dbName + '.' + coll.collectionName;
    var cursor = this;

    var options = {};
    if (cursor._filter && cursor._filter.hasOwnProperty('_id')) {
      options.clientNs = clientNs;
      options._id = cursor._filter._id;
    }
    tx.scan({
      document: collectDocs, 
      done: processDocs,
      options: options
    });

    function collectDocs(doc) {
      if (doc.clientNs === clientNs && filterApplies(cursor._filter, doc.document)) {
        data.push(doc);
      }
    }

    function processDocs() {
      data = data.map(LowlaDB.SyncCoordinator.convertSpecialTypes);
      if (cursor._options.sort) {
        sortData();
      }

      if (cursor._options.limit) {
        data = data.slice(0, cursor._options.limit);
      }

      if (data.length && cursor._options.showPending) {
        tx.load("", "$metadata", loadMetaForPending);
      }
      else {
        try {
          docsCallback(data, tx);
        }
        catch (err) {
          tx.errCb(err);
        }
      }
    }

    function loadMetaForPending(metaDoc, tx) {
      if (metaDoc && metaDoc.changes) {
        data.forEach(function(doc) {
          doc.document.$pending = metaDoc.changes.hasOwnProperty(doc.lowlaId);
        });
      }

      docsCallback(data, tx);
    }

    function sortData() {
      var sort = cursor._options.sort;
      data.sort(function(a,b) {
        if (typeof(sort) === 'string') {
          return docCompareFunc(sort, a, b);
        }
        else if (sort instanceof Array) {
          var answer = 0;

          sort.every(function(criterion) {
            var field, order;
            if (criterion instanceof Array) {
              field = criterion[0];
              order = criterion.length > 0 ? criterion[1] : 1;
            }
            else {
              field = criterion;
              order = 1;
            }

            answer = docCompareFunc(field, a, b);
            if (order < 0) {
              answer = -answer;
            }

            return answer === 0;
          });

          return answer;
        }
      });
    }
  }

  function _applyFilter() {
    /* jshint validthis:true */
    var cursor = this;
    var answer;
    return new Promise(function(resolve, reject) {
      cursor._collection.datastore.transact(applyFilter, resolve, reject);
      function applyFilter(tx) {
        cursor._applyFilterInTx(tx, function(docs) {
          answer = docs;
        });
      }
    })
      .then(function() {
        return answer;
      });
  }

  function notifyLive(coll) {
    var key = coll.dbName + '.' + coll.collectionName;
    if (!coll.lowla.liveCursors[key]) {
      return;
    }

    coll.lowla.liveCursors[key].forEach(function (watcher) {
      watcher.callback(null, watcher.cursor);
    });
  }

  function on(callback) {
    /* jshint validthis:true */
    var coll = this._collection;
    var key = coll.dbName + '.' + coll.collectionName;
    if (!coll.lowla.liveCursors[key]) {
      coll.lowla.liveCursors[key] = [];
    }

    coll.lowla.liveCursors[key].push({ cursor: this, callback: callback });
    callback(null, this);
  }

  function cloneWithOptions(options) {
    /* jshint validthis:true */
    var answer = new Cursor(this._collection, this._filter);
    answer._options = this._options;
    for (var i in options) {
      if (options.hasOwnProperty(i)) {
        answer._options[i] = options[i];
      }
    }

    return answer;
  }

  function limit(amount) {
    /* jshint validthis:true */
    return this.cloneWithOptions({ limit: amount });
  }

  function sort(keyOrList) {
    /* jshint validthis:true */
    return this.cloneWithOptions({ sort: keyOrList });
  }

  function showPending() {
    /* jshint validthis:true */
    return this.cloneWithOptions({ showPending: true });
  }

  function each(callback) {
    /* jshint validthis:true */
    if (!callback) {
      return;
    }

    try {
      this._applyFilter().then(function (arr) {
        arr.forEach(function (doc) {
          callback(null, doc.document);
        });
      });
    }
    catch (e) {
      callback(e);
    }
  }

  function toArray(callback) {
    /* jshint validthis:true */
    var cursor = this;
    return Promise.resolve()
      .then(function() {
        return cursor._applyFilter();
      })
      .then(function(filtered) {
        filtered = filtered.map(function(doc) {
          return doc.document;
        });
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
  }

  function count(applySkipLimit, callback) {
    /* jshint validthis:true */
    if (typeof(applySkipLimit) === 'function') {
      callback = applySkipLimit;
      applySkipLimit = false;
    }

    var cursor = this;
    if (!applySkipLimit) {
      cursor = this.cloneWithOptions({skip: 0, limit: 0});
    }

    if (cursor._filter) {
      return cursor.toArray().then(function(arr) {
        return success(arr.length);
      }, error);
    }
    else {
      return new Promise(function(resolve, reject) {
        var coll = cursor._collection;
        var clientNs = coll.dbName + '.' + coll.collectionName;
        cursor._collection.datastore.countAll(clientNs, resolve);
      })
      .then(success, error);
    }
    
    function success(count) {
      if (0 !== cursor._options.limit) {
        count = Math.min(count, cursor._options.limit);
      }
      if (callback) {
        callback(null, count);
      }
      return count;
    }
    function error(err) {
      if (callback) {
        callback(err);
      }
      throw err;
    }
  }

})(LowlaDB);;/**
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

          var store = db.createObjectStore("lowla");
          // Composite indexes are flaky on Safari so we just index on _id and let the caller
          // perform clientNs filtering.
          store.createIndex("_id", "document._id", { unique: false});
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
    this.transact(
      function(tx) {
        tx.scan(docFn, doneFn, errFn);
      },
      function() {},
      errFn
    );
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
        var options = {};
        if (typeof(scanCallback) === 'object') {
          scanDoneCallback = scanCallback.done || function () {};
          scanErrCallback = scanCallback.error;
          options = scanCallback.options || {};
          scanCallback = scanCallback.document || function () {};
        }
        scanErrCallback = scanErrCallback || errCallback;
        var store = tx.objectStore("lowla");
        
        var request;
        if (options._id) {
          var index = store.index("_id");
          var keyRange = IDBKeyRange.only(options._id);
          request = index.openCursor(keyRange);
        }
        else {
          request = store.openCursor();
        }

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
})(LowlaDB);;
(function(LowlaDB) {
  'use strict';

  // Public API
  LowlaDB.DB = DB;
  DB.prototype.collection = collection;
  DB.prototype.collectionNames = collectionNames;

  return LowlaDB;
  ///////////////

  function DB(lowla, dbName) {
    this.name = dbName;
    this.datastore = lowla.datastore;
  }

  function collection(collectionName) {
    /* jshint validthis: true */
    return new LowlaDB.Collection(this.name, collectionName);
  }

  function collectionNames() {
    /* jshint validthis: true */
    var datastore = this.datastore;

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
    return new Promise(fetchNames)
      .then(applyOptions)
      .then(okCallback, errCallback);
    /////////////////////////////////

    function fetchNames(resolve, reject) {
      datastore.scanDocuments({
        document: function(doc) {
          if (doc.clientNs.indexOf(dbPrefix) === 0) {
            data[doc.clientNs] = true;
          }

        },
        done: function() {
          return resolve(data);
        },
        error: reject
      });
    }

    function applyOptions(data) {
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
    }

    function okCallback(answer) {
      if (callback) {
        callback(null, answer);
      }
      return answer;
    }

    function errCallback(err) {
      if (callback) {
        callback(err);
      }
      throw err;
    }
  }

})(LowlaDB);;/**
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
    this.transact(
      function(tx) {
        tx.scan(docFn, doneFn);
      },
      function() {},
      function() {}
    );
  }

  function remove(clientNs, lowlaID, doneFn) {
    delete data[clientNs + "$" + lowlaID];
    doneFn();
  }
  
  function countAll(clientNs, doneFn) {
    var count = 0;
    LowlaDB.utils.keys(data).forEach(function(key) {
      if (data[key].clientNs === clientNs) {
        ++count;
      }
    });
    doneFn(count);
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
      if (typeof(scanCallback) === 'object') {
        scanDoneCallback = scanCallback.done || function () {
        };
        scanCallback = scanCallback.document || function () {
        };
      }

      LowlaDB.utils.keys(data).forEach(function(key) {
        scanCallback(_copyObj(data[key]), txWrapper);
      });

      scanDoneCallback(txWrapper);
    }

    function removeInTx(clientNs, lowlaID, removeDoneCallback) {
      remove(clientNs, lowlaID, function() {
        if (removeDoneCallback) {
          removeDoneCallback(txWrapper);
        }
      });
    }
  }
})(LowlaDB);;/**
 * Created by michael on 10/10/14.
 */

(function(LowlaDB) {
  var keys;

  var SyncCoordinator = function(lowla, baseUrl) {
    this.lowla = lowla;
    this.datastore = lowla.datastore;

    keys = LowlaDB.utils.keys;

    if (!baseUrl || !baseUrl.length) {
      throw Error('Invalid server URL for LowlaDB Sync');
    }
    if (baseUrl[baseUrl.length - 1] != '/') {
      baseUrl += '/';
    }

    this.urls = {
      changes: baseUrl + '_lowla/changes',
      pull: baseUrl + '_lowla/pull',
      push: baseUrl + '_lowla/push'
    };
  };

  SyncCoordinator.prototype.processPull = function(payload) {
    return SyncCoordinator._processPullPayload(this.lowla, this.datastore, payload);
  };

  SyncCoordinator._processPullPayload = function(lowla, datastore, payload) {
    var i = 0;
    var promises = [];
    var collections = {};
    var maxSeq = 0;

    while (i < payload.length) {
      collections[payload[i].clientNs] = true;
      maxSeq = Math.max(maxSeq, payload[i].sequence);

      if (payload[i].deleted) {
        promises.push(updateIfUnchanged(payload[i].clientNs, payload[i].id));
      }
      else {
        SyncCoordinator.validateSpecialTypes(payload[i+1]);
        promises.push(updateIfUnchanged(payload[i].clientNs, payload[i].id, payload[++i]));
      }
      i++;
    }

    return Promise.all(promises)
      .then(function() {
        LowlaDB.utils.keys(collections).forEach(function(collName) {
          var dbName = collName.substring(0, collName.indexOf('.'));
          collName = collName.substring(dbName.length + 1);
          LowlaDB.Cursor.notifyLive(lowla.collection(dbName, collName));
        });

        return maxSeq;
      });

    function updateIfUnchanged(clientNs, lowlaId, doc) {
      return new Promise(function(resolve, reject) {
        datastore.transact(txFn, resolve, reject);

        function txFn(tx) {
          tx.load("", "$metadata", checkMeta);
        }

        function checkMeta(metaDoc, tx) {
          // Don't overwrite locally-modified documents with changes from server.  Let next
          //  sync figure out the conflict.
          if (metaDoc && metaDoc.changes && metaDoc.changes.hasOwnProperty(lowlaId)) {
            resolve();
          }
          else {
            if (doc) {
              tx.save(clientNs, lowlaId, doc);
            }
            else {
              tx.remove(clientNs, lowlaId);
            }
          }
        }
      });
    }
  };

  SyncCoordinator._updateSequence = function(lowla, sequence) {
    return new Promise(function(resolve, reject) {
      lowla.datastore.loadDocument("", "$metadata", {
        document: function(doc) {
          if (!doc) {
            doc = {};
          }
          doc.sequence = sequence;
          lowla.datastore.updateDocument("", "$metadata", doc, function() {
            resolve(sequence);
          }, reject);
        }
      });
    });
  };

  SyncCoordinator.prototype.processChanges = function(payload) {
    var syncCoord = this;
    var lowla = this.lowla;
    var ids = [];
    var seqs = [];
    var updateSeq = true;
    payload.atoms.map(function(atom) {
      ids.push(atom.id);
      seqs.push(atom.sequence);
    });

    if (0 === ids.length) {
      return Promise.resolve();
    }

    function pullSomeDocuments(ids, offset) {
      var payloadIds = ids.slice(0, Math.min(10, ids.length));

      return Promise.resolve()
        .then(function() {
          return LowlaDB.utils.getJSON(syncCoord.urls.pull, { ids: payloadIds });
        })
        .then(function(pullPayload) {
          if (!pullPayload.length) {
            ids.splice(0, payloadIds.length);
            seqs.splice(0, payloadIds.length);
            updateSeq = false;
          }
          else {
            var i = 0;
            while (i < pullPayload.length) {
              var idx = ids.indexOf(pullPayload[i].id);
              if (-1 !== idx) {
                ids.splice(idx, 1);
                seqs.splice(idx, 1);
              }

              if (pullPayload[i].deleted) {
                i++;
              }
              else {
                i += 2;
              }
            }
          }

          return syncCoord.processPull(pullPayload);
        })
        .then(function() {
          if (updateSeq && seqs.length) {
            return SyncCoordinator._updateSequence(lowla, seqs[0]);
          }
        })
        .then(function() {
          if (ids.length) {
            return pullSomeDocuments(ids, offset);
          }
        });
    }

    lowla.emit('pullBegin');
    return Promise.resolve()
      .then(function() {
        return pullSomeDocuments(ids, 0);
      })
      .then(function() {
        if (updateSeq) {
          return SyncCoordinator._updateSequence(lowla, payload.sequence);
        }
      })
      .then(function(arg) {
        lowla.emit('pullEnd');
        return arg;
      }, function(err) {
        lowla.emit('pullEnd');
        throw err;
      });
  };

  SyncCoordinator.prototype.fetchChanges = function() {
    var syncCoord = this;
    return new Promise(function(resolve, reject) {
      syncCoord.datastore.loadDocument("", "$metadata", {
        document: resolve,
        error: reject
      });
    })
      .then(function(meta) {
        var sequence = (meta && meta.sequence) ? meta.sequence : 0;
        return LowlaDB.utils.getJSON(syncCoord.urls.changes + '?seq=' + sequence);
      })
      .then(function(payload) {
        return syncCoord.processChanges(payload);
      })
      .catch(function(err) {
        console.log('Unable to fetch changes: ' + err);
      });
  };

  SyncCoordinator.validateSpecialTypes = function(obj) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        var val = obj[key];
        if ('object' === typeof val) {
          if (val.hasOwnProperty('_bsonType')) {
            switch (val._bsonType) {
              case 'Binary':
              case 'Date':
                break;

              default:
                throw Error('Unexpected BSON type: ' + val._bsonType);
            }
          }
          else {
            SyncCoordinator.validateSpecialTypes(val);
          }
        }
      }
    }
  };

  SyncCoordinator.convertSpecialTypes = function (obj) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        var val = obj[key];
        if ('object' === typeof val) {
          if (val.hasOwnProperty('_bsonType')) {
            switch (val._bsonType) {
              case 'Binary':
                obj[key] = LowlaDB.utils.b64toBlob(val.encoded);
                obj[key]._lowlaType = val.type;
                break;

              case 'Date':
                obj[key] = new Date(parseInt(val.millis));
                break;

              default:
                throw Error('Unexpected BSON type: ' + val._bsonType);
            }
          }
          else {
            SyncCoordinator.convertSpecialTypes(val);
          }
        }
      }
    }

    return obj;
  };

  SyncCoordinator.prototype.collectPushData = function(alreadySeen) {
    var datastore = this.datastore;
    alreadySeen = alreadySeen || {};
    return this.lowla._metadata().then(function(metaDoc) {
      if (!metaDoc || !metaDoc.changes) {
        return null;
      }

      return new Promise(function (resolve, reject) {
        var docs = [];
        datastore.scanDocuments(function(doc) {
          var lowlaId = doc.lowlaId;
          doc = doc.document;
          
          if (docs.length >= 10 || alreadySeen.hasOwnProperty(lowlaId)) {
            return;
          }
          alreadySeen[lowlaId] = true;

          if (metaDoc.changes.hasOwnProperty(lowlaId)) {
            var oldDoc = metaDoc.changes[lowlaId];

            var setOps = {};
            var unsetOps = {};

            for (var key in doc) {
              if (!doc.hasOwnProperty(key) || key === "_id") {
                continue;
              }

              if (JSON.stringify(doc[key]) !== JSON.stringify(oldDoc[key])) {
                setOps[key] = doc[key];
              }
            }

            for (var oldKey in oldDoc) {
              if (!oldDoc.hasOwnProperty(oldKey) || key === "_id") {
                continue;
              }

              if (!doc.hasOwnProperty(oldKey)) {
                unsetOps[oldKey] = 1;
              }
            }

            var ops = null;
            if (0 !== keys(setOps).length) {
              ops = { $set: setOps };
            }
            if (0 !== keys(unsetOps).length) {
              (ops || (ops = {})).$unset = unsetOps;
            }

            if (ops) {
              docs.push({
                _lowla: {
                  id: lowlaId,
                  version: oldDoc._version
                },
                ops: ops
              });
            }
          }
        }, function() {
          if (docs.length >= 10) {
            resolve(docs);
            return;
          }

          LowlaDB.utils.keys(metaDoc.changes).forEach(function(lowlaID) {
            if (!alreadySeen.hasOwnProperty(lowlaID)) {
              docs.push({ _lowla: { id: lowlaID, version: metaDoc.changes[lowlaID]._version, deleted: true } });
            }
          });

          resolve(docs);
        }, reject);
      })
        .then(function(docs) {
          if (!docs || 0 === docs.length) {
            return null;
          }

          return { documents: docs };
        });
    });
  };

  SyncCoordinator.prototype.processPushResponse = function(payload, savedDuringPush) {
    var lowla = this.lowla;
    savedDuringPush = savedDuringPush || [];
    var makeUpdateHandler = function(docId) {
      return function() {
        return docId;
      };
    };

    var i = 0;
    var promises = [];
    while (i < payload.length) {
      // Any documents modified by the user while waiting for a Push response from the server should not be overwritten.
      if (-1 !== savedDuringPush.indexOf(payload[i].id)) {
        i += payload[i].deleted ? 1 : 2;
        continue;
      }
      var dot = payload[i].clientNs.indexOf('.');
      var dbName = payload[i].clientNs.substring(0, dot);
      var collName = payload[i].clientNs.substring(dot + 1);
      var collection = lowla.collection(dbName, collName);
      if (payload[i].deleted) {
        promises.push(collection._removeDocument(payload[i].id, true)
          .then(makeUpdateHandler(payload[i].id)));
      }
      else {
        var docId = payload[i].id;
        var oldDocId = payload[i].clientId;
        var responseDoc = payload[++i];
        SyncCoordinator.validateSpecialTypes(responseDoc);
        var promise = collection._updateDocument(docId, responseDoc, true, oldDocId)
          .then(makeUpdateHandler(oldDocId || docId));
        promises.push(promise);
      }

      i++;
    }

    return Promise.all(promises);
  };

  SyncCoordinator.prototype.clearPushData = function(ids) {
    var lowla = this.lowla;
    return lowla._metadata()
      .then(function(metaData) {
        if (!metaData || !metaData.changes) {
          return;
        }

        if (ids && ids.forEach) {
          ids.forEach(function(id) {
            delete metaData.changes[id];
          });
        }
        else if (ids && metaData.changes.hasOwnProperty(ids)) {
          delete metaData.changes[ids];
        }
        else if (!ids) {
          delete metaData.changes;
        }

        return lowla._metadata(metaData);
      });
  };

  SyncCoordinator.prototype.pushChanges = function() {
    var syncCoord = this;
    var lowla = this.lowla;
    var alreadySeen = {};
    var savedDuringPush = [];

    function processPushData(pushPayload) {
      if (!pushPayload) {
        return Promise.resolve();
      }

      return Promise.resolve()
        .then(function() {
          return LowlaDB.utils.getJSON(syncCoord.urls.push, pushPayload);
        })
        .then(function(response) {
          return syncCoord.processPushResponse(response, savedDuringPush);
        })
        .then(function(updatedIDs) {
          return syncCoord.clearPushData(updatedIDs);
        })
        .then(function() {
          return syncCoord.collectPushData(alreadySeen);
        })
        .then(processPushData);
    }

    function saveHook(obj, lowlaId) {
      savedDuringPush.push(lowlaId);
    }

    return this.collectPushData(alreadySeen)
      .then(function(payload) {
        if (!payload) {
          return;
        }

        lowla.on('_saveHook', saveHook);
        lowla.emit('pushBegin');
        return processPushData(payload)
          .then(function(arg) {
            lowla.off('_saveHook', saveHook);
            lowla.emit('pushEnd');
            return arg;
          }, function(err) {
            lowla.off('_saveHook', saveHook);
            lowla.emit('pushEnd');
            throw err;
          });

      })
      .catch(function(err) {
        console.log('Unable to push changes: ' + err);
      });
  };

  LowlaDB.SyncCoordinator = SyncCoordinator;

  return LowlaDB;
})(LowlaDB);

;/**
 * Created by michael on 10/10/14.
 */

(function(LowlaDB) {
  var utils = LowlaDB.utils || {};

  function createXHR() {
    var xhr;
    if (window.ActiveXObject) {
      try {
        xhr = new ActiveXObject("Microsoft.XMLHTTP");
      }
      catch (e) {
        alert(e.message);
        xhr = null;
      }
    }
    else {
      xhr = new XMLHttpRequest();
    }

    return xhr;
  }

  utils.getJSON = function (url, payload) {
    var xhr = createXHR();
    return new Promise(function (resolve, reject) {
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText));
          }
          else {
            reject(xhr.statusText);
          }
        }
      };

      if (payload) {
        var json = JSON.stringify(payload);
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-type', 'application/json');
        xhr.send(json);
      }
      else {
        xhr.open('GET', url, true);
        xhr.send();
      }
    });
  };

  utils.b64toBlob = function _b64toBlob(b64Data, contentType, sliceSize) {
    contentType = contentType || '';
    sliceSize = sliceSize || 512;

    var byteCharacters = atob(b64Data);
    var byteArrays = [];

    for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      var slice = byteCharacters.slice(offset, offset + sliceSize);

      var byteNumbers = new Array(slice.length);
      for (var i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      var byteArray = new Uint8Array(byteNumbers);

      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, {type: contentType});
  };

  utils.keys = function(obj) {
    if (!obj) {
      return [];
    }

    if (Object.keys) {
      return Object.keys(obj);
    }

    var answer = [];
    for (var i in obj) {
      if (obj.hasOwnProperty(i)) {
        answer.push(i);
      }
    }

    return answer;
  };

  utils.isArray = function(obj) {
    return (obj instanceof Array);
  };

  utils.debounce = function(func, wait, immediate) {
    var timeout;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(context, args);
    };
  };

  LowlaDB.utils = utils;
  return LowlaDB;
})(LowlaDB);;(function() {
var define, requireModule, require, requirejs;

(function() {
  var registry = {}, seen = {};

  define = function(name, deps, callback) {
    registry[name] = { deps: deps, callback: callback };
  };

  requirejs = require = requireModule = function(name) {
  requirejs._eak_seen = registry;

    if (seen[name]) { return seen[name]; }
    seen[name] = {};

    if (!registry[name]) {
      throw new Error("Could not find module " + name);
    }

    var mod = registry[name],
        deps = mod.deps,
        callback = mod.callback,
        reified = [],
        exports;

    for (var i=0, l=deps.length; i<l; i++) {
      if (deps[i] === 'exports') {
        reified.push(exports = {});
      } else {
        reified.push(requireModule(resolve(deps[i])));
      }
    }

    var value = callback.apply(this, reified);
    return seen[name] = exports || value;

    function resolve(child) {
      if (child.charAt(0) !== '.') { return child; }
      var parts = child.split("/");
      var parentBase = name.split("/").slice(0, -1);

      for (var i=0, l=parts.length; i<l; i++) {
        var part = parts[i];

        if (part === '..') { parentBase.pop(); }
        else if (part === '.') { continue; }
        else { parentBase.push(part); }
      }

      return parentBase.join("/");
    }
  };
})();

define("promise/all", 
  ["./utils","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    /* global toString */

    var isArray = __dependency1__.isArray;
    var isFunction = __dependency1__.isFunction;

    /**
      Returns a promise that is fulfilled when all the given promises have been
      fulfilled, or rejected if any of them become rejected. The return promise
      is fulfilled with an array that gives all the values in the order they were
      passed in the `promises` array argument.

      Example:

      ```javascript
      var promise1 = RSVP.resolve(1);
      var promise2 = RSVP.resolve(2);
      var promise3 = RSVP.resolve(3);
      var promises = [ promise1, promise2, promise3 ];

      RSVP.all(promises).then(function(array){
        // The array here would be [ 1, 2, 3 ];
      });
      ```

      If any of the `promises` given to `RSVP.all` are rejected, the first promise
      that is rejected will be given as an argument to the returned promises's
      rejection handler. For example:

      Example:

      ```javascript
      var promise1 = RSVP.resolve(1);
      var promise2 = RSVP.reject(new Error("2"));
      var promise3 = RSVP.reject(new Error("3"));
      var promises = [ promise1, promise2, promise3 ];

      RSVP.all(promises).then(function(array){
        // Code here never runs because there are rejected promises!
      }, function(error) {
        // error.message === "2"
      });
      ```

      @method all
      @for RSVP
      @param {Array} promises
      @param {String} label
      @return {Promise} promise that is fulfilled when all `promises` have been
      fulfilled, or rejected if any of them become rejected.
    */
    function all(promises) {
      /*jshint validthis:true */
      var Promise = this;

      if (!isArray(promises)) {
        throw new TypeError('You must pass an array to all.');
      }

      return new Promise(function(resolve, reject) {
        var results = [], remaining = promises.length,
        promise;

        if (remaining === 0) {
          resolve([]);
        }

        function resolver(index) {
          return function(value) {
            resolveAll(index, value);
          };
        }

        function resolveAll(index, value) {
          results[index] = value;
          if (--remaining === 0) {
            resolve(results);
          }
        }

        for (var i = 0; i < promises.length; i++) {
          promise = promises[i];

          if (promise && isFunction(promise.then)) {
            promise.then(resolver(i), reject);
          } else {
            resolveAll(i, promise);
          }
        }
      });
    }

    __exports__.all = all;
  });
define("promise/asap", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var browserGlobal = (typeof window !== 'undefined') ? window : {};
    var BrowserMutationObserver = browserGlobal.MutationObserver || browserGlobal.WebKitMutationObserver;
    var local = (typeof global !== 'undefined') ? global : (this === undefined? window:this);

    // node
    function useNextTick() {
      return function() {
        process.nextTick(flush);
      };
    }

    function useMutationObserver() {
      var iterations = 0;
      var observer = new BrowserMutationObserver(flush);
      var node = document.createTextNode('');
      observer.observe(node, { characterData: true });

      return function() {
        node.data = (iterations = ++iterations % 2);
      };
    }

    function useSetTimeout() {
      return function() {
        local.setTimeout(flush, 1);
      };
    }

    var queue = [];
    function flush() {
      for (var i = 0; i < queue.length; i++) {
        var tuple = queue[i];
        var callback = tuple[0], arg = tuple[1];
        callback(arg);
      }
      queue = [];
    }

    var scheduleFlush;

    // Decide what async method to use to triggering processing of queued callbacks:
    if (typeof process !== 'undefined' && {}.toString.call(process) === '[object process]') {
      scheduleFlush = useNextTick();
    } else if (BrowserMutationObserver) {
      scheduleFlush = useMutationObserver();
    } else {
      scheduleFlush = useSetTimeout();
    }

    function asap(callback, arg) {
      var length = queue.push([callback, arg]);
      if (length === 1) {
        // If length is 1, that means that we need to schedule an async flush.
        // If additional callbacks are queued before the queue is flushed, they
        // will be processed by this flush that we are scheduling.
        scheduleFlush();
      }
    }

    __exports__.asap = asap;
  });
define("promise/config", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var config = {
      instrument: false
    };

    function configure(name, value) {
      if (arguments.length === 2) {
        config[name] = value;
      } else {
        return config[name];
      }
    }

    __exports__.config = config;
    __exports__.configure = configure;
  });
define("promise/polyfill", 
  ["./promise","./utils","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    /*global self*/
    var RSVPPromise = __dependency1__.Promise;
    var isFunction = __dependency2__.isFunction;

    function polyfill() {
      var local;

      if (typeof global !== 'undefined') {
        local = global;
      } else if (typeof window !== 'undefined' && window.document) {
        local = window;
      } else {
        local = self;
      }

      var es6PromiseSupport = 
        "Promise" in local &&
        // Some of these methods are missing from
        // Firefox/Chrome experimental implementations
        "resolve" in local.Promise &&
        "reject" in local.Promise &&
        "all" in local.Promise &&
        "race" in local.Promise &&
        // Older version of the spec had a resolver object
        // as the arg rather than a function
        (function() {
          var resolve;
          new local.Promise(function(r) { resolve = r; });
          return isFunction(resolve);
        }());

      if (!es6PromiseSupport) {
        local.Promise = RSVPPromise;
      }
    }

    __exports__.polyfill = polyfill;
  });
define("promise/promise", 
  ["./config","./utils","./all","./race","./resolve","./reject","./asap","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __dependency6__, __dependency7__, __exports__) {
    "use strict";
    var config = __dependency1__.config;
    var configure = __dependency1__.configure;
    var objectOrFunction = __dependency2__.objectOrFunction;
    var isFunction = __dependency2__.isFunction;
    var now = __dependency2__.now;
    var all = __dependency3__.all;
    var race = __dependency4__.race;
    var staticResolve = __dependency5__.resolve;
    var staticReject = __dependency6__.reject;
    var asap = __dependency7__.asap;

    var counter = 0;

    config.async = asap; // default async is asap;

    function Promise(resolver) {
      if (!isFunction(resolver)) {
        throw new TypeError('You must pass a resolver function as the first argument to the promise constructor');
      }

      if (!(this instanceof Promise)) {
        throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");
      }

      this._subscribers = [];

      invokeResolver(resolver, this);
    }

    function invokeResolver(resolver, promise) {
      function resolvePromise(value) {
        resolve(promise, value);
      }

      function rejectPromise(reason) {
        reject(promise, reason);
      }

      try {
        resolver(resolvePromise, rejectPromise);
      } catch(e) {
        rejectPromise(e);
      }
    }

    function invokeCallback(settled, promise, callback, detail) {
      var hasCallback = isFunction(callback),
          value, error, succeeded, failed;

      if (hasCallback) {
        try {
          value = callback(detail);
          succeeded = true;
        } catch(e) {
          failed = true;
          error = e;
        }
      } else {
        value = detail;
        succeeded = true;
      }

      if (handleThenable(promise, value)) {
        return;
      } else if (hasCallback && succeeded) {
        resolve(promise, value);
      } else if (failed) {
        reject(promise, error);
      } else if (settled === FULFILLED) {
        resolve(promise, value);
      } else if (settled === REJECTED) {
        reject(promise, value);
      }
    }

    var PENDING   = void 0;
    var SEALED    = 0;
    var FULFILLED = 1;
    var REJECTED  = 2;

    function subscribe(parent, child, onFulfillment, onRejection) {
      var subscribers = parent._subscribers;
      var length = subscribers.length;

      subscribers[length] = child;
      subscribers[length + FULFILLED] = onFulfillment;
      subscribers[length + REJECTED]  = onRejection;
    }

    function publish(promise, settled) {
      var child, callback, subscribers = promise._subscribers, detail = promise._detail;

      for (var i = 0; i < subscribers.length; i += 3) {
        child = subscribers[i];
        callback = subscribers[i + settled];

        invokeCallback(settled, child, callback, detail);
      }

      promise._subscribers = null;
    }

    Promise.prototype = {
      constructor: Promise,

      _state: undefined,
      _detail: undefined,
      _subscribers: undefined,

      then: function(onFulfillment, onRejection) {
        var promise = this;

        var thenPromise = new this.constructor(function() {});

        if (this._state) {
          var callbacks = arguments;
          config.async(function invokePromiseCallback() {
            invokeCallback(promise._state, thenPromise, callbacks[promise._state - 1], promise._detail);
          });
        } else {
          subscribe(this, thenPromise, onFulfillment, onRejection);
        }

        return thenPromise;
      },

      'catch': function(onRejection) {
        return this.then(null, onRejection);
      }
    };

    Promise.all = all;
    Promise.race = race;
    Promise.resolve = staticResolve;
    Promise.reject = staticReject;

    function handleThenable(promise, value) {
      var then = null,
      resolved;

      try {
        if (promise === value) {
          throw new TypeError("A promises callback cannot return that same promise.");
        }

        if (objectOrFunction(value)) {
          then = value.then;

          if (isFunction(then)) {
            then.call(value, function(val) {
              if (resolved) { return true; }
              resolved = true;

              if (value !== val) {
                resolve(promise, val);
              } else {
                fulfill(promise, val);
              }
            }, function(val) {
              if (resolved) { return true; }
              resolved = true;

              reject(promise, val);
            });

            return true;
          }
        }
      } catch (error) {
        if (resolved) { return true; }
        reject(promise, error);
        return true;
      }

      return false;
    }

    function resolve(promise, value) {
      if (promise === value) {
        fulfill(promise, value);
      } else if (!handleThenable(promise, value)) {
        fulfill(promise, value);
      }
    }

    function fulfill(promise, value) {
      if (promise._state !== PENDING) { return; }
      promise._state = SEALED;
      promise._detail = value;

      config.async(publishFulfillment, promise);
    }

    function reject(promise, reason) {
      if (promise._state !== PENDING) { return; }
      promise._state = SEALED;
      promise._detail = reason;

      config.async(publishRejection, promise);
    }

    function publishFulfillment(promise) {
      publish(promise, promise._state = FULFILLED);
    }

    function publishRejection(promise) {
      publish(promise, promise._state = REJECTED);
    }

    __exports__.Promise = Promise;
  });
define("promise/race", 
  ["./utils","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    /* global toString */
    var isArray = __dependency1__.isArray;

    /**
      `RSVP.race` allows you to watch a series of promises and act as soon as the
      first promise given to the `promises` argument fulfills or rejects.

      Example:

      ```javascript
      var promise1 = new RSVP.Promise(function(resolve, reject){
        setTimeout(function(){
          resolve("promise 1");
        }, 200);
      });

      var promise2 = new RSVP.Promise(function(resolve, reject){
        setTimeout(function(){
          resolve("promise 2");
        }, 100);
      });

      RSVP.race([promise1, promise2]).then(function(result){
        // result === "promise 2" because it was resolved before promise1
        // was resolved.
      });
      ```

      `RSVP.race` is deterministic in that only the state of the first completed
      promise matters. For example, even if other promises given to the `promises`
      array argument are resolved, but the first completed promise has become
      rejected before the other promises became fulfilled, the returned promise
      will become rejected:

      ```javascript
      var promise1 = new RSVP.Promise(function(resolve, reject){
        setTimeout(function(){
          resolve("promise 1");
        }, 200);
      });

      var promise2 = new RSVP.Promise(function(resolve, reject){
        setTimeout(function(){
          reject(new Error("promise 2"));
        }, 100);
      });

      RSVP.race([promise1, promise2]).then(function(result){
        // Code here never runs because there are rejected promises!
      }, function(reason){
        // reason.message === "promise2" because promise 2 became rejected before
        // promise 1 became fulfilled
      });
      ```

      @method race
      @for RSVP
      @param {Array} promises array of promises to observe
      @param {String} label optional string for describing the promise returned.
      Useful for tooling.
      @return {Promise} a promise that becomes fulfilled with the value the first
      completed promises is resolved with if the first completed promise was
      fulfilled, or rejected with the reason that the first completed promise
      was rejected with.
    */
    function race(promises) {
      /*jshint validthis:true */
      var Promise = this;

      if (!isArray(promises)) {
        throw new TypeError('You must pass an array to race.');
      }
      return new Promise(function(resolve, reject) {
        var results = [], promise;

        for (var i = 0; i < promises.length; i++) {
          promise = promises[i];

          if (promise && typeof promise.then === 'function') {
            promise.then(resolve, reject);
          } else {
            resolve(promise);
          }
        }
      });
    }

    __exports__.race = race;
  });
define("promise/reject", 
  ["exports"],
  function(__exports__) {
    "use strict";
    /**
      `RSVP.reject` returns a promise that will become rejected with the passed
      `reason`. `RSVP.reject` is essentially shorthand for the following:

      ```javascript
      var promise = new RSVP.Promise(function(resolve, reject){
        reject(new Error('WHOOPS'));
      });

      promise.then(function(value){
        // Code here doesn't run because the promise is rejected!
      }, function(reason){
        // reason.message === 'WHOOPS'
      });
      ```

      Instead of writing the above, your code now simply becomes the following:

      ```javascript
      var promise = RSVP.reject(new Error('WHOOPS'));

      promise.then(function(value){
        // Code here doesn't run because the promise is rejected!
      }, function(reason){
        // reason.message === 'WHOOPS'
      });
      ```

      @method reject
      @for RSVP
      @param {Any} reason value that the returned promise will be rejected with.
      @param {String} label optional string for identifying the returned promise.
      Useful for tooling.
      @return {Promise} a promise that will become rejected with the given
      `reason`.
    */
    function reject(reason) {
      /*jshint validthis:true */
      var Promise = this;

      return new Promise(function (resolve, reject) {
        reject(reason);
      });
    }

    __exports__.reject = reject;
  });
define("promise/resolve", 
  ["exports"],
  function(__exports__) {
    "use strict";
    function resolve(value) {
      /*jshint validthis:true */
      if (value && typeof value === 'object' && value.constructor === this) {
        return value;
      }

      var Promise = this;

      return new Promise(function(resolve) {
        resolve(value);
      });
    }

    __exports__.resolve = resolve;
  });
define("promise/utils", 
  ["exports"],
  function(__exports__) {
    "use strict";
    function objectOrFunction(x) {
      return isFunction(x) || (typeof x === "object" && x !== null);
    }

    function isFunction(x) {
      return typeof x === "function";
    }

    function isArray(x) {
      return Object.prototype.toString.call(x) === "[object Array]";
    }

    // Date.now is not available in browsers < IE9
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/now#Compatibility
    var now = Date.now || function() { return new Date().getTime(); };


    __exports__.objectOrFunction = objectOrFunction;
    __exports__.isFunction = isFunction;
    __exports__.isArray = isArray;
    __exports__.now = now;
  });
requireModule('promise/polyfill').polyfill();
}());