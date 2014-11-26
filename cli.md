---
layout: page
navid: navcli
title: LowlaDB Command Line
summary: The LowlaDB Command Line provides access to admin functions in the syncer and adapter.
---
<div id="Intro">

## Introduction ##
The LowlaDB command line interface allows you to interact with the LowlaDB syncer and adapter.

</div>
<div id="Install">

## Installation ##

</div>

<div id="Commands">
## Commands ##

For a list of all commands, enter

{% highlight bash %}
lowladb -h
{% endhighlight %}

For help on a specific command, enter

{% highlight bash %}
lowladb <cmd> -h
{% endhighlight %}

<div id="CmdDump">
### lowladb dump ###
Exports LowlaDB documents to a file. The exported file can be used by the LowlaDB browser client to import documents into its local data storage. See the LowlaDB Browser [documentation](/browser.html#Bulk) for more details.

`lowladb dump` takes the following arguments:

- `-s,--server` The server URL that hosts both the Syncer and Adapter. (default `http://localhost:3000`)
- `-q,--sequence` The sequence to from the Syncer to start exporting documents. (default `0`)
- `-f,--file` The JSON file for the exported data. (default `lowladb-dump.json`)
- `-y,--syncer` The server URL that hosts the Syncer if not using `--server` above.
- `-a,--adapter` The server URL that hosts the Adapter if not using `--adapter` above.

</div>
</div>