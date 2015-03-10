---
layout: page
title: LowlaDB Performance
navid: navperf
summary: A database for mobile applications
---

<div id="Intro">

## Introduction ##
Our performance target with LowlaDB is for most local datastore operations to complete in less than 750ms. The tables below list our current progress towards that goal.

We measure performance with three different datasets:

Dataset One
: Ten thousand records, each containing around 100 bytes of alphanumeric data. The total dataset is around 2.5Mb.

Dataset Two
: One thousand records, each containing a small amount of alphanumeric data and a 10k thumbnail image. The total dataset is around 15Mb.

Dataset Three
: One hundred records, each containing a small amount of alphanumeric data and a 1Mb image. The total dataset is around 135Mb.

For each dataset, we measure

* _load:_ the time to load the data from a dump file
* _count:_ the time to count the number of documents in the database
* _id:_ the time to locate a single document using the indexed `_id` identifier property
* _seek:_ the time to locate a single document using a non-indexed property

Finally, we measure each dataset using both the IndexedDB and Memory datastores.

All results are reported in milliseconds, rounded to the nearest whole number.

</div>
<div id="Platforms">
  
## Platforms ##
All testing is performed using [lowladb-benchmark](http://github.com/lowla/lowladb-benchmark) with version 0.1.0 of LowlaDB. The tested platforms are

Safari
: Safari 8.0.2 running on OS X 10.1.1 using a 2.6 GHz Core i7 MacBook Pro with 16Gb RAM.

Chrome
: Chrome 39.0.2171.95 running on OS X 10.1.1 using a 2.6 GHz Core i7 MacBook Pro with 16Gb RAM.

iPhone 6
: Mobile Safari on an iPhone 6 running iOS 8.1.2.

BlackBerry Z30
: Built-in browser on a BlackBerry Z30 running OS 10.2.1.2102

Nexus 7
: Chrome on a first-generation Nexus 7 running Android 4.4.4. This shows LowlaDB performance on an older, lower-spec Android device.

OnePlus One
: Chrome on a current-generation Android device.

Lumia 530
: Internet Explorer on a Nokia Lumia 530 running Windows Phone 8.1. Although IndexedDB is available on this configuration, it is subject to quotas that prevent the benchmark from executing successfully.

</div>
<div id="Results">
  
## Results ##

<div id="Data1">
  
### Dataset One ###
<table>
  <thead>
    <tr><th>Platform</th><th colspan="4">IndexedDB</th><th colspan="4">Memory</th></tr>
    <tr><th></th><th>load</th><th>count</th><th>id</th><th>seek</th><th>load</th><th>count</th><th>id</th><th>seek</th></tr>
  </thead>
  <tbody>
    <tr><td>Safari</td><td>60739</td><td>275</td><td>195</td><td>3478</td><td>1555</td><td>3</td><td>36</td><td>34</td></tr>
    <tr><td>Chrome</td><td>8962</td><td>19</td><td>1</td><td>663</td><td>5756</td><td>5</td><td>54</td><td>54</td></tr>
    <tr><td>iPhone 6</td><td>251429</td><td>1055</td><td>507</td><td>6087</td><td>22149</td><td>16</td><td>84</td><td>80</td></tr>
    <tr><td>BB Z30</td><td>33593</td><td>396</td><td>11</td><td>3974</td><td>8966</td><td>27</td><td>282</td><td>270</td></tr>
    <tr><td>Nexus 7</td><td>84950</td><td>226</td><td>6</td><td>2523</td><td>5445</td><td>34</td><td>404</td><td>425</td></tr>
    <tr><td>OnePlus One</td><td>81156</td><td>147</td><td>5</td><td>3086</td><td>7325</td><td>20</td><td>379</td><td>222</td></tr>
    <tr><td>Lumia 530</td><td>-</td><td>-</td><td>-</td><td>-</td><td>12257</td><td>23</td><td>236</td><td>236</td></tr>
  </tbody>
</table>

</div>
<div id="Data2">
  
### Dataset Two ###
<table>
  <thead>
    <tr><th>Platform</th><th colspan="4">IndexedDB</th><th colspan="4">Memory</th></tr>
    <tr><th></th><th>load</th><th>count</th><th>id</th><th>seek</th><th>load</th><th>count</th><th>id</th><th>seek</th></tr>
  </thead>
  <tbody>
    <tr><td>Safari</td><td>4455</td><td>103</td><td>24</td><td>479</td><td>241</td><td>1</td><td>6</td><td>6</td></tr>
    <tr><td>Chrome</td><td>1841</td><td>20</td><td>1</td><td>160</td><td>1213</td><td>1</td><td>8</td><td>8</td></tr>
    <tr><td>iPhone 6</td><td>32331</td><td>1636</td><td>53</td><td>965</td><td>74962</td><td>1</td><td>14</td><td>12</td></tr>
    <tr><td>BB Z30</td><td>26471</td><td>1188</td><td>16</td><td>2960</td><td>4537</td><td>5</td><td>55</td><td>44</td></tr>
    <tr><td>Nexus 7</td><td>22237</td><td>236</td><td>17</td><td>1271</td><td>1240</td><td>9</td><td>69</td><td>67</td></tr>
    <tr><td>OnePlus One</td><td>11501</td><td>145</td><td>9</td><td>773</td><td>1013</td><td>9</td><td>33</td><td>36</td></tr>
    <tr><td>Lumia 530</td><td>-</td><td>-</td><td>-</td><td>-</td><td>31663</td><td>5</td><td>52</td><td>55</td></tr>
  </tbody>
</table>

</div>
<div id="Data3">
  
### Dataset Three ###
<table>
  <thead>
    <tr><th>Platform</th><th colspan="4">IndexedDB</th><th colspan="4">Memory</th></tr>
    <tr><th></th><th>load</th><th>count</th><th>id</th><th>seek</th><th>load</th><th>count</th><th>id</th><th>seek</th></tr>
  </thead>
  <tbody>
    <tr><td>Safari</td><td>3638</td><td>605</td><td>44</td><td>1644</td><td>613</td><td>0</td><td>26</td><td>25</td></tr>
    <tr><td>Chrome</td><td>4096</td><td>159</td><td>47</td><td>1000</td><td>3927</td><td>0</td><td>33</td><td>32</td></tr>
    
  </tbody>
</table>

</div>
</div>