/**
 * Created by michael on 10/10/14.
 */

(function (LowlaDB) {
  'use strict';

  var utils = LowlaDB.utils || {};

  function createXHR() {
    /* global ActiveXObject */
    /* global alert */
    var xhr;
    if (window.ActiveXObject) {
      try {
        xhr = new ActiveXObject('Microsoft.XMLHTTP');
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

  utils.keys = function (obj) {
    if (!obj) {
      return [];
    }

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

  utils.isArray = function (obj) {
    return (obj instanceof Array);
  };

  utils.debounce = function (func, wait, immediate) {
    var timeout;
    return function () {
      var context = this;
      var args = arguments;
      var later = function () {
        timeout = null;
        if (!immediate) {
          func.apply(context, args);
        }
      };

      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) {
        func.apply(context, args);
      }
    };
  };

  LowlaDB.utils = utils;
  return LowlaDB;
})(LowlaDB);
