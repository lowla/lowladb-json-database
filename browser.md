---
layout: page
navid: navdb
title: LowlaDB Browser API
summary: A pure Javascript database that stores data offline and syncs

---

<div id="Intro">
## Introduction ##

LowlaDB is a database for mobile applications. It syncs data from a wide variety of backends down to the device so that applications can always use data that is stored locally. That makes applications *fast* because data is always close by and *reliable* because they never have to worry about signal strength or the availability of WiFi.

The initial release of LowlaDB is a pure javascript implementation that runs on either IndexedDB or in memory. It works well for small numbers of records and provides a rapid development cycle. If your application needs to scale to larger databases, a later release of LowlaDB will add a specialized datastore implementaton designed to run in Cordova. Web applications built with LowlaDB will run in Cordova with no code changes required and will automatically detect and use the improved datastore. The Cordova implementation will also add features not possible in the browser such as overnight syncing.

The developer API for LowlaDB is based closely on MongoDB. An overview of the API follows, but for more details on the direction in which we intend to take the API, see the documentation for the Node.js MongoDB driver [here](http://mongodb.github.io/node-mongodb-native/index.html). In addition to the basic API, LowlaDB adds extensions to support real-time data updates and wherever possible offers promise-based APIs as an alternative to callbacks.

</div>
<div id="License">
## License ##
LowlaDB is available under the MIT license.

</div>
<div id="Install">
## Installation ##
LowlaDB is available via Bower. To install it, modify your dependencies in `bower.json` to include `lowladb`.

{% highlight json %}
{
  "name": "todomvc-jquery",
  "dependencies": {
    "todomvc-common": "~0.1.9",
    "jquery": "~2.1.0",
    "handlebars": "~1.3.0",
    "director": "~1.2.2",
    
    "lowladb": "~0.0.3"
  }
}
{% endhighlight %}

Once you have run `bower install` to download lowladb, add a `script` tag to your page

{% highlight html %}
<script src="bower_components/lowladb/dist/lowladb.js"></script>
{% endhighlight %}

</div>
<div id="API">
  
## API ##

<div id="LowlaDB">
### Obtaining an instance of LowlaDB ###

All operations in LowlaDB are made through an instance of the class `LowlaDB`:

{% highlight javascript %}
var lowla = new LowlaDB();
{% endhighlight %}

The constructor accepts a configuration object.  Currently, the following configuration is available:

`datastore` - the underlying storage engine.  Valid options are `IndexedDB` and `Memory`.  The default is `IndexedDB`.

For example:

{% highlight javascript %}
var lowla = new LowlaDB({ datastore: 'Memory' });
{% endhighlight %}

</div>
<div id="Collection">
    
### Opening a Collection ###
Objects in LowlaDB are stored in collections. A database contains one or more collections. Databases and collections are created automatically the first time they are referenced.  
To open a collection, you call the `collection` method on the `LowlaDB` instance.

{% highlight javascript %}
var todos = lowla.collection('mydb', 'todos');
{% endhighlight %}

</div>
<div id="Insert">
    
### Inserting Objects ###
LowlaDB stores regular Javascript objects. To add an object to a collection, you call the `insert` method.

{% highlight javascript %}
var todos = lowla.collection('mydb', 'todos');
var todo = {
	title: "Action to do",
	completed: false
};

todos.insert(todo);
{% endhighlight %}

The actual insert may be asynchronous. If you need to verify that the object was saved without error or perform another action once the save is complete, you can either provide a callback

{% highlight javascript %}
todos.insert(todo, function(err, doc){});
{% endhighlight %}

or use a promise

{% highlight javascript %}
todos.insert(todo).then(function(doc){}, function(err){});
{% endhighlight %}

All objects must have a unique identifier property, named `_id`. LowlaDB will create one for you if you try to insert an object without one.

You may also pass an array of objects to insert.  The result will be an array of the inserted documents:

{% highlight javascript %}
var newTodos = [ { title: "Action One" }, { title: "Action Two" } ];
todos.insert(newTodos).then(function(arrDocs){});
{% endhighlight %}

</div>
<div id="Retrieve">
    
### Retrieving Objects ###
You retrieve objects using the `find` method. This takes a query object that acts as a selector for the objects to be returned. The `find` method returns a `Cursor` object that you can iterate or convert to an array.

{% highlight javascript %}
var todos = lowla.collection('mydb', 'todos');

// Find with no query object returns all records in the collection
todos.find().each(function(err, doc) { });
todos.find().toArray(function(err, docs) { });

// Or, using a promise
todos.find().toArray().then(function(docs) { }, function(err));
{% endhighlight %}

LowlaDB also supports real-time updating where it will monitor the collection for changes and automatically notify you when the query results may have changed.
	
{% highlight javascript %}
todos.find().on(function(err, cursor) {
	cursor.toArray(function(err, docs) { });
	// or, using a promise
	cursor.toArray().then(function(docs) { });
});
{% endhighlight %}

The callback specified in the `on` method will be called whenever *any* changes are made to the collection. This includes changes made as a result of inserting or modifying records as well as changes introduced during synchronization. This allows you to centralize all of your UI update code in a single method.

LowlaDB supports `find` with no query object or with a query object matching one or more properties:

{% highlight javascript %}
todos.find({ completed:false }).toArray().then(function(docs) {});
{% endhighlight %}

Support for richer queries will be added later.

If you know you only require a single record, you can use `findOne` rather than `find` to return the object directly without needing to iterate a cursor.

LowlaDB maintains an internal index on the `_id` key field and can optimize queries involving equality matches on `_id`. For small databases the difference is negligible, but if you have thousands of documents then you should use `_id` as the document identifier in your application logic wherever possible.

</div>
<div id="Count">
    
### Counting Objects ###
You can retrieve the number of documents in the collection via `count`:

{% highlight javascript %}
// All documents
todos.count().then(function(numOfDocs) {});
todos.count(function(numOfDocs) {});

// Some documents
todos.count({completed: true}).then(function(numCompleted) {});
todos.count({completed: true}, function(numCompleted) {});
{% endhighlight %}

The above are shorthand for `count` on the `Cursor` object:

{% highlight javascript %}
todos.find({completed: true}).count().then(function(numCompleted) {});
{% endhighlight %}

</div>
<div id="Cursor">
    
### Cursors ###
The `Cursor` object provides methods to determine the iterable documents.  Each method returns a new instance of `Cursor`.

The `sort` method creates a cursor that will order the documents on a given field or an array of fields.  Provide a positive value for ascending order, and a negative number for descending order.

{% highlight javascript %}
todos.find().sort('title').toArray(...)
todos.find().sort([['title', 1]]).toArray(...) // same as above
todos.find().sort([['title', -1]]).toArray(...) // descending
todos.find().sort([['title', -1], 'complete']).toArray(...) // descending title, ascending complete
todos.find().sort([['title', -1], ['complete', 1]]).toArray(...) // same as above
{% endhighlight %}

The `limit` method creates a cursor that will return at most the given number of documents. 

{% highlight javascript %}
todos.find().limit(3).toArray(...)
{% endhighlight %}

The `showPending` method will inject a field named `$pending` into each object returned by the cursor.  `$pending` will be `true` if the object has outgoing changes that have not yet been sent to the server.

{% highlight javascript %}
todos.find().showPending().each(function(doc) {
	// doc.$pending will be true/false based on sync status
});
{% endhighlight %}

Since each method returns a new instance of `Cursor`, the methods can be chained.  The following both limits and sorts the resulting documents:

{% highlight javascript %}
todos.find().sort('title').limit(3).toArray(...)
{% endhighlight %}

</div>
<div id="Update">
    
### Updating Objects ###
You update objects using the `findAndModify` method. This takes a query object, subject to the same requirements as the `find` methods, and also an object to either replace the existing data or describe the modifications to be made to the existing object. For example

{% highlight javascript %}
var todos = lowla.collection('mydb', 'todos');
todos.findAndModify({ _id: 'theId' }, { $set: { completed: true } });
{% endhighlight %}

Initially, LowlaDB will support `$set` and `$unset` to modify or remove properties from a document. More operators will be added later.

As with `insert`, you can use either a callback or a promise to confirm that the update was successful.

</div>
<div id="Remove">
    
### Removing Objects ###
You remove objects using the `remove` method. Similar to `find`, this takes a query object to specify the objects to be removed. For example

{% highlight javascript %}
var todos = lowla.collection('mydb', 'todos');
todos.remove({ _id: 'theId' });
{% endhighlight %}

You can add a callback or promise to confirm that the remove was successful.

</div>
</div>
<div id="Syncing">
    
## Syncing ##
You initiate sync with the `sync` method. This will perform an incremental, bi-directional sync with the specified server and, optionally, leave the sync channel open for further updates. If you do not provide any options, this method will sync once. Otherwise you can specify either scheduled syncs via polling or real-time updates via socket.io. However you sync, LowlaDB will always call your `on` callbacks for any active queries whenever changes are made to a collection.

{% highlight javascript %}
lowla.sync('syncServer', { /* options */ });
{% endhighlight %}

Supported options are

`socket`
: If socket.io is enabled on your page (by including a script tag for socket.io before the script tag for LowlaDB) then LowlaDB will automatically use it to provide real-time syncing. If you do *not* want this to happen then set the `socket` property to `false`.

`pollFrequency`
: The number of seconds to wait before syncing again. If specified, LowlaDB will not use socket.io. In most situations, real-time sync using socket.io offers both better performance and a better user experience than polling.


<div id="SyncEvents">
    
### Sync Events ###
LowlaDB provides a simple event emitter interface to notify your app of sync operations as they occur using the `on` method.

{% highlight javascript %}
lowla.on('syncBegin', showBusy);
lowla.on('syncEnd', hideBusy);
{% endhighlight %}

To stop receiving events, use the `off` method:

{% highlight javascript %}
lowla.off('syncBegin', showBusy);
lowla.off('syncEnd', hideBusy);
// Alternatively, to disable all events:
lowla.off();
{% endhighlight %}

There are three pairs of events fired during sync:

#### syncBegin / syncEnd ####
These events are emitted at the beginning and end of a polled sync operation, even if no documents actually need to sync.

#### pushBegin / pushEnd ####
`pushBegin` will be emitted when LowlaDB has determined there are outgoing changes that need to be sent to the server and is preparing to send them.  `pushEnd` will be emitted after all outgoing changes have been sent.

#### pullBegin / pullEnd ####
`pullBegin` will be emitted when LowlaDB has received information from the Syncer that documents need to be retrieved from the server.  `pullEnd` will be emitted after LowlaDB has requested and received those documents.

</div>
</div>
<div id="Bulk">
    
## Bulk Loading ##

To populate the local datastore with documents created from a previous `dump` [command](cli.html#CmdDump), use the `load` method.  You can specify either a URL to retrieve the JSON file created by `dump`, or a Javascript object if the dump result has been injected into the page by your server.

{% highlight javascript %}
lowla.load('http://my.server.org/data-dump.json');

var docDump = { ... }; // injected JSON file
lowla.load(docDump);
{% endhighlight %}

The `load` function takes an optional callback and also returns a promise that will be called/resolved once all the documents have been saved in the local datastore.

</div>