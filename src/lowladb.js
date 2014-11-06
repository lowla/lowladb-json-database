/**
 * Created by michael on 9/22/14.
 */

var LowlaDB = (function(LowlaDB) {
  'use strict';

  var DB = function (dbName) {
    this.name = dbName;
  };

  DB.prototype.collection = function (collectionName) {
    return new LowlaDB.Collection(this.name, collectionName);
  };

  DB.prototype.collectionNames = function () {
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
    return new Promise(function(resolve, reject) {
      LowlaDB.Datastore.scanDocuments({
        document: function(clientId) {
          if (clientId.indexOf(dbPrefix) === 0) {
            var dollar = clientId.indexOf('$');
            var fullName = clientId.substring(0, dollar);
            data[fullName] = true;
          }

        },
        done: function() {
          return resolve(data);
        },
        error: reject
      });
    })
      .then(function(data) {
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
      })
      .then(function(answer) {
        if (callback) {
          callback(null, answer);
        }
        return answer;
      }, function(err) {
        if (callback) {
          callback(err);
        }
        throw err;
      });
  };

  LowlaDB.db = function (dbName) {
    return new DB(dbName);
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
