/* This file is part of VoltDB.
 * Copyright (C) 2008-2012 VoltDB Inc.
 *
 * This file contains original code and/or modifications of original code.
 * Any modifications made by VoltDB Inc. are licensed under the following
 * terms and conditions:
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
var Socket = require('net').Socket;
var crypto = require('crypto');
var util = require('util');
var Message = require('./message').Message;
var MESSAGE_TYPE = require('./message').MESSAGE_TYPE;

// @REVIEW: Unused variables, it doesn't seem like these are used anywhere.
var VoltProcedure = require('./query');
var VoltQuery = require('./query');

// @REVIEW: I generally recommend declaring only a single class per file
// as that generally makes it much easier to navigate a code base. That being
// said, since this is a purely internal collaborator I think this way is also
// acceptable.
VoltMessageManager = function() {}
VoltMessageManager.prototype = Object.create({
    uid: null,
    error: false,
    readCallback : null, 
    writeCallback : null, 
    message: null,
    time: null,
    index: -1
});


// @REVIEW: Those 3 methods below seem rather overkill. The same can be
// accomplished using:
//
// if (vmm.readCallback) vmm.readCallback().
//
// Also, if the caller doesn't really care if the vmm has a callback, you
// could also initialize readCallback / writeCallback to an empty function,
// so it is always safe to call it. (I would not be worried about performance
// here, calling an empty method should be very fast)
VoltMessageManager.prototype.hasReadCallback = function() {
    return this._isValid(this.readCallback);    
}

VoltMessageManager.prototype.hasWriteCallback = function() {
    return this._isValid(this.writeCallback);    
}

VoltMessageManager.prototype._isValid = function(obj) {
    return obj != null && typeof obj != 'undefined';
} 

VoltConnection = function(configuration) {
    EventEmitter.call(this);
    this.config = configuration;

    this.onConnect = this.onConnect.bind(this);
    this.onError = this.onError.bind(this);
    this.onRead = this.onRead.bind(this);
    this._send = this._send.bind(this);
    this.isValidConnection = this.isValidConnection.bind(this);
    this.isBlocked = this.isBlocked.bind(this);
    this._checkQueryTimeout = this._checkQueryTimeout.bind(this);
    this._manageOustandingQueries = this._manageOustandingQueries.bind(this);

    this.socket = new Socket();
    // @REVIEW: Why was this done? If anything, I would expect this to decrease
    // throughput. However, in my testing it didn't have much of an impact either
    // way, so I'm curious.
    this.socket.setNoDelay();
    this.socket.on('error', this.onError);
    this.socket.on('data', this.onRead);
    this.socket.on('connect', this.onConnect);

    this.isWritable = true;
    this.isLoggedIn = false;
    this.connectionCallback = null;

    // @REVIEW: As already mentioned in the call, JS does not have associative
    // arrays. Arrays can be used as objects, but it's considered a bad practice
    // and sends v8 and other engines into a slow case. So do:
    // this.calls = {};
    this._calls = [];
    this._callIndex = [];
    this._id = 0;
    this._overflow = new Buffer(0);
    this.sendCounter = 0;
    this.timeout = 0;
    this.invocations = 0;
    this.validConnection = true;
    this.blocked = false;

    // @REVIEW: I would recommend against setting up timers (or doing other
    // things like I/O) inside of a constructor as those will be very annoying
    // for unit testing. In this particular case I'd set up the timer when
    // establishing the connection.
    setInterval(this._manageOustandingQueries,60000);
}

util.inherits(VoltConnection, EventEmitter);

VoltConnection.prototype.connect = function(callback) {
    this.socket.connect(this.config.port, this.config.host);
    this.connectionCallback = callback;    
}

VoltConnection.prototype.isValidConnection = function() {
    return this.validConnection;
}

VoltConnection.prototype.isBlocked = function() {
    return this.blocked;
}

VoltConnection.prototype.call = function(query, readCallback, writeCallback) {
    this.invocations++;
    
    var uid = this._getUID();
    query.setUID(uid);
    
    // @REVIEW: I'd probably allow for the properties below to be passed in
    // the constructor like this:
    //
    // new VoltMessageManager({
    //   readCallback: readCallback,
    //   writeCallback: writeCallback,
    //   message: query.getMessage(),
    //   uid: uid,
    // });
    var vmm = new VoltMessageManager();
    vmm.readCallback = readCallback;
    vmm.writeCallback = writeCallback;
    vmm.message = query.getMessage();
    vmm.uid = uid;
    return this._send(vmm, true);
}


VoltConnection.prototype._getUID = function() {
    var id = String(this._id < 99999999 ? this._id++ : this._id = 0);
    var uid = this._zeros(8 - id.length).join('') + id;
    return uid;
}

VoltConnection.prototype._zeros = function(num) {
    var arr = new Array(num);
    for(var i = 0; i < num; i++) {
        arr[i] = 0;
    }
    return arr;
}

// @REVIEW: The `callback` parameter does not seem to be used.
VoltConnection.prototype.close = function(callback) {
    this.socket.end();
}

VoltConnection.prototype.onConnect = function(results) {

    var service = this.config.service;
    var sha1 = crypto.createHash('sha1');
    sha1.update(this.config.password);
    // @REVIEW: 'binary' is deprecated. Unfortunately `digest()` does not
    // support producing buffers yet, so I guess this is ok for now. Using
    // 'base64' would be more future-proof for now so.
    var password = new Buffer(sha1.digest('binary'), 'binary');

    var message = this._getLoginMessage(password);

    // you must connect and send login credentials immediately.
    var vmm = new VoltMessageManager();
    vmm.message = message;
    vmm.uid = this._getUID();
    this._send(vmm, false);
}

VoltConnection.prototype.onError = function(results) {
    results.error = true;
    // @REVIEW: You probably don't want to produce debug output on stdout
    // unless the user of the client asks for it.
    console.log('error', results);

    // @REVIEW: This method seems to be invokved for socket errors. Afaik those
    // can occur even after the connection has been established (for example
    // on problems with the shutdown of socket), so you may  not want to
    // delegate them to the connectionCallback. Instead you may want to consider
    // re-emitting them as 'error' events.
    this.connectionCallback(results);
}

VoltConnection.prototype.onRead = function(buffer) {
    var results = null;

    if(this.isLoggedIn == false) {
        // @REVIEW This assumes that the login result message always arrives
        // in full. It seems to be a reasonable assumption considering that
        // the message will be small, but afaik there could be scenarios where
        // even a small message is split up into pieces.
        results = this._decodeLoginResult(buffer);
        this.connectionCallback(results);
        this.isLoggedIn = true;
        this.validConnection = true;
        
    } else {

        var overflow = this._overflow;
        // @REVIEW Creating a new buffer for every incoming buffer as well
        // as all the slice() / copy() calls below could become expensive.
        // However, in my profiling none of this or the parser code was showing
        // up as using much CPU, so until other bottlenecks have been plugged
        // this is probably ok.
        var data = new Buffer(overflow.length + buffer.length);
        var length;

        overflow.copy(data, 0);
        buffer.copy(data, overflow.length, 0);
        while(data.length > 4 
            && data.length >= ( length = Message.readInt(data) + 4)) {
            
            var msg = data.slice(0, length);
            data = data.slice(length);
            
            results = this._decodeQueryResult(msg);            
            
            var vmm = this._calls[results.uid];

            // @REVIEW Checking if (vmm) would be easier here, no need to be
            // this explicit. (In JS objects will always be true-ish when type
            // juggling kicks in)
            if(vmm != null && typeof vmm != 'undefined') {
                this.sendCounter--;
                if (  vmm.hasReadCallback() == true ) {
                    vmm.readCallback(results);
                }
                
                if ( this.blocked == true) {
                    this.blocked = false;
                    this._invokeWriteCallback(vmm);
                }
                
                delete this._calls[results.uid];
            } else {
              // @REVIEW Should this ever happen? If it is a critical exception,
              // you may want to emit it as an 'error' event.
                console.log('vmm was not valid');
            }
        }
        this._overflow = data;
    }
}

VoltConnection.prototype._send = function(vmm, track) {
    var result = true;

    // @REVIEW: This try...catch block is a little far-reaching, you probably
    // just want it around the socket.write() call. (Which IMO should not throw
    // exceptions in the node core, but fixing that will be a little tough
    // as we're trying to not change the node api as much anymore these days)
    try {
        if ( track == true) {
            this._calls[vmm.uid] = vmm;
            this._callIndex.push(vmm.uid);
            vmm.time = (new Date()).getTime();
        }
        this.socket.write(vmm.message.toBuffer());
        this.sendCounter++;
        
        if ( this.blocked == false ) {
            this._invokeWriteCallback(vmm);
        }
    } catch (err) {
        console.log(err);
        this.validConnection = false;
        result = false;
    }

    // @REVIEW: Not sure what `result` is meant to represent. As it is right
    // now, it just indicates if there was an exception. However,
    // socket.write() also does some queueing of it's own, so just because
    // there was no exception, it doesn't mean that message has been passed
    // off to write(2) / kernel land.
    return result;
}



VoltConnection.prototype._invokeWriteCallback = function(vmm) {
    // only allow more writes if the queue has not breached a limit
    // @REVIEW: I'm not sure where this `5000` value comes from. Is it an
    // estimate?
    if(this.sendCounter < 5000) {
        this.blocked = false;
        if ( vmm!= null && vmm.hasWriteCallback() ) {
            vmm.writeCallback();
        }
    } else {
        this.blocked = true;
    }
}

VoltConnection.prototype._getLoginMessage = function(password) {

    var message = new Message();
    message.writeString(this.config.service);
    message.writeString(this.config.username);
    message.writeBinary(password);
    message.type = MESSAGE_TYPE.LOGIN;
    return message;
}

VoltConnection.prototype._decodeLoginResult = function(buffer) {
    return new LoginMessage(buffer);
}

VoltConnection.prototype._decodeQueryResult = function(buffer) {
    return new QueryMessage(buffer);
}

VoltConnection.prototype._manageOustandingQueries = function() {
    var tmpCallIndex = [];
    // @REVIEW: Idiomatic JS for this is `Date.now()`
    var time = (new Date()).getTime();
    var uid = null;
    while( uid = this._callIndex.pop()) {
        vmm = this._calls[uid];
        if ( this._checkQueryTimeout(vmm, time) == false ) {
            tmpCallIndex.push(vmm.uid);
        }
    }
    this._callIndex = tmpCallIndex;
}


VoltConnection.prototype._checkQueryTimeout = function(vmm, time) {   
    var vmmValid = vmm != null && typeof vmm != 'undefined' && vmm.uid != null 
        && typeof vmm.uid != 'undefined';
     
    var queryInvalidated = vmmValid == false;
    if ( vmmValid == true ) {
        if ( time - vmm.time > 600000) {   
            queryExpired = true;
            this.sendCounter--;
            if ( vmm.hasReadCallback() == true ) {
                vmm.readCallback({error: true,  
                    status: -6, 
                    statusString: 'Query timed out before server responded'});
            }
            
            if ( vmm.hasWriteCallback() == true ) {
                this.blocked = false;
                vmm.writeCallback();
            }
            delete this._calls[vmm.uid];
        }
    }
    
    return queryInvalidated;
}

module.exports = VoltConnection;
