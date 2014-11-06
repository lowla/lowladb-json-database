/**
 * Created by michael on 10/15/14.
 */

var LowlaDB = (function(LowlaDB) {

  var Cursor = function(collection, filter, options) {
    if (!(this instanceof Cursor)) {
      return new Cursor(collection, filter, options);
    }

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

  Cursor.prototype._applyFilterInTx = function(tx, docsCallback) {
    var data = [];
    var coll = this._collection;
    var clientIdPrefix = coll.dbName + '.' + coll.collectionName + '$';
    var cursor = this;

    tx.scan(collectDocs, processDocs);

    function collectDocs(clientId, doc) {
      if (clientId.indexOf(clientIdPrefix) === 0 && filterApplies(cursor._filter, doc)) {
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
        tx.load("$metadata", loadMetaForPending);
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
          doc.$pending = metaDoc.changes.hasOwnProperty(clientIdPrefix + doc._id);
        });
      }

      docsCallback(data, tx);
    }

    function sortData() {
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
    }
  };

  Cursor.prototype._applyFilter = function() {
    var cursor = this;
    var answer;
    return new Promise(function(resolve, reject) {
      LowlaDB.Datastore.transact(applyFilter, resolve, reject);
      function applyFilter(tx) {
        cursor._applyFilterInTx(tx, function(docs) {
          answer = docs;
        });
      }
    })
      .then(function() {
        return answer;
      });
  };

  var liveCursors = {};
  Cursor.notifyLive = function (coll) {
    var key = coll.dbName + '.' + coll.collectionName;
    if (!liveCursors[key]) {
      return;
    }

    liveCursors[key].forEach(function (watcher) {
      watcher.callback(null, watcher.cursor);
    });
  };

  Cursor.off = function() {
    liveCursors = {};
  };

  Cursor.prototype.on = function (callback) {
    var coll = this._collection;
    var key = coll.dbName + '.' + coll.collectionName;
    if (!liveCursors[key]) {
      liveCursors[key] = [];
    }

    liveCursors[key].push({ cursor: this, callback: callback });
    callback(null, this);
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

  Cursor.prototype.showPending = function() {
    return this.cloneWithOptions({ showPending: true });
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

  Cursor.prototype.count = function(applySkipLimit, callback) {
    return this.toArray().then(function(arr) {
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
  };

  LowlaDB.Cursor = Cursor;
  return LowlaDB;

})(LowlaDB || {});