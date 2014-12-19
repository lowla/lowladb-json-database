---
layout: page
navid: navsyncer
title: LowlaDB Syncer
summary: The LowlaDB Syncer keeps track of modifications to documents and tells LowlaDB clients when they need to sync and what data needs updating.
---
<div id="Intro">

## Introduction ##
The LowlaDB syncer acts as a intermediary between LowlaDB clients and adapters. Its role is to keep track of modifications to documents so that adapters can focus on the specifics of talking to their back-end while the syncer takes care of the housekeeping. It also provides a natural central point for notifying clients when data has changed. This allows push-style notifications using e.g., socket.io or Apple Push Notifications for real-time or near real-time applications again with no changes required to any adapters.

LowlaDB includes a default implementation of the syncer that can be embedded within a Node.js application and stores its data in any supported datastore. This implementation has a simple API that allows you to hook document modifications and trigger client notifications. 

##### Notes #####
* Once the syncer has notified a client that new data is available, the client connects directly to the adapter to pull the data. Data created or modified on the client is again sent directly to the adapter. No data (other than document identifiers and document version identifiers) is ever sent to or through the syncer.
* This allows the syncer to be hosted in a less secure environment than the adapter, providing more options for scaling the syncer independently of the adapter. This is valuable in situations where clients are polling the syncer for changes, but changes happen infrequently. The syncer can be scaled to handle the polling and the adapters only need handle the load when changes have occurred.

</div>
<div id="Install">
  
## Installation ##
The default LowlaDB syncer is packaged as a Node.js module designed to plug into an Express application. To install it, modify your dependencies in `package.json` to include `lowladb-node`. If you want to use socket.io for real-time client updates then you need to specify that as well.

{% highlight json %}
{
  "dependencies": {
    "body-parser": "~1.8.1",
    "cookie-parser": "~1.3.3",
    "debug": "~2.0.0",
    "express": "~4.9.0",
    "jade": "~1.6.0",
    "morgan": "~1.3.0",
    "serve-favicon": "~2.1.3",
    
    "lowladb-node": "~0.0.5",
    "socket.io": "^1.2.1"
  }
}
{% endhighlight %}

With the dependencies in place, you need to construct a new instance of the module, optionally providing configuration options.

{% highlight javascript %}
var lowladb = require('lowladb-node');
var app = express();

lowladb.configureRoutes(app, [optional options] );

{% endhighlight %}

The available options are described in the [API](#API) section below.

</div>
<div id="Spec">

## Specification ##
The LowlaDB client, syncer and adapter all communicate via a simple HTTP-based protocol. This section defines the parts of the protocol that the syncer implements.

<div id="SpecDefs">

#### Definitions ####
ID
: A text identifier that uniquely identifies a document. IDs are generated by adapters and, for new records created remotely, by clients.

Version
: A text identifier for a particular version of a document. Versions are only ever compared for equality, they do not need to support any kind of ordering. The only requirement is that the version must change when a document changes. Typical implementations include

* an increasing counter
* a hash of the document
* a timestamp

Versions are always generated by adapters.

Sequence
: An increasing counter maintained by the syncer to order modifications and identify changes that have occurred since a client last synced.

ClientNs
: Client namespace, i.e., the database and collection where a document should be stored on the client. This is expressed in the usual MongoDB form `db.collection` where collection may itself contain embedded periods.

</div>
<div id="SpecClient">

#### Client ####
A LowlaDB client may request modifications starting from a particular sequence by issuing an HTTP GET request to the endpoint

```
/api/v1/changes?seq=<sequence>
```

The syncer will generate a response of the form

{% highlight json %}
{
  "atoms": [
    { 
      "sequence": "<sequence>",
      "id": "<id>",
      "version": "<version>",
      "clientNs": "<clientNs>",
      "deleted": true|false,
    },
    {...}
  ],
  "sequence": "<sequence that client should use for next request>"
}
{% endhighlight %}

##### Notes #####
* The `seq` argument is optional; if it is missing the syncer will only respond with the current sequence number.
* Sequence numbers are never negative and so a client can begin to populate an empty database by issuing a `changes` request with `seq=0`.
* For performance or scalability reasons, the syncer need not return *all* atoms since the requested sequence. However, it must return the atoms in sequence order beginning with the oldest (i.e., lowest sequence number.) It must then set the `sequence` property of the response appropriately so that the client can continue requesting atoms until it has received them all with no gaps. In situations where large numbers of modifications share the same sequence number, this may lead to some atoms being returned more than once. This is unavoidable without generating unique sequence numbers for every modification.
* The value of the `sequence` property will usually be higher than the maximum sequence value in any of the atoms. This is intentional and prevents the syncer from having to repeatedly return the most recent modification.

</div>
<div id="SpecAdapter">

#### Adapter ####
A LowlaDB adapter is responsible for notifying the syncer whenever documents have been modified. The specifics of this will vary between platforms and even applications. Possible implementations include database triggers, replication log tailing and scheduled polling. In cases where data is only being modified by LowlaDB clients, the adapter can simply notify the syncer as it processes incoming documents from the client.

An adapter notifies the syncer of modifications by issuing an HTTP POST to the endpoint

```
/api/v1/update
```

with a request body of the form

{% highlight json %}
{
  "modified": [
    {
      "id": "<id>",
      "version": "<version>",
      "clientNs": "<clientNs>"
    },
    {...}
  ],
  "deleted": [
    "<id1>", "<id2>", ...
  ]
}
{% endhighlight %}

If the server accepts the notification, it will respond with

{% highlight json %}
{
  "sequence": "<the current sequence of the syncer after importing the changes>"
}
{% endhighlight %}

##### Notes #####
* If the adapter does not receive a success response from the syncer, it needs to retry the request.
* The syncer need not use the same sequence for all of the supplied modifications. The syncer attempts to balance the performance cost of generating new sequences against the performance cost of having large numbers of documents sharing the same sequence. In any case, the returned sequence will always be greater than or equal to the largest sequence used during the import.

</div>
</div>
<div id="API">
  
## API ##
The default syncer has a single API, `configureRoutes` that is used to instantiate and configure both the default syncer and adapter.

{% highlight javascript %}
var lowladb = require('lowladb-node');
var app = express();

var config = lowladb.configureRoutes(app, options);

{% endhighlight %}

The following options are supported

`datastore`
: The datastore that the syncer should use. If omitted, the syncer uses its built-in NeDB datastore. Other datastores are typically installed as separate node modules: datastores for MongoDB and PostgreSQL are currently available.

`notifier`
: A method that will be called with the single string parameter `'changes'` when the syncer has new data available.

`io`
: An instance of socket.io. If `io` is provided and `notifier` is not then the syncer will create a notifier function using the supplied socket.io instance.

`logger`
: An object capable of performing logging with a console-like API. If omitted, the syncer uses `console`.


</div>