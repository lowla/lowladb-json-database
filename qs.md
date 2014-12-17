---
layout: page
navid: navqs
title: LowlaDB QuickStart
summary: Get up and running with LowlaDB in minutes
---

<div id="Intro">
  
## Introduction ##
We've put together a simple, self-contained demo application to show how LowlaDB applications work and to serve as a starting point for your own applications. The demo uses LowlaDB's default Node.js-based syncer with its built-in adapter for the embedded database NeDB. If you have MongoDB or PostgreSQL available, it's easy to switch the demo to use that instead, but we recommend starting with NeDB for your first install.

</div>
<div id="Prerequisites">
  
## Prerequisites ##
You'll need

- [Node.js](http://nodejs.org/download/)
- NPM - this usually comes installed with Node.js
- [Bower](http://bower.io)
- A [Git](http://git-scm.com) client of your choice

</div>
<div id="Install">
  
## Install the Demo ##
1. Create a local clone of the lowladb-demo-node repository
  * `git clone https://github.com/lowla/lowladb-demo-node`
2. From the newly-created folder, install the server dependencies using NPM
  * `cd lowladb-demo-node`
  * `npm install`
3. Install the client dependencies in the web app folder using Bower
  * `cd todomvc`
  * `bower install`
  * `cd ..`
4. Start the Node server
  * `node app.js`
 
</div>
<div id="Run">
   
## Run the Demo ##
Open a browser to the page
  * `http://localhost:3000/index.html`
  
This launches a basic Todo app, allowing you to create and delete todo actions, edit them and mark them complete. As you make changes in the browser, the modified data is synced in the background to the web application. To see this in action, open another browser window to the same page (or even open a different browser, if you have one available.) Changes that you make in one window automatically show up in all other windows.

</div>
<div id="How">
  
## How it Works ##
When you save or edit a document, LowlaDB performs the following actions

1. The updated document is sent up to the LowlaDB Adapter running in your local Node.js server
2. The adapter saves the document and notifies the LowlaDB Syncer (also running in your local Node.js server) that an update is available.
3. The Syncer notifies any listening clients that updates are available.
4. Clients ask the Syncer for the LowlaIDs of any updated documents.
5. Clients pass those LowlaIDs to the adapter and receive the updated documents where they are saved in the local datastore.

You can find more information throughout the documentation, in particular in the sections on the adapter and syncer.

</div>
<div id="MongoDB">
  
## Switching to MongoDB ##
Switching to MongoDB is as simple as reconfiguring the Node.js server to use a different datastore for both the Syncer and Adapter. The following steps assume that you have MongoDB server running on your local machine and want to store your data in a database called `lowladb`. To change those settings, simply modify the `mongoUrl` below when creating the MongoDatastore instance. 

1. If your Node.js server is running, terminate it by entering Ctrl-C into the relevant terminal window.
2. Install the LowlaDB MongoDB datastore
  * `npm install lowladb-node-mongo --save`
  * The `--save` option updates your `package.json` file to record the dependency on lowladb-node-mongo.
3. Open the `app.js` file in a text editor. 
  * Locate the line
  * `var lowladb = require('lowladb-node');`
  * Immediately after, insert the line
  * `var MongoDatastore = require('lowladb-node-mongo');`
  * Locate the line
  * `lowladb.configureRoutes(app, { io: io(server) });`
  * Replace it with the following lines
{% highlight javascript %}
  var lowlaConfig = {
    datastore: new MongoDatastore({ mongoUrl: 'mongodb://127.0.0.1/lowladb' }),
    io: io(server)
  };

  lowladb.configureRoutes(app, lowlaConfig);
{% endhighlight %}
  
The demo app will now run as before, but all data for both the syncer and adapter is now stored in MongoDB. If you have the MongoDB shell available, you can browse the lowladb database to confirm that data is indeed syncing up from the clients.

While it is common, you don't have to use the same datastore for both the syncer and adapter. For example, if your data is stored in an existing PostgreSQL database then you need to use the PostgreSQL datastore for the adapter. You may want to use a separate MongoDB instance for syncer data to avoid modifying your PostgreSQL schema.

</div>