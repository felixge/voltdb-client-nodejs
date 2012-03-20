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

VoltConfiguration = function() {}

// @REVIEW: This is a strange way to declare object properties. It will also
// cause unexpected results if the properties hold objects ({} or []) as those
// would be identical for all instances of the object.
//
// I would recommend this as idomatic node:
//
// function VoltConfiguration(options) {
//   this.host = options.host || 'localhost';
//   this.port = options.port || 21212;
//   ...
// }
VoltConfiguration.prototype = Object.create({
    host: 'localhost',
    port: 21212,
    username: 'user',
    password: 'password',
    service: 'database',
    queryTimeout: 50000
});

module.exports = VoltConfiguration;
