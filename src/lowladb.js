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
  return LowlaDB;
  ///////////////

  function LowlaDB(options) {
    if (!(this instanceof LowlaDB)) {
      return new LowlaDB(options);
    }

    var config = this.config = LowlaDB._defaultOptions;
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
    lowla._syncCoordinator = new LowlaDB.SyncCoordinator(lowla, serverUrl, options);
    if (options && -1 == options.pollFrequency) {
      return;
    }

    var pushPull = function() {
      lowla.emit('syncBegin');
      return lowla._syncCoordinator.pushChanges()
        .then(function() {
          return lowla._syncCoordinator.fetchChanges();
        })
        .then(function(arg) {
          lowla.emit('syncEnd');
          return arg;
        }, function(err) {
          lowla.emit('syncEnd');
          throw err;
        });
    };

    return pushPull().then(function () {
      if (options && 0 !== options.pollFrequency) {
        var pollFunc = function () {
          pushPull().then(function () {
              setTimeout(pollFunc, options.pollFrequency);
            });
        };

        setTimeout(pollFunc, options.pollFrequency);
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
        datastore.updateDocument("$metadata", newMeta, resolve, reject);
      });
    }
    else {
      return new Promise(function (resolve, reject) {
        datastore.loadDocument("$metadata", resolve, reject);
      });
    }
  }

  function _cursorsOff() {
    /* jshint validthis: true */
    this.liveCursors = {};
  }
}
)(typeof(exports) === 'object' ? exports : window);
