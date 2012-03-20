/* This file is part of VoltDB.
 * Copyright (C) 2008-2012 VoltDB Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
 * OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 */

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var VoltConnection = require('./connection');

// @REVIEW: Use a named constructor instead:
//
// function VoltClient() { ... }
//
// This gives better error messages and also lets you see objects of this type
// when doing heap profiling for memory leaks.
VoltClient = function (configuration) {
	EventEmitter.call(this);
	
	this.config = configuration;
	
  // @REVIEW: I suppose these bind's are made so the 'this' context is
  // preserved when those functions are passed along as arguments somewhere.
  // This is generally done on an as-needed basis inside the individual
  // functions and I'd recommend to not do it in a constructor as it obfuscates
  // the actual object properties.
  // If you really want to do this, at least make a utility module that does
  // this in a generic way. Then you could do something like bindThis(this)
  // in the constructor which will go over all methods found on the thix object
  // and bind them. (again, I don't recommend that, but it would aid readability)
  //
  // Also, it seems like some of these bindings are entirely uneeded for the
  // code to work.
	this.connect = this.connect.bind(this);
	this._getConnections = this.connect.bind(this);
	this.call = this.call.bind(this);
	this.exit = this.connect.bind(this);
	this.connectionStats = this.connectionStats.bind(this);
	
	this._connections = [];
	this._badConnections = [];
	this._connectionCounter = 0;
}

util.inherits(VoltClient, EventEmitter);

// @REVIEW: The function below mixes tabs and spaces. The general convention in
// the node community is to use 2 spaces for indention. Doing so will make it
// easier to attract contributors.
VoltClient.prototype.connect = function (callback) {
    var self = this;
    
    var connectionCount = this.config.length;
    var connectionResults = [];
    for ( var index = 0; index < this.config.length; index++ ) {
        var con = new VoltConnection(this.config[index]);
    	con.connect(function _onConnect(results) {
    	    connectionResults.push(results);
    		self._connections.push(this);
    		connectionCount--;
    		if ( connectionCount < 1) {
            // @REVIEW Callbacks in node.js should always reserve the first
            // argument for a potential error object. This convention is
            // used by the node core and should be considered absolutely
            // essential when trying to write idomatic node.js code. I will
            // only highlight it once here, but it applies to all callbacks,
            // always.
            //
            // So this code should be changed to:
            //
            // callback(null, connectionResults);
    		    callback(connectionResults);
    		}
    	});
    }
}

VoltClient.prototype._getConnection = function (username, password, callback) {
    var length = this._connections.length;
    var connection = null;
    for ( var index = 0; index < length; index++) {
        
        // creates round robin
        this._connectionCounter++;
        if ( this._connectionCounter >= length ) {
            this._connectionCounter = 0;
        }
        
        connection = this._connections[this._connectionCounter];
        // validates that the connection is good and not blocked on reads
        if ( connection == null || connection.isValidConnection() == false ) {
                this._badConnections.push(connection);
                this._connections[this._connectionCounter] = null;
        } else if ( connection.isBlocked() == false ) {
            break;
        }
    }
    return connection;
}

// @REVIEW:
// a) 'call' is an unfortunate method name in JavaScript, as call is also
// a special function that is attached to all functions (along with apply and
// bind). See: https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Function/call
// I recommend using 'invoke' or similar as a method name.
//
// b) Providing 2 callbacks is very unusual for node libraries. In this case
// the idomatic way to model the back-pressure API would be to take inspiration
// from node's stream interface. So this function would return 'false' to
// indiciate that the caller should stop / slow down. Once the client is ready
// to do more work, it would emit a 'drain' event, see:
// http://nodejs.org/docs/v0.6.12/api/all.html#all_event_drain
VoltClient.prototype.call = function(query, readCallback, writeCallback ) {
    var con = this._getConnection();
    if ( con != null ) {
        if ( con.call(query,readCallback, writeCallback) == false ) {
            console.log(con.config.host, ' was lost');
            this.call(query, readCallback, writeCallback);
        }
        
    } else {
        console.log('A configuration object was set to null and cannot be used.');
    }
}

VoltClient.prototype.exit = function(callback) {
}

VoltClient.prototype.connectionStats = function() {
    console.log('Good connections:');
    this._displayConnectionArrayStats(this._connections);
    
    console.log('Bad connections:');
    this._displayConnectionArrayStats(this._badConnections);
}

VoltClient.prototype._displayConnectionArrayStats = function(array) {
    for ( var index = 0; index < array.length; index++) {
        var connection = array[index];
        if ( connection != null ) {
            console.log('Connection: ', connection.config.host, ': ', 
                connection.invocations, ' Alive: ', 
                connection.isValidConnection());
        }
    }
}

module.exports = VoltClient;
