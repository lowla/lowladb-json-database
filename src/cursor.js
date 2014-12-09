/**
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

    tx.scan(collectDocs, processDocs);

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

    return cursor.toArray().then(function(arr) {
      if (callback) {
        callback(null, arr.length);
      }
      return arr.length;
    }, function(err) {
      if (callback) {
        callback(err);
      }
      throw err;
    });
  }

})(LowlaDB);