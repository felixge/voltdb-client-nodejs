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
var Parser = require('./parser').Parser;
var util = require('util');

function Message(buffer) {
    this.type = MESSAGE_TYPE.UNDEFINED;
    this.error = false;
    Parser.call(this, buffer);
    if(!buffer) {
        this.writeInt(0);
        this.writeByte(0);
    } else {
        this.readHeader();
    }
}

Message.prototype = Object.create(Parser.prototype);

Message.prototype.readHeader = function() {
    this.length = this.readInt();
    this.protocol = this.readByte();
};

Message.prototype.writeHeader = function() {
    var pos = this.position;
    this.position = 0;
    this.writeInt(this.buffer.length - 4);
    this.writeByte(0);
    this.position = pos;
};

Message.prototype.toBuffer = function() {
    this.writeHeader();
    return new Buffer(this.buffer);
};
// for getting lengths from incoming data
Message.readInt = function(buffer, offset) {
    return Parser.readInt(buffer, offset);
};


LoginMessage = function(buffer) {
    Message.call(this, buffer);
    this.type = MESSAGE_TYPE.LOGIN;
    this.status = this.readByte();
    this.error = (this.status === 0 ? false : true );
    if(this.error === false) {
        this.serverId = this.readInt();
        this.connectionId = this.readLong();
        this.clusterStartTimestamp = 
            new Date(parseInt(this.readLong().toString()));
        // not microseonds, milliseconds
        this.leaderIP = this.readByte() + '.' + this.readByte() + '.' + 
            this.readByte() + '.' + this.readByte();
        this.build = this.readString();
    }
}

util.inherits(LoginMessage, Message);

// @REVIEW Doesn't seem like this aliasing is helping much here, as it is only
// used once below.
var lm = LoginMessage.prototype;

// @REVIEW toString() is expected to return a string in JS. For returning a JSON
// object like this, one would use toJSON, see:
//
// https://developer.mozilla.org/en/JSON#toJSON()_method
//
// If you are using this as a way to improve console.log() output, you can
// also provide an inspect() method which console.log() will use.
lm.toString = function() {
    return {
        length : this.length,
        protocol : this.protocol,
        status : this.status,
        error : this.error,
        serverId : this.serverId,
        connectionId : this.connectionId,
        clusterStartTimestamp : this.clusterStartTimestamp,
        leaderIP : this.leaderIP,
        build : this.build
    };
}
QueryMessage = function(buffer) {
    Message.call(this, buffer);
    this.type = MESSAGE_TYPE.QUERY;
    
    this.uid = this.readBinary(8).toString();
    this.fieldsPresent = this.readByte();
    // bitfield, use PRESENT values to check
    this.status = this.readByte();
    this.statusString = STATUS_CODE_STRINGS[this.status];
    if(this.fieldsPresent & PRESENT.STATUS) {
        this.statusString = this.readString();
    }
    this.appStatus = this.readByte();
    this.appStatusString = '';
    if(this.fieldsPresent & PRESENT.APP_STATUS) {
        this.appStatusString = this.readString();
    }
    this.exception
    this.exceptionLength = this.readInt();
    if(this.fieldsPresent & PRESENT.EXCEPTION) {
        this.exception = this.readException(1);
        // seems size doesn't matter, always 1
    } else {
        // don't parse the rest if there was an exception. Bad material there.
        var resultCount = this.readShort();
        if(resultCount != 0)
            resultCount = 1;
        // there can be more than one table with rows
        this.table = new Array(resultCount);
        for(var i = 0; i < resultCount; i++) {
            this.table[i] = this.readVoltTable();
        }
        
        
    }
}

util.inherits(QueryMessage, Message);

var qm = QueryMessage.prototype;

qm.toString = function() {
    return {
        length : this.length,
        protocol : this.protocol,
        status : this.status,
        error : this.error,
        uid : this.uid,
        fieldsPresent : this.fieldsPresent,
        status : this.status,
        statusString : this.statusString,
        appStatus : this.appStatus,
        appStatusString : this.appStatusString,
        exception : this.exception,
        exceptionLength : this.exceptionLength,
        results : this.results
    };
}

// @REVIEW I would recommend using string constants rather than numbers here.
// That's unless those values are used by the protocol itself (like it seems
// to be the case for PRESENT below). In that case this approach is fine.
var MESSAGE_TYPE = {
    UNDEFINED: -1,
    LOGIN: 1,
    QUERY: 2
};

var PRESENT = {
    STATUS : 0x20,
    EXCEPTION : 0x40,
    APP_STATUS : 0x80
};

var STATUS_CODES = {
    SUCCESS : 1,
    USER_ABORT : -1,
    GRACEFUL_FAILURE : -2,
    UNEXPECTED_FAILURE : -3,
    CONNECTION_LOST : -4,
    SERVER_UNAVAILABLE: -5,
    CONNECTION_TIMEOUT: -6
};

var STATUS_CODE_STRINGS = {
    1 : 'SUCCESS',
    '-1' : 'USER_ABORT',
    '-2' : 'GRACEFUL_FAILURE',
    '-3' : 'UNEXPECTED_FAILURE',
    '-4' : 'CONNECTION_LOST'
};

var LOGIN_ERRORS = {
    1 : 'Too many connections',
    2 : 'Authentication failed, client took too long to transmit credentials',
    3 : 'Corrupt or invalid login message'
};

exports.MESSAGE_TYPE=MESSAGE_TYPE;
exports.Message = Message;
exports.LoginMessage = LoginMessage;
exports.QueryMessage = QueryMessage;
