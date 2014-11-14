/**
 * Created by michael on 10/10/14.
 */

var LowlaDB = (function(LowlaDB) {
  var keys;

  var SyncCoordinator = function(baseUrl) {
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
    var i = 0;
    var promises = [];
    while (i < payload.length) {
      var dot = payload[i].clientNs.indexOf('.');
      var dbName = payload[i].clientNs.substring(0, dot);
      var collName = payload[i].clientNs.substring(dot + 1);
      var collection = LowlaDB.collection(dbName, collName);
      if (payload[i].deleted) {
        dot = payload[i].id.indexOf('$');
        promises.push(updateIfUnchanged(payload[i].id));
      }
      else {
        SyncCoordinator.validateSpecialTypes(payload[i+1]);
        promises.push(updateIfUnchanged(payload[i].id, payload[++i]));
      }
      i++;
    }

    return Promise.all(promises);

    function updateIfUnchanged(lowlaId, doc) {
      return new Promise(function(resolve, reject) {
        LowlaDB.Datastore.transact(txFn, resolve, reject);

        function txFn(tx) {
          tx.load("$metadata", checkMeta);
        }

        function checkMeta(metaDoc, tx) {
          if (metaDoc && metaDoc.changes && metaDoc.changes.hasOwnProperty(lowlaId)) {
            resolve();
          }
          else {
            if (doc) {
              tx.save(lowlaId, doc);
            }
            else {
              tx.remove(lowlaId);
            }
          }
        }
      });
    }
  };

  SyncCoordinator.prototype.processChanges = function(payload) {
    var syncCoord = this;
    var ids = [];
    payload.atoms.map(function(atom) { ids.push(atom.id); });
    if (0 === ids.length) {
      return Promise.resolve();
    }

    LowlaDB.emit('pullBegin');
    return Promise.resolve()
      .then(function() {
        return LowlaDB.utils.getJSON(syncCoord.urls.pull, { ids: ids });
      })
      .then(function(pullPayload) {
        return syncCoord.processPull(pullPayload);
      })
      .then(function() {
        return new Promise(function(resolve, reject) {
          LowlaDB.Datastore.loadDocument("$metadata", {
            document: function(doc) {
              if (!doc) {
                doc = {};
              }
              doc.sequence = payload.sequence;
              LowlaDB.Datastore.updateDocument("$metadata", doc, function() {
                resolve(payload.sequence);
              }, reject);
            }
          });
        });
      })
      .then(function(arg) {
        LowlaDB.emit('pullEnd');
        return arg;
      }, function(err) {
        LowlaDB.emit('pullEnd');
        throw err;
      });
  };

  SyncCoordinator.prototype.fetchChanges = function() {
    var syncCoord = this;
    return new Promise(function(resolve, reject) {
      LowlaDB.Datastore.loadDocument("$metadata", {
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
    alreadySeen = alreadySeen || {};
    return LowlaDB.utils.metaData().then(function(metaDoc) {
      if (!metaDoc || !metaDoc.changes) {
        return null;
      }

      return new Promise(function (resolve, reject) {
        var docs = [];
        LowlaDB.Datastore.scanDocuments(function(lowlaId, doc) {
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

  SyncCoordinator.prototype.processPushResponse = function(payload) {
    var makeUpdateHandler = function(docId) {
      return function() {
        return docId;
      };
    };

    var i = 0;
    var promises = [];
    while (i < payload.length) {
      var dot = payload[i].clientNs.indexOf('.');
      var dbName = payload[i].clientNs.substring(0, dot);
      var collName = payload[i].clientNs.substring(dot + 1);
      var collection = LowlaDB.collection(dbName, collName);
      if (payload[i].deleted) {
        promises.push(collection._removeDocument(payload[i].id, true)
          .then(makeUpdateHandler(payload[i].id)));
      }
      else {
        var docId = payload[i].id;
        var responseDoc = payload[++i];
        SyncCoordinator.validateSpecialTypes(responseDoc);
        var promise = collection._updateDocument(responseDoc, true)
          .then(makeUpdateHandler(docId));
        promises.push(promise);
      }

      i++;
    }

    return Promise.all(promises);
  };

  SyncCoordinator.prototype.clearPushData = function(ids) {
    return LowlaDB.utils.metaData()
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

        return LowlaDB.utils.metaData(metaData);
      });
  };

  SyncCoordinator.prototype.pushChanges = function() {
    var syncCoord = this;
    var alreadySeen = {};

    function processPushData(pushPayload) {
      if (!pushPayload) {
        return Promise.resolve();
      }

      return Promise.resolve()
        .then(function() {
          return LowlaDB.utils.getJSON(syncCoord.urls.push, pushPayload);
        })
        .then(function(response) {
          return syncCoord.processPushResponse(response);
        })
        .then(function(updatedIDs) {
          return syncCoord.clearPushData(updatedIDs);
        })
        .then(function() {
          return syncCoord.collectPushData(alreadySeen);
        })
        .then(processPushData);
    }

    return this.collectPushData(alreadySeen)
      .then(function(payload) {
        if (!payload) {
          return;
        }

        LowlaDB.emit('pushBegin');
        return processPushData(payload)
          .then(function(arg) {
            LowlaDB.emit('pushEnd');
            return arg;
          }, function(err) {
            LowlaDB.emit('pushEnd');
            throw err;
          });

      })
      .catch(function(err) {
        console.log('Unable to push changes: ' + err);
      });
  };

  LowlaDB.SyncCoordinator = SyncCoordinator;

  return LowlaDB;
})(LowlaDB || {});

