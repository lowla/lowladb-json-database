/**
 * Created by michael on 10/10/14.
 */

var LowlaDB = (function(LowlaDB) {
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

  utils.metaData = function(newMeta) {
    if (newMeta) {
      return new Promise(function(resolve, reject) {
        LowlaDB.Datastore.updateDocument("$metadata", newMeta, resolve, reject);
      });
    }
    else {
      return new Promise(function (resolve, reject) {
        LowlaDB.Datastore.loadDocument("$metadata", resolve, reject);
      });
    }
  };

  utils.keys = function(obj) {
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

  LowlaDB.utils = utils;
  return LowlaDB;
})(LowlaDB || {});