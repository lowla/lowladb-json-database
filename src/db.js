
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

})(LowlaDB);