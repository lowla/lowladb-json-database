/**
 * Created by michael on 9/22/14.
 */

var LowlaDB = (function(LowlaDB) {
  'use strict';

  LowlaDB.datastores = LowlaDB.datastores || {};

  LowlaDB.registerDatastore = function(name, datastore) {
    LowlaDB.datastores[name] = datastore;
  };

  LowlaDB.setDatastore = function(name) {
    if (LowlaDB.datastores[name]) {
      LowlaDB.Datastore = LowlaDB.datastores[name];
    }
    else {
      throw Error('Unknown datastore: ' + name);
    }
  };

  LowlaDB.db = function (dbName) {
    return new LowlaDB.DB(dbName);
  };

  LowlaDB.collection = function(dbName, collectionName) {
    return new LowlaDB.Collection(dbName, collectionName);
  };

  LowlaDB.sync = function(serverUrl, options) {
    LowlaDB._syncCoordinator = new LowlaDB.SyncCoordinator(serverUrl, options);
    if (options && -1 == options.pollFrequency) {
      return;
    }

    var pushPull = function() {
      LowlaDB.emit('syncBegin');
      return LowlaDB._syncCoordinator.pushChanges()
        .then(function() {
          return LowlaDB._syncCoordinator.fetchChanges();
        })
        .then(function(arg) {
          LowlaDB.emit('syncEnd');
          return arg;
        }, function(err) {
          LowlaDB.emit('syncEnd');
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
  };

  var lowlaEvents = {};
  LowlaDB.on = function(eventName, callback) {
    if (lowlaEvents[eventName]) {
      lowlaEvents[eventName].push(callback);
    }
    else {
      lowlaEvents[eventName] = [ callback ];
    }
  };

  LowlaDB.off = function(eventName, callback) {
    if (!callback) {
      if (!eventName) {
        lowlaEvents = {};
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
  };

  LowlaDB.emit = function(eventName) {
    if (lowlaEvents[eventName]) {
      lowlaEvents[eventName].forEach(function(listener) {
        listener.apply(this);
      });
    }
  };

  LowlaDB.close = function() {
    LowlaDB.Cursor.off();
    LowlaDB.off();
    LowlaDB.Datastore.close();
  };

  return LowlaDB;
}
)(LowlaDB || {});
