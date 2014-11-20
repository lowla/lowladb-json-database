/**
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
        promises.push(updateIfUnchanged(payload[i].id));
      }
      else {
        SyncCoordinator.validateSpecialTypes(payload[i+1]);
        promises.push(updateIfUnchanged(payload[i].id, payload[++i]));
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

    function updateIfUnchanged(lowlaId, doc) {
      return new Promise(function(resolve, reject) {
        datastore.transact(txFn, resolve, reject);

        function txFn(tx) {
          tx.load("$metadata", checkMeta);
        }

        function checkMeta(metaDoc, tx) {
          // Don't overwrite locally-modified documents with changes from server.  Let next
          //  sync figure out the conflict.
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

  SyncCoordinator._updateSequence = function(lowla, sequence) {
    return new Promise(function(resolve, reject) {
      lowla.datastore.loadDocument("$metadata", {
        document: function(doc) {
          if (!doc) {
            doc = {};
          }
          doc.sequence = sequence;
          lowla.datastore.updateDocument("$metadata", doc, function() {
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
      syncCoord.datastore.loadDocument("$metadata", {
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
        datastore.scanDocuments(function(lowlaId, doc) {
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

