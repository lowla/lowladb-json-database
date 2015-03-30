# LowlaDB #

[![Build Status](https://travis-ci.org/lowla/lowladb-json-database.svg)](https://travis-ci.org/lowla/lowladb-json-database)

LowlaDB is a JSON database with built-in mobile sync and a MongoDB-like API. It's designed to integrate easily with today’s web databases e.g. MongoDB and popular MVC frameworks e.g. AngularJS. We have released a Javascript implementation for mobile and PC browsers and we are working on native versions for iOS and for Android that will be packaged as Cordova plugins.

#### Why is this needed? ####
To improve the user experience on mobile we often need to store, access and sync data to the user’s device.  For web developers, this means having to bring in unfamiliar frameworks and platforms (e.g. Titanium, Xamarin, PouchDB/CouchDB) which come with a significant learning curve and add complexity to your project. Wouldn’t it be great if there was an easier way to create a fully-functional mobile client?

#### Who should use it? ####
Web developers working with common front end frameworks (e.g. Angular, Ember and Backbone) and back end platforms (e.g. MongoDB and Node.js) who want to add a syncing mobile client with the minimum learning curve and additional programming effort.

#### What can it be used for? ####
LowlaDB is suitable for a wide variety of applications including:

- business-to-consumer applications (B2C)
- business-to-employee applications (B2E)
- much faster-responding web sites for mobile users (e.g. for microsites)

Our technical objectives for LowlaDB are:

1. Simplicity of development
2. Low-latency data access
3. Offline capability
4. Multi-platform capability
5. Flexibility to sync to different back ends 

Full LowlaDB documentation is available at [http://lowla.github.io/lowladb-json-database](http://lowla.github.io/lowladb-json-database).

You can also view a short introduction for developers, highlighting the architecture and API, at [http://www.slideshare.net/sives/lowla-db-preso-mar-2015](http://www.slideshare.net/sives/lowla-db-preso-mar-2015)

## License ##
LowlaDB is available under the MIT license.

## Installation ##
The easiest way to install LowlaDB is to use [Bower](http://bower.io). Once your project is configured for Bower, you can install LowlaDB with the command

```bash
$ bower install lowladb --save
```

If you just want to take a look at LowlaDB in action, we have created a [demo](http://github.com/lowla/lowladb-demo-node) project that you can clone and use as a starting point for your own projects.

## Getting Help ##
If you have a question about LowlaDB, please create an [issue](https://github.com/lowla/lowladb-json-database/issues). The LowlaDB team is also on Twitter (@LowlaDB) and you can send email to mark@lowla.io.
