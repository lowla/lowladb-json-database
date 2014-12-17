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
